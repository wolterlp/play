const VOLUME_KEY = "play.localVolume";
const MUTE_KEY = "play.localMute";

export interface LocalAudioPrefs {
  volume: number;
  muted: boolean;
}

const DEFAULT_PREFS: LocalAudioPrefs = { volume: 80, muted: false };

function clamp(volume: number): number {
  return Math.max(0, Math.min(100, Math.round(volume)));
}

function loadLocalAudioPrefs(): LocalAudioPrefs {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    const m = localStorage.getItem(MUTE_KEY);
    return {
      volume: v !== null ? clamp(Number(v)) : DEFAULT_PREFS.volume,
      muted: m === "1",
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function saveLocalAudioPrefs(prefs: LocalAudioPrefs): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(clamp(prefs.volume)));
    localStorage.setItem(MUTE_KEY, prefs.muted ? "1" : "0");
  } catch {
    // Almacenamiento no disponible; las preferencias se mantienen en memoria.
  }
}

/**
 * Almacén de audio local. Nunca se sincroniza ni se envía al servidor:
 * es la fuente de verdad exclusiva de este dispositivo.
 */
export class LocalAudioStore {
  private prefs: LocalAudioPrefs;
  private listeners = new Set<(prefs: LocalAudioPrefs) => void>();

  constructor(initial?: LocalAudioPrefs) {
    this.prefs = initial ?? loadLocalAudioPrefs();
  }

  get(): LocalAudioPrefs {
    return { ...this.prefs };
  }

  setVolume(volume: number): void {
    this.prefs = { ...this.prefs, volume: clamp(volume) };
    this.persistAndNotify();
  }

  setMuted(muted: boolean): void {
    this.prefs = { ...this.prefs, muted };
    this.persistAndNotify();
  }

  toggleMute(): void {
    this.setMuted(!this.prefs.muted);
  }

  subscribe(listener: (prefs: LocalAudioPrefs) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persistAndNotify(): void {
    saveLocalAudioPrefs(this.prefs);
    for (const l of this.listeners) l(this.get());
  }
}
