-- נקמות שלי sync. The server only ever sees encrypted data: names, reasons and photos are
-- encrypted on the phone before they are sent.

-- A "space" is one person's backup, shared by the phones that know its sync code.
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,            -- derived from the sync code (not the code itself)
  auth TEXT NOT NULL,             -- SHA-256 of the access token (also derived from the code)
  seq INTEGER NOT NULL DEFAULT 0, -- bumps on every change; phones pull "everything after seq N"
  bytes INTEGER NOT NULL DEFAULT 0, -- photo bytes stored in R2
  created_at INTEGER NOT NULL
);

-- Revenges and photo records, encrypted. Last write wins (by the phone's updatedAt).
CREATE TABLE IF NOT EXISTS items (
  space TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- 'revenge' | 'photo'
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT,                      -- base64(iv + AES-GCM ciphertext), null for deletions
  seq INTEGER NOT NULL,
  PRIMARY KEY (space, id)
);
CREATE INDEX IF NOT EXISTS items_by_seq ON items (space, seq);
