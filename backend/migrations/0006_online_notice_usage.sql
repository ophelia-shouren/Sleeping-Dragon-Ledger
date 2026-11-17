DROP TRIGGER ledger_count_message;
CREATE TRIGGER ledger_count_message AFTER INSERT ON messages
WHEN NEW.sender GLOB 'ledger:*' AND NEW.kind!='member-joined'
BEGIN
  INSERT INTO ledger_daily_usage (day,messages) VALUES (date('now'),1)
    ON CONFLICT(day) DO UPDATE SET messages=messages+1;
END;
