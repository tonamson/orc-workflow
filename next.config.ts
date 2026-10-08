import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['typeorm', 'pg', 'reflect-metadata'],
};

export default nextConfig;
