import {
  estimateClockOffset,
  type ClockOffsetEstimate,
  type ClockSyncSample,
} from "@play/shared";

const MAX_SAMPLES = 20;

/**
 * Mantiene una estimación del desfase de reloj cliente<->servidor usando
 * muestras PING/PONG. Es la base para calcular la posición objetivo.
 */
export class ClockSynchronizer {
  private samples: ClockSyncSample[] = [];
  private estimate: ClockOffsetEstimate | null = null;

  addSample(clientSendMs: number, clientReceiveMs: number, serverTimeMs: number): void {
    this.samples.push({ clientSendMs, clientReceiveMs, serverTimeMs });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples = this.samples.slice(-MAX_SAMPLES);
    }
    this.estimate = estimateClockOffset(this.samples);
  }

  /**
   * estimatedServerNow = Date.now() + offsetMs.
   * IMPORTANTE: las muestras PING/PONG deben usar la MISMA base temporal
   * (Date.now, epoch ms) que las anclas del servidor. No mezclar con
   * performance.now(), que es relativo al arranque de la página.
   */
  estimatedServerNowDateMs(): number {
    if (!this.estimate) return Date.now();
    return Date.now() + this.estimate.offsetMs;
  }

  getOffset(): ClockOffsetEstimate | null {
    return this.estimate;
  }

  get roundTripMs(): number | null {
    return this.estimate?.roundTripMs ?? null;
  }
}
