-- Monthly R2 operation counters (cost guard): kind 'a' = class A (put, list), 'b' = class B (get, head).
-- Photo uploads pause at 80% of the free tier, photo downloads too (src/index.js r2Guard). Counts only, no ids.
CREATE TABLE IF NOT EXISTS usage (
  month TEXT NOT NULL,   -- 'YYYY-MM' (UTC)
  kind TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, kind)
);
