CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, owner TEXT NOT NULL, invite TEXT UNIQUE NOT NULL);
CREATE TABLE members (room TEXT NOT NULL REFERENCES rooms(id), uid TEXT NOT NULL REFERENCES profiles(id), PRIMARY KEY(room, uid));
CREATE INDEX member_index ON members(uid,room);
CREATE TABLE chars (id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES rooms(id), owner TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL, persona TEXT NOT NULL, endpoint TEXT NOT NULL, model TEXT NOT NULL, secret TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, busy_until INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX char_name ON chars(room,name) WHERE active=1;
CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL REFERENCES rooms(id), sender TEXT NOT NULL, char_id TEXT REFERENCES chars(id), body TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX message_index ON messages(room,id);


CREATE TABLE ledger_cast (char_id TEXT PRIMARY KEY REFERENCES chars(id), world_front TEXT NOT NULL, world_end TEXT NOT NULL);
CREATE TABLE ledger_people (uid TEXT PRIMARY KEY REFERENCES profiles(id), persona TEXT NOT NULL, avatar TEXT NOT NULL);


CREATE TABLE ledger_daily_usage (
  day TEXT PRIMARY KEY,
  messages INTEGER NOT NULL
);
CREATE TRIGGER ledger_count_message AFTER INSERT ON messages
WHEN NEW.sender GLOB 'ledger:*'
BEGIN
  INSERT INTO ledger_daily_usage (day,messages) VALUES (date('now'),1)
    ON CONFLICT(day) DO UPDATE SET messages=messages+1;
END;


ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN attachment TEXT;
CREATE TABLE ledger_rps (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id),
  choice TEXT NOT NULL,
  resolution TEXT
);


CREATE TABLE ledger_room_memory (
  room TEXT PRIMARY KEY REFERENCES rooms(id),
  endpoint TEXT NOT NULL,
  model TEXT NOT NULL,
  secret TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  cursor INTEGER NOT NULL DEFAULT 0,
  busy_until INTEGER NOT NULL DEFAULT 0,
  updated TEXT,
  error TEXT NOT NULL DEFAULT ''
);
