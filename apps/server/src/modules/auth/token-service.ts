import { SignJWT, jwtVerify } from "jose";
import type { AppConfig } from "../../config.js";
import { AppError } from "../../errors.js";

const ISSUER = "play-server";
const AUDIENCE = "play-client";

export interface AccessTokenClaims {
  sub: string;
  displayName: string;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return new SignJWT({ displayName: claims.displayName })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof payload.sub !== "string") {
        throw new AppError("UNAUTHENTICATED", "Token sin sujeto.");
      }
      const displayName =
        typeof payload.displayName === "string" ? payload.displayName : "";
      return { sub: payload.sub, displayName };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("UNAUTHENTICATED", "Token inválido o expirado.");
    }
  }
}
