# 4. Contratos de API HTTP y WebSocket

> Documento: entregable 4 de §14 del prompt maestro.
> Fuente de verdad: `apps/server/src/http/routes.ts` (HTTP) y
> `packages/shared/src/schemas.ts` (mensajes WS).
> Versión de protocolo: `PROTOCOL_VERSION = 1`.

---

## 4.1. Convenciones generales

- **Transporte HTTP:** `Content-Type: application/json`. Rutas autenticadas usan
  `Authorization: Bearer <accessToken>`.
- **Errores HTTP:** siempre con el cuerpo

  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "Datos de entrada inválidos.", "details": {} } }
  ```

  `details` es opcional. Los errores de validación de zod devuelven
  `details = error.flatten()`.
- **Transporte WebSocket:** Socket.IO con `path: "/ws"`, transporte `websocket`.
  **Todos** los mensajes van en el **mismo evento** llamado `"message"`, tanto del
  cliente al servidor como del servidor al cliente. El payload es el objeto JSON
  completo (incluido el campo `type`).
- **Handshake:** se exige `auth: { token: "<accessToken>"}` (alternativamente
  `?token=`). Sin token válido el servidor responde `connect_error` con
  `data.code = "UNAUTHENTICATED"` y no se abre la conexión.
- **Idempotencia / correlación:** los mensajes del cliente pueden llevar
  `requestId` (1–64 caracteres). El servidor lo devuelve en `ROOM_ERROR`.
  El cliente web genera `req-<epoch>-<contador>` en `RoomClient.send`.
- **Validación:** cada mensaje entrante se valida con `clientMessageSchema`
  (zod, unión discriminada por `type`); cada mensaje saliente se valida con
  `serverMessageSchema` en el cliente (`room-client.ts`). Un mensaje inválido no
  tumba la conexión: se responde `ROOM_ERROR` (entrada) o se descarta (salida).

## 4.2. Rutas HTTP

### Autenticación

| Método | Path | Auth | Rate limit | Descripción |
|---|---|---|---|---|
| POST | `/api/auth/register` | No | `AUTH_RATE_MAX`/`AUTH_RATE_WINDOW_MS` por IP | Registro. |
| POST | `/api/auth/login` | No | `AUTH_RATE_MAX`/`AUTH_RATE_WINDOW_MS` por IP | Login. |
| POST | `/api/auth/refresh` | No (body) | — | Rotación del refresh token. |
| POST | `/api/auth/logout` | No (body) | — | Revoca el refresh token. |

**POST `/api/auth/register`**

```json
// request
{ "email": "ana@ejemplo.com", "password": "contrasena-larga-10", "displayName": "Ana" }
```

Validación: `email` (email, ≤254), `password` (10–200), `displayName` (1–60).

```json
// 200
{
  "user": { "id": "9f2c…", "displayName": "Ana", "email": "ana@ejemplo.com" },
  "tokens": { "accessToken": "eyJhbG…", "refreshToken": "abc…", "expiresInMs": 900000 }
}
```

Errores: `409 CONFLICT` (email duplicado), `400 VALIDATION_ERROR`, `429 RATE_LIMITED`.

**POST `/api/auth/login`** — body `{ "email": "...", "password": "..." }`; misma
respuesta. Errores: `401 UNAUTHENTICATED` (*Credenciales inválidas*), `429 RATE_LIMITED`.

**POST `/api/auth/refresh`** — body `{ "refreshToken": "..." }` → misma forma que
login. El refresh token anterior queda revocado (rotación). Error: `401 UNAUTHENTICATED`.

**POST `/api/auth/logout`** — body `{ "refreshToken": "..." }` → `{ "ok": true }`.

### Salas

| Método | Path | Auth | Permiso | Rate limit |
|---|---|---|---|---|
| GET | `/api/rooms` | Bearer | — | — |
| POST | `/api/rooms` | Bearer | — | `ROOM_RATE_MAX`/`ROOM_RATE_WINDOW_MS` por usuario |
| GET | `/api/rooms/:roomId` | Bearer | miembro | — |
| PATCH | `/api/rooms/:roomId` | Bearer | `canManageRoom` | — |
| POST | `/api/rooms/:roomId/close` | Bearer | `canManageRoom` | — |
| DELETE | `/api/rooms/:roomId` | Bearer | `canManageRoom` | — |

**POST `/api/rooms`**

```json
// request (todos opcionales salvo name)
{
  "name": "Viernes de rock",
  "privacyMode": "PRIVATE",
  "controlMode": "COLLABORATIVE",
  "nonstopEnabled": true,
  "repeatMode": "OFF",
  "maxParticipants": 20
}
```

Defaults: `PRIVATE`, `COLLABORATIVE`, `true`, `OFF`, `20`. Límites de zod:
`name` 1–80, `maxParticipants` 2–200.

```json
// 200
{
  "room": {
    "id": "aaaa…", "name": "Viernes de rock", "privacyMode": "PRIVATE",
    "controlMode": "COLLABORATIVE", "nonstopEnabled": true, "repeatMode": "OFF",
    "maxParticipants": 20, "status": "OPEN", "ownerUserId": "9f2c…",
    "participantCount": 1, "createdAt": "2026-10-20T18:00:00.000Z", "role": "HOST"
  }
}
```

**GET `/api/rooms`** → `{ "rooms": [ <room con role>, … ] }` (máx. 100, orden
`created_at DESC`). Cada elemento es `roomSummary + { "role": "HOST" }`.

**GET `/api/rooms/:roomId`**

```json
{
  "room": { "id": "aaaa…", "name": "Viernes de rock", "privacyMode": "PRIVATE",
            "controlMode": "COLLABORATIVE", "nonstopEnabled": true,
            "repeatMode": "OFF", "maxParticipants": 20, "status": "OPEN",
            "ownerUserId": "9f2c…", "participantCount": 3,
            "createdAt": "2026-10-20T18:00:00.000Z" },
  "role": "HOST",
  "permissions": { "canManageRoom": true, "canManageInvites": true,
                   "canManageMembers": true, "canAddToQueue": true,
                   "canRemoveFromQueue": true, "canReorderQueue": true,
                   "canControlPlayback": true }
}
```

Errores: `404 NOT_FOUND` (sala inexistente), `403 FORBIDDEN` (no es miembro).

**PATCH `/api/rooms/:roomId`** — body con los campos a cambiar (mismas
validaciones que la creación, todos opcionales). Devuelve `{ "room": … }` y el
servidor emite `ROOM_UPDATED` con `reason: "SETTINGS_CHANGED"`.
Error `400 VALIDATION_ERROR` si el body está vacío (*No hay campos para actualizar*).

**POST `/api/rooms/:roomId/close`** → `{ "ok": true }` + `ROOM_CLOSED` (`HOST_CLOSED`).
**DELETE `/api/rooms/:roomId`** → `{ "ok": true }` + `ROOM_CLOSED` (`HOST_DELETED`).

### Invitaciones

| Método | Path | Auth | Rate limit |
|---|---|---|---|
| POST | `/api/rooms/:roomId/invites` | Bearer + `canManageInvites` | `INVITE_RATE_MAX`/`INVITE_RATE_WINDOW_MS` por usuario |
| GET | `/api/rooms/:roomId/invites` | Bearer + `canManageInvites` | — |
| POST | `/api/rooms/:roomId/invites/:inviteId/revoke` | Bearer + `canManageInvites` | — |
| GET | `/api/invites/:token` | No | `INVITE_RATE_*` por IP |
| POST | `/api/invites/:token/join` | Bearer | — |

**POST `/api/rooms/:roomId/invites`**

```json
{
  "invite": {
    "id": "bbbb…", "roomId": "aaaa…",
    "expiresAt": "2026-10-27T18:00:00.000Z", "revokedAt": null,
    "createdAt": "2026-10-20T18:00:00.000Z",
    "token": "PELIGRO-se-devuelve-solo-una-vez",
    "joinUrl": "/join/PELIGRO-se-devuelve-solo-una-vez"
  }
}
```

El token existe **solo** en esta respuesta: en BD se guarda `token_hash`
(SHA-256). Límite: `MAX_INVITES_PER_ROOM` activas por sala → `409 CONFLICT`.

**GET `/api/rooms/:roomId/invites`** → `{ "invites": [ { "id", "roomId", "expiresAt", "revokedAt", "createdAt" } ] }`
(sin `token`, máx. 100).

**POST `…/invites/:inviteId/revoke`** → `{ "ok": true }`;
`404 NOT_FOUND` si no existe o ya estaba revocada.

**GET `/api/invites/:token`** → `{ "valid": true, "roomId": "aaaa…" }`.
Errores: `404 INVITE_INVALID`, `410 INVITE_EXPIRED`, `410 INVITE_REVOKED`, `429 RATE_LIMITED`.

**POST `/api/invites/:token/join`** → `{ "roomId": "aaaa…", "role": "PARTICIPANT" }`
(idempotente si ya era miembro). Errores: `409 ROOM_FULL`, `409 ROOM_CLOSED`, `404 INVITE_INVALID`.

### Miembros

| Método | Path | Auth | Permiso |
|---|---|---|---|
| POST | `/api/rooms/:roomId/members/:userId/role` | Bearer | `canManageMembers` |
| DELETE | `/api/rooms/:roomId/members/:userId` | Bearer | `canManageMembers` |

- Body del rol: `{ "role": "DJ" | "PARTICIPANT" | "OBSERVER" | "HOST" }`.
  El servidor rechaza `HOST` (*No se puede asignar el rol de anfitrión*), rechaza
  tocar al `owner_user_id` y responde `404 NOT_FOUND` si el miembro no está activo.
- `DELETE` marca `left_at` (no borra la fila); no se puede expulsar al dueño.
- Ambos → `{ "ok": true }`.

### Salud

**GET `/api/health`** (sin auth)

```json
{ "status": "ok", "database": true, "uptimeSeconds": 128, "timestamp": "2026-10-20T18:02:00.000Z" }
```

`status` es `"degraded"` cuando falla `SELECT 1` contra la base de datos.

## 4.3. Códigos de error (`AppError`)

Fuente: `apps/server/src/errors.ts`.

| code | HTTP | Significado habitual |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Esquema zod inválido, mensaje WS inválido, protocolo incompatible, body vacío. |
| `UNAUTHENTICATED` | 401 | Falta/inválido el Bearer, credenciales mal, sesión expirada. |
| `FORBIDDEN` | 403 | Sin permiso (`canControlPlayback`, `canAddToQueue`, …), no es miembro, no estás en sala. |
| `NOT_FOUND` | 404 | Sala, miembro, elemento o invitación inexistente. |
| `CONFLICT` | 409 | Email duplicado, límite de invitaciones activas, no se puede borrar/reordenar el `CURRENT`, pausa sin contenido. |
| `ROOM_CLOSED` | 409 | Sala `CLOSED` o gracia vencida. |
| `ROOM_FULL` | 409 | `max_participants` alcanzado. |
| `INVITE_INVALID` | 404 | Token desconocido. |
| `INVITE_EXPIRED` | 410 | `expires_at` superado. |
| `INVITE_REVOKED` | 410 | `revoked_at` no nulo. |
| `INVALID_SOURCE_URL` | 422 | `parseYouTubeUrl` devuelve `null`. |
| `RATE_LIMITED` | 429 | Cualquier `RateLimiter` agotado. |
| `INTERNAL_ERROR` | 500 | Fallo no clasificado (el mensaje real **no** se expone). |

En WebSocket el mismo código llega dentro de `ROOM_ERROR`.

## 4.4. Mensajes cliente → servidor

Todos validados con `clientMessageSchema`. Campos opcionales según `envelope`:
`requestId?: string (1–64)`.

| type | Campos | Notas |
|---|---|---|
| `ROOM_JOIN` | `protocolVersion`, `roomId?` | `protocolVersion` debe ser `1`. El acceso por invitación se resuelve **antes** por HTTP (`POST /api/invites/:token/join`); por WS solo se envía `roomId` (o nada para re-entrar a la última sala del socket). |
| `ROOM_LEAVE` | `roomId` | Sale de la sala (canal + presencia); la membresía se conserva. |
| `QUEUE_ITEM_ADD` | `roomId`, `sourceUrl` (URL, ≤2048), `title?` (≤200) | |
| `QUEUE_ITEM_REMOVE` | `roomId`, `queueItemId` | |
| `QUEUE_ITEM_MOVE` | `roomId`, `queueItemId`, `toPosition` (≥0) | |
| `PLAYBACK_PLAY` | `roomId`, `positionMs?` | |
| `PLAYBACK_PAUSE` | `roomId`, `positionMs?` | |
| `PLAYBACK_SEEK` | `roomId`, `positionMs` | |
| `PLAYBACK_NEXT` | `roomId`, `reason` (`USER`/`ENDED`/`ERROR`, default `USER`), `failedQueueItemId?` | |
| `PLAYBACK_PREVIOUS` | `roomId` | Salta a la pista anterior reproducible; si la actual lleva <3 s o no hay anterior, la reinicia. Sin contenido → `CONFLICT`. |
| `PLAYER_READY` | `roomId` | Actualiza `last_seen_at`. |
| `PLAYER_STATUS_REPORT` | `roomId`, `report` (`{ queueItemId }`) | El item actual se deriva del estado del servidor; el reporte solo acredita en qué pista está el cliente. |
| `PLAYER_ERROR` | `roomId`, `queueItemId` (uuid o `null`), `code` (≤64), `message` (≤512), `fatal` (default `false`) | |
| `PING` | `clientTimeMs` | Debe ser epoch ms (`Date.now()`). |

### Ejemplos

```json
{ "type": "ROOM_JOIN", "protocolVersion": 1, "roomId": "11111111-1111-4111-8111-111111111111", "requestId": "req-1729450000000-1" }
```

```json
{ "type": "QUEUE_ITEM_ADD", "roomId": "11111111-1111-4111-8111-111111111111",
  "sourceUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Canción de prueba",
  "requestId": "req-1729450000000-3" }
```

```json
{ "type": "PLAYBACK_PLAY", "roomId": "11111111-1111-4111-8111-111111111111", "positionMs": 0,
  "requestId": "req-1729450000000-4" }
```

```json
{ "type": "PLAYBACK_NEXT", "roomId": "11111111-1111-4111-8111-111111111111",
  "reason": "ENDED", "failedQueueItemId": "33333333-3333-4333-8333-333333333333",
  "requestId": "req-1729450000000-5" }
```

```json
{ "type": "PLAYER_STATUS_REPORT", "roomId": "11111111-1111-4111-8111-111111111111",
  "report": { "queueItemId": "33333333-3333-4333-8333-333333333333" },
  "requestId": "req-1729450000500-1" }
```

`queueItemId` puede ser `null` (el cliente aún no tiene item cargado). El
servidor solo responde con un objetivo si coincide con el item actual.

```json
{ "type": "PLAYER_ERROR", "roomId": "11111111-1111-4111-8111-111111111111",
  "queueItemId": "33333333-3333-4333-8333-333333333333",
  "code": "100", "message": "El contenido no está disponible (eliminado o privado).", "fatal": true }
```

```json
{ "type": "PING", "clientTimeMs": 1729450000000 }
```

## 4.5. Mensajes servidor → cliente

| type | Campos | Cuándo |
|---|---|---|
| `ROOM_SNAPSHOT` | `snapshot` | Tras un `ROOM_JOIN` aceptado (solo al entrante). El `snapshot.serverTimeMs` permite el bootstrap de reloj antes de la primera muestra PING/PONG. |
| `ROOM_MEMBER_JOINED` | `member`, `version` | A los demás miembros al entrar alguien. |
| `ROOM_MEMBER_LEFT` | `userId`, `version` | Al salir o desconectar (el miembro queda `DISCONNECTED`, no se elimina). |
| `ROOM_UPDATED` | `room`, `reason` | `SETTINGS_CHANGED` (PATCH), `HOST_DISCONNECTED`, `HOST_RECONNECTED`. |
| `ROOM_CLOSED` | `roomId`, `reason` | `HOST_CLOSED`, `HOST_DELETED`, `HOST_GRACE_EXPIRED`. |
| `QUEUE_UPDATED` | `queue[]`, `version` | Tras quitar/mover/play/next/disponible. |
| `QUEUE_ITEM_ADDED` | `item`, `version` | Al agregar un elemento. |
| `PLAYBACK_STATE_UPDATED` | `playback`, `currentItem` | Tras play/pause/seek/next/previo. |
| `PLAYBACK_SYNC_TARGET` | `target` (`{ queueItemId, targetPositionMs, serverTimeMs }`) | Respuesta a `PLAYER_STATUS_REPORT` (solo si el reporte es del item actual). |
| `NONSTOP_TRANSITION_STARTED` | `fromQueueItemId`, `toQueueItemId`, `transitionId` | Transición por `ENDED`/`ERROR` (no por `USER`). |
| `PLAYER_ACTION_REQUIRED` | `reason`, `message` | Al unirse a una sala que está reproduciendo (`USER_GESTURE_REQUIRED`). El cliente también lo genera localmente al bloquearse el autoplay. |
| `ROOM_ERROR` | `code`, `message`, `requestId?`, `details?` | Respuesta a cualquier mensaje fallido. |
| `PONG` | `clientTimeMs`, `serverTimeMs` | Respuesta a `PING`. |

### Ejemplos

`ROOM_SNAPSHOT` (`snapshot` según `roomSnapshotSchema`):

```json
{
  "type": "ROOM_SNAPSHOT",
  "snapshot": {
    "protocolVersion": 1,
    "room": { "id": "11111111-1111-4111-8111-111111111111", "name": "Viernes de rock",
              "privacyMode": "PRIVATE", "controlMode": "COLLABORATIVE",
              "nonstopEnabled": true, "repeatMode": "OFF", "maxParticipants": 20,
              "status": "OPEN", "ownerUserId": "22222222-2222-4222-8222-222222222222",
              "participantCount": 2, "createdAt": "2026-10-20T18:00:00.000Z" },
    "members": [
      { "userId": "22222222-2222-4222-8222-222222222222", "displayName": "Ana",
        "role": "HOST", "connectionState": "CONNECTED",
        "joinedAt": "2026-10-20T18:00:00.000Z", "lastSeenAt": "2026-10-20T18:05:00.000Z" },
      { "userId": "9f2cccc…", "displayName": "Luis", "role": "PARTICIPANT",
        "connectionState": "RECONNECTING",
        "joinedAt": "2026-10-20T18:01:00.000Z", "lastSeenAt": "2026-10-20T18:06:00.000Z" }
    ],
    "queue": [
      { "id": "33333333-3333-4333-8333-333333333333", "roomId": "11111111-1111-4111-8111-111111111111",
        "position": 0, "sourceType": "YOUTUBE",
        "sourceUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "externalContentId": "dQw4w9WgXcQ", "title": "Canción de prueba",
        "status": "CURRENT", "addedBy": "22222222-2222-4222-8222-222222222222",
        "addedByDisplayName": "Ana",
        "createdAt": "2026-10-20T18:03:00.000Z", "updatedAt": "2026-10-20T18:05:00.000Z" }
    ],
    "playback": {
      "roomId": "11111111-1111-4111-8111-111111111111", "sourceType": "YOUTUBE",
      "currentQueueItemId": "33333333-3333-4333-8333-333333333333",
      "playbackStatus": "PLAYING", "anchorPositionMs": 42150,
      "anchorServerTimeMs": 1729450000123, "playbackRate": 1,
      "version": 7, "updatedBy": "22222222-2222-4222-8222-222222222222",
      "updatedAt": "2026-10-20T18:05:00.000Z"
    },
    "you": { "userId": "9f2cccc…", "role": "PARTICIPANT",
             "permissions": { "canManageRoom": false, "canManageInvites": false,
                              "canManageMembers": false, "canAddToQueue": true,
                              "canRemoveFromQueue": true, "canReorderQueue": true,
                              "canControlPlayback": true } },
    "serverTimeMs": 1729450000123
  }
}
```

`PLAYBACK_STATE_UPDATED`:

```json
{ "type": "PLAYBACK_STATE_UPDATED",
  "playback": { "roomId": "11111111-1111-4111-8111-111111111111", "sourceType": "YOUTUBE",
                "currentQueueItemId": "33333333-3333-4333-8333-333333333333",
                "playbackStatus": "PAUSED", "anchorPositionMs": 42150,
                "anchorServerTimeMs": 1729450001000, "playbackRate": 1,
                "version": 8, "updatedBy": "22222222-2222-4222-8222-222222222222",
                "updatedAt": "2026-10-20T18:06:41.000Z" },
  "currentItem": { "id": "33333333-3333-4333-8333-333333333333", "status": "CURRENT",
                   "position": 0, "title": "Canción de prueba", "…": "…" } }
```

`PLAYBACK_SYNC_TARGET` (respuesta a `PLAYER_STATUS_REPORT`):

```json
{ "type": "PLAYBACK_SYNC_TARGET",
  "target": { "queueItemId": "33333333-3333-4333-8333-333333333333",
              "targetPositionMs": 47150, "serverTimeMs": 1729450005123 } }
```

`NONSTOP_TRANSITION_STARTED`:

```json
{ "type": "NONSTOP_TRANSITION_STARTED",
  "fromQueueItemId": "33333333-3333-4333-8333-333333333333",
  "toQueueItemId": "44444444-4444-4444-8444-444444444444",
  "transitionId": "55555555-5555-4555-8555-555555555555" }
```

`transitionId` es **estable por (roomId, version)**: el servidor memoriza el UUID
por clave `roomId:version`, de modo que los distintos clientes ven el mismo id
independientemente de quién reportó el fin.

`ROOM_UPDATED` / `ROOM_CLOSED`:

```json
{ "type": "ROOM_UPDATED",
  "room": { "id": "11111111-1111-4111-8111-111111111111", "…": "…", "status": "SUSPENDED" },
  "reason": "HOST_DISCONNECTED" }
```

```json
{ "type": "ROOM_CLOSED",
  "roomId": "11111111-1111-4111-8111-111111111111", "reason": "HOST_GRACE_EXPIRED" }
```

`ROOM_ERROR`:

```json
{ "type": "ROOM_ERROR", "code": "FORBIDDEN",
  "message": "No puedes controlar la reproducción.",
  "requestId": "req-1729450000000-4" }
```

`PONG`:

```json
{ "type": "PONG", "clientTimeMs": 1729450000000, "serverTimeMs": 1729450000042 }
```

## 4.6. Reglas de autorización por mensaje WS

El gateway recalcula siempre los permisos en servidor (`requireMembership` →
`computePermissions(rol, controlMode)`), nunca confía en el cliente:

| Mensaje | Condición |
|---|---|
| `ROOM_JOIN` | `protocolVersion === 1`; pasa por `joinLimiter` y exige membresía previa (el acceso por invitación se resolvió por HTTP). Si entra el dueño de una sala `SUSPENDED`, se reabre (`HOST_RECONNECTED`). Si la sala está reproduciendo, el entrante recibe además `PLAYER_ACTION_REQUIRED`. |
| `ROOM_LEAVE` | `roomId` debe coincidir con la sala del socket. Sale del canal y marca presencia; la membresía se conserva. |
| `QUEUE_ITEM_ADD` | `canAddToQueue` + sala abierta. |
| `QUEUE_ITEM_REMOVE` | `canRemoveFromQueue`; no se puede eliminar el `CURRENT`. |
| `QUEUE_ITEM_MOVE` | `canReorderQueue`; no se puede mover el `CURRENT`. |
| `PLAYBACK_PLAY/PAUSE/SEEK/PREVIOUS` | `canControlPlayback`. |
| `PLAYBACK_NEXT` | `canControlPlayback` **o** (`reason ≠ USER` y `nonstopEnabled`). |
| `PLAYER_READY` / `PLAYER_STATUS_REPORT` | Estar en la sala. |
| `PLAYER_ERROR` | Estar en la sala; solo actúa si `fatal && queueItemId && nonstopEnabled && queueItemId === actual`. |
| `PING` | Estar conectado. |
| Cualquier mensaje | Rate global `WS_RATE_MAX`/`WS_RATE_WINDOW_MS` por usuario. |

## 4.7. Notas de implementación (comportamiento real del contrato)

1. **`PLAYER_ACTION_REQUIRED` se emite por el servidor** al aceptar un
   `ROOM_JOIN` sobre una sala en `PLAYING` (motivo `USER_GESTURE_REQUIRED`):
   la IFrame API exige un gesto local antes de poder reproducir. El cliente
   también lo genera localmente cuando el navegador bloquea el autoplay.
2. **`ROOM_MEMBER_JOINED` / `ROOM_MEMBER_LEFT` se aplican en el cliente**
   (`room-session.ts`): el join hace upsert del miembro y sube
   `participantCount`; el left lo marca `DISCONNECTED` sin quitarlo de la
   lista (la membresía persiste en BD).
3. **`requestId` se envía en todos los mensajes cliente**, incluidos
   `PLAYER_STATUS_REPORT` y `PING` (`RoomClient.send` lo agrega). Los
   `ROOM_ERROR` lo reflejan cuando el fallo responde a un mensaje concreto.
4. **Clasificación de errores no disponibles:** cliente y servidor comparten
   `isUnavailablePlayerCode` de `@play/shared` con el set `{2, 5, 100, 101, 150}`.
5. **`PLAYBACK_PREVIOUS` está implementado**: salta a la pista anterior
   reproducible (`PLAYED`/`SKIPPED`/`PENDING`, `retry_count <= MAX_ITEM_RETRIES`);
   si la actual lleva <3 s (`PREVIOUS_RESTART_THRESHOLD_MS`) o no hay
   anterior, la reinicia a 0. Sin contenido → `CONFLICT`.
6. Existe **una sola** ruta para validar un token sin unirse:
   `GET /api/invites/:token`.
