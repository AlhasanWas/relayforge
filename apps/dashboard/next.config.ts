import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A self-contained server bundle for the Docker image.
  output: 'standalone',
  // The workspace root, so standalone tracing includes hoisted dependencies.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
