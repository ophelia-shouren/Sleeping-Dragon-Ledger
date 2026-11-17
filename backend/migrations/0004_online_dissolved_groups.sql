CREATE TABLE ledger_dissolved_groups (
  room TEXT PRIMARY KEY REFERENCES rooms(id),
  dissolved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
