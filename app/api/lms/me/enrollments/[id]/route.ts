// app/api/lms/me/enrollments/[id]/route.ts — the course player. GET draws it; POST carries one
// event at a time. Everything sent here is a claim that lib/lms/engine.ts judges.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner, refuseReadOnly } from '@/lib/lms/learner'
import { heartbeat, markLesson, openLesson, playerView, saveFeedback, startQuiz, submitQuiz } from '@/lib/lms/engine'
import { errorResponse, LmsError } from '@/lib/lms/server'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    return NextResponse.json(await playerView(learner, (await params).id))
  } catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    const id = (await params).id
    const b = await req.json()
    // Looking at a file is harmless for someone viewing a portal. Everything else writes.
    if (b.event === 'open') return NextResponse.json(await openLesson(learner, id, String(b.lesson_id || '')))
    const refused = refuseReadOnly(learner)
    if (refused) return refused
    switch (b.event) {
      case 'beat': return NextResponse.json(await heartbeat(learner, id, String(b.lesson_id || ''), b))
      case 'mark': return NextResponse.json(await markLesson(learner, id, String(b.lesson_id || ''), b))
      case 'quiz_start': return NextResponse.json(await startQuiz(learner, id, String(b.lesson_id || '')))
      case 'quiz_submit': return NextResponse.json(await submitQuiz(learner, id, String(b.attempt_id || ''), b.answers || {}))
      case 'feedback': await saveFeedback(learner, id, Number(b.rating), b.comment ?? null); return NextResponse.json({ ok: true })
      default: throw new LmsError('Unknown event.')
    }
  } catch (e) { return errorResponse(e) }
}
