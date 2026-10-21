ALTER TABLE rooms
  ADD COLUMN repeat_mode TEXT NOT NULL DEFAULT 'OFF'
    CHECK (repeat_mode IN ('OFF', 'ALL', 'ONE'));

ALTER TABLE room_playback_state
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'YOUTUBE'
    CHECK (source_type IN ('YOUTUBE'));

CREATE INDEX rooms_suspended_grace_idx ON rooms (host_grace_until)
  WHERE status = 'SUSPENDED';

-- DOWN

DROP INDEX IF EXISTS rooms_suspended_grace_idx;
ALTER TABLE room_playback_state DROP COLUMN IF EXISTS source_type;
ALTER TABLE rooms DROP COLUMN IF EXISTS repeat_mode;
