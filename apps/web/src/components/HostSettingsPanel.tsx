import { useCallback, useEffect, useState } from "react";
import type { ControlMode, InviteSummary, RepeatMode } from "@play/shared";
import type { RoomDetail } from "../api/api-client.js";
import { ApiClientError } from "../api/api-client.js";
import { useAuth } from "../auth/auth-context.js";
import { useNavigate } from "react-router-dom";
import { qrToDataUrl } from "../qr/qr-code.js";

export function HostSettingsPanel({
  roomId,
  detail,
  onUpdated,
}: {
  roomId: string;
  detail: RoomDetail;
  onUpdated: (d: RoomDetail) => void;
}) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [roomName, setRoomName] = useState(detail.room.name);
  const [privacyMode, setPrivacyMode] = useState(detail.room.privacyMode);
  const [nonstop, setNonstop] = useState(detail.room.nonstopEnabled);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(detail.room.repeatMode);
  const [maxParticipants, setMaxParticipants] = useState(detail.room.maxParticipants);
  const [controlMode, setControlMode] = useState<ControlMode>(detail.room.controlMode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);

  const perms = detail.permissions;

  const loadInvites = useCallback(async () => {
    if (!perms.canManageInvites) return;
    try {
      const { invites: list } = await api.listInvites(roomId);
      setInvites(list);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "No se pudieron cargar invitaciones.");
    }
  }, [api, roomId, perms.canManageInvites]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  async function saveSettings() {
    setBusy(true);
    setError(null);
    try {
      await api.updateRoom(roomId, {
        name: roomName,
        privacyMode,
        nonstopEnabled: nonstop,
        repeatMode,
        maxParticipants,
        controlMode,
      });
      const fresh = await api.getRoom(roomId);
      onUpdated(fresh);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function closeRoom() {
    if (!window.confirm("¿Cerrar la sala? Se desconectará a todos los participantes.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.closeRoom(roomId);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "No se pudo cerrar la sala.");
      setBusy(false);
    }
  }

  async function deleteRoom() {
    if (!window.confirm("¿Eliminar la sala de forma permanente? Esta acción no se puede deshacer.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteRoom(roomId);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "No se pudo eliminar la sala.");
      setBusy(false);
    }
  }

  async function createInvite() {
    setError(null);
    try {
      const { invite } = await api.createInvite(roomId);
      setInvites((prev) => [invite, ...prev]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "No se pudo crear la invitación.");
    }
  }

  async function revoke(inviteId: string) {
    try {
      await api.revokeInvite(roomId, inviteId);
      setInvites((prev) =>
        prev.map((i) => (i.id === inviteId ? { ...i, revokedAt: new Date().toISOString() } : i)),
      );
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "No se pudo revocar.");
    }
  }

  /**
   * Asegura que el enlace de invitación es absoluto. Si el servidor devolvió
   * una ruta relativa (`/join/<token>`), la completa con el origen actual.
   */
  function absoluteJoinUrl(joinUrl: string): string {
    if (/^https?:\/\//i.test(joinUrl)) return joinUrl;
    return `${window.location.origin}${joinUrl.startsWith("/") ? "" : "/"}${joinUrl}`;
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("No se pudo copiar al portapapeles.");
    }
  }

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Ajustes del anfitrión</h2>

      {perms.canManageRoom && (
        <div className="stack">
          <div>
            <label htmlFor="roomNameSetting">Nombre de la sala</label>
            <input
              id="roomNameSetting"
              type="text"
              maxLength={80}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="privacyModeSetting">Privacidad</label>
            <select
              id="privacyModeSetting"
              value={privacyMode}
              onChange={(e) => setPrivacyMode(e.target.value as typeof privacyMode)}
            >
              <option value="PRIVATE">Privada (solo con invitación)</option>
              <option value="UNLISTED">No listada (con enlace)</option>
            </select>
          </div>
          <div>
            <label htmlFor="controlModeSetting">Modo de control</label>
            <select
              id="controlModeSetting"
              value={controlMode}
              onChange={(e) => setControlMode(e.target.value as ControlMode)}
            >
              <option value="HOST_ONLY">Solo el anfitrión controla</option>
              <option value="COLLABORATIVE">Colaborativo</option>
              <option value="COLLABORATIVE_QUEUE_HOST_PLAYBACK">
                Cola colaborativa, reproducción restringida
              </option>
            </select>
          </div>
          <div>
            <label htmlFor="repeatModeSetting">Modo de repetición</label>
            <select
              id="repeatModeSetting"
              value={repeatMode}
              onChange={(e) => setRepeatMode(e.target.value as RepeatMode)}
            >
              <option value="OFF">Sin repetición</option>
              <option value="ALL">Repetir cola</option>
              <option value="ONE">Repetir pista actual</option>
            </select>
          </div>
          <div>
            <label htmlFor="maxParticipantsSetting">Máx. participantes</label>
            <input
              id="maxParticipantsSetting"
              type="number"
              min={2}
              max={200}
              value={maxParticipants}
              onChange={(e) => setMaxParticipants(Number(e.target.value))}
            />
          </div>
          <label className="row">
            <input
              type="checkbox"
              checked={nonstop}
              onChange={(e) => setNonstop(e.target.checked)}
              style={{ width: "auto" }}
            />
            <span>Reproducción continua (non-stop)</span>
          </label>
          <button onClick={saveSettings} disabled={busy}>
            {busy ? "Guardando…" : "Guardar ajustes"}
          </button>
          <div className="row" style={{ gap: 8 }}>
            <button className="secondary" onClick={closeRoom} disabled={busy}>
              Cerrar sala
            </button>
            <button className="danger" onClick={deleteRoom} disabled={busy}>
              Eliminar sala
            </button>
          </div>
        </div>
      )}

      {perms.canManageInvites && (
        <div className="stack">
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Invitaciones</h3>
            <button className="secondary btn-sm" onClick={createInvite}>
              Crear enlace
            </button>
          </div>
          {invites.length === 0 && <p className="small muted">Sin invitaciones activas.</p>}
          <ul className="list">
            {invites.map((inv) => {
              const revoked = inv.revokedAt !== null;
              const url = inv.joinUrl ? absoluteJoinUrl(inv.joinUrl) : null;
              const showQr = qrFor === inv.id;
              return (
                <li key={inv.id} className="list-item">
                  <div className="grow">
                    <div className="truncate small">
                      {url ?? `token: ${inv.token ?? inv.id.slice(0, 8)}…`}
                    </div>
                    <div className="small muted">
                      {revoked
                        ? "Revocada"
                        : `Caduca: ${new Date(inv.expiresAt).toLocaleString()}`}
                    </div>
                    {showQr && url && (
                      <div className="qr-box">
                        <img
                          src={qrToDataUrl(url)}
                          alt="Código QR para unirse a la sala"
                          width={180}
                          height={180}
                        />
                        <p className="small muted" style={{ margin: 0 }}>
                          Escanéalo con la cámara para unirte.
                        </p>
                      </div>
                    )}
                  </div>
                  {!revoked && url && (
                    <>
                      <button
                        className="ghost btn-sm"
                        onClick={() => setQrFor(showQr ? null : inv.id)}
                        aria-expanded={showQr}
                      >
                        {showQr ? "Ocultar QR" : "Ver QR"}
                      </button>
                      <button className="ghost btn-sm" onClick={() => copy(url, inv.id)}>
                        {copied === inv.id ? "Copiado" : "Copiar"}
                      </button>
                    </>
                  )}
                  {!revoked && (
                    <button className="ghost btn-sm" onClick={() => revoke(inv.id)}>
                      Revocar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
