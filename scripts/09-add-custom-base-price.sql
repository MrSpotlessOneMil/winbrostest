-- Add custom_base_price to quotes for salesman-quoted jobs (WinBros estimate flow)
-- When set, the quote page shows this price instead of computed tier pricing.
-- Customer can still add/remove add-ons on top of the custom base price.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS custom_base_price NUMERIC;
