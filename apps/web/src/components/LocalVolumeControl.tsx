import type { UseRoomResult } from "../realtime/use-room.js";

/**
 * Control de volumen EXCLUSIVAMENTE LOCAL. Nunca se envía al servidor ni
 * afecta a otros participantes (criterio de aceptación CA-01).
 */
export function LocalVolumeControl({ room }: { room: UseRoomResult }) {
  const { localAudio, setVolume, toggleMute } = room;

  return (
    <section className="card stack">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Volumen</h2>
        <span className="badge" title="Este ajuste solo afecta a tu dispositivo">
          Solo este dispositivo
        </span>
      </div>

      <div className="row">
        <button
          className="ghost"
          aria-label={localAudio.muted ? "Activar sonido" : "Silenciar"}
          onClick={toggleMute}
        >
          {localAudio.muted ? "🔇" : "🔊"}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={localAudio.volume}
          aria-label="Volumen local"
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span className="small muted" style={{ width: 42, textAlign: "right" }}>
          {localAudio.volume}%
        </span>
      </div>

      <div className="volume-meter" aria-hidden>
        <span style={{ width: `${localAudio.muted ? 0 : localAudio.volume}%` }} />
      </div>

      <p className="small muted" style={{ margin: 0 }}>
        El volumen y el silencio son locales: no se sincronizan con la sala.
      </p>
    </section>
  );
}
