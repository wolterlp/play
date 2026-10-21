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
  ctx = await startTestServer({ HOST_SWEEP_INTERVAL_MS: 250 });
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
      resolve({
        socket,
        messages,
        waitFor,
        join: async (opts) => {
          socket.emit("message", { type: "ROOM_JOIN", protocolVersion: 1, ...opts });
        },
        send: (msg) => socket.emit("message", msg),
        close: () => socket.close(),
      });
    });
    socket.on("connect_error", (err) => reject(err));
  });
}

async function setupRoom(opts: { nonstop?: boolean; repeatMode?: string } = {}) {
  const host = await registerUser(ctx.baseUrl, `host-${Date.now()}-${Math.random()}@example.com`);
  const guest = await registerUser(ctx.baseUrl, `guest-${Date.now()}-${Math.random()}@example.com`);
  const room = await api(ctx.baseUrl, "/api/rooms", {
    method: "POST",
    token: host.accessToken,
    body: {
      name: "Sala",
      controlMode: "COLLABORATIVE",
      maxParticipants: 10,
      nonstopEnabled: opts.nonstop ?? true,
      ...(opts.repeatMode ? { repeatMode: opts.repeatMode } : {}),
    },
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

async function addItems(
  client: TestClient,
  roomId: string,
  ids: string[],
): Promise<string[]> {
  const items: string[] = [];
  for (const id of ids) {
    client.send({ type: "QUEUE_ITEM_ADD", roomId, sourceUrl: youtubeUrl(id) });
    const added = await client.waitFor(
      "QUEUE_ITEM_ADDED",
      (m) => m.item.externalContentId === id,
    );
    items.push(added.item.id);
  }
  return items;
}

test("RF-03: repeatMode ONE reinicia la pista actual al terminar", async () => {
  const { host, roomId } = await setupRoom({ repeatMode: "ONE" });
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  const [item1, item2] = await addItems(hostClient, roomId, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);

  hostClient.send({ type: "PLAYBACK_PLAY", roomId });
  const started = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "PLAYING",
  );
  assert.equal(started.playback.currentQueueItemId, item1);

  hostClient.send({ type: "PLAYBACK_NEXT", roomId, reason: "ENDED", failedQueueItemId: item1! });
  const replay = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.version > started.playback.version,
  );
  assert.equal(replay.playback.currentQueueItemId, item1);
  assert.equal(replay.currentItem?.position, 0);
  assert.notEqual(replay.playback.currentQueueItemId, item2);
  hostClient.close();
});

test("RF-03: repeatMode ALL reinicia la cola al terminar el último elemento", async () => {
  const { host, roomId } = await setupRoom({ repeatMode: "ALL" });
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  const [item1] = await addItems(hostClient, roomId, ["ccccccccccc"]);

  hostClient.send({ type: "PLAYBACK_PLAY", roomId });
  const started = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "PLAYING",
  );
  assert.equal(started.playback.currentQueueItemId, item1);

  hostClient.send({ type: "PLAYBACK_NEXT", roomId, reason: "ENDED", failedQueueItemId: item1! });
  const again = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.version > started.playback.version,
  );
  assert.equal(again.playback.currentQueueItemId, item1);
  hostClient.close();
});

test("RF-01: la desconexión del anfitrión suspende la sala y su regreso la reanuda", async () => {
  const { host, guest, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  hostClient.close();

  const suspended = await guestClient.waitFor(
    "ROOM_UPDATED",
    (m) => m.reason === "HOST_DISCONNECTED",
  );
  assert.equal(suspended.room.status, "SUSPENDED");

  const detail = await api(ctx.baseUrl, `/api/rooms/${roomId}`, {
    token: guest.accessToken,
  });
  assert.equal(detail.body.room.status, "SUSPENDED");

  const hostBack = await connectClient(ctx.wsUrl, host.accessToken);
  hostBack.join({ roomId });
  const reopened = await guestClient.waitFor(
    "ROOM_UPDATED",
    (m) => m.reason === "HOST_RECONNECTED",
  );
  assert.equal(reopened.room.status, "OPEN");
  hostBack.close();
  guestClient.close();
});

test("RF-01: la gracia vencida cierra la sala y avisa a los presentes", async () => {
  const { host, guest, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  hostClient.close();
  await guestClient.waitFor("ROOM_UPDATED", (m) => m.reason === "HOST_DISCONNECTED");

  // La gracia vence: el próximo acceso detecta la sala expirada, la cierra y avisa.
  await ctx.db.query(
    "UPDATE rooms SET host_grace_until = now() - interval '1 second' WHERE id = $1",
    [roomId],
  );

  const hostBack = await connectClient(ctx.wsUrl, host.accessToken);
  hostBack.join({ roomId });
  await guestClient.waitFor("ROOM_CLOSED", (m) => m.reason === "HOST_GRACE_EXPIRED", 5000);
  hostBack.close();
  guestClient.close();
});

test("CA-03: ENDED con non-stop emite NONSTOP_TRANSITION_STARTED; USER no lo emite", async () => {
  const { host, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  const [item1, item2] = await addItems(hostClient, roomId, ["ddddddddddd", "eeeeeeeeeee"]);

  hostClient.send({ type: "PLAYBACK_PLAY", roomId });
  const started = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "PLAYING",
  );
  assert.equal(started.playback.currentQueueItemId, item1);

  hostClient.send({ type: "PLAYBACK_NEXT", roomId, reason: "USER" });
  const manual = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.version > started.playback.version,
  );
  assert.equal(manual.playback.currentQueueItemId, item2);
  assert.equal(
    hostClient.messages.some((m) => m.type === "NONSTOP_TRANSITION_STARTED"),
    false,
    "USER no debe emitir NONSTOP_TRANSITION_STARTED",
  );

  hostClient.send({
    type: "PLAYBACK_NEXT",
    roomId,
    reason: "ENDED",
    failedQueueItemId: item2!,
  });
  const ended = await hostClient.waitFor(
    "NONSTOP_TRANSITION_STARTED",
    (m) => m.fromQueueItemId === item2,
  );
  assert.equal(ended.toQueueItemId, null);
  assert.ok(ended.transitionId.length > 0);
  hostClient.close();
});

test("PLAYER_STATUS_REPORT responde PLAYBACK_SYNC_TARGET con la posición autoritativa", async () => {
  const { host, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  const [item1] = await addItems(hostClient, roomId, ["fffffffffff"]);
  hostClient.send({ type: "PLAYBACK_PLAY", roomId, positionMs: 5000 });
  const started = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "PLAYING",
  );
  assert.equal(started.playback.currentQueueItemId, item1);
  assert.equal(started.playback.anchorPositionMs, 5000);

  hostClient.send({
    type: "PLAYER_STATUS_REPORT",
    roomId,
    report: { queueItemId: item1 },
  });
  const target = await hostClient.waitFor("PLAYBACK_SYNC_TARGET");
  assert.equal(target.target.queueItemId, item1);
  assert.ok(target.target.targetPositionMs >= 5000);
  hostClient.close();
});

test("PLAYER_ERROR fatal de contenido no disponible marca UNAVAILABLE y avanza", async () => {
  const { host, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  const [item1, item2] = await addItems(hostClient, roomId, ["ggggggggggg", "hhhhhhhhhhh"]);
  hostClient.send({ type: "PLAYBACK_PLAY", roomId });
  const started = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "PLAYING",
  );
  assert.equal(started.playback.currentQueueItemId, item1);

  hostClient.send({
    type: "PLAYER_ERROR",
    roomId,
    queueItemId: item1!,
    code: "100",
    message: "no disponible",
    fatal: true,
  });
  const advanced = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.version > started.playback.version,
  );
  assert.equal(advanced.playback.currentQueueItemId, item2);

  const queue = await hostClient.waitFor(
    "QUEUE_UPDATED",
    (m) => m.queue.some((q) => q.id === item1 && q.status === "UNAVAILABLE"),
  );
  assert.ok(queue);
  hostClient.close();
});

test("cerrar la sala por HTTP emite ROOM_CLOSED a los presentes", async () => {
  const { host, guest, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  const res = await api(ctx.baseUrl, `/api/rooms/${roomId}/close`, {
    method: "POST",
    token: host.accessToken,
  });
  assert.equal(res.status, 200);

  await guestClient.waitFor("ROOM_CLOSED", (m) => m.reason === "HOST_CLOSED");
  hostClient.close();
  guestClient.close();
});

test("PATCH de ajustes emite ROOM_UPDATED con SETTINGS_CHANGED", async () => {
  const { host, guest, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");

  const res = await api(ctx.baseUrl, `/api/rooms/${roomId}`, {
    method: "PATCH",
    token: host.accessToken,
    body: { repeatMode: "ALL", name: "Renombrada" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.room.repeatMode, "ALL");

  const updated = await guestClient.waitFor(
    "ROOM_UPDATED",
    (m) => m.reason === "SETTINGS_CHANGED",
  );
  assert.equal(updated.room.repeatMode, "ALL");
  assert.equal(updated.room.name, "Renombrada");
  hostClient.close();
  guestClient.close();
});

test("PLAYBACK_PREVIOUS salta a la pista anterior reproducible", async () => {
  const { host, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  const [item1, item2] = await addItems(hostClient, roomId, ["iiiiiiiiiii", "jjjjjjjjjjj"]);

  hostClient.send({ type: "PLAYBACK_PLAY", roomId, positionMs: 5000 });
  const started = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "PLAYING",
  );
  assert.equal(started.playback.currentQueueItemId, item1);

  hostClient.send({ type: "PLAYBACK_NEXT", roomId, reason: "USER" });
  const moved = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.version > started.playback.version,
  );
  assert.equal(moved.playback.currentQueueItemId, item2);

  // La pista 2 supera el umbral de reinicio (3 s): anterior salta a la pista 1.
  hostClient.send({ type: "PLAYBACK_SEEK", roomId, positionMs: 5000 });
  const seeked = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.version > moved.playback.version,
  );
  hostClient.send({ type: "PLAYBACK_PREVIOUS", roomId });
  const prev = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.version > seeked.playback.version,
  );
  assert.equal(prev.playback.currentQueueItemId, item1);
  assert.equal(prev.playback.anchorPositionMs, 0);
  assert.equal(prev.playback.playbackStatus, "PLAYING");

  const item1Row = await ctx.db.query("SELECT status FROM queue_items WHERE id = $1", [item1]);
  assert.equal(item1Row.rows[0].status, "CURRENT");
  hostClient.close();
});

test("PLAYBACK_PREVIOUS reinicia la pista actual cuando aún no hay anterior", async () => {
  const { host, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  const [item1] = await addItems(hostClient, roomId, ["kkkkkkkkkkk"]);
  hostClient.send({ type: "PLAYBACK_PLAY", roomId, positionMs: 10_000 });
  const started = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "PLAYING",
  );
  assert.equal(started.playback.currentQueueItemId, item1);
  assert.equal(started.playback.anchorPositionMs, 10_000);

  hostClient.send({ type: "PLAYBACK_PREVIOUS", roomId, requestId: "prev-restart" });
  const restarted = await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.version > started.playback.version,
  );
  assert.equal(restarted.playback.currentQueueItemId, item1);
  assert.equal(restarted.playback.anchorPositionMs, 0);
  hostClient.close();
});

test("PLAYBACK_PREVIOUS sin contenido responde CONFLICT con el requestId", async () => {
  const { host, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");

  hostClient.send({ type: "PLAYBACK_PREVIOUS", roomId, requestId: "prev-empty" });
  const err = await hostClient.waitFor("ROOM_ERROR");
  assert.equal(err.code, "CONFLICT");
  assert.equal(err.requestId, "prev-empty");
  hostClient.close();
});

test("unirse a una sala que está reproduciendo emite PLAYER_ACTION_REQUIRED", async () => {
  const { host, guest, roomId } = await setupRoom();
  const hostClient = await connectClient(ctx.wsUrl, host.accessToken);
  hostClient.join({ roomId });
  await hostClient.waitFor("ROOM_SNAPSHOT");
  await addItems(hostClient, roomId, ["lllllllllll"]);
  hostClient.send({ type: "PLAYBACK_PLAY", roomId });
  await hostClient.waitFor(
    "PLAYBACK_STATE_UPDATED",
    (m) => m.playback.playbackStatus === "PLAYING",
  );

  const guestClient = await connectClient(ctx.wsUrl, guest.accessToken);
  guestClient.join({ roomId });
  await guestClient.waitFor("ROOM_SNAPSHOT");
  const action = await guestClient.waitFor("PLAYER_ACTION_REQUIRED");
  assert.equal(action.reason, "USER_GESTURE_REQUIRED");
  hostClient.close();
  guestClient.close();
});

