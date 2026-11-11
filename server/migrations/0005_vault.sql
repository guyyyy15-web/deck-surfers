-- Saved ducklings (החצר "quick sign-in"): a member's identity, encrypted on the phone with a key derived from a
-- passkey's PRF output or a save code. The id is SHA-256 of a second derived value, so only someone holding the
-- passkey or the code can find or read a vault. The server never sees the key or the plaintext.
CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS vaults_by_member ON vaults (member_id, updated_at);
