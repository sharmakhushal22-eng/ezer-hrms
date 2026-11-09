// app/api/lms/admin/builder/route.ts — every small edit the course builder makes.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin } from '@/lib/lms/access'
import { builderOp } from '@/lib/lms/authoring'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'editContent')
  if (error) return error
  try {
    const { op, ...body } = await req.json()
    return NextResponse.json({ result: await builderOp(actor, String(op || ''), body) })
  } catch (e) { return errorResponse(e) }
}
