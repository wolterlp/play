import type { AudioSourceAdapter } from "./adapter.js";
import { YT_PLAYER_STATES } from "./adapter.js";

interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId?: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: typeof YT_PLAYER_STATES;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube IFrame API no disponible."));
      }
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("No se pudo cargar la IFrame API de YouTube."));
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * Adaptador basado en la YouTube IFrame Player API OFICIAL.
 * No usa YouTube Data API, no hace scraping, no bloquea anuncios.
 * Controla el reproductor embebido mediante su interfaz documentada.
 */
export class YouTubeAdapter implements AudioSourceAdapter {
  readonly sourceType = "YOUTUBE";
  private player: YTPlayer | null = null;
  private ready = false;
  private buffering = false;
  private endedCbs: Array<() => void> = [];
  private errorCbs: Array<(code: number) => void> = [];
  private stateCbs: Array<(state: number) => void> = [];
  private pendingVolume01 = 1;
  private pendingMuted = false;
  private loadResolvers: Array<() => void> = [];

  async init(container: HTMLElement): Promise<void> {
    const timeoutMs = Number(import.meta.env.VITE_PLAYER_START_TIMEOUT_MS ?? 15_000);
    const YT = await loadYouTubeIframeApi();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.ready) reject(new Error("Tiempo de espera agotado al iniciar el reproductor."));
      }, timeoutMs);
      this.player = new YT.Player(container, {
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            clearTimeout(timeout);
            this.ready = true;
            this.applyPendingAudio();
            for (const r of this.loadResolvers) r();
            this.loadResolvers = [];
            resolve();
          },
          onStateChange: (e) => {
            this.buffering = e.data === YT_PLAYER_STATES.BUFFERING;
            for (const cb of this.stateCbs) cb(e.data);
            if (e.data === YT_PLAYER_STATES.ENDED) {
              for (const cb of this.endedCbs) cb();
            }
          },
          onError: (e) => {
            for (const cb of this.errorCbs) cb(e.data);
          },
        },
      });
    });
  }

  private applyPendingAudio(): void {
    if (!this.player) return;
    this.player.setVolume(Math.round(this.pendingVolume01 * 100));
    if (this.pendingMuted) this.player.mute();
    else this.player.unMute();
  }

  async load(videoId: string, startSeconds?: number): Promise<void> {
    if (!this.player) throw new Error("Reproductor no inicializado.");
    if (!this.ready) {
      await new Promise<void>((resolve) => this.loadResolvers.push(resolve));
    }
    this.player.loadVideoById({
      videoId,
      ...(startSeconds !== undefined ? { startSeconds } : {}),
    });
  }

  async play(): Promise<void> {
    this.player?.playVideo();
  }

  async pause(): Promise<void> {
    this.player?.pauseVideo();
  }

  async seekTo(seconds: number): Promise<void> {
    this.player?.seekTo(seconds, true);
  }

  setVolume(volume01: number): void {
    this.pendingVolume01 = Math.max(0, Math.min(1, volume01));
    if (this.pendingMuted) return;
    this.player?.setVolume(Math.round(this.pendingVolume01 * 100));
  }

  mute(muted: boolean): void {
    this.pendingMuted = muted;
    if (!this.player) return;
    if (muted) this.player.mute();
    else this.player.unMute();
  }

  getCurrentTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }

  getDuration(): number {
    return this.player?.getDuration() ?? 0;
  }

  isReady(): boolean {
    return this.ready;
  }

  isBuffering(): boolean {
    return this.buffering;
  }

  onEnded(cb: () => void): void {
    this.endedCbs.push(cb);
  }

  onError(cb: (code: number) => void): void {
    this.errorCbs.push(cb);
  }

  onStateChange(cb: (state: number) => void): void {
    this.stateCbs.push(cb);
  }

  destroy(): void {
    try {
      this.player?.destroy();
    } catch {
      // ignore
    }
    this.player = null;
    this.ready = false;
  }
}
