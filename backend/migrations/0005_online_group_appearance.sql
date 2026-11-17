CREATE TABLE ledger_group_look (
  room TEXT PRIMARY KEY REFERENCES rooms(id),
  avatar TEXT NOT NULL
);
