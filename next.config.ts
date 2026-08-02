import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },

  // Never let a browser reuse a cached HTML document for dashboard pages.
  //
  // Next.js fingerprints its JS chunks, so every build produces new chunk URLs —
  // but the HTML that POINTS at those chunks was itself being cached. The browser
  // would then load yesterday's page and yesterday's JavaScript after a deploy,
  // which repeatedly looked like "the fix didn't work" when it was live all along.
  // The fingerprinted chunks stay immutably cached, so this costs one small
  // revalidation per navigation rather than re-downloading the app.
  async headers() {
    return [
      {
        source: '/dashboard/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },
}

export default nextConfig