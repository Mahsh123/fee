import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(fileURLToPath(new URL('../..', import.meta.url))),
  reactStrictMode: true,
  poweredByHeader: false,
  // Browser requests to `*.localhost` retain the tenant host while the local
  // API and Next development servers run on separate ports.
  allowedDevOrigins: ['*.localhost'],
  // Workspace packages are authored in TypeScript and transpiled by Next so the
  // web app always typechecks and builds against package sources, not stale dist.
  transpilePackages: ['@fee/money', '@fee/types', '@fee/validation', '@fee/dates', '@fee/ui'],
  experimental: {
    // Server Actions receive a 1MB default limit; receipt/logo uploads exceed it.
    serverActions: { bodySizeLimit: '4mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
