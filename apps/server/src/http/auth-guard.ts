import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors.js";
import type { TokenService } from "../modules/auth/token-service.js";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: { id: string; displayName: string };
  }
}

export function makeAuthGuard(tokens: TokenService) {
  return async function authGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new AppError("UNAUTHENTICATED", "Falta el token de acceso.");
    }
    const token = header.slice("Bearer ".length).trim();
    const claims = await tokens.verifyAccessToken(token);
    request.authUser = { id: claims.sub, displayName: claims.displayName };
  };
}

export function requireUser(
  request: FastifyRequest,
): { id: string; displayName: string } {
  if (!request.authUser) {
    throw new AppError("UNAUTHENTICATED", "No autenticado.");
  }
  return request.authUser;
}
