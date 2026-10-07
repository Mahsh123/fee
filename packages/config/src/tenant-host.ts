export type HostTenantResolution =
  | { kind: 'platform'; hostname: string }
  | { kind: 'tenant'; hostname: string; slug: string }
  | { kind: 'unknown'; hostname: string; slug?: string };

const TENANT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Resolve only the dedicated platform subdomain or one tenant label below the
 * configured base domain. The apex is deliberately not an admin host.
 * Ports are accepted for local development; paths, credentials, nested tenant
 * labels, and lookalike suffixes are rejected.
 */
export function resolveTenantHost(hostHeader: string | undefined, baseDomain: string, platformSubdomain = 'platform'): HostTenantResolution {
  const hostname = parseHostname(hostHeader);
  const base = parseHostname(baseDomain);
  const platformLabel = platformSubdomain.trim().toLowerCase();
  if (!hostname || !base || !TENANT_SLUG.test(platformLabel)) return { kind: 'unknown', hostname: hostname ?? '' };
  const platformHostname = `${platformLabel}.${base}`;
  if (hostname === platformHostname) return { kind: 'platform', hostname };

  const suffix = `.${base}`;
  if (!hostname.endsWith(suffix)) return { kind: 'unknown', hostname };
  const label = hostname.slice(0, -suffix.length);
  if (!TENANT_SLUG.test(label) || label.includes('.')) return { kind: 'unknown', hostname };
  return { kind: 'tenant', hostname, slug: label };
}

/**
 * CORS policy for the dedicated platform host and tenant subdomains. A tenant
 * page may only call the API through its own host; sibling origins are rejected.
 */
export function isAllowedTenantOrigin(
  origin: string | undefined,
  requestHost: string | undefined,
  baseDomain: string,
  configuredOrigins: readonly string[],
  webAppUrl: string,
  platformSubdomain = 'platform',
): boolean {
  if (!origin) return true;
  const parsedOrigin = parseOrigin(origin);
  if (!parsedOrigin) return false;

  const originResolution = resolveTenantHost(parsedOrigin.hostname, baseDomain, platformSubdomain);
  if (originResolution.kind === 'unknown') {
    const normalizedBaseDomain = parseHostname(baseDomain);
    if (!normalizedBaseDomain || parsedOrigin.hostname === normalizedBaseDomain ||
        parsedOrigin.hostname.endsWith(`.${normalizedBaseDomain}`) ||
        parsedOrigin.hostname.includes(`.${normalizedBaseDomain}.`)) return false;
    // Custom tenant domains are accepted only for a same-host request. The
    // API host middleware still requires a verified TenantDomain mapping, so
    // this does not make an arbitrary Host header a tenant identity.
    return Boolean(requestHost && parseHostname(requestHost) === parsedOrigin.hostname.toLowerCase());
  }

  const explicitlyConfigured = configuredOrigins.some((configured) => configured === parsedOrigin.origin);
  const rootOrigins = configuredOrigins
    .map(parseOrigin)
    .filter((value): value is URL => value !== null && resolveTenantHost(value.hostname, baseDomain, platformSubdomain).kind === 'platform');
  const webOrigin = parseOrigin(webAppUrl);
  if (webOrigin && resolveTenantHost(webOrigin.hostname, baseDomain, platformSubdomain).kind === 'platform') rootOrigins.push(webOrigin);
  const matchesRootOrigin = rootOrigins.some((root) => root.protocol === parsedOrigin.protocol && root.port === parsedOrigin.port);
  if (!explicitlyConfigured && !matchesRootOrigin) return false;

  if (requestHost) {
    const requestResolution = resolveTenantHost(requestHost, baseDomain, platformSubdomain);
    if (requestResolution.kind !== originResolution.kind) return false;
    if (requestResolution.kind === 'tenant' && originResolution.kind === 'tenant' && requestResolution.slug !== originResolution.slug) return false;
  }
  return true;
}

function parseHostname(input: string | undefined): string | null {
  if (!input || input.length > 255 || /[\s/@?#\\]/.test(input)) return null;
  try {
    const url = new URL(`http://${input}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

function parseOrigin(input: string): URL | null {
  try {
    const value = new URL(input);
    if (!['http:', 'https:'].includes(value.protocol) || value.origin !== input || value.username || value.password) return null;
    return value;
  } catch {
    return null;
  }
}
