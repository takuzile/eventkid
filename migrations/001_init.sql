-- EventKit initial schema

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT,
  segmented   BOOLEAN     NOT NULL DEFAULT false,
  status      TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'open', 'closed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS segments (
  id         SERIAL PRIMARY KEY,
  event_id   INTEGER     NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  starts_at  TIMESTAMPTZ,
  ends_at    TIMESTAMPTZ,
  sort_order INTEGER     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participants (
  id            SERIAL PRIMARY KEY,
  event_id      INTEGER     NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  display_name  TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'participant'
                  CHECK (role IN ('organizer', 'participant')),
  auth_provider TEXT        NOT NULL DEFAULT 'line',
  line_user_id  TEXT,
  responded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1イベント1人を担保しつつ将来の null 行に備えた部分 unique (§6 必須)
CREATE UNIQUE INDEX IF NOT EXISTS participants_event_line_uid
  ON participants(event_id, line_user_id)
  WHERE line_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS questions (
  id         SERIAL PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  field_type TEXT    NOT NULL
               CHECK (field_type IN ('text','select','multiselect','number','bool','date')),
  semantic   TEXT    CHECK (semantic IN ('location','capacity','money')),
  options    JSONB,
  required   BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS answers (
  id             SERIAL  PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  question_id    INTEGER NOT NULL REFERENCES questions(id)    ON DELETE CASCADE,
  value          TEXT,
  UNIQUE(participant_id, question_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id             SERIAL  PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  segment_id     INTEGER NOT NULL REFERENCES segments(id)     ON DELETE CASCADE,
  status         TEXT    NOT NULL CHECK (status IN ('出', '欠')),
  UNIQUE(participant_id, segment_id)
);
