// POST /api/te/trips/[id]/action — what the employee does to their own trip.
//   { action: 'answer', text }                 reply to a send-back without changing the plan
//   { action: 'cancel' }                       cancel it (an approver of the trip may too)
//   { action: 'record-missed', reason, note }  a local trip whose day passed with no leg started
// A Travel Claims admin (full access) may cancel any trip of their company.
import { NextRequest } from 'next/server'
import { teRoute, teStaffFor } from '@/lib/te/server'
import { needOneOf, needText, needUuid, optText } from '@/lib/te/errors'
import { tripAnswer, tripCancel, tripRecordMissed } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIONS = ['answer', 'cancel', 'record-missed'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const tripId = needUuid(id, 'Trip')
    const body = await t.body<{ action?: string; text?: string; reason?: string; note?: string }>()
    const action = needOneOf(body.action, ACTIONS, 'action')
    const ctx = await t.ctx()
    if (action === 'answer') return tripAnswer(ctx, tripId, needText(body.text, 'text'))
    if (action === 'record-missed') return tripRecordMissed(ctx, tripId, needText(body.reason, 'reason'), optText(body.note))
    return tripCancel(ctx, tripId, await teStaffFor(t, 'te_trips', tripId, ['Travel Claims'], 'FULL'))
  })
}
