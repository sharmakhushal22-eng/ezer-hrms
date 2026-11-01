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
import { fmtDate, fmtDateTime, riseStyle, useToast } from './ui'
import { MyExitDocuments } from './ExitFnf'

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
/** The stages the timeline walks, in order: L1, then HR (migration 208). L2 / HOD appear only on
 *  an older resignation where they had already acted. */
const STAGE_ORDER = ['PENDING_RM_L1', 'PENDING_HR_MANAGER']
const ALL_STAGES = ['PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER']
const CLOSED = ['SETTLED', 'WITHDRAWN']

/** HR Services → Exit: the employee's own exit. Exiting somebody else is the red Exit button on
 *  People → Employees → employee → HR Actions (components/employees/HrExitSection). */
export function ExitProcess({ api }: { api: (path: string, init?: RequestInit) => Promise<any> }) {
  return <OwnExit api={api} />
}

function OwnExit({ api }: { api: (path: string, init?: RequestInit) => Promise<any> }) {
  const [d, setD] = useState<ResignationState | null>(null)
  const [err, setErr] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  // The employee's proposed last working day: starts at the policy date (resignation + notice).
  const [tentative, setTentative] = useState('')
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
  const policyLwd = (() => { const t = new Date(`${date}T00:00:00Z`); if (isNaN(t.getTime())) return ''; t.setUTCDate(t.getUTCDate() + (Number(d.notice_period_days) || 0)); return t.toISOString().slice(0, 10) })()
  const tentativeLwd = tentative || policyLwd
  const tentativeBad = !tentativeLwd ? 'Enter your tentative last working day.' : tentativeLwd < date ? 'It cannot be before the date of resignation.' : ''

  async function submit() {
    setBusy(true)
    try {
      await api('/api/ess/resignation', { method: 'POST', body: JSON.stringify({ reason_code: reason, date, remarks, tentative_lwd: tentativeLwd }) })
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
      { k: 'Notice period', v: `${cur.notice_period_days ?? '-'} days`, note: Number(cur.notice_waived_days) > 0 ? `${cur.notice_waived_days} days waived by HR` : undefined },
      ...(cur.tentative_lwd ? [{ k: 'Your tentative LWD', v: fmtDate(cur.tentative_lwd), note: 'what you proposed' }] : []),
      { k: 'Last working day', v: lwd ? fmtDate(lwd) : '-', note: lwdNote },
    ] as { k: string; v: string; tone?: string; note?: string }[]
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
        <MyExitDocuments api={api} resignationId={cur.id} />
      </>
    )
  }

  /* ----------------------------------------------------------------- form */
  return (
    <>
    {/* A settled exit keeps its F&F statement and letters downloadable (12 months, spec §11.2). */}
    {cur?.status === 'SETTLED' && <MyExitDocuments api={api} resignationId={cur.id} />}
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
        <div>
          <label className="hx-label">Tentative last working day *</label>
          <input type="date" className="hx-input" value={tentativeLwd} min={date} onChange={e => { setTentative(e.target.value); setConfirm(false) }}
            style={tentativeBad ? { borderColor: 'var(--ez-critical)' } : undefined} />
          <div style={{ fontSize: 11.5, marginTop: 4, color: tentativeBad ? 'var(--ez-critical)' : 'var(--ez-muted)' }}>
            {tentativeBad || (policyLwd && tentativeLwd !== policyLwd
              ? `As per your notice period it would be ${fmtDate(policyLwd)}. ${tentativeLwd < policyLwd ? 'An earlier date may mean notice recovery, unless HR waives it.' : ''}`
              : 'As per your notice period. Your approvers see it and confirm their own date.')}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="hx-label">Anything you want to say (optional)</label>
        <textarea className="hx-area" value={remarks} placeholder="Share context for your manager and HR…"
          onChange={e => setRemarks(e.target.value)} />
      </div>
      <div className="hx-note w" style={{ marginTop: 12 }}>
        Your notice period: <b>{d.notice_period_days ?? '-'} days</b>{(d as any).on_probation ? ' (on probation)' : ' (confirmed)'}. Submitting starts the approval
        chain: your reporting manager approves it with a last working day (seeing your tentative date), then HR sets the final last working day.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {!confirm ? (
          <button className="hx-btn" disabled={!reason || !!tentativeBad} onClick={() => setConfirm(true)}>Submit resignation</button>
        ) : (
          <>
            <button className="hx-btn solidred" disabled={busy} onClick={() => void submit()}>Yes, submit</button>
            <button className="hx-btn o" onClick={() => setConfirm(false)}>Not now</button>
          </>
        )}
      </div>
    </div>
    </>
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
  const stages = ALL_STAGES.filter(st => STAGE_ORDER.includes(st) || st === status
    || (byStage[st.replace('PENDING_', '')] && !['SKIPPED', 'STAMPED'].includes(byStage[st.replace('PENDING_', '')].action)))
  const curIdx = stages.indexOf(status)
  const hold = status === 'RETENTION_HOLD'

  return (
    <div className="hx-tl">
      {stages.map((stg, i) => {
        const c = byStage[stg.replace('PENDING_', '')] || byStage[stg]
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
        <div className="hx-tl-item cur hx-rise" style={riseStyle(stages.length)}>
          <span className="hx-tl-dot" />
          <div className="st">{STAGE_LABEL.RETENTION_HOLD}</div>
          <div className="ac">chain paused: your manager wants to talk</div>
        </div>
      )}
    </div>
  )
}
