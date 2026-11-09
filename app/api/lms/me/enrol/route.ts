// app/api/lms/me/enrol/route.ts — enrol yourself, or ask to.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner, refuseReadOnly } from '@/lib/lms/learner'
import { enrol, enrolPath } from '@/lib/lms/me'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    const refused = refuseReadOnly(learner)
    if (refused) return refused
    const b = await req.json()
    return NextResponse.json(b.path_id ? await enrolPath(learner, String(b.path_id)) : await enrol(learner, String(b.course_id || '')))
  } catch (e) { return errorResponse(e) }
}
