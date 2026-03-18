-- Manual takeover tracking: timestamp when staff takes over a customer conversation
ALTER TABLE customers ADD COLUMN IF NOT EXISTS manual_takeover_at TIMESTAMPTZ;
