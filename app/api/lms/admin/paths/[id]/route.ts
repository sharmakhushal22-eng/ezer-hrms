// app/api/lms/admin/paths/[id]/route.ts — publish or archive a path.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin } from '@/lib/lms/access'
import { pathAction } from '@/lib/lms/authoring'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { actor, error } = await lmsAdmin(req, 'publish')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json(await pathAction(actor, (await params).id, String(b.action || '')))
  } catch (e) { return errorResponse(e) }
}
