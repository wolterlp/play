import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  CONTROL_MODES,
  PRIVACY_MODES,
  REPEAT_MODES,
  ROLES,
} from "@play/shared";
import { makeAuthGuard, requireUser } from "./auth-guard.js";
import type { AuthService } from "../modules/auth/auth-service.js";
import type { RoomsService } from "../modules/rooms/rooms-service.js";
import type { TokenService } from "../modules/auth/token-service.js";
import type { RealtimeGateway } from "../modules/realtime/realtime-gateway.js";
import type { RateLimiter } from "../security/rate-limiter.js";
import { AppError } from "../errors.js";

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z
    .string()
    .min(10, "La contraseña debe tener al menos 10 caracteres.")
    .max(200),
  displayName: z.string().min(1).max(60),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10).max(512) });

const createRoomSchema = z.object({
  name: z.string().min(1).max(80),
  privacyMode: z.enum(PRIVACY_MODES).default("PRIVATE"),
  controlMode: z.enum(CONTROL_MODES).default("COLLABORATIVE"),
  nonstopEnabled: z.boolean().default(true),
  repeatMode: z.enum(REPEAT_MODES).default("OFF"),
  maxParticipants: z.number().int().min(2).max(200).default(20),
});

const updateRoomSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  privacyMode: z.enum(PRIVACY_MODES).optional(),
  controlMode: z.enum(CONTROL_MODES).optional(),
  nonstopEnabled: z.boolean().optional(),
  repeatMode: z.enum(REPEAT_MODES).optional(),
  maxParticipants: z.number().int().min(2).max(200).optional(),
});

const roleSchema = z.object({ role: z.enum(ROLES) });

/**
 * Deduce el origen público (esquema + host) de la petición para construir
 * enlaces absolutos. Respeta el encabezado `Origin` (útil tras un proxy
 * inverso) y, si no está, usa el protocolo/host de la petición.
 */
function requestOrigin(request: {
  headers: Record<string, unknown>;
  protocol: string;
  hostname: string;
}): string | undefined {
  const origin = request.headers["origin"];
  if (typeof origin === "string" && origin.length > 0) {
    return origin;
  }
  const host = request.headers["host"];
  if (typeof host === "string" && host.length > 0) {
    const proto = request.headers["x-forwarded-proto"];
    const scheme = typeof proto === "string" && proto.length > 0 ? proto.split(",")[0]!.trim() : request.protocol;
    return `${scheme}://${host}`;
  }
  return undefined;
}

export interface HttpDeps {
  auth: AuthService;
  rooms: RoomsService;
  tokens: TokenService;
  loginLimiter: RateLimiter;
  inviteLimiter: RateLimiter;
  roomLimiter: RateLimiter;
  gateway: RealtimeGateway;
}

export async function registerRoutes(
  app: FastifyInstance,
  deps: HttpDeps,
): Promise<void> {
  const authGuard = makeAuthGuard(deps.tokens);

  app.post("/api/auth/register", async (request) => {
    const body = registerSchema.parse(request.body);
    const ip = request.ip;
    if (!deps.loginLimiter.allow(`register:${ip}`)) {
      throw new AppError("RATE_LIMITED", "Demasiados intentos. Intenta más tarde.");
    }
    return deps.auth.register(body);
  });

  app.post("/api/auth/login", async (request) => {
    const body = loginSchema.parse(request.body);
    if (!deps.loginLimiter.allow(`login:${request.ip}`)) {
      throw new AppError("RATE_LIMITED", "Demasiados intentos. Intenta más tarde.");
    }
    return deps.auth.login(body);
  });

  app.post("/api/auth/refresh", async (request) => {
    const body = refreshSchema.parse(request.body);
    return deps.auth.refresh(body.refreshToken);
  });

  app.post("/api/auth/logout", async (request) => {
    const body = refreshSchema.parse(request.body);
    await deps.auth.logout(body.refreshToken);
    return { ok: true };
  });

  app.get("/api/rooms", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    return { rooms: await deps.rooms.listRoomsForUser(user.id) };
  });

  app.post("/api/rooms", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    if (!deps.roomLimiter.allow(`room:create:${user.id}`)) {
      throw new AppError("RATE_LIMITED", "Demasiadas salas creadas. Intenta más tarde.");
    }
    const body = createRoomSchema.parse(request.body);
    return { room: await deps.rooms.createRoom(user.id, body) };
  });

  app.get("/api/rooms/:roomId", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { roomId } = request.params as { roomId: string };
    const ctx = await deps.rooms.requireMembership(roomId, user.id);
    const count = await deps.rooms.memberCount(roomId);
    return {
      room: {
        id: ctx.room.id,
        name: ctx.room.name,
        privacyMode: ctx.room.privacy_mode,
        controlMode: ctx.room.control_mode,
        nonstopEnabled: ctx.room.nonstop_enabled,
        repeatMode: ctx.room.repeat_mode,
        maxParticipants: ctx.room.max_participants,
        status: ctx.room.status,
        ownerUserId: ctx.room.owner_user_id,
        participantCount: count,
        createdAt: ctx.room.created_at.toISOString(),
      },
      role: ctx.role,
      permissions: ctx.permissions,
    };
  });

  app.patch("/api/rooms/:roomId", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { roomId } = request.params as { roomId: string };
    const body = updateRoomSchema.parse(request.body);
    const room = await deps.rooms.updateRoom(roomId, user.id, body);
    await deps.gateway.broadcastRoomUpdated(roomId, "SETTINGS_CHANGED");
    return { room };
  });

  app.post("/api/rooms/:roomId/close", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { roomId } = request.params as { roomId: string };
    const ctx = await deps.rooms.requireMembership(roomId, user.id);
    if (!ctx.permissions.canManageRoom) {
      throw new AppError("FORBIDDEN", "Solo el anfitrión puede cerrar la sala.");
    }
    await deps.rooms.closeRoom(roomId, user.id);
    deps.gateway.broadcastRoomClosed(roomId, "HOST_CLOSED");
    return { ok: true };
  });

  app.delete("/api/rooms/:roomId", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { roomId } = request.params as { roomId: string };
    await deps.rooms.deleteRoom(roomId, user.id);
    deps.gateway.broadcastRoomClosed(roomId, "HOST_DELETED");
    return { ok: true };
  });

  app.post("/api/rooms/:roomId/invites", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { roomId } = request.params as { roomId: string };
    if (!deps.inviteLimiter.allow(`invite:${user.id}`)) {
      throw new AppError("RATE_LIMITED", "Demasiadas invitaciones creadas.");
    }
    return { invite: await deps.rooms.createInvite(roomId, user.id, requestOrigin(request)) };
  });

  app.get("/api/rooms/:roomId/invites", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { roomId } = request.params as { roomId: string };
    return { invites: await deps.rooms.listInvites(roomId, user.id) };
  });

  app.post(
    "/api/rooms/:roomId/invites/:inviteId/revoke",
    { preHandler: authGuard },
    async (request) => {
      const user = requireUser(request);
      const { roomId, inviteId } = request.params as {
        roomId: string;
        inviteId: string;
      };
      await deps.rooms.revokeInvite(roomId, inviteId, user.id);
      return { ok: true };
    },
  );

  app.get("/api/invites/:token", async (request) => {
    const { token } = request.params as { token: string };
    if (!deps.inviteLimiter.allow(`resolve:${request.ip}`)) {
      throw new AppError("RATE_LIMITED", "Demasiados intentos.");
    }
    const resolved = await deps.rooms.resolveInvite(token);
    return { valid: true, roomId: resolved.roomId };
  });

  app.post("/api/invites/:token/join", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { token } = request.params as { token: string };
    const resolved = await deps.rooms.resolveInvite(token);
    const member = await deps.rooms.joinRoom(resolved.roomId, user.id, "PARTICIPANT");
    return { roomId: resolved.roomId, role: member.role };
  });

  app.post("/api/rooms/:roomId/members/:userId/role", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { roomId, userId } = request.params as { roomId: string; userId: string };
    const body = roleSchema.parse(request.body);
    await deps.rooms.updateMemberRole(roomId, user.id, userId, body.role);
    return { ok: true };
  });

  app.delete("/api/rooms/:roomId/members/:userId", { preHandler: authGuard }, async (request) => {
    const user = requireUser(request);
    const { roomId, userId } = request.params as { roomId: string; userId: string };
    await deps.rooms.removeMember(roomId, user.id, userId);
    return { ok: true };
  });
}
