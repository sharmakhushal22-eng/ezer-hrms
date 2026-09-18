'use client'
// components/ess/LeaveSection.tsx — ESS Leave.
//
// WHY THIS FILE EXISTS AT ALL
//
// Leave used to be 114 lines embedded in EmployeePortal.tsx with no file of its
// own, no CSS, and no API route — the one ESS feature that talked to Supabase
// directly from the browser on the anon key, against tables carrying the house
// permissive RLS policy. `applyLeave` was a bare insert with `employee_id` taken
// from the client, so a crafted request could file leave as anybody, and the
// database trigger would route it to that person's real manager.
//
// Everything that used to be checked here is now checked in
// app/api/ess/leave/route.ts, where it cannot be bypassed. This file renders.
//
// It is also now loaded with dynamic() like the other twelve sections, so an
// employee who never opens Leave no longer downloads it.
//
// WHAT CHANGED BEHAVIOURALLY
//   * four parallel Supabase calls on mount   → one GET
//   * HALF_DAY_TYPES hardcoded as ['EL','CL','SL','LWP','CP']
//                                             → each type's own allow_half_day
//   * every type offered to everybody (Maternity Leave included)
//                                             → ineligible types disabled, with the reason
//   * `remark` fetched and never shown        → the approver's note is displayed
//   * CANCELLED styled but unreachable        → a Cancel control exists
//   * empty card = "you have nothing"         → says WHY it is empty
import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '@/lib/ess/api'
import { C, F, W, R, S, E, eyebrow, inputStyle } from '@/lib/ui'

// Bound to the design system — identical to the constant this section used
// while it lived inside EmployeePortal.tsx, so nothing shifts visually.
const T = {
  card:    { background: C.surface, borderRadius: R.lg, border: `1px solid ${C.line}`, padding: '14px 16px', marginBottom: S.md, boxShadow: E.raised } as React.CSSProperties,
  label:   { ...eyebrow, display: 'block', marginBottom: 5 } as React.CSSProperties,
  input:   { ...inputStyle() } as React.CSSProperties,
  btnP:    { height: 36, padding: '0 16px', borderRadius: R.md, border: `1px solid ${C.brandDeep}`, cursor: 'pointer', fontSize: F.small, fontWeight: W.semi, fontFamily: 'inherit', background: `linear-gradient(180deg, ${C.brand}, ${C.brandDeep})`, color: C.onAccent, boxShadow: E.brand } as React.CSSProperties,
  section: { ...eyebrow, marginBottom: S.md, display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
}

interface LeaveType {
  id: string; short_name: string; name: string
  allow_half_day: boolean; allow_without_balance: boolean
  available: number | null; eligible: boolean; reason: string | null
}
interface Payload {
  year: string; fyLabel: string
  balances: any[]; types: LeaveType[]; applications: any[]; holidays: any[]
  diagnostics: { noBalances: boolean; noHolidays: boolean; noApprover: boolean }
}

const BLANK = { leave_type_id: '', from_date: '', to_date: '', half_day: false, half_session: '', reason: '' }

const STATUS: Record<string, [string, string]> = {
  PENDING: [C.warningTint, C.warning], APPROVED: [C.positiveTint, C.positive],
  REJECTED: [C.criticalTint, C.critical], CANCELLED: [C.sunken, C.muted],
}
const HOL_STYLE: Record<string, [string, string]> = {
  NATIONAL: [C.infoTint, C.brand], FESTIVAL: [C.brandTint, C.muted],
  OPTIONAL: [C.warningTint, C.warning], REGIONAL: [C.brandTint, C.brand],
}

const avail = (b: any) =>
  (Number(b.opening || 0) + Number(b.accrued || 0)) - Number(b.used || 0) - Number(b.encashed || 0)
const barColor = (pct: number) => pct > 60 ? C.positive : pct > 30 ? C.warning : C.critical

export default function LeaveSection({ emp, notify }: {
  emp: { id: string }
  notify: (m: string, t?: 'success' | 'error') => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  // An empty card and a failed request used to be indistinguishable: every
  // loader discarded its error and returned `data || []`.
  const [err, setErr] = useState('')
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api('/api/ess/leave', emp.id)
      .then((d: Payload) => { setData(d); setErr('') })
      .catch(e => setErr(e.message || 'Could not load leave.'))
  }, [emp.id])

  useEffect(() => { load() }, [load])

  // Memoised, not `data?.types || []`: that literal is a fresh array on every
  // render, so the useMemo below it would recompute every time and its
  // dependency would buy nothing.
  const types = useMemo(() => data?.types || [], [data])
  const sel = useMemo(() => types.find(t => t.id === form.leave_type_id) || null, [types, form.leave_type_id])

  const submit = async () => {
    // The server re-checks all of this; these two only save a round trip on the
    // mistakes people actually make.
    if (!form.leave_type_id || !form.from_date || !form.to_date) { notify('Select leave type and dates', 'error'); return }
    if (form.half_day && !form.half_session) { notify('Select 1st half or 2nd half', 'error'); return }
    setBusy(true)
    try {
      const res = await api('/api/ess/leave', emp.id, {
        method: 'POST',
        body: JSON.stringify({
          leave_type_id: form.leave_type_id,
          from_date: form.from_date, to_date: form.to_date,
          half_day: form.half_day,
          half_session: form.half_day ? form.half_session : '',
          reason: form.reason,
        }),
      })
      // Days come back from the server, which counts WORKING days — weekly-offs
      // and mandatory holidays excluded. The old client counted calendar days,
      // so a Friday-to-Monday request was billed as four.
      notify(`Leave request submitted — ${res.days} day${res.days === 1 ? '' : 's'} ✓`)
      // An application nobody can approve produces no notification for anyone.
      // Saying so beats leaving the employee waiting on silence.
      if (res.unrouted) notify('No approver is configured for you — please tell HR.', 'error')
      setForm(BLANK)
      load()
    } catch (e: any) {
      notify(e.message || 'Could not submit', 'error')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: string) => {
    setBusy(true)
    try {
      await api('/api/ess/leave', emp.id, { method: 'PATCH', body: JSON.stringify({ id }) })
      notify('Leave request withdrawn')
      load()
    } catch (e: any) {
      notify(e.message || 'Could not cancel', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (err) return <div style={T.card}><div style={{ fontSize: F.tiny, color: C.critical }}>{err}</div></div>
  if (!data) return <div style={T.card}><div style={{ fontSize: F.tiny, color: C.faint }}>Loading…</div></div>

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = (data.holidays || []).filter((h: any) => h.holiday_date >= today)

  return (
    <div>
      {/* ── Leave balance ─────────────────────────────────────────── */}
      <div style={T.card}>
        <div style={T.section}>Leave Balance · {data.fyLabel}</div>
        {!data.balances.length ? (
          <div style={{ fontSize: F.tiny, color: C.faint }}>
            No leave balances have been loaded for {data.fyLabel} yet — contact HR.
          </div>
        ) : data.balances.map((b: any) => {
          const total = Number(b.opening || 0) + Number(b.accrued || 0)
          const av = avail(b)
          const pct = total > 0 ? Math.round(av / total * 100) : 0
          return (
            <div key={b.id} style={{ background: C.sunken, borderRadius: R.md, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: F.small, fontWeight: W.semi }}>
                  <span style={{ fontSize: 10, background: C.brandTint, color: C.brandDeep, padding: '2px 7px', borderRadius: 99, marginRight: 6 }}>{b.leave_types?.short_name}</span>
                  {b.leave_types?.name}
                </span>
                <span style={{ fontSize: 18, fontWeight: W.bold, color: barColor(pct) }}>
                  {av}<span style={{ fontSize: F.micro, color: C.faint, fontWeight: W.regular }}> / {total}</span>
                </span>
              </div>
              <div style={{ height: 5, borderRadius: 99, background: C.line, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: barColor(pct) }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Apply ─────────────────────────────────────────────────── */}
      <div style={T.card}>
        <div style={T.section}>Apply for Leave</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={T.label}>Leave type</label>
            <select
              style={T.input} value={form.leave_type_id}
              onChange={e => setForm(f => ({ ...f, leave_type_id: e.target.value, half_day: false, half_session: '' }))}
            >
              <option value="">Select</option>
              {types.map(t => (
                // Ineligible types stay visible but disabled, with the reason —
                // gender, probation and tenure were previously not checked at
                // all, so Maternity Leave was offered to every employee.
                <option key={t.id} value={t.id} disabled={!t.eligible}>
                  {t.short_name} · {t.name}
                  {t.available != null ? ` (${t.available} left)` : ''}
                  {!t.eligible && t.reason ? ` — ${t.reason}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div><label style={T.label}>From</label>
            <input type="date" style={T.input} value={form.from_date}
              onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} /></div>
          <div><label style={T.label}>To</label>
            <input type="date" style={T.input} value={form.to_date}
              onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} /></div>

          {/* Driven by the selected type's own flag, not a hardcoded list. */}
          {sel?.allow_half_day && (
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: F.small, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.half_day}
                  onChange={e => setForm(f => ({ ...f, half_day: e.target.checked, half_session: e.target.checked ? f.half_session : '' }))} /> Half day
              </label>
              {form.half_day && (
                <div style={{ display: 'flex', gap: 18, marginTop: 8, paddingLeft: 24 }}>
                  {[['1st', '1st Half'], ['2nd', '2nd Half']].map(([val, lbl]) => (
                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: F.small, cursor: 'pointer' }}>
                      <input type="radio" name="half_session" checked={form.half_session === val}
                        onChange={() => setForm(f => ({ ...f, half_session: val }))} /> {lbl}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ gridColumn: '1/-1' }}>
            <label style={T.label}>Reason</label>
            <input style={T.input} value={form.reason} placeholder="Brief reason"
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>
        <button onClick={submit} disabled={busy} style={{ ...T.btnP, marginTop: 10, opacity: busy ? .6 : 1 }}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
        {data.diagnostics.noApprover && (
          <div style={{ marginTop: 8, fontSize: F.micro, color: C.warning }}>
            No reporting or HR manager is recorded against you, so a request may not reach anyone.
          </div>
        )}
      </div>

      {/* ── Recent requests ───────────────────────────────────────── */}
      <div style={T.card}>
        <div style={T.section}>Recent Requests</div>
        {!data.applications.length ? (
          <div style={{ fontSize: F.tiny, color: C.faint }}>No leave applications yet.</div>
        ) : data.applications.map((a: any) => {
          const [bg, c] = STATUS[a.status] || [C.sunken, C.muted]
          return (
            <div key={a.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.brandEdge}`, fontSize: F.tiny }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 10, background: C.brandTint, color: C.brandDeep, padding: '2px 7px', borderRadius: 99, fontWeight: W.semi }}>{a.leave_types?.short_name}</span>
                <span style={{ flex: 1 }}>
                  {a.from_date}{a.to_date !== a.from_date ? ` → ${a.to_date}` : ''}{a.half_day ? ' (½)' : ''}
                  <span style={{ color: C.faint }}> · {Number(a.days)} day{Number(a.days) === 1 ? '' : 's'}</span>
                </span>
                {a.status === 'PENDING' && (
                  <button onClick={() => cancel(a.id)} disabled={busy}
                    style={{ height: 24, padding: '0 9px', borderRadius: R.sm, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.muted, fontSize: 10, fontWeight: W.medium, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                )}
                <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 99, background: bg, color: c, fontWeight: W.semi }}>{a.status}</span>
              </div>
              {/* The approver's note was fetched by select('*') and never shown,
                  so a rejection reason only ever reached the employee as a
                  notification they may have already dismissed. */}
              {a.remark && (
                <div style={{ marginTop: 4, marginLeft: 44, fontSize: F.micro, color: C.muted }}>
                  {a.approver ? `${a.approver}: ` : ''}{a.remark}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Holidays ──────────────────────────────────────────────── */}
      <div style={T.card}>
        <div style={T.section}>Upcoming Holidays</div>
        {!upcoming.length ? (
          <div style={{ fontSize: F.tiny, color: C.faint }}>
            {data.diagnostics.noHolidays
              ? 'No holiday calendar has been published for your company yet.'
              : 'No upcoming holidays.'}
          </div>
        ) : upcoming.map((h: any) => {
          const [bg, c] = HOL_STYLE[h.holiday_type] || [C.sunken, C.muted]
          return (
            <div key={h.holiday_date + h.description} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.brandEdge}`, fontSize: F.tiny }}>
              <span style={{ minWidth: 64, fontWeight: W.semi }}>
                {new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
              </span>
              <span style={{ flex: 1 }}>{h.description}</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: bg, color: c, fontWeight: W.semi }}>{h.holiday_type}</span>
              {h.is_optional && <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 99, background: C.warningTint, color: C.warning }}>Optional</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
