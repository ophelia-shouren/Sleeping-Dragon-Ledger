CREATE TABLE IF NOT EXISTS ledger_char_api_presets (char_id TEXT PRIMARY KEY REFERENCES chars(id), profile_id TEXT NOT NULL, profile_name TEXT NOT NULL);
