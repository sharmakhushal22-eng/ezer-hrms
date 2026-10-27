'use client'
/**
 * Exit Process — redesigned.
 *
 * The chain is presented as a vertical timeline instead of text rows; the flow
 * underneath is untouched. Same GET/POST on /api/ess/resignation, same two-step
 * confirm, same withdraw gate, same stage machine — which lives in 071's
 * fn_resignation_* and is enforced there, not here.
 *
 * The reasons list and the notice period come from the API, never a constant:
 * the prototype hard-coded both, and a wrong notice period on this screen is a
 * number somebody plans their life around.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ChainRow, ResignationRecord, ResignationState, StageApprover } from './types'
import { Ic } from './icons'
import { Z } from '@/lib/ui'
import { fmtDate, fmtDateTime, riseStyle, useToast } from './ui'

const STAGE_LABEL: Record<string, string> = {
  INITIATED: 'Initiated by HR',
  PENDING_RM_L1: 'With your reporting manager',
  PENDING_RM_L2: 'With your L2 manager',
  PENDING_HOD: 'With your head of department',
  PENDING_HR_MANAGER: 'With HR: final last working day',
  RETENTION_HOLD: 'On hold: your manager wants to talk',
  RECOVERY_PENDING: 'Accepted: notice recovery pending',
  SETTLED: 'Settled',
  WITHDRAWN: 'Withdrawn',
}
/** The four the timeline walks, in order. */
const STAGE_ORDER = ['PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER']
const CLOSED = ['SETTLED', 'WITHDRAWN']

/** HR Services → Exit. The HR roles see "Exit an employee" above their own exit screen. */
export function ExitProcess({ api }: { api: (path: string, init?: RequestInit) => Promise<any> }) {
  return (
    <>
      <HrExitPanel api={api} />
      <OwnExit api={api} />
    </>
  )
}

type Match = { id: string; full_name: string; emp_code: string | null; designation: string | null; department: string | null; doj: string | null; lwd: string | null }
type Reason = { code: string; category: string; label: string }

/** For the hiring and HR roles (lib/exit/hr-exit.ts): tick "Exit an employee" to process
 *  someone else's exit — reason, employee code, date of exit, additional information. The
 *  server (app/api/ess/exit-employee) decides who may, and checks it all again. */
function HrExitPanel({ api }: { api: (path: string, init?: RequestInit) => Promise<any> }) {
  const [allowed, setAllowed] = useState(false)
  const [reasons, setReasons] = useState<Reason[]>([])
  const [on, setOn] = useState(false)
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState<Match[]>([])
  const [emp, setEmp] = useState<Match | null>(null)
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [info, setInfo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const toast = useToast()

  useEffect(() => { api('/api/ess/exit-employee').then(d => { setAllowed(!!d.allowed); setReasons(d.reasons || []) }).catch(() => setAllowed(false)) }, [api])
  useEffect(() => {
    if (!on || emp || q.trim().length < 2) { setMatches([]); return }
    const t = setTimeout(() => { api(`/api/ess/exit-employee?q=${encodeURIComponent(q.trim())}`).then(d => setMatches(d.matches || [])).catch(() => setMatches([])) }, 250)
    return () => clearTimeout(t)
  }, [q, on, emp, api])

  if (!allowed) return null
  const reset = () => { setEmp(null); setQ(''); setReason(''); setInfo(''); setConfirm(false); setDate(new Date().toISOString().slice(0, 10)) }
  const ready = !!emp && !!reason && !!date
  const company = reasons.filter(r => r.category === 'EMPLOYER'), own = reasons.filter(r => r.category !== 'EMPLOYER')

  async function submit() {
    if (!ready) return
    setBusy(true)
    try {
      const j = await api('/api/ess/exit-employee', { method: 'POST', body: JSON.stringify({ employee_id: emp!.id, reason_code: reason, date_of_exit: date, remarks: info }) })
      const msg = `Exit processed for ${j.employee}. Last working day ${fmtDate(j.last_working_day)}${j.revoked_now ? '; ESS access has ended' : '; ESS access ends on that day'}.${j.mailed ? ' The employee has been mailed.' : ''}`
      toast(msg); setDone(msg); reset(); setOn(false)
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="hx-card pad" style={{ marginBottom: 14 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: 'var(--ez-ink)' }}>
        <input type="checkbox" checked={on} onChange={e => { setOn(e.target.checked); setDone(''); if (!e.target.checked) reset() }} style={{ width: 17, height: 17 }} />
        Exit an employee
        <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ez-muted)' }}>process another employee&apos;s exit (HR / Hiring Manager)</span>
      </label>
      {done && !on && <div className="hx-note" style={{ marginTop: 10 }}>{done}</div>}
      {on && (
        <div style={{ marginTop: 14 }}>
          <div className="hx-grid2">
            <div>
              <label className="hx-label">Reason</label>
              <select className="hx-select" value={reason} onChange={e => { setReason(e.target.value); setConfirm(false) }}>
                <option value="">Select…</option>
                {company.length > 0 && <optgroup label="Initiated by the company">{company.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</optgroup>}
                {own.length > 0 && <optgroup label="Resignation (recorded by HR)">{own.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</optgroup>}
              </select>
            </div>
            <div style={{ position: 'relative' }}>
              <label className="hx-label">Employee code</label>
              {emp ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 38 }}>
                  <span style={{ fontSize: 13, color: 'var(--ez-ink)' }}><b>{emp.emp_code}</b> · {emp.full_name}</span>
                  <button className="hx-btn o" onClick={() => { setEmp(null); setQ(''); setConfirm(false) }}>Change</button>
                </div>
              ) : (
                <>
                  <input className="hx-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Type the employee code or name…" autoComplete="off" />
                  {matches.length > 0 && (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 3, background: 'var(--ez-surface)', border: '1px solid var(--ez-line)', borderRadius: 9, boxShadow: '0 10px 28px rgba(0,0,0,.14)', overflow: 'hidden', zIndex: Z.raised }}>
                      {matches.map(m => (
                        <button key={m.id} type="button" onClick={() => { setEmp(m); setMatches([]); setConfirm(false) }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 11px', border: 'none', borderBottom: '1px solid var(--ez-line)', background: 'var(--ez-surface)', color: 'var(--ez-ink)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
                          <b>{m.emp_code}</b> · {m.full_name} <span style={{ color: 'var(--ez-muted)' }}>{[m.designation, m.department].filter(Boolean).join(' · ')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {q.trim().length >= 2 && matches.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--ez-faint)', marginTop: 4 }}>No active employee in your company matches.</div>}
                </>
              )}
            </div>
            <div>
              <label className="hx-label">Date of exit (last working day)</label>
              <input type="date" className="hx-input" value={date} onChange={e => { setDate(e.target.value); setConfirm(false) }} />
            </div>
            <div>
              {emp && (
                <div style={{ fontSize: 12, color: 'var(--ez-muted)', lineHeight: 1.6, paddingTop: 22 }}>
                  {emp.designation || '-'}{emp.department ? ` · ${emp.department}` : ''}{emp.doj ? ` · joined ${fmtDate(emp.doj)}` : ''}
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label className="hx-label">Additional information</label>
            <textarea className="hx-area" value={info} maxLength={2000} onChange={e => setInfo(e.target.value)} placeholder="Anything the record should carry: notice served, recovery, handover, assets to return…" />
          </div>
          <div className="hx-note w" style={{ marginTop: 12 }}>
            The employee gets a mail and a notification. On the date of exit their ESS access, roles and reporting lines end
            {date && date <= new Date().toISOString().slice(0, 10) ? <b> (today or earlier: immediately)</b> : ''}; anyone reporting to them needs a new manager.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {!confirm ? (
              <button className="hx-btn" disabled={!ready} onClick={() => setConfirm(true)}>Process exit</button>
            ) : (
              <>
                <button className="hx-btn solidred" disabled={busy} onClick={() => void submit()}>{busy ? 'Processing…' : `Yes, exit ${emp?.full_name || ''}`}</button>
                <button className="hx-btn o" disabled={busy} onClick={() => setConfirm(false)}>Not now</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function OwnExit({ api }: { api: (path: string, init?: RequestInit) => Promise<any> }) {
  const [d, setD] = useState<ResignationState | null>(null)
  const [err, setErr] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(() => api('/api/ess/resignation')
    .then(x => { setD(x); setErr('') })
    .catch(e => setErr(e.message)), [api])
  useEffect(() => { void load() }, [load])

  if (err) return <div className="hx-note d">{err}</div>
  if (!d) return <div style={{ fontSize: 12.5, color: 'var(--ez-faint)' }}>Loading…</div>

  const cur = d.current
  const open = !!cur && !CLOSED.includes(cur.status)

  async function submit() {
    setBusy(true)
    try {
      await api('/api/ess/resignation', { method: 'POST', body: JSON.stringify({ reason_code: reason, date, remarks }) })
      toast('Resignation submitted'); setConfirm(false); void load()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  async function withdraw() {
    if (!window.confirm('Withdraw your resignation? This closes the chain.')) return
    setBusy(true)
    try {
      await api('/api/ess/resignation', { method: 'POST', body: JSON.stringify({ action: 'WITHDRAW', id: cur!.id }) })
      toast('Resignation withdrawn'); void load()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  /* ------------------------------------------------------------- resigned */
  if (open && cur) {
    // Three sources, three different weights — and the label says which one.
    const lwd = cur.final_lwd || cur.proposed_lwd || cur.lwd_as_per_policy
    const lwdNote = cur.final_lwd ? 'confirmed by HR'
      : cur.proposed_lwd ? 'proposed by your manager' : 'as per policy'
    const canWithdraw = !['RECOVERY_PENDING', 'SETTLED'].includes(cur.status) && !!cur.submitted_by_employee
    const kpis = [
      { k: 'Status', v: STAGE_LABEL[cur.status] || cur.status, tone: cur.status === 'RETENTION_HOLD' ? 'warn' : '' },
      { k: 'Submitted', v: fmtDate(cur.submitted_at || cur.created_at) },
      { k: 'Notice period', v: `${cur.notice_period_days ?? '-'} days` },
      { k: 'Last working day', v: lwd ? fmtDate(lwd) : '-', note: lwdNote },
    ]
    return (
      <>
        <div className="hx-kpis">
          {kpis.map(k => (
            <div className="hx-kpi" key={k.k}>
              <div className="k">{k.k}</div>
              <div className={`v ${k.tone || ''}`} style={{ fontSize: String(k.v).length > 10 ? 15 : 18, letterSpacing: '-.01em' }}>{k.v}</div>
              {k.note && <div className="n">{k.note}</div>}
            </div>
          ))}
        </div>
        <div className="hx-card pad">
          <div className="hx-sec"><h2>Your resignation</h2></div>
          <div style={{ fontSize: 12.5, color: 'var(--ez-muted)', marginBottom: 14 }}>
            Reason: <b style={{ color: 'var(--ez-ink)' }}>{cur.exit_reason_master?.label || cur.reason_code || '-'}</b>
          </div>
          <div className="hx-sec" style={{ marginBottom: 10 }}><h2 style={{ fontSize: 12.5 }}>Acknowledgement chain</h2></div>
          <Timeline status={cur.status} chain={d.chain || []} approvers={d.approvers || {}} />
          {canWithdraw && (
            <div style={{ marginTop: 16 }}>
              <button className="hx-btn d" disabled={busy} onClick={() => void withdraw()}>Withdraw resignation</button>
            </div>
          )}
          <div className="hx-note" style={{ marginTop: 14 }}>
            Retention pauses the chain; only you can withdraw it. Your last working day becomes final at the HR stage.
          </div>
        </div>
      </>
    )
  }

  /* ----------------------------------------------------------------- form */
  return (
    <div className="hx-card pad">
      <div className="hx-sec"><h2>Resign</h2></div>
      {cur && (
        <div className="hx-note" style={{ marginBottom: 12 }}>
          Your previous resignation is {(STAGE_LABEL[cur.status] || cur.status).toLowerCase()}.
        </div>
      )}
      <div className="hx-grid2">
        <div>
          <label className="hx-label">Reason</label>
          <select className="hx-select" value={reason} onChange={e => { setReason(e.target.value); setConfirm(false) }}>
            <option value="">Select…</option>
            {(d.reasons || []).map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="hx-label">Date of resignation</label>
          <input type="date" className="hx-input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="hx-label">Anything you want to say (optional)</label>
        <textarea className="hx-area" value={remarks} placeholder="Share context for your manager and HR…"
          onChange={e => setRemarks(e.target.value)} />
      </div>
      <div className="hx-note w" style={{ marginTop: 12 }}>
        Your notice period: <b>{d.notice_period_days ?? '-'} days</b>{(d as any).on_probation ? ' (on probation)' : ' (confirmed)'}. Submitting starts the acknowledgement
        chain: your reporting manager first, then L2 / HOD, then HR sets the final last working day.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {!confirm ? (
          <button className="hx-btn" disabled={!reason} onClick={() => setConfirm(true)}>Submit resignation</button>
        ) : (
          <>
            <button className="hx-btn solidred" disabled={busy} onClick={() => void submit()}>Yes, submit</button>
            <button className="hx-btn o" onClick={() => setConfirm(false)}>Not now</button>
          </>
        )}
      </div>
    </div>
  )
}

/** The chain as a stepper. Retention parks it: the walked stages stay done and
 *  the hold is appended, because the chain is paused rather than advanced. */
/** "Aditya Iyer · STC9054 · Assistant Manager" */
const who = (p?: { full_name?: string | null; emp_code?: string | null; designation?: string | null } | null) =>
  p?.full_name ? [p.full_name, p.emp_code, p.designation].filter(Boolean).join(' · ') : ''

function Timeline({ status, chain, approvers }: { status: string; chain: ChainRow[]; approvers: Record<string, StageApprover | null> }) {
  const byStage: Record<string, ChainRow> = {}
  // The last row per stage (STAMPED first, then the decision); the decision wins.
  for (const c of chain) if (!byStage[c.stage] || c.action !== 'STAMPED') byStage[c.stage] = c
  const curIdx = STAGE_ORDER.indexOf(status)
  const hold = status === 'RETENTION_HOLD'

  return (
    <div className="hx-tl">
      {STAGE_ORDER.map((stg, i) => {
        const c = byStage[stg]
        const key = stg.replace('PENDING_', '')
        const decided = c && c.action !== 'STAMPED'
        const skipped = c?.action === 'SKIPPED'
        const cls = hold ? (decided ? 'done' : '') : i < curIdx ? 'done' : i === curIdx ? 'cur' : ''
        // Who this stage is with: the person who acted, else the one it is stamped to / resolves to.
        const person = decided && c.approver?.full_name ? c.approver : (c?.approver?.full_name ? c.approver : approvers[key])
        const act = skipped
          ? `skipped${c?.note ? ` · ${c.note.toLowerCase()}` : ''}`
          : decided
            ? `${c.action.toLowerCase().replace(/_/g, ' ')}${c.proposed_lwd ? ` · LWD ${fmtDate(c.proposed_lwd)}` : ''}`
            : (i === curIdx && !hold ? 'pending acknowledgement' : 'upcoming')
        const when = decided ? fmtDateTime(c.actioned_at) : (i === curIdx && !hold ? 'waiting now' : '')
        return (
          <div className={`hx-tl-item ${cls} hx-rise`} style={riseStyle(i)} key={stg}>
            <span className="hx-tl-dot">{cls === 'done' && <Ic k="check" sw={2.2} />}</span>
            <div className="st">{STAGE_LABEL[stg]}</div>
            {!skipped && <div className="ac" style={{ fontWeight: 600, color: 'var(--ez-ink)' }}>{who(person) || 'nobody assigned yet'}</div>}
            <div className="ac">{act}</div>
            {when && <div className="tm">{when}</div>}
            {decided && !skipped && c.note && <div className="nt">“{c.note}”</div>}
          </div>
        )
      })}
      {hold && (
        <div className="hx-tl-item cur hx-rise" style={riseStyle(STAGE_ORDER.length)}>
          <span className="hx-tl-dot" />
          <div className="st">{STAGE_LABEL.RETENTION_HOLD}</div>
          <div className="ac">chain paused: your manager wants to talk</div>
        </div>
      )}
    </div>
  )
}
