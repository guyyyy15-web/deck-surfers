-- Push notifications (docs/groups-spec.md §5.7, §7.6). Subscriptions belong to a phone's identity; the
-- notification text itself is encrypted with the group key and only readable on the phone.
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok INTEGER
);
CREATE INDEX IF NOT EXISTS push_subs_by_member ON push_subs (member_id);

-- Groups a member muted.
CREATE TABLE IF NOT EXISTS push_mutes (
  group_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  PRIMARY KEY (group_id, member_id)
);

-- When we last pushed to a member about a group (a short cooldown keeps it calm and cheap).
CREATE TABLE IF NOT EXISTS push_sent (
  group_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (group_id, member_id)
);
