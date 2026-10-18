// POST /api/te/expenses/preview — check an expense line as it is typed: the
// flags it raises, what is eligible, whether it would be blocked. Saves nothing.
// The form calls this (debounced) on every change.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { expensePreview } from '@/lib/te/engine/te-service.js'
import type { ExpenseInput } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return teRoute(req, async t => expensePreview(await t.ctx(), await t.body<ExpenseInput>()))
}
