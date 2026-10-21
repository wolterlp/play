import { io, type Socket } from "socket.io-client";
import {
  PROTOCOL_VERSION,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "@play/shared";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface RoomClientEvents {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
}

/**
 * Cliente de tiempo real. Valida cada mensaje del servidor con el esquema
 * compartido antes de entregarlo, y ofrece métodos tipados para enviar.
 */
export class RoomClient {
  private socket: Socket | null = null;
  private requestCounter = 0;
  /** Se invoca en cada (re)conexión: el hook de React lo asigna para re-join. */
  onConnect: (() => void) | undefined;

  constructor(
    private readonly url: string,
    private readonly getToken: () => string | null,
    private readonly events: RoomClientEvents,
  ) {}

  connect(): void {
    const token = this.getToken();
    if (!token) {
      this.events.onStatus("disconnected");
      return;
    }
    this.events.onStatus("connecting");
    this.socket = io(this.url, {
      path: "/ws",
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
    });

    this.socket.on("connect", () => {
      this.events.onStatus("connected");
      this.onConnect?.();
    });
    this.socket.io.on("reconnect_attempt", () => this.events.onStatus("reconnecting"));
    this.socket.on("disconnect", () => this.events.onStatus("disconnected"));
    this.socket.on("connect_error", () => this.events.onStatus("reconnecting"));

    this.socket.on("message", (raw: unknown) => {
      const parsed = serverMessageSchema.safeParse(raw);
      if (parsed.success) {
        this.events.onMessage(parsed.data);
      }
      // Mensajes inválidos del servidor se descartan silenciosamente.
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.events.onStatus("disconnected");
  }

  private send(message: ClientMessage & { requestId?: string }): void {
    const requestId = `req-${Date.now()}-${++this.requestCounter}`;
    this.socket?.emit("message", { ...message, requestId });
  }

  joinWithRoom(roomId: string): void {
    this.send({ type: "ROOM_JOIN", protocolVersion: PROTOCOL_VERSION, roomId });
  }

  leave(roomId: string): void {
    this.send({ type: "ROOM_LEAVE", roomId });
  }

  addQueueItem(roomId: string, sourceUrl: string, title?: string): void {
    this.send({
      type: "QUEUE_ITEM_ADD",
      roomId,
      sourceUrl,
      ...(title ? { title } : {}),
    });
  }

  removeQueueItem(roomId: string, queueItemId: string): void {
    this.send({ type: "QUEUE_ITEM_REMOVE", roomId, queueItemId });
  }

  moveQueueItem(roomId: string, queueItemId: string, toPosition: number): void {
    this.send({ type: "QUEUE_ITEM_MOVE", roomId, queueItemId, toPosition });
  }

  play(roomId: string, positionMs?: number): void {
    this.send({ type: "PLAYBACK_PLAY", roomId, ...(positionMs !== undefined ? { positionMs } : {}) });
  }

  pause(roomId: string, positionMs?: number): void {
    this.send({ type: "PLAYBACK_PAUSE", roomId, ...(positionMs !== undefined ? { positionMs } : {}) });
  }

  seek(roomId: string, positionMs: number): void {
    this.send({ type: "PLAYBACK_SEEK", roomId, positionMs });
  }

  next(roomId: string, reason: "USER" | "ENDED" | "ERROR", failedQueueItemId?: string): void {
    this.send({
      type: "PLAYBACK_NEXT",
      roomId,
      reason,
      ...(failedQueueItemId ? { failedQueueItemId } : {}),
    });
  }

  previous(roomId: string): void {
    this.send({ type: "PLAYBACK_PREVIOUS", roomId });
  }

  playerReady(roomId: string): void {
    this.send({ type: "PLAYER_READY", roomId });
  }

  reportStatus(roomId: string, queueItemId: string | null): void {
    this.send({ type: "PLAYER_STATUS_REPORT", roomId, report: { queueItemId } });
  }

  reportPlayerError(
    roomId: string,
    queueItemId: string | null,
    code: string,
    message: string,
    fatal: boolean,
  ): void {
    this.send({ type: "PLAYER_ERROR", roomId, queueItemId, code, message, fatal });
  }

  ping(clientTimeMs: number): void {
    this.send({ type: "PING", clientTimeMs });
  }
}
