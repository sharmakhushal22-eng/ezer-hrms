// app/api/lms/me/saved/route.ts — My list: put a course aside for later, or take it off.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner, refuseReadOnly } from '@/lib/lms/learner'
import { setSaved } from '@/lib/lms/me'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    const refused = refuseReadOnly(learner)
    if (refused) return refused
    const b = await req.json()
    return NextResponse.json(await setSaved(learner, String(b.course_id || ''), b.on !== false))
  } catch (e) { return errorResponse(e) }
}
