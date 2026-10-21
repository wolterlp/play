import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  /** Orígenes permitidos para CORS y WebSocket, separados por coma. */
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  /**
   * URL pública de la app web (esquema + host, sin barra final) usada para
   * construir enlaces de invitación absolutos. Si se omite, se deduce del
   * origen de cada petición.
   */
  PUBLIC_URL: z.string().url().optional(),
  /** Secreto para firmar JWT (mínimo 32 chars). Requerido salvo en test. */
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  INVITE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  /** Ventana de gracia (s) para conservar la sala si el anfitrión se cae. */
  HOST_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(120),
  /** Intervalo (ms) del vigilante que cierra salas con gracia vencida. */
  HOST_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  /** Tiempo (s) que un miembro desconectado se muestra como RECONNECTING. */
  PRESENCE_RECONNECT_TTL_SECONDS: z.coerce.number().int().nonnegative().default(60),
  /** Máximo de reintentos por elemento no reproducible antes de saltarlo. */
  MAX_ITEM_RETRIES: z.coerce.number().int().nonnegative().default(2),
  /** Límite de invitaciones por sala. */
  MAX_INVITES_PER_ROOM: z.coerce.number().int().positive().default(50),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  /** Intentos de login/registro por IP y ventana (ms). */
  AUTH_RATE_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Eventos WS por usuario y ventana. */
  WS_RATE_MAX: z.coerce.number().int().positive().default(60),
  WS_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  /** Invitaciones creadas/resueltas por usuario/IP y ventana. */
  INVITE_RATE_MAX: z.coerce.number().int().positive().default(60),
  INVITE_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Salas creadas por usuario y ventana. */
  ROOM_RATE_MAX: z.coerce.number().int().positive().default(10),
  ROOM_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** Intentos de ROOM_JOIN por usuario y ventana. */
  JOIN_RATE_MAX: z.coerce.number().int().positive().default(20),
  JOIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  jwtSecret: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Configuración de entorno inválida: ${issues}`);
  }

  const raw = parsed.data;
  const isTest = raw.NODE_ENV === "test";

  if (!raw.JWT_SECRET && !isTest) {
    throw new Error(
      "JWT_SECRET es obligatorio (mínimo 32 caracteres). Configúralo en el entorno.",
    );
  }

  return {
    ...raw,
    corsOrigins: raw.CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    jwtSecret:
      raw.JWT_SECRET ?? "test-only-secret-should-be-at-least-32-chars-long-xxxx",
  };
}
