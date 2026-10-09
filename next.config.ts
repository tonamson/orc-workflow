import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['typeorm', 'pg', 'reflect-metadata', 'node-pty'],
};

export default nextConfig;
