CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX refresh_tokens_hash_idx ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE rooms (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  owner_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  privacy_mode     TEXT NOT NULL DEFAULT 'PRIVATE'
                     CHECK (privacy_mode IN ('PRIVATE','UNLISTED')),
  control_mode     TEXT NOT NULL DEFAULT 'COLLABORATIVE'
                     CHECK (control_mode IN ('HOST_ONLY','COLLABORATIVE','COLLABORATIVE_QUEUE_HOST_PLAYBACK')),
  nonstop_enabled  BOOLEAN NOT NULL DEFAULT true,
  max_participants INTEGER NOT NULL DEFAULT 20 CHECK (max_participants BETWEEN 2 AND 200),
  status           TEXT NOT NULL DEFAULT 'OPEN'
                     CHECK (status IN ('OPEN','CLOSED','SUSPENDED')),
  host_grace_until TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ
);

CREATE INDEX rooms_owner_idx ON rooms (owner_user_id);

CREATE TABLE room_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'PARTICIPANT'
                 CHECK (role IN ('HOST','DJ','PARTICIPANT','OBSERVER')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ,
  left_at      TIMESTAMPTZ,
  UNIQUE (room_id, user_id)
);

CREATE INDEX room_members_room_idx ON room_members (room_id);

CREATE TABLE room_invites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX room_invites_hash_idx ON room_invites (token_hash);
CREATE INDEX room_invites_room_idx ON room_invites (room_id);
CREATE INDEX room_invites_expiry_idx ON room_invites (expires_at);

CREATE TABLE queue_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL CHECK (position >= 0),
  source_type         TEXT NOT NULL DEFAULT 'YOUTUBE' CHECK (source_type IN ('YOUTUBE')),
  source_url          TEXT NOT NULL,
  external_content_id TEXT NOT NULL CHECK (char_length(external_content_id) BETWEEN 1 AND 64),
  title               TEXT CHECK (title IS NULL OR char_length(title) <= 200),
  status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','CURRENT','PLAYED','SKIPPED','UNAVAILABLE','FAILED')),
  retry_count         INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  added_by            UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX queue_items_room_position_idx ON queue_items (room_id, position);
CREATE INDEX queue_items_room_status_idx ON queue_items (room_id, status);

CREATE TABLE room_playback_state (
  room_id              UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  current_queue_item_id UUID REFERENCES queue_items(id) ON DELETE SET NULL,
  playback_status      TEXT NOT NULL DEFAULT 'IDLE'
                         CHECK (playback_status IN ('PLAYING','PAUSED','BUFFERING','IDLE','QUEUE_EMPTY','ERROR')),
  anchor_position_ms   BIGINT NOT NULL DEFAULT 0 CHECK (anchor_position_ms >= 0),
  anchor_server_time_ms BIGINT NOT NULL DEFAULT 0 CHECK (anchor_server_time_ms >= 0),
  playback_rate        REAL NOT NULL DEFAULT 1 CHECK (playback_rate > 0 AND playback_rate <= 4),
  version              BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE room_events (
  seq        BIGSERIAL PRIMARY KEY,
  room_id    UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  version    BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX room_events_room_seq_idx ON room_events (room_id, seq);

-- DOWN

DROP TABLE IF EXISTS room_events;
DROP TABLE IF EXISTS room_playback_state;
DROP TABLE IF EXISTS queue_items;
DROP TABLE IF EXISTS room_invites;
DROP TABLE IF EXISTS room_members;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

