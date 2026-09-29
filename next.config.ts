import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Where the build output goes. Defaults to .next, which is also what the dev
  // server serves from — and that overlap has bitten us: running `next build`
  // while `next dev` was live overwrote the running server's own directory, and
  // the Profile screen came back with no stylesheet at all. It looked exactly
  // like a CSS bug and was not one.
  //
  // So a verification build can be sent somewhere else:
  //
  //     NEXT_DIST_DIR=.next-verify npx next build
  //
  // OPT-IN ON PURPOSE, not keyed on the build phase. Vercel runs `next build`
  // and expects to find .next; switching the directory out from under it for
  // every production build would trade a local annoyance for a broken deploy.
  // Unset — which is the case everywhere except a local verification run — this
  // is exactly the old behaviour.
  //
  // ONE CAVEAT. Next rewrites tsconfig.json on every build, and with this set it
  // adds the verify directory to "include" and reformats the file besides. That
  // is noise, not a change worth keeping:
  //
  //     git checkout -- tsconfig.json
  //
  // after a verification build.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  typescript: {
    ignoreBuildErrors: true,
  },

  // pdfkit (the offer-approval PDF pack) must stay a plain Node dependency: bundling it
  // drags fontkit through Turbopack, whose @swc/helpers shim lacks an export fontkit
  // imports, and the route fails to compile. Its AFM font tables are read from disk at
  // runtime, so they are traced into the serverless function explicitly.
  serverExternalPackages: ['pdfkit', 'fontkit'],
  outputFileTracingIncludes: {
    '/api/recruitment/offer-approval': ['./node_modules/pdfkit/js/data/**'],
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