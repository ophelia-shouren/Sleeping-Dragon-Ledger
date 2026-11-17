CREATE TABLE ledger_person_look (
  uid TEXT PRIMARY KEY REFERENCES ledger_people(uid),
  frame TEXT NOT NULL
);
CREATE TABLE ledger_char_look (
  char_id TEXT PRIMARY KEY REFERENCES ledger_cast(char_id),
  avatar_image TEXT NOT NULL,
  frame TEXT NOT NULL
);
CREATE TABLE ledger_reply_jobs (
  message INTEGER PRIMARY KEY REFERENCES messages(id),
  char_id TEXT NOT NULL REFERENCES chars(id),
  started INTEGER NOT NULL DEFAULT 0
);
