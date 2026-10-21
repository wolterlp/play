import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { ApiClient } from "./api/api-client.js";
import { AuthProvider } from "./auth/auth-context.js";
import "./styles/global.css";

const api = new ApiClient(import.meta.env.VITE_API_BASE_URL ?? "");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider api={api}>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
