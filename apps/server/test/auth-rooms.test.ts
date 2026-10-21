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

test("registro, login y refresh funcionan", async () => {
  const user = await registerUser(ctx.baseUrl, "a@example.com");
  assert.ok(user.accessToken);

  const rooms = await api(ctx.baseUrl, "/api/rooms", { token: user.accessToken });
  assert.equal(rooms.status, 200);
  assert.deepEqual(rooms.body.rooms, []);

  const login = await api(ctx.baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email: "a@example.com", password: "password-1234" },
  });
  assert.equal(login.status, 200);

  const refreshed = await api(ctx.baseUrl, "/api/auth/refresh", {
    method: "POST",
    body: { refreshToken: user.refreshToken },
  });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.tokens.accessToken);
});

test("email duplicado devuelve 409", async () => {
  await registerUser(ctx.baseUrl, "dup@example.com");
  const res = await api(ctx.baseUrl, "/api/auth/register", {
    method: "POST",
    body: { email: "dup@example.com", password: "password-1234", displayName: "X" },
  });
  assert.equal(res.status, 409);
});

test("contraseña débil o email inválido devuelve 400", async () => {
  const res = await api(ctx.baseUrl, "/api/auth/register", {
    method: "POST",
    body: { email: "bad", password: "short", displayName: "X" },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "VALIDATION_ERROR");
});

test("acceso sin token devuelve 401", async () => {
  const res = await api(ctx.baseUrl, "/api/rooms");
  assert.equal(res.status, 401);
});

test("CA-06: token de invitación expirado o revocado no permite acceso", async () => {
  const host = await registerUser(ctx.baseUrl, "host@example.com");
  const guest = await registerUser(ctx.baseUrl, "guest@example.com");

  const room = await api(ctx.baseUrl, "/api/rooms", {
    method: "POST",
    token: host.accessToken,
    body: { name: "Sala", maxParticipants: 5 },
  });
  const roomId = room.body.room.id as string;

  const invite = await api(ctx.baseUrl, `/api/rooms/${roomId}/invites`, {
    method: "POST",
    token: host.accessToken,
  });
  const token = invite.body.invite.token as string;
  const inviteId = invite.body.invite.id as string;

  const okPreview = await api(ctx.baseUrl, `/api/invites/${token}`);
  assert.equal(okPreview.status, 200);

  await api(ctx.baseUrl, `/api/rooms/${roomId}/invites/${inviteId}/revoke`, {
    method: "POST",
    token: host.accessToken,
  });

  const afterRevoke = await api(ctx.baseUrl, `/api/invites/${token}`);
  assert.equal(afterRevoke.status, 410);
  assert.equal(afterRevoke.body.error.code, "INVITE_REVOKED");

  const joinRevoked = await api(ctx.baseUrl, `/api/invites/${token}/join`, {
    method: "POST",
    token: guest.accessToken,
  });
  assert.equal(joinRevoked.status, 410);
});

test("CA-06: invitación expirada no permite acceso", async () => {
  const host = await registerUser(ctx.baseUrl, "host2@example.com");
  const room = await api(ctx.baseUrl, "/api/rooms", {
    method: "POST",
    token: host.accessToken,
    body: { name: "Sala exp" },
  });
  const roomId = room.body.room.id as string;
  const invite = await api(ctx.baseUrl, `/api/rooms/${roomId}/invites`, {
    method: "POST",
    token: host.accessToken,
  });
  const inviteId = invite.body.invite.id as string;

  await ctx.db.query(
    "UPDATE room_invites SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [inviteId],
  );

  const res = await api(ctx.baseUrl, `/api/invites/${invite.body.invite.token}`);
  assert.equal(res.status, 410);
  assert.equal(res.body.error.code, "INVITE_EXPIRED");
});

test("solo el anfitrión puede editar la sala", async () => {
  const host = await registerUser(ctx.baseUrl, "h3@example.com");
  const other = await registerUser(ctx.baseUrl, "u3@example.com");
  const room = await api(ctx.baseUrl, "/api/rooms", {
    method: "POST",
    token: host.accessToken,
    body: { name: "Sala" },
  });
  const roomId = room.body.room.id as string;

  const invite = await api(ctx.baseUrl, `/api/rooms/${roomId}/invites`, {
    method: "POST",
    token: host.accessToken,
  });
  await api(ctx.baseUrl, `/api/invites/${invite.body.invite.token}/join`, {
    method: "POST",
    token: other.accessToken,
  });

  const denied = await api(ctx.baseUrl, `/api/rooms/${roomId}`, {
    method: "PATCH",
    token: other.accessToken,
    body: { name: "Hackeada" },
  });
  assert.equal(denied.status, 403);

  const allowed = await api(ctx.baseUrl, `/api/rooms/${roomId}`, {
    method: "PATCH",
    token: host.accessToken,
    body: { name: "Renombrada" },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.room.name, "Renombrada");
});

test("un usuario ajeno no puede leer una sala a la que no pertenece", async () => {
  const host = await registerUser(ctx.baseUrl, "h4@example.com");
  const outsider = await registerUser(ctx.baseUrl, "o4@example.com");
  const room = await api(ctx.baseUrl, "/api/rooms", {
    method: "POST",
    token: host.accessToken,
    body: { name: "Privada" },
  });
  const res = await api(ctx.baseUrl, `/api/rooms/${room.body.room.id}`, {
    token: outsider.accessToken,
  });
  assert.equal(res.status, 403);
});
