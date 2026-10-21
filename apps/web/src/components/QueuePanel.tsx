import { useState, type FormEvent } from "react";
import type { UseRoomResult } from "../realtime/use-room.js";

export function QueuePanel({ room }: { room: UseRoomResult }) {
  const { client, state } = room;
  const snapshot = state.snapshot;
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  if (!snapshot) return null;

  const perms = snapshot.you.permissions;
  const canAdd = perms.canAddToQueue && snapshot.room.status === "OPEN";
  const currentId = snapshot.playback.currentQueueItemId;

  function addItem(e: FormEvent) {
    e.preventDefault();
    if (!client || !url.trim()) return;
    client.addQueueItem(snapshot!.room.id, url.trim(), title.trim() || undefined);
    setUrl("");
    setTitle("");
  }

  function move(itemId: string, delta: number) {
    const item = snapshot!.queue.find((q) => q.id === itemId);
    if (!item || !client) return;
    const to = item.position + delta;
    if (to < 0 || to >= snapshot!.queue.length) return;
    client.moveQueueItem(snapshot!.room.id, itemId, to);
  }

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Cola ({snapshot.queue.length})</h2>

      {canAdd && (
        <form className="stack" onSubmit={addItem}>
          <div>
            <label htmlFor="queueUrl">Enlace de YouTube</label>
            <input
              id="queueUrl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              inputMode="url"
            />
          </div>
          <div>
            <label htmlFor="queueTitle">Título (opcional)</label>
            <input
              id="queueTitle"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <button type="submit" disabled={url.trim().length === 0}>
            Añadir a la cola
          </button>
        </form>
      )}

      {snapshot.queue.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          La cola está vacía.
        </p>
      )}

      <ul className="list">
        {snapshot.queue.map((item, index) => {
          const isCurrent = item.id === currentId;
          return (
            <li key={item.id} className={`list-item ${isCurrent ? "current" : ""}`}>
              <span className="muted small" style={{ width: 20, textAlign: "right" }}>
                {index + 1}
              </span>
              <div className="grow">
                <div className="truncate">{item.title ?? item.externalContentId}</div>
                <div className="small muted">
                  {isCurrent ? "Reproduciendo" : item.status} ·{" "}
                  {item.addedByDisplayName ?? "—"}
                </div>
              </div>
              {perms.canReorderQueue && !isCurrent && (
                <div className="row" style={{ gap: 4 }}>
                  <button
                    className="ghost btn-sm"
                    aria-label="Subir"
                    onClick={() => move(item.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="ghost btn-sm"
                    aria-label="Bajar"
                    onClick={() => move(item.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              )}
              {perms.canRemoveFromQueue && !isCurrent && (
                <button
                  className="ghost btn-sm"
                  aria-label="Quitar"
                  onClick={() => client?.removeQueueItem(snapshot.room.id, item.id)}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
