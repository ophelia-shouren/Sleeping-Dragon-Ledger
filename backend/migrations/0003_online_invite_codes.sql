CREATE TABLE ledger_invite_codes (
  room TEXT PRIMARY KEY REFERENCES rooms(id),
  code TEXT UNIQUE NOT NULL CHECK (
    length(code)=6 AND code NOT GLOB '*[^a-z0-9]*'
    AND code GLOB '*[a-z]*' AND code GLOB '*[0-9]*'
  )
);
