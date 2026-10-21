# 6. Plan por fases, estimación y riesgos

> Documento: entregable 6 de §14 del prompt maestro.
> Estructura de fases tomada de §15 del prompt maestro.

---

## 6.1. Estado real de las fases

| Fase | Nombre | Estado | Evidencia en el repositorio |
|---|---|---|---|
| **0** | Descubrimiento y puerta de viabilidad | ✅ **Completada** | Informe `docs/01-viabilidad-youtube.md`; decisión **Opción B ratificada**; prototipo: `apps/web/src/audio/youtube-adapter.ts` (carga, play/pause/seek, lectura de posición/estado, errores). |
| **1** | Núcleo de salas | ✅ **Completada** | Auth (`auth-service.ts`), salas/invitaciones/roles (`rooms-service.ts`), WS + presencia + instantánea (`realtime-gateway.ts`, `presence-service.ts`, `room-state-service.ts`), cola persistente (`queue-service.ts` + migración 001). |
| **2** | Adaptador de fuente y reproducción | ✅ **Completada** | `YouTubeAdapter` + `AudioSourceAdapter`, validación de URL en cliente y servidor, comandos play/pause/seek/next, volumen local fuera del estado compartido. |
| **3** | Sincronización y non-stop | ✅ **Completada** | `room_playback_state` con anclas y `version`, `ClockSynchronizer` (PING/PONG), `SyncEngine` con umbrales, transición idempotente, repeat, `UNAVAILABLE`/`FAILED`, reconexión y gracia del anfitrión. |
| **4** | Endurecimiento | ✅ **Completada** | Rate limiting HTTP/WS, redacción de logs pino, health check, `.env.example`, pruebas automatizadas (36 server + 10 web + 6 shared), documentación de limitaciones externas (`docs/08-despliegue.md`). |
| **5** | Mejoras posteriores | ⏳ **Pendiente** | Nuevas fuentes autorizadas, funciones sociales, audio en vivo WebRTC/SFU (requiere aprobación de producto y revisión de privacidad/derechos). |

**Resultado:** el MVP (entregable 7 de §14) está implementado sobre las fases 0–4
resueltas; la fase 5 queda fuera del alcance actual.

### Trabajo pendiente identificado dentro de las fases 0–4

El contrato está completo (`PLAYER_ACTION_REQUIRED`, `PLAYBACK_PREVIOUS` y
`ROOM_LEAVE` implementados; `room_events` eliminada en la migración 003). Quedan
tareas operativas, no de funcionalidad:

- Pruebas de carga y de compatibilidad real entre navegadores (§Fase 4) **no
  están automatizadas** en el repositorio.
- Poda de `refresh_tokens` y `room_invites` (retención) sin tarea de limpieza
  programada.
- Multi-instancia (Redis pub/sub) y presencia compartida: fuera de alcance.

## 6.2. Estimación técnica (supuestos incluidos)

Estimaciones de esfuerzo relativo para un/agente full-stack con esta base,
expresadas en incrementos pequeños con pruebas. Son **estimaciones**, no
compromisos: el tiempo real depende del presupuesto y la infraestructura.

| Fase | Esfuerzo estimado | Pruebas asociadas | Supuestos |
|---|---|---|---|
| 0 — Viabilidad | 2–4 días | Prototipo manual en Chrome/Firefox/Safari | Acceso a navegador con reproducción real de YouTube; sin bloqueo de red. |
| 1 — Núcleo de salas | 5–8 días | `auth-rooms.test.ts`, parte de `realtime.test.ts` | PostgreSQL 14+ local; contrato WS fijado desde el inicio (`PROTOCOL_VERSION = 1`). |
| 2 — Adaptador y reproducción | 3–5 días | `room-session.test.ts` (reconciliación, errores) | La IFrame Player API no exige claves de API. |
| 3 — Sincronización y non-stop | 5–8 días | `realtime.test.ts`, `lifecycle.test.ts`, `shared.test.mjs` | Relojes con base epoch; una sola instancia de servidor. |
| 4 — Endurecimiento | 4–6 días | `services.test.ts` (rate limit, URL, permisos) | Los límites de frecuencia bastan en memoria para una instancia. |
| **MVP total** | **19–31 días** | 52 pruebas automatizadas | Sin WebRTC, sin Data API, sin móvil nativo. |
| 5 — Futuras mejoras | Estimar al definir alcance | — | Requiere decisión de producto previa. |

### Criterios de paso entre fases (§15)

- **0 → 1:** la IFrame Player API permite cargar, leer posición, play/pause/seek
  y detectar errores en el navegador objetivo. Si no se pudiera, no se implementa
  sincronización completa.
- **1 → 2:** salas, invitaciones, roles y cola persistente con pruebas en verde.
- **2 → 3:** comandos de reproducción reflejados en todos los clientes y volumen
  local aislado.
- **3 → 4:** transición idempotente demostrada con varios reportes simultáneos y
  deriva medida en cliente.
- **4 → 5:** solo si el producto lo aprueba.

## 6.3. Supuestos

1. **Una sola instancia del servidor.** Presencia, `RateLimiter` y el mapa de
   `transitionIds` son procesos en memoria; escalar a N instancias requeriría
   Redis pub/sub (§7.1 lo pospone hasta demostrar la necesidad).
2. **PostgreSQL gestionado o local con TLS en producción.** Sin réplica
   obligatoria para el MVP.
3. **El navegador del participante puede cargar `youtube.com/iframe_api`.**
   Bloqueadores/agregadores o redes corporativas pueden impedirlo.
4. **Autoplay:** los navegadores exigen un gesto del usuario; el producto asume
   el overlay "Toca reproducir" como experiencia normal.
5. **Sin claves de API de YouTube** ni cuota de Data API.
6. El audio se reproduce localmente; no hay coste de ancho de banda de streaming
   en el servidor.

## 6.4. Principales riesgos

| # | Riesgo | Impacto | Probabilidad | Mitigación implementada / recomendada |
|---|---|---|---|---|
| R1 | **Políticas de YouTube cambian** (embebido restringido, errores 100/101/150 masivos) | Alto: contenidos enteros dejan de reproducirse | Media | Monitorear la frecuencia de códigos `100/101/150` (log `player.error_reported`); degradar a cola no disponible (`UNAVAILABLE`) y saltar; procedimiento en `docs/08-despliegue.md`. No se implementa ninguna evasión. |
| R2 | **Autoplay bloqueado** por el navegador | Medio: cada dispositivo necesita un toque inicial | Alta | Overlay `needs-gesture` + `resumeLocalPlayback()`; el estado compartido no se altera por eso. |
| R3 | **Deriva entre navegadores** (diferencias de buffer/decodificación) | Medio: desfases visibles | Alta | Umbrales con histéresis y enfriamiento (`evaluateDrift`), visibilidad de deriva en UI, seeks suaves/duros. Umbrales declarados como hipótesis por validar. |
| R4 | **Una sola instancia del servidor** (caída total, memoria de limitadores) | Alto en caída; Medio en abuso | Media | Health check + reverse proxy con reinicio; rate limits en memoria suficientes para MVP; planificar Redis si se escala. |
| R5 | **Anuncios interrumpen la experiencia** | Medio (percepción de producto) | Alta | Comunicado como límite externo; **nunca** se eluden. |
| R6 | Re-join en bucle contra la ventana de gracia | Bajo | Baja | La gracia es idempotente (`reopenRoom` solo desde `SUSPENDED`), el vigilante cierra vencidas. |
| R7 | Doble avance de cola por reportes concurrentes | Alto | Baja | Transacción con `SELECT … FOR UPDATE` + `expectedCurrentItemId`; cubierto por `CA-03` en `realtime.test.ts`. |
| R8 | Fuerza bruta de tokens de invitación | Alto | Baja | Hash SHA-256 + `INVITE_RATE_*` (HTTP) y `JOIN_RATE_*` (WS) + expiración/revocación. |

## 6.5. Riesgos legales / de licencia / de reproducción

- **Licencia de contenido:** el uso queda sujeto a los Términos de Servicio de
  YouTube; validar antes de uso comercial o reproducción pública (§2.4 del prompt).
- **Sin garantía de disponibilidad:** cualquier vídeo puede dejar de ser
  embebible en cualquier momento.
- **Móvil:** reproducción en segundo plano y autoplay con audio están
  restringidos por iOS/Android; prever gesto manual y posible pausa del sistema.
