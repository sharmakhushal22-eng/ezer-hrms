// lib/lms/site.ts — EZER Learn on its own domain (ezerlms.com).
//
// One codebase, one database, two Vercel projects. The HRMS project serves everything as before;
// the LMS project is the same build with NEXT_PUBLIC_EZER_SURFACE=lms, and proxy.ts narrows it to
// Learning alone. So a company that buys only the LMS is given ezerlms.com and never sees a
// payroll screen, and an HRMS customer clicks Learning and lands there already signed in
// (lib/lms/sso.ts).
//
//   NEXT_PUBLIC_EZER_SURFACE=lms   set on the LMS project only
//   NEXT_PUBLIC_LMS_URL            set on the HRMS project: Learning links leave for this address.
//                                  Unset, Learning stays inside HRMS at /learning, exactly as before,
//                                  which is also how local dev and previews behave.
//   NEXT_PUBLIC_HRMS_URL           set on the LMS project: where "Back to EZER HRMS" goes
//
// All three are inlined at build time, so a change needs a redeploy.

const trim = (s: string | undefined) => (s || '').trim().replace(/\/+$/, '')

/** This deployment is ezerlms.com. */
export const LMS_SITE = process.env.NEXT_PUBLIC_EZER_SURFACE === 'lms'
export const LMS_URL = trim(process.env.NEXT_PUBLIC_LMS_URL)
export const HRMS_URL = trim(process.env.NEXT_PUBLIC_HRMS_URL)
/** This deployment is HRMS, and Learning has moved out to LMS_URL. */
export const LMS_ELSEWHERE = !LMS_SITE && !!LMS_URL

/** APIs the LMS site answers. Everything else under /api is HRMS and is refused there, crons
 *  included: the LMS project builds from the same vercel.json, and a second run of every cron
 *  would send every reminder twice. */
const LMS_APIS = ['/api/lms/', '/api/ess-auth/', '/api/version']

export type SiteRoute =
  | { do: 'pass' }
  | { do: 'rewrite'; to: string }
  | { do: 'redirect'; to: string }
  | { do: 'refuse' }

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

/** What the LMS site does with a request for `path`. Learning screens are served from the root
 *  (ezerlms.com/catalog), so the HRMS-style /learning prefix is redirected away and every other
 *  page address is handed to the Learning app, which shows its home for anything it does not know.
 *  No HRMS page is reachable from here. */
export function lmsSiteRoute(path: string): SiteRoute {
  if (path.startsWith('/api/')) return LMS_APIS.some(p => p.endsWith('/') ? path.startsWith(p) : path === p) ? { do: 'pass' } : { do: 'refuse' }
  if (path.startsWith('/_next/')) return { do: 'pass' }
  if (under(path, '/learning')) return { do: 'redirect', to: path.slice('/learning'.length) || '/' }
  // Public pages Learning already owns: a candidate's pre-joining course, certificate checks, and
  // SCORM packages served from inside their zip.
  if (under(path, '/learn') || under(path, '/learn-scorm')) return { do: 'pass' }
  // Files from /public (icons, fonts, workers) have an extension; page addresses never do.
  if (/\/[^/]+\.[a-z0-9]+$/i.test(path)) return { do: 'pass' }
  return { do: 'rewrite', to: path === '/' ? '/learning' : `/learning${path}` }
}
