-- Per-client rate limits (the client is a SHA-256 of its IP address and the day, never the IP itself).
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,       -- e.g. 'spaces:<hash>'
  window INTEGER NOT NULL, -- hour number since the epoch
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window)
);
