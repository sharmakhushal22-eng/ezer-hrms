// app/api/lms/admin/assignments/[id]/route.ts — pause, resume, re-apply, cancel.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin } from '@/lib/lms/access'
import { assignmentAction } from '@/lib/lms/assign'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { actor, error } = await lmsAdmin(req, 'assign')
  if (error) return error
  try {
    const b = await req.json()
    return NextResponse.json(await assignmentAction(actor, (await params).id, String(b.action || ''), b))
  } catch (e) { return errorResponse(e) }
}
