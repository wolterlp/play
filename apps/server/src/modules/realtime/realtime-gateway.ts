import type { Server, Socket } from "socket.io";
import {
  clientMessageSchema,
  isUnavailablePlayerCode,
  PROTOCOL_VERSION,
  type ClientMessage,
  type PlaybackState,
  type QueueItem,
  type ServerMessage,
} from "@play/shared";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { AppError, isAppError } from "../../errors.js";
import type { Logger } from "../../logger.js";
import { RateLimiter } from "../../security/rate-limiter.js";
import type { TokenService } from "../auth/token-service.js";
import type { PlaybackService } from "../playback/playback-service.js";
import type { PresenceService } from "../presence/presence-service.js";
import type { QueueService } from "../queue/queue-service.js";
import type { RoomStateService } from "../rooms/room-state-service.js";
import type { RoomsService } from "../rooms/rooms-service.js";
import type { AppSocket, SocketData } from "./socket-types.js";

const ROOM_CHANNEL = (roomId: string) => `room:${roomId}`;

export class RealtimeGateway {
  private readonly messageLimiter: RateLimiter;
  private readonly joinLimiter: RateLimiter;
  /** transitionId estable por (roomId, versión) para no emitir IDs distintos. */
  private readonly transitionIds = new Map<string, string>();

  constructor(
    private readonly io: Server,
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly tokens: TokenService,
    private readonly rooms: RoomsService,
    private readonly queue: QueueService,
    private readonly playback: PlaybackService,
    private readonly roomState: RoomStateService,
    private readonly presence: PresenceService,
  ) {
    this.messageLimiter = new RateLimiter(
      config.WS_RATE_MAX,
      config.WS_RATE_WINDOW_MS,
    );
    this.joinLimiter = new RateLimiter(
      config.JOIN_RATE_MAX,
      config.JOIN_RATE_WINDOW_MS,
    );
  }

  attach(): void {
    this.io.use(async (socket, next) => {
      try {
        const token =
          (socket.handshake.auth?.token as string | undefined) ??
          (typeof socket.handshake.query?.token === "string"
            ? socket.handshake.query.token
            : undefined);
        if (!token) {
          return next(Object.assign(new Error("UNAUTHENTICATED"), { data: { code: "UNAUTHENTICATED" } }));
        }
        const claims = await this.tokens.verifyAccessToken(token);
        const data = socket.data as SocketData;
        data.userId = claims.sub;
        data.displayName = claims.displayName;
        data.roomId = null;
        next();
      } catch {
        next(Object.assign(new Error("UNAUTHENTICATED"), { data: { code: "UNAUTHENTICATED" } }));
      }
    });

    this.io.on("connection", (raw: Socket) => {
      const socket = raw as unknown as AppSocket;
      const { userId } = socket.data as SocketData;
      this.logger.info({ userId, socketId: socket.id }, "ws.connected");

      socket.on("message", (payload: unknown) => {
        void this.handleMessage(socket, payload);
      });

      socket.on("disconnect", (reason: string) => {
        void this.handleDisconnect(socket, reason);
      });
    });
  }

  private async handleMessage(socket: AppSocket, payload: unknown): Promise<void> {
    const { userId } = socket.data as SocketData;

    if (!this.messageLimiter.allow(userId)) {
      this.emitError(socket, new AppError("RATE_LIMITED", "Demasiados mensajes; espera un momento."));
      return;
    }

    const parsed = clientMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitError(
        socket,
        new AppError("VALIDATION_ERROR", "Mensaje inválido.", parsed.error.flatten()),
      );
      return;
    }

    const msg = parsed.data;
    try {
      await this.route(socket, msg);
    } catch (err) {
      if (isAppError(err)) {
        this.emitError(socket, err, msg.requestId);
      } else {
        this.logger.error({ err, userId, type: msg.type }, "ws.handler_error");
        this.emitError(socket, new AppError("INTERNAL_ERROR", "Error interno."), msg.requestId);
      }
    }
  }

  private async route(socket: AppSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "ROOM_JOIN":
        return this.onJoin(socket, msg);
      case "ROOM_LEAVE": {
        const { roomId } = await this.requireCtx(socket);
        if (msg.roomId !== roomId) {
          throw new AppError("VALIDATION_ERROR", "No estás en esa sala.");
        }
        return this.onLeave(socket, roomId);
      }
      case "QUEUE_ITEM_ADD":
        return this.onQueueAdd(socket, msg);
      case "QUEUE_ITEM_REMOVE":
        return this.onQueueRemove(socket, msg);
      case "QUEUE_ITEM_MOVE":
        return this.onQueueMove(socket, msg);
      case "PLAYBACK_PLAY":
        return this.onPlay(socket, msg);
      case "PLAYBACK_PAUSE":
        return this.onPause(socket, msg);
      case "PLAYBACK_SEEK":
        return this.onSeek(socket, msg);
      case "PLAYBACK_NEXT":
        return this.onNext(socket, msg);
      case "PLAYBACK_PREVIOUS":
        return this.onPrevious(socket);
      case "PLAYER_READY":
        return this.onPlayerReady(socket);
      case "PLAYER_STATUS_REPORT":
        return this.onStatusReport(socket, msg);
      case "PLAYER_ERROR":
        return this.onPlayerError(socket, msg);
      case "PING":
        return this.onPing(socket, msg.clientTimeMs);
      default:
        return;
    }
  }

  /* ------------------------------- Handlers ------------------------------- */

  private async onJoin(socket: AppSocket, msg: ClientMessage & { type: "ROOM_JOIN" }): Promise<void> {
    const { userId } = socket.data as SocketData;

    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      throw new AppError("VALIDATION_ERROR", "Versión de protocolo incompatible.");
    }

    // RF-02: límite para frenar fuerza bruta de salas/IDs por WS.
    if (!this.joinLimiter.allow(`join:${userId}`)) {
      throw new AppError("RATE_LIMITED", "Demasiados intentos de unión.");
    }

    const roomId = msg.roomId;
    if (!roomId) {
      throw new AppError("VALIDATION_ERROR", "Falta roomId.");
    }

    const hadRoom = (socket.data as SocketData).roomId;
    if (hadRoom && hadRoom !== roomId) {
      await this.onLeave(socket, hadRoom);
    }

    // Solo pueden entrar quienes ya son miembros de la sala
    // (la unión por invitación ocurre vía POST /api/invites/:token/join).
    const ctx = await this.rooms.requireMembership(roomId, userId);

    // RF-01: si el anfitrión vuelve dentro de la ventana de gracia, la sala reanuda.
    if (ctx.room.owner_user_id === userId && ctx.room.status === "SUSPENDED") {
      const reopened = await this.rooms.reopenRoom(roomId);
      if (reopened) {
        ctx.room = reopened;
        await this.broadcastRoomUpdated(roomId, "HOST_RECONNECTED");
      }
    }

    try {
      await this.rooms.assertRoomOpen(ctx);
    } catch (err) {
      if (err instanceof AppError && err.code === "ROOM_CLOSED" && ctx.room.status === "SUSPENDED") {
        this.broadcastRoomClosed(roomId, "HOST_GRACE_EXPIRED");
      }
      throw err;
    }

    (socket.data as SocketData).roomId = roomId;

    await socket.join(ROOM_CHANNEL(roomId));
    this.presence.addConnection(userId);

    const snapshot = await this.roomState.buildSnapshot(ctx.room, ctx.membership, ctx.role);
    this.emit(socket, { type: "ROOM_SNAPSHOT", snapshot });

    // Si la sala ya está reproduciendo, pide al nuevo cliente iniciar audio.
    if (snapshot.playback.playbackStatus === "PLAYING") {
      this.emit(socket, {
        type: "PLAYER_ACTION_REQUIRED",
        reason: "USER_GESTURE_REQUIRED",
        message: "La sala ya está reproduciendo; pulsa reproducir para iniciar el audio aquí.",
      });
    }

    // Notifica a los demás miembros
    socket.to(ROOM_CHANNEL(roomId)).emit("message", {
      type: "ROOM_MEMBER_JOINED",
      member: snapshot.members.find((m) => m.userId === userId) ?? {
        userId,
        displayName: socket.data.displayName,
        role: ctx.role,
        connectionState: "CONNECTED",
        joinedAt: new Date().toISOString(),
        lastSeenAt: null,
      },
      version: snapshot.playback.version,
    } satisfies ServerMessage);

    this.logger.info({ userId, roomId }, "ws.joined");
  }

  private async onLeave(socket: AppSocket, roomId: string): Promise<void> {
    const data = socket.data as SocketData;
    const { userId } = data;
    await socket.leave(ROOM_CHANNEL(roomId));
    this.presence.removeConnection(userId);
    data.roomId = null;
    const version = await this.playback
      .getState(roomId)
      .then((s) => s.version)
      .catch(() => 0);
    this.io.to(ROOM_CHANNEL(roomId)).emit("message", {
      type: "ROOM_MEMBER_LEFT",
      userId,
      version,
    } satisfies ServerMessage);
    await this.handleHostAbsence(roomId, userId);
  }

  /** RF-01: si el anfitrión se va y no queda en línea, inicia la ventana de gracia. */
  private async handleHostAbsence(roomId: string, userId: string): Promise<void> {
    if (this.presence.isOnline(userId)) return;
    const room = await this.rooms.getRoom(roomId).catch(() => null);
    if (!room || room.owner_user_id !== userId || room.status !== "OPEN") return;
    const suspended = await this.rooms.suspendForHostDisconnect(roomId);
    if (suspended) await this.broadcastRoomUpdated(roomId, "HOST_DISCONNECTED");
  }

  private async requireCtx(socket: AppSocket): Promise<{
    roomId: string;
    userId: string;
  }> {
    const data = socket.data as SocketData;
    if (!data.roomId) {
      throw new AppError("FORBIDDEN", "No estás en una sala.");
    }
    return { roomId: data.roomId, userId: data.userId };
  }

  private async onQueueAdd(
    socket: AppSocket,
    msg: ClientMessage & { type: "QUEUE_ITEM_ADD" },
  ): Promise<void> {
    const { roomId } = await this.requireCtx(socket);
    const { userId } = socket.data as SocketData;
    const ctx = await this.rooms.requireMembership(roomId, userId);
    await this.rooms.assertRoomOpen(ctx);
    if (!ctx.permissions.canAddToQueue) {
      throw new AppError("FORBIDDEN", "No puedes agregar contenido a esta cola.");
    }

    const item = await this.queue.addItem(roomId, userId, msg.sourceUrl, msg.title ?? null);
    const version = await this.playback
      .getState(roomId)
      .then((s) => s.version)
      .catch(() => 0);
    this.io.to(ROOM_CHANNEL(roomId)).emit("message", {
      type: "QUEUE_ITEM_ADDED",
      item,
      version,
    } satisfies ServerMessage);
  }

  private async onQueueRemove(
    socket: AppSocket,
    msg: ClientMessage & { type: "QUEUE_ITEM_REMOVE" },
  ): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    const ctx = await this.rooms.requireMembership(roomId, userId);
    if (!ctx.permissions.canRemoveFromQueue) {
      throw new AppError("FORBIDDEN", "No puedes eliminar elementos de la cola.");
    }
    await this.queue.removeItem(roomId, msg.queueItemId);
    this.broadcastQueue(roomId);
  }

  private async onQueueMove(
    socket: AppSocket,
    msg: ClientMessage & { type: "QUEUE_ITEM_MOVE" },
  ): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    const ctx = await this.rooms.requireMembership(roomId, userId);
    if (!ctx.permissions.canReorderQueue) {
      throw new AppError("FORBIDDEN", "No puedes reordenar la cola.");
    }
    await this.queue.moveItem(roomId, msg.queueItemId, msg.toPosition);
    this.broadcastQueue(roomId);
  }

  private async onPlay(
    socket: AppSocket,
    msg: ClientMessage & { type: "PLAYBACK_PLAY" },
  ): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    const ctx = await this.rooms.requireMembership(roomId, userId);
    if (!ctx.permissions.canControlPlayback) {
      throw new AppError("FORBIDDEN", "No puedes controlar la reproducción.");
    }
    const result = await this.playback.play(roomId, userId, msg.positionMs);
    this.broadcastPlayback(roomId, result);
    this.broadcastQueue(roomId);
  }

  private async onPause(
    socket: AppSocket,
    msg: ClientMessage & { type: "PLAYBACK_PAUSE" },
  ): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    const ctx = await this.rooms.requireMembership(roomId, userId);
    if (!ctx.permissions.canControlPlayback) {
      throw new AppError("FORBIDDEN", "No puedes controlar la reproducción.");
    }
    const result = await this.playback.pause(roomId, userId, msg.positionMs);
    this.broadcastPlayback(roomId, result);
  }

  private async onSeek(
    socket: AppSocket,
    msg: ClientMessage & { type: "PLAYBACK_SEEK" },
  ): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    const ctx = await this.rooms.requireMembership(roomId, userId);
    if (!ctx.permissions.canControlPlayback) {
      throw new AppError("FORBIDDEN", "No puedes controlar la reproducción.");
    }
    const result = await this.playback.seek(roomId, userId, msg.positionMs);
    this.broadcastPlayback(roomId, result);
  }

  private async onNext(
    socket: AppSocket,
    msg: ClientMessage & { type: "PLAYBACK_NEXT" },
  ): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    const ctx = await this.rooms.requireMembership(roomId, userId);

    // Un fin de reproducción reportado por el reproductor (ENDED/ERROR) es
    // válido sin permisos de control si la sala tiene non-stop activo.
    const isNonstopReport = msg.reason !== "USER";
    const allowed =
      ctx.permissions.canControlPlayback ||
      (isNonstopReport && ctx.room.nonstop_enabled);
    if (!allowed) {
      throw new AppError("FORBIDDEN", "No puedes cambiar la canción.");
    }

    const result = await this.playback.next(roomId, userId, {
      reason: msg.reason,
      ...(msg.failedQueueItemId ? { expectedCurrentItemId: msg.failedQueueItemId } : {}),
    });

    if (result.transitioned) {
      if (isNonstopReport) {
        this.io.to(ROOM_CHANNEL(roomId)).emit("message", {
          type: "NONSTOP_TRANSITION_STARTED",
          fromQueueItemId: msg.failedQueueItemId ?? null,
          toQueueItemId: result.playback.currentQueueItemId,
          transitionId: this.transitionIdFor(roomId, result.playback.version),
        } satisfies ServerMessage);
      }
      this.broadcastPlayback(roomId, result);
      this.broadcastQueue(roomId);
    }
  }

  private async onPrevious(socket: AppSocket): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    const ctx = await this.rooms.requireMembership(roomId, userId);
    if (!ctx.permissions.canControlPlayback) {
      throw new AppError("FORBIDDEN", "No puedes controlar la reproducción.");
    }
    const result = await this.playback.previous(roomId, userId);
    this.broadcastPlayback(roomId, result);
    this.broadcastQueue(roomId);
  }

  private async onPlayerReady(socket: AppSocket): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    // Marca al usuario como presente con actividad reciente.
    await this.touchLastSeen(roomId, userId);
  }

  private async onStatusReport(
    socket: AppSocket,
    msg: ClientMessage & { type: "PLAYER_STATUS_REPORT" },
  ): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    await this.touchLastSeen(roomId, userId);
    const state = await this.playback.getState(roomId);
    // Solo difundimos un objetivo de sincronización si el reporte corresponde
    // al item actual; nunca mutamos el estado global desde un cliente.
    if (
      msg.report.queueItemId === null ||
      msg.report.queueItemId === state.currentQueueItemId
    ) {
      const serverNow = Date.now();
      const targetPositionMs = state.playbackStatus === "PLAYING"
        ? Math.max(
            0,
            state.anchorPositionMs +
              (serverNow - state.anchorServerTimeMs) * state.playbackRate,
          )
        : state.anchorPositionMs;
      this.emit(socket, {
        type: "PLAYBACK_SYNC_TARGET",
        target: {
          queueItemId: state.currentQueueItemId,
          targetPositionMs: Math.round(targetPositionMs),
          serverTimeMs: serverNow,
        },
      });
    }
  }

  private async touchLastSeen(roomId: string, userId: string): Promise<void> {
    await this.db.query(
      "UPDATE room_members SET last_seen_at = now() WHERE room_id = $1 AND user_id = $2",
      [roomId, userId],
    );
  }

  private async onPlayerError(
    socket: AppSocket,
    msg: ClientMessage & { type: "PLAYER_ERROR" },
  ): Promise<void> {
    const { roomId, userId } = await this.requireCtx(socket);
    const ctx = await this.rooms.requireMembership(roomId, userId);
    this.logger.warn(
      { roomId, userId, code: msg.code, fatal: msg.fatal },
      "player.error_reported",
    );

    // Un error fatal confirmado por el reproductor local marca el elemento como
    // UNAVAILABLE y, con non-stop activo, avanza a la siguiente pista.
    // Nunca intentamos eludir anuncios ni políticas de la fuente.
    const isUnavailable = isUnavailablePlayerCode(msg.code);

    if (msg.fatal && msg.queueItemId && ctx.room.nonstop_enabled) {
      const state = await this.playback.getState(roomId);
      if (state.currentQueueItemId === msg.queueItemId) {
        const result = isUnavailable
          ? await this.playback.reportUnavailable(roomId, userId, msg.queueItemId)
          : await this.playback.next(roomId, userId, {
              reason: "ERROR",
              expectedCurrentItemId: msg.queueItemId,
            });
        if (result.transitioned) {
          this.broadcastPlayback(roomId, result);
          this.broadcastQueue(roomId);
        }
      }
    }
  }

  private async onPing(socket: AppSocket, clientTimeMs: number): Promise<void> {
    this.emit(socket, {
      type: "PONG",
      clientTimeMs,
      serverTimeMs: Date.now(),
    });
  }

  private async handleDisconnect(socket: AppSocket, reason: string): Promise<void> {
    const data = socket.data as SocketData | undefined;
    if (!data?.roomId) {
      this.logger.info({ socketId: socket.id, reason }, "ws.disconnected_no_room");
      return;
    }
    const { roomId, userId } = data;
    this.presence.removeConnection(userId);
    this.io.to(ROOM_CHANNEL(roomId)).emit("message", {
      type: "ROOM_MEMBER_LEFT",
      userId,
      version: await this.playback
        .getState(roomId)
        .then((s) => s.version)
        .catch(() => 0),
    } satisfies ServerMessage);
    await this.handleHostAbsence(roomId, userId);
    this.logger.info({ socketId: socket.id, userId, roomId, reason }, "ws.disconnected");
  }

  /* -------------------------------- Emisores ------------------------------- */

  private async broadcastPlayback(
    roomId: string,
    result: { playback: PlaybackState; currentItem: QueueItem | null },
  ): Promise<void> {
    this.io.to(ROOM_CHANNEL(roomId)).emit("message", {
      type: "PLAYBACK_STATE_UPDATED",
      playback: result.playback,
      currentItem: result.currentItem,
    } satisfies ServerMessage);
  }

  private async broadcastQueue(roomId: string): Promise<void> {
    const queue = await this.queue.list(roomId).catch(() => null);
    if (queue === null) return;
    const state = await this.playback.getState(roomId).catch(() => null);
    if (state === null) return;
    this.io.to(ROOM_CHANNEL(roomId)).emit("message", {
      type: "QUEUE_UPDATED",
      queue,
      version: state.version,
    } satisfies ServerMessage);
  }

  async broadcastRoomUpdated(
    roomId: string,
    reason: "SETTINGS_CHANGED" | "HOST_DISCONNECTED" | "HOST_RECONNECTED",
  ): Promise<void> {
    const room = await this.rooms.getRoomSummary(roomId).catch(() => null);
    if (!room) return;
    this.io.to(ROOM_CHANNEL(roomId)).emit("message", {
      type: "ROOM_UPDATED",
      room,
      reason,
    } satisfies ServerMessage);
  }

  broadcastRoomClosed(
    roomId: string,
    reason: "HOST_CLOSED" | "HOST_DELETED" | "HOST_GRACE_EXPIRED",
  ): void {
    this.io.to(ROOM_CHANNEL(roomId)).emit("message", {
      type: "ROOM_CLOSED",
      roomId,
      reason,
    } satisfies ServerMessage);
  }

  /** transitionId determinista por (roomId, versión) del estado de reproducción. */
  private transitionIdFor(roomId: string, version: number): string {
    const key = `${roomId}:${version}`;
    let id = this.transitionIds.get(key);
    if (!id) {
      // Limitamos el mapa para no crecer sin control.
      if (this.transitionIds.size > 5_000) {
        const oldest = this.transitionIds.keys().next().value;
        if (oldest !== undefined) this.transitionIds.delete(oldest);
      }
      id = crypto.randomUUID();
      this.transitionIds.set(key, id);
    }
    return id;
  }

  private emit(socket: AppSocket, message: ServerMessage): void {
    socket.emit("message", message);
  }

  private emitError(socket: AppSocket, err: AppError, requestId?: string): void {
    socket.emit("message", {
      type: "ROOM_ERROR",
      code: err.code,
      message: err.message,
      ...(requestId ? { requestId } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    } satisfies ServerMessage);
  }
}
