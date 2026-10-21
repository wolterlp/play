import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth-context.js";
import { HomePage } from "./pages/HomePage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RoomPage } from "./pages/RoomPage.js";
import { JoinPage } from "./pages/JoinPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";

export function App() {
  const { status } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route
        path="/room/:roomId"
        element={
          status === "loading" ? (
            <CenteredLoader />
          ) : status === "authenticated" ? (
            <RoomPage />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function CenteredLoader() {
  return (
    <div
      className="container"
      style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}
    >
      <div className="row">
        <span className="spinner" aria-hidden />
        <span className="muted">Cargando…</span>
      </div>
    </div>
  );
}
