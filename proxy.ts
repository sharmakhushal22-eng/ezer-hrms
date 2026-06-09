import { NextResponse } from 'next/server'

// NOTE: This is currently a pass-through. There is no server-side auth yet,
// so every request is allowed. The matcher already EXCLUDES `salary-view`
// (the public candidate salary link) so that when real auth is added here,
// the public link keeps working without a login.
//
// Next.js 16 renamed "middleware" -> "proxy" (same functionality).
export function proxy() {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|salary-view|joining|onboarding|api/onboarding|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
