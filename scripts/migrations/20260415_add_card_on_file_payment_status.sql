-- Add 'card_on_file' to payment_status check constraint
-- Card-on-file = customer saved their card via SetupIntent, charge happens after job completion
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_payment_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_payment_status_check
  CHECK (payment_status IN ('pending', 'deposit_paid', 'fully_paid', 'payment_failed', 'card_on_file'));
