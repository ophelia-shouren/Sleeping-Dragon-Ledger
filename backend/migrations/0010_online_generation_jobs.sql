CREATE TABLE IF NOT EXISTS ledger_generation_jobs (id TEXT PRIMARY KEY,room TEXT NOT NULL,char_id TEXT NOT NULL,message_id INTEGER,requester TEXT,status TEXT NOT NULL,started INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_generation_one_active ON ledger_generation_jobs(char_id) WHERE status='running';
