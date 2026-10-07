-- Versioned, safe base amount configuration for USAGE, FORMULA, and CUSTOM fees.
-- Existing fee type versions are not rewritten; NULL preserves their original
-- configuration snapshot and all issued demand calculations.
BEGIN;

ALTER TABLE public.fee_type_versions
  ADD COLUMN "calculationConfig" jsonb;

COMMIT;
