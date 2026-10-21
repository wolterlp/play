import type {
  PlaybackState,
  RoomMember,
  RoomSnapshot,
  Role,
} from "@play/shared";
import { computePermissions, PROTOCOL_VERSION } from "@play/shared";
import type { Database } from "../../db/pool.js";
import type { PlaybackStateRow, RoomMemberRow, RoomRow } from "../../db/rows.js";
import { toPlaybackState, toRoomMember, toRoomSummary } from "../../db/mappers.js";
import { AppError } from "../../errors.js";
import type { PresenceService } from "../presence/presence-service.js";
import type { QueueService } from "../queue/queue-service.js";

export class RoomStateService {
  constructor(
    private readonly db: Database,
    private readonly queue: QueueService,
    private readonly presence: PresenceService,
  ) {}

  async buildSnapshot(
    room: RoomRow,
    member: RoomMemberRow,
    role: Role,
  ): Promise<RoomSnapshot> {
    const [members, queue, playback] = await Promise.all([
      this.loadMembers(room.id),
      this.queue.list(room.id),
      this.loadPlayback(room.id),
    ]);

    return {
      protocolVersion: PROTOCOL_VERSION,
      room: toRoomSummary(room, members.length),
      members,
      queue,
      playback,
      you: {
        userId: member.user_id,
        role,
        permissions: computePermissions(role, room.control_mode),
      },
      serverTimeMs: Date.now(),
    };
  }

  async loadMembers(roomId: string): Promise<RoomMember[]> {
    const res = await this.db.query<RoomMemberRow & { display_name: string }>(
      `SELECT rm.*, u.display_name
       FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1 AND rm.left_at IS NULL
       ORDER BY rm.joined_at ASC
       LIMIT 500`,
      [roomId],
    );
    return res.rows.map((row) =>
      toRoomMember(row, this.presence.getConnectionState(row.user_id)),
    );
  }

  async loadPlayback(roomId: string): Promise<PlaybackState> {
    const res = await this.db.query<PlaybackStateRow>(
      "SELECT * FROM room_playback_state WHERE room_id = $1",
      [roomId],
    );
    const row = res.rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Estado de sala no encontrado.");
    return toPlaybackState(row);
  }
}
