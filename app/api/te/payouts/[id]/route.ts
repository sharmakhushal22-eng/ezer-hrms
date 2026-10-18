// POST /api/te/payouts/[id] — act on one payout batch. Body: { action, … }
//   file         the bank file. Answers text/csv (add ?format=json for rows). Marks the batch FILE_GENERATED.
//                The file carries full bank account numbers: the Finance permission is required here, and the
//                SQL function gives it only to a Finance team member.
//   paid         { ref }       the bank or payroll confirmed the batch; every claim in it is settled
//   cancel       { reason }    drop a batch that was not paid; its claims wait for the next one
//   item-failed  { item_id, reason }   one transfer failed; that claim goes back to VERIFIED
import { NextRequest } from 'next/server'
import { teCsvResponse, teRoute } from '@/lib/te/server'
import { TeHttpError, needOneOf, needText, needUuid, rpcError } from '@/lib/te/errors'
import { toCsv } from '@/lib/te/csv'
import { payoutCancel, payoutFile, payoutItemFailed, payoutPaid } from '@/lib/te/engine/te-service.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACTIONS = ['file', 'paid', 'cancel', 'item-failed'] as const

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return teRoute(req, async t => {
    const batchId = needUuid(id, 'Batch')
    const body = await t.body<{ action?: string; ref?: string; reason?: string; item_id?: string }>()
    const action = needOneOf(body.action, ACTIONS, 'action')
    await t.permit('Finance', 'VIEW')
    const ctx = await t.ctx()

    if (action === 'paid') return payoutPaid(ctx, batchId, needText(body.ref, 'ref'))
    if (action === 'cancel') return payoutCancel(ctx, batchId, needText(body.reason, 'reason'))
    if (action === 'item-failed') {
      const itemId = needUuid(body.item_id, 'item_id')
      const reason = needText(body.reason, 'reason')
      // The item must belong to the batch in the address: the SQL function takes the item id alone.
      const { data, error } = await t.sb().from('te_payout_items').select('id').eq('id', itemId).eq('batch_id', batchId).maybeSingle()
      if (error) throw rpcError(error, 'te_payout_items')
      if (!data) throw new TeHttpError(404, 'TE_PAYOUT', 'That payment is not part of this batch.')
      return payoutItemFailed(ctx, itemId, reason)
    }

    const rows = await payoutFile(ctx, batchId)
    if (req.nextUrl.searchParams.get('format') === 'json') return { batch_id: batchId, rows }
    const csv = toCsv(rows as unknown as Record<string, unknown>[], [
      ['beneficiary_name', 'Beneficiary name'], ['emp_code', 'Employee code'], ['account_number', 'Account number'],
      ['ifsc', 'IFSC'], ['amount', 'Amount'], ['narration', 'Narration'],
    ])
    return teCsvResponse(csv, `payout-${batchId.slice(0, 8)}.csv`)
  })
}
