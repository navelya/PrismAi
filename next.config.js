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
    // Keep these as runtime requires instead of webpack-bundling them.
    // @ffprobe-installer/ffprobe/index.js does a dynamic require that
    // webpack expands into a context module covering every file in the
    // package — including its tsconfig.json (trailing commas, valid JSONC
    // but rejected by webpack's strict JsonParser). Marking the packages
    // external sidesteps that; the binaries are still present at runtime
    // via outputFileTracingIncludes above.
    serverComponentsExternalPackages: [
      '@ffmpeg-installer/ffmpeg',
      '@ffprobe-installer/ffprobe',
      'fluent-ffmpeg',
    ],
  },
}

module.exports = nextConfig
