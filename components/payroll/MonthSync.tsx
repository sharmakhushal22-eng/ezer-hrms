'use client'
// components/payroll/MonthSync.tsx — Payroll → Attendance & Sync → Snapshot Sync.
// Re-freeze a payroll month's employee snapshot from current HRMS data (org / statutory /
// bank / CTC / salary + days_in_month) via sync_payroll_month — WITHOUT touching the
// attendance columns. Useful after CTC revisions / master edits once a month already exists.
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { loadRuns, loadRunsForPeriod, prevPeriod, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { loadMonthDiff, buildChangeSheets, type MonthDiff } from '@/lib/payroll/monthDiff'
import {
  SYNC_CATEGORIES, loadSyncStatus, runCategorySync, runFullSync, loadCategoryRows, loadFilterCandidates,
  type SyncCategory, type SyncStatus, type SyncEmployee,
} from '@/lib/payroll/sync'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489', card: '#FFFFFF',
  border: '#E9E7F5', muted: '#6B7280', green: '#059669', greenBg: '#ECFDF5',
  greenBd: '#BBF7D0', amber: '#B45309', amberBg: '#FFFBEB', purpleBg: '#EEEDFE', gray: '#F8F7FF',
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

  const th: React.CSSProperties = { padding: '8px 12px', fontSize: 9.5, color: '#A5B4FC', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'left', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 12px', color: C.navy, borderTop: `1px solid ${C.border}` }
  const stat = (label: string, value: any, color: string) => (
    <div key={label} style={{ background: C.gray, border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 12px', minWidth: 96 }}>
      <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.25 }}>{value}</div>
    </div>
  )

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginTop: 14, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: C.purpleBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>📊</div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: C.navy }}>Changes vs previous month</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
            {diff ? <>Comparing <b style={{ color: C.purpleD }}>{diff.curLabel}</b> against <b style={{ color: C.purpleD }}>{diff.prevLabel}</b> — every frozen Month Master column</>
              : 'Every frozen Month Master column, compared employee by employee'}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, cursor: 'pointer' }}>
          <input type="checkbox" checked={withAtt} onChange={e => setWithAtt(e.target.checked)} style={{ accentColor: C.purple, cursor: 'pointer' }} />
          Include attendance &amp; OT
        </label>
        <button onClick={compare} disabled={busy || !run} style={{ padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, fontWeight: 600, fontSize: 11.5, fontFamily: font, cursor: busy ? 'not-allowed' : 'pointer' }}>⟳ Refresh</button>
        <button onClick={download} disabled={!diff || !diff.rows.length}
          style={{ padding: '8px 15px', borderRadius: 8, border: 'none', background: !diff || !diff.rows.length ? '#C4B5FD' : 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 11.5, fontFamily: font, cursor: !diff || !diff.rows.length ? 'not-allowed' : 'pointer' }}>
          📥 Download changes
        </button>
      </div>

      {busy && <div style={{ fontSize: 12, color: C.muted, padding: '10px 0' }}>Comparing months…</div>}
      {err && <div style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', borderRadius: 9, padding: '10px 14px' }}>{err}</div>}
      {!busy && !err && prevMissing && (
        <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', borderRadius: 9, padding: '10px 12px' }}>
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
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
                      {!c.comparable ? <span style={{ fontSize: 10.5, color: C.muted }}>not frozen per month</span>
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
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8, background: C.gray, borderRadius: 8, padding: '9px 11px', lineHeight: 1.5 }}>
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
        fontSize: 15, flexShrink: 0, background: ready ? C.purpleBg : global_ ? '#ECFDF5' : '#F3F4F6',
      }}>{cat.icon}</div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: ready || global_ ? C.navy : '#9CA3AF' }}>{cat.label}</div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>{cat.note}</div>
        {extra}
      </div>
      {ready ? (
        <>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.purpleD, background: C.purpleBg, borderRadius: 99, padding: '3px 11px', whiteSpace: 'nowrap' }}>
            {count == null ? '—' : count}
          </span>
          <button onClick={onSync} disabled={busy || disabled}
            style={{ padding: '7px 15px', borderRadius: 8, border: 'none', background: busy || disabled ? '#C4B5FD' : C.purple, color: '#fff', fontWeight: 700, fontSize: 11.5, fontFamily: font, cursor: busy || disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {busy ? 'Syncing…' : 'Sync'}
          </button>
          <button onClick={onDownload} disabled={disabled} title={`Download ${cat.label} as frozen in this month`}
            style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.muted, fontSize: 12, fontFamily: font, cursor: disabled ? 'not-allowed' : 'pointer' }}>⬇</button>
        </>
      ) : global_ ? (
        <>
          {count != null && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.green, background: C.greenBg, borderRadius: 99, padding: '3px 11px', whiteSpace: 'nowrap' }}>{count}</span>}
          <span style={{ fontSize: 10.5, fontWeight: 700, color: C.green, background: C.greenBg, border: `0.5px solid ${C.greenBd}`, borderRadius: 99, padding: '4px 12px', whiteSpace: 'nowrap' }}>Whole year</span>
        </>
      ) : (
        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', borderRadius: 99, padding: '4px 12px', whiteSpace: 'nowrap' }}>Planned</span>
      )}
    </div>
  )
}


// ── Sync filter ────────────────────────────────────────────────────────────
// There are 300 employees, but HR rarely wants to sync the whole month. Narrow by
// company, location, emp code or name — whichever Sync is then pressed pulls in data
// for ONLY those employees. Opening the filter also narrows the counters, so the badge
// shows exactly what the button will do.
// Defined OUTSIDE the parent — otherwise every keystroke remounts it and the search
// box loses focus.
function FilterBar({ pool, company, location, search, onCompany, onLocation, onSearch, onClear, matched }: {
  pool: SyncEmployee[]
  company: string; location: string; search: string
  onCompany: (v: string) => void; onLocation: (v: string) => void; onSearch: (v: string) => void
  onClear: () => void
  matched: string[] | null
}) {
  const companies = Array.from(new Set(pool.map(e => e.company).filter(Boolean))).sort()
  const locations = Array.from(new Set(pool.map(e => e.location).filter(Boolean))).sort()
  const inp: React.CSSProperties = {
    padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12,
    background: '#fff', color: C.navy, fontFamily: font, outline: 'none',
  }
  const on = matched !== null
  return (
    <div style={{ background: on ? C.purpleBg : C.gray, border: `1px solid ${on ? '#DDD6FE' : C.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', paddingBottom: 8 }}>Filter</div>
        {companies.length > 1 && (
          <div>
            <label style={{ fontSize: 9.5, color: C.muted, display: 'block', marginBottom: 3 }}>Company</label>
            <select style={{ ...inp, minWidth: 170 }} value={company} onChange={e => onCompany(e.target.value)}>
              <option value="">All companies</option>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={{ fontSize: 9.5, color: C.muted, display: 'block', marginBottom: 3 }}>Location</label>
          <select style={{ ...inp, minWidth: 150 }} value={location} onChange={e => onLocation(e.target.value)}>
            <option value="">All locations</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 230 }}>
          <label style={{ fontSize: 9.5, color: C.muted, display: 'block', marginBottom: 3 }}>Emp code / name — paste a list too</label>
          <input style={{ ...inp, width: '100%' }} value={search} onChange={e => onSearch(e.target.value)}
            placeholder="OXYZO680, OXYZO741, OXYZO1013   ya   umesh" />
        </div>
        {on && <button onClick={onClear} style={{ padding: '7px 13px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: '#DC2626', fontWeight: 700, fontSize: 11.5, fontFamily: font, cursor: 'pointer' }}>Clear</button>}
      </div>
      <div style={{ fontSize: 10.5, marginTop: 8, color: on ? C.purpleD : C.muted, lineHeight: 1.5 }}>
        {!on ? <>No filter — Sync will run on the <b>whole month</b> ({pool.length} employees).</>
          : matched.length === 0
            ? <b style={{ color: '#DC2626' }}>This filter matches no employees — Sync is disabled.</b>
            : <>Filter on — <b>{matched.length}</b> of {pool.length} employees. Any Sync you press now runs on <b>these only</b>, and the counters below refer to them too.</>}
      </div>
    </div>
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
  const [fCompany, setFCompany] = useState('')
  const [fLocation, setFLocation] = useState('')
  const [fSearch, setFSearch] = useState('')
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

  // Emp codes the filter resolves to — null when no filter is set at all, which the
  // RPCs read as "the whole month" (p_codes NULL) exactly as before.
  const matched: string[] | null = (() => {
    const tokens = fSearch.split(/[,\n;]+/).map(t => t.trim()).filter(Boolean)
    if (!fCompany && !fLocation && !tokens.length) return null
    const hit = (e: SyncEmployee) => {
      if (fCompany && e.company !== fCompany) return false
      if (fLocation && e.location !== fLocation) return false
      if (!tokens.length) return true
      // A pasted list matches emp codes exactly; a single word also matches names.
      return tokens.some(t => {
        const q = t.toLowerCase()
        return e.code.toLowerCase() === q || e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
      })
    }
    return pool.filter(hit).map(e => e.code)
  })()
  const filterKey = matched === null ? '' : matched.join(',')

  const refresh = useCallback(async () => {
    if (!runIds.length) { setStatus(null); setNeedsMigration(false); setMigrationDetail(null); return }
    try {
      const { status: s, missing, detail } = await loadSyncStatus(runIds, matched)
      setStatus(missing ? null : s); setNeedsMigration(missing); setMigrationDetail(detail)
    } catch (e: any) { setErr(e.message || String(e)) }
  }, [runIds.join(','), filterKey])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!monthRuns.length) { setPool([]); return }
    loadFilterCandidates(monthRuns.map(r => ({ id: r.id, company_id: r.company_id, company_name: r.company_name })))
      .then(setPool).catch(e => setErr(e.message || String(e)))
  }, [runIds.join(',')])   // eslint-disable-line react-hooks/exhaustive-deps

  async function syncCategory(cat: SyncCategory) {
    if (!runIds.length) return
    setBusyKey(cat.key); setMsg(''); setErr('')
    const { error, count } = await runCategorySync(cat, runIds, matched)
    setBusyKey('')
    if (error) { setErr(error); return }
    setMsg(`${cat.label} synced — ${count} employee${count === 1 ? '' : 's'} refreshed from HRMS`
      + (matched ? ` (from the ${matched.length} inside the filter)` : '')
      + '. Every other category is untouched.')
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
      const rows = await loadCategoryRows(cat, monthRuns.map(r => ({ id: r.id, company_name: r.company_name })), matched)
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
  const readyCount = DATA_SYNC_CATEGORIES.filter(c => c.status === 'ready').length
  const globalCount = DATA_SYNC_CATEGORIES.filter(c => c.status === 'global').length
  const plannedCount = DATA_SYNC_CATEGORIES.length - readyCount - globalCount
  const inp: React.CSSProperties = { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: '#fff', color: C.navy, fontFamily: font, outline: 'none' }
  const monthOpts = Array.from(new Map(runs.map(r => [r.month, r])).values()).sort((a, b) => (a.month || 0) - (b.month || 0))

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)', flexShrink: 0 }}>⇄</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Snapshot Sync</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
            Sync each category on its own — nothing moves into Month Master unless you choose it. Attendance, OT and arrear are never touched by any of these.
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap', paddingTop: 4 }}>
          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: C.green, marginRight: 5 }} />{readyCount} ready
          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#6EE7B7', margin: '0 5px 0 12px' }} />{globalCount} whole-year
          {plannedCount > 0 && <><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#C7C2E8', margin: '0 5px 0 12px' }} />{plannedCount} planned</>}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
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
          <div style={{ fontSize: 11.5, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', borderRadius: 9, padding: '10px 12px', margin: '8px 0', lineHeight: 1.5 }}>
            This month is <b>locked / disbursed</b> — every category sync is disabled. A locked month should not be changed quietly by a small sync; reopen it formally through <b>Lock / Unlock</b> first. (The database will refuse it anyway.)
          </div>
        )}

        {needsMigration && (
          <div style={{ fontSize: 11.5, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', borderRadius: 9, padding: '10px 12px', margin: '8px 0', lineHeight: 1.5 }}>
            Category-wise sync is off — the database could not resolve one of its functions.
            {migrationDetail && <div style={{ marginTop: 5, fontFamily: 'ui-monospace, monospace', fontSize: 10.5, opacity: .85 }}>{migrationDetail}</div>}
            <div style={{ marginTop: 5 }}>Run the migration that creates that function, then reload.</div>
            <button onClick={syncEverything} disabled={busyKey === 'all' || !runIds.length}
              style={{ marginLeft: 10, padding: '5px 12px', borderRadius: 7, border: 'none', background: C.amber, color: '#fff', fontWeight: 700, fontSize: 11, fontFamily: font, cursor: 'pointer' }}>
              {busyKey === 'all' ? 'Syncing…' : 'Re-sync everything (old behaviour)'}
            </button>
          </div>
        )}

        <FilterBar pool={pool} company={fCompany} location={fLocation} search={fSearch}
          onCompany={setFCompany} onLocation={setFLocation} onSearch={setFSearch}
          onClear={() => { setFCompany(''); setFLocation(''); setFSearch('') }}
          matched={matched} />

        {DATA_SYNC_CATEGORIES.map(cat => (
          <CategoryRow key={cat.key} cat={cat}
            count={status && cat.countKey ? status[cat.countKey] : null}
            busy={busyKey === cat.key}
            disabled={!runIds.length || needsMigration || !!status?.is_locked || (matched !== null && matched.length === 0) || (!!busyKey && busyKey !== cat.key)}
            onSync={() => syncCategory(cat)}
            onDownload={() => download(cat)}
            extra={cat.key === 'employee' && status && (status.new_joiners > 0 || status.leavers > 0) ? (
              <div style={{ fontSize: 10.5, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {status.new_joiners > 0 && <span style={{ color: C.green, background: C.greenBg, border: `0.5px solid ${C.greenBd}`, borderRadius: 99, padding: '2px 9px', fontWeight: 700 }}>+{status.new_joiners} new joiner{status.new_joiners === 1 ? '' : 's'} waiting</span>}
                {status.leavers > 0 && <span style={{ color: C.amber, background: C.amberBg, border: '0.5px solid #FDE8C8', borderRadius: 99, padding: '2px 9px', fontWeight: 700 }}>{status.leavers} no longer eligible</span>}
              </div>
            ) : undefined}
          />
        ))}

        <div style={{ fontSize: 10.5, color: C.purpleD, marginTop: 14, background: C.purpleBg, borderRadius: 9, padding: '11px 13px', lineHeight: 1.6 }}>
          <b>Month Create already runs Employee info, Bank, Salary and Flexi automatically.</b> Use a category’s Sync button after a CTC revision, transfer, bank change or fresh declaration — <b>only that category refreshes</b>, the rest stay exactly as they were frozen. Paid days, leave, OT and arrear stay as uploaded no matter which button you press. New joiners come in through <b>Employee info</b>, and they arrive with their full row — a joiner with a blank salary would be paid zero.
        </div>

        {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 14px', marginTop: 12 }}>✓ {msg}</div>}
        {err && <div style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', borderRadius: 9, padding: '10px 14px', marginTop: 12 }}>{err}</div>}
      </div>

      <ChangeTable companyId={companyId} run={sel} />
    </div>
  )
}
