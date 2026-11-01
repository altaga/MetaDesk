-- Millie guide sessions live in the cloud (not on the board).
CREATE TABLE guide_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX guide_sessions_user ON guide_sessions (user_id, updated_at);

CREATE TABLE guide_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX guide_messages_session ON guide_messages (session_id, id);
