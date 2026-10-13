// DELETE /api/te/expenses/[id] — throw away a saved line that is not in a
// claim. The row is kept with status DISCARDED so the audit trail and the
// duplicate checks still know it existed.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { needUuid } from '@/lib/te/errors'
import { expenseDiscard } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => expenseDiscard(await t.ctx(), needUuid(id, 'Expense')))
}
