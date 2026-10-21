import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context.js";
import { ApiClientError } from "../api/api-client.js";

export function LoginPage() {
  const { login, register, status } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated") navigate("/", { replace: true });
  }, [status, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await register(email, password, displayName);
      } else {
        await login(email, password);
      }
      const pendingInvite = sessionStorage.getItem("play.pendingInvite");
      if (pendingInvite) {
        sessionStorage.removeItem("play.pendingInvite");
        navigate(`/join/${pendingInvite}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 440 }}>
      <h1>Play</h1>
      <p className="muted">Salas musicales sincronizadas.</p>
      <div className="card stack" style={{ marginTop: 16 }}>
        <div className="row" role="tablist" aria-label="Modo de acceso">
          <button
            type="button"
            className={mode === "login" ? "" : "secondary"}
            onClick={() => setMode("login")}
            aria-pressed={mode === "login"}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            className={mode === "register" ? "" : "secondary"}
            onClick={() => setMode("register")}
            aria-pressed={mode === "register"}
          >
            Crear cuenta
          </button>
        </div>

        <form className="stack" onSubmit={onSubmit}>
          {mode === "register" && (
            <div>
              <label htmlFor="displayName">Nombre visible</label>
              <input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength={60}
                autoComplete="nickname"
              />
            </div>
          )}
          <div>
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 10 : 1}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
            {mode === "register" && <p className="small muted">Mínimo 10 caracteres.</p>}
          </div>

          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" disabled={busy}>
            {busy ? "Procesando…" : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>
      </div>
    </div>
  );
}
