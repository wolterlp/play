import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { io, type Socket as ClientSocket } from "socket.io-client";
import type { ServerMessage } from "@play/shared";
import {
  api,
  registerUser,
  startTestServer,
  truncateAll,
  type TestContext,
} from "./helpers.js";

let ctx: TestContext;

before(async () => {
  ctx = await startTestServer();
});
after(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await truncateAll(ctx.db);
});

interface TestClient {
  socket: ClientSocket;
  messages: ServerMessage[];
  waitFor: <T extends ServerMessage["type"]>(
    type: T,
    predicate?: (m: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs?: number,
  ) => Promise<Extract<ServerMessage, { type: T }>>;
  join: (opts: { roomId?: string }) => Promise<void>;
  send: (msg: unknown) => void;
  close: () => void;
}

function connectClient(wsUrl: string, token: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const socket = io(wsUrl, {
      path: "/ws",
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    const messages: ServerMessage[] = [];
    const waiters: Array<{
      type: string;
      predicate?: (m: any) => boolean;
      resolve: (m: any) => void;
      reject: (e: unknown) => void;
      timer: NodeJS.Timeout;
    }> = [];

    const waitFor = <T extends ServerMessage["type"]>(
      type: T,
      predicate?: (m: Extract<ServerMessage, { type: T }>) => boolean,
      timeoutMs = 4000,
    ): Promise<Extract<ServerMessage, { type: T }>> => {
      const existing = messages.find(
        (m) => m.type === type && (!predicate || predicate(m as any)),
      );
      if (existing) return Promise.resolve(existing as Extract<ServerMessage, { type: T }>);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error(`timeout esperando ${type}`));
        }, timeoutMs);
        waiters.push({ type, ...(predicate ? { predicate } : {}), resolve: res, reject: rej, timer });
      });
    };

    socket.on("message", (raw: ServerMessage) => {
      messages.push(raw);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i]!;
        if (w.type === raw.type && (!w.predicate || w.predicate(raw))) {
          clearTimeout(w.timer);
          waiters.splice(i, 1);
          w.resolve(raw);
        }
      }
    });

    socket.on("connect", () => {
      const client: TestClient = {
        socket,
        messages,
        waitFor,
        join: async (opts) => {
          socket.emit("message", {
            type: "ROOM_JOIN",
            protocolVersion: 1,
            ...opts,
          });
        },
        send: (msg) => socket.emit("message", msg),
        close: () => socket.close(),
      };
      resolve(client);
    });
    socket.on("connect_error", (err) => reject(err));
  });
}

async function setupRoom(controlMode: string, nonstop = true) {
  const host = await registerUser(ctx.baseUrl, `host-${Date.now()}@example.com`);
  const guest = await registerUser(ctx.baseUrl, `guest-${Date.now()}@example.com`);
  const room = await api(ctx.baseUrl, "/api/rooms", {
    method: "POST",
    token: host.accessToken,
    body: { name: "Sala", controlMode, maxParticipants: 10, nonstopEnabled: nonstop },
  });
  const roomId = room.body.room.id as string;
  const invite = await api(ctx.baseUrl, `/api/rooms/${roomId}/invites`, {
    method: "POST",
    token: host.accessToken,
  });
  const inviteToken = invite.body.invite.token as string;
  await api(ctx.baseUrl, `/api/invites/${inviteToken}/join`, {
    method: "POST",
    token: guest.accessToken,
  });
  return { host, guest, roomId };
}

function youtubeUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

test("CA-02: en modo HOST_ONLY un participante no puede pausar ni cambiar", async () => {
  const { host, guest, roomId } = await setupRoom("HOST_ONLY");
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);

  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  // Host agrega y reproduce
  hostClient.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: youtubeUrl("aaaaaaaaaaa") });
  await hostClient.waitFor("QUEUE_ITEM_ADDED");
  hostClient.send({ type: "PLAYBACK_PLAY", roomId });
  await hostClient.waitFor("PLAYBACK_STATE_UPDATED", (m) => m.playback.playbackStatus === "PLAYING");

  // El invitado intenta pausar: debe fallar con FORBIDDEN, sin perder el requestId.
  const before = (await api(ctx.baseUrl, "/api/rooms", { token: host.accessToken })).status;
  assert.equal(before, 200);

  guestClient.send({ type: "PLAYBACK_PAUSE", roomId, requestId: "p1" });
  const err = await guestClient.waitFor("ROOM_ERROR");
  assert.equal(err.code, "FORBIDDEN");
  assert.equal(err.requestId, "p1");

  // Verifica en backend que sigue PLAYING
  const stateRow = await ctx.db.query(
    "SELECT playback_status FROM room_playback_state WHERE room_id = $1",
    [roomId],
  );
  assert.equal(stateRow.rows[0].playback_status, "PLAYING");

  hostClient.close();
  guestClient.close();
});

test("CA-02: en modo COLLABORATIVE las acciones autorizadas se reflejan para todos", async () => {
  const { host, guest, roomId } = await setupRoom("COLLABORATIVE", false);
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);

  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  // El invitado agrega (permitido en colaborativo)
  guestClient.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: youtubeUrl("bbbbbbbbbbb") });
  const added = await hostClient.waitFor("QUEUE_ITEM_ADDED");
  assert.equal(added.item.externalContentId, "bbbbbbbbbbb");

  // El invitado reproduce (permitido en colaborativo)
  guestClient.send({ type: "PLAYBACK_PLAY", roomId });
  const playing = await hostClient.waitFor("PLAYBACK_STATE_UPDATED", (m) => m.playback.playbackStatus === "PLAYING");
  assert.equal(playing.playback.playbackStatus, "PLAYING");

  hostClient.close();
  guestClient.close();
});

test("CA-01: el volumen local nunca genera un evento global ni se transmite", async () => {
  const { host, roomId } = await setupRoom("COLLABORATIVE");
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  // El contrato no incluye volumen: enviar eventos de volumen es inválido.
  hostClient.send({ type: "LOCAL_VOLUME_CHANGED", roomId, volume: 100 });
  const err = await hostClient.waitFor("ROOM_ERROR");
  assert.equal(err.code, "VALIDATION_ERROR");

  // El estado global no contiene ningún campo de volumen.
  const state = await ctx.db.query(
    "SELECT * FROM room_playback_state WHERE room_id = $1",
    [roomId],
  );
  const keys = Object.keys(state.rows[0]);
  assert.equal(keys.some((k) => k.toLowerCase().includes("volume")), false);

  // Y tras cambiar de canción, el servidor no envía volumen alguno.
  hostClient.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: youtubeUrl("ccccccccccc") });
  await hostClient.waitFor("QUEUE_ITEM_ADDED");
  const snapshot = hostClient.messages.find((m) => m.type === "ROOM_SNAPSHOT");
  assert.ok(snapshot);
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes("volume"), false);

  hostClient.close();
});

test("CA-03: el fin reportado por varios clientes produce una sola transición", async () => {
  const { host, guest, roomId } = await setupRoom("COLLABORATIVE", true);
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  hostClient.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: youtubeUrl("ddddddddddd") });
  await hostClient.waitFor("QUEUE_ITEM_ADDED");
  hostClient.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: youtubeUrl("eeeeeeeeeee") });
  await hostClient.waitFor("QUEUE_ITEM_ADDED");

  hostClient.send({ type: "PLAYBACK_PLAY", roomId });
  await hostClient.waitFor("PLAYBACK_STATE_UPDATED", (m) => m.playback.playbackStatus === "PLAYING");

  const current = await ctx.db.query(
    "SELECT current_queue_item_id FROM room_playback_state WHERE room_id = $1",
    [roomId],
  );
  const firstId = current.rows[0].current_queue_item_id as string;

  // Ambos clientes reportan fin con el MISMO failedQueueItemId.
  hostClient.send({
    type: "PLAYBACK_NEXT",
    roomId,
    reason: "ENDED",
    failedQueueItemId: firstId,
  });
  guestClient.send({
    type: "PLAYBACK_NEXT",
    roomId,
    reason: "ENDED",
    failedQueueItemId: firstId,
  });

  await new Promise((r) => setTimeout(r, 500));

  // Debe haberse avanzado exactamente una vez al segundo item.
  const after = await ctx.db.query(
    "SELECT current_queue_item_id FROM room_playback_state WHERE room_id = $1",
    [roomId],
  );
  const secondId = after.rows[0].current_queue_item_id as string;
  assert.notEqual(secondId, firstId);

  const playingCount = await ctx.db.query(
    "SELECT status FROM queue_items WHERE id = $1",
    [secondId],
  );
  assert.equal(playingCount.rows[0].status, "CURRENT");

  hostClient.close();
  guestClient.close();
});

test("CA-03: una cola vacía deja la sala en QUEUE_EMPTY", async () => {
  const { host, roomId } = await setupRoom("COLLABORATIVE", true);
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  hostClient.send({ type: "PLAYBACK_PLAY", roomId, requestId: "empty" });
  const updated = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "QUEUE_EMPTY",
  );
  assert.equal(updated.playback.playbackStatus, "QUEUE_EMPTY");

  hostClient.close();
});

test("CA-05: reconexión recupera la versión más reciente sin duplicar estados", async () => {
  const { host, guest, roomId } = await setupRoom("COLLABORATIVE", false);
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  let guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  hostClient.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: youtubeUrl("fffffffffff") });
  await hostClient.waitFor("QUEUE_ITEM_ADDED");
  hostClient.send({ type: "PLAYBACK_PLAY", roomId });
  const v1 = await hostClient.waitFor("PLAYBACK_STATE_UPDATED");
  const versionBefore = v1.playback.version;

  // Guest se desconecta
  guestClient.close();
  await new Promise((r) => setTimeout(r, 200));

  // Host avanza el estado mientras guest está fuera
  hostClient.send({ type: "PLAYBACK_PAUSE", roomId, positionMs: 5000 });
  const v2 = await hostClient.waitFor("PLAYBACK_STATE_UPDATED", (m) => m.playback.playbackStatus === "PAUSED");
  const versionAfter = v2.playback.version;
  assert.ok(versionAfter > versionBefore);

  // Guest reconecta y recibe snapshot con la versión más reciente
  guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  guestClient.join({ roomId });
  const snapshot = await guestClient.waitFor("ROOM_SNAPSHOT");
  assert.equal(snapshot.snapshot.playback.version, versionAfter);
  assert.equal(snapshot.snapshot.playback.playbackStatus, "PAUSED");

  hostClient.close();
  guestClient.close();
});

test("un usuario ajeno no puede enviar eventos a una sala (auto-join sin invitación falla)", async () => {
  const { roomId } = await setupRoom("COLLABORATIVE");
  const outsider = await registerUser(ctx.baseUrl, `out-${Date.now()}@example.com`);
  const client = await connectClient(ctx.wsUrl, outsider.accessToken);
  client.join({ roomId });
  const err = await client.waitFor("ROOM_ERROR");
  assert.equal(err.code, "FORBIDDEN");
  client.close();
});

test("mensajes inválidos se rechazan sin tumbar el servicio", async () => {
  const { host, roomId } = await setupRoom("COLLABORATIVE");
  const client = await connectClient(ctx.wsUrl, host.accessToken);
  client.join({ roomId });
  await client.waitFor("ROOM_SNAPSHOT");

  client.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: "not-a-url" });
  const err = await client.waitFor("ROOM_ERROR");
  assert.equal(err.code, "VALIDATION_ERROR");

  // El servicio sigue vivo
  client.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: youtubeUrl("ggggggggggg") });
  const added = await client.waitFor("QUEUE_ITEM_ADDED");
  assert.equal(added.item.externalContentId, "ggggggggggg");

  client.close();
});

test("PING responde PONG con hora del servidor", async () => {
  const host = await registerUser(ctx.baseUrl, `ping-${Date.now()}@example.com`);
  const client = await connectClient(ctx.wsUrl, host.accessToken);
  const sentAt = Date.now();
  client.send({ type: "PING", clientTimeMs: sentAt });
  const pong = await client.waitFor("PONG");
  assert.equal(pong.clientTimeMs, sentAt);
  assert.ok(pong.serverTimeMs >= sentAt - 1000);
  client.close();
});

test("conexión WS sin token es rechazada", async () => {
  await assert.rejects(
    () =>
      Promise.race([
        connectClient(ctx.wsUrl, ""),
        new Promise((_, rej) => setTimeout(() => rej(new Error("no-reject")), 2000)),
      ]),
  );
});

test("ROOM_LEAVE saca a miembro de la sala conservando su membresía", async () => {
  const { host, guest, roomId } = await setupRoom("COLLABORATIVE", false);
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  guestClient.send({ type: "ROOM_LEAVE", roomId, requestId: "leave-1" });
  await hostClient.waitFor("ROOM_MEMBER_LEFT", (m) => m.userId === guest.id);

  // La membresía se conserva (la sala no olvida al miembro).
  const membership = await ctx.db.query(
    "SELECT left_at FROM room_members WHERE room_id = $1 AND user_id = $2",
    [roomId, guest.id],
  );
  assert.equal(membership.rows[0].left_at, null);

  // Y el mismo cliente puede volver a unirse por WS.
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");
  hostClient.close();
  guestClient.close();
});
