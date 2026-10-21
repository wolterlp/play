# 1. Informe de viabilidad — integración con YouTube

> Documento: entregable 1 de §14 del prompt maestro.
> Estado: **decisión ratificada por el responsable del producto (Opción B)**.
> Fuente de verdad de este informe: el código implementado en este repositorio.

---

## 1.1. Pregunta de viabilidad

La especificación (§2.3) exige no usar **YouTube Data API v3** y prohíbe prometer
sincronización completa con un iframe "a pelo". Antes de implementar la
sincronización había que elegir entre tres rutas y no podía elegirse en silencio.

Las tres opciones comparadas:

| | **Opción A** — Cero API | **Opción B** — IFrame Player API | **Opción C** — Fuente alternativa |
|---|---|---|---|
| ¿Qué es? | La app solo administra salas, enlaces y cola. La reproducción la inicia/copía el usuario. | API JavaScript **oficial** de YouTube para controlar el reproductor incrustado (`https://www.youtube.com/iframe_api`). | Otro proveedor de audio con SDK controlable (Spotify Web Playback, SoundCloud, archivos propios, etc.). |
| ¿Usa YouTube Data API? | No | **No** (es una interfaz distinta) | No aplica |
| Cargar video por ID | No (solo abrir enlace) | **Sí** (`loadVideoById` / `cueVideoById`) | Sí |
| play / pause programático | No | **Sí** (`playVideo`, `pauseVideo`) | Sí |
| Leer posición actual | No | **Sí** (`getCurrentTime`) | Sí |
| Leer duración / estado | No | **Sí** (`getDuration`, `getPlayerState`) | Sí |
| Seek (saltar a posición) | No | **Sí** (`seekTo`) | Sí |
| Detectar errores de reproducción | No | **Sí** (`onError`, códigos 2/5/100/101/150) | Sí |
| Sincronización automática | **Imposible** | **Best-effort alcanzable** | Depende del proveedor |
| Non-stop automático | Muy limitado | **Alcanzable** (señal `ENDED`) | Alcanzable |
| Saltar anuncios | No | **No** (y no debe intentarse) | Depende de la licencia |
| Coste / claves API | 0 | 0 (sin claves de API de YouTube) | Variable, requiere acuerdo/licencia |
| Riesgo de alcance | Alto (producto degradado) | Medio (políticas de embebido de YouTube) | Alto (nueva integración) |

---

## 1.2. Capacidades alcanzables **sin** YouTube Data API

Bajo la restricción de **no usar ninguna clave ni endpoint de YouTube Data API v3**,
la Opción B permite exactamente lo siguiente, porque la IFrame Player API es una
interfaz de cliente distinta que no requiere credenciales:

**Sí se puede (y así está implementado):**

1. Cargar un video por ID una vez pegado el enlace por el usuario
   (`YouTubeAdapter.load` → `loadVideoById`, en `apps/web/src/audio/youtube-adapter.ts`).
2. Extraer el ID del video con **análisis local de la URL**, sin scraping ni llamadas
   de red a YouTube (`parseYouTubeUrl` en `packages/shared/src/youtube.ts`; solo
   acepta `http/https` y hosts de la lista `YOUTUBE_ALLOWED_HOSTS`).
3. Reproducir, pausar y posicionar (`playVideo`, `pauseVideo`, `seekTo`).
4. Leer posición (`getCurrentTime`), duración (`getDuration`) y estado
   (`getPlayerState`), incluido el estado `BUFFERING`.
5. Detectar el fin de pista (`onStateChange` con `ENDED`) y errores (`onError`).
6. Controlar volumen y silencio **locales** en cada dispositivo
   (`setVolume`, `mute`, `unMute`).
7. Estimar el desfase entre dispositivos y corregirlo con seeks
   (`SyncEngine` + `evaluateDrift` en `packages/shared/src/sync.ts`).

**No se puede (y así queda documentado):**

1. Consultar catálogo, búsqueda, metadatos ni duraciones **antes** de reproducir.
   El `title` solo se muestra si lo introduce el usuario (`title` opcional en
   `QUEUE_ITEM_ADD`); si es `null`, la UI muestra el `externalContentId`.
2. Confirmar la disponibilidad de un contenido sin cargarlo en el reproductor
   local: la única autoridad es el `onError` del cliente.
3. Garantizar que un contenido sea embebible: eso lo decide el propietario del
   video (errores 101/150).
4. Controlar la velocidad de reproducción de forma fiable (`playbackRate` de la
   IFrame API no es un control dinámico confiable; el `SyncEngine` usa seeks en
   su lugar — ver comentario en `apps/web/src/audio/sync-engine.ts`).
5. Eludir anuncios, restricciones de edad, verificación de origen o cualquier
   control del proveedor.

---

## 1.3. Límites de sincronización

La sincronización es **best-effort**, no garantizada al milisegundo:

- El servidor publica un ancla autoritativa (`anchor_position_ms` +
  `anchor_server_time_ms` en epoch ms) en `room_playback_state`.
- Cada cliente estima la hora del servidor con `PING`/`PONG` (base `Date.now()`,
  epoch) y calcula `targetPositionMs = anchorPositionMs +
  (estimatedServerNow − anchorServerTimeMs) * playbackRate`
  (`computeTargetPositionMs`, `packages/shared/src/sync.ts`).
- Umbrales implementados (`DEFAULT_DRIFT_THRESHOLDS`, valores **hipótesis** de §8):
  - `< 250 ms` → no actuar.
  - `250–750 ms` → corrección suave (seek mínimo al objetivo).
  - `≥ 750 ms` → seek duro al objetivo.
  - Enfriamiento de `3000 ms` entre correcciones; se salta la corrección si el
    reproductor está en `BUFFERING`.
- Fuentes de error inevitables: asimetría de red en el RTT, buffering local,
  suspensión de la pestaña, diferencias de codificación de audio entre
  navegadores y la propia latencia del evento de control.

**Conclusión:** la aplicación no afirma sincronía exacta; muestra la deriva
estimada en la UI (`deriva ≈ N ms` en `RoomPage`) y corrige con histéresis.

## 1.4. Límites de non-stop

- El fin de pista se detecta en **cada** cliente (`ENDED`). El servidor valida el
  reporte contra el item actual y lo resuelve de forma atómica e idempotente
  (`PlaybackService.next` con `expectedCurrentItemId`), de modo que **una sola**
  transición se aplica aunque 20 clientes reporten el final.
- Si un elemento no es reproducible, se marca `UNAVAILABLE`/`FAILED` y se salta.
- `MAX_ITEM_RETRIES` (por defecto 2) limita los reintentos antes de dar por
  terminal un elemento (`FAILED`).
- **La continuidad no está garantizada:** depende de que cada elemento sea
  embebible, de los anuncios insertados por YouTube y del autoplay del navegador.

## 1.5. Límites de anuncios

- La IFrame Player API reproduce la misma experiencia que YouTube, **anuncios
  incluidos**. No hay parámetro `playerVars` que los elimine (el reproductor se
  instancia con `controls: 0`, `modestbranding: 1`, `rel: 0` y
  `host: "https://www.youtube-nocookie.com"`, que **no** suprime publicidad).
- **Esta aplicación NO elude, NO bloquea, NO salta y NO modifica anuncios de
  YouTube**, ni manipula el DOM interno del reproductor, ni usa proxies ni
  extracción de audio (§2.4 del prompt). Ningún código de este repositorio
  implementa ni permite dichas prácticas.
- Si el producto necesita audio sin interrupciones publicitarias, debe integrarse
  una fuente autorizada (Opción C) con licencia compatibles; **no** se resolverá
  evadiendo las políticas de YouTube.

---

## 1.6. Recomendación y decisión ratificada

**Recomendación emitida: Opción B — sin Data API, con YouTube IFrame Player API oficial.**

**Decisión: RATIFICADA por el responsable del producto.** La puerta de viabilidad
de §2.3 queda cerrada con esta elección; la fase 0 se dio por superada y el MVP se
implementó sobre esta base.

Consecuencias explícitas de la ratificación:

1. **No se usa YouTube Data API v3** en ningún punto del código: no hay claves de
   API de YouTube, ni `googleapis`, ni peticiones a `youtube.com/api/*`.
2. Se usa la IFrame Player API oficial, cargada desde
   `https://www.youtube.com/iframe_api` por el navegador del usuario.
3. No se promete sincronización exacta, non-stop sin interrupciones ni ausencia
   de publicidad.
4. Todo contenido no embebible se marca `UNAVAILABLE` y se salta; la UI informa
   del motivo (códigos 2, 5, 100, 101, 150) en lugar de fingir reproducción.

### Advertencia de cumplimiento (obligatoria en toda la documentación)

> Esta integración **no elude ni pretende eludir** los anuncios, las restricciones
> de reproducción, los controles de acceso ni cualquier otra política de YouTube
> o de su proveedor. Antes de un uso comercial o de reproducción pública deben
> validarse los [Términos del Servicio de YouTube](https://www.youtube.com/t/terms),
> la [documentación de parámetros del reproductor](https://developers.google.com/youtube/player_parameters?hl=es)
> y la [referencia de la IFrame Player API](https://developers.google.com/youtube/iframe_api_reference?hl=es).

---

## 1.7. Verificación en el código

| Afirmación | Evidencia |
|---|---|
| Sin Data API | No hay dependencias de Google/YouTube en `apps/*/package.json`; ninguna llamada a la Data API en `apps/web/src` y `apps/server/src`. |
| IFrame Player API oficial | `loadYouTubeIframeApi()` en `apps/web/src/audio/youtube-adapter.ts:45` carga `https://www.youtube.com/iframe_api`. |
| Validación local de URL | `parseYouTubeUrl` en `packages/shared/src/youtube.ts`. |
| Errores 2/5/100/101/150 | `describeError` (`room-session.ts`) y conjunto `unavailableCodes` (`realtime-gateway.ts:482`). |
| Umbrales de deriva | `DEFAULT_DRIFT_THRESHOLDS` en `packages/shared/src/sync.ts:79`. |
| Idempotencia non-stop | `PlaybackService.next` con `expectedCurrentItemId` en `apps/server/src/modules/playback/playback-service.ts:114`. |
