import type { NextConfig } from 'next'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  experimental: {
    proxyClientMaxBodySize: '20mb',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'wfeqmdzmozthfwsqjhwo.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

export default nextConfig
