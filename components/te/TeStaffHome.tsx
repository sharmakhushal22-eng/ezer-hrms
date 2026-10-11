'use client'
// components/te/TeStaffHome.tsx — the landing of /dashboard/expenses.
//
// A STARTER for the back office: it proves the page, the menu entry and the
// permissions end to end, and shows each person only what their role opens.
//   everybody      what is waiting for them to approve          GET /api/te/queue
//   Finance        the desk's counts                            GET /api/te/finance/overview?view=summary
//   Travel admin   the setup check                              GET /api/te/admin/health
// A section whose call comes back 403 is simply not shown. The Finance desk,
// the Travel Desk and the Admin screens themselves are NOT built: see
// app-code/UI-BUILD-GUIDE.md, steps 9 to 13.
import { useEffect, useState } from 'react'
import { te, type FinanceSummary } from '@/lib/te/client'
import type { TeHealthRow, TeQueueRow } from '@/lib/te/types'
import { TeClaimDetail } from './TeClaims'
import { errorText, rs, when } from '@/lib/te/format'
import './te.css'

const NO_NAMES = new Map<string, string>()

export default function TeStaffHome() {
  const [queue, setQueue] = useState<TeQueueRow[] | null>(null)
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [health, setHealth] = useState<TeHealthRow[] | null>(null)
  const [error, setError] = useState('')
  const [openClaim, setOpenClaim] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    te.queue().then(q => { if (current) { setQueue(q); setError('') } }).catch(e => { if (current) { setQueue([]); setError(errorText(e)) } })
    te.finance.summary().then(r => { if (current) setSummary(r.summary) }).catch(() => { if (current) setSummary(null) })
    te.admin.health().then(r => { if (current) setHealth(r.health) }).catch(() => { if (current) setHealth(null) })
    return () => { current = false }
  }, [tick])

  return (
    <div className="te">
      <main className="main">
        <div className="page">
          {openClaim ? (
            <TeClaimDetail claimId={openClaim} catName={NO_NAMES} onBack={() => setOpenClaim(null)} onChanged={() => setTick(n => n + 1)} />
          ) : (
            <>
              <div className="ph">
                <div>
                  <h1>Travel and Expenses</h1>
                  <p>Approvals, the Finance desk and setup. This page is a starter: it shows what is waiting and whether the module is set up.</p>
                </div>
              </div>
              {error ? <div className="flag crit" role="alert"><div className="tx"><b>{error}</b></div></div> : null}

              <div className="card pad0">
                <div className="day"><span>Waiting for you</span><span>{queue?.length ?? '…'}</span></div>
                {queue && queue.length === 0 ? <div className="empty"><b>Nothing is waiting</b>Trip plans and claims appear here when it is your turn.</div> : null}
                {(queue ?? []).map(q => (
                  <button key={q.step_id} type="button" className="li click needrow" disabled={q.entity_type !== 'claim'} onClick={() => setOpenClaim(q.entity_id)}>
                    <span className="grow">
                      <span className="b">{q.entity_type === 'claim' ? 'Claim' : 'Trip plan'} {q.ref_no} · {q.employee_name}</span>
                      <span className="small muted">{q.role_label} · waiting since {when(q.waiting_since)}{q.risk_band ? ` · ${q.risk_band} risk` : ''}</span>
                    </span>
                    <span className="amt"><b>{rs(q.amount)}</b></span>
                  </button>
                ))}
              </div>

              {summary ? (
                <div className="card">
                  <div className="ch"><h3>Finance desk</h3></div>
                  <dl className="kv">
                    <dt>With managers</dt><dd>{summary.inApproval}</dd>
                    <dt>In verification</dt><dd>{summary.inVerification}</dd>
                    <dt>On hold</dt><dd>{summary.onHold}</dd>
                    <dt>Verified, waiting for payout</dt><dd>{summary.payable}</dd>
                    <dt>Advances to pay</dt><dd>{summary.advancesToPay}</dd>
                    <dt>Advances with employees</dt><dd>{summary.advancesOut}</dd>
                    <dt>Open payout batches</dt><dd>{summary.openBatches}</dd>
                  </dl>
                </div>
              ) : null}

              {health ? (
                <div className="card pad0">
                  <div className="day"><span>Setup check</span><span>{health.filter(h => h.status !== 'ok').length} to look at</span></div>
                  {health.map(h => (
                    <div key={`${h.area}-${h.item}`} className="li">
                      <div className="grow"><div className="b">{h.area}: {h.item}</div><div className="small muted">{h.detail}</div></div>
                      <span className={h.status === 'ok' ? 'chip t-pos' : h.status === 'warn' ? 'chip t-warn' : 'chip t-crit'}>{h.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
