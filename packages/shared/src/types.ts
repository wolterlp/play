import type {
  ControlMode,
  MemberConnectionState,
  PlaybackStatus,
  PrivacyMode,
  QueueItemStatus,
  RepeatMode,
  Role,
  RoomStatus,
  SourceType,
} from "./enums.js";

export interface AuthUser {
  id: string;
  displayName: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Milisegundos hasta la expiración del access token. */
  expiresInMs: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  privacyMode: PrivacyMode;
  controlMode: ControlMode;
  nonstopEnabled: boolean;
  repeatMode: RepeatMode;
  maxParticipants: number;
  status: RoomStatus;
  ownerUserId: string;
  participantCount: number;
  createdAt: string;
}

export interface RoomMember {
  userId: string;
  displayName: string;
  role: Role;
  connectionState: MemberConnectionState;
  joinedAt: string;
  lastSeenAt: string | null;
}

export interface QueueItem {
  id: string;
  roomId: string;
  position: number;
  sourceType: SourceType;
  sourceUrl: string;
  externalContentId: string;
  title: string | null;
  status: QueueItemStatus;
  addedBy: string;
  addedByDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybackState {
  roomId: string;
  sourceType: SourceType;
  currentQueueItemId: string | null;
  playbackStatus: PlaybackStatus;
  anchorPositionMs: number;
  anchorServerTimeMs: number;
  playbackRate: number;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface InviteSummary {
  id: string;
  roomId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  /** Solo se devuelve en la creación. */
  token?: string;
  joinUrl?: string;
}

export interface RoomSnapshot {
  protocolVersion: number;
  room: RoomSummary;
  members: RoomMember[];
  queue: QueueItem[];
  playback: PlaybackState;
  you: {
    userId: string;
    role: Role;
    permissions: RoomPermissions;
  };
  serverTimeMs: number;
}

export interface RoomPermissions {
  canManageRoom: boolean;
  canManageInvites: boolean;
  canManageMembers: boolean;
  canAddToQueue: boolean;
  canRemoveFromQueue: boolean;
  canReorderQueue: boolean;
  canControlPlayback: boolean;
}

export interface RoomListItem extends RoomSummary {
  role: Role;
}
