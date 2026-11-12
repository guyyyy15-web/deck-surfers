-- Reminders at a time (החצר: a chore or task with an hour). The phone encrypts the text with the yard key; the
-- server only learns when to send and to whom (member_id NULL = everyone in the yard), and sends it once.
CREATE TABLE IF NOT EXISTS reminders (
  group_id TEXT NOT NULL,
  id TEXT NOT NULL,
  member_id TEXT,
  at INTEGER NOT NULL,
  key_version INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, id)
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (at);
