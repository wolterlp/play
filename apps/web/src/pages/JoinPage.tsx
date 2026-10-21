import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/auth-context.js";
import { ApiClientError } from "../api/api-client.js";

export function JoinPage() {
  const { token = "" } = useParams();
  const { api, status } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "valid" | "invalid">("loading");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { roomId } = await api.previewInvite(token);
        if (!active) return;
        setState("valid");
        if (status === "authenticated") {
          await api.joinByInvite(token);
          navigate(`/room/${roomId}`, { replace: true });
        } else if (status === "anonymous") {
          sessionStorage.setItem("play.pendingInvite", token);
          navigate("/login", { replace: true });
        }
      } catch (err) {
        if (!active) return;
        setState("invalid");
        setMessage(
          err instanceof ApiClientError ? err.message : "No se pudo validar la invitación.",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [token, api, status, navigate]);

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <h1>Invitación</h1>
      {state === "loading" && (
        <div className="row" style={{ marginTop: 16 }}>
          <span className="spinner" aria-hidden />
          <span className="muted">Validando invitación…</span>
        </div>
      )}
      {state === "invalid" && (
        <div className="alert error" role="alert" style={{ marginTop: 16 }}>
          <strong>Invitación no válida.</strong>
          <p className="small">{message}</p>
          <button className="secondary" onClick={() => navigate("/")}>
            Ir al inicio
          </button>
        </div>
      )}
      {state === "valid" && status !== "authenticated" && (
        <p className="muted">Redirigiendo al inicio de sesión…</p>
      )}
    </div>
  );
}
