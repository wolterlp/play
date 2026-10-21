import { useEffect, useRef, useState } from "react";
import type { UseRoomResult } from "../realtime/use-room.js";

export function PlayerPanel({ room }: { room: UseRoomResult }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const attachedRef = useRef(false);
  const { attachPlayer, state, client } = room;
  const snapshot = state.snapshot;
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  useEffect(() => {
    if (attachedRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    attachedRef.current = true;
    attachPlayer(el);
  }, [attachPlayer]);

  const currentItem = snapshot?.queue.find(
    (q) => q.id === snapshot.playback.currentQueueItemId,
  );

  const canControl = snapshot?.you.permissions.canControlPlayback ?? false;
  const isPlaying = snapshot?.playback.playbackStatus === "PLAYING";
  const showGesture = state.needsGesture || state.playerStatus === "needs-gesture";

  const positionMs = scrubMs ?? state.positionMs;
  const durationMs = state.durationMs;
  const canSeek = canControl && snapshot !== null && durationMs !== null && durationMs > 0;

  const commitScrub = () => {
    if (scrubMs === null || !snapshot) return;
    client?.seek(snapshot.room.id, scrubMs);
    setScrubMs(null);
  };

  return (
    <section className="card stack">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Reproductor</h2>
        <PlayerStatusBadge status={state.playerStatus} />
      </div>

      <div className="player-frame">
        <div ref={containerRef} />
        {showGesture && (
          <div className="player-overlay">
            <div className="stack" style={{ alignItems: "center" }}>
              <p style={{ margin: 0 }}>
                Tu navegador requiere una interacción para reproducir audio.
              </p>
              <button
                onClick={() => {
                  void room.resumeLocalPlayback();
                }}
              >
                ▶ Reproducir aquí
              </button>
            </div>
          </div>
        )}
        {!currentItem && !showGesture && (
          <div className="player-overlay">
            <p className="muted" style={{ margin: 0 }}>
              No hay nada reproduciéndose. Añade una pista a la cola.
            </p>
          </div>
        )}
      </div>

      {currentItem && (
        <div>
          <h3 className="truncate" style={{ marginBottom: 2 }}>
            {currentItem.title ?? currentItem.externalContentId}
          </h3>
          <p className="small muted" style={{ margin: 0 }}>
            Añadido por {currentItem.addedByDisplayName ?? "alguien"}
          </p>
        </div>
      )}

      {currentItem && durationMs !== null && durationMs > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted" style={{ minWidth: 40, textAlign: "right" }}>
            {formatTime(positionMs)}
          </span>
          <input
            className="grow"
            type="range"
            min={0}
            max={durationMs}
            step={1000}
            value={positionMs ?? 0}
            disabled={!canSeek}
            aria-label="Posición de reproducción"
            onChange={(e) => setScrubMs(Number(e.target.value))}
            onPointerUp={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
          />
          <span className="small muted" style={{ minWidth: 40 }}>
            {formatTime(durationMs)}
          </span>
        </div>
      )}

      {state.lastNonstopTransition && snapshot?.room.nonstopEnabled && (
        <p className="small muted" style={{ margin: 0 }}>
          Non-stop: la sala avanzó automáticamente a la siguiente pista.
        </p>
      )}

      {state.playerError && (
        <div className="alert error" role="alert">
          {state.playerError}
        </div>
      )}

      <div className="row" style={{ flexWrap: "wrap" }}>
        {canControl ? (
          <>
            <button
              className="secondary"
              disabled={!snapshot}
              onClick={() => {
                if (!client || !snapshot) return;
                if (isPlaying) client.pause(snapshot.room.id);
                else client.play(snapshot.room.id);
              }}
            >
              {isPlaying ? "⏸ Pausar" : "▶ Reproducir"}
            </button>
            <button
              className="secondary"
              disabled={!snapshot}
              onClick={() => {
                if (client && snapshot) client.previous(snapshot.room.id);
              }}
            >
              ⏮ Anterior
            </button>
            <button
              className="secondary"
              disabled={!snapshot}
              onClick={() => {
                if (client && snapshot) client.next(snapshot.room.id, "USER");
              }}
            >
              ⏭ Siguiente
            </button>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            No tienes permiso para controlar la reproducción en esta sala.
          </p>
        )}
      </div>
    </section>
  );
}

function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function PlayerStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    playing: { label: "Reproduciendo", cls: "live" },
    paused: { label: "En pausa", cls: "" },
    buffering: { label: "Cargando…", cls: "warn" },
    loading: { label: "Cargando…", cls: "warn" },
    error: { label: "Error", cls: "error" },
    "needs-gesture": { label: "Requiere interacción", cls: "warn" },
    "queue-empty": { label: "Cola vacía", cls: "" },
    idle: { label: "Inactivo", cls: "" },
  };
  const info = map[status] ?? map.idle!;
  return <span className={`badge ${info.cls}`}>{info.label}</span>;
}
