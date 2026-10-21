import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { RoomListItem } from "@play/shared";
import { useAuth } from "../auth/auth-context.js";
import { ApiClientError } from "../api/api-client.js";

export function HomePage() {
  const { status, user, api, logout } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (status === "anonymous") {
      navigate("/login", { replace: true });
      return;
    }
    if (status !== "authenticated") return;
    let active = true;
    (async () => {
      try {
        const { rooms: list } = await api.listRooms();
        if (active) setRooms(list);
      } catch (err) {
        if (active) setError(err instanceof ApiClientError ? err.message : "Error al cargar.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [status, api, navigate]);

  return (
    <div className="container">
      <header className="row-between">
        <div>
          <h1>Play</h1>
          <p className="muted small">Hola, {user?.displayName}</p>
        </div>
        <div className="row">
          <button
            className="ghost btn-sm"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          >
            Salir
          </button>
          <button onClick={() => setCreating(true)}>Crear sala</button>
        </div>
      </header>

      {creating && <CreateRoomForm onClose={() => setCreating(false)} />}

      <section className="stack" style={{ marginTop: 24 }}>
        <h2>Mis salas</h2>
        {loading && <p className="muted">Cargando salas…</p>}
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {!loading && rooms.length === 0 && (
          <div className="card">
            <p className="muted">Todavía no tienes salas. Crea una para empezar.</p>
          </div>
        )}
        <ul className="list">
          {rooms.map((room) => (
            <li key={room.id} className="list-item">
              <div className="grow">
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <strong className="truncate">{room.name}</strong>
                  <span className="badge">{room.controlMode}</span>
                  {room.status !== "OPEN" && <span className="badge warn">{room.status}</span>}
                </div>
                <div className="small muted">
                  {room.participantCount} participante(s) · rol: {room.role}
                </div>
              </div>
              <Link to={`/room/${room.id}`}>
                <button className="secondary btn-sm">Abrir</button>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function CreateRoomForm({ onClose }: { onClose: () => void }) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [controlMode, setControlMode] = useState("COLLABORATIVE");
  const [privacyMode, setPrivacyMode] = useState("PRIVATE");
  const [nonstopEnabled, setNonstopEnabled] = useState(true);
  const [maxParticipants, setMaxParticipants] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { room } = await api.createRoom({
        name,
        controlMode,
        privacyMode,
        nonstopEnabled,
        maxParticipants,
      });
      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "No se pudo crear la sala.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ marginTop: 16 }}>
      <h2>Nueva sala</h2>
      <div>
        <label htmlFor="roomName">Nombre</label>
        <input
          id="roomName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
      </div>
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="grow">
          <label htmlFor="controlMode">Modo de control</label>
          <select
            id="controlMode"
            value={controlMode}
            onChange={(e) => setControlMode(e.target.value)}
          >
            <option value="HOST_ONLY">Solo el anfitrión controla</option>
            <option value="COLLABORATIVE">Colaborativo</option>
            <option value="COLLABORATIVE_QUEUE_HOST_PLAYBACK">
              Cola colaborativa, reproducción restringida
            </option>
          </select>
        </div>
        <div className="grow">
          <label htmlFor="privacyMode">Privacidad</label>
          <select
            id="privacyMode"
            value={privacyMode}
            onChange={(e) => setPrivacyMode(e.target.value)}
          >
            <option value="PRIVATE">Privada</option>
            <option value="UNLISTED">No listada</option>
          </select>
        </div>
      </div>
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="grow">
          <label htmlFor="maxParticipants">Máx. participantes</label>
          <input
            id="maxParticipants"
            type="number"
            min={2}
            max={200}
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(Number(e.target.value))}
          />
        </div>
        <label className="row" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={nonstopEnabled}
            onChange={(e) => setNonstopEnabled(e.target.checked)}
            style={{ width: "auto" }}
          />
          <span>Reproducción continua (non-stop)</span>
        </label>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div className="row">
        <button onClick={submit} disabled={busy || name.trim().length === 0}>
          {busy ? "Creando…" : "Crear"}
        </button>
        <button className="ghost" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
