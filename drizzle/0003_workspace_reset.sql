CREATE TABLE workspace_resets (
  owner TEXT PRIMARY KEY NOT NULL,
  generation TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'd1',
  lease TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT NOT NULL DEFAULT ''
);
