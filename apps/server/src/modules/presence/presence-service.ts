import type { MemberConnectionState } from "@play/shared";

/**
 * Presencia en memoria. Solo apto para una única instancia del servidor.
 * Escalar a varias instancias requeriría Redis pub/sub (fuera del MVP).
 *
 * Un usuario que se desconecta pasa a RECONNECTING durante una ventana
 * configurable; si no vuelve, `sweep()` lo degrada a DISCONNECTED. Esto evita
 * mostrar "conectado" para siempre y cumple §Flujo F.6.
 */
export class PresenceService {
  /** userId -> número de sockets conectados. */
  private readonly connections = new Map<string, number>();
  /** userId -> instante (epoch ms) de la última desconexión total. */
  private readonly disconnectedAt = new Map<string, number>();

  constructor(private readonly reconnectTtlMs = 60_000) {}

  addConnection(userId: string): void {
    const current = this.connections.get(userId) ?? 0;
    this.connections.set(userId, current + 1);
    this.disconnectedAt.delete(userId);
  }

  removeConnection(userId: string): void {
    const current = this.connections.get(userId) ?? 0;
    if (current <= 1) {
      this.connections.delete(userId);
      this.disconnectedAt.set(userId, Date.now());
    } else {
      this.connections.set(userId, current - 1);
    }
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId) ?? 0) > 0;
  }

  getConnectionState(userId: string): MemberConnectionState {
    if (this.isOnline(userId)) return "CONNECTED";
    const since = this.disconnectedAt.get(userId);
    if (since !== undefined && Date.now() - since < this.reconnectTtlMs) {
      return "RECONNECTING";
    }
    return "DISCONNECTED";
  }

  /** Degrada RECONNECTING -> DISCONNECTED cuando vence la ventana. */
  sweep(now = Date.now()): void {
    for (const [userId, since] of this.disconnectedAt) {
      if (now - since >= this.reconnectTtlMs) {
        this.disconnectedAt.delete(userId);
      }
    }
  }
}
