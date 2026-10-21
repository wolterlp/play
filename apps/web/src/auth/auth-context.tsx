import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "@play/shared";
import { ApiClient } from "../api/api-client.js";
import {
  clearSession,
  loadSession,
  saveSession,
} from "./session-storage.js";

export interface AuthState {
  status: "loading" | "anonymous" | "authenticated";
  user: AuthUser | null;
  api: ApiClient;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}

export function AuthProvider({
  children,
  api,
}: {
  children: ReactNode;
  api: ApiClient;
}): JSX.Element {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  const bootstrap = useCallback(async () => {
    const persisted = loadSession();
    if (!persisted) {
      setStatus("anonymous");
      return;
    }
    refreshTokenRef.current = persisted.refreshToken;
    try {
      const { user: u, tokens } = await api.refresh(persisted.refreshToken);
      api.setAccessToken(tokens.accessToken);
      refreshTokenRef.current = tokens.refreshToken;
      saveSession({ user: u, refreshToken: tokens.refreshToken });
      setUser(u);
      setStatus("authenticated");
    } catch {
      clearSession();
      api.setAccessToken(null);
      refreshTokenRef.current = null;
      setStatus("anonymous");
    }
  }, [api]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const applySession = useCallback(
    (u: AuthUser, tokens: { accessToken: string; refreshToken: string }) => {
      api.setAccessToken(tokens.accessToken);
      refreshTokenRef.current = tokens.refreshToken;
      saveSession({ user: u, refreshToken: tokens.refreshToken });
      setUser(u);
      setStatus("authenticated");
    },
    [api],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const { user: u, tokens } = await api.login({ email, password });
      applySession(u, tokens);
    },
    [api, applySession],
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { user: u, tokens } = await api.register({ email, password, displayName });
      applySession(u, tokens);
    },
    [api, applySession],
  );

  const logout = useCallback(() => {
    const token = refreshTokenRef.current;
    if (token) void api.logout(token).catch(() => undefined);
    clearSession();
    api.setAccessToken(null);
    refreshTokenRef.current = null;
    setUser(null);
    setStatus("anonymous");
  }, [api]);

  const value = useMemo<AuthState>(
    () => ({ status, user, api, login, register, logout }),
    [status, user, api, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
