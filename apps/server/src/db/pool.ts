import pg from "pg";
import type { AppConfig } from "../config.js";

export type Database = pg.Pool;

export function createPool(config: AppConfig): Database {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.NODE_ENV === "test" ? 5 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "play-server",
  });
}
