import type {
  PlaybackState,
  PlaybackStatus,
  QueueItem,
  RepeatMode,
  SourceType,
} from "@play/shared";
import type { Database } from "../../db/pool.js";
import type { PoolClient } from "pg";
import type { PlaybackStateRow, QueueItemRow } from "../../db/rows.js";
import { toPlaybackState, toQueueItem } from "../../db/mappers.js";
import { AppError } from "../../errors.js";
import type { AppConfig } from "../../config.js";
import type { Logger } from "../../logger.js";
import type { QueueService } from "../queue/queue-service.js";

export interface TransitionResult {
  playback: PlaybackState;
  currentItem: QueueItem | null;
  transitioned: boolean;
}

/** Umbral (ms) por debajo del cual "anterior" reinicia la pista actual. */
const PREVIOUS_RESTART_THRESHOLD_MS = 3_000;

export class PlaybackService {
  constructor(
    private readonly db: Database,
    private readonly queue: QueueService,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Aplica PLAY. Si no hay item actual, selecciona el primero reproducible de
   * la cola de forma atómica. Establece el ancla temporal autoritativa.
   */
  async play(roomId: string, userId: string, positionMs?: number): Promise<TransitionResult> {
    return this.withLockedState(roomId, async (client, state) => {
      let queueItemId = state.current_queue_item_id;

      if (!queueItemId) {
        const next = await this.queue.findFirstPlayable(
          client,
          roomId,
          this.config.MAX_ITEM_RETRIES,
        );
        if (!next) {
          return await this.writeState(client, state, {
            status: "QUEUE_EMPTY",
            queueItemId: null,
            positionMs: 0,
            userId,
          });
        }
        queueItemId = next.id;
        await this.activateItem(client, roomId, next, state.current_queue_item_id);
        const anchorNext = positionMs ?? 0;
        return await this.writeState(client, state, {
          status: "PLAYING",
          queueItemId,
          positionMs: anchorNext,
          userId,
          sourceType: next.source_type,
        });
      }

      const anchor = positionMs ?? 0;
      return await this.writeState(client, state, {
        status: "PLAYING",
        queueItemId,
        positionMs: anchor,
        userId,
        sourceType: state.source_type,
      });
    });
  }

  async pause(roomId: string, userId: string, positionMs?: number): Promise<TransitionResult> {
    return this.withLockedState(roomId, async (client, state) => {
      if (!state.current_queue_item_id) {
        throw new AppError("CONFLICT", "No hay contenido para pausar.");
      }
      const anchor =
        positionMs !== undefined ? positionMs : this.estimatePosition(state);
      return await this.writeState(client, state, {
        status: "PAUSED",
        queueItemId: state.current_queue_item_id,
        positionMs: anchor,
        userId,
        sourceType: state.source_type,
      });
    });
  }

  async seek(roomId: string, userId: string, positionMs: number): Promise<TransitionResult> {
    return this.withLockedState(roomId, async (client, state) => {
      if (!state.current_queue_item_id) {
        throw new AppError("CONFLICT", "No hay contenido para posicionar.");
      }
      const keepPlaying = state.playback_status === "PLAYING";
      return await this.writeState(client, state, {
        status: keepPlaying ? "PLAYING" : "PAUSED",
        queueItemId: state.current_queue_item_id,
        positionMs,
        userId,
        sourceType: state.source_type,
      });
    });
  }

  /**
   * Avanza al siguiente elemento de forma ATÓMICA e IDEMPOTENTE.
   * `expectedCurrentItemId` evita dobles avances: si el item actual ya no
   * coincide con lo que el cliente cree, la transición se ignora.
   */
  async next(
    roomId: string,
    userId: string,
    options: {
      reason: "USER" | "ENDED" | "ERROR";
      expectedCurrentItemId?: string | null;
      failedQueueItemId?: string;
    },
  ): Promise<TransitionResult> {
    return this.withLockedState(roomId, async (client, state) => {
      if (
        options.expectedCurrentItemId !== undefined &&
        state.current_queue_item_id !== options.expectedCurrentItemId
      ) {
        this.logger.info(
          { roomId, expected: options.expectedCurrentItemId, actual: state.current_queue_item_id },
          "playback.next_stale_ignored",
        );
        const playback = await this.readState(client, roomId);
        return { playback, currentItem: null, transitioned: false };
      }

      const repeatMode = await this.getRepeatMode(client, roomId);
      const currentId = state.current_queue_item_id;
      let currentPosition = 0;

      if (currentId) {
        const item = await this.queue.getItem(roomId, currentId, client);
        if (item) {
          currentPosition = item.position;
          if (options.reason === "ERROR") {
            const terminal = item.retry_count + 1 > this.config.MAX_ITEM_RETRIES;
            await this.queue.markFailed(client, item.id, terminal);
          } else if (options.reason === "ENDED") {
            // Repetición de pista: se mantiene el mismo elemento y se reinicia.
            if (repeatMode === "ONE") {
              return await this.writeState(client, state, {
                status: "PLAYING",
                queueItemId: item.id,
                positionMs: 0,
                userId,
                sourceType: item.source_type,
              });
            }
            await this.queue.setStatus(client, item.id, "PLAYED");
          } else {
            await this.queue.setStatus(client, item.id, "SKIPPED");
          }
        }
      }

      let nextItem = await this.queue.findNextPlayable(
        client,
        roomId,
        currentPosition,
        this.config.MAX_ITEM_RETRIES,
      );

      // Repetición de cola: al llegar al final, se reinicia el ciclo.
      if (!nextItem && options.reason === "ENDED" && repeatMode === "ALL") {
        await this.queue.resetPlayed(client, roomId);
        nextItem = await this.queue.findFirstPlayable(
          client,
          roomId,
          this.config.MAX_ITEM_RETRIES,
        );
      }

      if (!nextItem) {
        return await this.writeState(client, state, {
          status: "QUEUE_EMPTY",
          queueItemId: null,
          positionMs: 0,
          userId,
          sourceType: state.source_type,
        });
      }

      await this.activateItem(client, roomId, nextItem, currentId);
      return await this.writeState(client, state, {
        status: "PLAYING",
        queueItemId: nextItem.id,
        positionMs: 0,
        userId,
        sourceType: nextItem.source_type,
      });
    });
  }

  /**
   * PLAYBACK_PREVIOUS: si la reproducción acaba de empezar (o no hay pista
   * anterior reproducible) reinicia la pista actual; en caso contrario salta a
   * la pista anterior reproducible. Conserva PAUSED si la sala estaba pausada.
   */
  async previous(roomId: string, userId: string): Promise<TransitionResult> {
    return this.withLockedState(roomId, async (client, state) => {
      const currentId = state.current_queue_item_id;
      if (!currentId) {
        throw new AppError("CONFLICT", "No hay contenido para retroceder.");
      }

      const keepStatus: PlaybackStatus =
        state.playback_status === "PAUSED" ? "PAUSED" : "PLAYING";

      const current = await this.queue.getItem(roomId, currentId, client);
      const justStarted =
        this.estimatePosition(state) <= PREVIOUS_RESTART_THRESHOLD_MS;
      const prevItem =
        current && !justStarted
          ? await this.queue.findPreviousPlayable(
              client,
              roomId,
              current.position,
              this.config.MAX_ITEM_RETRIES,
            )
          : null;

      if (!prevItem) {
        return await this.writeState(client, state, {
          status: keepStatus,
          queueItemId: currentId,
          positionMs: 0,
          userId,
          sourceType: state.source_type,
        });
      }

      await this.activateItem(client, roomId, prevItem, currentId);
      return await this.writeState(client, state, {
        status: keepStatus,
        queueItemId: prevItem.id,
        positionMs: 0,
        userId,
        sourceType: prevItem.source_type,
      });
    });
  }

  /**
   * Marca el elemento actual como UNAVAILABLE (contenido eliminado, privado o
   * no embebible) y avanza al siguiente de forma atómica. Solo debe invocarse
   * ante un error fatal confirmado por el reproductor local.
   */
  async reportUnavailable(
    roomId: string,
    userId: string,
    queueItemId: string,
  ): Promise<TransitionResult> {
    return this.withLockedState(roomId, async (client, state) => {
      if (state.current_queue_item_id !== queueItemId) {
        const playback = await this.readState(client, roomId);
        return { playback, currentItem: null, transitioned: false };
      }
      const item = await this.queue.getItem(roomId, queueItemId, client);
      if (item) await this.queue.markUnavailable(client, item.id);

      const currentPosition = item?.position ?? 0;
      const nextItem = await this.queue.findNextPlayable(
        client,
        roomId,
        currentPosition,
        this.config.MAX_ITEM_RETRIES,
      );

      if (!nextItem) {
        return await this.writeState(client, state, {
          status: "QUEUE_EMPTY",
          queueItemId: null,
          positionMs: 0,
          userId,
          sourceType: state.source_type,
        });
      }

      await this.activateItem(client, roomId, nextItem, queueItemId);
      return await this.writeState(client, state, {
        status: "PLAYING",
        queueItemId: nextItem.id,
        positionMs: 0,
        userId,
        sourceType: nextItem.source_type,
      });
    });
  }

  /** Lee el estado actual (sin bloqueo). */
  async getState(roomId: string): Promise<PlaybackState> {
    const res = await this.db.query<PlaybackStateRow>(
      "SELECT * FROM room_playback_state WHERE room_id = $1",
      [roomId],
    );
    const row = res.rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Estado de sala no encontrado.");
    return toPlaybackState(row);
  }

  /* ----------------------------- helpers ----------------------------- */

  private estimatePosition(state: PlaybackStateRow): number {
    const anchor = Number(state.anchor_position_ms);
    if (state.playback_status !== "PLAYING") return anchor;
    const elapsed = Date.now() - Number(state.anchor_server_time_ms);
    return Math.max(0, anchor + elapsed * state.playback_rate);
  }

  private async activateItem(
    client: PoolClient,
    roomId: string,
    item: QueueItemRow,
    previousId: string | null,
  ): Promise<void> {
    if (previousId && previousId !== item.id) {
      const prev = await this.queue.getItem(roomId, previousId, client);
      if (prev && prev.status === "CURRENT") {
        await this.queue.setStatus(client, prev.id, "PLAYED");
      }
    }
    await this.queue.setStatus(client, item.id, "CURRENT");
  }

  private async readState(
    client: PoolClient,
    roomId: string,
  ): Promise<PlaybackState> {
    const res = await client.query<PlaybackStateRow>(
      "SELECT * FROM room_playback_state WHERE room_id = $1",
      [roomId],
    );
    const row = res.rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Estado de sala no encontrado.");
    return toPlaybackState(row);
  }

  private async withLockedState<T>(
    roomId: string,
    fn: (client: PoolClient, state: PlaybackStateRow) => Promise<T>,
  ): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query<PlaybackStateRow>(
        "SELECT * FROM room_playback_state WHERE room_id = $1 FOR UPDATE",
        [roomId],
      );
      const state = res.rows[0];
      if (!state) throw new AppError("NOT_FOUND", "Estado de sala no encontrado.");
      const result = await fn(client, state);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async getRepeatMode(
    client: PoolClient,
    roomId: string,
  ): Promise<RepeatMode> {
    const res = await client.query<{ repeat_mode: RepeatMode }>(
      "SELECT repeat_mode FROM rooms WHERE id = $1",
      [roomId],
    );
    return res.rows[0]?.repeat_mode ?? "OFF";
  }

  private async writeState(
    client: PoolClient,
    current: PlaybackStateRow,
    next: {
      status: PlaybackStatus;
      queueItemId: string | null;
      positionMs: number;
      userId: string;
      sourceType?: SourceType;
    },
  ): Promise<TransitionResult> {
    const serverNow = Date.now();
    const res = await client.query<PlaybackStateRow>(
      `UPDATE room_playback_state
       SET source_type = $2,
           current_queue_item_id = $3,
           playback_status = $4,
           anchor_position_ms = $5,
           anchor_server_time_ms = $6,
           version = version + 1,
           updated_by = $7,
           updated_at = now()
       WHERE room_id = $1
       RETURNING *`,
      [
        current.room_id,
        next.sourceType ?? current.source_type,
        next.queueItemId,
        next.status,
        Math.round(next.positionMs),
        serverNow,
        next.userId,
      ],
    );
    const row = res.rows[0];
    if (!row) throw new AppError("INTERNAL_ERROR", "No se pudo actualizar el estado.");
    const playback = toPlaybackState(row);

    let currentItem: QueueItem | null = null;
    if (next.queueItemId) {
      const item = await this.queue.getItem(row.room_id, next.queueItemId, client);
      if (item) {
        const nameRes = await client.query<{ display_name: string | null }>(
          "SELECT display_name FROM users WHERE id = $1",
          [item.added_by],
        );
        currentItem = toQueueItem(item, nameRes.rows[0]?.display_name ?? null);
      }
    }

    this.logger.debug(
      { roomId: row.room_id, version: playback.version, status: playback.playbackStatus },
      "playback.updated",
    );

    return { playback, currentItem, transitioned: true };
  }
}
