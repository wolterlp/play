import { useEffect, useMemo, useRef, useState } from "react";
import type { ServerMessage } from "@play/shared";
import { YouTubeAdapter } from "../audio/youtube-adapter.js";
import { ClockSynchronizer } from "../audio/clock-synchronizer.js";
import { SyncEngine } from "../audio/sync-engine.js";
import { LocalAudioStore, type LocalAudioPrefs } from "../audio/local-audio-store.js";
import { RoomClient } from "./room-client.js";
import { RoomSession, type RoomSessionState } from "./room-session.js";

export interface UseRoomOptions {
  roomId: string;
  getAccessToken: () => string | null;
}

export interface UseRoomResult {
  state: RoomSessionState;
  client: RoomClient | null;
  localAudio: LocalAudioPrefs;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  attachPlayer: (container: HTMLElement) => void;
  /** Reintenta la reproducción tras un gesto del usuario (autoplay). */
  resumeLocalPlayback: () => Promise<void>;
  playerActionMessage: string | null;
  clearPlayerAction: () => void;
}

const initialSessionState: RoomSessionState = {
  connection: "connecting",
  snapshot: null,
  playerStatus: "idle",
  playerError: null,
  driftMs: null,
  latencyMs: null,
  positionMs: null,
  durationMs: null,
  needsGesture: false,
  lastNonstopTransition: null,
  roomClosed: null,
};

export function useRoom(options: UseRoomOptions): UseRoomResult {
  const { roomId, getAccessToken } = options;
  const [state, setState] = useState<RoomSessionState>(initialSessionState);
  const [localAudio, setLocalAudio] = useState<LocalAudioPrefs>(
    () => new LocalAudioStore().get(),
  );
  const [playerActionMessage, setPlayerActionMessage] = useState<string | null>(null);

  const localAudioRef = useRef<LocalAudioStore>(new LocalAudioStore());
  const sessionRef = useRef<RoomSession | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  const client = useMemo(
    () =>
      new RoomClient(
        import.meta.env.VITE_WS_URL ?? window.location.origin,
        getAccessToken,
        {
          onMessage: (m: ServerMessage) => void sessionRef.current?.handleMessage(m),
          onStatus: (s) => sessionRef.current?.setConnection(s),
        },
      ),
    [getAccessToken],
  );

  useEffect(() => {
    const adapter = new YouTubeAdapter();
    const clock = new ClockSynchronizer();
    const sync = new SyncEngine({
      adapter,
      clock,
      onCorrection: (info) => {
        if (info.kind === "HARD_SEEK") {
          setPlayerActionMessage(
            `Se corrigió la sincronización (desfase ${Math.round(info.driftMs)} ms).`,
          );
        }
      },
    });
    const session = new RoomSession({
      client,
      adapter,
      clock,
      sync,
      localAudio: localAudioRef.current,
      onState: setState,
      onPlayerActionRequired: (_reason, message) => setPlayerActionMessage(message),
    });
    sessionRef.current = session;

    // El (re)join vive en onConnect: cada reconexión Socket.IO reenvía ROOM_JOIN,
    // por lo que la sesión se recupera sin intervención del usuario.
    client.onConnect = () => client.joinWithRoom(roomId);
    client.connect();

    const unsubAudio = localAudioRef.current.subscribe((prefs) => {
      setLocalAudio(prefs);
      session.refreshLocalAudio();
    });

    return () => {
      unsubAudio();
      session.destroy();
      client.disconnect();
      sessionRef.current = null;
    };
  }, [client, roomId]);

  const attachPlayer = (container: HTMLElement) => {
    containerRef.current = container;
    if (!sessionRef.current) return;
    void sessionRef.current.attach(container, roomId);
  };

  return {
    state,
    client,
    localAudio,
    setVolume: (v) => localAudioRef.current.setVolume(v),
    toggleMute: () => localAudioRef.current.toggleMute(),
    attachPlayer,
    resumeLocalPlayback: () => sessionRef.current?.resumeLocal() ?? Promise.resolve(),
    playerActionMessage,
    clearPlayerAction: () => setPlayerActionMessage(null),
  };
}
