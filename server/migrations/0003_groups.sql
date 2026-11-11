-- Groups (docs/groups-spec.md §7). Everything user-written is encrypted on the phones with the group key;
-- the server stores envelopes: who wrote (verified by signature), when, under which key version.

-- Phones' public keys. id = first 24 hex of SHA-256(raw signing key), checked on registration.
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  sign_pub TEXT NOT NULL,         -- JWK
  dh_pub TEXT NOT NULL,           -- JWK
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  key_version INTEGER NOT NULL DEFAULT 1,
  needs_rotation INTEGER NOT NULL DEFAULT 0, -- set when someone leaves or is removed
  seq INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  group_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  joined_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (group_id, member_id)
);
CREATE INDEX IF NOT EXISTS members_by_member ON members (member_id);

-- The group key, per version, wrapped (ECDH + AES-GCM) for each member.
CREATE TABLE IF NOT EXISTS group_keys (
  group_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  member_id TEXT NOT NULL,
  wrapped TEXT NOT NULL,
  PRIMARY KEY (group_id, version, member_id)
);

-- Invite links. The link's secret never reaches the server: it gets SHA-256 of a value derived from it,
-- and the group keys wrapped with another value derived from it.
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  auth_hash TEXT NOT NULL,
  wrapped_keys TEXT NOT NULL,     -- JSON [{version, wrapped}]
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0
);

-- The group's append-only event log (encrypted).
CREATE TABLE IF NOT EXISTS events (
  group_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  author_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, seq)
);
