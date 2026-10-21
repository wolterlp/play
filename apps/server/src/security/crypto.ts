import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Token opaco, no predecible (256 bits). Se entrega en claro una sola vez. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Almacena tokens de invitación/refresh como SHA-256. Estos tokens son de alta
 * entropía, por lo que SHA-256 es suficiente y permite búsquedas por índice.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
