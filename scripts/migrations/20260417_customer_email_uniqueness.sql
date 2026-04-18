-- Customer email uniqueness guardrail
-- Context: AJ incident 2026-04-17. A Meta lead auto-created a duplicate
-- customer for someone already in the DB. This is a defense-in-depth: even
-- if app code regresses, the DB rejects duplicates on (tenant_id, email).
--
-- NOTE: The customers table already has ~8+ existing duplicate-email groups
-- as of 2026-04-17, so we CANNOT use a unique index (it would fail on create).
-- Instead: a BEFORE INSERT/UPDATE trigger that blocks NEW duplicates but
-- leaves existing data alone. Existing dups should be merged manually over time.

-- Helpful lookup index for dedup during lead ingest
CREATE INDEX IF NOT EXISTS customers_tenant_email_lower_idx
  ON public.customers (tenant_id, lower(trim(email)))
  WHERE email IS NOT NULL AND length(trim(email)) > 0;

CREATE INDEX IF NOT EXISTS customers_tenant_first_name_idx
  ON public.customers (tenant_id, lower(trim(first_name)))
  WHERE first_name IS NOT NULL AND length(trim(first_name)) > 0;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_customer_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflict_id bigint;
  incoming_email text;
BEGIN
  IF NEW.email IS NULL OR length(trim(NEW.email)) = 0 THEN
    RETURN NEW;
  END IF;

  incoming_email := lower(trim(NEW.email));

  IF TG_OP = 'UPDATE' AND OLD.email IS NOT NULL
     AND lower(trim(OLD.email)) = incoming_email THEN
    RETURN NEW;
  END IF;

  SELECT id INTO conflict_id
  FROM public.customers
  WHERE tenant_id = NEW.tenant_id
    AND id <> COALESCE(NEW.id, -1)
    AND email IS NOT NULL
    AND lower(trim(email)) = incoming_email
  LIMIT 1;

  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'duplicate customer email for tenant: email % already on customer %',
      incoming_email, conflict_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_customer_email_trg ON public.customers;
CREATE TRIGGER prevent_duplicate_customer_email_trg
BEFORE INSERT OR UPDATE OF email ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.prevent_duplicate_customer_email();
