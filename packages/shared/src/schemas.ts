import { z } from "zod";
import {
  CONTROL_MODES,
  MEMBER_CONNECTION_STATES,
  PLAYBACK_STATUSES,
  PRIVACY_MODES,
  QUEUE_ITEM_STATUSES,
  REPEAT_MODES,
  ROLES,
  ROOM_STATUSES,
  SOURCE_TYPES,
} from "./enums.js";

const uuid = z.string().uuid();
const isoDate = z.string().datetime();
const nonNegativeInt = z.number().int().min(0);

export const roleSchema = z.enum(ROLES);
export const controlModeSchema = z.enum(CONTROL_MODES);
export const privacyModeSchema = z.enum(PRIVACY_MODES);
export const roomStatusSchema = z.enum(ROOM_STATUSES);
export const playbackStatusSchema = z.enum(PLAYBACK_STATUSES);
export const queueItemStatusSchema = z.enum(QUEUE_ITEM_STATUSES);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export const repeatModeSchema = z.enum(REPEAT_MODES);
export const memberConnectionStateSchema = z.enum(MEMBER_CONNECTION_STATES);

/* ------------------------------- Entidades ------------------------------- */

export const authUserSchema = z.object({
  id: uuid,
  displayName: z.string(),
  email: z.string().email(),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInMs: z.number().int().positive(),
});

export const roomSummarySchema = z.object({
  id: uuid,
  name: z.string(),
  privacyMode: privacyModeSchema,
  controlMode: controlModeSchema,
  nonstopEnabled: z.boolean(),
  repeatMode: repeatModeSchema,
  maxParticipants: z.number().int().positive(),
  status: roomStatusSchema,
  ownerUserId: uuid,
  participantCount: nonNegativeInt,
  createdAt: isoDate,
});

export const roomMemberSchema = z.object({
  userId: uuid,
  displayName: z.string(),
  role: roleSchema,
  connectionState: memberConnectionStateSchema,
  joinedAt: isoDate,
  lastSeenAt: isoDate.nullable(),
});

export const queueItemSchema = z.object({
  id: uuid,
  roomId: uuid,
  position: nonNegativeInt,
  sourceType: sourceTypeSchema,
  sourceUrl: z.string().url(),
  externalContentId: z.string(),
  title: z.string().nullable(),
  status: queueItemStatusSchema,
  addedBy: uuid,
  addedByDisplayName: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const playbackStateSchema = z.object({
  roomId: uuid,
  sourceType: sourceTypeSchema,
  currentQueueItemId: uuid.nullable(),
  playbackStatus: playbackStatusSchema,
  anchorPositionMs: nonNegativeInt,
  anchorServerTimeMs: nonNegativeInt,
  playbackRate: z.number().positive().max(4),
  version: nonNegativeInt,
  updatedBy: uuid.nullable(),
  updatedAt: isoDate,
});

export const inviteSummarySchema = z.object({
  id: uuid,
  roomId: uuid,
  expiresAt: isoDate,
  revokedAt: isoDate.nullable(),
  createdAt: isoDate,
  token: z.string().optional(),
  joinUrl: z.string().optional(),
});

export const roomPermissionsSchema = z.object({
  canManageRoom: z.boolean(),
  canManageInvites: z.boolean(),
  canManageMembers: z.boolean(),
  canAddToQueue: z.boolean(),
  canRemoveFromQueue: z.boolean(),
  canReorderQueue: z.boolean(),
  canControlPlayback: z.boolean(),
});

export const roomSnapshotSchema = z.object({
  protocolVersion: z.number().int().positive(),
  room: roomSummarySchema,
  members: z.array(roomMemberSchema),
  queue: z.array(queueItemSchema),
  playback: playbackStateSchema,
  you: z.object({
    userId: uuid,
    role: roleSchema,
    permissions: roomPermissionsSchema,
  }),
  serverTimeMs: nonNegativeInt,
});

export const playbackSyncTargetSchema = z.object({
  queueItemId: uuid.nullable(),
  targetPositionMs: nonNegativeInt,
  serverTimeMs: nonNegativeInt,
});

/* --------------------------- Cliente -> Servidor -------------------------- */

const envelope = {
  requestId: z.string().min(1).max(64).optional(),
};

export const clientMessages = {
  ROOM_JOIN: z.object({
    type: z.literal("ROOM_JOIN"),
    protocolVersion: z.number().int().positive(),
    roomId: uuid.optional(),
    ...envelope,
  }),
  ROOM_LEAVE: z.object({
    type: z.literal("ROOM_LEAVE"),
    roomId: uuid,
    ...envelope,
  }),
  QUEUE_ITEM_ADD: z.object({
    type: z.literal("QUEUE_ITEM_ADD"),
    roomId: uuid,
    sourceUrl: z.string().url().max(2048),
    title: z.string().max(200).optional(),
    ...envelope,
  }),
  QUEUE_ITEM_REMOVE: z.object({
    type: z.literal("QUEUE_ITEM_REMOVE"),
    roomId: uuid,
    queueItemId: uuid,
    ...envelope,
  }),
  QUEUE_ITEM_MOVE: z.object({
    type: z.literal("QUEUE_ITEM_MOVE"),
    roomId: uuid,
    queueItemId: uuid,
    toPosition: nonNegativeInt,
    ...envelope,
  }),
  PLAYBACK_PLAY: z.object({
    type: z.literal("PLAYBACK_PLAY"),
    roomId: uuid,
    positionMs: nonNegativeInt.optional(),
    ...envelope,
  }),
  PLAYBACK_PAUSE: z.object({
    type: z.literal("PLAYBACK_PAUSE"),
    roomId: uuid,
    positionMs: nonNegativeInt.optional(),
    ...envelope,
  }),
  PLAYBACK_SEEK: z.object({
    type: z.literal("PLAYBACK_SEEK"),
    roomId: uuid,
    positionMs: nonNegativeInt,
    ...envelope,
  }),
  PLAYBACK_NEXT: z.object({
    type: z.literal("PLAYBACK_NEXT"),
    roomId: uuid,
    reason: z.enum(["USER", "ENDED", "ERROR"]).default("USER"),
    failedQueueItemId: uuid.optional(),
    ...envelope,
  }),
  PLAYBACK_PREVIOUS: z.object({
    type: z.literal("PLAYBACK_PREVIOUS"),
    roomId: uuid,
    ...envelope,
  }),
  PLAYER_READY: z.object({
    type: z.literal("PLAYER_READY"),
    roomId: uuid,
    ...envelope,
  }),
  PLAYER_STATUS_REPORT: z.object({
    type: z.literal("PLAYER_STATUS_REPORT"),
    roomId: uuid,
    report: z.object({ queueItemId: uuid.nullable() }),
    ...envelope,
  }),
  PLAYER_ERROR: z.object({
    type: z.literal("PLAYER_ERROR"),
    roomId: uuid,
    queueItemId: uuid.nullable(),
    code: z.string().max(64),
    message: z.string().max(512),
    fatal: z.boolean().default(false),
    ...envelope,
  }),
  PING: z.object({
    type: z.literal("PING"),
    clientTimeMs: nonNegativeInt,
    ...envelope,
  }),
} as const;

/* --------------------------- Servidor -> Cliente -------------------------- */

export const serverMessages = {
  ROOM_SNAPSHOT: z.object({
    type: z.literal("ROOM_SNAPSHOT"),
    snapshot: roomSnapshotSchema,
  }),
  ROOM_MEMBER_JOINED: z.object({
    type: z.literal("ROOM_MEMBER_JOINED"),
    member: roomMemberSchema,
    version: nonNegativeInt,
  }),
  ROOM_MEMBER_LEFT: z.object({
    type: z.literal("ROOM_MEMBER_LEFT"),
    userId: uuid,
    version: nonNegativeInt,
  }),
  ROOM_UPDATED: z.object({
    type: z.literal("ROOM_UPDATED"),
    room: roomSummarySchema,
    reason: z.enum(["SETTINGS_CHANGED", "HOST_DISCONNECTED", "HOST_RECONNECTED"]),
  }),
  ROOM_CLOSED: z.object({
    type: z.literal("ROOM_CLOSED"),
    roomId: uuid,
    reason: z.enum([
      "HOST_CLOSED",
      "HOST_DELETED",
      "HOST_GRACE_EXPIRED",
    ]),
  }),
  QUEUE_UPDATED: z.object({
    type: z.literal("QUEUE_UPDATED"),
    queue: z.array(queueItemSchema),
    version: nonNegativeInt,
  }),
  QUEUE_ITEM_ADDED: z.object({
    type: z.literal("QUEUE_ITEM_ADDED"),
    item: queueItemSchema,
    version: nonNegativeInt,
  }),
  PLAYBACK_STATE_UPDATED: z.object({
    type: z.literal("PLAYBACK_STATE_UPDATED"),
    playback: playbackStateSchema,
    currentItem: queueItemSchema.nullable(),
  }),
  PLAYBACK_SYNC_TARGET: z.object({
    type: z.literal("PLAYBACK_SYNC_TARGET"),
    target: playbackSyncTargetSchema,
  }),
  NONSTOP_TRANSITION_STARTED: z.object({
    type: z.literal("NONSTOP_TRANSITION_STARTED"),
    fromQueueItemId: uuid.nullable(),
    toQueueItemId: uuid.nullable(),
    transitionId: uuid,
  }),
  PLAYER_ACTION_REQUIRED: z.object({
    type: z.literal("PLAYER_ACTION_REQUIRED"),
    reason: z.enum([
      "USER_GESTURE_REQUIRED",
      "MANUAL_SYNC_RECOMMENDED",
      "SOURCE_RESTRICTED",
      "PLAYBACK_BLOCKED",
    ]),
    message: z.string().max(512),
  }),
  ROOM_ERROR: z.object({
    type: z.literal("ROOM_ERROR"),
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
  PONG: z.object({
    type: z.literal("PONG"),
    clientTimeMs: nonNegativeInt,
    serverTimeMs: nonNegativeInt,
  }),
} as const;

/* ------------------------------- Uniones ------------------------------- */

export const clientMessageSchema = z.discriminatedUnion("type", [
  clientMessages.ROOM_JOIN,
  clientMessages.ROOM_LEAVE,
  clientMessages.QUEUE_ITEM_ADD,
  clientMessages.QUEUE_ITEM_REMOVE,
  clientMessages.QUEUE_ITEM_MOVE,
  clientMessages.PLAYBACK_PLAY,
  clientMessages.PLAYBACK_PAUSE,
  clientMessages.PLAYBACK_SEEK,
  clientMessages.PLAYBACK_NEXT,
  clientMessages.PLAYBACK_PREVIOUS,
  clientMessages.PLAYER_READY,
  clientMessages.PLAYER_STATUS_REPORT,
  clientMessages.PLAYER_ERROR,
  clientMessages.PING,
]);

export const serverMessageSchema = z.discriminatedUnion("type", [
  serverMessages.ROOM_SNAPSHOT,
  serverMessages.ROOM_MEMBER_JOINED,
  serverMessages.ROOM_MEMBER_LEFT,
  serverMessages.ROOM_UPDATED,
  serverMessages.ROOM_CLOSED,
  serverMessages.QUEUE_UPDATED,
  serverMessages.QUEUE_ITEM_ADDED,
  serverMessages.PLAYBACK_STATE_UPDATED,
  serverMessages.PLAYBACK_SYNC_TARGET,
  serverMessages.NONSTOP_TRANSITION_STARTED,
  serverMessages.PLAYER_ACTION_REQUIRED,
  serverMessages.ROOM_ERROR,
  serverMessages.PONG,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
