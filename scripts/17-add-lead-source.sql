-- Add lead_source column to customers table
-- Tracks how the customer found the business (e.g. Website, Google, Referral)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_source TEXT;
