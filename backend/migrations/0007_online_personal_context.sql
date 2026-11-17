CREATE TABLE ledger_char_personal_context (
  char_id TEXT PRIMARY KEY REFERENCES chars(id),
  memories TEXT NOT NULL,
  dialogue TEXT NOT NULL
);
CREATE TRIGGER ledger_clear_inactive_char_context AFTER UPDATE OF active ON chars
WHEN NEW.active=0
BEGIN
  DELETE FROM ledger_char_personal_context WHERE char_id=NEW.id;
END;
