export interface ClockSyncSample {
  /** Hora local (epoch ms, Date.now) cuando se envió el PING. */
  clientSendMs: number;
  /** Hora local (epoch ms) cuando se recibió el PONG. */
  clientReceiveMs: number;
  /** Hora del servidor (epoch ms) reportada en el PONG. */
  serverTimeMs: number;
}

export interface ClockOffsetEstimate {
  /** estimatedServerNow ≈ clientNow + offsetMs. */
  offsetMs: number;
  /** error de ida y vuelta (ms) de la muestra usada. */
  roundTripMs: number;
  sampleCount: number;
}

/**
 * Estima la compensación de reloj cliente<->servidor con el método de NTP
 * simplificado (Cristian's algorithm): se asume simetría de la latencia.
 * Límite conocido: bajo latencias asimétricas la estimación sesga; por ello se
 * usa la muestra con menor RTT entre las recientes.
 */
export function estimateClockOffset(
  samples: ClockSyncSample[],
): ClockOffsetEstimate | null {
  if (samples.length === 0) return null;

  let best: ClockSyncSample | null = null;
  let bestRtt = Number.POSITIVE_INFINITY;

  for (const s of samples) {
    const rtt = s.clientReceiveMs - s.clientSendMs;
    if (rtt >= 0 && rtt < bestRtt) {
      bestRtt = rtt;
      best = s;
    }
  }

  if (!best) return null;

  const midpoint = (best.clientSendMs + best.clientReceiveMs) / 2;
  return {
    offsetMs: best.serverTimeMs - midpoint,
    roundTripMs: bestRtt,
    sampleCount: samples.length,
  };
}

export interface DriftDecisionInput {
  anchorPositionMs: number;
  anchorServerTimeMs: number;
  estimatedServerNowMs: number;
  playbackRate: number;
  localPositionMs: number;
  isBuffering: boolean;
  /**
   * Milisegundos desde la última corrección aplicada (para enfriamiento).
   * `null` si nunca se corrigió.
   */
  msSinceLastCorrection: number | null;
}

export type DriftAction =
  | { kind: "NONE"; driftMs: number }
  | { kind: "SOFT_CORRECTION"; driftMs: number; targetPositionMs: number }
  | { kind: "HARD_SEEK"; driftMs: number; targetPositionMs: number }
  | { kind: "SKIP_BUFFERING"; driftMs: number };

export interface DriftThresholds {
  /** Desviación por debajo de la cual no se actúa (ms). */
  toleranceMs: number;
  /** Desviación a partir de la cual se hace seek duro (ms). */
  hardThresholdMs: number;
  /** Enfriamiento mínimo entre correcciones (ms). */
  cooldownMs: number;
}

export const DEFAULT_DRIFT_THRESHOLDS: DriftThresholds = {
  toleranceMs: 250,
  hardThresholdMs: 750,
  cooldownMs: 3000,
};

/**
 * Calcula la posición objetivo autoritativa y decide la acción de corrección.
 * Estos umbrales son HIPÓTESIS por validar (spec §8); no son garantías.
 */
export function evaluateDrift(
  input: DriftDecisionInput,
  thresholds: DriftThresholds = DEFAULT_DRIFT_THRESHOLDS,
): DriftAction {
  const elapsed = input.estimatedServerNowMs - input.anchorServerTimeMs;
  const targetPositionMs = Math.max(
    0,
    input.anchorPositionMs + elapsed * input.playbackRate,
  );
  const driftMs = input.localPositionMs - targetPositionMs;

  if (input.isBuffering) {
    return { kind: "SKIP_BUFFERING", driftMs };
  }

  const absDrift = Math.abs(driftMs);

  if (absDrift < thresholds.toleranceMs) {
    return { kind: "NONE", driftMs };
  }

  const cooling =
    input.msSinceLastCorrection !== null &&
    input.msSinceLastCorrection < thresholds.cooldownMs;

  if (cooling) {
    return { kind: "NONE", driftMs };
  }

  if (absDrift >= thresholds.hardThresholdMs) {
    return { kind: "HARD_SEEK", driftMs, targetPositionMs };
  }

  return { kind: "SOFT_CORRECTION", driftMs, targetPositionMs };
}

export function computeTargetPositionMs(
  anchorPositionMs: number,
  anchorServerTimeMs: number,
  estimatedServerNowMs: number,
  playbackRate: number,
): number {
  const elapsed = estimatedServerNowMs - anchorServerTimeMs;
  return Math.max(0, anchorPositionMs + elapsed * playbackRate);
}
