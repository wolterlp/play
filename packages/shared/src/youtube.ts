export const YOUTUBE_ALLOWED_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
] as const;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface ParsedYouTubeUrl {
  videoId: string;
  canonicalUrl: string;
}

/**
 * Analiza LOCALMENTE una URL de YouTube y extrae el identificador del video.
 * No realiza scraping, ni llamadas a YouTube Data API, ni consulta ningún host.
 * Rechaza esquemas distintos de http/https y hosts no aprobados.
 */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!(YOUTUBE_ALLOWED_HOSTS as readonly string[]).includes(host)) {
    return null;
  }

  let candidate: string | null = null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    candidate = url.pathname.slice(1).split("/")[0] ?? null;
  } else if (url.pathname === "/watch") {
    candidate = url.searchParams.get("v");
  } else if (url.pathname.startsWith("/embed/")) {
    candidate = url.pathname.slice("/embed/".length).split("/")[0] ?? null;
  } else if (url.pathname.startsWith("/shorts/")) {
    candidate = url.pathname.slice("/shorts/".length).split("/")[0] ?? null;
  } else if (url.pathname.startsWith("/live/")) {
    candidate = url.pathname.slice("/live/".length).split("/")[0] ?? null;
  }

  if (!candidate || !VIDEO_ID_RE.test(candidate)) {
    return null;
  }

  return {
    videoId: candidate,
    canonicalUrl: `https://www.youtube.com/watch?v=${candidate}`,
  };
}

/**
 * Códigos del reproductor de YouTube que indican contenido no disponible.
 * El servidor y el cliente comparten esta lista para que un error fatal
 * marque la pista como UNAVAILABLE de la misma forma en ambos lados.
 */
export const UNAVAILABLE_PLAYER_CODES = ["2", "5", "100", "101", "150"] as const;

export function isUnavailablePlayerCode(code: string | number): boolean {
  return (UNAVAILABLE_PLAYER_CODES as readonly string[]).includes(String(code));
}
