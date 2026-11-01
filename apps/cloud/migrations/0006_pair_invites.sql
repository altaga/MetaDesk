-- Desk-initiated pairing: the signed-in operator mints a short code bound to their
-- account, and an unpaired board redeems it over its USB setup page. Single use.
CREATE TABLE pair_invites (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX pair_invites_user ON pair_invites (user_id);
