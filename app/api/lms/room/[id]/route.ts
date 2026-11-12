// app/api/lms/room/[id]/route.ts — the webinar room of one live session. GET is the whole room
// (stage, chat, questions, polls, the caller's attendance); POST takes part in it (chat, ask,
// vote, answer a poll, heartbeat) or, for the host, runs it. Learners and Studio users both
// come through here; lib/lms/room.ts decides who may do what.
import { NextRequest, NextResponse } from 'next/server'
import { hostAction, postMessage, roomBeat, roomCaller, roomState, voteQuestion, votePoll } from '@/lib/lms/room'
import { errorResponse } from '@/lib/lms/server'

export const runtime = 'nodejs'
type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const r = await roomCaller(req, (await params).id, true)
    if (r.error) return r.error
    return NextResponse.json(await roomState(r.s, r.who), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return errorResponse(e) }
}

// The busy calls (chat, votes, heartbeats) skip the Studio-rights lookup, which costs several
// reads, unless the browser says its person is hosting (the room's GET told it so). That claim
// only buys the full check; it grants nothing by itself.
const BUSY = new Set(['chat', 'ask', 'vote', 'poll_vote', 'beat'])

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const b = await req.json().catch(() => ({}))
    const r = await roomCaller(req, (await params).id, !BUSY.has(b.action) || b.as_host === true)
    if (r.error) return r.error
    const { s, who } = r
    switch (b.action) {
      case 'chat': return NextResponse.json(await postMessage(s, who, 'CHAT', b))
      case 'ask': return NextResponse.json(await postMessage(s, who, 'QUESTION', b))
      case 'vote': return NextResponse.json(await voteQuestion(s, who, String(b.message_id || ''), b.on !== false))
      case 'poll_vote': return NextResponse.json(await votePoll(s, who, String(b.poll_id || ''), Number(b.option)))
      case 'beat': return NextResponse.json(await roomBeat(s, who))
      default: return NextResponse.json(await hostAction(s, who, b))
    }
  } catch (e) { return errorResponse(e) }
}
