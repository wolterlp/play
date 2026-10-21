import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { ZodError } from "zod";
import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "node:http";
import type { AppConfig } from "./config.js";
import type { Database } from "./db/pool.js";
import type { Logger } from "./logger.js";
import { AppError, isAppError } from "./errors.js";
import { RateLimiter } from "./security/rate-limiter.js";
import { AuthService } from "./modules/auth/auth-service.js";
import { TokenService } from "./modules/auth/token-service.js";
import { RoomsService } from "./modules/rooms/rooms-service.js";
import { RoomStateService } from "./modules/rooms/room-state-service.js";
import { QueueService } from "./modules/queue/queue-service.js";
import { PlaybackService } from "./modules/playback/playback-service.js";
import { PresenceService } from "./modules/presence/presence-service.js";
import { RealtimeGateway } from "./modules/realtime/realtime-gateway.js";
import { registerRoutes } from "./http/routes.js";

export interface AppBundle {
  app: FastifyInstance;
  io: SocketServer;
  httpServer: HttpServer;
  services: {
    auth: AuthService;
    tokens: TokenService;
    rooms: RoomsService;
    roomState: RoomStateService;
    queue: QueueService;
    playback: PlaybackService;
    presence: PresenceService;
  };
  close: () => Promise<void>;
}

export function buildApp(
  config: AppConfig,
  db: Database,
  logger: Logger,
): AppBundle {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  app.register(helmet, { contentSecurityPolicy: false });
  app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
  });

  const httpServer = app.server;
  const io = new SocketServer(httpServer, {
    path: "/ws",
    cors: { origin: config.corsOrigins, credentials: true },
    maxHttpBufferSize: 128 * 1024,
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  const tokens = new TokenService(config);
  const auth = new AuthService(db, tokens, config, logger);
  const rooms = new RoomsService(db, config, logger);
  const queue = new QueueService(db);
  const playback = new PlaybackService(db, queue, config, logger);
  const presence = new PresenceService(config.PRESENCE_RECONNECT_TTL_SECONDS * 1_000);
  const roomState = new RoomStateService(db, queue, presence);

  const gateway = new RealtimeGateway(
    io,
    db,
    config,
    logger,
    tokens,
    rooms,
    queue,
    playback,
    roomState,
    presence,
  );
  gateway.attach();

  const loginLimiter = new RateLimiter(
    config.AUTH_RATE_MAX,
    config.AUTH_RATE_WINDOW_MS,
  );
  const inviteLimiter = new RateLimiter(
    config.INVITE_RATE_MAX,
    config.INVITE_RATE_WINDOW_MS,
  );
  const roomLimiter = new RateLimiter(
    config.ROOM_RATE_MAX,
    config.ROOM_RATE_WINDOW_MS,
  );

  // Vigilante de gracia de anfitrión: cierra salas SUSPENDED con gracia vencida.
  const hostSweepTimer = setInterval(() => {
    void rooms
      .closeExpiredSuspendedRooms()
      .then((closedIds) => {
        for (const roomId of closedIds) {
          gateway.broadcastRoomClosed(roomId, "HOST_GRACE_EXPIRED");
        }
      })
      .catch((err: unknown) => {
        logger.error({ err }, "host_sweep_failed");
      });
  }, config.HOST_SWEEP_INTERVAL_MS);
  hostSweepTimer.unref();

  // Presencia: degrada RECONNECTING -> DISCONNECTED cuando vence la ventana.
  const presenceSweepTimer = setInterval(() => {
    presence.sweep();
  }, Math.max(1_000, config.PRESENCE_RECONNECT_TTL_SECONDS * 1_000 / 2));
  presenceSweepTimer.unref();

  app.register(async (instance) => {
    await registerRoutes(instance, {
      auth,
      rooms,
      tokens,
      loginLimiter,
      inviteLimiter,
      roomLimiter,
      gateway,
    });
  });

  app.get("/api/health", async () => {
    let dbOk = false;
    try {
      await db.query("SELECT 1");
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      status: dbOk ? "ok" : "degraded",
      database: dbOk,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log?.warn?.({ issues: error.issues }, "validation_error");
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Datos de entrada inválidos.",
          details: error.flatten(),
        },
      });
    }
    if (isAppError(error)) {
      const body = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      };
      return reply.status(error.statusCode).send(body);
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send({
        error: {
          code: "VALIDATION_ERROR",
          message: (error as Error).message || "Solicitud inválida.",
        },
      });
    }
    logger.error({ err: error }, "unhandled_http_error");
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Recurso no encontrado." },
    });
  });

  const close = async (): Promise<void> => {
    clearInterval(hostSweepTimer);
    clearInterval(presenceSweepTimer);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await app.close();
    await db.end();
  };

  return {
    app,
    io,
    httpServer,
    services: { auth, tokens, rooms, roomState, queue, playback, presence },
    close,
  };
}
