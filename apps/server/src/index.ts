import "dotenv/config";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createLogger } from "./logger.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createPool(config);
  const bundle = buildApp(config, db, logger);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting_down");
    try {
      await bundle.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "shutdown_error");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await bundle.app.ready();
    bundle.httpServer.listen(config.PORT, config.HOST, () => {
      logger.info(
        { port: config.PORT, host: config.HOST, env: config.NODE_ENV },
        "server_started",
      );
    });
  } catch (err) {
    logger.error({ err }, "startup_error");
    process.exit(1);
  }
}

void main();
