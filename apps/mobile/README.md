# Wasl Madrasa mobile app

This Flutter client uses the Wasl API already in this repository. It does not
connect to PostgreSQL or contain tenant data. Each branded app build is pinned
to one tenant workspace; users sign in with the email and password registered
for that Madrasa. The API verifies tenant membership and role permissions.

## Run

Install Flutter and run from this directory:

```powershell
flutter pub get
flutter run
```

Development defaults to the seeded tenant at `http://demo.localhost:8080`.
When running on a USB-connected Android phone against the local Compose stack,
forward the development server port once before launching:

```powershell
adb reverse tcp:8080 tcp:8080
flutter run
```

For a deployment where mobile workspace URLs use a separate API host, provide
the API origin with `--dart-define=WASL_API_BASE_URL=https://api.example.org`.
To build a customer-specific app, set its workspace at build time, for example
`--dart-define=WASL_WORKSPACE_URL=https://north.example.org`. This changes the
tenant resolved by the app without adding a workspace URL field to login.

## Checks and Android build

```powershell
flutter analyze
flutter test
flutter build apk --debug
```

Android release builds need an organisation-managed signing key. Keep signing
credentials out of source control and configure them in the Android build
environment before distributing a release.

## API capability notes

See [the API capability matrix](../../docs/wasl-madrasa-api-capability.md) for
implemented routes and backend gaps. Attendance is intentionally shown as
unavailable until Wasl has tenant-scoped attendance storage and authorised
read/write endpoints. The app does not display invented attendance data.

Payment state is always refreshed from the Wasl API. The checkout screen only
reports success after the order endpoint reports a server-confirmed successful
state; a gateway page or local callback alone is never treated as proof of
payment. A staff collection request is saved in platform secure storage before
submission, so reconnects and app restarts retry the same payload with the same
Wasl idempotency key.
