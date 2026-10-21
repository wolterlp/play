import type {
  ControlMode,
  PrivacyMode,
  RepeatMode,
  Role,
  SourceType,
} from "@play/shared";

export interface RoomRow {
  id: string;
  name: string;
  owner_user_id: string;
  privacy_mode: PrivacyMode;
  control_mode: ControlMode;
  nonstop_enabled: boolean;
  repeat_mode: RepeatMode;
  max_participants: number;
  status: "OPEN" | "CLOSED" | "SUSPENDED";
  host_grace_until: Date | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

export interface RoomMemberRow {
  id: string;
  room_id: string;
  user_id: string;
  role: Role;
  joined_at: Date;
  last_seen_at: Date | null;
  left_at: Date | null;
}

export interface QueueItemRow {
  id: string;
  room_id: string;
  position: number;
  source_type: "YOUTUBE";
  source_url: string;
  external_content_id: string;
  title: string | null;
  status: "PENDING" | "CURRENT" | "PLAYED" | "SKIPPED" | "UNAVAILABLE" | "FAILED";
  retry_count: number;
  added_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface PlaybackStateRow {
  room_id: string;
  source_type: SourceType;
  current_queue_item_id: string | null;
  playback_status:
    | "PLAYING"
    | "PAUSED"
    | "BUFFERING"
    | "IDLE"
    | "QUEUE_EMPTY"
    | "ERROR";
  anchor_position_ms: string | number;
  anchor_server_time_ms: string | number;
  playback_rate: number;
  version: string | number;
  updated_by: string | null;
  updated_at: Date;
}
