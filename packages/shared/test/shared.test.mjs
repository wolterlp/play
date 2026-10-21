import { test } from "node:test";
import assert from "node:assert/strict";

const src = await import("../dist/index.js");

test("parseYouTubeUrl extrae id de formatos válidos", () => {
  const cases = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ];
  for (const [url, id] of cases) {
    const parsed = src.parseYouTubeUrl(url);
    assert.ok(parsed, `debería parsear ${url}`);
    assert.equal(parsed.videoId, id);
    assert.equal(parsed.canonicalUrl, `https://www.youtube.com/watch?v=${id}`);
  }
});

test("parseYouTubeUrl rechaza esquemas y hosts no permitidos", () => {
  const invalid = [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/",
    "not a url",
    "https://www.youtube.com/watch?v=tooshort",
    "https://youtu.be/../etc/passwd",
  ];
  for (const url of invalid) {
    assert.equal(src.parseYouTubeUrl(url), null, `debería rechazar ${url}`);
  }
});

test("computePermissions respeta los modos de control", () => {
  const hostOnly = src.computePermissions("PARTICIPANT", "HOST_ONLY");
  assert.equal(hostOnly.canControlPlayback, false);
  assert.equal(hostOnly.canAddToQueue, false);

  const collab = src.computePermissions("PARTICIPANT", "COLLABORATIVE");
  assert.equal(collab.canControlPlayback, true);
  assert.equal(collab.canAddToQueue, true);

  const queueOnly = src.computePermissions(
    "PARTICIPANT",
    "COLLABORATIVE_QUEUE_HOST_PLAYBACK",
  );
  assert.equal(queueOnly.canControlPlayback, false);
  assert.equal(queueOnly.canAddToQueue, true);
  assert.equal(queueOnly.canRemoveFromQueue, false);

  const observer = src.computePermissions("OBSERVER", "COLLABORATIVE");
  assert.equal(observer.canControlPlayback, false);
  assert.equal(observer.canAddToQueue, true);

  const host = src.computePermissions("HOST", "HOST_ONLY");
  assert.equal(host.canManageRoom, true);
  assert.equal(host.canControlPlayback, true);
});

test("estimateClockOffset usa la muestra con menor RTT", () => {
  const samples = [
    { clientSendMs: 1000, clientReceiveMs: 1300, serverTimeMs: 1150 }, // rtt 300, offset 0
    { clientSendMs: 5000, clientReceiveMs: 5100, serverTimeMs: 5300 }, // rtt 100, offset +250
  ];
  const est = src.estimateClockOffset(samples);
  assert.ok(est);
  assert.equal(est.roundTripMs, 100);
  assert.equal(est.offsetMs, 250);
});

test("evaluateDrift aplica tolerancia, corrección suave y seek", () => {
  const base = {
    anchorPositionMs: 0,
    anchorServerTimeMs: 1000,
    estimatedServerNowMs: 1000,
    playbackRate: 1,
    isBuffering: false,
    msSinceLastCorrection: null,
  };

  assert.equal(src.evaluateDrift({ ...base, localPositionMs: 100 }).kind, "NONE");
  assert.equal(
    src.evaluateDrift({ ...base, localPositionMs: 500 }).kind,
    "SOFT_CORRECTION",
  );
  assert.equal(
    src.evaluateDrift({ ...base, localPositionMs: 2000 }).kind,
    "HARD_SEEK",
  );
  assert.equal(
    src.evaluateDrift({ ...base, localPositionMs: 0, isBuffering: true }).kind,
    "SKIP_BUFFERING",
  );
  assert.equal(
    src.evaluateDrift({
      ...base,
      localPositionMs: 2000,
      msSinceLastCorrection: 1000,
    }).kind,
    "NONE",
  );
});

test("clientMessageSchema rechaza mensajes inválidos", () => {
  const bad = src.clientMessageSchema.safeParse({
    type: "QUEUE_ITEM_ADD",
    roomId: "not-a-uuid",
    sourceUrl: "not-a-url",
  });
  assert.equal(bad.success, false);

  const good = src.clientMessageSchema.safeParse({
    type: "QUEUE_ITEM_ADD",
    roomId: "00000000-0000-4000-8000-000000000000",
    sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
  });
  assert.equal(good.success, true);
});
