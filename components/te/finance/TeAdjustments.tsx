'use client'
// components/te/finance/TeAdjustments.tsx — corrections after a claim is paid.
//
// This desk had no screen at all. te.finance.adjustments, adjustmentAdd and
// adjustmentClose all worked, with routes and RPCs behind them, and nothing in
// the module called any of them — so when an advance came to more than the
// settled claim, or a toll was counted twice, the money owed either way was
// invisible and uncollectable.
//
// WHY A CORRECTION AND NOT AN EDIT. The claim is finished: approved, verified
// and paid, with the trail of who did each. Rewriting it would destroy exactly
// the record that makes it trustworthy. So a correction is its own row against
// the claim, one of two directions — `recover` (the employee owes the company)
// or `pay` (the company owes the employee).
//
// FINDING THE CLAIM. A correction must name one, and Finance knows it by its
// number, so the form searches claims by number, name or employee code (the
// `q` filter the claims view already supports) rather than asking for a uuid.
import { useCallback, useEffect, useState } from 'react'
import { te, type AdjustmentRow, type ClaimSummaryRow } from '@/lib/te/client'
import {
  adjustmentActions, adjustmentTotals, adjustmentWay, whyAdjustmentNotReady,
  type AdjustmentAction,
} from '@/lib/te/finance-desk'
import { errorText, rs, when } from '@/lib/te/format'
import TeIcon from '../TeIcon'

export default function TeAdjustments({ onToast }: { onToast: (message: string) => void }) {
  const [rows, setRows] = useState<AdjustmentRow[] | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])
  // Closing one.
  const [closing, setClosing] = useState<{ id: string; action: AdjustmentAction } | null>(null)
  const [reference, setReference] = useState('')
  // Raising one.
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<ClaimSummaryRow[]>([])
  const [picked, setPicked] = useState<ClaimSummaryRow | null>(null)
  const [direction, setDirection] = useState<'recover' | 'pay'>('recover')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let current = true
    te.finance.adjustments({ limit: 200 })
      .then(p => { if (current) { setRows(p.rows ?? []); setError('') } })
      .catch(e => { if (current) { setRows([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [tick])

  // Searching for the claim the correction is about. Debounced the way every
  // other preview in this module is, and the answer is dropped if a newer
  // search started while it was in flight.
  useEffect(() => {
    const q = search.trim()
    // Too short to search on. Nothing is cleared here: a setState in the effect
    // body runs before the first paint. What is shown is derived below, from
    // the query itself, so a stale list cannot survive a cleared box.
    if (q.length < 2) return
    let current = true
    const timer = setTimeout(() => {
      te.finance.claims({ q, limit: 8 })
        .then(p => { if (current) setFound(p.rows ?? []) })
        .catch(() => { if (current) setFound([]) })
    }, 350)
    return () => { current = false; clearTimeout(timer) }
  }, [search])

  async function close(row: AdjustmentRow, action: AdjustmentAction) {
    setBusy(row.id); setError('')
    try {
      await te.finance.adjustmentClose(row.id, action, reference.trim() || undefined)
      onToast(action === 'done' ? 'Correction settled.' : 'Correction cancelled.')
      setClosing(null); setReference(''); reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  async function add() {
    const why = whyAdjustmentNotReady(Number(amount), reason, picked?.id ?? '')
    if (why) { setError(why); return }
    setBusy('add'); setError('')
    try {
      await te.finance.adjustmentAdd(picked!.id, direction, Number(amount), reason.trim())
      onToast(`Correction raised against ${picked!.claim_no}.`)
      setAdding(false); setPicked(null); setSearch(''); setAmount(''); setReason(''); reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  // Derived, not stored: the suggestions belong to the current query.
  const matches = search.trim().length >= 2 && !picked ? found : []
  const list = rows ?? []
  const totals = adjustmentTotals(list)
  const open = list.filter(r => r.status === 'OPEN')
  const closed = list.filter(r => r.status !== 'OPEN')

  const row = (r: AdjustmentRow) => {
    const offers = adjustmentActions(r.status)
    const chosen = closing?.id === r.id ? offers.find(o => o.action === closing.action) : null
    const way = adjustmentWay(r.direction)
    return (
      <div key={r.id} className="li">
        <span className="ico"><TeIcon name={r.direction === 'recover' ? 'advances' : 'claims'} /></span>
        <div className="grow">
          <div className="b">
            {r.full_name ?? 'This employee'} <span className="mono muted">{r.emp_code}</span>
            {r.te_claims ? <span className="mono muted"> · {r.te_claims.claim_no}</span> : null}
          </div>
          <div className="small muted">{way.who} {r.reason}</div>
          <div className="small muted">
            Raised {when(r.created_at)}
            {r.reference ? ` · ${r.reference}` : ''}
          </div>

          {offers.length ? (
            <div className="row tight">
              {offers.map(o => (
                <button
                  key={o.action}
                  type="button"
                  className={o.grave ? 'btn sm dan' : 'btn sm'}
                  aria-pressed={closing?.id === r.id && closing.action === o.action}
                  onClick={() => {
                    setClosing(closing?.id === r.id && closing.action === o.action ? null : { id: r.id, action: o.action })
                    setReference(''); setError('')
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}

          {chosen ? (
            <div className="form">
              <div className={chosen.grave ? 'flag crit' : 'note'}>
                <TeIcon name={chosen.grave ? 'alert' : 'info'} size="sm" />
                <span>{chosen.effect}</span>
              </div>
              {chosen.reference ? (
                <label className="fld sm"><span>Reference</span>
                  <input value={reference} onChange={e => setReference(e.target.value)} placeholder="UTR, payroll run or receipt number" />
                </label>
              ) : null}
              <div className="row tight">
                <button type="button" className="btn" onClick={() => { setClosing(null); setReference('') }}>Never mind</button>
                <button
                  type="button"
                  className={chosen.grave ? 'btn dan' : 'btn pri'}
                  disabled={busy === r.id}
                  onClick={() => close(r, chosen.action)}
                >
                  {busy === r.id ? 'Saving…' : chosen.label}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="amt">
          <b>{rs(r.amount)}</b>
          <span className="small muted">{way.label.toLowerCase()}</span>
          <div><span className={r.status === 'OPEN' ? 'chip t-warn' : r.status === 'DONE' ? 'chip t-pos' : 'chip plain'}>{r.status.toLowerCase()}</span></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Corrections</h1>
          <p>Money owed either way after a claim was paid. The claim itself is left exactly as it was approved.</p>
        </div>
        <button type="button" className="btn pri" onClick={() => { setAdding(a => !a); setError('') }}>
          {adding ? 'Close' : 'Raise a correction'}
        </button>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      {adding ? (
        <div className="card">
          <div className="ch"><h3>Raise a correction</h3></div>
          <div className="form">
            <label className="fld"><span>Which claim</span>
              <input
                value={picked ? `${picked.claim_no} · ${picked.employee_name}` : search}
                onChange={e => { setPicked(null); setSearch(e.target.value) }}
                placeholder="Claim number, employee name or code"
              />
              {picked ? <small>Correcting {picked.claim_no}. Type again to choose another.</small> : null}
            </label>
            {matches.length ? (
              <div className="stack sm">
                {matches.map(c => (
                  <button key={c.id} type="button" className="act" onClick={() => { setPicked(c); setFound([]) }}>
                    <span className="ico-b"><TeIcon name="other" /></span>
                    <span>
                      <b>{c.claim_no} · {c.employee_name}</b>
                      <small>{[c.trip_name || 'Other expenses', c.status.toLowerCase(), rs(c.net_amount ?? c.eligible_total)].filter(Boolean).join(' · ')}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="seg sm" role="group" aria-label="Which way">
              <button type="button" aria-pressed={direction === 'recover'} onClick={() => setDirection('recover')}>Recover from the employee</button>
              <button type="button" aria-pressed={direction === 'pay'} onClick={() => setDirection('pay')}>Pay the employee</button>
            </div>
            <p className="small muted">{adjustmentWay(direction).who}</p>

            <label className="fld"><span>How much (₹)</span>
              <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} />
            </label>
            <label className="fld"><span>What it is for</span>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Toll counted twice" />
            </label>
            <div className="note">
              <TeIcon name="info" size="sm" />
              <span>The employee sees this on the claim. The claim is not reopened or changed.</span>
            </div>
            <button
              type="button"
              className="btn pri lg wide"
              disabled={busy === 'add' || !!whyAdjustmentNotReady(Number(amount), reason, picked?.id ?? '')}
              onClick={add}
            >
              {busy === 'add' ? 'Raising…' : 'Raise the correction'}
            </button>
          </div>
        </div>
      ) : null}

      {open.length ? (
        <div className="card">
          <dl className="kv">
            <dt>Still to recover</dt><dd>{rs(totals.recover)}</dd>
            <dt>Still to pay</dt><dd>{rs(totals.pay)}</dd>
            <dt className="tot">Open corrections</dt><dd className="tot">{totals.open}</dd>
          </dl>
        </div>
      ) : null}

      <div className="card pad0">
        <div className="day"><span>Open</span><span>{open.length}</span></div>
        {rows === null ? <div className="empty"><b>Loading…</b></div> : null}
        {rows !== null && !open.length ? (
          <div className="empty"><b>Nothing outstanding</b>A correction appears here when a paid claim turns out to be wrong.</div>
        ) : null}
        {open.map(row)}
      </div>

      {closed.length ? (
        <div className="card pad0">
          <div className="day"><span>Closed</span><span>{closed.length}</span></div>
          {closed.map(row)}
        </div>
      ) : null}
    </div>
  )
}
