-- Dual-track ops log: admin turns keep I/O; user turns keep features + errors only.
CREATE TABLE ops_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  privacy TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  device_id TEXT,
  session_id TEXT,
  route TEXT,
  model TEXT,
  intent TEXT,
  latency_ms INTEGER,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  path TEXT,
  features_json TEXT,
  input_text TEXT,
  output_text TEXT,
  note TEXT
);
CREATE INDEX ops_events_created ON ops_events (created_at DESC);
CREATE INDEX ops_events_kind_status ON ops_events (kind, status, created_at DESC);
CREATE INDEX ops_events_user ON ops_events (user_id, created_at DESC);
