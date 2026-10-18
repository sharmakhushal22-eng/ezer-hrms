// POST /api/te/expenses — save an expense line (id set = edit a saved one).
// The same checks as the preview run again; a blocked line is refused with
// code TE_EXPENSE and the flags.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { expenseSave } from '@/lib/te/engine/te-service.js'
import type { ExpenseInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => expenseSave(await t.ctx(), await t.body<ExpenseInput>()))
}
