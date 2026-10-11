'use client'
// components/te/finance/TePeriods.tsx — expense months. Screens b2, b3, b4, b5.
//
// A month is the boundary round a set of claims. Closing one stops new claims
// being dated into it; locking one stops everything, for good. So locking is
// the only genuinely irreversible act on any Finance screen here, and it says
// so before it happens.
//
// The server refuses a lock while claims are still moving (b4) — which is
// what "roll the stragglers forward" is for. That refusal is rendered as the
// server words it; this screen does not try to predict it.
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import { periodActions, periodNeedsReason, type PeriodAction } from '@/lib/te/finance-desk'
import { errorText, when } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const TONE: Record<string, string> = { OPEN: 't-pos', CLOSED: 't-warn', LOCKED: 'plain' }

export default function TePeriods({ onToast }: { onToast: (message: string) => void }) {
  const [rows, setRows] = useState<{ id: string; period_month: string; period_label: string; status: string; closed_at: string | null; locked_at: string | null }[] | null>(null)
  const [acting, setActing] = useState<{ month: string; action: PeriodAction } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.finance.periods()
      .then(p => { if (current) { setRows(p.rows ?? []); setError('') } })
      .catch(e => { if (current) { setRows([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [tick])

  async function run(month: string, action: PeriodAction) {
    setBusy(true); setError('')
    try {
      const r = await te.finance.periodAct(month, action, reason.trim() || undefined)
      onToast(action === 'roll' ? `${r.rolled} claim${r.rolled === 1 ? '' : 's'} moved to the next month.` : `${month} is ${r.status.toLowerCase()}.`)
      setActing(null); setReason(''); reload()
    } catch (e) {
      // The server's own words — "this month still has claims in it" reads
      // better than anything invented here.
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const list = rows ?? []

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Expense months</h1>
          <p>Which months accept claims. Closing one stops new claims being dated into it; locking one closes it for good.</p>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="card pad0">
        <div className="day"><span>Months</span><span>{list.length}</span></div>
        {rows === null ? <div className="empty"><b>Loading…</b></div> : null}
        {list.map(p => {
          const actions = periodActions(p.status)
          const open = acting?.month === p.period_month ? acting : null
          const offer = open ? actions.find(a => a.action === open.action) : null
          return (
            <div key={p.id} className="li">
              <span className="ico"><TeIcon name="cal" /></span>
              <div className="grow">
                <div className="b">{p.period_label}</div>
                <div className="small muted">
                  {p.locked_at ? `Locked ${when(p.locked_at)}` : p.closed_at ? `Closed ${when(p.closed_at)}` : 'Accepting claims'}
                </div>
                {actions.length ? (
                  <div className="row tight">
                    {actions.map(a => (
                      <button
                        key={a.action}
                        type="button"
                        className={a.grave ? 'btn sm dan' : 'btn sm'}
                        aria-pressed={open?.action === a.action}
                        onClick={() => { setActing(open?.action === a.action ? null : { month: p.period_month, action: a.action }); setReason(''); setError('') }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                ) : <span className="small muted">Locked. Nothing can change.</span>}

                {offer ? (
                  <div className="form">
                    {/* The consequence, before the click. */}
                    <div className={offer.grave ? 'flag crit' : 'note'}>
                      <TeIcon name={offer.grave ? 'alert' : 'info'} size="sm" />
                      <span>{offer.effect}</span>
                    </div>
                    {periodNeedsReason(offer.action) ? (
                      <label className="fld"><span>Why</span>
                        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Recorded against the month" />
                      </label>
                    ) : null}
                    <div className="row tight">
                      <button type="button" className="btn" onClick={() => { setActing(null); setReason('') }}>Never mind</button>
                      <button
                        type="button"
                        className={offer.grave ? 'btn dan' : 'btn pri'}
                        disabled={busy || (periodNeedsReason(offer.action) && !reason.trim())}
                        onClick={() => run(p.period_month, offer.action)}
                      >
                        {busy ? 'Working…' : offer.label}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="amt">
                <span className={`chip ${TONE[p.status] ?? 'plain'}`}>{p.status.toLowerCase()}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
