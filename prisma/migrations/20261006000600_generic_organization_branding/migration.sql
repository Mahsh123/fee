-- Use organization-neutral naming in tenant branding.
ALTER TABLE "tenant_branding" ADD COLUMN "organizationName" TEXT;
UPDATE "tenant_branding"
SET "organizationName" = "institutionName"
WHERE "organizationName" IS NULL;
ALTER TABLE "tenant_branding" ALTER COLUMN "organizationName" SET NOT NULL;

-- Keep the legacy column synchronized until every deployed client has moved to
-- organizationName. The trigger also permits inserts from either app version.
CREATE FUNCTION public."sync_tenant_branding_organization_name"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."organizationName" IS NULL THEN
      NEW."organizationName" := NEW."institutionName";
    ELSIF NEW."institutionName" IS NULL THEN
      NEW."institutionName" := NEW."organizationName";
    END IF;
  ELSIF NEW."organizationName" IS DISTINCT FROM OLD."organizationName" THEN
    NEW."institutionName" := NEW."organizationName";
  ELSIF NEW."institutionName" IS DISTINCT FROM OLD."institutionName" THEN
    NEW."organizationName" := NEW."institutionName";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_branding_organization_name_compat"
BEFORE INSERT OR UPDATE OF "institutionName", "organizationName"
ON "tenant_branding"
FOR EACH ROW
EXECUTE FUNCTION public."sync_tenant_branding_organization_name"();
