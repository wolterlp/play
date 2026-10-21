import { useNavigate } from "react-router-dom";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <h1>404</h1>
      <p className="muted">La página que buscas no existe.</p>
      <button className="secondary" onClick={() => navigate("/")}>
        Ir al inicio
      </button>
    </div>
  );
}
