import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { loadConfig } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

interface Migration {
  id: string;
  up: string;
  down: string;
}

async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const migrations: Migration[] = [];
  for (const file of files) {
    const content = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const upMatch = content.split(/^--\s+DOWN\s*$/m);
    const up = (upMatch[0] ?? content).trim();
    const down = (upMatch[1] ?? "").trim();
    if (!down) {
      throw new Error(
        `Migración ${file} no define una sección DOWN (-- DOWN).`,
      );
    }
    migrations.push({ id: file, up, down });
  }
  return migrations;
}

async function ensureTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedIds(client: pg.Client): Promise<Set<string>> {
  const res = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
  return new Set(res.rows.map((r) => r.id));
}

export async function migrateUp(client: pg.Client): Promise<string[]> {
  await ensureTable(client);
  const applied = await appliedIds(client);
  const migrations = await loadMigrations();
  const newlyApplied: string[] = [];

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    await client.query("BEGIN");
    try {
      await client.query(m.up);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
      await client.query("COMMIT");
      newlyApplied.push(m.id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Fallo aplicando ${m.id}: ${(err as Error).message}`);
    }
  }
  return newlyApplied;
}

export async function migrateDown(client: pg.Client, step = 1): Promise<string[]> {
  await ensureTable(client);
  const migrations = await loadMigrations();
  const res = await client.query<{ id: string }>(
    "SELECT id FROM schema_migrations ORDER BY applied_at DESC, id DESC LIMIT $1",
    [step],
  );
  const toRevert = res.rows.map((r) => r.id);
  const reverted: string[] = [];

  for (const id of toRevert) {
    const m = migrations.find((x) => x.id === id);
    if (!m) continue;
    await client.query("BEGIN");
    try {
      await client.query(m.down);
      await client.query("DELETE FROM schema_migrations WHERE id = $1", [id]);
      await client.query("COMMIT");
      reverted.push(id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Fallo revirtiendo ${id}: ${(err as Error).message}`);
    }
  }
  return reverted;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const command = process.argv[2] ?? "up";
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  try {
    if (command === "up") {
      const done = await migrateUp(client);
      console.info(
        done.length
          ? `Migraciones aplicadas: ${done.join(", ")}`
          : "No hay migraciones pendientes.",
      );
    } else if (command === "down") {
      const done = await migrateDown(client, Number(process.argv[3] ?? 1));
      console.info(done.length ? `Revertidas: ${done.join(", ")}` : "Nada que revertir.");
    } else {
      throw new Error(`Comando desconocido: ${command}`);
    }
  } finally {
    await client.end();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
