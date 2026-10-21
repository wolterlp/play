# Play — salas musicales sincronizadas

Plataforma web para que varias personas se unan a una sala mediante un enlace y
escuchen el mismo contenido musical de forma coordinada, cada una desde su
dispositivo y con **volumen y silencio independientes**.

El servidor coordina qué se está escuchando (cola, permisos, estado de
reproducción y sincronía); el audio se reproduce **localmente** en cada navegador
con la [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference?hl=es)
— **sin YouTube Data API** y sin retransmitir audio por el servidor.

---

## 1. Requisitos

| Requisito | Versión |
|---|---|
| Node.js | **>= 20** (`engines` del monorepo) |
| npm | incluido con Node (workspaces npm) |
| PostgreSQL | **14 o superior** (usado con `pg` y migraciones SQL) |

## 2. Instalación

```bash
git clone <repo> play
cd play
npm install
```

## 3. Configuración

Copia las plantillas de variables de entorno (no hay credenciales reales en el
repositorio):

```bash
cp .env.example apps/server/.env   # servidor (dotenv lo lee desde el cwd de apps/server)
cp apps/web/.env.example apps/web/.env   # frontend (opcional en dev)
```

Edita `.env` como mínimo en:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/play
JWT_SECRET=cambia-este-por-un-secreto-de-al-menos-32-caracteres
```

> `JWT_SECRET` es obligatorio (mínimo 32 caracteres) salvo con `NODE_ENV=test`.

## 4. Base de datos y migraciones

```bash
# crear la BD (una sola vez)
psql -U postgres -c "CREATE DATABASE play;"

# aplicar migraciones (001_init, 002_repeat_mode_and_source_type)
npm run migrate
```

> **Nota:** `migrate.ts` no carga el `.env`. Si `npm run migrate` falla por
> DATABASE_URL/JWT_SECRET, expórtalas en la shell antes de ejecutarlo.
> Detalle y rollback: [`docs/05-modelo-datos.md`](docs/05-modelo-datos.md).

## 5. Variables de entorno (resumen)

Servidor (`apps/server/src/config.ts`; plantilla completa en [`.env.example`](.env.example)):

| Variable | Default | Descripción |
|---|---|---|
| `DATABASE_URL` | *obligatoria* | URL de conexión PostgreSQL (TLS en producción). |
| `JWT_SECRET` | *obligatorio* | Secreto de firma JWT (≥32 caracteres). |
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. |
| `HOST` / `PORT` | `0.0.0.0` / `4000` | Escucha del servidor. |
| `CORS_ORIGINS` | `http://localhost:5173` | Orígenes permitidos, separados por coma. |
| `LOG_LEVEL` | `info` | Nivel de logs pino. |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Caducidad del access token. |
| `REFRESH_TOKEN_TTL_SECONDS` | `2592000` | Caducidad del refresh token. |
| `INVITE_TTL_SECONDS` | `604800` | Caducidad de las invitaciones. |
| `HOST_GRACE_SECONDS` | `120` | Gracia del anfitrión (RF-01). |
| `HOST_SWEEP_INTERVAL_MS` | `30000` | Intervalo del vigilante de gracia. |
| `PRESENCE_RECONNECT_TTL_SECONDS` | `60` | Ventana `RECONNECTING`. |
| `MAX_ITEM_RETRIES` | `2` | Reintentos por elemento. |
| `MAX_INVITES_PER_ROOM` | `50` | Invitaciones activas por sala. |
| `AUTH_RATE_MAX` / `AUTH_RATE_WINDOW_MS` | `10` / `60000` | Límite de login/registro. |
| `WS_RATE_MAX` / `WS_RATE_WINDOW_MS` | `60` / `10000` | Límite de mensajes WS. |
| `INVITE_RATE_MAX` / `INVITE_RATE_WINDOW_MS` | `60` / `60000` | Límite de invitaciones. |
| `ROOM_RATE_MAX` / `ROOM_RATE_WINDOW_MS` | `10` / `60000` | Límite de salas creadas. |
| `JOIN_RATE_MAX` / `JOIN_RATE_WINDOW_MS` | `20` / `60000` | Límite de joins WS (toda unión a sala). |

Frontend (`apps/web/.env.example`):

| Variable | Default | Descripción |
|---|---|---|
| `VITE_API_BASE_URL` | `""` | Base de la API (`""` = mismo origen; en dev el proxy de Vite redirige `/api`). |
| `VITE_WS_URL` | `window.location.origin` | URL de socket.io (path `/ws`). |
| `VITE_PLAYER_START_TIMEOUT_MS` | `15000` | Timeout de arranque del reproductor de YouTube. |
| `VITE_PROXY_TARGET` | `http://localhost:4000` | Solo desarrollo: destino del proxy de Vite. |

## 6. Ejecución (desarrollo)

```bash
npm run dev:server   # Fastify + socket.io en http://localhost:4000 (path /ws)
npm run dev:web      # Vite en http://localhost:5173 (proxy /api y /ws → :4000)
```

Abrir <http://localhost:5173>, registrarse, crear una sala y compartir el enlace
de invitación (`/join/<token>`).

## 7. Pruebas

```bash
npm run migrate:test   # aplica migraciones contra play_test (una vez)
npm test               # shared (6) + server (36) + web (10) = 52 pruebas
npm run typecheck
```

Requisitos: PostgreSQL local con la base **`play_test`**
(`postgres:postgres@localhost:5432`). Detalle completo en
[`docs/07-pruebas.md`](docs/07-pruebas.md).

## 8. Build de producción

```bash
npm run build     # shared -> server -> web
npm run start -w @play/server   # node dist/index.js (puerto 4000)
```

Los estáticos quedan en `apps/web/dist/`. Antes de arrancar: aplicar migraciones
y configurar las variables. Guía completa (proxy inverso con upgrade de
WebSocket, health check, secretos): [`docs/08-despliegue.md`](docs/08-despliegue.md).

Salud del servicio: `GET /api/health`.

## 9. Estructura del monorepo

```
play/
├── package.json                 # workspaces npm + scripts raíz
├── .env.example                 # variables del servidor (sin secretos)
├── prompt_desarrollo_musica_sincronizada.md   # especificación original (§1–§17)
├── docs/                        # entregables de §14 (ver §10)
├── packages/
│   └── shared/                  # @play/shared — contratos zod, enums, permisos, sync, youtube
│       ├── src/schemas.ts       # mensajes WS cliente/servidor
│       ├── src/enums.ts         # valores canónicos
│       ├── src/permissions.ts   # computePermissions (fuente única de verdad)
│       ├── src/sync.ts          # estimateClockOffset + evaluateDrift
│       ├── src/youtube.ts       # parseo local de URLs de YouTube
│       └── test/shared.test.mjs
├── apps/
    ├── server/                  # @play/server — Fastify 5 + socket.io + pg
    │   ├── src/config.ts        # todas las variables de entorno (zod)
    │   ├── src/app.ts           # composición, health check, timers
    │   ├── src/http/routes.ts   # rutas /api/*
    │   ├── src/modules/         # auth, rooms, queue, playback, presence, realtime
    │   ├── migrations/          # 001_init.sql, 002_*.sql, 003_drop_room_events.sql
    │   └── test/                # 4 suites (36 pruebas)
    └── web/                     # @play/web — React 18 + Vite + socket.io-client
        ├── src/realtime/        # room-client, room-session, use-room
        ├── src/audio/           # youtube-adapter, clock-synchronizer, sync-engine
        └── src/components/      # PlayerPanel, QueuePanel, MembersPanel, HostSettingsPanel…
```

## 10. Documentación

| Documento | Contenido |
|---|---|
| [`docs/01-viabilidad-youtube.md`](docs/01-viabilidad-youtube.md) | Data API vs IFrame Player API vs iframe; **decisión Opción B ratificada**; límites de sincronía, non-stop y anuncios. |
| [`docs/02-prd.md`](docs/02-prd.md) | Alcance, actores, casos de uso y exclusiones. |
| [`docs/03-arquitectura.md`](docs/03-arquitectura.md) | Diagrama Mermaid, responsabilidades cliente/servidor, flujo de eventos. |
| [`docs/04-contratos-api-ws.md`](docs/04-contratos-api-ws.md) | Rutas HTTP y mensajes WS con ejemplos JSON y códigos de error. |
| [`docs/05-modelo-datos.md`](docs/05-modelo-datos.md) | Tablas, índices, restricciones, retención y migraciones. |
| [`docs/06-plan-fases.md`](docs/06-plan-fases.md) | Fases 0–5, estado real, estimaciones y riesgos. |
| [`docs/07-pruebas.md`](docs/07-pruebas.md) | Cómo ejecutar las pruebas e inventario de suites. |
| [`docs/08-despliegue.md`](docs/08-despliegue.md) | Despliegue seguro, proxy inverso, observabilidad y soporte. |

## 11. Limitaciones importantes

- **No se usa YouTube Data API v3** (sin claves de API de YouTube) y **no se
  eluden anuncios ni políticas del proveedor.**
- La sincronización es *best-effort* (umbrales de 250/750 ms con histéresis),
  no se garantiza el mismo milisegundo en todos los dispositivos.
- El *non-stop* depende de que cada elemento sea embebible; los no disponibles se
  marcan `UNAVAILABLE` y se saltan.
- El autoplay puede requerir un toque del usuario en cada dispositivo.
- El MVP es de **una sola instancia** del servidor (presencia y rate limits en
  memoria; Redis queda fuera de alcance).
