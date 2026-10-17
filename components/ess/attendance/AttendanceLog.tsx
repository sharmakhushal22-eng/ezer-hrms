'use client'
// components/ess/attendance/AttendanceLog.tsx — the day-by-day attendance list,
// and regularising from it.
//
// WHY A LIST. The calendar answers "how is my month going"; it is the wrong
// shape for "which days do I need to fix". This is the table every HR system
// has: pick a range, see each day's shift, expected and actual times, hours and
// status, filter by status, tick the days to correct — any days, not only a run
// of them — and send them for approval in one go, each with its own times.
//
// Everything comes from GET /api/ess/attendance?from=&to= (the same `kind` the
// calendar shows) and goes to POST /api/ess/attendance as `days`, so the list,
// the calendar and the approver's card all describe a day the same way.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { C, F, W, S, R, E, eyebrow, inputStyle } from '@/lib/ui'
import { api } from '@/lib/ess/api'
import { loadAttendanceRange, type AttendanceDay, type DayKind, type AttendanceRange } from '@/lib/supabase-attendance'

// ── One visual language for a day, shared with the calendar ─────────────────
export interface KindMeta { label: string; code: string; fg: string; bg: string; bar: string }
export const KIND_META: Record<DayKind, KindMeta> = {
  PRESENT:     { label: 'Present',          code: 'P',  fg: C.positive,  bg: C.positiveTint, bar: C.positive },
  LATE:        { label: 'Late',             code: 'LT', fg: C.warning,   bg: C.positiveTint, bar: C.positive },
  HALF_DAY:    { label: 'Half day',         code: '½',  fg: C.warning,   bg: C.warningTint,  bar: C.warning },
  MISS_IN:     { label: 'Missed punch-in',  code: 'MI', fg: C.critical,  bg: C.warningTint,  bar: C.critical },
  MISS_OUT:    { label: 'Missed punch-out', code: 'MO', fg: C.critical,  bg: C.warningTint,  bar: C.critical },
  IN_PROGRESS: { label: 'At work now',      code: '●',  fg: C.info,      bg: C.infoTint,     bar: C.info },
  ABSENT:      { label: 'Absent',           code: 'A',  fg: C.critical,  bg: C.criticalTint, bar: C.critical },
  LEAVE:       { label: 'Leave',            code: 'L',  fg: C.brandDeep, bg: C.brandTint,    bar: C.brand },
  HALF_LEAVE:  { label: 'Half-day leave',   code: '½L', fg: C.brandDeep, bg: C.brandTint,    bar: C.brand },
  HOLIDAY:     { label: 'Holiday',          code: 'H',  fg: C.info,      bg: C.infoTint,     bar: C.info },
  WEEKLY_OFF:  { label: 'Weekly off',       code: 'WO', fg: C.faint,     bg: C.sunken,       bar: C.lineStrong },
  UPCOMING:    { label: '—',                code: '',   fg: C.faint,     bg: 'transparent',  bar: C.line },
}

/** A small status pill: the colour is never the only signal — the words are there. */
export function KindBadge({ day, compact }: { day: Pick<AttendanceDay, 'kind' | 'leave' | 'note' | 'late_minutes'>; compact?: boolean }) {
  const m = KIND_META[day.kind]
  const extra = day.kind === 'LEAVE' || day.kind === 'HALF_LEAVE' ? (day.leave?.short_name ? ` · ${day.leave.short_name}` : '')
    : day.kind === 'LATE' && day.late_minutes ? ` · ${day.late_minutes}m`
    : day.kind === 'HOLIDAY' && day.note && !compact ? ` · ${day.note}` : ''
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: R.pill,
                   background: m.bg, color: m.fg, fontSize: F.micro, fontWeight: W.semi, whiteSpace: 'nowrap',
                   border: `1px solid ${m.bar === C.line ? C.line : 'transparent'}` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.bar }} />
      {m.label}{extra}
    </span>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const istClock = (ts: string | null) => ts
  ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
  : null
const hours = (m: number | null) => m == null || m <= 0 ? '—' : `${Math.floor(m / 60)}h ${pad(m % 60)}m`
const dayLabel = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })
const MAX_DAYS = 62

type Preset = 'week' | 'month' | 'last' | 'custom'
type Filter = 'ALL' | 'ATTENTION' | DayKind

/** A day that can be put up for correction, or why not. */
function selectable(d: AttendanceDay, today: string): { ok: boolean; why?: string } {
  if (d.date >= today) return { ok: false, why: d.date === today ? 'Today is not over yet' : 'This day has not happened yet' }
  if (d.kind === 'HOLIDAY' || d.kind === 'WEEKLY_OFF') return { ok: false, why: `${KIND_META[d.kind].label} — nothing to correct` }
  if (d.kind === 'LEAVE') return { ok: false, why: 'On approved leave' }
  if (d.correction?.status === 'PENDING') return { ok: false, why: `A correction is already waiting${d.correction.waiting_on ? ` on ${d.correction.waiting_on.name}` : ''}` }
  if (d.correction?.status === 'APPROVED' || d.regularised) return { ok: false, why: 'Already regularised' }
  return { ok: true }
}
const NEEDS_ATTENTION: DayKind[] = ['ABSENT', 'MISS_IN', 'MISS_OUT', 'HALF_DAY', 'LATE']

/** The times to propose for a day: what was recorded where it was, the shift where it was not. */
function proposed(d: AttendanceDay): { in: string; out: string } {
  return {
    in: istClock(d.work_in) ?? d.expected_in ?? '09:00',
    out: istClock(d.work_out) ?? d.expected_out ?? '18:00',
  }
}

// ═══════════════════════════════════════════════════════════════════════════
export default function AttendanceLog({ empId, isMobile, onFiled }: {
  empId: string
  isMobile: boolean
  /** Called after a submission, so the calendar and "My requests" refresh too. */
  onFiled?: () => void
}) {
  const todayLocal = ymd(new Date())
  const [preset, setPreset] = useState<Preset>('month')
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: addDays(todayLocal, -13), to: todayLocal })
  const range = useMemo(() => {
    if (preset === 'week') return { from: addDays(todayLocal, -6), to: todayLocal }
    if (preset === 'month') return { from: todayLocal.slice(0, 8) + '01', to: todayLocal }
    if (preset === 'last') {
      const d = new Date(todayLocal + 'T00:00:00'); d.setDate(1); d.setDate(0)       // last day of previous month
      const to = ymd(d); return { from: to.slice(0, 8) + '01', to }
    }
    return custom
  }, [preset, custom, todayLocal])
  const rangeError = range.from > range.to ? 'The start date is after the end date.'
    : (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1 > MAX_DAYS ? `Pick at most ${MAX_DAYS} days at a time.` : ''

  const [data, setData] = useState<AttendanceRange | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('ALL')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [review, setReview] = useState(false)

  // Bumped to re-read the same range (after a submission, or "Try again").
  const [nonce, setNonce] = useState(0)
  const load = useCallback(() => setNonce(n => n + 1), [])
  useEffect(() => {
    if (rangeError) return
    let alive = true
    loadAttendanceRange(empId, range.from, range.to).then(r => {
      if (!alive) return
      setData(r); setErr('')
      // Keep only picks that are still in range and still pickable.
      setPicked(p => new Set([...p].filter(dt => r.days.some(d => d.date === dt && selectable(d, r.today).ok))))
    }).catch(e => { if (alive) setErr((e as Error).message || 'Could not load attendance') })
    return () => { alive = false }
  }, [empId, range.from, range.to, rangeError, nonce])
  // Loading = what is on screen is not yet the range that was asked for.
  const loading = !rangeError && !err && (!data || data.from !== range.from || data.to !== range.to)

  const today = data?.today ?? todayLocal
  const days = useMemo(() => [...(data?.days || [])].reverse(), [data])     // newest first
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const d of days) c[d.kind] = (c[d.kind] || 0) + 1
    c.ATTENTION = days.filter(d => NEEDS_ATTENTION.includes(d.kind) && selectable(d, today).ok).length
    return c
  }, [days, today])
  const shown = days.filter(d => filter === 'ALL' ? true
    : filter === 'ATTENTION' ? NEEDS_ATTENTION.includes(d.kind) && selectable(d, today).ok
    : d.kind === filter)
  const shownPickable = shown.filter(d => selectable(d, today).ok)
  const allShownPicked = shownPickable.length > 0 && shownPickable.every(d => picked.has(d.date))

  const toggle = (date: string) => setPicked(p => { const n = new Set(p); if (n.has(date)) n.delete(date); else n.add(date); return n })
  const toggleAllShown = () => setPicked(p => {
    const n = new Set(p)
    if (allShownPicked) shownPickable.forEach(d => n.delete(d.date)); else shownPickable.forEach(d => n.add(d.date))
    return n
  })

  const chips: [Filter, string][] = [
    ['ALL', 'All'], ['ATTENTION', 'Needs attention'],
    ['PRESENT', 'Present'], ['LATE', 'Late'], ['HALF_DAY', 'Half day'],
    ['MISS_IN', 'Missed punch-in'], ['MISS_OUT', 'Missed punch-out'], ['ABSENT', 'Absent'],
    ['LEAVE', 'Leave'], ['HALF_LEAVE', 'Half-day leave'], ['WEEKLY_OFF', 'Weekly off'], ['HOLIDAY', 'Holiday'],
  ]

  // ── styles ──
  // Same card as the rest of ESS: 18px corners, a hairline, soft depth.
  const card: React.CSSProperties = { background: C.surface, borderRadius: 18, border: `1px solid ${C.line}`, padding: '18px 20px', marginBottom: S.md, boxShadow: 'var(--ess-shadow, none)' }
  const seg = (on: boolean): React.CSSProperties => ({
    height: 32, padding: '0 12px', borderRadius: R.md, cursor: 'pointer', fontFamily: 'inherit', fontSize: F.tiny, fontWeight: W.semi,
    border: `1px solid ${on ? 'transparent' : C.line}`, background: on ? 'var(--ess-grad, var(--ez-brand))' : C.surface, color: on ? C.onAccent : C.inkSoft, boxShadow: on ? '0 6px 14px -8px var(--ess-a2, transparent)' : 'none',
  })
  const chip = (on: boolean, tone?: KindMeta): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: R.pill, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: F.tiny, fontWeight: W.semi, whiteSpace: 'nowrap',
    border: `1px solid ${on ? (tone?.bar ?? C.brand) : C.line}`,
    background: on ? (tone?.bg ?? C.brandTint) : C.surface, color: on ? (tone?.fg ?? C.brandDeep) : C.inkSoft,
  })
  const th: React.CSSProperties = { ...eyebrow, textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${C.line}`, background: C.sunken, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 10px', borderBottom: `1px solid ${C.line}`, fontSize: F.small, color: C.ink, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }

  const cell = (v: string | null, expected?: string | null) => v
    ? <span>{v}</span>
    : <span style={{ color: expected ? C.critical : C.faint }}>{expected ? 'missing' : '—'}</span>

  const correctionCell = (d: AttendanceDay) => {
    const c = d.correction
    if (c?.status === 'PENDING') return <span style={{ color: C.warning, fontSize: F.tiny }}>Pending{c.waiting_on ? ` · ${c.waiting_on.name}` : ''}</span>
    if (c?.status === 'APPROVED' || d.regularised) return <span style={{ color: C.positive, fontSize: F.tiny }}>Regularised{c?.decided_by ? ` · ${c.decided_by}` : ''}</span>
    if (c?.status === 'REJECTED') return <span title={c.review_remark || ''} style={{ color: C.critical, fontSize: F.tiny }}>Declined{c.decided_by ? ` · ${c.decided_by}` : ''}</span>
    return <span style={{ color: C.faint, fontSize: F.tiny }}>—</span>
  }

  const pickedDays = days.filter(d => picked.has(d.date)).sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div style={card}>
      {/* ── header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.md, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: S.md }}>
        <div>
          <div style={{ fontSize: F.lead, fontWeight: W.bold, color: C.ink }}>Attendance log</div>
          <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>
            Every day in the range. Tick the days to correct — any days, they need not be in a row — and send them for approval together.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Date range">
          {([['week', 'Last 7 days'], ['month', 'This month'], ['last', 'Last month'], ['custom', 'Custom']] as [Preset, string][]).map(([k, l]) => (
            <button key={k} type="button" style={seg(preset === k)} aria-pressed={preset === k} onClick={() => setPreset(k)}>{l}</button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: S.md }}>
          <label style={{ fontSize: F.tiny, color: C.muted }}>From
            <input type="date" value={custom.from} max={todayLocal} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))}
              style={{ ...inputStyle(), display: 'block', marginTop: 3, width: 160 }} />
          </label>
          <label style={{ fontSize: F.tiny, color: C.muted }}>To
            <input type="date" value={custom.to} max={todayLocal} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))}
              style={{ ...inputStyle(), display: 'block', marginTop: 3, width: 160 }} />
          </label>
          <span style={{ fontSize: F.tiny, color: C.faint, paddingBottom: 8 }}>Up to {MAX_DAYS} days.</span>
        </div>
      )}

      {/* ── filters ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: isMobile ? 'nowrap' : 'wrap', overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 4 : 0, marginBottom: S.md }}>
        {chips.filter(([k]) => k === 'ALL' || (counts[k] || 0) > 0).map(([k, l]) => {
          const meta = k === 'ALL' || k === 'ATTENTION' ? undefined : KIND_META[k]
          return (
            <button key={k} type="button" style={chip(filter === k, meta)} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {meta && <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.bar }} />}
              {l}
              <b style={{ fontWeight: W.bold }}>{k === 'ALL' ? days.length : counts[k] || 0}</b>
            </button>
          )
        })}
      </div>

      {rangeError && <div style={{ fontSize: F.tiny, color: C.critical, marginBottom: S.sm }}>{rangeError}</div>}
      {err && <div style={{ fontSize: F.tiny, color: C.critical, marginBottom: S.sm }}>{err} <button type="button" onClick={() => void load()} style={{ ...seg(false), height: 26 }}>Try again</button></div>}

      {/* ── the list ── */}
      {!data && loading && <div style={{ fontSize: F.tiny, color: C.faint, padding: '18px 0' }}>Loading attendance…</div>}
      {data && shown.length === 0 && (
        <div style={{ fontSize: F.tiny, color: C.faint, padding: '18px 0', textAlign: 'center' }}>
          {filter === 'ATTENTION' ? 'Nothing needs correcting in this range.' : 'No days match this filter.'}
        </div>
      )}

      {data && shown.length > 0 && !isMobile && (
        <div style={{ overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: 14, opacity: loading ? .6 : 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 36 }}>
                  <input type="checkbox" checked={allShownPicked} disabled={!shownPickable.length} onChange={toggleAllShown}
                    aria-label="Select every correctable day shown" />
                </th>
                <th style={th}>Date</th><th style={th}>Shift</th>
                <th style={th}>Expected in</th><th style={th}>Actual in</th>
                <th style={th}>Expected out</th><th style={th}>Actual out</th>
                <th style={th}>Work hours</th><th style={th}>Status</th><th style={th}>Correction</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(d => {
                const s = selectable(d, today)
                const off = d.kind === 'WEEKLY_OFF' || d.kind === 'HOLIDAY' || d.kind === 'LEAVE' || d.kind === 'UPCOMING'
                const on = picked.has(d.date)
                return (
                  <tr key={d.date} onClick={() => s.ok && toggle(d.date)}
                    style={{ background: on ? C.brandTint : 'transparent', cursor: s.ok ? 'pointer' : 'default' }}>
                    <td style={td}>
                      <input type="checkbox" checked={on} disabled={!s.ok} title={s.why}
                        onClick={e => e.stopPropagation()} onChange={() => toggle(d.date)}
                        aria-label={`Select ${dayLabel(d.date)}`} />
                    </td>
                    <td style={{ ...td, fontWeight: W.semi }}>{dayLabel(d.date)}{d.date === today && <span style={{ color: C.brand, fontSize: F.micro, marginLeft: 6 }}>TODAY</span>}</td>
                    <td style={{ ...td, color: C.muted }}>{off ? (d.kind === 'WEEKLY_OFF' ? 'WO' : '—') : d.shift_code || '—'}</td>
                    <td style={{ ...td, color: C.muted }}>{off ? '—' : d.expected_in || '—'}</td>
                    <td style={td}>{off && !d.work_in ? '—' : cell(istClock(d.work_in), d.kind === 'MISS_IN' ? d.expected_in : null)}</td>
                    <td style={{ ...td, color: C.muted }}>{off ? '—' : d.expected_out || '—'}</td>
                    <td style={td}>{off && !d.work_out ? '—' : d.kind === 'IN_PROGRESS' ? <span style={{ color: C.info }}>at work</span> : cell(istClock(d.work_out), d.kind === 'MISS_OUT' ? d.expected_out : null)}</td>
                    <td style={td}>{hours(d.total_minutes)}</td>
                    <td style={td}><KindBadge day={d} /></td>
                    <td style={{ ...td, whiteSpace: 'normal', minWidth: 150 }}>{correctionCell(d)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && shown.length > 0 && isMobile && (
        <div style={{ display: 'grid', gap: S.sm, opacity: loading ? .6 : 1 }}>
          {shownPickable.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: F.tiny, color: C.muted }}>
              <input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} /> Select every correctable day shown
            </label>
          )}
          {shown.map(d => {
            const s = selectable(d, today)
            const on = picked.has(d.date)
            const off = d.kind === 'WEEKLY_OFF' || d.kind === 'HOLIDAY' || d.kind === 'LEAVE' || d.kind === 'UPCOMING'
            return (
              <label key={d.date} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: R.md,
                                           border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brandTint : C.surface,
                                           borderLeft: `3px solid ${KIND_META[d.kind].bar}`, cursor: s.ok ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={on} disabled={!s.ok} onChange={() => toggle(d.date)} style={{ marginTop: 3 }}
                  aria-label={`Select ${dayLabel(d.date)}`} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <b style={{ fontSize: F.small, color: C.ink }}>{dayLabel(d.date)}</b>
                    <KindBadge day={d} compact />
                  </span>
                  {!off && (
                    <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                      In {istClock(d.work_in) ?? '—'}{d.expected_in && <span style={{ color: C.faint }}> (exp {d.expected_in})</span>}
                      {' · '}Out {d.kind === 'IN_PROGRESS' ? 'at work' : istClock(d.work_out) ?? '—'}{d.expected_out && <span style={{ color: C.faint }}> (exp {d.expected_out})</span>}
                      {' · '}{hours(d.total_minutes)}
                    </span>
                  )}
                  {(d.correction || d.regularised) && <span style={{ display: 'block', marginTop: 3 }}>{correctionCell(d)}</span>}
                  {!s.ok && !off && !d.correction && !d.regularised && s.why && <span style={{ display: 'block', fontSize: F.micro, color: C.faint, marginTop: 3 }}>{s.why}</span>}
                </span>
              </label>
            )
          })}
        </div>
      )}

      {/* ── selection bar ── */}
      {picked.size > 0 && !review && (
        <div style={{ position: 'sticky', bottom: 8, marginTop: S.md, display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap',
                      padding: '10px 12px', borderRadius: R.md, background: C.surface, border: `1px solid ${C.brand}`, boxShadow: E.floating }}>
          <span style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{picked.size} day{picked.size === 1 ? '' : 's'} selected</span>
          <button type="button" style={{ ...seg(false), height: 30 }} onClick={() => setPicked(new Set())}>Clear</button>
          <button type="button" onClick={() => setReview(true)}
            style={{ ...seg(true), height: 34, marginLeft: 'auto', padding: '0 16px', boxShadow: E.brand }}>Regularise selected →</button>
        </div>
      )}

      {review && pickedDays.length > 0 && (
        <ReviewPanel empId={empId} days={pickedDays} isMobile={isMobile}
          onCancel={() => setReview(false)}
          onDone={() => { setReview(false); setPicked(new Set()); void load(); onFiled?.() }} />
      )}
    </div>
  )
}

// ── The review step: each day's times, one reason, submit ───────────────────
// Outside AttendanceLog on purpose: a component defined inside its parent is
// re-created on every keystroke and the time inputs lose focus.
function ReviewPanel({ empId, days, isMobile, onCancel, onDone }: {
  empId: string; days: AttendanceDay[]; isMobile: boolean
  onCancel: () => void; onDone: () => void
}) {
  const [times, setTimes] = useState<Record<string, { in: string; out: string }>>(
    () => Object.fromEntries(days.map(d => [d.date, proposed(d)])),
  )
  const [all, setAll] = useState<{ in: string; out: string }>(() => ({ in: days[0]?.expected_in || '09:00', out: days[0]?.expected_out || '18:00' }))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const bad = days.find(d => !times[d.date]?.in || !times[d.date]?.out || times[d.date].out <= times[d.date].in)
  const set = (date: string, k: 'in' | 'out', v: string) => setTimes(t => ({ ...t, [date]: { ...t[date], [k]: v } }))

  const submit = async () => {
    if (bad) { setMsg({ text: `${dayLabel(bad.date)}: the out time has to be after the in time.`, ok: false }); return }
    if (!reason.trim()) { setMsg({ text: 'Give a reason — your approver reads it.', ok: false }); return }
    setBusy(true); setMsg(null)
    try {
      const res = await api('/api/ess/attendance', empId, { method: 'POST', body: JSON.stringify({
        reason: reason.trim(),
        days: days.map(d => ({ date: d.date, requested_in: times[d.date].in, requested_out: times[d.date].out })),
      }) })
      const to = res.waiting_on as { name: string; role: string } | null
      const skipped = (res.skipped || []) as { date: string; why: string }[]
      setMsg({ ok: true, text: `✓ ${res.filed} day${res.filed === 1 ? '' : 's'} sent${to ? ` to ${to.name} (${to.role})` : ' — no approver is set for you, so HR will see it'} for approval.`
        + (skipped.length ? ` Left out: ${skipped.map(x => `${dayLabel(x.date)} (${x.why})`).join(', ')}.` : '') })
      setTimeout(onDone, 1400)
    } catch (e) {
      setMsg({ text: (e as Error).message || 'Could not submit', ok: false })
    } finally {
      setBusy(false)
    }
  }

  const time: React.CSSProperties = { ...inputStyle(), width: 108, height: 32, padding: '0 8px' }
  const btn = (primary: boolean): React.CSSProperties => ({
    height: 36, padding: '0 16px', borderRadius: R.md, cursor: 'pointer', fontFamily: 'inherit', fontSize: F.small, fontWeight: W.semi,
    border: `1px solid ${primary ? 'transparent' : C.lineStrong}`, background: primary ? 'var(--ess-grad, var(--ez-brand))' : C.surface, color: primary ? C.onAccent : C.ink,
  })

  return (
    <div style={{ marginTop: S.md, padding: '14px 14px', borderRadius: R.md, border: `1px solid ${C.brand}`, background: C.sunken }}>
      <div style={{ fontSize: F.body, fontWeight: W.bold, color: C.ink }}>Regularise {days.length} day{days.length === 1 ? '' : 's'}</div>
      <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, marginBottom: S.md }}>
        Check the times for each day — recorded punches are kept, missing ones are filled from your shift. Your reporting manager approves it, and your attendance updates when they do.
      </div>

      {days.length > 1 && (
        <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap', marginBottom: S.sm, fontSize: F.tiny, color: C.muted }}>
          Same times for all:
          <input type="time" value={all.in} onChange={e => setAll(a => ({ ...a, in: e.target.value }))} style={time} aria-label="In time for all days" />
          <input type="time" value={all.out} onChange={e => setAll(a => ({ ...a, out: e.target.value }))} style={time} aria-label="Out time for all days" />
          <button type="button" style={{ ...btn(false), height: 32 }}
            onClick={() => setTimes(Object.fromEntries(days.map(d => [d.date, { ...all }])))}>Apply to all</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 6, marginBottom: S.md }}>
        {days.map(d => (
          <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', padding: '8px 10px',
                                     borderRadius: R.sm, background: C.surface, border: `1px solid ${C.line}` }}>
            <b style={{ fontSize: F.small, minWidth: isMobile ? '100%' : 120, color: C.ink }}>{dayLabel(d.date)}</b>
            <KindBadge day={d} compact />
            <span style={{ fontSize: F.micro, color: C.faint, minWidth: 130 }}>
              {d.work_in || d.work_out ? `recorded ${istClock(d.work_in) ?? 'no in'} – ${istClock(d.work_out) ?? 'no out'}` : 'no punches recorded'}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: isMobile ? 0 : 'auto' }}>
              <input type="time" value={times[d.date]?.in || ''} onChange={e => set(d.date, 'in', e.target.value)} style={time} aria-label={`In time, ${dayLabel(d.date)}`} />
              <span style={{ color: C.faint }}>→</span>
              <input type="time" value={times[d.date]?.out || ''} onChange={e => set(d.date, 'out', e.target.value)} style={time} aria-label={`Out time, ${dayLabel(d.date)}`} />
            </span>
          </div>
        ))}
      </div>

      <label style={{ ...eyebrow, display: 'block', marginBottom: 5 }}>Reason (applies to every day) *</label>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500}
        placeholder="e.g. Forgot to punch out; biometric was down; on client visit"
        style={{ ...inputStyle(), width: '100%', resize: 'vertical', minHeight: 56, padding: '8px 10px', boxSizing: 'border-box' }} />

      {msg && <div style={{ fontSize: F.tiny, marginTop: S.sm, color: msg.ok ? C.positive : C.critical }}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: S.sm, marginTop: S.md, justifyContent: 'flex-end' }}>
        <button type="button" style={btn(false)} onClick={onCancel} disabled={busy}>Back to list</button>
        <button type="button" style={{ ...btn(true), opacity: busy ? .6 : 1 }} onClick={submit} disabled={busy}>
          {busy ? 'Sending…' : `Send ${days.length} day${days.length === 1 ? '' : 's'} for approval`}
        </button>
      </div>
    </div>
  )
}
