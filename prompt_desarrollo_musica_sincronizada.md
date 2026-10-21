# Prompt maestro de desarrollo — Plataforma de salas musicales sincronizadas

> **Uso:** copiar este documento completo y entregarlo al agente de desarrollo o equipo técnico. Debe tratarse como la especificación inicial del producto y convertirse en un plan de implementación verificable.
>
> **Estado:** requisitos iniciales sujetos a validación técnica. No se deben presentar como resueltas las limitaciones de la integración con YouTube.

---

## 1. Rol y objetivo

Actúa como **arquitecto de software senior, líder técnico y desarrollador full-stack**. Diseña y desarrolla una aplicación web para que varias personas se unan a una sala mediante un enlace y escuchen el mismo contenido musical de forma coordinada, cada una desde su propio dispositivo y con control independiente de su volumen.

La aplicación debe contemplar salas privadas, permisos por participante, una cola colaborativa de canciones, reproducción continua (*non-stop*), sincronización del estado compartido, recuperación ante desconexiones y una interfaz adaptable a escritorio y móvil.

No empieces por generar código indiscriminadamente. Primero valida la viabilidad técnica de las decisiones críticas, documenta la arquitectura, define los contratos y los criterios de aceptación y, después, implementa por fases pequeñas que puedan probarse.

## 2. Visión del producto

### 2.1 Problema que resuelve

Permitir que participantes ubicados en dispositivos distintos coordinen una sesión musical compartida sin tener que depender de una transmisión de audio enviada por el dispositivo de una sola persona.

### 2.2 Principio de funcionamiento

- El servidor coordina **qué contenido está activo, la cola, los permisos y el estado de reproducción compartido**.
- Cada dispositivo reproduce el contenido localmente desde la fuente autorizada.
- Cada dispositivo controla **su propio volumen, silencio y salida de audio**.
- El servidor no necesita recibir, almacenar ni retransmitir el audio de YouTube.
- El sistema no debe afirmar que todos los dispositivos reproducen exactamente al mismo milisegundo; debe medir la desviación y corregirla cuando la integración técnica lo permita.

### 2.3 Decisión importante sobre YouTube

La intención es utilizar YouTube como fuente/gestor de música, pero **no utilizar YouTube Data API v3** para búsquedas, catálogos o metadatos.

No confundas estas opciones:

1. **YouTube Data API:** queda fuera del alcance inicial.
2. **YouTube IFrame Player API:** es una interfaz distinta que permite a una aplicación controlar el reproductor incorporado mediante JavaScript. No debe incorporarse sin autorización expresa del responsable del producto, porque el requisito actual indica que no se utilizarán API de YouTube.
3. **Iframe normal o enlaces web sin API:** no ofrecen el mismo control programático sobre reproducción, pausa, posición actual y corrección de desfase. Por tanto, no se debe prometer sincronización automática completa usando únicamente un iframe normal.

**Puerta de viabilidad obligatoria antes de implementar la sincronización:** presenta las alternativas, limitaciones y consecuencias de:

- **Opción A — Cero API de YouTube:** aceptar un modo limitado en el que la aplicación administra salas, enlaces y cola, pero ciertas acciones y la sincronización precisa dependen de interacción manual de los participantes. Documenta con precisión qué controles no se pueden garantizar.
- **Opción B — Sin Data API, con IFrame Player API oficial:** solicitar aprobación explícita antes de usarla. Permite evaluar control del reproductor y sincronización mediante mecanismos oficiales, sujeto a disponibilidad, políticas y restricciones de reproducción.
- **Opción C — Fuente alternativa autorizada:** utilizar un proveedor o biblioteca de audio cuyo reproductor permita controlar la reproducción y cuya licencia/condiciones sean compatibles con el caso de uso.

No elijas silenciosamente la opción B. No simules capacidades que la opción A no puede ofrecer. Presenta una matriz de funcionalidades por opción y recomienda una ruta técnica con sus limitaciones antes de escribir la implementación de sincronización.

### 2.4 Límites obligatorios de la integración

No implementar:

- Extracción, descarga, copia, proxy o retransmisión del audio de YouTube.
- Scraping de páginas, automatización no autorizada del sitio, extracción automatizada de resultados o metadatos, ni controles sobre el reproductor mediante manipulación del DOM interno o evasión de las protecciones de origen cruzado.
- Eliminación, supresión o elusión de anuncios de YouTube mediante scripts, modificaciones del reproductor o mecanismos equivalentes.
- Mecanismos para evadir restricciones de reproducción, controles de acceso, validaciones de origen o políticas de la plataforma.

La aplicación puede no mostrar publicidad propia. No debe prometer reproducción de YouTube sin anuncios. Si el producto necesita audio sin interrupciones publicitarias, debe integrarse una fuente o modalidad autorizada que permita legítimamente esa experiencia. Antes de un uso comercial o de reproducción pública, validar los derechos aplicables y las condiciones vigentes de la fuente.

Referencias oficiales que el equipo debe revisar y validar en la fase de viabilidad:

- [Términos del Servicio de YouTube](https://www.youtube.com/t/terms)
- [Documentación oficial del reproductor incorporado y sus parámetros](https://developers.google.com/youtube/player_parameters?hl=es)
- [Referencia oficial de YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference?hl=es)

## 3. Alcance funcional

### 3.1 Funciones dentro del MVP

1. Registro/inicio de sesión o acceso por invitación, según la decisión de producto.
2. Crear, editar, cerrar y eliminar salas respetando permisos.
3. Compartir enlaces de invitación con vencimiento y revocación.
4. Unirse a una sala, ver participantes y estado de conexión.
5. Agregar contenido mediante un enlace de YouTube pegado por el usuario; validar el formato sin hacer scraping ni consultar YouTube Data API.
6. Mostrar una cola de reproducción compartida.
7. Controlar la cola según el modo de sala: solo anfitrión o colaborativo.
8. Coordinar reproducción, pausa, reanudación y cambio de canción cuando la integración elegida lo soporte.
9. Modo *non-stop*: pasar al siguiente elemento de la cola al terminar el contenido, manejar fallos y permitir saltar elementos no reproducibles.
10. Control de volumen de 0 a 100 y silencio independiente en cada dispositivo.
11. Reconexión y recuperación del estado de sala.
12. Manejo visible de errores: enlace inválido, contenido no disponible, reproductor bloqueado, reproducción no iniciada, conexión perdida y sala cerrada.
13. Interfaz responsive con estados de carga, vacío, error y reconexión.
14. Pruebas automatizadas para permisos, cola, eventos de sala y reconexión.

### 3.2 Fuera del MVP

- Retransmitir audio en vivo desde el micrófono o escritorio de una persona.
- Mezcla de audio o salas de voz mediante WebRTC.
- Extracción o descarga de canciones.
- Catálogo musical propio alimentado por scraping.
- Integraciones con proveedores de música distintos de la fuente aprobada para el MVP.
- Pagos y planes de suscripción, salvo que se soliciten explícitamente.

Diseña módulos extensibles para que futuras fuentes de audio o una función de audio en vivo puedan incorporarse sin reescribir la lógica central de salas.

## 4. Roles, modos de sala y permisos

### 4.1 Roles mínimos

- **Anfitrión:** crea y configura la sala; puede cerrar la sesión y gestionar permisos.
- **DJ/Editor:** puede cambiar la canción y controlar reproducción si el anfitrión lo permite.
- **Participante:** puede escuchar y, dependiendo de la configuración, agregar contenido a la cola.
- **Observador (opcional):** puede ver la sala, pero no alterar la cola ni los controles compartidos.

El modelo de permisos debe ser configurable por sala. Como mínimo, soportar estos modos:

- **Solo anfitrión controla:** solo el anfitrión puede iniciar, pausar, saltar o cambiar el contenido.
- **Colaborativo:** los participantes autorizados pueden proponer contenido o manejar la cola.
- **Cola colaborativa, reproducción restringida:** cualquiera puede agregar canciones, pero solo el anfitrión o DJ controla el estado de reproducción.

El backend debe validar cada acción. No confiar únicamente en que el botón esté oculto en el frontend.

## 5. Flujos principales

### Flujo A — Crear una sala

1. El usuario inicia sesión o valida su acceso.
2. Selecciona **Crear sala**.
3. Define nombre, privacidad, permisos y comportamiento del modo non-stop.
4. El backend crea la sala y un identificador no predecible.
5. El anfitrión copia un enlace de invitación, con vencimiento y opción para revocarlo.
6. El anfitrión agrega un enlace musical o comparte la invitación.
7. La sala muestra el estado vacío hasta que haya contenido en cola.

### Flujo B — Unirse a una sala

1. El participante abre el enlace.
2. El backend valida el token de invitación, vencimiento, revocación y límites de la sala.
3. El usuario entra con identidad autenticada o un alias temporal, según la política configurada.
4. El cliente establece la conexión en tiempo real y recibe una instantánea del estado actual.
5. El reproductor local se inicializa cuando el usuario ha realizado la interacción requerida por el navegador.
6. El usuario ajusta el volumen local sin alterar el estado de los demás participantes.

### Flujo C — Agregar contenido

1. Un usuario pega una URL de YouTube.
2. El frontend valida la estructura de URL y extrae solo el identificador cuando sea posible mediante análisis local de la URL; no hace scraping ni llamadas a la API de YouTube.
3. El backend vuelve a validar el enlace, comprueba permisos y lo añade a la cola.
4. La sala recibe un evento `QUEUE_ITEM_ADDED`.
5. El elemento aparece en la misma posición para todos los participantes.
6. La disponibilidad y la posibilidad de reproducción se confirman en el reproductor local, no por suposición del backend.

### Flujo D — Reproducción sincronizada

1. Un usuario autorizado solicita reproducir, pausar, reanudar o cambiar la canción.
2. El servidor autentica al emisor, verifica permisos y valida la transición.
3. El servidor persiste o actualiza el estado compartido y asigna una versión creciente al evento.
4. El servidor emite la nueva instantánea a los miembros conectados.
5. Cada cliente aplica el evento usando el adaptador de la fuente de audio seleccionada.
6. Cuando el adaptador pueda consultar la posición real, el cliente calcula el desfase con respecto al estado autoritativo y corrige cuando corresponda.
7. Si el reproductor no soporta el control necesario, la UI informa que la acción puede requerir intervención manual; no muestra falsamente que la sincronización fue exitosa.

### Flujo E — Modo non-stop

1. El anfitrión activa o desactiva la reproducción continua.
2. Al terminar el elemento actual, el sistema selecciona el siguiente elemento válido de la cola.
3. El backend coordina la transición con un identificador idempotente para evitar dobles avances.
4. Los clientes preparan o cargan el siguiente elemento cuando la fuente y el navegador lo permiten.
5. Si un elemento falla, se registra el motivo disponible, se marca como fallido para esa sesión y se intenta el siguiente elemento según el límite de reintentos.
6. Si la cola queda vacía, la sala entra en estado `QUEUE_EMPTY` y espera nuevas canciones.
7. Si la reproducción se interrumpe por anuncios, restricciones, prompts de usuario o limitaciones de la fuente, no se debe intentar eludirlos. Mostrar el estado observable y permitir que el usuario actúe.
8. No prometer continuidad absoluta: documentar interrupciones externas que están fuera del control del producto.

### Flujo F — Desconexión y recuperación

1. El cliente pierde conexión y muestra un indicador de reconexión.
2. El servidor conserva el estado compartido durante el periodo configurado.
3. Al reconectarse, el cliente solicita una instantánea completa o recibe una automáticamente.
4. Ignora eventos antiguos usando versión y secuencia.
5. Si la fuente lo permite, vuelve a cargar o corregir la posición compartida; si no, muestra una acción manual para retomar.
6. El servidor expulsa o libera la presencia de clientes que excedan el plazo de desconexión definido.

## 6. Requisitos funcionales detallados

### RF-01 — Gestión de salas

- Crear salas privadas por defecto.
- Mostrar estado, nombre, anfitrión y número de participantes.
- Configurar permisos sobre cola y reproducción.
- Cerrar una sala con aviso a los participantes.
- Definir si la sesión continúa cuando el anfitrión se desconecta. Valor inicial sugerido: mantener la sala durante una ventana de gracia configurable y luego pausarla/cerrarla según la configuración.

### RF-02 — Invitaciones

- Generar tokens aleatorios, no secuenciales y no reutilizables si así se configura.
- Permitir vencimiento, revocación y regeneración.
- Aplicar límite de participantes y controles contra fuerza bruta.
- No incluir datos personales en el token.

### RF-03 — Cola musical

- Agregar, reordenar, eliminar y saltar elementos según permisos.
- Representar como mínimo: ID interno, URL original, identificador externo validado, usuario que lo agregó, fecha de creación, posición y estado.
- Estados mínimos: `PENDING`, `CURRENT`, `PLAYED`, `SKIPPED`, `UNAVAILABLE`, `FAILED`.
- Evitar que dos clientes avancen la cola de forma simultánea: el cambio debe resolverse de forma atómica en el backend.
- Permitir una política de repetición opcional, desactivada por defecto.

### RF-04 — Estado compartido

Representar el estado compartido con un contrato versionado. Como mínimo:

- `roomId`
- `sourceType`
- `currentQueueItemId`
- `playbackStatus`: `PLAYING`, `PAUSED`, `BUFFERING`, `IDLE`, `QUEUE_EMPTY`, `ERROR`
- `anchorPositionMs`
- `anchorServerTimeMs`
- `playbackRate`, solo si la fuente lo admite
- `version`
- `updatedBy`
- `updatedAt`

El estado compartido no incluirá el volumen ni el silencio de cada usuario.

### RF-05 — Volumen local

- Control local de volumen entre 0 y 100.
- Control de silencio local.
- Los cambios locales nunca generan un comando global de volumen.
- El servidor no debe sobrescribir la configuración local cuando cambie la canción o se sincronice la reproducción.
- Si la fuente no permite regular su volumen mediante la integración escogida, se debe informar claramente y ofrecer únicamente controles técnicamente disponibles, como el volumen del sistema/dispositivo.
- La preferencia local se puede persistir en el navegador. No es necesario transmitirla a otros clientes ni guardarla en el servidor.

### RF-06 — Non-stop y errores

- Transición automática al siguiente elemento cuando se recibe una señal válida de fin de reproducción.
- La transición debe ser idempotente y ejecutarse una sola vez aunque varios clientes reporten el final.
- Reintentos configurables y limitados; valor inicial propuesto: máximo 2 reintentos por elemento antes de saltarlo.
- Tiempo máximo de espera configurable al iniciar un reproductor; valor inicial propuesto: 15 segundos antes de mostrar estado de error, ajustable tras pruebas reales.
- Si no hay elementos reproducibles, detener la transición automática y comunicar el resultado.
- Nunca saltar publicidad de forma automatizada ni modificar el reproductor para evitarla.

### RF-07 — Presencia y eventos

- Mostrar participantes conectados, reconectando o desconectados cuando se disponga de la señal.
- No confundir conexión WebSocket activa con reproducción real.
- El estado del reproductor se rastrea independientemente de la presencia de red.
- Aplicar autorización por sala y rol a cada evento recibido.

## 7. Arquitectura técnica propuesta

La propuesta debe mantenerse modular y no introducir servicios innecesarios para el MVP.

### 7.1 Stack de referencia

- **Frontend:** React + TypeScript + Vite.
- **Backend:** Node.js LTS + TypeScript + Fastify (o justificar otra alternativa antes de adoptarla).
- **Tiempo real:** WebSocket o Socket.IO. Elegir uno, justificarlo y mantener un contrato de eventos común.
- **Base de datos:** PostgreSQL.
- **Autenticación:** sesión segura o JWT de corta duración con mecanismo de renovación; documentar elección, revocación y almacenamiento.
- **Infraestructura:** aplicación web y API servidas por HTTPS; secretos mediante variables de entorno/gestor de secretos; migraciones versionadas.
- **Escalado futuro:** Redis solo si existe necesidad demostrada de presencia/pub-sub entre múltiples instancias; no agregarlo por anticipado sin motivo.
- **WebRTC:** fuera del MVP de reproducción sincronizada. Solo considerarlo para una fase futura de audio en vivo, nunca para retransmitir el audio obtenido de YouTube.

### 7.2 Módulos lógicos

1. `AuthModule`: autenticación y sesión.
2. `RoomsModule`: ciclo de vida y configuración de salas.
3. `MembershipModule`: roles, permisos e invitaciones.
4. `QueueModule`: cola, transiciones atómicas y política non-stop.
5. `PlaybackStateModule`: estado compartido, versión y sincronización.
6. `RealtimeGateway`: entrega de eventos y validación de mensajes WebSocket.
7. `SourceAdapter`: interfaz común para cada proveedor de contenido; la primera implementación debe respetar la puerta de viabilidad de YouTube.
8. `PresenceModule`: conexión y estado reportado de cada cliente.
9. `ObservabilityModule`: logs estructurados, métricas y trazas sin registrar datos sensibles innecesarios.

### 7.3 Principio de autoridad

El servidor es autoritativo para la sala, los permisos, la cola y las transiciones globales. El reproductor de cada dispositivo es autoritativo para los eventos observables de ese cliente (listo, error, buffering y posición real cuando esté disponible).

No aceptar como verdad global un evento de fin de reproducción de cualquier cliente sin validarlo contra el elemento actual, la versión del estado y la política de transición.

## 8. Algoritmo de sincronización

Implementar el algoritmo solo si la integración de audio puede consultar y controlar el reproductor de manera autorizada.

1. El servidor emite una posición de referencia (`anchorPositionMs`) y hora autoritativa (`anchorServerTimeMs`).
2. Si el estado está en `PLAYING`, el cliente estima la posición objetivo:

   `targetPositionMs = anchorPositionMs + (estimatedServerNowMs - anchorServerTimeMs) * playbackRate`

3. El cliente estima la hora del servidor mediante mensajes de ping/pong y calcula la compensación del reloj. Documentar el método y sus límites.
4. Comparar la posición objetivo con la posición real local.
5. Usar umbrales configurables y medidos en pruebas. Valores iniciales para experimentar, no garantías: desviación menor de 250 ms: no actuar; desviación entre 250 y 750 ms: corrección suave solo si la fuente lo soporta; desviación mayor de 750 ms: buscar/reiniciar a la posición objetivo si la integración autorizada lo permite.
6. Evitar ciclos de corrección repetitivos. Aplicar histéresis, enfriamiento breve entre correcciones y manejo de buffering.
7. Si no existe control de posición por haber elegido la opción sin API, no ejecutar pseudocorrecciones; mostrar el límite al usuario.
8. Medir la desviación entre clientes y registrar métricas técnicas sin guardar información personal innecesaria.

Estos umbrales son hipótesis de trabajo; deben validarse con varios navegadores, equipos y condiciones de red.

## 9. Modelo de datos inicial

Propón migraciones SQL y restricciones para, como mínimo, las siguientes entidades. Ajusta nombres y normalización si hay una justificación clara.

### `users`

- `id` (UUID, PK)
- `display_name`
- `email` o identificador de autenticación, si aplica
- `created_at`, `updated_at`

### `rooms`

- `id` (UUID, PK)
- `name`
- `owner_user_id` (FK)
- `privacy_mode`
- `control_mode`
- `nonstop_enabled`
- `max_participants`
- `status`
- `created_at`, `updated_at`, `closed_at`

### `room_members`

- `room_id` (FK)
- `user_id` o identidad temporal
- `role`
- `joined_at`, `last_seen_at`, `left_at`
- restricción única acorde al modelo de identidad

### `room_invites`

- `id` (UUID, PK)
- `room_id` (FK)
- `token_hash` (guardar hash, no el token en claro)
- `expires_at`
- `revoked_at`
- `created_by`
- `created_at`

### `queue_items`

- `id` (UUID, PK)
- `room_id` (FK)
- `position`
- `source_type`
- `source_url`
- `external_content_id`
- `title` solo si se obtiene por una vía permitida o si lo introduce el usuario
- `status`
- `added_by`
- `created_at`, `updated_at`

### `room_playback_state`

- `room_id` (PK/FK)
- `current_queue_item_id` (FK nullable)
- `playback_status`
- `anchor_position_ms`
- `anchor_server_time_ms`
- `playback_rate`
- `version` (entero creciente)
- `updated_by`
- `updated_at`

### `room_events` (opcional, con retención limitada)

- `id` o secuencia
- `room_id`
- `version`
- `event_type`
- `actor_id` nullable
- `payload` limitado y validado
- `created_at`

No persistir volumen local, audio, credenciales de terceros ni datos de reproducción que no sean necesarios. Definir política de retención para eventos.

## 10. Contrato de eventos en tiempo real

Define esquemas TypeScript estrictos y ejemplos JSON para los mensajes. Todos los mensajes deben llevar `type`, `roomId`, `requestId` cuando corresponda y versión/protocolo cuando aplique. Validar cada mensaje en backend con un esquema como Zod u otra biblioteca justificada.

Eventos mínimos sugeridos:

### Cliente → servidor

- `ROOM_JOIN`
- `ROOM_LEAVE`
- `QUEUE_ITEM_ADD`
- `QUEUE_ITEM_REMOVE`
- `QUEUE_ITEM_MOVE`
- `PLAYBACK_PLAY`
- `PLAYBACK_PAUSE`
- `PLAYBACK_SEEK` (solo si la fuente lo permite)
- `PLAYBACK_NEXT`
- `PLAYBACK_PREVIOUS` (opcional)
- `PLAYER_READY`
- `PLAYER_STATUS_REPORT`
- `PLAYER_ERROR`
- `PING`

### Servidor → cliente

- `ROOM_SNAPSHOT`
- `ROOM_MEMBER_JOINED`
- `ROOM_MEMBER_LEFT`
- `QUEUE_UPDATED`
- `QUEUE_ITEM_ADDED`
- `PLAYBACK_STATE_UPDATED`
- `PLAYBACK_SYNC_TARGET`
- `NONSTOP_TRANSITION_STARTED`
- `PLAYER_ACTION_REQUIRED`
- `ROOM_ERROR`
- `PONG`

`LOCAL_VOLUME_CHANGED` y `LOCAL_MUTE_CHANGED` deben quedarse en el cliente y no emitirse como control global. Si en el futuro se necesita compartir el volumen como dato social, deberá ser un atributo informativo distinto, no un comando que modifique el audio de otros dispositivos.

Diseña el manejo de:

- mensajes duplicados (`requestId`/idempotencia);
- eventos fuera de orden (`version`/secuencia);
- usuario sin permiso;
- sala cerrada o elemento que ya no es el actual;
- límite de frecuencia por usuario;
- cliente atrasado que necesita una instantánea completa.

## 11. UX/UI requerida

Pantallas mínimas:

1. Inicio y creación/unión a una sala.
2. Sala musical con reproductor, cola y participantes.
3. Ajustes de sala y permisos para el anfitrión.
4. Estado de invitación inválida, expirada o revocada.
5. Estados de error y reconexión.

Dentro de la sala mostrar claramente:

- Nombre y estado de sala.
- Elemento actual y cola.
- Controles habilitados según los permisos reales.
- Indicador de sincronización y estado del reproductor local.
- Control de volumen local claramente marcado como **solo este dispositivo**.
- Estado del modo non-stop.
- Mensajes para contenido no disponible, reproducción bloqueada o interacción necesaria.
- Mensajes claros cuando el modo sin API no pueda realizar una acción automáticamente.

No ocultar ni imitar controles oficiales del reproductor si eso entra en conflicto con sus condiciones. Mantener la experiencia accesible con teclado, etiquetas y contraste adecuado.

## 12. Requisitos no funcionales

### Seguridad

- HTTPS obligatorio en producción.
- Validación y autorización en servidor para HTTP y WebSocket.
- Validar URLs permitidas; rechazar esquemas distintos de HTTP/HTTPS y hosts no aprobados para la fuente elegida.
- Prevenir XSS, CSRF cuando corresponda, inyección SQL y abuso de invitaciones.
- Tokens de invitación aleatorios, almacenados como hash, con vencimiento y revocación.
- Límites de frecuencia para acciones de cola, comandos de reproducción, creación de salas y acceso a invitaciones.
- Secretos fuera del repositorio, `.env.example` sin secretos y rotación documentada.
- No registrar tokens de invitación completos, cookies, credenciales o datos personales sensibles.

### Rendimiento y resiliencia

Definir una línea base de pruebas y validar objetivos provisionales, sin prometerlos antes de medir:

- Propagación de eventos: objetivo inicial p95 inferior a 500 ms en un entorno de prueba representativo.
- Pruebas preliminares de carga: 20 participantes por sala y 100 salas simultáneas, ajustables al presupuesto e infraestructura.
- Reconexión con recuperación de estado sin crear elementos duplicados ni avanzar dos veces la cola.
- Manejo correcto de buffering, cambio de pestaña, suspensión del dispositivo y retorno de conectividad.
- Evitar bucles de sincronización y tormentas de eventos.

La latencia del evento de control no equivale a la sincronía real del audio. Medir ambas por separado.

### Compatibilidad

Probar las versiones actuales de Chrome, Edge, Firefox y Safari, además de Chrome Android y Safari iOS cuando la fuente esté disponible. Verificar políticas de reproducción automática, permisos, navegación móvil y limitaciones de reproducción en segundo plano. Una sesión puede necesitar un toque explícito del usuario para comenzar.

### Observabilidad

- Logs estructurados con `roomId`, `eventId` y correlación sin exponer secretos.
- Métricas de tiempo de entrega, participantes conectados, fallos de reproducción, reconexiones, transiciones duplicadas y desviación de sincronización cuando se pueda medir.
- Endpoint de salud y verificación de conexión a base de datos.
- Mensajes de error accionables para soporte.

## 13. Pruebas y criterios de aceptación

Antes de declarar terminado el MVP, verificar los siguientes escenarios:

### CA-01 — Aislamiento de volumen

- Participante A configura 100 %.
- Participante B configura 10 %.
- Ambos reciben el mismo elemento de contenido y el estado compartido cambia según los permisos.
- Un cambio de volumen de A no modifica el volumen de B ni genera un evento global.
- Al cambiar la canción, cada dispositivo conserva su volumen local.

### CA-02 — Permisos

- En modo solo anfitrión, un participante normal no puede pausar, saltar ni cambiar el elemento, aunque construya manualmente una petición al backend.
- En modo colaborativo, las acciones autorizadas se reflejan para todos.
- Una acción no autorizada produce un error controlado y no cambia el estado.

### CA-03 — Cola y non-stop

- Agregar, eliminar y reordenar elementos mantiene el orden de la cola en todos los clientes.
- El final de reproducción reportado por varios clientes produce una sola transición.
- Un elemento fallido no bloquea indefinidamente la cola.
- Una cola vacía deja a la sala en estado explícito de espera.
- Los anuncios o restricciones de YouTube no disparan lógica de evasión publicitaria.

### CA-04 — Sincronización

- Documentar los resultados por cada opción de integración aprobada.
- Si se autoriza el reproductor controlable, probar play/pause, cambio de elemento, deriva de reloj, corrección de posición y reconexión en condiciones de red variadas.
- Si no se autoriza ninguna API, las pruebas no deben afirmar sincronización automática precisa; validar el flujo limitado y los mensajes de interfaz.

### CA-05 — Reconexión

- Desconectar un cliente, cambiar canción desde otro dispositivo y reconectar el primero.
- El cliente recupera la versión más reciente sin restaurar un estado anterior ni duplicar comandos.

### CA-06 — Invitaciones y seguridad

- Un token expirado o revocado no permite acceder.
- Un usuario ajeno no puede enviar eventos a una sala sin autorización.
- Mensajes inválidos, abusivos o demasiado frecuentes se rechazan sin tumbar el servicio.

### CA-07 — Errores y accesibilidad

- La UI distingue error de red de fallo de reproducción.
- Se comunica cuando se requiere una interacción manual.
- Los controles principales funcionan con teclado y tienen etiquetas accesibles.

## 14. Entregables exigidos al agente de desarrollo

Entregar en este orden:

1. **Informe de viabilidad de YouTube** con la diferencia entre Data API, IFrame Player API e iframe estándar; capacidades alcanzables bajo la restricción de no usar ninguna API; límites de sincronización, non-stop y anuncios; recomendación y decisión pendiente.
2. **PRD** breve con alcance, actores, casos de uso y exclusiones.
3. **Arquitectura** con diagrama Mermaid, responsabilidades de cliente/servidor y flujo de eventos.
4. **Contratos de API y WebSocket**, con ejemplos JSON y validación de esquemas.
5. **Modelo de datos** y migraciones SQL.
6. **Plan por fases**, estimación técnica con supuestos y principales riesgos.
7. **MVP implementado** solo después de resolver la puerta de viabilidad.
8. **Pruebas automatizadas**, pasos de ejecución y reporte de resultados.
9. **README** con requisitos, instalación local, configuración, migraciones, variables de entorno, ejecución, pruebas y despliegue.
10. **`.env.example`** sin credenciales reales y guía de despliegue seguro.

## 15. Fases de ejecución

### Fase 0 — Descubrimiento y puerta de viabilidad

- Aclarar qué significa exactamente “no usar la API de YouTube”.
- Probar un prototipo pequeño con la integración permitida.
- Verificar si puede cargar contenido, detectar estado, pausar/reanudar, leer posición y buscar una posición.
- Comprobar políticas vigentes, experiencia en navegadores y comportamiento móvil.
- No pasar a sincronización completa si la fuente no permite los controles necesarios.

### Fase 1 — Núcleo de salas

- Autenticación o acceso temporal decidido.
- Salas, invitaciones, roles y permisos.
- WebSocket, presencia, instantánea de sala y autorización.
- Cola persistente.

### Fase 2 — Adaptador de fuente y reproducción

- Implementar solamente la fuente aprobada.
- Validar los enlaces y mensajes de estado.
- Conectar comandos de reproducción soportados.
- Mantener el volumen local fuera del estado compartido.

### Fase 3 — Sincronización y non-stop

- Estado autoritativo con marcas de tiempo.
- Política idempotente para cambios de canción.
- Manejo de error, reintentos, cola vacía y reconexión.
- Medición de deriva en clientes reales.

### Fase 4 — Endurecimiento

- Seguridad, límites de frecuencia, retención, observabilidad y accesibilidad.
- Pruebas de carga y compatibilidad entre navegadores.
- Documentación de limitaciones externas y procedimientos de soporte.

### Fase 5 — Mejoras posteriores

- Nuevas fuentes autorizadas.
- Funciones sociales adicionales.
- Audio en vivo por WebRTC/SFU solo si se aprueba como producto separado y con revisión de privacidad y derechos.

## 16. Instrucciones de trabajo para el agente

- Primero inspecciona el repositorio y las herramientas disponibles, si existen; no sobrescribas proyectos ni archivos existentes sin entender su función.
- Si aún no hay repositorio, propone una estructura mínima y explica las decisiones importantes.
- Mantén frontend, backend, fuente de audio y sincronización desacoplados mediante interfaces tipadas.
- No añadas dependencias o infraestructura sin justificar qué problema resuelven.
- Implementa en incrementos pequeños, con pruebas al mismo tiempo que cada función.
- Usa TypeScript estricto, manejo centralizado de errores, validación de entradas y migraciones versionadas.
- Nunca marques una tarea como finalizada sin pruebas o evidencia de ejecución.
- Distingue claramente hechos probados, hipótesis y limitaciones externas.
- Si un requisito contradice las restricciones de YouTube o la capacidad técnica de la integración elegida, no lo implementes mediante una evasión: documenta la incompatibilidad y ofrece una alternativa autorizada.
- Antes de tomar una decisión que cambie el alcance —especialmente autorizar una API de YouTube o cambiar de fuente— presenta las opciones y el impacto.
- No inventes metadatos de canciones ni afirmes que un contenido está disponible hasta observarlo en el reproductor local.

## 17. Resultado esperado de la primera respuesta del agente

Antes de escribir código, responde con:

1. Un resumen del producto entendido.
2. Una matriz comparativa de las opciones A, B y C descritas en la sección 2.3.
3. La limitación técnica exacta si se mantiene la prohibición absoluta de cualquier API de YouTube.
4. Una arquitectura inicial y un diagrama Mermaid del flujo servidor-cliente.
5. El modelo de datos preliminar y el contrato inicial de eventos.
6. Riesgos técnicos, legales/de licencia, de reproducción móvil y de publicidad.
7. Una recomendación concreta y las decisiones que requieren aprobación.
8. El plan de implementación ordenado por fases y los criterios que permiten pasar de una fase a otra.

**No afirmes que la sincronización exacta, el non-stop sin interrupciones o el bloqueo de anuncios están garantizados hasta que el prototipo demuestre la capacidad y se hayan validado las condiciones de la fuente.**
