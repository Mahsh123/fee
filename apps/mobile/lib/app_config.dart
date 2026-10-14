/// The workspace used by this tenant-branded app build.
///
/// Development defaults to the seeded demo tenant. A customer-specific build
/// can set WASL_WORKSPACE_URL without exposing workspace selection at login.
const waslWorkspaceUrl = String.fromEnvironment(
  'WASL_WORKSPACE_URL',
  defaultValue: 'http://demo.localhost:8080',
);
