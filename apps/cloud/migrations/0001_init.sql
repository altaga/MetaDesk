-- Core cloud schema: identity, devices, pairing, metering, rate limits.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

CREATE TABLE subscriptions (
  user_id INTEGER PRIMARY KEY,
  plan_id TEXT NOT NULL DEFAULT 'desk',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  hostname TEXT,
  token_hash TEXT UNIQUE,
  remote_enabled INTEGER NOT NULL DEFAULT 1,
  connected_at INTEGER,
  disconnected_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX devices_user ON devices (user_id);

CREATE TABLE pair_codes (
  code TEXT PRIMARY KEY,
  poll_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hostname TEXT,
  expires_at INTEGER NOT NULL,
  device_id TEXT
);

CREATE TABLE terminal_tickets (
  ticket_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  device_id TEXT,
  kind TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX usage_ledger_user_kind ON usage_ledger (user_id, kind);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
