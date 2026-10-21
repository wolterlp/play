# 8. Guía de despliegue seguro

> Documento: entregable 10 (junto con `.env.example`) de §14 del prompt maestro.

---

## 8.1. Lista de verificación previa

- [ ] HTTPS obligatorio en producción (§12 del prompt).
- [ ] `JWT_SECRET` fuerte y distinto por entorno (mínimo 32 caracteres).
- [ ] `DATABASE_URL` con TLS (`?sslmode=require`) y credenciales propias.
- [ ] `CORS_ORIGINS` limitado al dominio real del frontend (sin `*`).
- [ ] PostgreSQL **no** expuesto a Internet (solo red interna / localhost).
- [ ] Migraciones aplicadas **antes** de arrancar la aplicación.
- [ ] `.env` fuera del repositorio (`.env.example` es la única plantilla versionada).

## 8.2. Variables de entorno obligatorias y recomendadas

Fuente: `apps/server/src/config.ts`. La configuración se valida con zod **al
arrancar** y el proceso termina si falta algo obligatorio.

| Variable | Obligatoria | Default | Comentario |
|---|---|---|---|
| `DATABASE_URL` | **Sí** | — | `postgresql://usuario:clave@host:5432/base`. En producción añadir `?sslmode=require`. |
| `JWT_SECRET` | **Sí** (salvo `NODE_ENV=test`) | — | Mínimo 32 caracteres. Rotar si se filtra (invalida todos los access tokens). |
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production`. |
| `HOST` | No | `0.0.0.0` | Interfaz de escucha. |
| `PORT` | No | `4000` | Puerto HTTP+WS del servidor. |
| `CORS_ORIGINS` | No (recomendado) | `http://localhost:5173` | Orígenes permitidos, **separados por coma**; se usa en CORS **y** en el handshake de socket.io. |
| `LOG_LEVEL` | No | `info` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`\|`silent`. |
| `ACCESS_TOKEN_TTL_SECONDS` | No | `900` (15 min) | |
| `REFRESH_TOKEN_TTL_SECONDS` | No | `2592000` (30 días) | |
| `INVITE_TTL_SECONDS` | No | `604800` (7 días) | |
| `HOST_GRACE_SECONDS` | No | `120` | Ventana de gracia del anfitrión (RF-01). |
| `HOST_SWEEP_INTERVAL_MS` | No | `30000` | Frecuencia del vigilante que cierra salas vencidas. |
| `PRESENCE_RECONNECT_TTL_SECONDS` | No | `60` | Duración del estado `RECONNECTING`. |
| `MAX_ITEM_RETRIES` | No | `2` | Reintentos por elemento antes de `FAILED`. |
| `MAX_INVITES_PER_ROOM` | No | `50` | Invitaciones activas por sala. |
| `AUTH_RATE_MAX` / `AUTH_RATE_WINDOW_MS` | No | `10` / `60000` | Login y registro por IP. |
| `WS_RATE_MAX` / `WS_RATE_WINDOW_MS` | No | `60` / `10000` | Mensajes WS por usuario. |
| `INVITE_RATE_MAX` / `INVITE_RATE_WINDOW_MS` | No | `60` / `60000` | Crear/resolver invitaciones. |
| `ROOM_RATE_MAX` / `ROOM_RATE_WINDOW_MS` | No | `10` / `60000` | Salas creadas por usuario. |
| `JOIN_RATE_MAX` / `JOIN_RATE_WINDOW_MS` | No | `20` / `60000` | `ROOM_JOIN` por WS (toda unión a sala). |

Variables del frontend (se **incrustan en el bundle en tiempo de build**):

| Variable | Uso |
|---|---|
| `VITE_API_BASE_URL` | Base de `fetch` del `ApiClient` (vacío = mismo origen). |
| `VITE_WS_URL` | URL del socket.io (vacío = `window.location.origin`). |
| `VITE_PLAYER_START_TIMEOUT_MS` | Timeout de arranque del reproductor de YouTube (default `15000`). |
| `VITE_PROXY_TARGET` | Solo dev: destino del proxy de Vite (default `http://localhost:4000`). |

## 8.3. Build

```bash
# en la raíz del monorepo
npm ci                 # instalación reproducible
npm run build          # shared -> server -> web (orden fijado en package.json)
npm run typecheck      # opcional, tsc --noEmit en los tres paquetes
```

Resultado:

- `apps/server/dist/index.js` → se arranca con `npm run start -w @play/server`.
- `apps/web/dist/` → estáticos para el reverse proxy.
- `packages/shared/dist/` → consumido por server y web.

## 8.4. Migraciones antes del arranque

Las migraciones son parte obligatoria del despliegue; **el servidor no migra solo**.

```bash
export NODE_ENV=production
export DATABASE_URL="postgresql://play:clave-segura@db-interna:5432/play?sslmode=require"
export JWT_SECRET="<mínimo 32 caracteres>"

# migrate.ts NO lee .env (no importa dotenv/config): exporta las variables o usa cross-env
npm run migrate -w @play/server
# equivalente:
# npx cross-env DATABASE_URL="$DATABASE_URL" JWT_SECRET="$JWT_SECRET" tsx apps/server/src/db/migrate.ts up

# después, arrancar
npm run start -w @play/server
```

Rollback: `tsx src/db/migrate.ts down [n]` (usa la sección `-- DOWN` de cada
fichero). Probar el rollback en staging antes de usarlo en producción.

## 8.5. Reverse proxy con WebSocket

Socket.IO usa `path: "/ws"` y transporte `websocket`. El proxy debe reenviar el
upgrade HTTP. Ejemplo con nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name play.ejemplo.com;

    ssl_certificate     /etc/letsencrypt/live/play.ejemplo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/play.ejemplo.com/privkey.pem;

    # Estáticos del frontend
    root /srv/play/apps/web/dist;
    index index.html;
    location / {
        try_files $uri /index.html;
    }

    # API y WebSocket hacia el servidor Node
    location /api/ {
        proxy_pass         http://127.0.0.1:4000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;   # > pingTimeout (25 s) y pingInterval (20 s)
    }
}
```

Consideraciones:

- El servidor ya habilita `trustProxy: true`, por lo que `request.ip` respeta
  `X-Forwarded-For` → los rate limits por IP son correctos tras el proxy.
- Si el frontend y el backend comparten dominio, deja `VITE_API_BASE_URL=""` y
  `VITE_WS_URL=""` en el build de producción (mismo origen) y no necesitas CORS.
- Si son dominios distintos, configura `CORS_ORIGINS=https://play.ejemplo.com` y
  `VITE_API_BASE_URL=https://api.ejemplo.com`, `VITE_WS_URL=https://api.ejemplo.com`.

## 8.6. No exponer PostgreSQL

- Escucha en `localhost` o en una red privada; **nunca** puertos públicos.
- Usuario de la aplicación con privilegios mínimos (solo DML sobre sus tablas).
- `sslmode=require` (o superior) en la URL.
- Credenciales solo en el gestor de secretos / `.env` local sin versionar.
- Los backups deben cifrarse igual que la base.

## 8.7. Health check

```
GET /api/health
```

```json
{ "status": "ok", "database": true, "uptimeSeconds": 128, "timestamp": "2026-10-20T18:02:00.000Z" }
```

- `status: "ok"` → base de datos responde a `SELECT 1`.
- `status: "degraded"` → `database: false`. Debe tratarse como **fallo de salud**
  en el balanceador/monitor.
- El endpoint no requiere autenticación; no devuelve datos sensibles.

## 8.8. Observabilidad (logs pino)

- Logger: pino (`apps/server/src/logger.ts`), nivel por `LOG_LEVEL`,
  timestamp ISO, `base: { service: "play-server", env: NODE_ENV }`.
- **Redacción automática** de `req.headers.authorization`, `req.headers.cookie`,
  `password`, `token`, `refreshToken`, `accessToken`
  (con `"[redacted]"`). No registrar manualmente tokens ni cookies.
- Eventos útiles para métricas: `server_started`, `ws.connected`, `ws.joined`,
  `ws.disconnected`, `room.created`, `room.closed`, `room.suspended`,
  `room.closed_grace_expired`, `playback.updated` (con `version` y `status`),
  `player.error_reported` (con `code` y `fatal`), `playback.next_stale_ignored`.
- Endpoint de salud para el monitor (`GET /api/health`).
- Recomendación: agregar un recolector (JSON a stdout → Loki/ELK) y alertar sobre
  `unhandled_http_error`, `ws.handler_error` y un pico de `player.error_reported`.

## 8.9. Limitaciones externas y procedimiento de soporte

### Si YouTube cambia sus políticas

Señales a vigilar:

1. **Aumento de errores 100 / 101 / 150** (`player.error_reported` con esos
   `code`). 100 = contenido eliminado/privado; 101/150 = el propietario no
   permite incrustarlo.
2. Fallos al cargar `https://www.youtube.com/iframe_api` (bloqueo de red o
   cambio de dominio).
3. Reproducciones que se interrumpen por restricciones del proveedor.

Procedimiento:

1. Confirmar con la consola del navegador si el error es del proveedor y no de
   la app.
2. **Degradar con dignidad:** los elementos afectados se marcan `UNAVAILABLE` y
   el non-stop los salta; la cola sigue siendo usable. Verificar que el estado de
   la sala queda `QUEUE_EMPTY` cuando no queda nada reproducible.
3. Comunicar al usuario con los mensajes ya existentes (códigos 2/5/100/101/150
   con su texto en `room-session.ts`).
4. Revisar la documentación oficial del reproductor y de la IFrame API y actualizar
   `docs/01-viabilidad-youtube.md` si la Opción B deja de ser viable.
5. **Nunca** responder a un cambio de política con evasión (anuncios, proxies,
   manipulación del DOM del reproductor). Si el producto necesita continuidad
   publicitaria, abrir la Opción C (fuente alternativa autorizada) como decisión
   de producto.

### Otras limitaciones conocidas

| Limitación | Efecto operativo |
|---|---|
| Autoplay bloqueado | Cada usuario debe tocar "reproduci/r"; no es un fallo del servidor. |
| Una sola instancia | Si el proceso cae, cae toda la presencia y los rate limits en memoria. Reiniciar con systemd/PM2 + health check. |
| `transitionIds` en memoria (máx. 5 000 entradas) | Al reiniciar el servidor se generan nuevos `transitionId` para la misma `version`; los clientes toleran eso (solo informativo). |
| `refresh_tokens` sin poda | Con el tiempo crece la tabla; programar un `DELETE` por `expires_at < now()`. |
| Anuncios de YouTube | Experiencia interrumpida por diseño del proveedor; no se eluden. |

## 8.10. Rotación de secretos

1. Generar un `JWT_SECRET` nuevo (p. ej. `openssl rand -base64 48`).
2. Actualizar el gestor de secretos y reiniciar el servidor → todos los access
   tokens quedan inválidos (los usuarios refrescan con su refresh token; si
   quieres invalidar también esos, borrar `refresh_tokens`).
3. Rotar credenciales de `DATABASE_URL` en la base y en el gestor a la vez.
4. Nunca versionar el `.env`; solo `.env.example`.
