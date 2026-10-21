import type { PlaybackState } from "@play/shared";
import { evaluateDrift } from "@play/shared";
import type { AudioSourceAdapter } from "./adapter.js";
import type { ClockSynchronizer } from "./clock-synchronizer.js";

export interface SyncDeps {
  adapter: AudioSourceAdapter;
  clock: ClockSynchronizer;
  onCorrection?: (info: {
    kind: "SOFT_CORRECTION" | "HARD_SEEK";
    driftMs: number;
    targetPositionMs: number;
  }) => void;
}

/**
 * Motor de sincronización. Calcula la posición objetivo autoritativa a partir
 * de las anclas del servidor y corrige el reproductor local cuando la deriva
 * supera los umbrales. Nunca inventa correcciones si la fuente no las soporta.
 */
export class SyncEngine {
  private lastCorrectionAtMs: number | null = null;

  constructor(private readonly deps: SyncDeps) {}

  /**
   * Evalúa la deriva contra el estado autoritativo. Devuelve la acción tomada.
   * `targetPositionMs` se calcula en el cliente con su reloj estimado.
   */
  tick(state: PlaybackState): { driftMs: number | null } {
    const { adapter, clock } = this.deps;

    if (state.playbackStatus !== "PLAYING" || !adapter.isReady()) {
      return { driftMs: null };
    }

    const estimatedServerNow = clock.estimatedServerNowDateMs();
    const localPositionMs = adapter.getCurrentTime() * 1000;

    const action = evaluateDrift({
      anchorPositionMs: state.anchorPositionMs,
      anchorServerTimeMs: state.anchorServerTimeMs,
      estimatedServerNowMs: estimatedServerNow,
      playbackRate: state.playbackRate,
      localPositionMs,
      isBuffering: adapter.isBuffering(),
      msSinceLastCorrection:
        this.lastCorrectionAtMs === null ? null : Date.now() - this.lastCorrectionAtMs,
    });

    if (action.kind === "HARD_SEEK" || action.kind === "SOFT_CORRECTION") {
      // Corrección: un pequeño ajuste de posición (la IFrame API no expone
      // playbackRate dinámico fiable, así que se usa un seek mínimo).
      void adapter.seekTo(action.targetPositionMs / 1000);
      this.lastCorrectionAtMs = Date.now();
      this.deps.onCorrection?.({
        kind: action.kind,
        driftMs: action.driftMs,
        targetPositionMs: action.targetPositionMs,
      });
    }

    return { driftMs: action.driftMs };
  }
}
