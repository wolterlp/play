import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RoomSnapshot, ServerMessage } from "@play/shared";
import { RoomSession, type RoomSessionState } from "./room-session.js";
import type { RoomClient } from "./room-client.js";
import type { AudioSourceAdapter } from "../audio/adapter.js";
import type { ClockSynchronizer } from "../audio/clock-synchronizer.js";
import type { SyncEngine } from "../audio/sync-engine.js";
import type { LocalAudioStore } from "../audio/local-audio-store.js";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_HOST = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

function makeSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    room: {
      id: ROOM_ID,
      name: "Sala",
      privacyMode: "PRIVATE",
      controlMode: "COLLABORATIVE",
      nonstopEnabled: true,
      repeatMode: "OFF",
      maxParticipants: 20,
      status: "OPEN",
      ownerUserId: USER_HOST,
      participantCount: 1,
      createdAt: new Date().toISOString(),
    },
    you: {
      userId: USER_HOST,
      role: "HOST",
      permissions: {
        canControlPlayback: true,
        canAddToQueue: true,
        canManageMembers: true,
        canManageRoom: true,
        canManageInvites: true,
      },
    },
    members: [],
    queue: [],
    playback: {
      roomId: ROOM_ID,
      sourceType: "YOUTUBE",
      currentQueueItemId: null,
      playbackStatus: "IDLE",
      anchorPositionMs: 0,
      anchorServerTimeMs: Date.now(),
      playbackRate: 1,
      version: 1,
      updatedBy: null,
    },
    serverTimeMs: Date.now(),
    ...overrides,
  } as RoomSnapshot;
}

function makeQueueItem(id: string) {
  return {
    id,
    roomId: ROOM_ID,
    position: 0,
    sourceType: "YOUTUBE" as const,
    sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    externalContentId: "abcdefghijk",
    title: null,
    status: "CURRENT" as const,
    addedBy: USER_HOST,
    addedByDisplayName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

interface FakeClientCalls {
  next: unknown[];
  ping: number[];
  reportStatus: unknown[];
  reportPlayerError: unknown[];
  playerReady: unknown[];
}

function makeFakeClient() {
  const calls: FakeClientCalls = { next: [], ping: [], reportStatus: [], reportPlayerError: [], playerReady: [] };
  const client = {
    next: (...args: unknown[]) => calls.next.push(args),
    ping: (t: number) => calls.ping.push(t),
    reportStatus: (...args: unknown[]) => calls.reportStatus.push(args),
    reportPlayerError: (...args: unknown[]) => calls.reportPlayerError.push(args),
    playerReady: (...args: unknown[]) => calls.playerReady.push(args),
  };
  return { client: client as unknown as RoomClient, calls };
}

function makeFakeAdapter(opts: { playRejects?: boolean; ready?: boolean } = {}) {
  const state = {
    volume: 1,
    muted: false,
    loaded: null as string | null,
    playing: false,
    currentTime: 0,
    destroyed: false,
  };
  const adapter = {
    sourceType: "youtube",
    init: vi.fn(async () => undefined),
    load: vi.fn(async (id: string) => {
      state.loaded = id;
    }),
    play: vi.fn(async () => {
      if (opts.playRejects) throw new Error("autoplay blocked");
      state.playing = true;
    }),
    pause: vi.fn(async () => {
      state.playing = false;
    }),
    seekTo: vi.fn(async () => undefined),
    setVolume: vi.fn((v: number) => {
      state.volume = v;
    }),
    mute: vi.fn((m: boolean) => {
      state.muted = m;
    }),
    getCurrentTime: () => state.currentTime,
    getDuration: () => 100,
    isReady: () => opts.ready ?? true,
    isBuffering: () => false,
    destroy: vi.fn(() => {
      state.destroyed = true;
    }),
    onEnded: vi.fn(),
    onError: vi.fn(),
    onStateChange: vi.fn(),
  };
  return { adapter: adapter as unknown as AudioSourceAdapter, state, spy: adapter };
}

function makeFakeClock() {
  const samples: Array<[number, number, number]> = [];
  const clock = {
    addSample: (send: number, receive: number, server: number) => {
      samples.push([send, receive, server]);
    },
    estimatedServerNowDateMs: () => Date.now(),
    getOffset: () => null,
    roundTripMs: null,
  };
  return { clock: clock as unknown as ClockSynchronizer, samples };
}

function makeFakeSync() {
  return { tick: () => ({ driftMs: null }) } as unknown as SyncEngine;
}

function makeFakeLocalAudio() {
  const prefs = { volume: 80, muted: false };
  return {
    get: () => ({ ...prefs }),
    setVolume: (v: number) => {
      prefs.volume = v;
    },
    toggleMute: () => {
      prefs.muted = !prefs.muted;
    },
    subscribe: () => () => undefined,
  } as unknown as LocalAudioStore;
}

function makeSession(opts: { playRejects?: boolean } = {}) {
  const { client, calls } = makeFakeClient();
  const { adapter, state, spy } = makeFakeAdapter(opts);
  const { clock, samples } = makeFakeClock();
  const states: RoomSessionState[] = [];
  const actions: Array<{ reason: string; message: string }> = [];
  const session = new RoomSession({
    client,
    adapter,
    clock,
    sync: makeFakeSync(),
    localAudio: makeFakeLocalAudio(),
    onState: (s) => states.push({ ...s }),
    onPlayerActionRequired: (reason, message) => actions.push({ reason, message }),
  });
  return { session, client, calls, adapter: state, adapterSpy: spy, clockSamples: samples, states, actions };
}

const container = document.createElement("div");

describe("RoomSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ROOM_ERROR notifica al usuario vía la acción requerida", async () => {
    const { session, actions } = makeSession();
    const msg: ServerMessage = {
      type: "ROOM_ERROR",
      code: "FORBIDDEN",
      message: "No puedes controlar la reproducción.",
    };
    await session.handleMessage(msg);
    expect(actions.at(-1)).toEqual({ reason: "ROOM_ERROR", message: "No puedes controlar la reproducción." });
  });

  it("el volumen local solo toca el adaptador: nunca envía eventos de red", async () => {
    const { session, calls, adapterSpy } = makeSession();
    session.refreshLocalAudio();
    expect(adapterSpy.setVolume).toHaveBeenCalled();
    expect(adapterSpy.mute).toHaveBeenCalled();
    expect(calls.next).toHaveLength(0);
    expect(calls.ping).toHaveLength(0);
    expect(calls.reportStatus).toHaveLength(0);
    expect(calls.reportPlayerError).toHaveLength(0);
    expect(calls.playerReady).toHaveLength(0);
  });

  it("PING/PONG usa la base epoch (Date.now), no performance.now", async () => {
    const { session, clockSamples, states } = makeSession();
    const before = Date.now();
    await session.handleMessage({
      type: "PONG",
      clientTimeMs: 1000,
      serverTimeMs: before + 20,
    });
    const after = Date.now();
    const [, receiveMs] = clockSamples[0]!;
    expect(receiveMs).toBeGreaterThanOrEqual(before);
    expect(receiveMs).toBeLessThanOrEqual(after);
    // PONG también alimenta el indicador de latencia del usuario.
    expect(states.at(-1)!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("ROOM_CLOSED marca la sala como cerrada y pausa el reproductor local", async () => {
    const { session, states, adapterSpy } = makeSession();
    await session.handleMessage({
      type: "ROOM_SNAPSHOT",
      snapshot: makeSnapshot(),
    });
    await session.handleMessage({
      type: "ROOM_CLOSED",
      roomId: ROOM_ID,
      reason: "HOST_CLOSED",
    });
    const last = states.at(-1)!;
    expect(last.roomClosed).toEqual({ reason: "HOST_CLOSED" });
    expect(last.snapshot?.room.status).toBe("CLOSED");
    expect(adapterSpy.pause).toHaveBeenCalled();
  });

  it("ROOM_UPDATED reemplaza los metadatos de la sala del snapshot", async () => {
    const { session, states } = makeSession();
    await session.handleMessage({ type: "ROOM_SNAPSHOT", snapshot: makeSnapshot() });
    const updatedRoom = { ...makeSnapshot().room, name: "Renombrada", repeatMode: "ONE" as const };
    await session.handleMessage({
      type: "ROOM_UPDATED",
      room: updatedRoom,
      reason: "SETTINGS_CHANGED",
    });
    const last = states.at(-1)!;
    expect(last.snapshot?.room.name).toBe("Renombrada");
    expect(last.snapshot?.room.repeatMode).toBe("ONE");
  });

  it("autoplay bloqueado marca needs-gesture y resumeLocal lo resuelve tras el gesto", async () => {
    const { session, states, adapterSpy } = makeSession({ playRejects: true });
    await session.attach(container, ROOM_ID);

    await session.handleMessage({
      type: "ROOM_SNAPSHOT",
      snapshot: makeSnapshot({
        queue: [makeQueueItem(ITEM_ID)],
        playback: {
          ...makeSnapshot().playback,
          currentQueueItemId: ITEM_ID,
          playbackStatus: "PLAYING",
          version: 2,
        },
      }),
    });

    expect(states.at(-1)!.needsGesture).toBe(true);
    expect(adapterSpy.load).toHaveBeenCalledWith("abcdefghijk", expect.any(Number));

    // El usuario toca "Reproducir aquí": ahora sí debe reproducir.
    (adapterSpy.play as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await session.resumeLocal();
    const last = states.at(-1)!;
    expect(last.needsGesture).toBe(false);
    expect(last.playerStatus).toBe("playing");
  });

  it("ROOM_MEMBER_JOINED agrega al miembro y sube participantCount; un duplicado solo lo actualiza", async () => {
    const { session, states } = makeSession();
    await session.handleMessage({ type: "ROOM_SNAPSHOT", snapshot: makeSnapshot() });

    const member = {
      userId: "44444444-4444-4444-8444-444444444444",
      displayName: "Invitada",
      role: "PARTICIPANT" as const,
      connectionState: "CONNECTED" as const,
      joinedAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    await session.handleMessage({ type: "ROOM_MEMBER_JOINED", member, version: 2 });
    let last = states.at(-1)!;
    expect(last.snapshot?.members).toHaveLength(1);
    expect(last.snapshot?.room.participantCount).toBe(2);

    await session.handleMessage({
      type: "ROOM_MEMBER_JOINED",
      member: { ...member, displayName: "Invitada (actualizada)" },
      version: 3,
    });
    last = states.at(-1)!;
    expect(last.snapshot?.members).toHaveLength(1);
    expect(last.snapshot?.members[0]?.displayName).toBe("Invitada (actualizada)");
    expect(last.snapshot?.room.participantCount).toBe(2);
  });

  it("ROOM_MEMBER_LEFT marca al miembro como desconectado sin quitarlo de la lista", async () => {
    const { session, states } = makeSession();
    const member = {
      userId: "44444444-4444-4444-8444-444444444444",
      displayName: "Invitada",
      role: "PARTICIPANT" as const,
      connectionState: "CONNECTED" as const,
      joinedAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    await session.handleMessage({
      type: "ROOM_SNAPSHOT",
      snapshot: makeSnapshot({ members: [member] }),
    });
    await session.handleMessage({ type: "ROOM_MEMBER_LEFT", userId: member.userId, version: 2 });
    const last = states.at(-1)!;
    expect(last.snapshot?.members).toHaveLength(1);
    expect(last.snapshot?.members[0]?.connectionState).toBe("DISCONNECTED");
  });

  it("NONSTOP_TRANSITION_STARTED duplica el mismo transitionId una sola vez", async () => {
    const { session, states } = makeSession();
    const transitionId = "55555555-5555-4555-8555-555555555555";
    const msg = {
      type: "NONSTOP_TRANSITION_STARTED" as const,
      fromQueueItemId: ITEM_ID,
      toQueueItemId: "66666666-6666-4666-8666-666666666666",
      transitionId,
    };
    await session.handleMessage(msg);
    await session.handleMessage(msg);
    const transitions = states.filter((s) => s.lastNonstopTransition !== null);
    expect(transitions.at(-1)!.lastNonstopTransition).toEqual({
      transitionId,
      from: ITEM_ID,
      to: "66666666-6666-4666-8666-666666666666",
    });
  });

  it("PLAYBACK_SYNC_TARGET de otra pista se ignora; el del item cargado puebla la deriva", async () => {
    const { session, clockSamples, states } = makeSession();
    await session.attach(container, ROOM_ID);
    await session.handleMessage({
      type: "ROOM_SNAPSHOT",
      snapshot: makeSnapshot({
        queue: [makeQueueItem(ITEM_ID)],
        playback: {
          ...makeSnapshot().playback,
          currentQueueItemId: ITEM_ID,
          playbackStatus: "PLAYING",
          version: 2,
        },
      }),
    });

    // Obsoleto: otra pista → sin deriva.
    await session.handleMessage({
      type: "PLAYBACK_SYNC_TARGET",
      target: {
        queueItemId: "77777777-7777-4777-8777-777777777777",
        targetPositionMs: 42_000,
        serverTimeMs: Date.now(),
      },
    });
    expect(clockSamples).toHaveLength(0);
    expect(states.at(-1)!.driftMs).toBeNull();

    // Item cargado: puebla la deriva (local 0 ms contra objetivo 10 s).
    // Sin reporte previo no hay muestra de reloj que agregar.
    await session.handleMessage({
      type: "PLAYBACK_SYNC_TARGET",
      target: {
        queueItemId: ITEM_ID,
        targetPositionMs: 10_000,
        serverTimeMs: Date.now(),
      },
    });
    expect(clockSamples).toHaveLength(0);
    expect(states.at(-1)!.driftMs).toBe(-10_000);
  });
});
