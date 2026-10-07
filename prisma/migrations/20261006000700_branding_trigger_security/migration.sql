-- Pin the compatibility function environment and revoke direct execution.
ALTER FUNCTION public."sync_tenant_branding_organization_name"() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION public."sync_tenant_branding_organization_name"() FROM PUBLIC;
