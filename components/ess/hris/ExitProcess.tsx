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
import type { ChainRow, ResignationRecord, ResignationState } from './types'
import { Ic } from './icons'
import { fmtDate, fmtDateTime, riseStyle, useToast } from './ui'

const STAGE_LABEL: Record<string, string> = {
  INITIATED: 'Initiated by HR',
  PENDING_RM_L1: 'With your reporting manager',
  PENDING_RM_L2: 'With your L2 manager',
  PENDING_HOD: 'With your head of department',
  PENDING_HR_MANAGER: 'With HR — final last working day',
  RETENTION_HOLD: 'On hold — your manager wants to talk',
  RECOVERY_PENDING: 'Accepted — notice recovery pending',
  SETTLED: 'Settled',
  WITHDRAWN: 'Withdrawn',
}
/** The four the timeline walks, in order. */
const STAGE_ORDER = ['PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER']
const CLOSED = ['SETTLED', 'WITHDRAWN']

export function ExitProcess({ api }: { api: (path: string, init?: RequestInit) => Promise<any> }) {
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
      { k: 'Notice period', v: `${cur.notice_period_days ?? '—'} days` },
      { k: 'Last working day', v: lwd ? fmtDate(lwd) : '—', note: lwdNote },
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
            Reason: <b style={{ color: 'var(--ez-ink)' }}>{cur.exit_reason_master?.label || cur.reason_code || '—'}</b>
          </div>
          <div className="hx-sec" style={{ marginBottom: 10 }}><h2 style={{ fontSize: 12.5 }}>Acknowledgement chain</h2></div>
          <Timeline status={cur.status} chain={d.chain || []} />
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
        Notice period on record: <b>{d.notice_period_days ?? '—'} days</b>. Submitting starts the acknowledgement
        chain — your reporting manager first, then L2 / HOD, then HR sets the final last working day.
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
function Timeline({ status, chain }: { status: string; chain: ChainRow[] }) {
  const byStage: Record<string, ChainRow> = {}
  for (const c of chain) byStage[c.stage] = c
  const curIdx = STAGE_ORDER.indexOf(status)
  const hold = status === 'RETENTION_HOLD'

  return (
    <div className="hx-tl">
      {STAGE_ORDER.map((stg, i) => {
        const c = byStage[stg]
        const cls = hold ? (c ? 'done' : '') : i < curIdx ? 'done' : i === curIdx ? 'cur' : ''
        const act = c
          ? `${c.action.toLowerCase().replace(/_/g, ' ')}${c.approver?.full_name ? ` · ${c.approver.full_name}` : ''}${c.proposed_lwd ? ` · LWD ${fmtDate(c.proposed_lwd)}` : ''}`
          : (i === curIdx && !hold ? 'pending acknowledgement' : 'upcoming')
        const when = c ? fmtDateTime(c.actioned_at) : (i === curIdx && !hold ? 'waiting now' : '')
        return (
          <div className={`hx-tl-item ${cls} hx-rise`} style={riseStyle(i)} key={stg}>
            <span className="hx-tl-dot">{cls === 'done' && <Ic k="check" sw={2.2} />}</span>
            <div className="st">{STAGE_LABEL[stg]}</div>
            <div className="ac">{act}</div>
            {when && <div className="tm">{when}</div>}
            {c?.note && <div className="nt">“{c.note}”</div>}
          </div>
        )
      })}
      {hold && (
        <div className="hx-tl-item cur hx-rise" style={riseStyle(STAGE_ORDER.length)}>
          <span className="hx-tl-dot" />
          <div className="st">{STAGE_LABEL.RETENTION_HOLD}</div>
          <div className="ac">chain paused — your manager wants to talk</div>
        </div>
      )}
    </div>
  )
}
