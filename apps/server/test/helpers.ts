import { loadConfig, type AppConfig } from "../src/config.js";
import { createPool, type Database } from "../src/db/pool.js";
import { createLogger } from "../src/logger.js";
import { buildApp, type AppBundle } from "../src/app.js";
import type { AddressInfo } from "node:net";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/play_test";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: "test-secret-at-least-32-characters-long-0000",
    LOG_LEVEL: "silent",
    AUTH_RATE_MAX: "10000",
    WS_RATE_MAX: "100000",
    INVITE_RATE_MAX: "10000",
    JOIN_RATE_MAX: "10000",
    ...process.env,
  } as NodeJS.ProcessEnv);
  return { ...base, ...overrides };
}

export interface TestContext {
  bundle: AppBundle;
  db: Database;
  baseUrl: string;
  wsUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(
  overrides: Partial<AppConfig> = {},
): Promise<TestContext> {
  const config = testConfig(overrides);
  const db = createPool(config);
  const logger = createLogger(config);
  const bundle = buildApp(config, db, logger);

  await bundle.app.ready();
  await new Promise<void>((resolve) => {
    bundle.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = bundle.httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    bundle,
    db,
    baseUrl,
    wsUrl: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      // Pequeña pausa: los manejadores de desconexión WS siguen trabajando
      // en segundo plano; cerrar la pool en mitad de una query provoca
      // "Cannot use a pool after calling end".
      await new Promise((resolve) => setTimeout(resolve, 150));
      await bundle.close();
    },
  };
}

export async function truncateAll(db: Database): Promise<void> {
  await db.query(
    `TRUNCATE room_playback_state, queue_items, room_invites,
     room_members, rooms, refresh_tokens, users RESTART IDENTITY CASCADE`,
  );
}

export interface TestUser {
  id: string;
  accessToken: string;
  refreshToken: string;
  email: string;
}

export async function registerUser(
  baseUrl: string,
  email: string,
  password = "password-1234",
  displayName = "Tester",
): Promise<TestUser> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, displayName }),
  });
  const body = (await res.json()) as {
    user: { id: string };
    tokens: { accessToken: string; refreshToken: string };
  };
  if (!res.ok) throw new Error(`register failed: ${JSON.stringify(body)}`);
  return {
    id: body.user.id,
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    email,
  };
}

export async function api(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
