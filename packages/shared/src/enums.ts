export const PROTOCOL_VERSION = 1 as const;

export const ROLES = ["HOST", "DJ", "PARTICIPANT", "OBSERVER"] as const;
export type Role = (typeof ROLES)[number];

export const PRIVACY_MODES = ["PRIVATE", "UNLISTED"] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const CONTROL_MODES = [
  "HOST_ONLY",
  "COLLABORATIVE",
  "COLLABORATIVE_QUEUE_HOST_PLAYBACK",
] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

export const ROOM_STATUSES = ["OPEN", "CLOSED", "SUSPENDED"] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const PLAYBACK_STATUSES = [
  "PLAYING",
  "PAUSED",
  "BUFFERING",
  "IDLE",
  "QUEUE_EMPTY",
  "ERROR",
] as const;
export type PlaybackStatus = (typeof PLAYBACK_STATUSES)[number];

export const QUEUE_ITEM_STATUSES = [
  "PENDING",
  "CURRENT",
  "PLAYED",
  "SKIPPED",
  "UNAVAILABLE",
  "FAILED",
] as const;
export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number];

export const SOURCE_TYPES = ["YOUTUBE"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const REPEAT_MODES = ["OFF", "ALL", "ONE"] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];

export const MEMBER_CONNECTION_STATES = [
  "CONNECTED",
  "RECONNECTING",
  "DISCONNECTED",
] as const;
export type MemberConnectionState = (typeof MEMBER_CONNECTION_STATES)[number];
