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
  loadPendingChanges,
  type SyncCategory, type SyncStatus, type SyncEmployee,
} from '@/lib/payroll/sync'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import {
  C as TK, F, W, S as SP, R, E, numeric, type Tone,
  IconUser, IconCompliance, IconPayroll, IconSliders, IconFinance, IconBuilding, IconHeart, IconPerformance,
  IconReceipt, IconLoans, IconCheck, IconDownload, IconSearch, IconClose, IconLock, IconAlert,
} from '@/lib/ui'
import {
  SectionCard, InfoCallout, PButton, ControlSelect, KpiTile, KpiGrid, DataTable, EmptyState, StatusPill, RunStatusPill,
  CountChip, IconTile, IconBank, IconSync, IconLayers, IconFile, IconMonth, dt,
} from '@/components/payroll/kit'
import { ScreenIntro, Note } from './attendanceShared'

const font = '"DM Sans","Segoe UI",sans-serif'
const scrim = `color-mix(in srgb, ${TK.dark} 52%, transparent)`

// A line icon per sync category, in place of the emoji the category list carries —
// same 20px stroke family as the rest of the payroll screens. Presentation only.
function CatIcon({ k, size = 16 }: { k: string; size?: number }) {
  switch (k) {
    case 'employee': return <IconUser size={size} />
    case 'statutory': case 'pt': return <IconCompliance size={size} />
    case 'bank': return <IconBank size={size} />
    case 'salary': return <IconPayroll size={size} />
    case 'flexi': return <IconSliders size={size} />
    case 'earnings': return <IconFinance size={size} />
    case 'epf': case 'lwf': case 'nps': return <IconBuilding size={size} />
    case 'esic': return <IconHeart size={size} />
    case 'arrear': return <IconPerformance size={size} />
    case 'flexi_reimb': case 'tds': return <IconReceipt size={size} />
    case 'loan': return <IconLoans size={size} />
    case 'inv_decl': return <IconFile size={size} />
    case 'inv_proof': return <IconCheck size={size} />
    default: return <IconLayers size={size} />
  }
}

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

  const noDownload = !diff || !diff.rows.length

  return (
    <SectionCard icon={<IconLayers size={16} />} title="Changes vs previous month"
      hint={diff ? <>Comparing <b style={{ color: TK.brandDeep }}>{diff.curLabel}</b> against <b style={{ color: TK.brandDeep }}>{diff.prevLabel}</b>: every frozen Month Master column</>
        : 'Every frozen Month Master column, compared employee by employee'}
      actions={<>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: TK.inkSoft, cursor: 'pointer', fontWeight: W.medium }}>
          <input type="checkbox" checked={withAtt} onChange={e => setWithAtt(e.target.checked)} style={{ accentColor: TK.brand, cursor: 'pointer', width: 15, height: 15 }} />
          Include attendance &amp; OT
        </label>
        <PButton size="sm" icon={<IconSync size={14} />} onClick={compare} disabled={busy || !run}>Refresh</PButton>
        <PButton size="sm" variant="primary" icon={<IconDownload size={14} />} onClick={download} disabled={noDownload}>Download changes</PButton>
      </>}>

      {busy && <div style={{ fontSize: F.tiny, color: TK.muted, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}><IconSync size={13} /> Comparing months…</div>}
      {err && <InfoCallout t="critical" compact style={{ marginBottom: 0 }}>{err}</InfoCallout>}
      {!busy && !err && prevMissing && (
        <InfoCallout t="warning" compact style={{ marginBottom: 0 }}>
          Nothing to compare against: <b>{prevMissing}</b> was never created for this selection. The first month of a company has no previous month master.
        </InfoCallout>
      )}

      {!busy && diff && (
        <>
          <KpiGrid min={130}>
            <KpiTile label="Employees" value={diff.curCount} />
            <KpiTile label="New" value={diff.newRows} t="positive" />
            <KpiTile label="Changed" value={diff.changedRows} t="brand" />
            <KpiTile label="Exited" value={diff.exitedRows} t="warning" />
            <KpiTile label="No change" value={<span style={{ color: TK.muted }}>{diff.unchangedRows}</span>} />
          </KpiGrid>
          <DataTable framed minWidth={420}>
            <thead><tr>
              <th style={dt.th}>Category</th>
              <th style={dt.thNum}>Employees changed</th>
              <th style={dt.thNum}>Columns changed</th>
            </tr></thead>
            <tbody>
              {diff.categories.map(c => (
                <tr key={c.key} className={dt.rowClass} style={{ background: c.changed ? `color-mix(in srgb, ${TK.brandTint} 45%, ${TK.surface})` : undefined }}>
                  <td style={dt.tdStrong}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ display: 'inline-flex', color: c.changed ? TK.brand : TK.faint }}><CatIcon k={c.key} size={14} /></span>
                      {c.label}
                    </span>
                  </td>
                  <td style={dt.tdNum}>
                    {!c.comparable ? <span style={{ fontSize: F.micro, color: TK.muted }}>not frozen per month</span>
                      : <b style={{ fontSize: F.body, color: c.changed ? TK.brandDeep : TK.muted }}>{c.changed}</b>}
                  </td>
                  <td style={{ ...dt.tdNum, color: TK.muted }}>{c.comparable ? c.fields : '-'}</td>
                </tr>
              ))}
              <tr style={{ background: TK.sunken }}>
                <td style={{ ...dt.tdStrong, fontWeight: W.bold }}>New employees this month</td>
                <td style={dt.tdNum}><b style={{ fontSize: F.body, color: diff.newRows ? TK.positive : TK.muted }}>{diff.newRows}</b></td>
                <td style={{ ...dt.tdNum, color: TK.muted }}>-</td>
              </tr>
            </tbody>
          </DataTable>
          <Note style={{ marginTop: SP.md }}>
            An employee is counted once per category, however many columns moved inside it, so “Bank details 1” means one employee’s bank data changed.
            {!withAtt && ' Attendance and OT are excluded by default because they change every month by design. Tick the box to include them.'}
            {' '}<b>Download changes</b> gives one row per new or changed employee, carrying only emp code, name and the columns that actually changed. New joiners carry their full row, since all of it is new.
          </Note>
        </>
      )}
    </SectionCard>
  )
}

// ── One category row ───────────────────────────────────────────────────────
// Defined outside the parent so a re-render (every sync, every counter refresh)
// doesn't remount the row and lose the button's busy state.
function CategoryRow({ cat, count, extra, busy, busyText, disabled, onSync, onDownload }: {
  cat: SyncCategory; count: number | null; extra?: React.ReactNode
  busy: boolean; busyText?: string; disabled: boolean
  onSync: () => void; onDownload: () => void
}) {
  const ready = cat.status === 'ready'
  const global_ = cat.status === 'global'
  const runOwned = ready && cat.syncable === false
  const t: Tone = ready ? (runOwned ? 'neutral' : 'brand') : global_ ? 'positive' : 'neutral'
  return (
    <div className="ez-row" style={{ display: 'flex', alignItems: 'center', gap: SP.md, padding: `${SP.md}px ${SP.lg}px`, borderTop: `1px solid ${TK.line}`, flexWrap: 'wrap' }}>
      <IconTile icon={<CatIcon k={cat.key} />} t={t} size={34} />
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: ready || global_ ? TK.ink : TK.faint, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {cat.label}
        </div>
        <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: 2, lineHeight: 1.45 }}>{cat.note}</div>
        {extra}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap', marginLeft: 'auto' }}>
      {ready ? (
        <>
          <span title="Employees in this category for the month" style={{ minWidth: 34, textAlign: 'center', fontSize: F.small, fontWeight: W.bold, color: TK.brandDeep, background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, borderRadius: R.pill, padding: '3px 11px', whiteSpace: 'nowrap', ...numeric }}>
            {count == null ? '-' : count}
          </span>
          {/* Run Payroll owns these five and recomputes them every run, in an order that
              matters. A Sync button here could only produce a figure the next run
              overwrites — or, pressed out of order, a wrong one. The Download stays:
              this is where the EPF, ESIC, PT and LWF registers come from. */}
          {cat.syncable === false ? (
            <span title="Run Payroll computes this every time it runs. It is not synced by hand">
              <StatusPill t="neutral" icon={<IconLock size={12} />}>Run Payroll</StatusPill>
            </span>
          ) : (
            <PButton size="sm" variant="primary" icon={<IconSync size={13} />} onClick={onSync} disabled={busy || disabled} style={{ minWidth: 86 }}>
              {busy ? (busyText || 'Syncing…') : 'Sync'}
            </PButton>
          )}
          <PButton size="sm" onClick={onDownload} disabled={disabled} title={`Download ${cat.label} as frozen in this month`}
            icon={<IconDownload size={14} />} style={{ padding: '0 9px' }} />
        </>
      ) : global_ ? (
        <>
          {count != null && <span style={{ fontSize: F.small, fontWeight: W.bold, color: TK.positive, background: TK.positiveTint, border: `1px solid ${TK.positiveEdge}`, borderRadius: R.pill, padding: '3px 11px', whiteSpace: 'nowrap', ...numeric }}>{count}</span>}
          <StatusPill t="positive" dot>Whole year</StatusPill>
        </>
      ) : (
        <StatusPill t="neutral" dot>Planned</StatusPill>
      )}
      </div>
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
function EmployeePicker({ cat, pool, pending, busy, onCancel, onConfirm }: {
  cat: SyncCategory
  pool: SyncEmployee[]
  /** code → which fields changed (086). null = no diff for this category → whole month. */
  pending: Map<string, string> | null
  busy: boolean
  onCancel: () => void
  onConfirm: (codes: string[] | null) => void
}) {
  const [company, setCompany] = useState('')
  const [location, setLocation] = useState('')
  const [search, setSearch] = useState('')
  // When the database can say who changed, the list opens on exactly those people
  // and only they start ticked — that IS the answer to "who needs this sync".
  // "Show all" stays one click away for the deliberate re-sync of somebody clean.
  const diffMode = pending !== null
  const [showAll, setShowAll] = useState(!diffMode)
  const [sel, setSel] = useState<Set<string>>(() =>
    diffMode ? new Set(pending!.keys()) : new Set(pool.map(e => e.code)))
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
  const base = diffMode && !showAll ? pool.filter(e => pending!.has(e.code)) : pool
  const visible = base.filter(e => {
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
    height: 36, padding: '0 11px', border: `1px solid ${TK.lineStrong}`, borderRadius: R.md, fontSize: F.small,
    background: TK.surface, color: TK.ink, fontFamily: font, outline: 'none', boxSizing: 'border-box',
  }
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'

  if (!mounted) return null
  return createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: scrim, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
      backdropFilter: 'blur(2px)', fontFamily: font,
    }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" className="ez-rise" style={{
        background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: R.xl, width: 'min(700px, 100%)',
        height: 'min(660px, calc(100vh - 48px))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: E.overlay,
      }}>

        {/* ── header ── */}
        <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${TK.line}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SP.md }}>
            <IconTile icon={<CatIcon k={cat.key} size={18} />} t="brand" size={40} solid />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: F.lead, fontWeight: W.bold, color: TK.ink }}>Sync {cat.label}</div>
              <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: 2 }}>
                {diffMode
                  ? <>Only people whose {cat.label.toLowerCase()} changed in HRMS since this month was frozen.</>
                  : <>Choose whose {cat.label.toLowerCase()} to refresh from HRMS into this month.</>}
              </div>
            </div>
            <button onClick={onCancel} aria-label="Close" className="ez-press" style={{
              width: 32, height: 32, borderRadius: R.sm, border: `1px solid ${TK.line}`, background: TK.surface,
              color: TK.muted, cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}><IconClose size={15} /></button>
          </div>

          <div style={{ display: 'flex', gap: SP.sm, marginTop: 13, flexWrap: 'wrap' }}>
            {companies.length > 1 && (
              <select style={{ ...inp, flex: '0 1 170px', cursor: 'pointer' }} value={company} onChange={e => setCompany(e.target.value)}>
                <option value="">All companies</option>
                {companies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {locations.length > 1 && (
              <select style={{ ...inp, flex: '0 1 150px', cursor: 'pointer' }} value={location} onChange={e => setLocation(e.target.value)}>
                <option value="">All locations</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
            <span style={{ position: 'relative', flex: '1 1 180px', minWidth: 150, display: 'block' }}>
              <span aria-hidden style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TK.muted, display: 'inline-flex', pointerEvents: 'none' }}><IconSearch size={14} /></span>
              <input style={{ ...inp, width: '100%', paddingLeft: 32 }} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Name, emp code, or paste a list" />
            </span>
          </div>
        </div>

        {/* ── select-all bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: SP.md, padding: '8px 20px', flexWrap: 'wrap',
          background: TK.sunken, borderBottom: `1px solid ${TK.line}`, fontSize: F.tiny, flexShrink: 0,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontWeight: W.semi, color: TK.brandDeep, userSelect: 'none' }}>
            <input type="checkbox" checked={allVisibleOn} onChange={e => setMany(visibleCodes, e.target.checked)}
              style={{ width: 15, height: 15, accentColor: TK.brand, cursor: 'pointer' }} />
            {allVisibleOn ? 'Unselect' : 'Select'} {visible.length === pool.length ? 'all' : `these ${visible.length}`}
          </label>
          <button onClick={() => setSel(new Set())}
            style={{ border: 'none', background: 'none', color: TK.critical, fontSize: F.tiny, fontWeight: W.semi, fontFamily: font, cursor: 'pointer', padding: 0 }}>
            Clear all
          </button>
          {diffMode && (
            <button onClick={() => setShowAll(v => !v)}
              style={{ border: 'none', background: 'none', color: TK.brandDeep, fontSize: F.tiny, fontWeight: W.semi, fontFamily: font, cursor: 'pointer', padding: 0 }}>
              {showAll ? `← Only changed (${pending!.size})` : `Show all ${pool.length}`}
            </button>
          )}
          <span style={{ marginLeft: 'auto', color: TK.muted, ...numeric }}>
            {diffMode && !showAll
              ? `${pending!.size} changed of ${pool.length}`
              : visible.length === base.length ? `${base.length} employees` : `${visible.length} of ${base.length} shown`}
          </span>
        </div>

        {/* ── list — the ONLY thing that scrolls ── */}
        <div className="ez-scroll" style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '6px 10px' }}>
          {visible.length === 0 ? (
            diffMode && !showAll && !tokens.length && !company && !location ? (
              <EmptyState t="positive" title={<span style={{ color: TK.positive }}>Nothing to sync: everyone's {cat.label.toLowerCase()} matches HRMS.</span>}
                action={<PButton size="sm" onClick={() => setShowAll(true)}>Show all {pool.length} anyway</PButton>} />
            ) : (
              <EmptyState t="neutral" icon={<IconSearch size={20} />} title="Nobody matches this search." />
            )
          ) : visible.map(e => {
            const on = sel.has(e.code)
            return (
              <label key={e.code} className={on ? undefined : 'ez-row'} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '7px 10px', borderRadius: R.md,
                cursor: 'pointer', background: on ? TK.brandTint : 'transparent', marginBottom: 1, userSelect: 'none',
              }}>
                <input type="checkbox" checked={on} onChange={() => toggle(e.code)}
                  style={{ width: 15, height: 15, accentColor: TK.brand, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', background: on ? TK.brand : TK.sunken,
                  color: on ? TK.onAccent : TK.brandDeep, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: F.micro, fontWeight: W.bold, flexShrink: 0, border: on ? 'none' : `1px solid ${TK.line}`,
                }}>{initials(e.name)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: F.small, fontWeight: W.semi, color: TK.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || '-'}</span>
                  <span style={{ display: 'block', fontSize: F.micro, color: TK.muted, fontFamily: 'ui-monospace, monospace' }}>{e.code}</span>
                  {pending?.get(e.code) && (
                    <span style={{ display: 'block', fontSize: F.micro, color: TK.warning, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={pending.get(e.code)}>
                      ↻ {pending.get(e.code)}
                    </span>
                  )}
                </span>
                {e.location && <span style={{ fontSize: F.micro, color: TK.muted, whiteSpace: 'nowrap', flexShrink: 0 }}>{e.location}</span>}
                {e.company && <StatusPill t="brand" size="sm">{e.company}</StatusPill>}
              </label>
            )
          })}
        </div>

        {/* ── footer ── */}
        <div style={{
          padding: '13px 20px', borderTop: `1px solid ${TK.line}`, background: TK.sunken,
          display: 'flex', alignItems: 'center', gap: SP.md, flexShrink: 0, flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 220px', fontSize: F.tiny, color: TK.muted, lineHeight: 1.5, minWidth: 0, ...numeric }}>
            {chosen.length === 0
              ? <b style={{ color: TK.critical }}>Nobody selected, nothing to sync.</b>
              : <>Writing <b style={{ color: TK.ink }}>{chosen.length}</b> of {pool.length}. Only <b>{cat.label}</b> changes; the rest stays frozen.</>}
          </div>
          <PButton onClick={onCancel}>Cancel</PButton>
          <PButton variant="primary" icon={<IconSync size={14} />} onClick={() => onConfirm(codesForRpc)} disabled={busy || chosen.length === 0}>
            {busy ? 'Syncing…' : `Sync ${chosen.length} employee${chosen.length === 1 ? '' : 's'}`}
          </PButton>
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
  // What payroll_sync_pending() said for the open picker's category — fetched at the
  // moment Sync is pressed, so the list is what changed as of NOW, not page load.
  const [pendingMap, setPendingMap] = useState<Map<string, string> | null>(null)
  const [checkingKey, setCheckingKey] = useState('')
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

  async function openPicker(cat: SyncCategory) {
    if (!runIds.length || checkingKey) return
    setCheckingKey(cat.key); setMsg(''); setErr('')
    // null = category has no diff, or 086 is not applied yet — the picker then
    // shows the whole month exactly as before, so nothing breaks either way.
    const m = await loadPendingChanges(cat, runIds).catch(() => null)
    setCheckingKey('')
    setPendingMap(m)
    setPickerCat(cat)
  }

  async function syncCategory(cat: SyncCategory, codes: string[] | null) {
    if (!runIds.length) return
    setBusyKey(cat.key); setMsg(''); setErr('')
    const { error, count } = await runCategorySync(cat, runIds, codes)
    setBusyKey(''); setPickerCat(null)
    if (error) { setErr(error); return }
    setMsg(`${cat.label} synced: ${count} employee${count === 1 ? '' : 's'} refreshed from HRMS`
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
    setMsg(`Full re-sync done: ${count} employees frozen from current HRMS data.`)
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
  const monthOpts = Array.from(new Map(runs.map(r => [r.month, r])).values()).sort((a, b) => (a.month || 0) - (b.month || 0))

  return (
    <div style={{ fontFamily: font, fontSize: F.small, color: TK.ink, maxWidth: 960 }}>
      <ScreenIntro icon={<IconSync size={20} />} title="Snapshot Sync"
        subtitle="Sync each category on its own. Nothing moves into Month Master unless you choose it. Attendance, OT and arrear are never touched by any of these."
        meta={<>
          <StatusPill t="brand" size="sm" dot>{readyCount} ready</StatusPill>
          {runOwnedCount > 0 && <StatusPill t="neutral" size="sm" icon={<IconLock size={11} />}>{runOwnedCount} run by payroll</StatusPill>}
          <StatusPill t="positive" size="sm" dot>{globalCount} whole-year</StatusPill>
          {plannedCount > 0 && <StatusPill t="neutral" size="sm" dot>{plannedCount} planned</StatusPill>}
        </>}
        actions={
          <ControlSelect label="Payroll month" icon={<IconMonth size={15} />} strong minWidth={200}
            value={monthVal} onChange={e => { setMonthVal(e.target.value); setMsg(''); setErr('') }}>
            {monthOpts.length === 0 && <option value="">No month yet. Create one first</option>}
            {monthOpts.map(r => <option key={r.month} value={String(r.month)}>{periodLabel(r)}</option>)}
          </ControlSelect>
        }>
        {(sel || status) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap', fontSize: F.tiny, color: TK.muted }}>
            {sel && <>
              <span>Status</span>
              {isGroup && monthRuns.length > 1
                ? <StatusPill t="info" size="sm" icon={<IconBuilding size={12} />}>{monthRuns.length} companies</StatusPill>
                : <RunStatusPill status={sel.status} raw size="sm" />}
            </>}
            {status && <>
              <span style={{ marginLeft: SP.sm }}>in Month Master</span>
              <CountChip t="brand">{status.in_month}</CountChip>
            </>}
            {status?.is_locked && <StatusPill t="warning" size="sm" icon={<IconLock size={11} />}>Locked</StatusPill>}
          </div>
        )}
      </ScreenIntro>

      {status?.is_locked && (
        <InfoCallout t="warning" icon={<IconLock size={16} />} title="Every category sync is disabled">
          This month is <b>locked / disbursed</b>, so every category sync is disabled. A locked month should not be changed quietly by a small sync; reopen it formally through <b>Lock / Unlock</b> first. (The database will refuse it anyway.)
        </InfoCallout>
      )}

      {needsMigration && (
        <InfoCallout t="warning" icon={<IconAlert size={16} />} title="Category-wise sync is off"
          action={
            <PButton size="sm" onClick={syncEverything} disabled={busyKey === 'all' || !runIds.length}
              style={{ color: TK.warning, borderColor: TK.warningEdge }}>
              {busyKey === 'all' ? 'Syncing…' : 'Re-sync everything (old behaviour)'}
            </PButton>
          }>
          The database could not resolve one of its functions.
          {migrationDetail && <div style={{ marginTop: 5, fontFamily: 'ui-monospace, monospace', fontSize: F.micro, opacity: .85 }}>{migrationDetail}</div>}
          <div style={{ marginTop: 5 }}>Run the migration that creates that function, then reload.</div>
        </InfoCallout>
      )}

      {msg && <InfoCallout t="positive" compact title={msg} />}
      {err && <InfoCallout t="critical" compact>{err}</InfoCallout>}

      <SectionCard icon={<IconLayers size={16} />} title="Categories" flush
        hint="Sync refreshes one category from HRMS into this month; Download gives it as frozen."
        actions={<CountChip>{DATA_SYNC_CATEGORIES.length}</CountChip>}
        bodyStyle={{ marginTop: -1 }}>
        {DATA_SYNC_CATEGORIES.map(cat => (
          <CategoryRow key={cat.key} cat={cat}
            count={status && cat.countKey ? status[cat.countKey] : null}
            busy={busyKey === cat.key || checkingKey === cat.key}
            busyText={checkingKey === cat.key ? 'Checking…' : 'Syncing…'}
            disabled={!runIds.length || needsMigration || !!status?.is_locked || (!!busyKey && busyKey !== cat.key) || (!!checkingKey && checkingKey !== cat.key)}
            onSync={() => openPicker(cat)}
            onDownload={() => download(cat)}
            extra={cat.key === 'employee' && status && (status.new_joiners > 0 || status.leavers > 0) ? (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {status.new_joiners > 0 && <StatusPill t="positive" size="sm" dot>+{status.new_joiners} new joiner{status.new_joiners === 1 ? '' : 's'} waiting</StatusPill>}
                {status.leavers > 0 && <StatusPill t="warning" size="sm" dot>{status.leavers} no longer eligible</StatusPill>}
              </div>
            ) : undefined}
          />
        ))}
      </SectionCard>

      <InfoCallout t="info" title="Month Create already runs Employee info, Bank, Salary and Flexi automatically.">
        Use a category’s Sync button after a CTC revision, transfer, bank change or fresh declaration: <b>only that category refreshes</b>, the rest stay exactly as they were frozen. Paid days, leave, OT and arrear stay as uploaded no matter which button you press. New joiners come in through <b>Employee info</b>, and they arrive with their full row. A joiner with a blank salary would be paid zero.
      </InfoCallout>

      {pickerCat && pool.length > 0 && (
        <EmployeePicker
          key={pickerCat.key}
          cat={pickerCat}
          pool={pool}
          pending={pendingMap}
          busy={busyKey === pickerCat.key}
          onCancel={() => setPickerCat(null)}
          onConfirm={codes => syncCategory(pickerCat, codes)}
        />
      )}

      <ChangeTable companyId={companyId} run={sel} />
    </div>
  )
}
