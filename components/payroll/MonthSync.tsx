'use client'
// components/payroll/MonthSync.tsx — Payroll → Attendance & Sync → Snapshot Sync.
// Re-freeze a payroll month's employee snapshot from current HRMS data (org / statutory /
// bank / CTC / salary + days_in_month) via sync_payroll_month — WITHOUT touching the
// attendance columns. Useful after CTC revisions / master edits once a month already exists.
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import { loadRuns, loadRunsForPeriod, prevPeriod, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { loadMonthDiff, buildChangeSheets, type MonthDiff } from '@/lib/payroll/monthDiff'
import {
  SYNC_CATEGORIES, loadSyncStatus, runCategorySync, runFullSync, loadCategoryRows, loadFilterCandidates,
  type SyncCategory, type SyncStatus, type SyncEmployee,
} from '@/lib/payroll/sync'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  greenBd: TK.positiveTint, amber: TK.warning, amberBg: TK.warningTint, purpleBg: TK.brandTint, gray: TK.sunken,
}
const font = '"DM Sans","Segoe UI",sans-serif'

// ── Month-over-month change table ──────────────────────────────────────────
// Sits under the sync card: for the selected payroll month, compares every frozen
// Month Master column against the previous month's and counts, per category, how many
// employees moved. Defined outside MonthSync so the toggle doesn't re-mount on re-render.
const periodLabel = (r: { period_label?: string | null; month?: number; fy?: string }) =>
  r.period_label || `${MONTHS[((r.month || 1) - 1)]} ${String(r.fy || '').split('-')[0]}`

function ChangeTable({ companyId, run }: { companyId: string; run: PayrollRun | null }) {
  const [diff, setDiff] = useState<MonthDiff | null>(null)
  const [prevMissing, setPrevMissing] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [withAtt, setWithAtt] = useState(false)

  const fyR = run?.fy || '', monthR = run?.month || 0

  const compare = useCallback(async () => {
    if (!fyR || !monthR) { setDiff(null); return }
    setBusy(true); setErr(''); setPrevMissing(''); setDiff(null)
    try {
      const p = prevPeriod(fyR, monthR)
      const [curRuns, prevRuns] = await Promise.all([
        loadRunsForPeriod(companyId, fyR, monthR),
        loadRunsForPeriod(companyId, p.fy, p.month),
      ])
      const curLabel = periodLabel(curRuns[0] || { month: monthR, fy: fyR })
      const prevLabel = periodLabel(prevRuns[0] || { month: p.month, fy: p.fy })
      if (!prevRuns.length) { setPrevMissing(prevLabel); return }
      setDiff(await loadMonthDiff(
        { label: curLabel, runs: curRuns.map(r => ({ id: r.id, company_name: r.company_name })) },
        { label: prevLabel, runs: prevRuns.map(r => ({ id: r.id, company_name: r.company_name })) },
        { includeAttendance: withAtt },
      ))
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }, [companyId, fyR, monthR, withAtt])
  useEffect(() => { compare() }, [compare])

  function download() {
    if (!diff) return
    const s = buildChangeSheets(diff)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.changes, { header: s.header }), 'Changes')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.summary, { header: s.summaryHeader }), 'Summary')
    // Previous values, same shape — a change sheet is only auditable next to what it replaced.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.previous, { header: s.header }), 'Previous Values')
    if (s.exited.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.exited, { header: s.exitedHeader }), 'Exited')

    const safe = (t: string) => (t || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
    XLSX.writeFile(wb, `Month_Master_Changes_${safe(diff.curLabel)}_vs_${safe(diff.prevLabel)}.xlsx`.replace(/_+/g, '_'))
  }

  const th: React.CSSProperties = { padding: '8px 12px', fontSize: 10, color: TK.brand, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 12px', color: C.navy, borderTop: `1px solid ${C.border}` }
  const stat = (label: string, value: any, color: string) => (
    <div key={label} style={{ background: C.gray, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 12px', minWidth: 96 }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.25 }}>{value}</div>
    </div>
  )

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginTop: 14, boxShadow: 'var(--ez-shadow-flat)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: C.purpleBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}></div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>Changes vs previous month</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {diff ? <>Comparing <b style={{ color: C.purpleD }}>{diff.curLabel}</b> against <b style={{ color: C.purpleD }}>{diff.prevLabel}</b> — every frozen Month Master column</>
              : 'Every frozen Month Master column, compared employee by employee'}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={withAtt} onChange={e => setWithAtt(e.target.checked)} style={{ accentColor: C.purple, cursor: 'pointer' }} />
          Include attendance &amp; OT
        </label>
        <button onClick={compare} disabled={busy || !run} style={{ padding: '7px 13px', borderRadius: 10, border: `1px solid ${C.border}`, background: TK.surface, color: C.purpleD, fontWeight: 600, fontSize: 12, fontFamily: font, cursor: busy ? 'not-allowed' : 'pointer' }}>⟳ Refresh</button>
        <button onClick={download} disabled={!diff || !diff.rows.length}
          style={{ padding: '8px 15px', borderRadius: 10, border: 'none', background: !diff || !diff.rows.length ? TK.brandTint : 'linear-gradient(120deg,#2563EB,#5B21B6)', color: TK.onAccent, fontWeight: 700, fontSize: 12, fontFamily: font, cursor: !diff || !diff.rows.length ? 'not-allowed' : 'pointer' }}>Download changes
        </button>
      </div>

      {busy && <div style={{ fontSize: 12, color: C.muted, padding: '10px 0' }}>Comparing months…</div>}
      {err && <div style={{ fontSize: 12, color: TK.critical, background: TK.criticalTint, borderRadius: 10, padding: '10px 14px' }}>{err}</div>}
      {!busy && !err && prevMissing && (
        <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, borderRadius: 10, padding: '10px 12px' }}>
          Nothing to compare against — <b>{prevMissing}</b> was never created for this selection. The first month of a company has no previous month master.
        </div>
      )}

      {!busy && diff && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {stat('Employees', diff.curCount, C.navy)}
            {stat('New', diff.newRows, C.green)}
            {stat('Changed', diff.changedRows, C.purple)}
            {stat('Exited', diff.exitedRows, C.amber)}
            {stat('No change', diff.unchangedRows, C.muted)}
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: C.purpleD }}>
                <th style={th}>Category</th>
                <th style={{ ...th, textAlign: 'right' }}>Employees changed</th>
                <th style={{ ...th, textAlign: 'right' }}>Columns changed</th>
              </tr></thead>
              <tbody>
                {diff.categories.map(c => (
                  <tr key={c.key} style={{ background: c.changed ? '#FDFCFF' : '#fff' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{c.label}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {!c.comparable ? <span style={{ fontSize: 11, color: C.muted }}>not frozen per month</span>
                        : <b style={{ fontSize: 14, color: c.changed ? C.purple : C.muted }}>{c.changed}</b>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: C.muted }}>{c.comparable ? c.fields : '—'}</td>
                  </tr>
                ))}
                <tr style={{ background: C.gray }}>
                  <td style={{ ...td, fontWeight: 700 }}>New employees this month</td>
                  <td style={{ ...td, textAlign: 'right' }}><b style={{ fontSize: 14, color: diff.newRows ? C.green : C.muted }}>{diff.newRows}</b></td>
                  <td style={{ ...td, textAlign: 'right', color: C.muted }}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 8, background: C.gray, borderRadius: 10, padding: '9px 11px', lineHeight: 1.5 }}>
            An employee is counted once per category, however many columns moved inside it — so “Bank details 1” means one employee’s bank data changed.
            {!withAtt && ' Attendance and OT are excluded by default because they change every month by design — tick the box to include them.'}
            {' '}<b>Download changes</b> gives one row per new or changed employee, carrying only emp code, name and the columns that actually changed — new joiners carry their full row, since all of it is new.
          </div>
        </>
      )}
    </div>
  )
}

// ── One category row ───────────────────────────────────────────────────────
// Defined outside the parent so a re-render (every sync, every counter refresh)
// doesn't remount the row and lose the button's busy state.
function CategoryRow({ cat, count, extra, busy, disabled, onSync, onDownload }: {
  cat: SyncCategory; count: number | null; extra?: React.ReactNode
  busy: boolean; disabled: boolean
  onSync: () => void; onDownload: () => void
}) {
  const ready = cat.status === 'ready'
  const global_ = cat.status === 'global'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: `1px solid ${C.border}` }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, flexShrink: 0, background: ready ? C.purpleBg : global_ ? TK.positiveTint: TK.sunken,
      }}>{cat.icon}</div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: ready || global_ ? C.navy : TK.faint }}>{cat.label}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>{cat.note}</div>
        {extra}
      </div>
      {ready ? (
        <>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '3px 11px', whiteSpace: 'nowrap' }}>
            {count == null ? '—' : count}
          </span>
          {/* Run Payroll owns these five and recomputes them every run, in an order that
              matters. A Sync button here could only produce a figure the next run
              overwrites — or, pressed out of order, a wrong one. The Download stays:
              this is where the EPF, ESIC, PT and LWF registers come from. */}
          {cat.syncable === false ? (
            <span title="Run Payroll computes this every time it runs — it is not synced by hand"
              style={{ fontSize: 11, fontWeight: 700, color: C.muted, background: TK.sunken, border: `1px solid ${C.border}`, borderRadius: 99, padding: '4px 12px', whiteSpace: 'nowrap' }}>
              Run Payroll
            </span>
          ) : (
            <button onClick={onSync} disabled={busy || disabled}
              style={{ padding: '7px 15px', borderRadius: 10, border: 'none', background: busy || disabled ? TK.brandTint : C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 12, fontFamily: font, cursor: busy || disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              {busy ? 'Syncing…' : 'Sync'}
            </button>
          )}
          <button onClick={onDownload} disabled={disabled} title={`Download ${cat.label} as frozen in this month`}
            style={{ padding: '7px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: TK.surface, color: C.muted, fontSize: 12, fontFamily: font, cursor: disabled ? 'not-allowed' : 'pointer' }}></button>
        </>
      ) : global_ ? (
        <>
          {count != null && <span style={{ fontSize: 12, fontWeight: 700, color: C.green, background: C.greenBg, borderRadius: 99, padding: '3px 11px', whiteSpace: 'nowrap' }}>{count}</span>}
          <span style={{ fontSize: 11, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 99, padding: '4px 12px', whiteSpace: 'nowrap' }}>Whole year</span>
        </>
      ) : (
        <span style={{ fontSize: 11, fontWeight: 700, color: TK.critical, background: TK.criticalTint, borderRadius: 99, padding: '4px 12px', whiteSpace: 'nowrap' }}>Planned</span>
      )}
    </div>
  )
}


// ── Employee picker ────────────────────────────────────────────────────────
// Pressing a category's Sync opens this: the month's employees, one checkbox each,
// with the count of what is about to be written shown on the button itself.
//
// Rendered through a PORTAL onto document.body, not in place. The payroll page sits
// under transform-animated wrappers (PageTransition, the sidebar's motion CSS), and a
// transformed ancestor becomes the containing block for position:fixed — so drawn in
// place, this overlay anchored itself to the page instead of the viewport and ran off
// the screen. On body there is no transformed ancestor to catch it.
//
// Everyone starts ticked, because syncing the whole month is the normal case and
// hand-picking 300 boxes to get there is not a choice anyone would make. Untick the
// few you want to leave alone.
//
// Defined OUTSIDE the parent — a modal remounted on every keystroke loses the search
// box's focus after one character.
function EmployeePicker({ cat, pool, busy, onCancel, onConfirm }: {
  cat: SyncCategory
  pool: SyncEmployee[]
  busy: boolean
  onCancel: () => void
  onConfirm: (codes: string[] | null) => void
}) {
  const [company, setCompany] = useState('')
  const [location, setLocation] = useState('')
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<Set<string>>(() => new Set(pool.map(e => e.code)))
  // Portals need the DOM; render nothing during SSR/first paint.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // The page behind must not scroll while the dialog is up — half the "broken UI"
  // reading was the list and the page scrolling as one.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const companies = Array.from(new Set(pool.map(e => e.company).filter(Boolean))).sort()
  const locations = Array.from(new Set(pool.map(e => e.location).filter(Boolean))).sort()

  // The search box takes a pasted list as readily as a single name — HR arrives with
  // emp codes in a column from Excel far more often than they arrive with one name.
  const tokens = search.split(/[,\n;\t]+/).map(t => t.trim()).filter(Boolean)
  const visible = pool.filter(e => {
    if (company && e.company !== company) return false
    if (location && e.location !== location) return false
    if (!tokens.length) return true
    return tokens.some(t => {
      const q = t.toLowerCase()
      return e.code.toLowerCase() === q || e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    })
  })
  const visibleCodes = visible.map(e => e.code)
  const allVisibleOn = visibleCodes.length > 0 && visibleCodes.every(c => sel.has(c))

  const toggle = (code: string) => setSel(prev => {
    const next = new Set(prev)
    if (next.has(code)) next.delete(code); else next.add(code)
    return next
  })
  const setMany = (codes: string[], on: boolean) => setSel(prev => {
    const next = new Set(prev)
    codes.forEach(c => (on ? next.add(c) : next.delete(c)))
    return next
  })

  const chosen = pool.filter(e => sel.has(e.code)).map(e => e.code)
  // Everyone ticked means "the whole month", which is what p_codes NULL already says
  // to every sync function.
  const codesForRpc = chosen.length === pool.length ? null : chosen

  const inp: React.CSSProperties = {
    padding: '8px 11px', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12.5,
    background: TK.sunken, color: C.navy, fontFamily: font, outline: 'none', boxSizing: 'border-box',
  }
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'

  if (!mounted) return null
  return createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.52)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
      backdropFilter: 'blur(2px)', fontFamily: font,
    }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" style={{
        background: TK.surface, borderRadius: 18, width: 'min(680px, 100%)',
        height: 'min(640px, calc(100vh - 48px))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(15,23,42,0.32), 0 4px 16px rgba(15,23,42,0.14)',
      }}>

        {/* ── header ── */}
        <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: C.purpleBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{cat.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: C.navy }}>Sync {cat.label}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>Choose whose {cat.label.toLowerCase()} to refresh from HRMS into this month.</div>
            </div>
            <button onClick={onCancel} aria-label="Close" style={{
              width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.border}`, background: TK.surface,
              color: C.muted, fontSize: 15, cursor: 'pointer', lineHeight: 1, flexShrink: 0,
            }}>✕</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 13, flexWrap: 'wrap' }}>
            {companies.length > 1 && (
              <select style={{ ...inp, flex: '0 1 170px' }} value={company} onChange={e => setCompany(e.target.value)}>
                <option value="">All companies</option>
                {companies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {locations.length > 1 && (
              <select style={{ ...inp, flex: '0 1 150px' }} value={location} onChange={e => setLocation(e.target.value)}>
                <option value="">All locations</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
            <input style={{ ...inp, flex: '1 1 180px', minWidth: 150 }} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍  Name, emp code — or paste a list" />
          </div>
        </div>

        {/* ── select-all bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 20px',
          background: TK.sunken, borderBottom: `1px solid ${C.border}`, fontSize: 12, flexShrink: 0,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontWeight: 700, color: C.purpleD, userSelect: 'none' }}>
            <input type="checkbox" checked={allVisibleOn} onChange={e => setMany(visibleCodes, e.target.checked)}
              style={{ width: 15, height: 15, accentColor: C.purple, cursor: 'pointer' }} />
            {allVisibleOn ? 'Unselect' : 'Select'} {visible.length === pool.length ? 'all' : `these ${visible.length}`}
          </label>
          <button onClick={() => setSel(new Set())}
            style={{ border: 'none', background: 'none', color: TK.critical, fontSize: 11.5, fontWeight: 700, fontFamily: font, cursor: 'pointer', padding: 0 }}>
            Clear all
          </button>
          <span style={{ marginLeft: 'auto', color: C.muted }}>
            {visible.length === pool.length ? `${pool.length} employees` : `${visible.length} of ${pool.length} shown`}
          </span>
        </div>

        {/* ── list — the ONLY thing that scrolls ── */}
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '6px 10px' }}>
          {visible.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: C.muted, fontSize: 12.5 }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>🔍</div>
              Nobody matches this search.
            </div>
          ) : visible.map(e => {
            const on = sel.has(e.code)
            return (
              <label key={e.code} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '7px 10px', borderRadius: 10,
                cursor: 'pointer', background: on ? C.purpleBg : 'transparent', marginBottom: 1, userSelect: 'none',
              }}>
                <input type="checkbox" checked={on} onChange={() => toggle(e.code)}
                  style={{ width: 15, height: 15, accentColor: C.purple, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', background: on ? C.purple : TK.sunken,
                  color: on ? TK.onAccent : C.purpleD, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>{initials(e.name)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: C.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || '—'}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: C.muted, fontFamily: 'ui-monospace, monospace' }}>{e.code}</span>
                </span>
                {e.location && <span style={{ fontSize: 10.5, color: C.muted, whiteSpace: 'nowrap', flexShrink: 0 }}>{e.location}</span>}
                {e.company && <span style={{ fontSize: 10, fontWeight: 600, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>{e.company}</span>}
              </label>
            )
          })}
        </div>

        {/* ── footer ── */}
        <div style={{
          padding: '13px 20px', borderTop: `1px solid ${C.border}`, background: TK.surface,
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <div style={{ flex: 1, fontSize: 11.5, color: C.muted, lineHeight: 1.5, minWidth: 0 }}>
            {chosen.length === 0
              ? <b style={{ color: TK.critical }}>Nobody selected — nothing to sync.</b>
              : <>Writing <b style={{ color: C.navy }}>{chosen.length}</b> of {pool.length}. Only <b>{cat.label}</b> changes; the rest stays frozen.</>}
          </div>
          <button onClick={onCancel} style={{
            padding: '9px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: TK.surface,
            color: C.navy, fontWeight: 600, fontSize: 12.5, fontFamily: font, cursor: 'pointer', flexShrink: 0,
          }}>Cancel</button>
          <button onClick={() => onConfirm(codesForRpc)} disabled={busy || chosen.length === 0}
            style={{
              padding: '9px 20px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12.5, fontFamily: font,
              background: busy || chosen.length === 0 ? TK.brandTint : C.purple, color: TK.onAccent,
              cursor: busy || chosen.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              boxShadow: busy || chosen.length === 0 ? 'none' : '0 3px 10px rgba(37,99,235,0.25)',
            }}>
            {busy ? 'Syncing…' : `Sync ${chosen.length} employee${chosen.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}


export default function MonthSync({ companyId, fy }: { companyId: string; fy: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [monthVal, setMonthVal] = useState('')        // month number — one entry per month, not per company
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [migrationDetail, setMigrationDetail] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState('')
  const [pool, setPool] = useState<SyncEmployee[]>([])
  // Which category's employee picker is open. Selection is per-press and is thrown away
  // afterwards, so no sync can inherit a choice made for a different one.
  const [pickerCat, setPickerCat] = useState<SyncCategory | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    loadRuns(companyId, fy).then(list => {
      setRuns(list)
      setMonthVal(p => (list.some(r => String(r.month) === p) ? p : String(list[0]?.month ?? '')))
    }).catch(e => setErr(e.message))
  }, [companyId, fy])

  // In Group Companies mode one calendar month spans several runs — one per company.
  // The screen works off that whole set, so the month appears once instead of three times.
  const monthRuns = runs.filter(r => String(r.month) === monthVal)
  const runIds = monthRuns.map(r => r.id)
  const sel = monthRuns[0] || null

  const refresh = useCallback(async () => {
    if (!runIds.length) { setStatus(null); setNeedsMigration(false); setMigrationDetail(null); return }
    try {
      // Whole month, always. The badge answers "how many are in this month", and the
      // picker answers "how many am I about to write" — two different questions, and
      // making one counter try to say both is what made the old filter confusing.
      const { status: s, missing, detail } = await loadSyncStatus(runIds, null)
      setStatus(missing ? null : s); setNeedsMigration(missing); setMigrationDetail(detail)
    } catch (e: any) { setErr(e.message || String(e)) }
  }, [runIds.join(',')])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!monthRuns.length) { setPool([]); return }
    loadFilterCandidates(monthRuns.map(r => ({ id: r.id, company_id: r.company_id, company_name: r.company_name })))
      .then(setPool).catch(e => setErr(e.message || String(e)))
  }, [runIds.join(',')])   // eslint-disable-line react-hooks/exhaustive-deps

  async function syncCategory(cat: SyncCategory, codes: string[] | null) {
    if (!runIds.length) return
    setBusyKey(cat.key); setMsg(''); setErr('')
    const { error, count } = await runCategorySync(cat, runIds, codes)
    setBusyKey(''); setPickerCat(null)
    if (error) { setErr(error); return }
    setMsg(`${cat.label} synced — ${count} employee${count === 1 ? '' : 's'} refreshed from HRMS`
      + (codes ? ` (the ${codes.length} you selected)` : ' (the whole month)')
      + `, into ${label}. Every other category is untouched.`)
    refresh()
  }

  async function syncEverything() {
    if (!runIds.length) return
    setBusyKey('all'); setMsg(''); setErr('')
    const { error, count } = await runFullSync(runIds)
    setBusyKey('')
    if (error) { setErr(error); return }
    setMsg(`Full re-sync done — ${count} employees frozen from current HRMS data.`)
    refresh()
  }

  async function download(cat: SyncCategory) {
    setErr('')
    try {
      const rows = await loadCategoryRows(cat, monthRuns.map(r => ({ id: r.id, company_name: r.company_name })), null)
      if (!rows.length) { setErr(`No ${cat.label} rows for this month yet.`); return }
      const header: string[] = []
      rows.forEach(r => Object.keys(r).forEach(k => { if (!header.includes(k)) header.push(k) }))
      if (!isGroup) { const i = header.indexOf('Company'); if (i >= 0) header.splice(i, 1) }
      const ws = XLSX.utils.json_to_sheet(rows, { header })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, cat.label.slice(0, 30))
      const safe = (s: string) => (s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
      XLSX.writeFile(wb, `${safe(cat.label)}_${safe(label)}.xlsx`.replace(/_+/g, '_'))
    } catch (e: any) { setErr('Download failed: ' + (e.message || e)) }
  }

  const isGroup = !companyId
  const label = sel ? periodLabel(sel) : ''
  // TDS is deliberately not a button here. It reads this month's arrear, professional tax
  // and earned income — all of which only mean anything once Run Payroll has settled
  // them — so syncing it on its own ahead of time would show a number the run is about
  // to overwrite anyway. Run Payroll calls sync_month_tds() itself, last, and the figure
  // shows up on the downloaded sheet from there.
  const DATA_SYNC_CATEGORIES = SYNC_CATEGORIES.filter(c => c.key !== 'tds')
  const readyCount = DATA_SYNC_CATEGORIES.filter(c => c.status === 'ready' && c.syncable !== false).length
  const runOwnedCount = DATA_SYNC_CATEGORIES.filter(c => c.status === 'ready' && c.syncable === false).length
  const globalCount = DATA_SYNC_CATEGORIES.filter(c => c.status === 'global').length
  const plannedCount = DATA_SYNC_CATEGORIES.length - readyCount - runOwnedCount - globalCount
  const inp: React.CSSProperties = { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, background: TK.surface, color: C.navy, fontFamily: font, outline: 'none' }
  const monthOpts = Array.from(new Map(runs.map(r => [r.month, r])).values()).sort((a, b) => (a.month || 0) - (b.month || 0))

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: `linear-gradient(135deg,${TK.brand},${TK.brand})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(37,99,235,0.28)', flexShrink: 0 }}></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Snapshot Sync</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
            Sync each category on its own — nothing moves into Month Master unless you choose it. Attendance, OT and arrear are never touched by any of these.
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap', paddingTop: 4 }}>
          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: C.green, marginRight: 5 }} />{readyCount} ready
          {runOwnedCount > 0 && <><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TK.line, margin: '0 5px 0 12px' }} />{runOwnedCount} run by payroll</>}
          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TK.positiveTint, margin: '0 5px 0 12px' }} />{globalCount} whole-year
          {plannedCount > 0 && <><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: TK.line, margin: '0 5px 0 12px' }} />{plannedCount} planned</>}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', boxShadow: 'var(--ez-shadow-flat)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', marginBottom: 6 }}>
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Payroll month</label>
            <select style={{ ...inp, minWidth: 220 }} value={monthVal} onChange={e => { setMonthVal(e.target.value); setMsg(''); setErr('') }}>
              {monthOpts.length === 0 && <option value="">No month created — create one first</option>}
              {monthOpts.map(r => <option key={r.month} value={String(r.month)}>{periodLabel(r)}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: C.muted, paddingBottom: 8 }}>
            {sel && <>Status: <b style={{ color: C.purple }}>{isGroup && monthRuns.length > 1 ? `${monthRuns.length} companies` : sel.status}</b></>}
            {status && <> · in Month Master: <b style={{ color: C.navy }}>{status.in_month}</b></>}
          </div>
        </div>

        {status?.is_locked && (
          <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, borderRadius: 10, padding: '10px 12px', margin: '8px 0', lineHeight: 1.5 }}>
            This month is <b>locked / disbursed</b> — every category sync is disabled. A locked month should not be changed quietly by a small sync; reopen it formally through <b>Lock / Unlock</b> first. (The database will refuse it anyway.)
          </div>
        )}

        {needsMigration && (
          <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, borderRadius: 10, padding: '10px 12px', margin: '8px 0', lineHeight: 1.5 }}>
            Category-wise sync is off — the database could not resolve one of its functions.
            {migrationDetail && <div style={{ marginTop: 5, fontFamily: 'ui-monospace, monospace', fontSize: 11, opacity: .85 }}>{migrationDetail}</div>}
            <div style={{ marginTop: 5 }}>Run the migration that creates that function, then reload.</div>
            <button onClick={syncEverything} disabled={busyKey === 'all' || !runIds.length}
              style={{ marginLeft: 10, padding: '5px 12px', borderRadius: 7, border: 'none', background: C.amber, color: TK.onAccent, fontWeight: 700, fontSize: 11, fontFamily: font, cursor: 'pointer' }}>
              {busyKey === 'all' ? 'Syncing…' : 'Re-sync everything (old behaviour)'}
            </button>
          </div>
        )}

        {DATA_SYNC_CATEGORIES.map(cat => (
          <CategoryRow key={cat.key} cat={cat}
            count={status && cat.countKey ? status[cat.countKey] : null}
            busy={busyKey === cat.key}
            disabled={!runIds.length || needsMigration || !!status?.is_locked || (!!busyKey && busyKey !== cat.key)}
            onSync={() => setPickerCat(cat)}
            onDownload={() => download(cat)}
            extra={cat.key === 'employee' && status && (status.new_joiners > 0 || status.leavers > 0) ? (
              <div style={{ fontSize: 11, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {status.new_joiners > 0 && <span style={{ color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 99, padding: '2px 9px', fontWeight: 700 }}>+{status.new_joiners} new joiner{status.new_joiners === 1 ? '' : 's'} waiting</span>}
                {status.leavers > 0 && <span style={{ color: C.amber, background: C.amberBg, border: `1px solid ${TK.warningTint}`, borderRadius: 99, padding: '2px 9px', fontWeight: 700 }}>{status.leavers} no longer eligible</span>}
              </div>
            ) : undefined}
          />
        ))}

        <div style={{ fontSize: 11, color: C.purpleD, marginTop: 14, background: C.purpleBg, borderRadius: 10, padding: '11px 13px', lineHeight: 1.6 }}>
          <b>Month Create already runs Employee info, Bank, Salary and Flexi automatically.</b> Use a category’s Sync button after a CTC revision, transfer, bank change or fresh declaration — <b>only that category refreshes</b>, the rest stay exactly as they were frozen. Paid days, leave, OT and arrear stay as uploaded no matter which button you press. New joiners come in through <b>Employee info</b>, and they arrive with their full row — a joiner with a blank salary would be paid zero.
        </div>

        {msg && <div style={{ fontSize: 13, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 10, padding: '10px 14px', marginTop: 12 }}>✓ {msg}</div>}
        {err && <div style={{ fontSize: 12, color: TK.critical, background: TK.criticalTint, borderRadius: 10, padding: '10px 14px', marginTop: 12 }}>{err}</div>}
      </div>

      {pickerCat && pool.length > 0 && (
        <EmployeePicker
          key={pickerCat.key}
          cat={pickerCat}
          pool={pool}
          busy={busyKey === pickerCat.key}
          onCancel={() => setPickerCat(null)}
          onConfirm={codes => syncCategory(pickerCat, codes)}
        />
      )}

      <ChangeTable companyId={companyId} run={sel} />
    </div>
  )
}
