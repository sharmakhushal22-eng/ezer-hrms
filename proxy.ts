import { NextResponse, type NextRequest } from 'next/server'
import { LMS_SITE, lmsSiteRoute } from '@/lib/lms/site'

// NOTE: For HRMS this is still a pass-through. There is no server-side auth yet,
// so every request is allowed.
//
// The one deployment it does something for is EZER Learn on its own domain
// (NEXT_PUBLIC_EZER_SURFACE=lms, see lib/lms/site.ts): there it serves Learning
// at the root and refuses every HRMS page and API. That is why the matcher now
// takes every address except build output and image files — it used to skip
// /learn*, /joining, /onboarding and the other public links, which on the LMS
// site would have left HRMS pages reachable. The pass-through costs nothing.
//
// Next.js 16 renamed "middleware" -> "proxy" (same functionality).
export function proxy(req: NextRequest) {
  if (!LMS_SITE) return NextResponse.next()
  const { pathname, search } = req.nextUrl
  const r = lmsSiteRoute(pathname)
  if (r.do === 'pass') return NextResponse.next()
  if (r.do === 'refuse') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const url = req.nextUrl.clone()
  url.pathname = r.to
  url.search = search
  return r.do === 'redirect' ? NextResponse.redirect(url, 308) : NextResponse.rewrite(url)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
