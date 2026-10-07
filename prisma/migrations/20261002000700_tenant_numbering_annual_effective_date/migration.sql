ALTER TABLE "tenant_numbering_settings"
ADD COLUMN "reset_annually_from" DATE;

-- Existing tenants that had enabled annual resets receive a safe effective
-- date at the next financial-year boundary. This avoids reusing numbers that
-- may already have been issued during the current year.
UPDATE "tenant_numbering_settings"
SET "reset_annually_from" = CASE
  WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
    THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::integer + 1, 4, 1)
  ELSE make_date(EXTRACT(YEAR FROM CURRENT_DATE)::integer, 4, 1)
END
WHERE "reset_annually" = TRUE;
