// DELETE /api/te/expenses/[id] — throw away a saved line that is not in a
// claim. The row is kept with status DISCARDED so the audit trail and the
// duplicate checks still know it existed.
//
// PATCH /api/te/expenses/[id] — move the line into a trip's bucket, or out of
// every trip when trip_id is null. Only the trip moves; the money, the category
// and the proof are untouched, and every condition is in SQL (185), including
// the one this side cannot see: whether a claim already carries the line.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needUuid } from '@/lib/te/errors'
import { expenseDiscard, expenseMoveTrip } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => expenseDiscard(await t.ctx(), needUuid(id, 'Expense')))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const body = await t.body<{ trip_id?: string | null }>()
    // An absent trip_id and an explicit null mean the same thing — out of every
    // trip — and are both deliberate. Only a non-empty value is validated as an
    // id, so "move it out" cannot fail on a uuid check.
    const raw = body?.trip_id ?? null
    const trip = raw ? needUuid(raw, 'Trip') : null
    return expenseMoveTrip(await t.ctx(), needUuid(id, 'Expense'), trip)
  })
}
