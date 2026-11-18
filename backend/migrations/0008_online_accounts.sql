-- Account identity is bound to the existing profile UID; no chats are moved.
CREATE TABLE IF NOT EXISTS ledger_accounts (username TEXT PRIMARY KEY COLLATE NOCASE, uid TEXT NOT NULL UNIQUE REFERENCES profiles(id), salt TEXT NOT NULL, password_hash TEXT NOT NULL, iterations INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ledger_sessions (token_hash TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES profiles(id), created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_sessions_uid ON ledger_sessions(uid);
CREATE TABLE IF NOT EXISTS ledger_online_profiles (uid TEXT PRIMARY KEY REFERENCES profiles(id), snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger_auth_limits (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, until_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ledger_user_codes (uid TEXT PRIMARY KEY REFERENCES profiles(id), code TEXT NOT NULL UNIQUE);
