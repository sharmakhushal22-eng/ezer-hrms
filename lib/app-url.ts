// lib/app-url.ts — the base URL for a link we are about to e-mail.
//
// A link that carries a token — an e-sign link, an onboarding magic link, a salary-view
// link — is a credential. Several routes built these from the request's `Origin` (or
// `x-forwarded-host`) header, so a signer calling the API from a script could set `Origin`
// to a host they control; the next signer then received a genuine company e-mail whose
// button pointed at that host, token and all.
//
// The base must therefore come from the server's own configuration, never from the request:
//   1. NEXT_PUBLIC_APP_URL        what the deployment is told it is
//   2. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL   set by the platform, not the caller
//   3. the production domain, as a last resort
//
// `appUrlFromRequest(req)` keeps the old signature so callers need not change shape, but it
// ignores the request entirely — the argument is there so the intent ("a link for a human,
// built safely") reads at the call site.

const PROD = 'https://app.ezerhrms.com'

const clean = (u: string | undefined | null): string | null => {
  if (!u) return null
  const s = u.trim().replace(/\/+$/, '')
  if (!s) return null
  return /^https?:\/\//.test(s) ? s : `https://${s}`
}

/** The configured public base URL, trusting only server-side config. */
export function appUrl(): string {
  return (
    clean(process.env.NEXT_PUBLIC_APP_URL) ||
    clean(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    clean(process.env.VERCEL_URL) ||
    PROD
  )
}

/** Same value; the request is accepted and ignored, so a link is never built from a header. */
export function appUrlFromRequest(_req?: unknown): string {
  return appUrl()
}
