/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Force Next's file tracer to bundle the native ffmpeg + ffprobe binaries
    // for server-side video processing (compositor temporal render + blur
    // video path). Without this the linux-x64 binaries from
    // @ffmpeg-installer / @ffprobe-installer optional deps aren't traced and
    // Vercel functions fail at runtime with "Cannot find module ffmpeg".
    outputFileTracingIncludes: {
      '/api/**': [
        './node_modules/@ffmpeg-installer/**',
        './node_modules/@ffprobe-installer/**',
      ],
    },
  },
}

module.exports = nextConfig
