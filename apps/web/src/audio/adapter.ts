/**
 * Adaptador de fuente de audio. Interfaz común para cualquier proveedor.
 * El resto de la app no conoce detalles de YouTube.
 */
export interface AudioSourceAdapter {
  readonly sourceType: string;
  /**
   * Crea/actualiza el reproductor en el contenedor dado. Requiere un gesto del
   * usuario para poder reproducir (política de autoplay).
   */
  init(container: HTMLElement): Promise<void>;
  load(videoId: string, startSeconds?: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  setVolume(volume01: number): void;
  mute(muted: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  isReady(): boolean;
  isBuffering(): boolean;
  destroy(): void;
  onEnded(cb: () => void): void;
  onError(cb: (code: number) => void): void;
  onStateChange(cb: (state: number) => void): void;
}

export const YT_PLAYER_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;
