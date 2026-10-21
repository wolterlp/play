import type {
  PlaybackState,
  QueueItem,
  RoomMember,
  RoomSummary,
} from "@play/shared";
import { MEMBER_CONNECTION_STATES } from "@play/shared";
import type {
  PlaybackStateRow,
  QueueItemRow,
  RoomMemberRow,
  RoomRow,
} from "./rows.js";

function num(v: string | number | bigint): number {
  return Number(v);
}

export function toRoomSummary(
  row: RoomRow,
  participantCount: number,
): RoomSummary {
  return {
    id: row.id,
    name: row.name,
    privacyMode: row.privacy_mode,
    controlMode: row.control_mode,
    nonstopEnabled: row.nonstop_enabled,
    repeatMode: row.repeat_mode,
    maxParticipants: row.max_participants,
    status: row.status,
    ownerUserId: row.owner_user_id,
    participantCount,
    createdAt: row.created_at.toISOString(),
  };
}

export function toRoomMember(
  row: RoomMemberRow & { display_name: string },
  connectionState: (typeof MEMBER_CONNECTION_STATES)[number],
): RoomMember {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    connectionState,
    joinedAt: row.joined_at.toISOString(),
    lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
  };
}

export function toQueueItem(
  row: QueueItemRow,
  addedByDisplayName: string | null,
): QueueItem {
  return {
    id: row.id,
    roomId: row.room_id,
    position: row.position,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    externalContentId: row.external_content_id,
    title: row.title,
    status: row.status,
    addedBy: row.added_by,
    addedByDisplayName,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toPlaybackState(row: PlaybackStateRow): PlaybackState {
  return {
    roomId: row.room_id,
    sourceType: row.source_type,
    currentQueueItemId: row.current_queue_item_id,
    playbackStatus: row.playback_status,
    anchorPositionMs: num(row.anchor_position_ms),
    anchorServerTimeMs: num(row.anchor_server_time_ms),
    playbackRate: row.playback_rate,
    version: num(row.version),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}
