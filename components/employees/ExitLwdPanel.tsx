'use client'
// components/employees/ExitLwdPanel.tsx — People → Employees → employee → HR Actions, under Exit:
// an approved exit's last working day and notice (app/api/exit/lwd, lib/exit/lwd.ts).
//   • the dates: resigned on, the employee's tentative LWD, the LWD as per notice, the final LWD
//   • the notice: period, waived days (and why), the shortfall still recovered
//   • the HR Manager: Change last working day (until it has passed) and Waive notice period
//   • every change of the LWD, with who, when and why
// Shown only when the employee has an approved exit; everyone with HR Actions sees it, only the
// HR Manager gets the buttons.
import { useCallback, useEffect, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { Button, Badge as Chip, C, F, W, S, R, E, inputStyle } from '@/lib/ui'

type Change = { from: string | null; to: string; reason: string | null; by_name: string | null; at: string }
type Res = {
  id: string; status: string; reason: string | null; submitted_by_employee: boolean
  date_of_resignation: string | null; notice_period_days: number | null; lwd_as_per_policy: string | null
  tentative_lwd: string | null; final_lwd: string; notice_shortfall_days: number
  notice_waived_days: number; notice_waiver_reason: string | null; notice_waived_by_name: string | null; notice_waived_at: string | null
  lwd_history: Change[]
}
type State = { can_manage: boolean; today: string; resignation: Res | null }

async function call(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init?.headers || {}) }, cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}
const fmt = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-'
const inp: React.CSSProperties = { ...inputStyle(), height: 36, width: '100%', boxSizing: 'border-box' }

function Fact({ k, v, sub, tone }: { k: string; v: string; sub?: string | null; tone?: string }) {
  return (
    <div style={{ background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>
      <div style={{ fontSize: F.tiny, color: C.muted, fontWeight: W.semi }}>{k}</div>
      <div style={{ fontSize: F.small, color: tone || C.ink, fontWeight: W.semi, marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: F.tiny, color: C.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export default function ExitLwdPanel({ employeeId, onChanged }: { employeeId: string; onChanged?: () => void }) {
  const [st, setSt] = useState<State | null>(null)
  const [mode, setMode] = useState<'lwd' | 'waive' | null>(null)
  const [lwd, setLwd] = useState('')
  const [days, setDays] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(() => call(`/api/exit/lwd?employee_id=${encodeURIComponent(employeeId)}`).then(setSt).catch(() => setSt(null)), [employeeId])
  useEffect(() => { setMode(null); setMsg(''); setErr(''); load() }, [load])

  const r = st?.resignation
  if (!st || !r) return null
  const editable = r.final_lwd >= st.today
  const notice = Number(r.notice_period_days) || 0
  const open = (m: 'lwd' | 'waive') => { setMode(m); setErr(''); setMsg(''); setReason(m === 'waive' ? (r.notice_waiver_reason || '') : ''); setLwd(r.final_lwd); setDays(String(r.notice_waived_days || notice)) }
  const save = async () => {
    setBusy(true); setErr('')
    try {
      const body = mode === 'lwd' ? { action: 'update_lwd', resignation_id: r.id, lwd, reason } : { action: 'waive', resignation_id: r.id, days: Number(days), reason }
      const j = await call('/api/exit/lwd', { method: 'POST', body: JSON.stringify(body) })
      setMsg(mode === 'lwd' ? `Last working day changed to ${fmt(lwd)}.${j.fnf_note ? ` ${j.fnf_note}` : ''}` : Number(days) ? `${Number(days) >= notice ? 'Whole notice period' : `${days} notice days`} waived.${j.fnf_note ? ` ${j.fnf_note}` : ''}` : `Notice waiver removed.${j.fnf_note ? ` ${j.fnf_note}` : ''}`)
      setMode(null); await load(); onChanged?.()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const short = Number(r.notice_shortfall_days) || 0

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, marginBottom: S.md, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.md, padding: `${S.lg}px ${S.lg + 2}px ${S.md}px`, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: F.lead, fontWeight: W.bold, color: C.ink }}>Last working day &amp; notice</div>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
            {r.submitted_by_employee ? 'Resignation filed by the employee' : 'Exit started by HR'}{r.reason ? ` · ${r.reason}` : ''}. {st.can_manage ? (editable ? 'You can change the last working day until it has passed, and waive the notice period.' : 'The last working day has passed.') : 'Only the HR Manager can change these.'}
          </div>
        </div>
        <Chip t={editable ? 'warning' : 'neutral'} dot>{editable ? `Leaves ${fmt(r.final_lwd)}` : `Left ${fmt(r.final_lwd)}`}</Chip>
      </div>

      <div style={{ padding: `0 ${S.lg + 2}px ${S.lg}px` }}>
        {msg && <div style={{ marginBottom: S.md, fontSize: F.small, color: C.positive, background: C.positiveTint, border: `1px solid ${C.positiveEdge}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>{msg}</div>}
        {err && <div style={{ marginBottom: S.md, fontSize: F.small, color: C.critical, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>{err}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: S.sm, marginBottom: S.md }}>
          <Fact k="Resigned on" v={fmt(r.date_of_resignation)} />
          {r.tentative_lwd && <Fact k="Employee’s tentative LWD" v={fmt(r.tentative_lwd)} />}
          <Fact k="LWD as per notice" v={fmt(r.lwd_as_per_policy)} sub={`${notice} days notice`} />
          <Fact k="Final last working day" v={fmt(r.final_lwd)} tone={C.brand} />
          <Fact k="Notice waived" v={r.notice_waived_days ? `${r.notice_waived_days} of ${notice} days` : 'None'} sub={r.notice_waived_by_name ? `by ${r.notice_waived_by_name}` : null} />
          <Fact k="Notice shortfall" v={short ? `${short} days` : 'None'} sub={short ? 'recovered in the F&F' : null} tone={short ? C.critical : undefined} />
        </div>
        {r.notice_waiver_reason && <div style={{ fontSize: F.small, color: C.inkSoft, marginBottom: S.md, borderLeft: `3px solid ${C.line}`, paddingLeft: S.md }}>Waiver: {r.notice_waiver_reason}</div>}

        {mode && (
          <div style={{ border: `1px solid ${C.line}`, borderRadius: R.lg, padding: S.md, marginBottom: S.md, display: 'grid', gap: S.sm }}>
            {mode === 'lwd' ? (
              <label style={{ fontSize: F.small, color: C.muted, display: 'grid', gap: 4, maxWidth: 260 }}>New last working day
                <input type="date" value={lwd} min={st.today} onChange={e => setLwd(e.target.value)} style={inp} /></label>
            ) : (
              <div style={{ display: 'flex', gap: S.sm, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={{ fontSize: F.small, color: C.muted, display: 'grid', gap: 4, width: 160 }}>Days to waive (of {notice})
                  <input inputMode="numeric" value={days} onChange={e => setDays(e.target.value.replace(/[^0-9]/g, ''))} style={inp} /></label>
                <Button onClick={() => setDays(String(notice))}>Whole notice</Button>
                {r.notice_waived_days > 0 && <Button onClick={() => setDays('0')}>Remove waiver</Button>}
              </div>
            )}
            <textarea style={{ ...inp, height: 'auto', minHeight: 56, padding: '8px 10px', resize: 'vertical' }} value={reason} onChange={e => setReason(e.target.value)}
              placeholder={mode === 'lwd' ? 'Reason for the change (required; the employee sees it)' : 'Reason for the waiver'} />
            <div style={{ display: 'flex', gap: S.sm, justifyContent: 'flex-end' }}>
              <Button onClick={() => setMode(null)} disabled={busy}>Back</Button>
              <Button variant="primary" onClick={save} disabled={busy || (mode === 'lwd' ? !lwd || !reason.trim() : days === '')}>{busy ? '…' : mode === 'lwd' ? 'Save last working day' : 'Save waiver'}</Button>
            </div>
          </div>
        )}

        {st.can_manage && editable && !mode && (
          <div style={{ display: 'flex', gap: S.sm, justifyContent: 'flex-end', flexWrap: 'wrap', marginBottom: r.lwd_history.length ? S.md : 0 }}>
            <Button onClick={() => open('waive')}>{r.notice_waived_days ? 'Edit notice waiver' : 'Waive notice period'}</Button>
            <Button variant="primary" onClick={() => open('lwd')}>Change last working day</Button>
          </div>
        )}

        {r.lwd_history.length > 0 && (
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: S.md }}>
            <div style={{ fontSize: F.tiny, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: S.sm }}>Changes to the last working day</div>
            {[...r.lwd_history].reverse().map((h, i) => (
              <div key={i} style={{ fontSize: F.small, color: C.ink, padding: '5px 0', borderBottom: i < r.lwd_history.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                <b>{fmt(h.from)} → {fmt(h.to)}</b> <span style={{ color: C.muted }}>· {h.by_name || 'HR'} · {new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                {h.reason && <div style={{ color: C.inkSoft, fontSize: F.tiny, marginTop: 1 }}>{h.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
