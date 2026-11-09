// app/api/lms/verify/[code]/route.ts — public certificate check.
import { NextRequest, NextResponse } from 'next/server'
import { verifyCertificate } from '@/lib/lms/certificate'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const r = await verifyCertificate((await params).code)
    return r ? NextResponse.json(r) : NextResponse.json({ error: 'No certificate matches this link.' }, { status: 404 })
  } catch (e) { return errorResponse(e) }
}
