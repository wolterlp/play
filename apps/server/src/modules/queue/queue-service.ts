import type { QueueItem } from "@play/shared";
import { parseYouTubeUrl } from "@play/shared";
import type { Database } from "../../db/pool.js";
import type { PoolClient } from "pg";
import type { QueueItemRow } from "../../db/rows.js";
import { toQueueItem } from "../../db/mappers.js";
import { AppError } from "../../errors.js";

export class QueueService {
  constructor(private readonly db: Database) {}

  async list(roomId: string): Promise<QueueItem[]> {
    const res = await this.db.query<QueueItemRow & { display_name: string | null }>(
      `SELECT qi.*, u.display_name
       FROM queue_items qi
       LEFT JOIN users u ON u.id = qi.added_by
       WHERE qi.room_id = $1
       ORDER BY qi.position ASC, qi.created_at ASC
       LIMIT 500`,
      [roomId],
    );
    return res.rows.map((row) => toQueueItem(row, row.display_name));
  }

  /** Añade un elemento validando la URL localmente (sin scraping ni API). */
  async addItem(
    roomId: string,
    userId: string,
    sourceUrl: string,
    title: string | null,
  ): Promise<QueueItem> {
    const parsed = parseYouTubeUrl(sourceUrl);
    if (!parsed) {
      throw new AppError(
        "INVALID_SOURCE_URL",
        "El enlace no es una URL de YouTube válida.",
      );
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM rooms WHERE id = $1 FOR UPDATE",
        [roomId],
      );

      const maxRes = await client.query<{ max: number | null }>(
        "SELECT MAX(position) AS max FROM queue_items WHERE room_id = $1",
        [roomId],
      );
      const nextPosition = (maxRes.rows[0]?.max ?? -1) + 1;

      const inserted = await client.query<QueueItemRow>(
        `INSERT INTO queue_items
           (room_id, position, source_type, source_url, external_content_id, title, added_by)
         VALUES ($1, $2, 'YOUTUBE', $3, $4, $5, $6)
         RETURNING *`,
        [roomId, nextPosition, parsed.canonicalUrl, parsed.videoId, title, userId],
      );
      const row = inserted.rows[0];
      if (!row) throw new AppError("INTERNAL_ERROR", "No se pudo agregar el elemento.");

      // Si la sala está en QUEUE_EMPTY/IDLE sin item actual, este pasa a PENDING
      // y el estado global se mantiene hasta que un usuario autorizado reproduzca.
      await client.query("COMMIT");

      const withName = await this.db.query<{ display_name: string | null }>(
        "SELECT display_name FROM users WHERE id = $1",
        [userId],
      );
      return toQueueItem(row, withName.rows[0]?.display_name ?? null);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async removeItem(roomId: string, queueItemId: string): Promise<void> {
    const item = await this.getItem(roomId, queueItemId);
    if (!item) throw new AppError("NOT_FOUND", "Elemento no encontrado.");
    if (item.status === "CURRENT") {
      throw new AppError("CONFLICT", "No se puede eliminar el elemento en reproducción.");
    }
    await this.db.query("DELETE FROM queue_items WHERE id = $1 AND room_id = $2", [
      queueItemId,
      roomId,
    ]);
    await this.compactPositions(roomId);
  }

  async moveItem(
    roomId: string,
    queueItemId: string,
    toPosition: number,
  ): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const items = await client.query<QueueItemRow>(
        `SELECT * FROM queue_items WHERE room_id = $1 ORDER BY position ASC FOR UPDATE`,
        [roomId],
      );
      const rows = items.rows;
      const fromIndex = rows.findIndex((r) => r.id === queueItemId);
      if (fromIndex === -1) {
        throw new AppError("NOT_FOUND", "Elemento no encontrado.");
      }
      if (rows[fromIndex]?.status === "CURRENT") {
        throw new AppError("CONFLICT", "No se puede reordenar el elemento en reproducción.");
      }
      const clamped = Math.max(0, Math.min(toPosition, rows.length - 1));
      const [moved] = rows.splice(fromIndex, 1);
      if (!moved) throw new AppError("INTERNAL_ERROR", "Error al reordenar.");
      rows.splice(clamped, 0, moved);

      for (let i = 0; i < rows.length; i++) {
        await client.query(
          "UPDATE queue_items SET position = $1, updated_at = now() WHERE id = $2",
          [i, rows[i]?.id],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getItem(
    roomId: string,
    queueItemId: string,
    client?: PoolClient,
  ): Promise<QueueItemRow | null> {
    const runner = client ?? this.db;
    const res = await runner.query<QueueItemRow>(
      "SELECT * FROM queue_items WHERE id = $1 AND room_id = $2",
      [queueItemId, roomId],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Selecciona el siguiente elemento reproducible: el primer PENDING/SKIPPED
   * con reintentos disponibles, posterior a `afterPosition`. Excluye los
   * marcados como PLAYED, FAILED (sin reintentos), UNAVAILABLE y CURRENT.
   * Debe llamarse dentro de una transacción con la sala bloqueada.
   */
  async findNextPlayable(
    client: PoolClient,
    roomId: string,
    afterPosition: number,
    maxRetries: number,
  ): Promise<QueueItemRow | null> {
    const res = await client.query<QueueItemRow>(
      `SELECT * FROM queue_items
       WHERE room_id = $1
         AND position > $2
         AND status IN ('PENDING','SKIPPED')
         AND retry_count <= $3
       ORDER BY position ASC
       LIMIT 1`,
      [roomId, afterPosition, maxRetries],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Selecciona el elemento reproducible anterior a `beforePosition`: el de
   * mayor posición por debajo de `beforePosition` que siga en estado
   * PLAYED/SKIPPED/PENDING con reintentos disponibles.
   * Debe llamarse dentro de una transacción con la sala bloqueada.
   */
  async findPreviousPlayable(
    client: PoolClient,
    roomId: string,
    beforePosition: number,
    maxRetries: number,
  ): Promise<QueueItemRow | null> {
    const res = await client.query<QueueItemRow>(
      `SELECT * FROM queue_items
       WHERE room_id = $1
         AND position < $2
         AND status IN ('PLAYED','SKIPPED','PENDING')
         AND retry_count <= $3
       ORDER BY position DESC
       LIMIT 1`,
      [roomId, beforePosition, maxRetries],
    );
    return res.rows[0] ?? null;
  }

  async findFirstPlayable(
    client: PoolClient,
    roomId: string,
    maxRetries: number,
  ): Promise<QueueItemRow | null> {
    const res = await client.query<QueueItemRow>(
      `SELECT * FROM queue_items
       WHERE room_id = $1
         AND status IN ('PENDING','SKIPPED')
         AND retry_count <= $2
       ORDER BY position ASC
       LIMIT 1`,
      [roomId, maxRetries],
    );
    return res.rows[0] ?? null;
  }

  async setStatus(
    client: PoolClient,
    queueItemId: string,
    status: QueueItemRow["status"],
  ): Promise<void> {
    await client.query(
      "UPDATE queue_items SET status = $1, updated_at = now() WHERE id = $2",
      [status, queueItemId],
    );
  }

  async markFailed(client: PoolClient, queueItemId: string, terminal: boolean): Promise<void> {
    await client.query(
      `UPDATE queue_items
       SET retry_count = retry_count + 1,
           status = $2,
           updated_at = now()
       WHERE id = $1`,
      [queueItemId, terminal ? "FAILED" : "SKIPPED"],
    );
  }

  /** Marca un elemento como no disponible (contenido eliminado/privado). */
  async markUnavailable(client: PoolClient, queueItemId: string): Promise<void> {
    await client.query(
      `UPDATE queue_items SET status = 'UNAVAILABLE', updated_at = now() WHERE id = $1`,
      [queueItemId],
    );
  }

  /**
   * Política de repetición ALL: al terminar la cola, vuelve a dejar como
   * PENDING los elementos ya reproducidos/saltados para reiniciar el ciclo.
   * Los FAILED se conservan para no entrar en un bucle de contenido roto.
   */
  async resetPlayed(client: PoolClient, roomId: string): Promise<void> {
    await client.query(
      `UPDATE queue_items
       SET status = 'PENDING', updated_at = now()
       WHERE room_id = $1 AND status IN ('PLAYED','SKIPPED','UNAVAILABLE')`,
      [roomId],
    );
  }

  private async compactPositions(roomId: string): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<QueueItemRow>(
        "SELECT id FROM queue_items WHERE room_id = $1 ORDER BY position ASC",
        [roomId],
      );
      for (let i = 0; i < rows.rows.length; i++) {
        await client.query(
          "UPDATE queue_items SET position = $1 WHERE id = $2",
          [i, rows.rows[i]?.id],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
