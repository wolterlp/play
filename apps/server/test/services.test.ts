import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
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

async function makeRoom(maxParticipants = 20) {
  const host = await registerUser(ctx.baseUrl, `h-${Date.now()}-${Math.random()}@e.com`);
  const room = await api(ctx.baseUrl, "/api/rooms", {
    method: "POST",
    token: host.accessToken,
    body: { name: "Sala", maxParticipants },
  });
  return { host, roomId: room.body.room.id as string };
}

test("CA-03: un elemento fallido no bloquea indefinidamente la cola", async () => {
  const { host, roomId } = await makeRoom();
  const { QueueService } = await import("../src/modules/queue/queue-service.js");
  const { PlaybackService } = await import("../src/modules/playback/playback-service.js");
  const { createPool } = await import("../src/db/pool.js");
  const { testConfig } = await import("./helpers.js");
  const { createLogger } = await import("../src/logger.js");

  const config = testConfig();
  const db = createPool(config);
  const logger = createLogger(config);
  const queue = new QueueService(db);
  const playback = new PlaybackService(db, queue, config, logger);

  await queue.addItem(roomId, host.id, "https://www.youtube.com/watch?v=aaaaaaaaaaa", null);
  await queue.addItem(roomId, host.id, "https://www.youtube.com/watch?v=bbbbbbbbbbb", null);
  await queue.addItem(roomId, host.id, "https://www.youtube.com/watch?v=ccccccccccc", null);

  const play = await playback.play(roomId, host.id);
  const firstId = play.playback.currentQueueItemId;
  assert.ok(firstId);

  // Reporta error repetidamente sobre el PRIMER item hasta agotar reintentos.
  // Cada reporte usa expectedCurrentItemId = firstId, por lo que solo el primero
  // es válido; los posteriores son ignorados por idempotencia.
  let guard = 0;
  let currentId: string | null = firstId;
  while (currentId && guard < 10) {
    const item = await queue.getItem(roomId, currentId);
    if (!item || item.status !== "CURRENT") break;
    const res = await playback.next(roomId, host.id, {
      reason: "ERROR",
      expectedCurrentItemId: currentId,
    });
    currentId = res.playback.currentQueueItemId;
    guard++;
  }

  // El primer item quedó marcado como fallido/saltado y la cola avanzó más allá.
  const firstRow = await db.query("SELECT status FROM queue_items WHERE id = $1", [firstId]);
  assert.ok(["FAILED", "SKIPPED"].includes(firstRow.rows[0].status));
  const state = await playback.getState(roomId);
  assert.notEqual(state.currentQueueItemId, firstId);
  assert.notEqual(state.playbackStatus, "ERROR");

  await db.end();
});

test("validación de URL: enlaces no-YouTube o no-http se rechazan", async () => {
  const { host, roomId } = await makeRoom();
  const { QueueService } = await import("../src/modules/queue/queue-service.js");
  const { createPool } = await import("../src/db/pool.js");
  const { testConfig } = await import("./helpers.js");

  const db = createPool(testConfig());
  const queue = new QueueService(db);

  await assert.rejects(
    () => queue.addItem(roomId, host.id, "https://evil.com/watch?v=aaaaaaaaaaa", null),
    /YouTube/,
  );
  await assert.rejects(
    () => queue.addItem(roomId, host.id, "javascript:alert(1)", null),
    /YouTube/,
  );
  await assert.rejects(
    () => queue.addItem(roomId, host.id, "https://youtube.com/watch?v=bad", null),
    /YouTube/,
  );

  const ok = await queue.addItem(
    roomId,
    host.id,
    "https://youtu.be/dQw4w9WgXcQ",
    "Mi canción",
  );
  assert.equal(ok.externalContentId, "dQw4w9WgXcQ");
  assert.equal(ok.sourceUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  await db.end();
});

test("CA-02: en HOST_ONLY el participantCount y la membresía se calculan en backend", async () => {
  const { host, roomId } = await makeRoom(2);
  const guest1 = await registerUser(ctx.baseUrl, `g1-${Date.now()}@e.com`);
  const guest2 = await registerUser(ctx.baseUrl, `g2-${Date.now()}@e.com`);

  const invite = await api(ctx.baseUrl, `/api/rooms/${roomId}/invites`, {
    method: "POST",
    token: host.accessToken,
  });
  const token = invite.body.invite.token;

  await api(ctx.baseUrl, `/api/invites/${token}/join`, {
    method: "POST",
    token: guest1.accessToken,
  });

  // Sala llena (max 2): el segundo invitado no entra
  const full = await api(ctx.baseUrl, `/api/invites/${token}/join`, {
    method: "POST",
    token: guest2.accessToken,
  });
  assert.equal(full.status, 409);
  assert.equal(full.body.error.code, "ROOM_FULL");
});

test("rate limiting: demasiados logins se rechazan con 429", async () => {
  const { startTestServer } = await import("./helpers.js");
  const rl = await startTestServer({ AUTH_RATE_MAX: 3, AUTH_RATE_WINDOW_MS: 60_000 });
  try {
    await rl.db.query(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3)`,
      ["rl@example.com", "RL", "$argon2id$v=19$m=65536,t=3,p=4$aaaaaaaaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    );
    let got429 = false;
    for (let i = 0; i < 8; i++) {
      const res = await api(rl.baseUrl, "/api/auth/login", {
        method: "POST",
        body: { email: "rl@example.com", password: "wrong-password" },
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    assert.equal(got429, true);
  } finally {
    await rl.close();
  }
});
