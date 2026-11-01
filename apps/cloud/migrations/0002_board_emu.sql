-- Emulated boards (Docker) are flagged so the UI can label them.
ALTER TABLE devices ADD COLUMN board_emu INTEGER NOT NULL DEFAULT 0;
