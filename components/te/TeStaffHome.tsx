'use client'
// components/te/TeStaffHome.tsx — the landing of /dashboard/expenses.
//
// The back office, behind one page. Each person sees only what their role
// opens: a desk whose call comes back 403 is simply not offered.
//   Dashboard      what is waiting, the desk's counts, the setup check
//   Approvals      trips and claims waiting on this person
//   Verification   claims a manager passed, now Finance's to check
//   Advances       money out with employees
//   Payouts        verified claims, and the batches they go out in
//   Corrections    money owed either way after a claim was paid
//   Months         which months accept claims
//   Travel Desk    tickets and hotels to book, vehicles to check
//   Setup          rates, limits, GPS rules, checks, categories, who approves
//   Reports        the claim register, the flag report, the trip GPS log
//   Audit          who did what, and when
import { useEffect, useState } from 'react'
import { te, type FinanceSummary } from '@/lib/te/client'
import type { TeConfig, TeHealthRow, TeQueueRow } from '@/lib/te/types'
import TeApprovals from './approve/TeApprovals'
import TeClaimApproval from './approve/TeClaimApproval'
import TeVerification from './finance/TeVerification'
import TeAdvanceDesk from './finance/TeAdvanceDesk'
import TePayouts from './finance/TePayouts'
import TeAdjustments from './finance/TeAdjustments'
import TePeriods from './finance/TePeriods'
import TeTravelDesk from './desk/TeTravelDesk'
import TeModesVehicles from './admin/TeModesVehicles'
import TePolicy from './admin/TePolicy'
import TeGpsRules from './admin/TeGpsRules'
import TeChecks from './admin/TeChecks'
import TeCategories from './admin/TeCategories'
import TeWorkflow from './admin/TeWorkflow'
import TeReports from './admin/TeReports'
import TeAudit from './admin/TeAudit'
import TeTripLog from './admin/TeTripLog'
import TeIcon from './TeIcon'
import { errorText, rs, when } from '@/lib/te/format'
import './te.css'

type Desk =
  | 'home' | 'approvals' | 'verify' | 'advances' | 'payouts' | 'corrections' | 'periods' | 'deskwork'
  | 'rates' | 'policy' | 'gps' | 'checks' | 'categories' | 'workflow'
  | 'reports' | 'triplog' | 'audit'

/** The desks, and what each needs before it is worth offering. A desk is shown
 *  when its data loaded; one that 403s for this person simply is not there. */
const DESKS: { k: Desk; label: string; icon: string; needsFinance?: boolean; needsDesk?: boolean; needsAdmin?: boolean }[] = [
  { k: 'home', label: 'Dashboard', icon: 'home' },
  { k: 'approvals', label: 'Approvals', icon: 'check' },
  { k: 'verify', label: 'Verification', icon: 'verify', needsFinance: true },
  { k: 'advances', label: 'Advances', icon: 'advances', needsFinance: true },
  { k: 'payouts', label: 'Payouts', icon: 'claims', needsFinance: true },
  { k: 'corrections', label: 'Corrections', icon: 'swap', needsFinance: true },
  { k: 'periods', label: 'Months', icon: 'cal', needsFinance: true },
  { k: 'deskwork', label: 'Travel Desk', icon: 'plane', needsDesk: true },
  { k: 'rates', label: 'Modes and rates', icon: 'car', needsAdmin: true },
  { k: 'policy', label: 'Policy limits', icon: 'limits', needsAdmin: true },
  { k: 'gps', label: 'GPS rules', icon: 'target', needsAdmin: true },
  { k: 'checks', label: 'Checks', icon: 'verify', needsAdmin: true },
  { k: 'categories', label: 'Categories', icon: 'other', needsAdmin: true },
  { k: 'workflow', label: 'Who approves', icon: 'people', needsAdmin: true },
  { k: 'reports', label: 'Reports', icon: 'claims', needsAdmin: true },
  { k: 'triplog', label: 'Trip log', icon: 'route', needsAdmin: true },
  { k: 'audit', label: 'Audit', icon: 'clock', needsAdmin: true },
]

export default function TeStaffHome() {
  const [queue, setQueue] = useState<TeQueueRow[] | null>(null)
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [health, setHealth] = useState<TeHealthRow[] | null>(null)
  const [error, setError] = useState('')
  const [openClaim, setOpenClaim] = useState<string | null>(null)
  const [desk, setDesk] = useState<Desk>('home')
  const [toast, setToast] = useState('')
  // Vehicle types, for the Travel Desk to say what a rate becomes. Admin-only,
  // so it may be absent for a desk user — the rates degrade, the desk works.
  const [cfg, setCfg] = useState<TeConfig | null>(null)
  // Whether this person may use the Travel Desk at all. Its own permission,
  // not the admin one: the desk's own call is the only honest test.
  const [hasDesk, setHasDesk] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let current = true
    te.queue().then(q => { if (current) { setQueue(q); setError('') } }).catch(e => { if (current) { setQueue([]); setError(errorText(e)) } })
    te.finance.summary().then(r => { if (current) setSummary(r.summary) }).catch(() => { if (current) setSummary(null) })
    te.admin.health().then(r => { if (current) setHealth(r.health) }).catch(() => { if (current) setHealth(null) })
    te.admin.config().then(r => { if (current) setCfg(r.config) }).catch(() => { if (current) setCfg(null) })
    te.desk.list().then(() => { if (current) setHasDesk(true) }).catch(() => { if (current) setHasDesk(false) })
    return () => { current = false }
  }, [tick])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Finance's own counts loading is the proof that this person has the Finance
  // permission; no role is named here.
  const isFinance = summary !== null
  // The admin config loading IS the admin permission; nothing else is named.
  const isAdmin = cfg !== null
  const tabs = DESKS.filter(d =>
    (!d.needsFinance || isFinance) && (!d.needsDesk || hasDesk) && (!d.needsAdmin || isAdmin))

  const body = () => {
    if (desk === 'approvals') return <TeApprovals onToast={setToast} />
    if (desk === 'verify') return <TeVerification onToast={setToast} />
    if (desk === 'advances') return <TeAdvanceDesk onToast={setToast} />
    if (desk === 'payouts') return <TePayouts onToast={setToast} />
    if (desk === 'corrections') return <TeAdjustments onToast={setToast} />
    if (desk === 'periods') return <TePeriods onToast={setToast} />
    if (desk === 'deskwork') return <TeTravelDesk vehicleTypes={cfg?.vehicles ?? []} fuelPrice={cfg?.fuelPrice ?? {}} onToast={setToast} />
    if (desk === 'workflow') return <TeWorkflow onToast={setToast} />
    if (desk === 'reports') return <TeReports onToast={setToast} />
    if (desk === 'triplog') return <TeTripLog />
    if (desk === 'audit') return <TeAudit />
    // The rest edit the config, so they all need it and all reload it after.
    if (!cfg) return null
    const reloadCfg = () => setTick(n => n + 1)
    if (desk === 'rates') return <TeModesVehicles key={tick} cfg={cfg} onSaved={reloadCfg} onToast={setToast} />
    if (desk === 'policy') return <TePolicy key={tick} cfg={cfg} onSaved={reloadCfg} onToast={setToast} />
    if (desk === 'gps') return <TeGpsRules key={tick} cfg={cfg} onSaved={reloadCfg} onToast={setToast} />
    if (desk === 'checks') return <TeChecks key={tick} cfg={cfg} onSaved={reloadCfg} onToast={setToast} />
    if (desk === 'categories') return <TeCategories key={tick} cfg={cfg} onSaved={reloadCfg} onToast={setToast} />
    return null
  }

  return (
    <div className="te">
      <main className="main">
        <div className="page">
          {tabs.length > 1 ? (
            <div className="seg scopes" role="group" aria-label="Desks">
              {tabs.map(d => (
                <button key={d.k} type="button" aria-pressed={desk === d.k} onClick={() => { setDesk(d.k); setOpenClaim(null) }}>
                  <TeIcon name={d.icon} size="sm" />{d.label}
                </button>
              ))}
            </div>
          ) : null}

          {desk !== 'home' ? body() : openClaim ? (
            // The full approval screen, not the read-mostly detail: a row in
            // "Waiting for you" is there because this person has to decide it,
            // and deciding means line amounts, flags and the four-eyes refusal.
            // This used to open TeClaimDetail, whose own text then apologised
            // that line decisions were elsewhere.
            <TeClaimApproval
              claimId={openClaim}
              onBack={() => setOpenClaim(null)}
              onDecided={message => { setToast(message); setOpenClaim(null); setTick(n => n + 1) }}
            />
          ) : (
            <>
              <div className="ph">
                <div>
                  <h1>Travel and Expenses</h1>
                  <p>What is waiting on you, how the Finance desk stands, and whether the module is set up.</p>
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
      <div className="toasts" aria-live="polite">{toast ? <div className="toast">{toast}</div> : null}</div>
    </div>
  )
}
