// POST /api/te/legs/[id]/action — everything the employee does on one leg.
//
//   action     body                              what happens
//   start      { fix }                           start the leg (or check in at the start)
//   pings      { pings: [...] }                  a batch of GPS fixes; a late batch is accepted until the leg is filed
//   stop       { stop: { reason_code, lat, lng … } }   a stop on the way
//   continue   { minutes?, at? }                 leave the stop
//   end        { fix }                           end the leg; distance, gaps and jumps are worked out on the server
//   preview    { report }                        the leg report as it is typed: flags, amount, mileage working. Saves nothing
//   file       { report }                        save the leg report (the fare, or the mileage)
//   skip       { reason }                        the leg was not needed
//   no-gps     { reason, note? }                 the leg happened without GPS
//   answer     { text }                          answer what a desk asked about this journey
//
// All of these are the TRAVELLER's own leg — te__leg_for_actor refuses anybody
// else's. What a DESK does about a journey lives at ../review, because that is
// a different person with a different right, and putting the two behind one
// `action` switch would make the two permission models easy to confuse.
//
// fix = { lat, lng, accuracy_m, address?, recorded_at?, is_mock?, device? } from the phone.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, needOneOf, needText, needUuid, optText } from '@/lib/te/errors'
import { legAnswer, legContinue, legEnd, legFile, legNoGps, legPings, legPreview, legSkip, legStart, legStop } from '@/lib/te/engine/te-service.js'
import type { GpsFix, GpsPing, LegReportInput, StopInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIONS = ['start', 'pings', 'stop', 'continue', 'end', 'preview', 'file', 'skip', 'no-gps', 'answer'] as const
/** A phone that was offline can send a whole day at once, but not without limit. */
const MAX_PINGS = 5000

interface Body {
  action?: string
  fix?: GpsFix
  pings?: GpsPing[]
  stop?: StopInput
  minutes?: number | null
  at?: string | null
  report?: LegReportInput
  reason?: string
  note?: string
  text?: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const legId = needUuid(id, 'Leg')
    const body = await t.body<Body>()
    const action = needOneOf(body.action, ACTIONS, 'action')
    const ctx = await t.ctx()
    switch (action) {
      case 'start': return legStart(ctx, legId, body.fix ?? ({} as GpsFix))
      case 'pings': {
        if (!Array.isArray(body.pings)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'pings must be a list.')
        if (body.pings.length > MAX_PINGS) throw new TeHttpError(400, 'TE_BAD_REQUEST', `Send at most ${MAX_PINGS} location points in one request.`)
        return legPings(ctx, legId, body.pings)
      }
      case 'stop': return legStop(ctx, legId, body.stop ?? ({} as StopInput))
      case 'continue': return legContinue(ctx, legId, typeof body.minutes === 'number' ? body.minutes : null, optText(body.at))
      case 'end': return legEnd(ctx, legId, body.fix as GpsFix)
      case 'preview': return legPreview(ctx, legId, body.report ?? {})
      case 'file': return legFile(ctx, legId, body.report ?? {})
      case 'skip': return legSkip(ctx, legId, needText(body.reason, 'reason'))
      case 'no-gps': return legNoGps(ctx, legId, needText(body.reason, 'reason'), optText(body.note))
      case 'answer': return legAnswer(ctx, legId, needText(body.text, 'text'))
    }
  })
}
