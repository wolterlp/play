import type {
  ControlMode,
  InviteSummary,
  PrivacyMode,
  RepeatMode,
  Role,
  RoomPermissions,
  RoomSummary,
} from "@play/shared";
import { computePermissions } from "@play/shared";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import type { RoomMemberRow, RoomRow } from "../../db/rows.js";
import { toRoomSummary } from "../../db/mappers.js";
import { AppError } from "../../errors.js";
import { generateOpaqueToken, hashToken } from "../../security/crypto.js";
import type { Logger } from "../../logger.js";

export interface CreateRoomInput {
  name: string;
  privacyMode: PrivacyMode;
  controlMode: ControlMode;
  nonstopEnabled: boolean;
  repeatMode: RepeatMode;
  maxParticipants: number;
}

export interface UpdateRoomInput {
  name?: string | undefined;
  privacyMode?: PrivacyMode | undefined;
  controlMode?: ControlMode | undefined;
  nonstopEnabled?: boolean | undefined;
  repeatMode?: RepeatMode | undefined;
  maxParticipants?: number | undefined;
}

export interface RoomContext {
  room: RoomRow;
  membership: RoomMemberRow;
  role: Role;
  permissions: RoomPermissions;
}

export class RoomsService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async createRoom(ownerId: string, input: CreateRoomInput): Promise<RoomSummary> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const room = await client.query<RoomRow>(
        `INSERT INTO rooms (name, owner_user_id, privacy_mode, control_mode,
                            nonstop_enabled, repeat_mode, max_participants)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.name,
          ownerId,
          input.privacyMode,
          input.controlMode,
          input.nonstopEnabled,
          input.repeatMode,
          input.maxParticipants,
        ],
      );
      const roomRow = room.rows[0];
      if (!roomRow) throw new AppError("INTERNAL_ERROR", "No se pudo crear la sala.");

      await client.query(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES ($1, $2, 'HOST')`,
        [roomRow.id, ownerId],
      );
      await client.query(
        `INSERT INTO room_playback_state (room_id, playback_status, version)
         VALUES ($1, 'QUEUE_EMPTY', 1)`,
        [roomRow.id],
      );
      await client.query("COMMIT");
      this.logger.info({ roomId: roomRow.id, ownerId }, "room.created");
      return toRoomSummary(roomRow, 1);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Carga la sala y la membresía exigiendo que el usuario pertenezca a ella. */
  async requireMembership(roomId: string, userId: string): Promise<RoomContext> {
    const roomRes = await this.db.query<RoomRow>(
      "SELECT * FROM rooms WHERE id = $1",
      [roomId],
    );
    const room = roomRes.rows[0];
    if (!room) throw new AppError("NOT_FOUND", "La sala no existe.");

    const memberRes = await this.db.query<RoomMemberRow>(
      `SELECT * FROM room_members
       WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [roomId, userId],
    );
    const membership = memberRes.rows[0];
    if (!membership) {
      throw new AppError("FORBIDDEN", "No perteneces a esta sala.");
    }

    return {
      room,
      membership,
      role: membership.role,
      permissions: computePermissions(membership.role, room.control_mode),
    };
  }

  /** Lanza ROOM_CLOSED si la sala está cerrada o la gracia del anfitrión venció. */
  async assertRoomOpen(ctx: RoomContext): Promise<void> {
    if (ctx.room.status === "CLOSED") {
      throw new AppError("ROOM_CLOSED", "La sala está cerrada.");
    }
    if (this.isHostGraceExpired(ctx.room)) {
      await this.closeRoom(ctx.room.id, ctx.room.owner_user_id, "host_grace_expired");
      throw new AppError("ROOM_CLOSED", "La sala se cerró por inactividad del anfitrión.");
    }
  }

  isHostGraceExpired(room: RoomRow): boolean {
    return (
      room.status === "SUSPENDED" &&
      room.host_grace_until !== null &&
      room.host_grace_until.getTime() < Date.now()
    );
  }

  async updateRoom(
    roomId: string,
    userId: string,
    input: UpdateRoomInput,
  ): Promise<RoomSummary> {
    const ctx = await this.requireMembership(roomId, userId);
    if (!ctx.permissions.canManageRoom) {
      throw new AppError("FORBIDDEN", "Solo el anfitrión puede editar la sala.");
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };
    if (input.name !== undefined) push("name", input.name);
    if (input.privacyMode !== undefined) push("privacy_mode", input.privacyMode);
    if (input.controlMode !== undefined) push("control_mode", input.controlMode);
    if (input.nonstopEnabled !== undefined) push("nonstop_enabled", input.nonstopEnabled);
    if (input.repeatMode !== undefined) push("repeat_mode", input.repeatMode);
    if (input.maxParticipants !== undefined) push("max_participants", input.maxParticipants);

    if (sets.length === 0) {
      throw new AppError("VALIDATION_ERROR", "No hay campos para actualizar.");
    }
    sets.push("updated_at = now()");
    values.push(roomId);

    const res = await this.db.query<RoomRow>(
      `UPDATE rooms SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    const room = res.rows[0];
    if (!room) throw new AppError("NOT_FOUND", "La sala no existe.");
    const count = await this.memberCount(room.id);
    this.logger.info({ roomId, userId }, "room.updated");
    return toRoomSummary(room, count);
  }

  async closeRoom(roomId: string, userId: string, reason = "host_closed"): Promise<void> {
    await this.db.query(
      `UPDATE rooms SET status = 'CLOSED', closed_at = now(), updated_at = now()
       WHERE id = $1 AND status <> 'CLOSED'`,
      [roomId],
    );
    this.logger.info({ roomId, userId, reason }, "room.closed");
  }

  /**
   * RF-01: cuando el anfitrión se desconecta, la sala entra en SUSPENDED con
   * una ventana de gracia. Si vence sin que regrese, se cierra.
   */
  async suspendForHostDisconnect(roomId: string): Promise<RoomRow | null> {
    const graceMs = this.config.HOST_GRACE_SECONDS * 1000;
    const res = await this.db.query<RoomRow>(
      `UPDATE rooms
       SET status = 'SUSPENDED',
           host_grace_until = now() + ($2 || ' milliseconds')::interval,
           updated_at = now()
       WHERE id = $1 AND status = 'OPEN' AND owner_user_id IS NOT NULL
       RETURNING *`,
      [roomId, String(graceMs)],
    );
    const room = res.rows[0] ?? null;
    if (room) {
      this.logger.info({ roomId, hostGraceUntil: room.host_grace_until }, "room.suspended");
    }
    return room;
  }

  /** El anfitrión volvió dentro de la ventana de gracia: la sala reanuda. */
  async reopenRoom(roomId: string): Promise<RoomRow | null> {
    const res = await this.db.query<RoomRow>(
      `UPDATE rooms
       SET status = 'OPEN', host_grace_until = NULL, updated_at = now()
       WHERE id = $1 AND status = 'SUSPENDED' AND closed_at IS NULL
         AND (host_grace_until IS NULL OR host_grace_until > now())
       RETURNING *`,
      [roomId],
    );
    const room = res.rows[0] ?? null;
    if (room) this.logger.info({ roomId }, "room.reopened");
    return room;
  }

  /** Cierra salas SUSPENDED cuya gracia venció. Devuelve los IDs cerrados. */
  async closeExpiredSuspendedRooms(): Promise<string[]> {
    const res = await this.db.query<{ id: string }>(
      `UPDATE rooms
       SET status = 'CLOSED', closed_at = now(), updated_at = now()
       WHERE status = 'SUSPENDED'
         AND host_grace_until IS NOT NULL
         AND host_grace_until < now()
       RETURNING id`,
    );
    for (const row of res.rows) {
      this.logger.info({ roomId: row.id }, "room.closed_grace_expired");
    }
    return res.rows.map((r) => r.id);
  }

  async getRoom(roomId: string): Promise<RoomRow | null> {
    const res = await this.db.query<RoomRow>("SELECT * FROM rooms WHERE id = $1", [roomId]);
    return res.rows[0] ?? null;
  }

  async getRoomSummary(roomId: string): Promise<RoomSummary> {
    const room = await this.getRoom(roomId);
    if (!room) throw new AppError("NOT_FOUND", "La sala no existe.");
    return toRoomSummary(room, await this.memberCount(roomId));
  }

  async deleteRoom(roomId: string, userId: string): Promise<void> {
    const ctx = await this.requireMembership(roomId, userId);
    if (!ctx.permissions.canManageRoom) {
      throw new AppError("FORBIDDEN", "Solo el anfitrión puede eliminar la sala.");
    }
    await this.db.query("DELETE FROM rooms WHERE id = $1", [roomId]);
    this.logger.info({ roomId, userId }, "room.deleted");
  }

  async listRoomsForUser(userId: string): Promise<Array<RoomSummary & { role: Role }>> {
    const res = await this.db.query<
      RoomRow & { role: Role; participant_count: string }
    >(
      `SELECT r.*, m.role,
              (SELECT count(*) FROM room_members rm
                WHERE rm.room_id = r.id AND rm.left_at IS NULL) AS participant_count
       FROM rooms r
       JOIN room_members m ON m.room_id = r.id
       WHERE m.user_id = $1 AND m.left_at IS NULL
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [userId],
    );
    return res.rows.map((row) => ({
      ...toRoomSummary(row, Number(row.participant_count)),
      role: row.role,
    }));
  }

  async memberCount(roomId: string): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM room_members
       WHERE room_id = $1 AND left_at IS NULL`,
      [roomId],
    );
    return Number(res.rows[0]?.count ?? "0");
  }

  /* ------------------------------- Invitaciones ------------------------------ */

  async createInvite(
    roomId: string,
    userId: string,
    requestOrigin?: string,
  ): Promise<InviteSummary> {
    const ctx = await this.requireMembership(roomId, userId);
    if (!ctx.permissions.canManageInvites) {
      throw new AppError("FORBIDDEN", "No puedes gestionar invitaciones.");
    }
    const activeCount = await this.activeInviteCount(roomId);
    if (activeCount >= this.config.MAX_INVITES_PER_ROOM) {
      throw new AppError(
        "CONFLICT",
        "Se alcanzó el límite de invitaciones activas para esta sala.",
      );
    }

    const token = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + this.config.INVITE_TTL_SECONDS * 1000);
    const res = await this.db.query<{
      id: string;
      created_at: Date;
    }>(
      `INSERT INTO room_invites (room_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [roomId, hashToken(token), expiresAt, userId],
    );
    const row = res.rows[0];
    if (!row) throw new AppError("INTERNAL_ERROR", "No se pudo crear la invitación.");
    this.logger.info({ roomId, userId, inviteId: row.id }, "invite.created");
    return {
      id: row.id,
      roomId,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      createdAt: row.created_at.toISOString(),
      token,
      joinUrl: this.buildJoinUrl(token, requestOrigin),
    };
  }

  /**
   * Construye la URL absoluta de invitación. Usa `PUBLIC_URL` si está
   * configurada; si no, el origen de la petición (esquema + host).
   */
  private buildJoinUrl(token: string, requestOrigin?: string): string {
    const base = (this.config.PUBLIC_URL ?? requestOrigin ?? "").replace(/\/+$/, "");
    return `${base}/join/${token}`;
  }

  async listInvites(roomId: string, userId: string): Promise<InviteSummary[]> {
    const ctx = await this.requireMembership(roomId, userId);
    if (!ctx.permissions.canManageInvites) {
      throw new AppError("FORBIDDEN", "No puedes gestionar invitaciones.");
    }
    const res = await this.db.query<{
      id: string;
      room_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, room_id, expires_at, revoked_at, created_at
       FROM room_invites WHERE room_id = $1
       ORDER BY created_at DESC LIMIT 100`,
      [roomId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      roomId: r.room_id,
      expiresAt: r.expires_at.toISOString(),
      revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async revokeInvite(roomId: string, inviteId: string, userId: string): Promise<void> {
    const ctx = await this.requireMembership(roomId, userId);
    if (!ctx.permissions.canManageInvites) {
      throw new AppError("FORBIDDEN", "No puedes gestionar invitaciones.");
    }
    const res = await this.db.query(
      `UPDATE room_invites SET revoked_at = now()
       WHERE id = $1 AND room_id = $2 AND revoked_at IS NULL`,
      [inviteId, roomId],
    );
    if (res.rowCount === 0) {
      throw new AppError("NOT_FOUND", "Invitación no encontrada o ya revocada.");
    }
    this.logger.info({ roomId, userId, inviteId }, "invite.revoked");
  }

  /**
   * Resuelve un token de invitación a su sala. Valida expiración y revocación.
   * No devuelve el token; trabaja con su hash.
   */
  async resolveInvite(token: string): Promise<{ roomId: string; inviteId: string }> {
    const res = await this.db.query<{
      id: string;
      room_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, room_id, expires_at, revoked_at
       FROM room_invites WHERE token_hash = $1`,
      [hashToken(token)],
    );
    const row = res.rows[0];
    if (!row) throw new AppError("INVITE_INVALID", "Invitación inválida.");
    if (row.revoked_at) throw new AppError("INVITE_REVOKED", "Invitación revocada.");
    if (row.expires_at.getTime() < Date.now()) {
      throw new AppError("INVITE_EXPIRED", "Invitación expirada.");
    }
    return { roomId: row.room_id, inviteId: row.id };
  }

  /** Une a un usuario autenticado a la sala. Idempotente si ya es miembro. */
  async joinRoom(
    roomId: string,
    userId: string,
    role: Role = "PARTICIPANT",
  ): Promise<RoomMemberRow> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const roomRes = await client.query<RoomRow>(
        "SELECT * FROM rooms WHERE id = $1 FOR UPDATE",
        [roomId],
      );
      const room = roomRes.rows[0];
      if (!room) throw new AppError("NOT_FOUND", "La sala no existe.");
      if (room.status === "CLOSED") {
        throw new AppError("ROOM_CLOSED", "La sala está cerrada.");
      }

      const existing = await client.query<RoomMemberRow>(
        "SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2",
        [roomId, userId],
      );
      const existingRow = existing.rows[0];
      if (existingRow && existingRow.left_at === null) {
        await client.query("COMMIT");
        return existingRow;
      }

      if (existingRow) {
        const revived = await client.query<RoomMemberRow>(
          `UPDATE room_members
           SET left_at = NULL, joined_at = now(), last_seen_at = now()
           WHERE id = $1 RETURNING *`,
          [existingRow.id],
        );
        await client.query("COMMIT");
        const r = revived.rows[0];
        if (!r) throw new AppError("INTERNAL_ERROR", "No se pudo reincorporar.");
        return r;
      }

      const countRes = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM room_members
         WHERE room_id = $1 AND left_at IS NULL`,
        [roomId],
      );
      const count = Number(countRes.rows[0]?.count ?? "0");
      if (count >= room.max_participants) {
        throw new AppError("ROOM_FULL", "La sala está llena.");
      }

      const inserted = await client.query<RoomMemberRow>(
        `INSERT INTO room_members (room_id, user_id, role, last_seen_at)
         VALUES ($1, $2, $3, now()) RETURNING *`,
        [roomId, userId, role],
      );
      await client.query("COMMIT");
      const r = inserted.rows[0];
      if (!r) throw new AppError("INTERNAL_ERROR", "No se pudo unir a la sala.");
      this.logger.info({ roomId, userId, role }, "room.joined");
      return r;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async updateMemberRole(
    roomId: string,
    actorId: string,
    targetUserId: string,
    role: Role,
  ): Promise<void> {
    const ctx = await this.requireMembership(roomId, actorId);
    if (!ctx.permissions.canManageMembers) {
      throw new AppError("FORBIDDEN", "No puedes gestionar miembros.");
    }
    if (targetUserId === ctx.room.owner_user_id) {
      throw new AppError("FORBIDDEN", "El rol del anfitrión no puede cambiarse.");
    }
    if (role === "HOST") {
      throw new AppError("FORBIDDEN", "No se puede asignar el rol de anfitrión.");
    }
    const res = await this.db.query(
      `UPDATE room_members SET role = $1
       WHERE room_id = $2 AND user_id = $3 AND left_at IS NULL`,
      [role, roomId, targetUserId],
    );
    if (res.rowCount === 0) {
      throw new AppError("NOT_FOUND", "Miembro no encontrado.");
    }
  }

  async removeMember(
    roomId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    const ctx = await this.requireMembership(roomId, actorId);
    if (!ctx.permissions.canManageMembers) {
      throw new AppError("FORBIDDEN", "No puedes gestionar miembros.");
    }
    if (targetUserId === ctx.room.owner_user_id) {
      throw new AppError("FORBIDDEN", "No se puede expulsar al anfitrión.");
    }
    await this.db.query(
      `UPDATE room_members SET left_at = now()
       WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [roomId, targetUserId],
    );
  }

  private async activeInviteCount(roomId: string): Promise<number> {
    const res = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM room_invites
       WHERE room_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [roomId],
    );
    return Number(res.rows[0]?.count ?? "0");
  }
}
