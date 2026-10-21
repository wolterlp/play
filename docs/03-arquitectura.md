# 3. Arquitectura

> Documento: entregable 3 de §14 del prompt maestro.

---

## 3.1. Vista general

```mermaid
flowchart LR
    subgraph Navegador["Navegador del participante"]
        subgraph Web["apps/web — React 18 + Vite"]
            UI["UI (páginas y paneles)"]
            RS["RoomSession + SyncEngine<br/>ClockSynchronizer + LocalAudioStore"]
            RC["RoomClient<br/>(socket.io-client)"]
            APIW["ApiClient<br/>(fetch + JWT)"]
        end
        YT["YouTube IFrame Player API<br/>(reproductor embebido, sin Data API)"]
    end

    subgraph Servidor["apps/server — Node 20 + Fastify 5"]
        HTTP["Rutas HTTP /api/*<br/>(zod + authGuard + rate limits)"]
        GW["RealtimeGateway (socket.io)<br/>validación zod + permisos"]
        SVC["AuthService · RoomsService · QueueService<br/>PlaybackService · PresenceService · RoomStateService"]
    end

    PG[("PostgreSQL<br/>(migraciones 001/002)")]
    SH["@play/shared<br/>esquemas zod, enums,<br/>permisos, sync, youtube"]

    UI --> RS
    RS --> RC
    UI --> APIW
    RS --> YT
    RC -- "evento 'message'" --> GW
    APIW -- "HTTPS /api" --> HTTP
    HTTP --> SVC
    GW --> SVC
    SVC --> PG
    RC -. usa .-> SH
    HTTP -. valida con .-> SH
    GW -. valida con .-> SH
    RS -. evaluateDrift .-> SH
```

**Aviso:** el servidor **nunca** recibe, almacena ni retransmite audio de YouTube.
Solo coordina metadatos, cola, permisos y estado de reproducción; el audio se
reproduce localmente en cada navegador.

## 3.2. Componentes y responsabilidades

### Servidor (`apps/server`)

| Módulo | Archivo | Responsabilidad |
|---|---|---|
| Configuración | `src/config.ts` | Carga y valida **todas** las variables de entorno con zod; falla al arrancar si falta una obligatoria. |
| App / composición | `src/app.ts` | Fastify + helmet + CORS + socket.io (path `/ws`), health check, manejador de errores central, timers de gracia y presencia. |
| HTTP | `src/http/routes.ts` | Todas las rutas `/api/*`, con zod, `authGuard` y rate limits. |
| Auth | `src/modules/auth/*` | Registro/login con argon2id, JWT de acceso (jose), refresh token opaco con hash SHA-256 y rotación. |
| Salas | `src/modules/rooms/rooms-service.ts` | CRUD de salas, membresías, roles, invitaciones (hash + expiración + revocación), gracia del anfitrión (RF-01). |
| Instantánea | `src/modules/rooms/room-state-service.ts` | Construye `ROOM_SNAPSHOT` (sala + miembros + cola + reproducción + permisos). |
| Cola | `src/modules/queue/queue-service.ts` | Posiciones, estados, compactación, selección del siguiente reproducible, reintentos. |
| Reproducción | `src/modules/playback/playback-service.ts` | Transiciones **atómicas e idempotentes** bajo `SELECT … FOR UPDATE`, anclas temporales, repeat, `UNAVAILABLE`. |
| Presencia | `src/modules/presence/presence-service.ts` | Conteo de sockets por usuario y estados `CONNECTED/RECONNECTING/DISCONNECTED` (en memoria). |
| Gateway WS | `src/modules/realtime/realtime-gateway.ts` | Autenticación del handshake, validación zod de cada mensaje, permisos, emisión de eventos, rate limiting, `transitionId` estable. |
| Seguridad | `src/security/*` | argon2id, tokens opacos, hash SHA-256, `RateLimiter` de ventana deslizante. |
| Datos | `src/db/*` | Pool `pg`, migraciones versionadas, mappers fila→contrato. |
| Observabilidad | `src/logger.ts` | pino con redacción de `authorization`, `password`, `token`, `refreshToken`, `accessToken`. |

### Cliente (`apps/web`)

| Módulo | Archivo | Responsabilidad |
|---|---|---|
| API | `src/api/api-client.ts` | `fetch` contra `VITE_API_BASE_URL` con `Authorization: Bearer`. |
| Tiempo real | `src/realtime/room-client.ts` | socket.io-client (path `/ws`, transporte websocket), valida cada mensaje entrante con `serverMessageSchema`, genera `requestId`. |
| Sesión | `src/realtime/room-session.ts` | Máquina de estado de sala: aplica mensajes, reconcilia el reproductor, timers de PING (5 s) y reporte de estado (5 s), `needsGesture`. |
| Hook | `src/realtime/use-room.ts` | Une `RoomClient` + sesión; **el re-join vive en `onConnect`** (cada reconexión reenvía `ROOM_JOIN`). |
| Adaptador | `src/audio/youtube-adapter.ts` | Carga la IFrame Player API y la envuelve en la interfaz `AudioSourceAdapter`. |
| Reloj | `src/audio/clock-synchronizer.ts` | Muestras PING/PONG → offset de reloj (base epoch `Date.now`). |
| Sincronía | `src/audio/sync-engine.ts` | Evalúa deriva a 1 s y aplica seek suave/hard con enfriamiento. |
| Audio local | `src/audio/local-audio-store.ts` | Volumen/mute locales persistidos en el navegador; **nunca** emiten eventos de red. |

### Contratos compartidos (`packages/shared`)

`enums.ts` (valores canónicos), `schemas.ts` (esquemas zod de **todos** los
mensajes WS y entidades), `permissions.ts` (fuente única de verdad de permisos),
`sync.ts` (offset de reloj y `evaluateDrift`), `youtube.ts` (parseo local de URL),
`types.ts` (tipos TypeScript derivados).

## 3.3. Flujo de eventos de una sala

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente (web)
    participant G as RealtimeGateway
    participant S as Servicios (DB)
    participant Y as Reproductor YouTube (local)

    Note over C: Reconexión / entrada
    C->>G: handshake con access token (auth.token)
    G-->>C: error UNAUTHENTICATED si falta o falla
    C->>G: ROOM_JOIN {protocolVersion, roomId}
    G->>S: requireMembership (+ joinLimiter)
    G->>S: reopenRoom si el anfitrión vuelve en gracia
    G->>S: buildSnapshot
    G-->>C: ROOM_SNAPSHOT
    G-->>otros: ROOM_MEMBER_JOINED

    Note over C,Y: Cola y reproducción
    C->>G: QUEUE_ITEM_ADD {sourceUrl}
    G->>S: addItem (parseYouTubeUrl + permisos)
    G-->>todos: QUEUE_ITEM_ADDED
    C->>G: PLAYBACK_PLAY
    G->>S: playback.play (FOR UPDATE, ancla + version+1)
    G-->>todos: PLAYBACK_STATE_UPDATED + QUEUE_UPDATED
    Y->>Y: loadVideoById + playVideo (o needsGesture)

    Note over C,S: Sincronización continua
    loop cada 5 s / 1 s
        C->>G: PING {clientTimeMs}
        G-->>C: PONG {clientTimeMs, serverTimeMs}
        C->>G: PLAYER_STATUS_REPORT
        G-->>C: PLAYBACK_SYNC_TARGET {targetPositionMs…}
        C->>C: evaluateDrift → NONE / SOFT_CORRECTION / HARD_SEEK
    end

    Note over C,S: Non-stop (fin de pista)
    Y-->>C: ENDED
    C->>G: PLAYBACK_NEXT {reason: ENDED, failedQueueItemId}
    G->>S: next() idempotente (¿item actual sigue igual?)
    alt hubo transición
        G-->>todos: NONSTOP_TRANSITION_STARTED {transitionId}
        G-->>todos: PLAYBACK_STATE_UPDATED + QUEUE_UPDATED
    else estado obsoleto
        G-->>C: (silencio) transición ignorada
    end

    Note over C,G: Errores del reproductor
    Y-->>C: onError(100|101|150)
    C->>G: PLAYER_ERROR {fatal: true}
    G->>S: reportUnavailable → avanza
    G-->>todos: PLAYBACK_STATE_UPDATED + QUEUE_UPDATED

    Note over C,G: Desconexión / gracia del anfitrión
    C--xG: disconnect
    G-->>todos: ROOM_MEMBER_LEFT
    G->>S: suspendForHostDisconnect (si el que se va es el dueño)
    G-->>todos: ROOM_UPDATED {reason: HOST_DISCONNECTED}
    C->>G: ROOM_JOIN (reintento automático)
    G-->>todos: ROOM_UPDATED {reason: HOST_RECONNECTED}
    Note over S: Si vence la gracia: CLOSE + ROOM_CLOSED (HOST_GRACE_EXPIRED)
```

### Flujo resumido por fases

1. **Join** — autenticación en el handshake → `ROOM_JOIN` → membresía o
   invitación válida → `socket.join("room:<id>")` → `ROOM_SNAPSHOT` al entrante y
   `ROOM_MEMBER_JOINED` al resto.
2. **Snapshot** — sala, miembros (con estado de presencia), cola completa,
   estado de reproducción y `you.permissions` calculados **en el servidor**.
3. **Cola** — mutaciones validadas por permisos y resueltas en transacción; el
   orden se reenvía completo (`QUEUE_UPDATED`) para evitar divergencias.
4. **Play** — transición atómica bajo bloqueo de fila, nueva `version`, ancla
   (`anchor_position_ms`, `anchor_server_time_ms = Date.now()`).
5. **Sync** — PING/PONG + reportes; posición objetivo y correcciones en cliente.
6. **Non-stop** — `ENDED`/`ERROR` desde cualquier cliente, una sola transición,
   repeat `ALL`/`ONE`, salto de `UNAVAILABLE`.
7. **Reconexión/gracia** — re-join automático, presencia `RECONNECTING` →
   `DISCONNECTED`, suspensión y cierre de salas con gracia vencida.

## 3.4. Principios de autoridad (§7.3)

- **El servidor es autoritativo** para sala, permisos, cola, transiciones globales
  y la versión del estado. Toda mutación pasa por sus validaciones.
- **El reproductor local es autoritativo** para los eventos observables de ese
  cliente: `PLAYER_READY`, `PLAYER_STATUS_REPORT`, `PLAYER_ERROR` y el fin de
  pista. El servidor los contrasta contra el estado actual antes de actuar.
- **El volumen y el silencio nunca salen del cliente.** No existen mensajes de red
  `LOCAL_VOLUME_CHANGED` / `LOCAL_MUTE_CHANGED`.

## 3.5. Decisiones técnicas y alternativas descartadas

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| Socket.IO sobre HTTP (`path: "/ws"`) | WebSocket nativo | Reconexión, transporte y namespaces documentados; contrato único de eventos. |
| Estado compartido con anclas + versión | Mensajes "seek a X" a cada cliente | Permite que un cliente que llega tarde calcule su posición sin replay de eventos. |
| Presencia y rate limits en memoria | Redis desde el inicio | §7.1 prohíbe añadir infraestructura sin necesidad demostrada; el MVP es de **una** instancia. |
| Refresh token opaco + rotación | Sesión en cookie httpOnly | El access token se necesita también en el header del handshake WS. |
| Validación zod compartida | Tipos solo en TS | El servidor valida bytes de red reales; el cliente descarta mensajes malformados. |
| IFrame Player API (Opción B) | Data API / iframe simple | Ver `docs/01-viabilidad-youtube.md`. |
