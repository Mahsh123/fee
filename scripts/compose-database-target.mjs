function parsePostgresUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid PostgreSQL URL`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${label} must use PostgreSQL`);
  }
  const queryKeys = [...url.searchParams.keys()];
  const duplicate = new Set(queryKeys).size !== queryKeys.length;
  if (queryKeys.some((key) => !['schema', 'sslmode', 'channel_binding'].includes(key)) || duplicate) {
    throw new Error(`${label} contains unsupported or duplicate query parameters`);
  }
  const sslModes = url.searchParams.getAll('sslmode');
  const channelBindings = url.searchParams.getAll('channel_binding');
  if ((sslModes.length && sslModes[0] !== 'verify-full') || (channelBindings.length && channelBindings[0] !== 'require')) {
    throw new Error(`${label} must use sslmode=verify-full and channel_binding=require when these options are present`);
  }
  if (url.hostname.toLowerCase().endsWith('.neon.tech') && sslModes[0] !== 'verify-full') {
    throw new Error(`${label} must require verified TLS for a Neon host`);
  }
  // Match pg-connection-string: reserved path characters such as `%3F` remain
  // escaped, so validation compares the same database name pg will use.
  const database = decodeURI(url.pathname.slice(1));
  if (!url.hostname || !database) throw new Error(`${label} must include a host and database name`);
  const schemas = url.searchParams.getAll('schema');
  const schema = schemas.length === 0 ? 'public' : schemas[0];
  if (!schema) throw new Error(`${label} must include a non-empty schema`);
  return {
    host: url.hostname.toLowerCase().replace(/\.$/, ''),
    port: url.port || '5432',
    database,
    schema,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslmode: sslModes[0] ?? null,
    channelBinding: channelBindings[0] ?? null,
  };
}

export function verifyPostgresUrlTarget(value, label, expectedTarget) {
  const url = parsePostgresUrl(value, label);
  const target = {
    host: expectedTarget.host.toLowerCase().replace(/\.$/, ''),
    port: expectedTarget.port,
    database: expectedTarget.database,
    schema: expectedTarget.schema,
  };
  if (target.schema !== 'public') {
    throw new Error('Staged database migrations currently require the public schema');
  }
  if (url.host !== target.host || url.port !== target.port || url.database !== target.database || url.schema !== target.schema) {
    throw new Error(`${label} does not match the shared database target`);
  }
  return url;
}
