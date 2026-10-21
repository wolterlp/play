-- room_events solo se escribía (nunca se leía); la línea de tiempo de eventos
-- es opcional en el diseño. Se elimina para no mantener código/tablas muertas.
DROP TABLE IF EXISTS room_events;

-- DOWN

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
