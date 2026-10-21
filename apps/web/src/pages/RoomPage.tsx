import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RoomDetail } from "../api/api-client.js";
import { useAuth } from "../auth/auth-context.js";
import { ApiClientError } from "../api/api-client.js";
import { useRoom } from "../realtime/use-room.js";
import { PlayerPanel } from "../components/PlayerPanel.js";
import { QueuePanel } from "../components/QueuePanel.js";
import { MembersPanel } from "../components/MembersPanel.js";
import { LocalVolumeControl } from "../components/LocalVolumeControl.js";
import { HostSettingsPanel } from "../components/HostSettingsPanel.js";
import type { ConnectionStatus } from "../realtime/room-client.js";

export function RoomPage() {
  const { roomId = "" } = useParams();
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = useCallback(() => api.getToken(), [api]);
  const room = useRoom({ roomId, getAccessToken });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.getRoom(roomId);
        if (active) setDetail(d);
      } catch (err) {
        if (active) {
          setError(
            err instanceof ApiClientError ? err.message : "No se pudo cargar la sala.",
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [api, roomId]);

  if (error) {
    return (
      <div className="container" style={{ maxWidth: 520 }}>
        <div className="alert error" role="alert">
          <strong>No se pudo abrir la sala.</strong>
          <p className="small">{error}</p>
          <button className="secondary" onClick={() => navigate("/")}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  const snapshot = room.state.snapshot;
  const roomClosed = snapshot?.room.status === "CLOSED";

  return (
    <div className="container">
      <header className="row-between" style={{ marginBottom: 16 }}>
        <div className="grow">
          <h1 className="truncate">{snapshot?.room.name ?? "Sala"}</h1>
          <div className="row small muted" style={{ flexWrap: "wrap" }}>
            <ConnectionBadge connection={room.state.connection} />
            {snapshot && <span className="badge">{snapshot.you.role}</span>}
            {snapshot && (
              <span className="badge">
                {snapshot.room.nonstopEnabled ? "Non-stop activo" : "Non-stop desactivado"}
              </span>
            )}
            {room.state.driftMs !== null && (
              <span className="badge">deriva ≈ {Math.round(room.state.driftMs)} ms</span>
            )}
            {room.state.latencyMs !== null && (
              <span className="badge">latencia ≈ {Math.round(room.state.latencyMs)} ms</span>
            )}
          </div>
        </div>
        <button
          className="ghost btn-sm"
          onClick={() => {
            if (snapshot && room.client) room.client.leave(snapshot.room.id);
            navigate("/");
          }}
        >
          Salir
        </button>
      </header>

      {roomClosed && (
        <div className="alert warn" role="alert" style={{ marginBottom: 16 }}>
          {room.state.roomClosed?.reason === "HOST_GRACE_EXPIRED"
            ? "La sala se cerró porque el anfitrión no regresó a tiempo."
            : room.state.roomClosed?.reason === "HOST_DELETED"
              ? "El anfitrión eliminó esta sala."
              : "La sala está cerrada. No se pueden realizar cambios."}
        </div>
      )}

      {snapshot?.room.status === "SUSPENDED" && (
        <div className="alert warn" role="alert" style={{ marginBottom: 16 }}>
          El anfitrión se desconectó. La sala se conservará durante una ventana de gracia.
        </div>
      )}

      {room.playerActionMessage && (
        <div className="alert warn" role="alert" style={{ marginBottom: 16 }}>
          <div className="row-between">
            <span>{room.playerActionMessage}</span>
            <button className="ghost btn-sm" onClick={room.clearPlayerAction}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-room">
        <div className="stack">
          <PlayerPanel room={room} />
          <QueuePanel room={room} />
        </div>
        <div className="stack">
          <LocalVolumeControl room={room} />
          <MembersPanel room={room} currentUserId={user?.id ?? ""} />
          {detail?.permissions.canManageRoom && (
            <HostSettingsPanel roomId={roomId} detail={detail} onUpdated={setDetail} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionBadge({ connection }: { connection: ConnectionStatus | string }) {
  const map: Record<string, { label: string; cls: string }> = {
    connected: { label: "Conectado", cls: "live" },
    connecting: { label: "Conectando…", cls: "" },
    reconnecting: { label: "Reconectando…", cls: "warn" },
    disconnected: { label: "Desconectado", cls: "error" },
  };
  const info = map[connection] ?? map.disconnected!;
  return (
    <span className={`badge ${info.cls}`}>
      <span className="sr-only">Estado de conexión: </span>
      {info.label}
    </span>
  );
}
