# 2. PRD — Play: plataforma de salas musicales sincronizadas

> Documento: entregable 2 de §14 del prompt maestro.
> Versión del MVP: 0.1.0 (fases 0–4 completadas, ver `docs/06-plan-fases.md`).

---

## 2.1. Problema

Personas en dispositivos y lugares distintos quieren escuchar la **misma** música
**a la vez**, sin que una sola persona tenga que retransmitir su audio. El
producto coordina *qué* se escucha y *en qué punto*; cada dispositivo reproduce
localmente desde la fuente autorizada y controla su propio volumen.

## 2.2. Alcance (dentro del MVP)

1. Registro e inicio de sesión por email/contraseña con access/refresh tokens.
2. Crear, editar, cerrar y eliminar salas con permisos validados en servidor.
3. Invitaciones por enlace con expiración, revocación y límite por sala.
4. Unirse por enlace HTTP o directamente por WebSocket; ver participantes y su
   estado de conexión (`CONNECTED` / `RECONNECTING` / `DISCONNECTED`).
5. Agregar contenido pegando una URL de YouTube (validación local de URL, sin
   scraping ni Data API).
6. Cola compartida persistente: agregar, eliminar, reordenar y saltar.
7. Control de reproducción según el modo de sala
   (`HOST_ONLY`, `COLLABORATIVE`, `COLLABORATIVE_QUEUE_HOST_PLAYBACK`).
8. Reproducción sincronizada *best-effort* con corrección de deriva
   (seek suave/hard) y medición visible de desviación.
9. Modo *non-stop* con transición idempotente, reintentos limitados, política de
   repetición (`OFF`/`ALL`/`ONE`) y salto de elementos no disponibles.
10. Volumen 0–100 y silencio **locales e independientes** por dispositivo.
11. Reconexión automática con recuperación de estado (re-join en cada
    reconexión) y gracia del anfitrión (RF-01).
12. Errores visibles: enlace inválido, contenido no disponible, reproducción
    bloqueada por autoplay, red caída, sala cerrada.
13. Interfaz responsive con estados de carga, vacío, error y reconexión.
14. Rate limiting en HTTP y WebSocket, logs estructurados con redacción de
    secretos, health check.

## 2.3. Actores

| Actor | Descripción | Capacidades típicas |
|---|---|---|
| **Anfitrión** (`HOST`) | Crea y es dueño de la sala. | Editar nombre/privacidad/modo de control/repeat/non-stop/máx. participantes, cerrar y eliminar sala, gestionar invitaciones y miembros, controlar reproducción. |
| **DJ / Editor** (`DJ`) | Rol concedido por el anfitrión. | Controlar reproducción y gestionar la cola; no gestiona sala, invitaciones ni miembros. |
| **Participante** (`PARTICIPANT`) | Miembro normal. | Escuchar, agregar a la cola (según modo), y controlar reproducción solo si el modo es `COLLABORATIVE`. |
| **Observador** (`OBSERVER`) | Miembro de solo lectura. | Puede agregar a la cola (salvo en `HOST_ONLY`) pero **nunca** controla la reproducción. |

> Los roles son exactamente `HOST`, `DJ`, `PARTICIPANT`, `OBSERVER`
> (`packages/shared/src/enums.ts`). El dueño de la sala se identifica además con
> `rooms.owner_user_id` y no puede perder ni delegar ese rol.

## 2.4. Casos de uso

| # | Caso de uso | Actor | Flujo resumido |
|---|---|---|---|
| CU-01 | Registrarse | Visitante | `POST /api/auth/register` → access + refresh token. |
| CU-02 | Iniciar sesión | Usuario | `POST /api/auth/login`; refresco con `POST /api/auth/refresh` (rotación). |
| CU-03 | Crear sala | Usuario autenticado | `POST /api/rooms` → el creador entra como `HOST`; se crea `room_playback_state` en `QUEUE_EMPTY`. |
| CU-04 | Editar sala | Anfitrión | `PATCH /api/rooms/:roomId` → `ROOM_UPDATED` con `SETTINGS_CHANGED`. |
| CU-05 | Cerrar sala | Anfitrión | `POST /api/rooms/:roomId/close` → `ROOM_CLOSED` (`HOST_CLOSED`). |
| CU-06 | Eliminar sala | Anfitrión | `DELETE /api/rooms/:roomId` → `ROOM_CLOSED` (`HOST_DELETED`) + borrado en cascada. |
| CU-07 | Crear invitación | Anfitrión | `POST /api/rooms/:roomId/invites` → token opaco de 256 bits, se devuelve **una sola vez** en claro. |
| CU-08 | Revocar invitación | Anfitrión | `POST /api/rooms/:roomId/invites/:inviteId/revoke`. |
| CU-09 | Validar invitación | Cualquiera | `GET /api/invites/:token` (rate limit por IP). |
| CU-10 | Unirse por enlace | Usuario autenticado | `POST /api/invites/:token/join` → `roomId` + rol; después `ROOM_JOIN` por WS. |
| CU-11 | Unirse por WS | Miembro | `ROOM_JOIN` con `roomId` → `ROOM_SNAPSHOT` (la invitación se resolvió por HTTP antes). Re-join automático en cada reconexión; `ROOM_LEAVE` para salir conservando la membresía. |
| CU-12 | Agregar contenido | Miembro con permiso | `QUEUE_ITEM_ADD` con URL → validación local + servidor → `QUEUE_ITEM_ADDED`. |
| CU-13 | Reordenar/eliminar elemento | Miembro con permiso | `QUEUE_ITEM_MOVE` / `QUEUE_ITEM_REMOVE` → `QUEUE_UPDATED`. |
| CU-14 | Reproducir/pausar/seek | Miembro con `canControlPlayback` | `PLAYBACK_PLAY` / `PLAYBACK_PAUSE` / `PLAYBACK_SEEK` → `PLAYBACK_STATE_UPDATED` con `version+1`. |
| CU-15 | Saltar de canción | Miembro con permiso | `PLAYBACK_NEXT` con `reason: "USER"`. `PLAYBACK_PREVIOUS` salta a la pista anterior reproducible o reinicia la actual (<3 s). |
| CU-16 | Fin de pista (non-stop) | Cualquier cliente | `PLAYBACK_NEXT` con `reason: "ENDED"` → **una** transición idempotente + `NONSTOP_TRANSITION_STARTED`. |
| CU-17 | Reportar error del reproductor | Cualquier cliente | `PLAYER_ERROR`; si es fatal y el código ∈ {2,5,100,101,150} → `UNAVAILABLE` + avance. |
| CU-18 | Sincronizar reloj | Cualquier cliente | `PING` cada 5 s → `PONG`; estimación de offset (NTP simplificado). |
| CU-19 | Medir/corregir deriva | Cualquier cliente | `PLAYER_STATUS_REPORT` cada 5 s → `PLAYBACK_SYNC_TARGET`; `SyncEngine` corrige a los 1 s. |
| CU-20 | Ajustar volumen local | Cualquier participante | Cambio **solo local** (`LocalAudioStore`), nunca emite eventos de red. |
| CU-21 | Desconectar el anfitrión | Sistema | Sala → `SUSPENDED` con `host_grace_until`; `ROOM_UPDATED` (`HOST_DISCONNECTED`); al volver `HOST_RECONNECTED`. |
| CU-22 | Vencer la gracia | Sistema (timer) | Vigilante cada `HOST_SWEEP_INTERVAL_MS` cierra la sala → `ROOM_CLOSED` (`HOST_GRACE_EXPIRED`). |
| CU-23 | Gestionar miembros | Anfitrión | `POST .../members/:userId/role`, `DELETE .../members/:userId`. |
| CU-24 | Resolver autoplay bloqueado | Participante | UI muestra "Toca reproducir"; `resumeLocalPlayback()` tras el gesto. |

## 2.5. Fuera de alcance (exclusiones explícitas)

- **Sin WebRTC ni audio en vivo**: no se retransmite micrófono/escritorio, no hay
  SFU/mezcla de audio (§3.2 y §7.1 del prompt).
- **Sin YouTube Data API v3**: ninguna clave ni endpoint de la Data API; ver
  `docs/01-viabilidad-youtube.md`.
- **Sin aplicación móvil nativa**: solo web responsive (React + Vite).
- **Sin Redis ni multi-instancia en el MVP**: presencia, rate limiting y
  `transitionIds` viven en memoria de **una sola** instancia del servidor
  (`PresenceService`, `RateLimiter`). Escalar exigiría pub/sub (fuera de alcance).
- Sin catálogo propio, scraping, descarga o proxy de audio.
- Sin pagos, suscripciones ni planes.
- Sin bloqueo/elusión de anuncios ni de políticas de la fuente.

## 2.6. Criterios de aceptación de referencia

Ver `docs/07-pruebas.md` para el mapeo CA-01…CA-07 ↔ pruebas automatizadas.
