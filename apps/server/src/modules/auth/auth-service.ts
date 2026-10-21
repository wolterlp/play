import type { AuthTokens, AuthUser } from "@play/shared";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { AppError } from "../../errors.js";
import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../../security/crypto.js";
import type { Logger } from "../../logger.js";
import type { TokenService } from "./token-service.js";

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async register(input: RegisterInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();

    const existing = await this.db.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = $1",
      [email],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new AppError("CONFLICT", "Ya existe una cuenta con ese correo.");
    }

    const passwordHash = await hashPassword(input.password);
    const inserted = await this.db.query<UserRow>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, password_hash`,
      [email, displayName, passwordHash],
    );
    const row = inserted.rows[0];
    if (!row) throw new AppError("INTERNAL_ERROR", "No se pudo crear el usuario.");

    const tokens = await this.issueTokens(row.id, row.display_name);
    this.logger.info({ userId: row.id }, "auth.register");
    return {
      user: { id: row.id, email: row.email, displayName: row.display_name },
      tokens,
    };
  }

  async login(input: LoginInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const email = input.email.trim().toLowerCase();
    const res = await this.db.query<UserRow>(
      `SELECT id, email, display_name, password_hash
       FROM users WHERE lower(email) = $1`,
      [email],
    );
    const row = res.rows[0];
    if (!row) {
      await verifyPassword(input.password, "argon2id$v=19$m=65536,t=3,p=4$aaaaaaaaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      throw new AppError("UNAUTHENTICATED", "Credenciales inválidas.");
    }

    const ok = await verifyPassword(input.password, row.password_hash);
    if (!ok) {
      throw new AppError("UNAUTHENTICATED", "Credenciales inválidas.");
    }

    const tokens = await this.issueTokens(row.id, row.display_name);
    this.logger.info({ userId: row.id }, "auth.login");
    return {
      user: { id: row.id, email: row.email, displayName: row.display_name },
      tokens,
    };
  }

  async refresh(refreshToken: string): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const tokenHash = hashToken(refreshToken);
    const res = await this.db.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      display_name: string;
      email: string;
    }>(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at,
              u.display_name, u.email
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );
    const row = res.rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) {
      throw new AppError("UNAUTHENTICATED", "Sesión expirada. Inicia sesión de nuevo.");
    }

    await this.db.query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1",
      [row.id],
    );

    const tokens = await this.issueTokens(row.user_id, row.display_name);
    return {
      user: { id: row.user_id, email: row.email, displayName: row.display_name },
      tokens,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.db.query(
      "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
      [tokenHash],
    );
  }

  private async issueTokens(userId: string, displayName: string): Promise<AuthTokens> {
    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      displayName,
    });
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000,
    );
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, hashToken(refreshToken), expiresAt],
    );
    return {
      accessToken,
      refreshToken,
      expiresInMs: this.config.ACCESS_TOKEN_TTL_SECONDS * 1000,
    };
  }
}
