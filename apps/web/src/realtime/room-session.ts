import {
  computeTargetPositionMs,
  isUnavailablePlayerCode,
  type RoomSnapshot,
  type ServerMessage,
} from "@play/shared";
import type { AudioSourceAdapter } from "../audio/adapter.js";
import { YT_PLAYER_STATES } from "../audio/adapter.js";
import type { ClockSynchronizer } from "../audio/clock-synchronizer.js";
import type { SyncEngine } from "../audio/sync-engine.js";
import type { LocalAudioStore } from "../audio/local-audio-store.js";
import type { ConnectionStatus, RoomClient } from "./room-client.js";

export type PlayerUiStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "buffering"
  | "needs-gesture"
  | "error"
  | "queue-empty";

export interface RoomSessionState {
  connection: ConnectionStatus;
  snapshot: RoomSnapshot | null;
  playerStatus: PlayerUiStatus;
  playerError: string | null;
  driftMs: number | null;
  latencyMs: number | null;
  positionMs: number | null;
  durationMs: number | null;
  needsGesture: boolean;
  lastNonstopTransition: {
    transitionId: string;
    from: string | null;
    to: string | null;
  } | null;
  roomClosed: { reason: string } | null;
}

export interface RoomSessionDeps {
  client: RoomClient;
  adapter: AudioSourceAdapter;
  clock: ClockSynchronizer;
  sync: SyncEngine;
  localAudio: LocalAudioStore;
  onState: (state: RoomSessionState) => void;
  onPlayerActionRequired: (reason: string, message: string) => void;
}

export class RoomSession {
  private state: RoomSessionState = {
    connection: "disconnected",
    snapshot: null,
    playerStatus: "idle",
    playerError: null,
    driftMs: null,
    latencyMs: null,
    positionMs: null,
    durationMs: null,
    needsGesture: false,
    lastNonstopTransition: null,
    roomClosed: null,
  };

  private loadedItemId: string | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private lastReportAtMs: number | null = null;
  private lastNonstopTransitionId: string | null = null;
  /** Bootstrap de reloj hasta que la primera muestra PING/PONG esté lista. */
  private snapshotClock: { serverMs: number; clientMs: number } | null = null;
  private initialized = false;
  private roomId: string | null = null;
  private container: HTMLElement | null = null;

  constructor(private readonly deps: RoomSessionDeps) {}

  private patch(partial: Partial<RoomSessionState>): void {
    this.state = { ...this.state, ...partial };
    this.deps.onState(this.state);
  }

  setConnection(status: ConnectionStatus): void {
    this.patch({ connection: status });
  }

  /** Reintenta reproducir tras un gesto del usuario (autoplay bloqueado). */
  async resumeLocal(): Promise<void> {
    if (!this.container || !this.initialized) return;
    try {
      await this.deps.adapter.play();
      this.patch({ needsGesture: false, playerStatus: "playing", playerError: null });
    } catch {
      this.patch({ needsGesture: true, playerStatus: "needs-gesture" });
    }
  }

  async handleMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "ROOM_SNAPSHOT":
        this.snapshotClock = {
          serverMs: message.snapshot.serverTimeMs,
          clientMs: Date.now(),
        };
        this.roomId = message.snapshot.room.id;
        this.patch({
          snapshot: message.snapshot,
          playerStatus: this.statusFromSnapshot(message.snapshot),
          roomClosed: null,
        });
        await this.reconcilePlayer();
        break;
      case "QUEUE_UPDATED":
        if (this.state.snapshot) {
          this.patch({ snapshot: { ...this.state.snapshot, queue: message.queue } });
        }
        break;
      case "QUEUE_ITEM_ADDED":
        if (this.state.snapshot) {
          const queue = [...this.state.snapshot.queue];
          if (!queue.some((q) => q.id === message.item.id)) queue.push(message.item);
          this.patch({ snapshot: { ...this.state.snapshot, queue } });
        }
        break;
      case "PLAYBACK_STATE_UPDATED":
        if (this.state.snapshot) {
          const snapshot: RoomSnapshot = {
            ...this.state.snapshot,
            playback: message.playback,
          };
          if (message.currentItem) {
            snapshot.queue = snapshot.queue.map((q) =>
              q.id === message.currentItem?.id ? message.currentItem : q,
            );
          }
          this.patch({ snapshot, playerStatus: this.statusFromSnapshot(snapshot), playerError: null });
          await this.reconcilePlayer();
        }
        break;
      case "PLAYBACK_SYNC_TARGET": {
        // Objetivo obsoleto (de otra pista): se descarta.
        if (message.target.queueItemId !== this.loadedItemId) break;
        if (this.lastReportAtMs !== null) {
          this.deps.clock.addSample(this.lastReportAtMs, Date.now(), message.target.serverTimeMs);
        }
        const localMs = this.loadedItemId !== null
          ? this.deps.adapter.getCurrentTime() * 1000
          : null;
        if (localMs !== null) {
          this.patch({ driftMs: Math.round(localMs - message.target.targetPositionMs) });
        }
        break;
      }
      case "NONSTOP_TRANSITION_STARTED":
        if (message.transitionId === this.lastNonstopTransitionId) break;
        this.lastNonstopTransitionId = message.transitionId;
        this.patch({
          lastNonstopTransition: {
            transitionId: message.transitionId,
            from: message.fromQueueItemId,
            to: message.toQueueItemId,
          },
        });
        break;
      case "PLAYER_ACTION_REQUIRED":
        this.deps.onPlayerActionRequired(message.reason, message.message);
        this.patch({ needsGesture: message.reason === "USER_GESTURE_REQUIRED" });
        break;
      case "ROOM_UPDATED":
        if (this.state.snapshot) {
          this.patch({
            snapshot: { ...this.state.snapshot, room: message.room },
            roomClosed: null,
          });
        }
        break;
      case "ROOM_CLOSED":
        this.patch({ roomClosed: { reason: message.reason } });
        if (this.state.snapshot) {
          this.patch({
            snapshot: {
              ...this.state.snapshot,
              room: { ...this.state.snapshot.room, status: "CLOSED" },
            },
          });
        }
        await this.deps.adapter.pause().catch(() => undefined);
        break;
      case "ROOM_ERROR":
        this.deps.onPlayerActionRequired("ROOM_ERROR", message.message);
        break;
      case "ROOM_MEMBER_JOINED": {
        if (!this.state.snapshot) break;
        const members = [...this.state.snapshot.members];
        const idx = members.findIndex((m) => m.userId === message.member.userId);
        const room = { ...this.state.snapshot.room };
        if (idx >= 0) {
          members[idx] = message.member;
        } else {
          members.push(message.member);
          room.participantCount = room.participantCount + 1;
        }
        this.patch({ snapshot: { ...this.state.snapshot, members, room } });
        break;
      }
      case "ROOM_MEMBER_LEFT": {
        // El miembro conserva su membresía: solo se marca como desconectado.
        if (!this.state.snapshot) break;
        const members = this.state.snapshot.members.map((m) =>
          m.userId === message.userId ? { ...m, connectionState: "DISCONNECTED" as const } : m,
        );
        this.patch({ snapshot: { ...this.state.snapshot, members } });
        break;
      }
      case "PONG":
        this.deps.clock.addSample(
          message.clientTimeMs,
          Date.now(),
          message.serverTimeMs,
        );
        this.patch({ latencyMs: Date.now() - message.clientTimeMs });
        break;
      default:
        break;
    }
  }

  private statusFromSnapshot(snapshot: RoomSnapshot): PlayerUiStatus {
    switch (snapshot.playback.playbackStatus) {
      case "PLAYING":
        return "playing";
      case "PAUSED":
        return "paused";
      case "BUFFERING":
        return "buffering";
      case "QUEUE_EMPTY":
        return "queue-empty";
      case "ERROR":
        return "error";
      case "IDLE":
      default:
        return "idle";
    }
  }

  /** Sincroniza el reproductor local con el estado autoritativo. */
  private async reconcilePlayer(): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot) return;
    const currentItem = snapshot.queue.find((q) => q.id === snapshot.playback.currentQueueItemId);

    if (!currentItem) {
      if (this.loadedItemId !== null) {
        await this.deps.adapter.pause().catch(() => undefined);
        this.loadedItemId = null;
      }
      this.patch({ positionMs: null, durationMs: null });
      return;
    }

    // Sin contenedor aún no hay reproductor: pedimos gesto cuando toque reproducir.
    if (!this.container) {
      if (snapshot.playback.playbackStatus === "PLAYING") {
        this.patch({ playerStatus: "needs-gesture", needsGesture: true });
        this.deps.onPlayerActionRequired(
          "USER_GESTURE_REQUIRED",
          "Toca reproducir para iniciar el audio en este dispositivo.",
        );
      }
      return;
    }

    await this.ensureInitialized();

    const desiredStart = this.desiredStartSeconds(snapshot);
    if (this.loadedItemId !== currentItem.id) {
      this.patch({ playerStatus: "loading" });
      try {
        await this.deps.adapter.load(currentItem.externalContentId, desiredStart);
        this.loadedItemId = currentItem.id;
        const duration = this.deps.adapter.getDuration();
        this.patch({
          durationMs: duration > 0 ? Math.round(duration * 1000) : null,
          positionMs: Math.round(desiredStart * 1000),
        });
      } catch (err) {
        this.patch({
          playerStatus: "error",
          playerError: err instanceof Error ? err.message : "Error al cargar el contenido.",
        });
        return;
      }
    }

    this.applyLocalAudio();

    if (snapshot.playback.playbackStatus === "PLAYING") {
      try {
        await this.deps.adapter.play();
        this.patch({ playerStatus: "playing", needsGesture: false });
      } catch {
        this.patch({ playerStatus: "needs-gesture", needsGesture: true });
        this.deps.onPlayerActionRequired(
          "USER_GESTURE_REQUIRED",
          "Toca reproducir para iniciar el audio en este dispositivo.",
        );
      }
    } else if (snapshot.playback.playbackStatus === "PAUSED") {
      await this.deps.adapter.pause().catch(() => undefined);
      this.patch({ playerStatus: "paused" });
    }
  }

  private desiredStartSeconds(snapshot: RoomSnapshot): number {
    const { playback } = snapshot;
    if (playback.playbackStatus !== "PLAYING") {
      return Math.max(0, playback.anchorPositionMs / 1000);
    }
    const target = computeTargetPositionMs(
      playback.anchorPositionMs,
      playback.anchorServerTimeMs,
      this.estimatedServerNowMs(),
      playback.playbackRate,
    );
    return Math.max(0, target / 1000);
  }

  /** Ahora estimado en el servidor: reloj con muestras, o bootstrap del snapshot. */
  private estimatedServerNowMs(): number {
    if (this.deps.clock.getOffset() !== null) {
      return this.deps.clock.estimatedServerNowDateMs();
    }
    if (this.snapshotClock) {
      return this.snapshotClock.serverMs + (Date.now() - this.snapshotClock.clientMs);
    }
    return Date.now();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.container) return;
    this.initialized = true;
    this.deps.adapter.onEnded(() => this.onEnded());
    this.deps.adapter.onError((code) => this.onAdapterError(code));
    this.deps.adapter.onStateChange((s) => {
      if (s === YT_PLAYER_STATES.BUFFERING) this.patch({ playerStatus: "buffering" });
    });
    await this.deps.adapter.init(this.container);
    this.applyLocalAudio();
    if (this.roomId) this.deps.client.playerReady(this.roomId);
  }

  async attach(container: HTMLElement, roomId: string): Promise<void> {
    this.container = container;
    this.roomId = roomId;
    await this.ensureInitialized();
    this.startTimers();
    // Si ya había estado (join previo a que el contenedor estuviera listo),
    // reconciliamos ahora que hay reproductor.
    await this.reconcilePlayer();
  }

  private applyLocalAudio(): void {
    const prefs = this.deps.localAudio.get();
    this.deps.adapter.setVolume(prefs.volume / 100);
    this.deps.adapter.mute(prefs.muted);
  }

  /** Llamar cuando el usuario cambia el volumen/mute local. */
  refreshLocalAudio(): void {
    this.applyLocalAudio();
  }

  private onEnded(): void {
    const snapshot = this.state.snapshot;
    if (!snapshot || !this.roomId) return;
    if (!snapshot.room.nonstopEnabled) return;
    const currentId = snapshot.playback.currentQueueItemId;
    if (!currentId) return;
    this.deps.client.next(this.roomId, "ENDED", currentId);
  }

  private onAdapterError(code: number): void {
    const snapshot = this.state.snapshot;
    const itemId = snapshot?.playback.currentQueueItemId ?? null;
    const fatal = isUnavailablePlayerCode(String(code));
    this.patch({
      playerError: this.describeError(code),
      playerStatus: "error",
    });
    if (this.roomId) {
      this.deps.client.reportPlayerError(
        this.roomId,
        itemId,
        String(code),
        this.describeError(code),
        fatal,
      );
    }
  }

  private describeError(code: number): string {
    switch (code) {
      case 2:
        return "El enlace de contenido no es válido.";
      case 5:
        return "Este contenido no se puede reproducir en el reproductor incorporado.";
      case 100:
        return "El contenido no está disponible (eliminado o privado).";
      case 101:
      case 150:
        return "El propietario no permite reproducir este contenido incrustado.";
      default:
        return "No se pudo reproducir el contenido.";
    }
  }

  private startTimers(): void {
    this.stopTimers();
    this.tickTimer = setInterval(() => {
      const snapshot = this.state.snapshot;
      if (!snapshot) return;
      const { driftMs } = this.deps.sync.tick(snapshot.playback);
      const partial: Partial<RoomSessionState> = {};
      if (driftMs !== null) partial.driftMs = driftMs;
      if (this.loadedItemId !== null && this.deps.adapter.isReady()) {
        partial.positionMs = Math.round(this.deps.adapter.getCurrentTime() * 1000);
      }
      if (Object.keys(partial).length > 0) this.patch(partial);
    }, 1000);

    this.pingTimer = setInterval(() => {
      this.deps.client.ping(Date.now());
    }, 5000);

    // Reporte periódico de estado: el servidor responde con PLAYBACK_SYNC_TARGET.
    this.reportTimer = setInterval(() => {
      if (!this.roomId || this.loadedItemId === null || !this.deps.adapter.isReady()) return;
      this.lastReportAtMs = Date.now();
      this.deps.client.reportStatus(this.roomId, this.loadedItemId);
    }, 5000);
  }

  private stopTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.tickTimer = null;
    this.pingTimer = null;
    this.reportTimer = null;
  }

  destroy(): void {
    this.stopTimers();
    this.deps.adapter.destroy();
  }
}
