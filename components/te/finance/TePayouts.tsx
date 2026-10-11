'use client'
// components/te/finance/TePayouts.tsx — paying verified claims.
// Screens a8, a9, b0, b1.
//
// THE BANK FILE IS NOT SHOWN ON SCREEN. It carries full account numbers —
// lib/te/client.ts says so where payoutFile lives — so it is streamed
// straight to a download and never rendered, never logged, never put in
// state. What the screen shows is the masked last four digits the payable
// list already carries.
//
// Two routes, and they are not the same decision: with payroll means no file
// at all and the money moves with salary; a bank transfer produces that file
// and goes now. The difference is stated before the batch is created, not
// after.
import { useCallback, useEffect, useState } from 'react'
import { te, type PayoutBatch } from '@/lib/te/client'
import { batchActions, payableTotal, PAYOUT_ROUTES } from '@/lib/te/finance-desk'
import { errorText, rs, when } from '@/lib/te/format'
import type { PayoutRoute } from '@/lib/te/types'
import TeIcon from '../TeIcon'

type Payable = { claim_id: string; claim_no: string; employee_name: string; emp_code: string; net_amount: number; bank_account_last4: string | null; ifsc_code: string | null }

export default function TePayouts({ onToast }: { onToast: (message: string) => void }) {
  const [payable, setPayable] = useState<Payable[] | null>(null)
  const [batches, setBatches] = useState<PayoutBatch[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [route, setRoute] = useState<PayoutRoute>('PAYROLL')
  const [markPaid, setMarkPaid] = useState<{ id: string; ref: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.finance.payable()
      .then(p => { if (current) { setPayable(p.rows ?? []); setError('') } })
      .catch(e => { if (current) { setPayable([]); setError(errorText(e)) } })
    te.finance.payouts()
      .then(p => { if (current) setBatches(p.rows ?? []) })
      .catch(() => { if (current) setBatches([]) })
    return () => { current = false }
  }, [tick])

  const rows = payable ?? []
  const total = payableTotal(rows, chosen, r => r.claim_id)
  const toggle = (id: string) => setChosen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function createBatch() {
    setBusy('create'); setError('')
    try {
      const r = await te.finance.payoutCreate(route, [...chosen])
      onToast(`Batch ${r.batch_no} created: ${r.items} claim${r.items === 1 ? '' : 's'}, ${rs(r.total_amount)}.`)
      setChosen(new Set()); reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  /** Straight to a file. The contents never touch React state or the DOM. */
  async function download(batch: PayoutBatch) {
    setBusy(batch.id); setError('')
    try {
      const blob = await te.finance.payoutFile(batch.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${batch.batch_no}.csv`
      a.click()
      URL.revokeObjectURL(url)
      onToast(`${batch.batch_no} downloaded. It holds account numbers — handle it like a bank file.`)
      reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  async function confirmPaid() {
    if (!markPaid?.ref.trim()) return
    setBusy('paid'); setError('')
    try {
      await te.finance.payoutPaid(markPaid.id, markPaid.ref.trim())
      onToast('Batch marked paid.')
      setMarkPaid(null); reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Payouts</h1>
          <p>Verified claims waiting to be paid, and the batches they go out in.</p>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="card pad0">
        <div className="day"><span>Ready to pay</span><span>{rows.length}</span></div>
        {payable === null ? <div className="empty"><b>Loading…</b></div> : null}
        {payable !== null && !rows.length ? <div className="empty"><b>Nothing to pay</b>Claims appear here once Finance has verified them.</div> : null}
        {rows.map(r => (
          <label key={r.claim_id} className="li click">
            <input type="checkbox" checked={chosen.has(r.claim_id)} onChange={() => toggle(r.claim_id)} />
            <div className="grow">
              <div className="b">{r.employee_name} <span className="small muted mono">{r.emp_code}</span></div>
              <div className="small muted">
                <span className="mono">{r.claim_no}</span>
                {/* Masked, and that is all this screen ever knows. */}
                {r.bank_account_last4 ? ` · account ending ${r.bank_account_last4}` : ' · no bank details on file'}
                {r.ifsc_code ? ` · ${r.ifsc_code}` : ''}
              </div>
            </div>
            <div className="amt"><b>{rs(r.net_amount)}</b></div>
          </label>
        ))}
      </div>

      {chosen.size ? (
        <div className="card">
          <div className="ch"><h3>Pay {chosen.size} claim{chosen.size === 1 ? '' : 's'}</h3><b>{rs(total)}</b></div>
          <div className="stack sm">
            {PAYOUT_ROUTES.map(r => (
              <button key={r.route} type="button" className={route === r.route ? 'act pri' : 'act'} onClick={() => setRoute(r.route)}>
                <span className="ico-b"><TeIcon name={r.route === 'PAYROLL' ? 'claims' : 'advances'} /></span>
                <span><b>{r.label}</b><small>{r.effect}</small></span>
              </button>
            ))}
          </div>
          <button type="button" className="btn pri lg wide" disabled={busy === 'create'} onClick={createBatch}>
            {busy === 'create' ? 'Creating…' : `Create the batch`}
          </button>
        </div>
      ) : null}

      <div className="card pad0">
        <div className="day"><span>Batches</span><span>{batches.length}</span></div>
        {!batches.length ? <div className="empty"><b>No batches yet</b>Tick some claims above to make one.</div> : null}
        {batches.map(b => {
          const can = batchActions(b.status)
          return (
            <div key={b.id} className="li">
              <span className="ico"><TeIcon name="claims" /></span>
              <div className="grow">
                <div className="b"><span className="mono">{b.batch_no}</span> · {b.items.length} claim{b.items.length === 1 ? '' : 's'}</div>
                <div className="small muted">
                  {b.route === 'PAYROLL' ? 'With payroll' : 'Bank transfer'}
                  {b.paid_at ? ` · paid ${when(b.paid_at)}` : ''}
                  {b.bank_ref ? ` · ${b.bank_ref}` : ''}
                </div>
                <div className="row tight">
                  {can.file && b.route === 'OFF_CYCLE' ? (
                    <button type="button" className="btn sm" disabled={busy === b.id} onClick={() => download(b)}>
                      <TeIcon name="file" size="sm" />{busy === b.id ? 'Preparing…' : 'Download the bank file'}
                    </button>
                  ) : null}
                  {can.paid ? (
                    <button type="button" className="btn sm pri" onClick={() => setMarkPaid({ id: b.id, ref: '' })}>Mark paid</button>
                  ) : null}
                </div>
                {markPaid?.id === b.id ? (
                  <div className="form">
                    <label className="fld sm"><span>Bank reference</span>
                      <input value={markPaid.ref} onChange={e => setMarkPaid({ id: b.id, ref: e.target.value })} placeholder="UTR from the bank" />
                    </label>
                    <div className="row tight">
                      <button type="button" className="btn" onClick={() => setMarkPaid(null)}>Cancel</button>
                      <button type="button" className="btn pri" disabled={!markPaid.ref.trim() || busy === 'paid'} onClick={confirmPaid}>
                        {busy === 'paid' ? 'Saving…' : 'Mark it paid'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="amt">
                <b>{rs(b.total_amount)}</b>
                <div><span className={`chip ${b.status === 'PAID' ? 't-pos' : b.status === 'CANCELLED' ? 'plain' : 't-warn'}`}>{b.status.replace(/_/g, ' ').toLowerCase()}</span></div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="note">
        <TeIcon name="shield" size="sm" />
        <span>A bank file holds full account numbers. It downloads straight to your machine and is never shown on this screen.</span>
      </div>
    </div>
  )
}
