// app/api/lms/me/sessions/[id]/route.ts — one live session for the learner: GET shows it (or,
// with ?ics=1, downloads the calendar file); POST registers, joins, checks in, and carries the
// recording's progress.
import { NextRequest, NextResponse } from 'next/server'
import { lmsLearner, refuseReadOnly } from '@/lib/lms/learner'
import { checkIn, icsFor, join, openRecording, recordingBeat, register, sessionForLearner } from '@/lib/lms/live'
import { errorResponse, LmsError } from '@/lib/lms/server'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    const id = (await params).id
    if (req.nextUrl.searchParams.get('ics')) {
      return new NextResponse(await icsFor(learner, id), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="session.ics"', 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json(await sessionForLearner(learner, id))
  } catch (e) { return errorResponse(e) }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { learner, error } = await lmsLearner(req)
    if (error) return error
    const id = (await params).id
    const b = await req.json()
    // Watching and looking leave no mark for someone viewing another person's portal.
    if (b.event === 'recording') return NextResponse.json(await openRecording(learner, id))
    if (b.event === 'join') return NextResponse.json(await join(learner, id))
    const refused = refuseReadOnly(learner)
    if (refused) return refused
    switch (b.event) {
      case 'register': return NextResponse.json(await register(learner, id, true))
      case 'unregister': return NextResponse.json(await register(learner, id, false))
      case 'checkin': return NextResponse.json(await checkIn(learner, id, String(b.code || '')))
      case 'beat': return NextResponse.json(await recordingBeat(learner, id, b))
      default: throw new LmsError('Unknown event.')
    }
  } catch (e) { return errorResponse(e) }
}
