import { ROLES } from "@play/shared";
import { useAuth } from "../auth/auth-context.js";
import { ApiClientError } from "../api/api-client.js";
import type { UseRoomResult } from "../realtime/use-room.js";

export function MembersPanel({
  room,
  currentUserId,
}: {
  room: UseRoomResult;
  currentUserId: string;
}) {
  const { api } = useAuth();
  const snapshot = room.state.snapshot;
  if (!snapshot) return null;

  const perms = snapshot.you.permissions;

  async function setRole(userId: string, role: string) {
    try {
      await api.setMemberRole(snapshot!.room.id, userId, role);
    } catch (err) {
      // El servidor reemitirá el snapshot; el error es informativo.
      console.error(err instanceof ApiClientError ? err.message : err);
    }
  }

  async function remove(userId: string) {
    try {
      await api.removeMember(snapshot!.room.id, userId);
    } catch (err) {
      console.error(err instanceof ApiClientError ? err.message : err);
    }
  }

  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Participantes ({snapshot.members.length})</h2>
      <ul className="list">
        {snapshot.members.map((m) => {
          const isSelf = m.userId === currentUserId;
          return (
            <li key={m.userId} className="list-item">
              <span
                className={`badge ${m.connectionState === "CONNECTED" ? "live" : ""}`}
                aria-hidden
                style={{ padding: "2px 6px" }}
              >
                {m.connectionState === "CONNECTED"
                  ? "●"
                  : m.connectionState === "RECONNECTING"
                    ? "◐"
                    : "○"}
              </span>
              <div className="grow">
                <div className="truncate">
                  {m.displayName}
                  {isSelf && <span className="muted small"> (tú)</span>}
                </div>
                <div className="small muted">{m.role}</div>
              </div>
              {perms.canManageMembers && !isSelf && (
                <div className="row" style={{ gap: 4 }}>
                  <select
                    aria-label={`Rol de ${m.displayName}`}
                    value={m.role}
                    onChange={(e) => setRole(m.userId, e.target.value)}
                    style={{ width: "auto" }}
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <button
                    className="ghost btn-sm"
                    aria-label={`Expulsar a ${m.displayName}`}
                    onClick={() => remove(m.userId)}
                  >
                    ✕
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
