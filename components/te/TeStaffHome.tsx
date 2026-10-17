'use client'
// components/te/TeStaffHome.tsx — the landing of /dashboard/expenses.
//
// The back office, behind one page. Each person sees only what their role
// opens: a desk whose call comes back 403 is simply not offered.
//   Dashboard      what is waiting, the desk's counts, the setup check
//   Approvals      trips and claims waiting on this person
//   Travel Desk    tickets and hotels to book, vehicles to check
//   Finance desk   verification, advances, payouts, corrections, months
//   Setup          rates, limits, GPS rules, checks, categories, who approves,
//                  and Desks — who answers for which company and branch
//   Reports        the claim register, the flag report, the trip GPS log
//   Audit          who did what, and when
//
// THE THREE TABS. Of the module's three authority-wise tabs, two are here and
// one is not. Travel Desk and Finance desk are staff screens and live on this
// page. Reports and dashboard — tab 1 — belongs to literally every employee,
// so it lives in the rail at /ess/travel where everybody already is, not in a
// console most of the company cannot open.
//
// FINANCE WAS FIVE TABS AND IS NOW ONE. Verification, Advances, Payouts,
// Corrections and Months were a third of the tab row and read as five
// unrelated jobs. They are one desk with five rooms; the rooms are a segmented
// control inside TeFinanceDesk now.
import { useEffect, useState } from 'react'
import { te, type FinanceSummary } from '@/lib/te/client'
import type { TeConfig, TeHealthRow, TeQueueRow } from '@/lib/te/types'
import TeApprovals from './approve/TeApprovals'
import TeClaimApproval from './approve/TeClaimApproval'
import TeFinanceDesk from './finance/TeFinanceDesk'
import TeTravelDesk from './desk/TeTravelDesk'
import TeModesVehicles from './admin/TeModesVehicles'
import TePolicy from './admin/TePolicy'
import TeGpsRules from './admin/TeGpsRules'
import TeChecks from './admin/TeChecks'
import TeCategories from './admin/TeCategories'
import TeWorkflow from './admin/TeWorkflow'
import TeDesks from './admin/TeDesks'
import TeReports from './admin/TeReports'
import TeAudit from './admin/TeAudit'
import TeTripLog from './admin/TeTripLog'
import TeIcon from './TeIcon'
import { errorText, plural, rs, when } from '@/lib/te/format'
import './te.css'

type Desk =
  | 'home' | 'approvals' | 'deskwork' | 'finance'
  | 'rates' | 'policy' | 'gps' | 'checks' | 'categories' | 'workflow' | 'desks'
  | 'reports' | 'triplog' | 'audit'

/** The desks, and what each needs before it is worth offering. A desk is shown
 *  when its data loaded; one that 403s for this person simply is not there. */
const DESKS: { k: Desk; label: string; icon: string; needsFinance?: boolean; needsDesk?: boolean; needsAdmin?: boolean }[] = [
  { k: 'home', label: 'Dashboard', icon: 'home' },
  { k: 'approvals', label: 'Approvals', icon: 'check' },
  // Tab 2 and tab 3, in the order a request travels: the Travel Desk books it,
  // Finance pays for it.
  { k: 'deskwork', label: 'Travel Desk', icon: 'plane', needsDesk: true },
  { k: 'finance', label: 'Finance desk', icon: 'claims', needsFinance: true },
  { k: 'rates', label: 'Modes and rates', icon: 'car', needsAdmin: true },
  { k: 'policy', label: 'Policy limits', icon: 'limits', needsAdmin: true },
  { k: 'gps', label: 'GPS rules', icon: 'target', needsAdmin: true },
  { k: 'checks', label: 'Checks', icon: 'verify', needsAdmin: true },
  { k: 'categories', label: 'Categories', icon: 'other', needsAdmin: true },
  { k: 'workflow', label: 'Who approves', icon: 'people', needsAdmin: true },
  // Who answers for which company and branch — the configuration behind the
  // Travel Desk and Finance desk tabs above.
  { k: 'desks', label: 'Desks', icon: 'pin', needsAdmin: true },
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
  /** Category codes come back on the spend split; the names live in the admin
   *  config, which a Finance-only user cannot read. The code is then shown as
   *  it is rather than hidden. */
  const catName = (code: string) => cfg?.cats.find(c => c.id === code)?.name ?? code

  const tabs = DESKS.filter(d =>
    (!d.needsFinance || isFinance) && (!d.needsDesk || hasDesk) && (!d.needsAdmin || isAdmin))

  const body = () => {
    if (desk === 'approvals') return <TeApprovals onToast={setToast} />
    if (desk === 'finance') return <TeFinanceDesk onToast={setToast} />
    if (desk === 'deskwork') return <TeTravelDesk vehicleTypes={cfg?.vehicles ?? []} fuelPrice={cfg?.fuelPrice ?? {}} onToast={setToast} />
    if (desk === 'workflow') return <TeWorkflow onToast={setToast} />
    if (desk === 'desks') return <TeDesks onToast={setToast} />
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

              {/* Screen a0: the tiles. Markup is the prototype's g6/tile. */}
              {summary ? (
                <div className="g6">
                  <div className="tile">
                    <div className="l">In the pipeline</div>
                    <div className="v num">{rs(summary.pipelineAmount)}</div>
                    <div className="s">{plural(summary.inApproval + summary.inVerification + summary.onHold, 'claim')}</div>
                  </div>
                  <div className="tile">
                    <div className="l">With managers</div>
                    <div className="v num">{summary.inApproval}</div>
                    <div className="s">waiting to be approved</div>
                  </div>
                  <div className="tile">
                    <div className="l">With Finance</div>
                    <div className="v num">{summary.inVerification}</div>
                    <div className="s">{summary.onHold ? `${summary.onHold} on hold` : 'none on hold'}</div>
                  </div>
                  <div className="tile">
                    <div className="l">To pay out</div>
                    <div className="v num">{rs(summary.payableAmount)}</div>
                    <div className="s">{plural(summary.payable, 'claim')} verified</div>
                  </div>
                  <div className="tile">
                    <div className="l">Advances out</div>
                    <div className="v num">{rs(summary.advancesOutAmount)}</div>
                    <div className="s">{plural(summary.advancesOut, 'advance')} with employees</div>
                  </div>
                  <div className="tile">
                    <div className="l">Payout batches</div>
                    <div className="v num">{summary.openBatches}</div>
                    <div className="s">{summary.advancesToPay ? `${summary.advancesToPay} advances to pay` : 'open'}</div>
                  </div>
                </div>
              ) : null}

              {/* Where the money goes. CSS bars, as the prototype has them —
                  no charting library, and none is needed for one series. */}
              {summary?.byCategory.length ? (
                <div className="card">
                  <div className="ch"><h3>What it is spent on</h3></div>
                  <div className="bars">
                    {summary.byCategory.slice(0, 8).map(b => {
                      const top = summary.byCategory[0].amount || 1
                      return (
                        <div key={b.cat} className="b1" title={`${catName(b.cat)}: ${rs(b.amount)}`}>
                          <span>{catName(b.cat)}</span>
                          <div className="trk1"><i style={{ width: `${Math.max(2, (b.amount / top) * 100)}%` }} /></div>
                          <span className="num right b">{rs(b.amount)}</span>
                        </div>
                      )
                    })}
                  </div>
                  {!summary.amountsComplete ? (
                    <p className="small muted">
                      There is more than this screen adds up in one go, so these are at least this much, not exactly this much.
                    </p>
                  ) : null}
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
