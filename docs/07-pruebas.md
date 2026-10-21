# 7. Pruebas automatizadas

> Documento: entregable 8 de §14 del prompt maestro.

---

## 7.1. Requisitos previos

| Requisito | Detalle |
|---|---|
| Node.js | `>=20` (declarado en `engines` de `package.json` raíz). |
| PostgreSQL | 14+ en ejecución en `localhost:5432`. |
| Base de datos de prueba | **`play_test`**, credenciales por defecto `postgres` / `postgres`. |
| Dependencias | `npm install` en la raíz del monorepo (workspaces npm). |
| Build de `@play/shared` | Los paquetes consumen `packages/shared/dist`; si no existe, ejecutar `npm run build -w @play/shared`. |

Crear la base de datos la primera vez:

```bash
# Windows (PowerShell)
$env:PGPASSWORD="postgres"; createdb -U postgres play_test
# o vía psql
psql -U postgres -c "CREATE DATABASE play_test;"
```

## 7.2. Cómo ejecutar las pruebas

```bash
# 1) desde la raíz de C:\code\play
npm install

# 2) compila los contratos compartidos (necesario si falta packages/shared/dist)
npm run build -w @play/shared

# 3) aplica las migraciones contra play_test
npm run migrate:test

# 4) ejecuta TODAS las suites: shared + server + web
npm test
```

`npm test` (raíz) ejecuta exactamente, en este orden:

```json
"test": "npm run test -w @play/shared && npm run test -w @play/server && npm run test -w @play/web"
```

### Comandos individuales

```bash
npm run test -w @play/shared    # node --test "test/**/*.test.mjs"
npm run test -w @play/server    # node --test --test-concurrency=1 (4 ficheros)
npm run test -w @play/web       # vitest run (jsdom)
npm run typecheck               # tsc --noEmit en shared, server y web
```

### Comandos exactos de cada paquete (verificados en `package.json`)

| Paquete | Script `test` |
|---|---|
| `@play/shared` | `node --test "test/**/*.test.mjs"` |
| `@play/server` | `cross-env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5432/play_test node --import tsx --test --test-concurrency=1 --test-force-exit test/auth-rooms.test.ts test/realtime.test.ts test/lifecycle.test.ts test/services.test.ts` |
| `@play/web` | `vitest run` |

Notas del runner del servidor:

- `node:test` con **concurrencia 1**: las suites comparten la base `play_test` y
  hacen `TRUNCATE … RESTART IDENTITY CASCADE` entre pruebas
  (`truncateAll` en `test/helpers.ts`).
- `--test-force-exit` limpia los timers del servidor de prueba (vigilantes de
  gracia y presencia).
- El servidor de prueba escucha en un puerto efímero de `127.0.0.1`
  (`startTestServer`), no en el 4000.
- `testConfig()` fija `LOG_LEVEL=silent` y sube los límites de rate
  (`AUTH_RATE_MAX=10000`, `WS_RATE_MAX=100000`, `INVITE_RATE_MAX=10000`) para no
  interferir con las suites; **la suite de rate limiting los sobreescribe**.

### `migrate:test` (obligatorio antes del primer run)

```json
"migrate:test": "cross-env JWT_SECRET=0123456789abcdef0123456789abcdef DATABASE_URL=postgresql://postgres:postgres@localhost:5432/play_test tsx src/db/migrate.ts up"
```

> `npm run migrate` (sin `:test`) **no** lee el `.env`: `migrate.ts` no importa
> `dotenv/config`. En esa ruta hay que exportar `DATABASE_URL` y `JWT_SECRET` en
> el shell. `migrate:test` ya los trae predefinidos.

## 7.3. Inventario de suites

### Total: **52 pruebas** (36 servidor + 10 web + 6 shared)

### `apps/server/test/auth-rooms.test.ts` — 8 pruebas (HTTP)

1. `registro, login y refresh funcionan`
2. `email duplicado devuelve 409`
3. `contraseña débil o email inválido devuelve 400`
4. `acceso sin token devuelve 401`
5. `CA-06: token de invitación expirado o revocado no permite acceso`
6. `CA-06: invitación expirada no permite acceso`
7. `solo el anfitrión puede editar la sala`
8. `un usuario ajeno no puede leer una sala a la que no pertenece`

### `apps/server/test/realtime.test.ts` — 11 pruebas (WebSocket)

1. `CA-02: en modo HOST_ONLY un participante no puede pausar ni cambiar`
2. `CA-02: en modo COLLABORATIVE las acciones autorizadas se reflejan para todos`
3. `CA-01: el volumen local nunca genera un evento global ni se transmite`
4. `CA-03: el fin reportado por varios clientes produce una sola transición`
5. `CA-03: una cola vacía deja la sala en QUEUE_EMPTY`
6. `CA-05: reconexión recupera la versión más reciente sin duplicar estados`
7. `un usuario ajeno no puede enviar eventos a una sala (auto-join sin invitación falla)`
8. `mensajes inválidos se rechazan sin tumbar el servicio`
9. `PING responde PONG con hora del servidor`
10. `conexión WS sin token es rechazada`
11. `ROOM_LEAVE saca a miembro de la sala conservando su membresía`

### `apps/server/test/lifecycle.test.ts` — 13 pruebas (ciclo de vida)

1. `RF-03: repeatMode ONE reinicia la pista actual al terminar`
2. `RF-03: repeatMode ALL reinicia la cola al terminar el último elemento`
3. `RF-01: la desconexión del anfitrión suspende la sala y su regreso la reanuda`
4. `RF-01: la gracia vencida cierra la sala y avisa a los presentes`
5. `CA-03: ENDED con non-stop emite NONSTOP_TRANSITION_STARTED; USER no lo emite`
6. `PLAYER_STATUS_REPORT responde PLAYBACK_SYNC_TARGET con la posición autoritativa`
7. `PLAYER_ERROR fatal de contenido no disponible marca UNAVAILABLE y avanza`
8. `cerrar la sala por HTTP emite ROOM_CLOSED a los presentes`
9. `PATCH de ajustes emite ROOM_UPDATED con SETTINGS_CHANGED`
10. `PLAYBACK_PREVIOUS salta a la pista anterior reproducible`
11. `PLAYBACK_PREVIOUS reinicia la pista actual cuando aún no hay anterior`
12. `PLAYBACK_PREVIOUS sin contenido responde CONFLICT con el requestId`
13. `unirse a una sala que está reproduciendo emite PLAYER_ACTION_REQUIRED`

### `apps/server/test/services.test.ts` — 4 pruebas (servicios)

1. `CA-03: un elemento fallido no bloquea indefinidamente la cola`
2. `validación de URL: enlaces no-YouTube o no-http se rechazan`
3. `CA-02: en HOST_ONLY el participantCount y la membresía se calculan en backend`
4. `rate limiting: demasiados logins se rechazan con 429`

### `apps/web/src/realtime/room-session.test.ts` — 10 pruebas (vitest, jsdom)

1. `ROOM_ERROR notifica al usuario vía la acción requerida`
2. `el volumen local solo toca el adaptador: nunca envía eventos de red`
3. `PING/PONG usa la base epoch (Date.now), no performance.now`
4. `ROOM_CLOSED marca la sala como cerrada y pausa el reproductor local`
5. `ROOM_UPDATED reemplaza los metadatos de la sala del snapshot`
6. `autoplay bloqueado marca needs-gesture y resumeLocal lo resuelve tras el gesto`
7. `ROOM_MEMBER_JOINED agrega al miembro y sube participantCount; un duplicado solo lo actualiza`
8. `ROOM_MEMBER_LEFT marca al miembro como desconectado sin quitarlo de la lista`
9. `NONSTOP_TRANSITION_STARTED duplica el mismo transitionId una sola vez`
10. `PLAYBACK_SYNC_TARGET de otra pista se ignora; el del item cargado puebla la deriva`

### `packages/shared/test/shared.test.mjs` — 6 pruebas (`node --test`)

1. `parseYouTubeUrl extrae id de formatos válidos`
2. `parseYouTubeUrl rechaza esquemas y hosts no permitidos`
3. `computePermissions respeta los modos de control`
4. `estimateClockOffset usa la muestra con menor RTT`
5. `evaluateDrift aplica tolerancia, corrección suave y seek`
6. `clientMessageSchema rechaza mensajes inválidos`

## 7.4. Cobertura por criterio de aceptación (§13)

| CA | Descripción | Pruebas |
|---|---|---|
| CA-01 | Aislamiento de volumen | `realtime.test.ts` #3; `room-session.test.ts` #2 |
| CA-02 | Permisos | `realtime.test.ts` #1, #2; `services.test.ts` #3; `auth-rooms.test.ts` #7, #8 |
| CA-03 | Cola y non-stop | `realtime.test.ts` #4, #5; `lifecycle.test.ts` #1, #2, #5, #7; `services.test.ts` #1 |
| CA-04 | Sincronización | `lifecycle.test.ts` #6; `room-session.test.ts` #3, #10; `shared.test.mjs` #4, #5 *(medición de deriva en navegadores reales: pendiente, ver §6.1)* |
| CA-05 | Reconexión | `realtime.test.ts` #6 |
| CA-06 | Invitaciones y seguridad | `auth-rooms.test.ts` #5, #6; `realtime.test.ts` #7, #8, #10, #11; `services.test.ts` #4 |
| CA-07 | Errores y accesibilidad | `room-session.test.ts` #1, #4, #6 *(accesibilidad de teclado/etiquetas: verificación manual)* |

## 7.5. Reproducción local paso a paso

```powershell
# 0) Prerrequisos: Node >=20 y PostgreSQL 14+ corriendo en localhost:5432
cd C:\code\play

# 1) Dependencias
npm install

# 2) Contratos compartidos compilados
npm run build -w @play/shared

# 3) Base de datos de prueba
$env:PGPASSWORD = "postgres"
psql -U postgres -c "CREATE DATABASE play_test;"

# 4) Migraciones de prueba
npm run migrate:test

# 5) Suite completa
npm test

# 6) (Opcional) solo una suite
npm run test -w @play/server
npm run test -w @play/web
npm run test -w @play/shared

# 7) (Opcional) comprobación de tipos
npm run typecheck
```

### Esperado

- `@play/shared`: 6/6 `pass`.
- `@play/server`: 36/36 `pass` (≈ un minuto, serializado).
- `@play/web`: 10/10 `pass`.
- Salida final de `npm test` en verde; cualquier rojo detiene la cadena `&&`.

### Fallos típicos

| Síntoma | Causa | Solución |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL no está corriendo. | Arrancar el servicio de PostgreSQL. |
| `database "play_test" does not exist` | BD no creada. | `psql -U postgres -c "CREATE DATABASE play_test;"` |
| `relation "rooms" does not exist` | Faltan migraciones. | `npm run migrate:test` |
| `Cannot find module '@play/shared'` o error de tipos | Falta `packages/shared/dist`. | `npm run build -w @play/shared` |
| Pruebas de rate limit fallan al subir la concurrencia | Los limitadores son globales por proceso. | Mantener `--test-concurrency=1` (no quitarlo). |
