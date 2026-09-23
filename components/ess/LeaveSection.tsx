'use client'
// components/ess/LeaveSection.tsx — ESS Leave. REDESIGNED 18 Sep 2026.
//
// WHAT IS UNCHANGED — deliberately, all of it:
//
//   * the props            ({ emp, notify })
//   * the three calls      GET / POST / PATCH  →  /api/ess/leave via api()
//   * the POST body keys   leave_type_id, from_date, to_date, half_day,
//                          half_session, reason      ← byte-for-byte identical
//   * the PATCH body       { id }
//   * the Payload shape    balances, types, applications, holidays, diagnostics
//   * the arithmetic       avail() = (opening + accrued) − used − encashed
//                          barColor() = >60 ok, >30 warn, else critical
//   * the server contract  every eligibility rule still lives in route.ts,
//                          which re-checks everything this file shows
//
// WHAT CHANGED IS PRESENTATION ONLY. The section is no longer four identical
// cards stacked in a column; it is one saturated balance panel followed by a
// two-column working area. See REDESIGN.md for the full list.
//
// STYLING NOTE
// EZER ESS has no CSS files — every section styles with inline objects, which
// cannot express a media query, a hover state, :focus-visible or a keyframe.
// This section needs all four, so it carries its own scoped stylesheet under
// the .ezlv-* namespace. Every colour resolves against the --ez-* custom
// properties already in lib/ui/theme.css, with a literal fallback, so it
// themes with the product and follows the existing dark block.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { api } from '@/lib/ess/api'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Contract (unchanged) ───────────────────────────────────────────────────
interface LeaveType {
  id: string; short_name: string; name: string
  allow_half_day: boolean; allow_without_balance: boolean
  available: number | null; eligible: boolean; reason: string | null
}
interface Payload {
  year: string; fyLabel: string
  balances: any[]; types: LeaveType[]; applications: any[]; holidays: any[]
  // The employee's own configured weekly offs, resolved server-side from
  // weekly_off_config. `weekly_offs` is exact for a rolling year from today;
  // `weekly_off_weekdays` is the weekday fallback beyond that window.
  weekly_offs: string[]; weekly_off_weekdays: number[]
  diagnostics: { noBalances: boolean; noHolidays: boolean; noApprover: boolean; noWeeklyOffs: boolean }
}

const BLANK = { leave_type_id: '', from_date: '', to_date: '', half_day: false, half_session: '', reason: '' }

// Unchanged from the shipped component.
const avail = (b: any) =>
  (Number(b.opening || 0) + Number(b.accrued || 0)) - Number(b.used || 0) - Number(b.encashed || 0)
const barClass = (pct: number) => pct > 60 ? 'is-ok' : pct > 30 ? 'is-warn' : 'is-bad'

// ── Dates ──────────────────────────────────────────────────────────────────
// Local, not UTC. The old `new Date().toISOString().slice(0,10)` resolved the
// cutoff at 05:30 IST, so between midnight and 05:30 a holiday falling today
// still counted as upcoming. Harmless, and now simply correct.
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromIso = (s: string) => new Date(s + 'T00:00:00')
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

const dayMon = (s: string) =>
  fromIso(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
const rangeLabel = (f: string, t: string) => {
  if (!f) return ''
  if (!t || t === f) return fromIso(f).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const a = fromIso(f), b = fromIso(t)
  const same = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
  return same
    ? `${a.getDate()} – ${b.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
    : `${dayMon(f)} – ${fromIso(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
}

/**
 * The earliest date anyone may apply for. Leave starts today or later — you
 * cannot ask for time off that has already happened.
 *
 * NOTE: this is the CLIENT half of the rule. app/api/ess/leave/route.ts does
 * not enforce it (it checks only that the date is not before joining), so a
 * crafted POST can still file a backdated request. See REDESIGN.md §4.5 for
 * the server guard that closes it.
 *
 * If a type ever needs to be backdatable — sick leave applied the morning
 * after, typically — make this per-type rather than removing it.
 */
const earliestApplyDate = () => iso(new Date())

/**
 * Counts a figure up once, the first time it lands. Never on a re-render, and
 * never when the reader has asked for reduced motion.
 */
function useCountUp(target: number, live: boolean) {
  const [v, setV] = useState(target)
  const spent = useRef(false)
  useEffect(() => {
    const reduce = typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!live || spent.current || reduce || !(target > 0)) { setV(target); return }
    spent.current = true
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3)) * 2) / 2)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, live])
  return v
}

const Chevron = ({ dir }: { dir: 'l' | 'r' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points={dir === 'l' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
)
const Warn = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </svg>
)

export default function LeaveSection({ emp, notify }: {
  emp: { id: string }
  notify: (m: string, t?: 'success' | 'error') => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)

  // Presentation-only state.
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  // No mode, no armed slot. One tap is a day; a later tap extends it.
  const [hover, setHover] = useState('')
  const [focusDay, setFocusDay] = useState(() => iso(new Date()))
  const [confirmId, setConfirmId] = useState('')
  const [typeNote, setTypeNote] = useState('')
  // Motion state. `lit` flips one tick after the data lands so the balance
  // meters transition up from zero instead of appearing at full width; `dir`
  // is which way the month grid should slide in.
  const [lit, setLit] = useState(false)
  const [dir, setDir] = useState<'next' | 'prev' | ''>('')
  const gridRef = useRef<HTMLDivElement | null>(null)
  const applyRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(() => {
    api('/api/ess/leave', emp.id)
      .then((d: Payload) => { setData(d); setErr('') })
      .catch(e => setErr(e.message || 'Could not load leave.'))
  }, [emp.id])

  useEffect(() => { load() }, [load])

  const types = useMemo(() => data?.types || [], [data])
  const sel = useMemo(() => types.find(t => t.id === form.leave_type_id) || null, [types, form.leave_type_id])

  const today = iso(new Date())
  const floor = earliestApplyDate()
  const floorDate = fromIso(floor)
  // Nothing to go back to: the month holding the first selectable day is as
  // far back as the calendar goes.
  const atFloorMonth = cursor.getFullYear() === floorDate.getFullYear()
    && cursor.getMonth() === floorDate.getMonth()
  const holidays = useMemo(() => data?.holidays || [], [data])
  const upcoming = useMemo(() => holidays.filter((h: any) => h.holiday_date >= today), [holidays, today])

  // holiday_date → the row, for the calendar markers and the range estimate.
  const holByDate = useMemo(() => {
    const m = new Map<string, any>()
    for (const h of holidays) if (!m.has(h.holiday_date)) m.set(h.holiday_date, h)
    return m
  }, [holidays])

  // ── Weekly offs, from the configuration rather than from an assumption ───
  //
  // This file used to carry `const WEEKLY_OFF_DOW = [0]`. It was right only
  // because the one live rule is a single global "weekday 0 / EVERY" row — the
  // moment a branch is configured for Friday, or for alternate Saturdays, the
  // calendar would have shaded days the server does not agree are offs, and the
  // estimate would have disagreed with the billed figure.
  //
  // The route now resolves the employee's real offs and sends them.
  const offSet = useMemo(() => new Set<string>(data?.weekly_offs || []), [data])
  const offDows = useMemo(() => data?.weekly_off_weekdays || [], [data])
  const offWindowEnd = useMemo(() => iso(addDays(new Date(), 366)), [])

  /**
   * Inside the resolver's one-year window the dates are exact — which matters
   * for an NTH rule, where "2nd Saturday only" means the other Saturdays are
   * ordinary working days. Beyond it the weekday is the best available answer,
   * and the server still has the final say on submit.
   */
  const isWeeklyOff = useCallback((key: string) =>
    (key >= today && key <= offWindowEnd)
      ? offSet.has(key)
      : offDows.includes(fromIso(key).getDay()),
  [offSet, offDows, today, offWindowEnd])

  /** A day that cannot be claimed as leave: a weekly off, or any holiday.
   *  Optional holidays are included — see the note in route.ts. */
  const isNonWorking = useCallback((key: string) =>
    isWeeklyOff(key) || holByDate.has(key), [isWeeklyOff, holByDate])

  const totalAvailable = useMemo(
    () => (data?.balances || []).reduce((s: number, b: any) => s + avail(b), 0),
    [data],
  )

  const heroTotal = useCountUp(totalAvailable, !!data?.balances?.length)

  useEffect(() => {
    if (!data) return
    const t = setTimeout(() => setLit(true), 60)
    return () => clearTimeout(t)
  }, [data])

  // ── Range estimate ───────────────────────────────────────────────────────
  // NEW, and display only. The old form told the employee nothing until after
  // the POST came back; the server counts WORKING days, so a Fri→Mon request
  // that looks like four is billed as two. This previews that. It is labelled
  // an estimate because weekly-offs are resolved server-side per employee.
  const estimate = useMemo(() => {
    if (!form.from_date || !form.to_date) return null
    const a = fromIso(form.from_date), b = fromIso(form.to_date)
    if (b < a) return null
    let span = 0, offs = 0
    const hols: any[] = []
    for (let d = a; d <= b; d = addDays(d, 1)) {
      span++
      const key = iso(d)
      const h = holByDate.get(key)
      if (isWeeklyOff(key)) offs++
      else if (h) { offs++; hols.push(h) }   // optional holidays count too
    }
    const working = form.half_day ? 0.5 : Math.max(0, span - offs)
    return { span, offs, hols, working }
  }, [form.from_date, form.to_date, form.half_day, holByDate, isWeeklyOff])

  const balanceAfter = useMemo(() => {
    if (!sel || sel.available == null || !estimate) return null
    return sel.available - estimate.working
  }, [sel, estimate])

  // ── Calendar grid — rows of weeks, so a week the selection touches can
  //    carry a band of its own ─────────────────────────────────────────────
  const weeks = useMemo(() => {
    const y = cursor.getFullYear(), m = cursor.getMonth()
    const lead = new Date(y, m, 1).getDay()
    const len = new Date(y, m + 1, 0).getDate()
    const flat: (string | null)[] = []
    for (let i = 0; i < lead; i++) flat.push(null)
    for (let d = 1; d <= len; d++) flat.push(iso(new Date(y, m, d)))
    while (flat.length % 7 !== 0) flat.push(null)
    const out: (string | null)[][] = []
    for (let i = 0; i < flat.length; i += 7) out.push(flat.slice(i, i + 7))
    return out
  }, [cursor])
  const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`

  /**
   * The whole rule:
   *   the one day already chosen → clear it        (tap again to deselect)
   *   nothing chosen, or earlier → that day, start and end
   *   anything else              → move the end to it
   *
   * The last line covers both cases that matter: a later day extends the range,
   * and the start of an existing range collapses it back to a single day — from
   * which one more tap clears it. from_date and to_date are BOTH set from the
   * very first tap, so the calendar always reacts and Submit is valid at once.
   */
  const pickDay = (key: string) => {
    if (key < floor) return                       // past dates are not selectable
    // Leave may SPAN a holiday or a weekly off, but may not start or end on
    // one — you cannot claim as leave a day the company has already given you.
    // route.ts §7 enforces this; refusing the tap here means the employee finds
    // out while choosing rather than after submitting.
    if (isNonWorking(key)) {
      const h = holByDate.get(key)
      const when = fromIso(key).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
      setTypeNote(`${when} is ${h ? h.description : 'a weekly off'} — leave cannot start or end on it.`)
      return
    }
    setTypeNote('')
    setHover('')
    setForm(f => {
      if (f.from_date === key && f.to_date === key) return { ...f, from_date: '', to_date: '' }
      if (!f.from_date || key < f.from_date) return { ...f, from_date: key, to_date: key }
      return { ...f, to_date: key }
    })
  }

  /** Jump the calendar to whatever month a typed date lands in. */
  const showMonthOf = (d: string) => {
    const x = fromIso(d)
    setCursor(c => (c.getFullYear() === x.getFullYear() && c.getMonth() === x.getMonth())
      ? c : new Date(x.getFullYear(), x.getMonth(), 1))
  }

  /**
   * The two date fields write the same two values the calendar does. Clamping
   * happens here rather than being left to `min`, because `min` guards the
   * browser's picker but not a typed value.
   */
  const setStart = (v: string) => {
    if (!v) { setForm(f => ({ ...f, from_date: '', to_date: '' })); return }
    const d = v < floor ? floor : v
    setForm(f => ({ ...f, from_date: d, to_date: (!f.to_date || f.to_date < d) ? d : f.to_date }))
    showMonthOf(d)
  }
  const setEnd = (v: string) => {
    if (!v) { setForm(f => ({ ...f, to_date: f.from_date })); return }
    const d = v < floor ? floor : v
    setForm(f => ({
      ...f,
      from_date: f.from_date || d,
      to_date: (f.from_date && d < f.from_date) ? f.from_date : d,
    }))
    showMonthOf(d)
  }

  // Roving focus so the grid is one tab stop, not forty-two.
  const onGridKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key as string]
    if (step == null) return
    e.preventDefault()
    let next = addDays(fromIso(focusDay), step)
    // Arrow keys stop at the floor rather than landing on a day that cannot
    // be chosen.
    if (iso(next) < floor) next = fromIso(floor)
    setFocusDay(iso(next))
    if (next.getMonth() !== cursor.getMonth() || next.getFullYear() !== cursor.getFullYear()) {
      setDir(step > 0 ? 'next' : 'prev')
      setCursor(new Date(next.getFullYear(), next.getMonth(), 1))
    }
    requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-d="${iso(next)}"]`)?.focus()
    })
  }

  const chooseType = (t: LeaveType) => {
    if (!t.eligible) { setTypeNote(`${t.name} — ${t.reason || 'not available to you'}.`); return }
    setTypeNote('')
    // Unchanged: switching type clears any half-day flag, so a stale half-day
    // can never survive onto a type that forbids it.
    setForm(f => ({ ...f, leave_type_id: t.id, half_day: false, half_session: '' }))
  }

  // ── Submit — the payload is identical to the shipped component ───────────
  const submit = async () => {
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
      notify(`Leave request submitted — ${res.days} day${res.days === 1 ? '' : 's'} ✓`)
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
      setConfirmId('')
      load()
    } catch (e: any) {
      notify(e.message || 'Could not cancel', 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── Error / loading ──────────────────────────────────────────────────────
  if (err) {
    return (
      <div className="ezlv">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="ezlv-error">{err} <button className="ezlv-reset" onClick={load}>Try again</button></div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="ezlv" aria-busy="true">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <div className="ezlv-sk ezlv-sk-hero" />
        <div className="ezlv-cols">
          <div className="ezlv-sk ezlv-sk-panel" />
          <div className="ezlv-sk ezlv-sk-panel" />
        </div>
        <span className="ezlv-vh">Loading your leave…</span>
      </div>
    )
  }

  // Hovering a day after the start previews exactly what tapping it would do.
  const rangeEnd = form.from_date && hover && hover > form.from_date ? hover : form.to_date

  /** Is this date inside the current (or hovered) range? */
  const selected = (k: string) =>
    !!form.from_date && !!rangeEnd && k >= form.from_date && k <= rangeEnd
  /**
   * How long this cell waits before it fills, in ms. Distance from the day the
   * employee clicked first, so the band sweeps outward from there. Capped, so a
   * three-week range does not take a second to finish.
   */
  const sweep = (k: string) => {
    if (!form.from_date) return 0
    const n = Math.abs(Math.round((fromIso(k).getTime() - fromIso(form.from_date).getTime()) / 86400000))
    return Math.min(300, n * 24)
  }

  return (
    <div className="ezlv">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ══ Balance — the one saturated object in the section ══════════════ */}
      <section className="ezlv-hero ezlv-in" aria-labelledby="ezlv-bal-h">
        <div className="ezlv-hero-top">
          <div>
            <p className="ezlv-hero-label" id="ezlv-bal-h">Leave balance · {data.fyLabel}</p>
            <p className="ezlv-hero-total">
              <b>{data.balances.length ? heroTotal : '—'}</b>
              <span>{data.balances.length ? 'days available' : 'nothing loaded yet'}</span>
            </p>
          </div>
          <button className="ezlv-hero-jump" onClick={() => applyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            Apply for leave
          </button>
        </div>

        {!data.balances.length ? (
          <div className="ezlv-hero-empty">
            <b>No balances have been loaded for {data.fyLabel}.</b> Your entitlement is set by HR
            from the leave upload. You can still apply below — requests go to your approver as
            usual, and balances will appear here once they are uploaded.
          </div>
        ) : (
          <div className="ezlv-tiles">
            {data.balances.map((b: any, i: number) => {
              const total = Number(b.opening || 0) + Number(b.accrued || 0)
              const av = avail(b)
              const pct = total > 0 ? Math.round(av / total * 100) : 0
              return (
                <div className="ezlv-tile ezlv-in-pop" key={b.id}
                  style={{ animationDelay: `${120 + i * 60}ms` }}>
                  <div className="ezlv-tile-head">
                    <span className="ezlv-code">{b.leave_types?.short_name}</span>
                    <span className="ezlv-tile-name" title={b.leave_types?.name}>{b.leave_types?.name}</span>
                  </div>
                  <div className="ezlv-tile-num">{av}<small> / {total}</small></div>
                  <div className="ezlv-meter" role="img" aria-label={`${av} of ${total} days left`}>
                    <i className={barClass(pct)}
                      style={{
                        width: lit ? `${Math.min(100, Math.max(0, pct))}%` : '0%',
                        transitionDelay: `${260 + i * 60}ms`,
                      }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <div className="ezlv-cols">
        {/* ══ Apply ═══════════════════════════════════════════════════════ */}
        <section className="ezlv-panel ezlv-in" ref={applyRef} aria-labelledby="ezlv-apply-h"
          style={{ animationDelay: '90ms' }}>
          <div className="ezlv-head"><h3 id="ezlv-apply-h">Apply for leave</h3></div>

          <div className="ezlv-field">
            <span className="ezlv-flabel" id="ezlv-type-l">Leave type</span>
            <div className="ezlv-chips" role="group" aria-labelledby="ezlv-type-l">
              {types.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => chooseType(t)}
                  aria-pressed={form.leave_type_id === t.id}
                  aria-disabled={!t.eligible}
                  title={!t.eligible && t.reason ? t.reason : t.name}
                  className={`ezlv-type ${form.leave_type_id === t.id ? 'is-on' : ''} ${t.eligible ? '' : 'is-off'}`}
                >
                  <b>{t.short_name}</b>
                  {t.available != null && <span>{t.available}</span>}
                </button>
              ))}
            </div>
            {sel && <p className="ezlv-hint">{sel.name}{sel.available != null ? ` · ${sel.available} day${sel.available === 1 ? '' : 's'} left` : ''}</p>}
            {typeNote && <p className="ezlv-hint is-warn">{typeNote}</p>}
          </div>

          <div className="ezlv-field">
            <div className="ezlv-flabel-row">
              <span className="ezlv-flabel">Dates</span>
              {estimate && (
                <span className="ezlv-count" aria-live="polite">
                  {estimate.working} day{estimate.working === 1 ? '' : 's'} selected
                </span>
              )}
              {form.from_date && (
                <button type="button" className="ezlv-clear-dates"
                  onClick={() => setForm(f => ({ ...f, from_date: '', to_date: '' }))}>Clear</button>
              )}
            </div>

            <div className="ezlv-slots">
              <div className={`ezlv-slot ${form.from_date ? 'is-set' : ''}`}>
                <label className="ezlv-slot-k" htmlFor="ezlv-from">Start</label>
                <input id="ezlv-from" className="ezlv-slot-in" type="date" required
                  value={form.from_date} min={floor}
                  onChange={e => setStart(e.target.value)} />
              </div>
              <div className={`ezlv-slot ${form.to_date ? 'is-set' : ''}`}>
                <label className="ezlv-slot-k" htmlFor="ezlv-to">End</label>
                <input id="ezlv-to" className="ezlv-slot-in" type="date" required
                  value={form.to_date} min={form.from_date || floor}
                  onChange={e => setEnd(e.target.value)} />
              </div>
            </div>

            <div className="ezlv-cal">
              <div className="ezlv-cal-head">
                <button type="button" className="ezlv-nav" aria-label="Previous month"
                  disabled={atFloorMonth}
                  onClick={() => { setDir('prev'); setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1)) }}>
                  <Chevron dir="l" />
                </button>
                <strong aria-live="polite">
                  {MONTHS[cursor.getMonth()]} <em>{cursor.getFullYear()}</em>
                </strong>
                {!atFloorMonth && (
                  <button type="button" className="ezlv-jump"
                    onClick={() => { setDir('prev'); setCursor(new Date(floorDate.getFullYear(), floorDate.getMonth(), 1)) }}>
                    Today
                  </button>
                )}
                <button type="button" className="ezlv-nav" aria-label="Next month"
                  onClick={() => { setDir('next'); setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1)) }}>
                  <Chevron dir="r" />
                </button>
              </div>

              <div className="ezlv-dow" aria-hidden="true">
                {DOW.map((d, i) => <span key={i}>{d}</span>)}
              </div>

              <div className={`ezlv-grid ${dir ? 'dir-' + dir : ''}`} key={monthKey}
                role="group" aria-label="Choose dates" ref={gridRef} onKeyDown={onGridKey}
                onMouseLeave={() => setHover('')}>
                {weeks.map((week, wi) => (
                  <div className={`ezlv-week ${week.some(k => !!k && selected(k)) ? 'has-sel' : ''}`} key={wi}>
                    {week.map((key, i) => {
                      if (!key) return <span className="ezlv-day is-blank" key={`b${wi}-${i}`} aria-hidden="true" />
                      const h = holByDate.get(key)
                      const past = key < floor
                      const sel = selected(key)
                      const isEdge = key === form.from_date || key === rangeEnd
                      const dow = fromIso(key).getDay()
                      // The same test the estimate uses, so the band and the
                      // day count can never tell different stories.
                      const noCount = isNonWorking(key)
                      const cls = [
                        'ezlv-day',
                        isWeeklyOff(key) ? 'is-off' : '',
                        past ? 'is-past' : '',
                        key === today ? 'is-today' : '',
                        h ? 'has-hol' : '',
                        sel ? 'is-sel' : '',
                        sel && noCount ? 'is-nocount' : '',
                        sel && isEdge ? 'is-edge' : '',
                        // Rounded at the range's own ends AND at each row break.
                        sel && (dow === 0 || key === form.from_date) ? 'is-rs' : '',
                        sel && (dow === 6 || key === rangeEnd) ? 'is-re' : '',
                      ].filter(Boolean).join(' ')
                      return (
                        <button
                          key={key}
                          type="button"
                          data-d={key}
                          className={cls}
                          disabled={past}
                          // The sweep is for a committed selection only. Applied
                          // while hovering, every pointer move restarted a set of
                          // delayed transitions and the band trailed the cursor.
                          style={{ '--lv-d': `${sel && !hover ? sweep(key) : 0}ms` } as React.CSSProperties}
                          tabIndex={key === focusDay ? 0 : -1}
                          aria-pressed={sel}
                          aria-label={`${fromIso(key).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}${h ? ` — ${h.description}` : ''}${past ? ' — already passed' : ''}`}
                          onFocus={() => setFocusDay(key)}
                          onMouseEnter={() => { if (!past && form.from_date) setHover(key) }}
                          onClick={() => pickDay(key)}
                        >
                          {fromIso(key).getDate()}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>

              <div className="ezlv-legend">
                <span><i className="picked" /> Selected</span>
                <span><i className="ring" /> Today</span>
                <span><i className="off" /> Weekly off</span>
                <span><i className="hol" /> Holiday</span>
                <span>Struck-through days sit inside your dates but are not counted</span>
                <span>Tap again to clear &middot; a later day extends &middot; an earlier one starts over</span>
              </div>
            </div>
          </div>

          <div className="ezlv-field">
            {!form.from_date ? (
              <div className="ezlv-summary is-blank">
                Tap a day in the calendar, or type the dates above. One day is one tap.
              </div>
            ) : (
              <div className="ezlv-summary is-fresh" aria-live="polite"
                key={`${form.from_date}|${form.to_date}|${form.half_day}`}>
                <div className="ezlv-summary-top">
                  <span className="ezlv-summary-range">{rangeLabel(form.from_date, form.to_date)}</span>
                  <span className="ezlv-summary-days">
                    {estimate ? `${estimate.working} day${estimate.working === 1 ? '' : 's'}` : '—'}
                  </span>
                </div>
                {estimate && (
                  <>
                    <p className="ezlv-summary-note">
                      {form.half_day
                        ? 'Half day.'
                        : estimate.offs > 0
                          ? <>{estimate.span} calendar day{estimate.span === 1 ? '' : 's'}, <em>{estimate.offs} not counted</em>
                            {estimate.hols.length ? ` (${estimate.hols.map((x: any) => x.description).join(', ')})` : ''}. Confirmed when you submit.</>
                          : <>{estimate.span} calendar day{estimate.span === 1 ? '' : 's'}, all working. Confirmed when you submit.</>}
                      {estimate.working > 0 && balanceAfter != null && balanceAfter >= 0 && sel &&
                        ` You would have ${balanceAfter} ${sel.short_name} left.`}
                    </p>
                    {/* Both mirror a rule route.ts already enforces. Warned, not
                        blocked: weekly-offs are resolved per employee server-side,
                        so a client guess must never be the thing that stops a
                        legitimate request. */}
                    {estimate.working <= 0 && !form.half_day && (
                      <p className="ezlv-summary-note is-alert">Every day here is a weekly-off or holiday, so there is nothing to apply for.</p>
                    )}
                    {balanceAfter != null && balanceAfter < 0 && sel && (
                      <p className="ezlv-summary-note is-alert">That is {Math.abs(balanceAfter)} day{Math.abs(balanceAfter) === 1 ? '' : 's'} more {sel.short_name} than you have left.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Driven by the selected type's own allow_half_day flag, unchanged. */}
          {sel?.allow_half_day && form.from_date && form.from_date === form.to_date && (
            <div className="ezlv-field">
              <span className="ezlv-flabel">Duration</span>
              <div className="ezlv-seg" role="group" aria-label="Duration">
                <button type="button" className={!form.half_day ? 'is-on' : ''}
                  onClick={() => setForm(f => ({ ...f, half_day: false, half_session: '' }))}>Full day</button>
                <button type="button" className={form.half_day && form.half_session === '1st' ? 'is-on' : ''}
                  onClick={() => setForm(f => ({ ...f, half_day: true, half_session: '1st' }))}>1st half</button>
                <button type="button" className={form.half_day && form.half_session === '2nd' ? 'is-on' : ''}
                  onClick={() => setForm(f => ({ ...f, half_day: true, half_session: '2nd' }))}>2nd half</button>
              </div>
            </div>
          )}

          <div className="ezlv-field">
            <label className="ezlv-flabel" htmlFor="ezlv-reason">Reason</label>
            <input id="ezlv-reason" className="ezlv-input" value={form.reason}
              placeholder="Brief reason for your manager"
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
          </div>

          <div className="ezlv-actions">
            <button className="ezlv-submit" onClick={submit}
              disabled={busy || !form.leave_type_id || !form.from_date || !form.to_date}>
              {busy ? <><i className="ezlv-spin" />Submitting…</> : 'Submit request'}
            </button>
            {(form.leave_type_id || form.from_date || form.reason) && (
              <button className="ezlv-reset"
                onClick={() => { setForm(BLANK); setTypeNote('') }}>Clear</button>
            )}
          </div>

          {data.diagnostics.noApprover && (
            <div className="ezlv-notice"><Warn />
              <span>No reporting or HR manager is recorded against you, so a request may not reach
                anyone. Ask HR to set your manager before applying.</span>
            </div>
          )}
        </section>

        <div className="ezlv-side">
          {/* ══ Requests ══════════════════════════════════════════════════ */}
          <section className="ezlv-panel ezlv-in" aria-labelledby="ezlv-req-h"
            style={{ animationDelay: '150ms' }}>
            <div className="ezlv-head">
              <h3 id="ezlv-req-h">Your requests</h3>
              {!!data.applications.length && <span className="ezlv-head-meta">Last {data.applications.length}</span>}
            </div>
            {!data.applications.length ? (
              <div className="ezlv-empty"><b>No requests yet.</b><br />Anything you apply for will show here with its status.</div>
            ) : data.applications.map((a: any) => {
              const status = String(a.status || '').toUpperCase()
              const half = a.half_day
              return (
                <div className={`ezlv-req s-${status.toLowerCase()}`} key={a.id}>
                  <div className="ezlv-rail" />
                  <div>
                    <div className="ezlv-req-top">
                      <span className="ezlv-tag">{a.leave_types?.short_name}</span>
                      <span className="ezlv-req-dates">
                        {a.to_date && a.to_date !== a.from_date
                          ? `${dayMon(a.from_date)} – ${dayMon(a.to_date)}`
                          : dayMon(a.from_date)}
                      </span>
                      <span className="ezlv-pill">{status}</span>
                    </div>
                    <div className="ezlv-req-sub">
                      {Number(a.days)} day{Number(a.days) === 1 ? '' : 's'}
                      {half ? ` · half day${a.half_session ? ` (${a.half_session})` : ''}` : ''}
                      {a.leave_types?.name ? ` · ${a.leave_types.name}` : ''}
                      {/* Shown only once migration 121 is applied. */}
                      {status === 'PENDING' && a.approval_stage ? ` · stage ${a.approval_stage}` : ''}
                    </div>

                    {a.remark && (
                      <div className="ezlv-remark">
                        {a.approver && <b>{a.approver}</b>}
                        {a.remark}
                      </div>
                    )}

                    {status === 'PENDING' && (
                      <div className="ezlv-req-foot">
                        {confirmId === a.id ? (
                          <>
                            <span className="ezlv-confirm">Withdraw this request?</span>
                            <button className="ezlv-ghost is-danger" disabled={busy} onClick={() => cancel(a.id)}>Yes, withdraw</button>
                            <button className="ezlv-ghost" onClick={() => setConfirmId('')}>Keep it</button>
                          </>
                        ) : (
                          <button className="ezlv-ghost" disabled={busy} onClick={() => setConfirmId(a.id)}>Withdraw</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </section>

          {/* ══ Holidays ══════════════════════════════════════════════════ */}
          <section className="ezlv-panel ezlv-in" aria-labelledby="ezlv-hol-h"
            style={{ animationDelay: '210ms' }}>
            <div className="ezlv-head">
              <h3 id="ezlv-hol-h">Upcoming holidays</h3>
              {!!upcoming.length && <span className="ezlv-head-meta">{upcoming.length} ahead</span>}
            </div>
            {!upcoming.length ? (
              <div className="ezlv-empty">
                {data.diagnostics.noHolidays
                  ? <><b>No holiday calendar published yet.</b><br />Once HR publishes it, your company&rsquo;s holidays appear here and stop counting against your leave.</>
                  : <><b>Nothing left this year.</b><br />The next calendar will appear here when HR publishes it.</>}
              </div>
            ) : (() => {
              let lastMonth = ''
              return upcoming.map((h: any, i: number) => {
                const d = fromIso(h.holiday_date)
                const mon = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
                const head = mon !== lastMonth ? (lastMonth = mon) : null
                const away = Math.round((d.getTime() - fromIso(today).getTime()) / 86400000)
                const kind = String(h.holiday_type || '').toLowerCase()
                return (
                  <div className="ezlv-holrow" key={`${h.holiday_date}-${i}`}>
                    {head && <div className="ezlv-month">{head}</div>}
                    <div className="ezlv-hol">
                      <div className="ezlv-datebox">
                        <b>{d.getDate()}</b>
                        <span>{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
                      </div>
                      <div className="ezlv-hol-body">
                        <div className="ezlv-hol-name">{h.description}</div>
                        <div className="ezlv-hol-meta">
                          <em className={`t-${kind}`}>{h.holiday_type}</em>
                          {h.is_optional && <em className="is-optional">Optional</em>}
                        </div>
                      </div>
                      <span className="ezlv-hol-days">{away === 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away}d`}</span>
                    </div>
                  </div>
                )
              })
            })()}
          </section>
        </div>
      </div>
    </div>
  )
}

// ── Scoped stylesheet ──────────────────────────────────────────────────────
const CSS = `
.ezlv {
  --lv-gap: 12px;
  --lv-r-sm: 8px;
  --lv-r-md: var(--ez-r-md, 10px);
  --lv-r-lg: 14px;
  --lv-r-xl: 18px;
  --lv-pill: 999px;

  --lv-ink: var(--ez-ink, #111827);
  --lv-soft: var(--ez-ink-soft, #374151);
  --lv-muted: var(--ez-muted, #4B5563);
  --lv-faint: var(--ez-faint, #626D80);
  --lv-brand: var(--ez-brand, #2563EB);
  --lv-brand-deep: var(--ez-brand-deep, #1D4ED8);
  --lv-brand-tint: var(--ez-brand-tint, #EFF6FF);
  --lv-brand-edge: var(--ez-brand-edge, #BFDBFE);
  --lv-surface: var(--ez-surface, #FFFFFF);
  --lv-sunken: var(--ez-sunken, #F3F4F6);
  --lv-line: var(--ez-line, #E5E7EB);
  --lv-line-strong: var(--ez-line-strong, #D1D5DB);
  --lv-ok: var(--ez-positive, #047857);
  --lv-ok-tint: var(--ez-positive-tint, #ECFDF5);
  --lv-warn: var(--ez-warning, #B45309);
  --lv-warn-tint: var(--ez-warning-tint, #FFFBEB);
  --lv-bad: var(--ez-critical, #C0201F);
  --lv-bad-tint: var(--ez-critical-tint, #FEF2F2);
  --lv-info: var(--ez-info, #0369A1);
  --lv-info-tint: var(--ez-info-tint, #F0F9FF);
  --lv-font: var(--ez-font, "DM Sans", "Segoe UI", system-ui, sans-serif);

  /* The hero is the one saturated object in the section. Two fixed gradients
     rather than tokens, because brand-on-brand inverts in the dark theme and a
     bright panel in a dark portal reads as a bug. */
  --lv-hero: linear-gradient(135deg, #0E2470 0%, #1D4ED8 46%, #4189FB 100%);
  --lv-hero-ink: #FFFFFF;
  --lv-hero-sub: rgba(255, 255, 255, .84);
  --lv-hero-fill: rgba(255, 255, 255, .17);
  --lv-hero-edge: rgba(255, 255, 255, .26);
  --lv-hero-shadow: 0 2px 4px rgba(10, 24, 66, .34), 0 18px 40px -14px rgba(23, 62, 175, .62);

  font-family: var(--lv-font);
  font-size: 13px;
  line-height: 1.5;
  color: var(--lv-ink);
  -webkit-font-smoothing: antialiased;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-ez-theme="light"]) .ezlv {
    --lv-hero: linear-gradient(135deg, #0B1220 0%, #16223C 52%, #22355E 100%);
    --lv-hero-ink: #F6F9FF;
    --lv-hero-sub: rgba(216, 229, 252, .78);
    --lv-hero-fill: rgba(255, 255, 255, .085);
    --lv-hero-edge: rgba(255, 255, 255, .15);
    --lv-hero-shadow: 0 2px 4px rgba(0, 0, 0, .55), 0 18px 40px -14px rgba(0, 0, 0, .75);
  }
}
:root[data-ez-theme="dark"] .ezlv {
  --lv-hero: linear-gradient(135deg, #0B1220 0%, #16223C 52%, #22355E 100%);
  --lv-hero-ink: #F6F9FF;
  --lv-hero-sub: rgba(216, 229, 252, .78);
  --lv-hero-fill: rgba(255, 255, 255, .085);
  --lv-hero-edge: rgba(255, 255, 255, .15);
  --lv-hero-shadow: 0 2px 4px rgba(0, 0, 0, .55), 0 18px 40px -14px rgba(0, 0, 0, .75);
}

.ezlv *,
.ezlv *::before,
.ezlv *::after { box-sizing: border-box; }

.ezlv :focus-visible {
  outline: 2.5px solid var(--lv-brand);
  outline-offset: 2px;
  border-radius: var(--lv-r-sm);
}

/* ── Hero · the leave account ───────────────────────────────────────────── */

.ezlv-hero {
  position: relative;
  overflow: hidden;
  background: var(--lv-hero);
  color: var(--lv-hero-ink);
  border-radius: var(--lv-r-xl);
  padding: 18px 18px 16px;
  margin-bottom: var(--lv-gap);
  box-shadow: var(--lv-hero-shadow);
}
/* A single quiet light source, top-right. No second decorative layer. */
.ezlv-hero::after {
  content: "";
  position: absolute;
  top: -120px; right: -90px;
  width: 300px; height: 300px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, .16), transparent 68%);
  pointer-events: none;
}
.ezlv-hero > * { position: relative; }

.ezlv-hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.ezlv-hero-label {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 500;
  color: var(--lv-hero-sub);
}
.ezlv-hero-total {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-weight: 700;
  letter-spacing: -.02em;
}
.ezlv-hero-total b {
  font-size: 40px;
  line-height: 1;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.ezlv-hero-total span {
  font-size: 13px;
  font-weight: 500;
  color: var(--lv-hero-sub);
}
.ezlv-hero-jump {
  flex: none;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--lv-pill);
  border: 1px solid var(--lv-hero-edge);
  background: var(--lv-hero-fill);
  color: var(--lv-hero-ink);
  font: 600 12px var(--lv-font);
  cursor: pointer;
  transition: background .15s ease;
}
.ezlv-hero-jump:hover { background: rgba(255, 255, 255, .22); }

.ezlv-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(146px, 1fr));
  gap: 8px;
  margin-top: 16px;
}
.ezlv-tile {
  background: var(--lv-hero-fill);
  border: 1px solid var(--lv-hero-edge);
  border-radius: var(--lv-r-md);
  padding: 9px 11px 10px;
}
.ezlv-tile-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  min-width: 0;
}
.ezlv-tile-name {
  font-size: 11px;
  color: var(--lv-hero-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ezlv-tile-num {
  font-size: 21px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  margin-bottom: 8px;
}
.ezlv-tile-num small {
  font-size: 11px;
  font-weight: 500;
  color: var(--lv-hero-sub);
}
.ezlv-code {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .04em;
  padding: 2px 6px;
  border-radius: var(--lv-pill);
  background: rgba(255, 255, 255, .2);
  color: var(--lv-hero-ink);
}
.ezlv-meter {
  height: 4px;
  border-radius: var(--lv-pill);
  background: rgba(255, 255, 255, .18);
  overflow: hidden;
}
.ezlv-meter > i {
  display: block;
  height: 100%;
  border-radius: var(--lv-pill);
  background: #fff;
  transition: width .35s cubic-bezier(.4, 0, .2, 1);
}
.ezlv-meter > i.is-ok { background: #6EE7B7; }
.ezlv-meter > i.is-warn { background: #FCD34D; }
.ezlv-meter > i.is-bad { background: #FCA5A5; }

.ezlv-hero-empty {
  margin-top: 14px;
  border: 1px dashed var(--lv-hero-edge);
  border-radius: var(--lv-r-md);
  padding: 12px 13px;
  font-size: 12px;
  color: var(--lv-hero-sub);
  line-height: 1.6;
}
.ezlv-hero-empty b { color: var(--lv-hero-ink); font-weight: 600; }

/* ── Layout ─────────────────────────────────────────────────────────────── */

.ezlv-cols { display: grid; gap: var(--lv-gap); }
.ezlv-side { display: grid; gap: var(--lv-gap); align-content: start; }

@media (min-width: 880px) {
  .ezlv-cols { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); align-items: start; }
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

.ezlv-panel {
  background: var(--lv-surface);
  border: 1px solid var(--lv-line-strong);
  border-radius: var(--lv-r-lg);
  padding: 14px 15px 15px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .05), 0 6px 18px -10px rgba(16, 24, 40, .14);
}
.ezlv-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.ezlv-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -.01em;
  color: var(--lv-ink);
}
.ezlv-head-meta {
  margin-left: auto;
  font-size: 11px;
  font-weight: 500;
  color: var(--lv-muted);
}
.ezlv-empty {
  border: 1px dashed var(--lv-line-strong);
  border-radius: var(--lv-r-md);
  padding: 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--lv-muted);
  text-align: center;
}
.ezlv-empty b { color: var(--lv-soft); font-weight: 600; }

/* ── Fields ─────────────────────────────────────────────────────────────── */

.ezlv-field { margin-bottom: 14px; }
.ezlv-flabel {
  display: block;
  margin-bottom: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--lv-soft);
}
.ezlv-flabel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}
.ezlv-flabel-row .ezlv-flabel { margin-bottom: 0; }
.ezlv-count {
  margin-left: auto;
  padding: 2px 9px;
  border-radius: var(--lv-pill);
  background: var(--lv-brand);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  animation: ezlv-pop .26s cubic-bezier(.22, 1, .36, 1);
}
.ezlv-clear-dates {
  border: 0;
  background: none;
  padding: 0;
  color: var(--lv-faint);
  font: 500 11px var(--lv-font);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.ezlv-clear-dates:hover { color: var(--lv-bad); }
.ezlv-hint {
  margin: 7px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--lv-muted);
}
.ezlv-hint.is-warn { color: var(--lv-warn); }

.ezlv-input {
  width: 100%;
  height: 38px;
  padding: 0 11px;
  font: 400 13px var(--lv-font);
  color: var(--lv-ink);
  background: var(--lv-surface);
  border: 1px solid var(--lv-line-strong);
  border-radius: var(--lv-r-md);
  outline: none;
  transition: border-color .14s cubic-bezier(.4, 0, .2, 1), box-shadow .14s cubic-bezier(.4, 0, .2, 1);
}
.ezlv-input::placeholder { color: var(--lv-faint); }
.ezlv-input:focus {
  border-color: var(--lv-brand);
  box-shadow: 0 0 0 3px var(--lv-brand-tint);
}

/* Leave type chips — replaces a native select whose option text was the only
   place an eligibility reason could live, where mobile truncated it. */
.ezlv-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ezlv-type {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--lv-line-strong);
  border-radius: var(--lv-pill);
  background: var(--lv-surface);
  color: var(--lv-soft);
  font: 600 12px var(--lv-font);
  cursor: pointer;
  transition: border-color .14s ease, background .14s ease, color .14s ease;
}
.ezlv-type:hover { border-color: var(--lv-brand-edge); background: var(--lv-brand-tint); }
.ezlv-type b { font-weight: 700; letter-spacing: .02em; }
.ezlv-type span {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--lv-faint);
}
.ezlv-type.is-on {
  border-color: var(--lv-brand-deep);
  background: var(--lv-brand);
  color: var(--ez-on-accent, #fff);
  box-shadow: 0 1px 2px rgba(29, 78, 216, .24), 0 6px 14px -6px rgba(37, 99, 235, .5);
}
.ezlv-type.is-on span { color: currentColor; opacity: .75; }
.ezlv-type.is-off {
  opacity: .5;
  border-style: dashed;
  cursor: not-allowed;
}
.ezlv-type.is-off:hover { background: var(--lv-surface); border-color: var(--lv-line-strong); }

/* Segmented control — half day, and any two-way switch. */
.ezlv-seg {
  display: inline-flex;
  padding: 3px;
  gap: 3px;
  border: 1px solid var(--lv-line);
  border-radius: var(--lv-r-md);
  background: var(--lv-sunken);
}
.ezlv-seg button {
  height: 30px;
  padding: 0 13px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--lv-muted);
  font: 600 12px var(--lv-font);
  cursor: pointer;
  transition: background .14s ease, color .14s ease;
}
.ezlv-seg button.is-on {
  background: var(--lv-surface);
  color: var(--lv-ink);
  box-shadow: 0 1px 2px rgba(16, 24, 40, .1);
}

/* ── Date slots ─────────────────────────────────────────────────────────────
   Two named fields above the calendar. The old picker had no labels at all —
   you clicked twice and inferred which click had been the start. Now the
   chosen dates are written down, each one is its own target you can go back
   and change, and the active one is underlined. */

.ezlv-slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 9px;
  border: 1px solid var(--lv-line-strong);
  border-radius: var(--lv-r-md);
  overflow: hidden;
  background: var(--lv-surface);
}

/* Each half is a real date field: type it, or use the browser's own picker.
   The calendar below and these two inputs are the same two values, so either
   route reaches the same place. */
.ezlv-slot {
  position: relative;
  padding: 7px 11px 8px;
  overflow: hidden;
  transition: background .17s ease;
}
.ezlv-slot + .ezlv-slot { border-left: 1px solid var(--lv-line-strong); }
.ezlv-slot:focus-within { background: var(--lv-brand-tint); }
.ezlv-slot.is-set { background: var(--lv-brand-tint); }
.ezlv-slot.is-set::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 2px;
  background: var(--lv-brand);
  transform-origin: left;
  animation: ezlv-slotbar .3s cubic-bezier(.22, 1, .36, 1);
}
@keyframes ezlv-slotbar { from { transform: scaleX(0); } to { transform: none; } }

.ezlv-slot-k {
  display: block;
  margin-bottom: 2px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--lv-muted);
}
.ezlv-slot.is-set .ezlv-slot-k { color: var(--lv-brand-deep); }
.ezlv-slot-in {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  outline: none;
  font: 600 13.5px var(--lv-font);
  letter-spacing: -.01em;
  color: var(--lv-ink);
}
/* \`required\` + empty means the field is showing dd/mm/yyyy, so dial it back. */
.ezlv-slot-in:invalid { color: var(--lv-faint); font-weight: 500; }
/* The browser's own picker button, dialled down until you go near it. */
.ezlv-slot-in::-webkit-calendar-picker-indicator {
  opacity: .45;
  cursor: pointer;
  transition: opacity .15s ease;
}
.ezlv-slot:hover .ezlv-slot-in::-webkit-calendar-picker-indicator,
.ezlv-slot:focus-within .ezlv-slot-in::-webkit-calendar-picker-indicator { opacity: .9; }
/* The field has no ring of its own — the whole slot takes it, so the focused
   half is obvious at a glance rather than a hairline around the text. */
.ezlv-slot-in:focus-visible { outline: none; }
.ezlv-slot:focus-within { box-shadow: inset 0 0 0 2px var(--lv-brand); }

/* ── Calendar ───────────────────────────────────────────────────────────── */

.ezlv-cal {
  border: 1px solid var(--lv-line-strong);
  border-radius: var(--lv-r-lg);
  /* A tinted crown behind the month nav that fades into the surface before the
     grid starts, so the header reads as a header without needing a rule. */
  background:
    linear-gradient(180deg, var(--lv-brand-tint) 0%, var(--lv-surface) 74px),
    var(--lv-surface);
  padding: 10px 10px 8px;
}
.ezlv-cal-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 9px;
}
.ezlv-cal-head strong {
  margin-right: auto;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -.02em;
  color: var(--lv-ink);
}
.ezlv-cal-head strong em {
  font-style: normal;
  font-weight: 500;
  color: var(--lv-muted);
}
/* Appears only when you have navigated away from the current month. */
.ezlv-jump {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--lv-brand-edge);
  border-radius: var(--lv-pill);
  background: var(--lv-surface);
  color: var(--lv-brand-deep);
  font: 600 11px var(--lv-font);
  cursor: pointer;
  animation: ezlv-pop .26s cubic-bezier(.22, 1, .36, 1);
}
.ezlv-jump:hover { background: var(--lv-brand-tint); }
.ezlv-nav {
  width: 28px; height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--lv-line);
  border-radius: var(--lv-r-sm);
  background: var(--lv-surface);
  color: var(--lv-muted);
  cursor: pointer;
  transition: border-color .14s ease, color .14s ease;
}
.ezlv-nav:not(:disabled):hover { border-color: var(--lv-line-strong); color: var(--lv-ink); }
/* There is nothing to go back to — the first selectable day is today. */
.ezlv-nav:disabled { opacity: .35; cursor: not-allowed; }
.ezlv-nav svg { width: 13px; height: 13px; }

.ezlv-dow {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 4px;
}

/* The grid is rows of weeks rather than 42 loose cells, so a week that the
   selection touches can carry a band of its own — which is what makes a range
   spanning two weeks read as one thing instead of two stripes. */
.ezlv-grid { display: grid; gap: 2px; }
.ezlv-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  padding: 1px 3px;
  margin: 0 -3px;
  border-radius: var(--lv-r-md);
  background: transparent;
  transition: background .26s cubic-bezier(.22, 1, .36, 1);
}
.ezlv-week.has-sel { background: var(--lv-brand-tint); }
.ezlv-dow span {
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--lv-muted);
  padding-bottom: 2px;
}
/* Sunday is the weekly off, so it is red in the header and red in the column —
   the same convention every Indian wall calendar uses. */
.ezlv-dow span:first-child { color: var(--lv-bad); }

.ezlv-day {
  position: relative;
  aspect-ratio: 1 / 1;
  min-height: 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--lv-r-sm);
  background: transparent;
  color: var(--lv-soft);
  font: 500 12.5px var(--lv-font);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  /* --lv-d is the cell's distance from the start of the range, in ms. It makes
     the selection sweep outward from the day that was clicked first instead of
     appearing all at once — an animation built from a transition, so nothing
     has to remount and keyboard focus survives. */
  transition: background .2s cubic-bezier(.22, 1, .36, 1),
              color .2s cubic-bezier(.22, 1, .36, 1),
              border-radius .2s cubic-bezier(.22, 1, .36, 1),
              box-shadow .2s ease,
              transform .18s cubic-bezier(.34, 1.56, .64, 1);
  transition-delay: var(--lv-d, 0ms);
}
.ezlv-day:not(:disabled):active:not(.is-blank) { transform: scale(.88); transition-delay: 0ms; }
/* Scoped away from selected cells, and off entirely on touch.
   Unscoped, this outranked .is-sel and .is-edge, so the cell under the pointer
   — i.e. the one just clicked — went grey the instant it was chosen. On a
   phone :hover persists after a tap, so it stayed grey. That is why a selected
   date did not look selected. */
@media (hover: hover) {
  .ezlv-day:not(:disabled):not(.is-sel):hover {
    background: var(--lv-sunken);
    box-shadow: inset 0 0 0 1px var(--lv-line-strong);
  }
}
.ezlv-day.is-blank { visibility: hidden; cursor: default; }
/* NOTHING but a selected day gets a background fill. Sunday and holidays carry
   their meaning in the TEXT colour and the marker bar instead, because a grid
   with three different fills in it is a grid where you cannot tell which fill
   means "I picked this". */
.ezlv-day.is-off { color: var(--lv-bad); }
.ezlv-day.has-hol:not(.is-sel) { color: var(--lv-warn); font-weight: 700; }
/* Leave cannot start in the past, so a past date is not a dimmed option —
   it is not an option. Struck through, so the reason is legible rather than
   just "this one looks faded". */
.ezlv-day:disabled.is-past {
  background: transparent;
  color: var(--lv-faint);
  opacity: .38;
  font-weight: 500;
  cursor: not-allowed;
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
.ezlv-day:disabled.is-past::before { background: var(--lv-faint); }
.ezlv-day:disabled { cursor: not-allowed; }
.ezlv-day:disabled:hover { background: transparent; }
/* Today is OUTLINED, never filled or tinted. It used to be brand-coloured and
   bold with a brand dot, which is what a selected day looks like — so today
   read as permanently included in the range. An outline cannot be confused
   with a fill. */
.ezlv-day.is-today {
  font-weight: 700;
  box-shadow: inset 0 0 0 2px var(--lv-brand);
}
/* Holiday marker — a bar rather than a dot, so it reads apart from "today". */
.ezlv-day.has-hol::before {
  content: "";
  position: absolute;
  bottom: 4px;
  width: 11px; height: 2px;
  border-radius: var(--lv-pill);
  background: var(--lv-warn);
}
/* Every day inside the range, including both ends. Square by default so the
   run is continuous; the row-edge classes below put the corners back. */
.ezlv-day.is-sel {
  background: var(--lv-brand);
  color: #fff;
  font-weight: 700;
  opacity: 1;
  border-radius: 0;
}
/* A weekly-off or mandatory holiday inside the range is still part of the band,
   but it is not billed — so it sits a shade back, level with the week's own
   tint, and reads as a gap in the run. */
.ezlv-day.is-sel.is-nocount:not(.is-edge) {
  background: var(--lv-brand-edge);
  color: var(--lv-brand-deep);
  font-weight: 600;
  text-decoration: line-through;
  text-decoration-thickness: 1.5px;
}

/* The two ends the employee actually clicked. */
.ezlv-day.is-edge {
  background: var(--lv-brand-deep);
  color: #fff;
  font-weight: 700;
  transform: scale(1.1);
  z-index: 1;
  box-shadow: 0 0 0 2px var(--lv-surface), 0 0 0 3.5px var(--lv-brand-deep),
              0 3px 10px -2px rgba(29, 78, 216, .65);
}
.ezlv-day.is-edge::before { background: currentColor; }
/* Once today is selected it is filled, so it drops the outline — but not when
   it is an end, which keeps its halo. */
.ezlv-day.is-today.is-sel:not(.is-edge) { box-shadow: none; }
/* Rounded where the run begins or ends — at the range's ends, and again at
   each row break, so a multi-week range looks like a band per week rather
   than one rectangle with sheared corners. */
.ezlv-day.is-rs {
  border-top-left-radius: var(--lv-r-sm);
  border-bottom-left-radius: var(--lv-r-sm);
}
.ezlv-day.is-re {
  border-top-right-radius: var(--lv-r-sm);
  border-bottom-right-radius: var(--lv-r-sm);
}

.ezlv-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--lv-line);
  font-size: 10.5px;
  color: var(--lv-muted);
}
.ezlv-legend span { display: inline-flex; align-items: center; gap: 5px; }
.ezlv-legend i {
  width: 9px; height: 2px;
  border-radius: var(--lv-pill);
  background: var(--lv-warn);
}
.ezlv-legend i.dot {
  width: 9px; height: 9px;
  border-radius: 3px;
  background: var(--lv-brand);
}
.ezlv-legend i.band {
  width: 14px; height: 9px;
  border-radius: 3px;
  background: var(--lv-brand-edge);
}
.ezlv-legend i.ring {
  width: 10px; height: 10px;
  border-radius: 3px;
  background: transparent;
  box-shadow: inset 0 0 0 2px var(--lv-brand);
}
.ezlv-legend i.off,
.ezlv-legend i.hol {
  width: auto; height: auto;
  background: none;
  font: 700 11px var(--lv-font);
  font-style: normal;
}
.ezlv-legend i.off::before { content: "7"; color: var(--lv-bad); }
.ezlv-legend i.hol::before { content: "7"; color: var(--lv-warn); }
.ezlv-legend i.picked {
  width: 12px; height: 12px;
  border-radius: 3px;
  background: var(--lv-brand);
}

/* ── Range summary ──────────────────────────────────────────────────────── */

.ezlv-summary {
  border: 1px solid var(--lv-brand-edge);
  background: var(--lv-brand-tint);
  border-radius: var(--lv-r-md);
  padding: 11px 12px;
}
.ezlv-summary-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.ezlv-summary-range {
  font-size: 13px;
  font-weight: 600;
  color: var(--lv-ink);
}
.ezlv-summary-days {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -.01em;
  color: var(--lv-brand-deep);
  font-variant-numeric: tabular-nums;
}
.ezlv-summary-note {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--lv-muted);
}
.ezlv-summary-note em { font-style: normal; color: var(--lv-warn); font-weight: 600; }
.ezlv-summary-note.is-alert {
  margin-top: 7px;
  padding-top: 7px;
  border-top: 1px solid var(--lv-brand-edge);
  color: var(--lv-bad);
  font-weight: 600;
}
.ezlv-summary.is-blank {
  border-style: dashed;
  border-color: var(--lv-line-strong);
  background: transparent;
  color: var(--lv-faint);
  font-size: 12px;
}

.ezlv-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--lv-line);
}
.ezlv-submit {
  height: 38px;
  padding: 0 18px;
  border: 1px solid var(--lv-brand-deep);
  border-radius: var(--lv-r-md);
  background: linear-gradient(180deg, var(--lv-brand), var(--lv-brand-deep));
  color: var(--ez-on-accent, #fff);
  font: 600 13px var(--lv-font);
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(29, 78, 216, .24), 0 8px 20px -6px rgba(37, 99, 235, .36);
  transition: transform .12s ease, box-shadow .12s ease;
}
.ezlv-submit:hover:not(:disabled) { transform: translateY(-1px); }
.ezlv-submit:active:not(:disabled) { transform: translateY(0); }
.ezlv-submit:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; }
.ezlv-reset {
  border: 0;
  background: none;
  color: var(--lv-faint);
  font: 500 12px var(--lv-font);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.ezlv-reset:hover { color: var(--lv-ink); }

/* ── Requests ───────────────────────────────────────────────────────────── */

.ezlv-req {
  position: relative;
  display: grid;
  grid-template-columns: 3px minmax(0, 1fr);
  gap: 11px;
  padding: 10px 0;
  border-bottom: 1px solid var(--lv-line);
}
.ezlv-req:last-child { border-bottom: 0; padding-bottom: 0; }
.ezlv-head + .ezlv-req { padding-top: 0; }
/* The status rail — colour carries the state before any text is read. */
.ezlv-rail { border-radius: var(--lv-pill); background: var(--lv-line-strong); }
.ezlv-req.s-pending .ezlv-rail { background: var(--lv-warn); }
.ezlv-req.s-approved .ezlv-rail { background: var(--lv-ok); }
.ezlv-req.s-rejected .ezlv-rail { background: var(--lv-bad); }
.ezlv-req.s-cancelled .ezlv-rail { background: var(--lv-line-strong); }

.ezlv-req-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ezlv-req-dates {
  font-size: 13px;
  font-weight: 600;
  color: var(--lv-ink);
}
.ezlv-req-sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--lv-muted);
}
.ezlv-tag {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .03em;
  padding: 2px 7px;
  border-radius: var(--lv-pill);
  background: var(--lv-brand-tint);
  color: var(--lv-brand-deep);
}
.ezlv-pill {
  margin-left: auto;
  flex: none;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .03em;
  padding: 3px 9px;
  border: 1px solid currentColor;
  border-radius: var(--lv-pill);
}
.s-pending .ezlv-pill { background: var(--lv-warn-tint); color: var(--lv-warn); }
.s-approved .ezlv-pill { background: var(--lv-ok-tint); color: var(--lv-ok); }
.s-rejected .ezlv-pill { background: var(--lv-bad-tint); color: var(--lv-bad); }
.s-cancelled .ezlv-pill { background: var(--lv-sunken); color: var(--lv-muted); }

.ezlv-remark {
  margin-top: 8px;
  padding: 8px 10px;
  border-left: 2px solid var(--lv-line-strong);
  background: var(--lv-sunken);
  border-radius: 0 var(--lv-r-sm) var(--lv-r-sm) 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--lv-muted);
}
.ezlv-remark b { display: block; color: var(--lv-soft); font-weight: 600; }

.ezlv-req-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.ezlv-ghost {
  height: 27px;
  padding: 0 10px;
  border: 1px solid var(--lv-line-strong);
  border-radius: var(--lv-r-sm);
  background: var(--lv-surface);
  color: var(--lv-muted);
  font: 600 11px var(--lv-font);
  cursor: pointer;
  transition: color .14s ease, border-color .14s ease;
}
.ezlv-ghost:hover { color: var(--lv-ink); border-color: var(--lv-faint); }
.ezlv-ghost.is-danger { color: var(--lv-bad); border-color: var(--lv-bad); }
.ezlv-ghost:disabled { opacity: .5; cursor: not-allowed; }
.ezlv-confirm { font-size: 11px; color: var(--lv-bad); font-weight: 600; }

/* ── Holidays ───────────────────────────────────────────────────────────── */

.ezlv-month {
  margin: 12px 0 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--lv-faint);
}
.ezlv-month:first-child { margin-top: 0; }

.ezlv-hol {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 7px 0;
}
.ezlv-holrow + .ezlv-holrow .ezlv-hol { border-top: 1px solid var(--lv-line); }
.ezlv-holrow .ezlv-month + .ezlv-hol { border-top: 0; }
/* A date tile, not a date string — the calendar is the subject here. */
.ezlv-datebox {
  flex: none;
  width: 38px;
  padding: 4px 0 5px;
  text-align: center;
  border: 1px solid var(--lv-line-strong);
  border-radius: var(--lv-r-sm);
  background: var(--lv-sunken);
}
.ezlv-datebox b {
  display: block;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--lv-ink);
  font-variant-numeric: tabular-nums;
}
.ezlv-datebox span {
  display: block;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--lv-faint);
}
.ezlv-hol-body { flex: 1; min-width: 0; }
.ezlv-hol-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--lv-ink);
}
.ezlv-hol-meta {
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--lv-faint);
}
.ezlv-hol-meta em {
  font-style: normal;
  font-weight: 700;
  letter-spacing: .04em;
  padding: 1px 6px;
  border-radius: var(--lv-pill);
  background: var(--lv-sunken);
  color: var(--lv-muted);
}
.ezlv-hol-meta em.t-national { background: var(--lv-info-tint); color: var(--lv-info); }
.ezlv-hol-meta em.t-festival { background: var(--lv-brand-tint); color: var(--lv-brand-deep); }
.ezlv-hol-meta em.t-regional { background: var(--lv-brand-tint); color: var(--lv-brand-deep); }
.ezlv-hol-meta em.t-optional,
.ezlv-hol-meta em.is-optional { background: var(--lv-warn-tint); color: var(--lv-warn); }
.ezlv-hol-days {
  flex: none;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--lv-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Notices ────────────────────────────────────────────────────────────── */

.ezlv-notice {
  display: flex;
  gap: 9px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--lv-r-md);
  border: 1px solid var(--lv-warn);
  background: var(--lv-warn-tint);
  color: var(--lv-warn);
  font-size: 11px;
  line-height: 1.6;
}
.ezlv-notice svg { flex: none; width: 14px; height: 14px; margin-top: 1px; }

.ezlv-error {
  border: 1px solid var(--lv-bad);
  background: var(--lv-bad-tint);
  color: var(--lv-bad);
  border-radius: var(--lv-r-lg);
  padding: 14px 15px;
  font-size: 13px;
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */

.ezlv-sk {
  border-radius: var(--lv-r-md);
  background: linear-gradient(90deg, var(--lv-sunken) 25%, var(--lv-line) 50%, var(--lv-sunken) 75%);
  background-size: 400% 100%;
  animation: ezlv-shimmer 1.3s ease-in-out infinite;
}
.ezlv-sk-hero {
  height: 168px;
  border-radius: var(--lv-r-xl);
  margin-bottom: var(--lv-gap);
}
.ezlv-sk-panel { height: 260px; border-radius: var(--lv-r-lg); }
@keyframes ezlv-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ezlv *,
  .ezlv *::before,
  .ezlv *::after {
    animation: none !important;
    transition-duration: .001ms !important;
    scroll-behavior: auto !important;
  }
  .ezlv-type:active, .ezlv-seg button:active, .ezlv-ghost:active,
  .ezlv-nav:active, .ezlv-hero-jump:active,
  .ezlv-day:active, .ezlv-submit:active:not(:disabled) { transform: none; }
}


/* ══ Motion ═══════════════════════════════════════════════════════════════
   Two kinds only:

   1. ONE orchestrated entrance, once, on first paint — the hero rises, its
      tiles stagger in, the meters sweep up from zero and the total counts up.
      It runs when the data lands and never again. Panels do not re-animate on
      re-render, because a section that re-animates every keystroke is noise.

   2. Response motion — press, range fill, month change, confirm, submit.
      Every one of these answers something the employee just did and shows
      what changed.

   All of it is switched off under prefers-reduced-motion, below.
   ════════════════════════════════════════════════════════════════════════ */

@keyframes ezlv-rise {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: none; }
}
@keyframes ezlv-pop {
  from { opacity: 0; transform: translateY(8px) scale(.96); }
  to   { opacity: 1; transform: none; }
}
@keyframes ezlv-slide-next {
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: none; }
}
@keyframes ezlv-slide-prev {
  from { opacity: 0; transform: translateX(-16px); }
  to   { opacity: 1; transform: none; }
}
@keyframes ezlv-halo {
  from { box-shadow: 0 0 0 0 rgba(37, 99, 235, .40); }
  to   { box-shadow: 0 0 0 9px rgba(37, 99, 235, 0); }
}
@keyframes ezlv-spin { to { transform: rotate(360deg); } }
/* The hero's light source drifts. 24s, 30px, one layer — slow enough to read
   as depth rather than decoration. */
@keyframes ezlv-drift {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50%      { transform: translate3d(-34px, 22px, 0) scale(1.12); }
}

/* Entrance — delay is set inline, so one class serves every staggered child. */
.ezlv-in { animation: ezlv-rise .5s cubic-bezier(.22, 1, .36, 1) backwards; }
.ezlv-in-pop { animation: ezlv-pop .42s cubic-bezier(.22, 1, .36, 1) backwards; }

.ezlv-hero::after { animation: ezlv-drift 24s ease-in-out infinite; }

/* The total counts up; the unit label fades in behind it. */
.ezlv-hero-total b { transition: none; }
.ezlv-hero-total span { animation: ezlv-rise .5s .34s cubic-bezier(.22, 1, .36, 1) backwards; }

/* Meters sweep from 0 once the numbers are on screen. The delay is set inline
   so each tile's bar follows its own tile in. */
.ezlv-meter > i {
  transition: width .78s cubic-bezier(.22, 1, .36, 1);
}

/* Month change slides in the direction you navigated. */
.ezlv-grid.dir-next { animation: ezlv-slide-next .26s cubic-bezier(.22, 1, .36, 1); }
.ezlv-grid.dir-prev { animation: ezlv-slide-prev .26s cubic-bezier(.22, 1, .36, 1); }

/* The range summary pulses once when the day count changes — it is the number
   the employee came to the form for. */
.ezlv-summary.is-fresh { animation: ezlv-halo .55s ease-out; }
.ezlv-summary.is-fresh .ezlv-summary-days { animation: ezlv-pop .34s cubic-bezier(.22, 1, .36, 1); }

/* Press feedback, so a tap on a phone registers before the network does. */
.ezlv-type, .ezlv-seg button, .ezlv-ghost, .ezlv-nav, .ezlv-hero-jump {
  transition: border-color .16s ease, background .16s ease, color .16s ease,
              box-shadow .16s ease, transform .12s cubic-bezier(.22, 1, .36, 1);
}
.ezlv-type:active, .ezlv-seg button:active, .ezlv-ghost:active,
.ezlv-nav:not(:disabled):active, .ezlv-hero-jump:active { transform: scale(.94); }
.ezlv-submit:active:not(:disabled) { transform: scale(.975); }

/* The withdraw confirm row expands rather than appearing. */
.ezlv-req-foot { animation: ezlv-pop .24s cubic-bezier(.22, 1, .36, 1); }

/* Submit spinner. */
.ezlv-spin {
  display: inline-block;
  width: 13px; height: 13px;
  margin-right: 7px;
  vertical-align: -2px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ezlv-spin .62s linear infinite;
}

/* Rows respond to the pointer without lifting — a list of requests is a list,
   not a deck of cards. The backdrop is a pseudo-element bled into the panel
   gutter, so it never fights the row's own bottom hairline. */
.ezlv-hol { position: relative; }
/* The status reads as colour across the row, fading out before the text so it
   never fights the type. The rail stays as the hard edge. */
.ezlv-req.s-pending   { --lv-tint: var(--lv-warn-tint); }
.ezlv-req.s-approved  { --lv-tint: var(--lv-ok-tint); }
.ezlv-req.s-rejected  { --lv-tint: var(--lv-bad-tint); }
.ezlv-req.s-cancelled { --lv-tint: var(--lv-sunken); }
.ezlv-req::after {
  content: "";
  position: absolute;
  inset: 2px -9px;
  border-radius: var(--lv-r-sm);
  background: linear-gradient(90deg, var(--lv-tint, transparent) 0%, transparent 58%);
  pointer-events: none;
}

.ezlv-req::before,
.ezlv-hol::before {
  content: "";
  position: absolute;
  inset: 2px -9px;
  border-radius: var(--lv-r-sm);
  background: var(--lv-sunken);
  opacity: 0;
  pointer-events: none;
  transition: opacity .17s ease;
}
.ezlv-req:hover::before,
.ezlv-hol:hover::before { opacity: 1; }
.ezlv-req > *,
.ezlv-hol > * { position: relative; }

/* ── Narrow ─────────────────────────────────────────────────────────────── */

@media (max-width: 460px) {
  .ezlv-hero { padding: 16px 14px 14px; }
  .ezlv-hero-total b { font-size: 34px; }
  .ezlv-tiles { grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); }
  .ezlv-panel { padding: 13px 12px 14px; }
  .ezlv-day { min-height: 30px; font-size: 11px; }
  .ezlv-pill { margin-left: 0; }
}

/* Screen-reader-only, for the skeleton's status line. */
.ezlv-vh {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
`
