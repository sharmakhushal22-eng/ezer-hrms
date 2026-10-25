// /api/version — the build this deployment is running (next.config.ts NEXT_PUBLIC_BUILD_ID,
// fixed at build time). components/SessionGuard.tsx compares it with the build an open tab
// was loaded from, and reloads the tab when a newer one is live.
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ build: process.env.NEXT_PUBLIC_BUILD_ID || '' }, { headers: { 'Cache-Control': 'no-store' } })
}
