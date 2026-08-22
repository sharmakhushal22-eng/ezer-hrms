'use client'
// components/payroll/LockUnlock.tsx — Payroll → Payroll Run → Lock / Unlock.
//
// Payroll runs, and everyone it paid is locked. Their month is settled: no attendance
// edit, no bank change, no re-sync. To change anything you reopen that one employee and
// say why — the reason is the point, because two months later somebody will ask who
// reopened a finished payroll and "it was already like that" is not an answer.
//
// Locking is never a button here. It happens because payroll ran for that employee, so
// the screen can only ever loosen the freeze, never apply one by hand — except to undo
// an unlock, which is the one case where a fixed record has to be re-closed.
import { useState, useEffect, useCallback } from 'react'
import { loadRuns, loadRunsForPeriod, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import {
  loadLockList, lockFilterOptions, unlockEmployees, lockEmployees, loadLockAudit,
  EMPTY_LOCK_FILTER, type LockRow, type LockFilter, type LockAudit,
} from '@/lib/payroll/lock'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, purpleSoft: TK.brandTint,
  card: TK.surface, border: TK.brandEdge, muted: TK.muted,
  green: TK.positive, greenBg: TK.positiveTint, greenBd: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint,
  red: TK.critical, redBg: TK.criticalTint, redBd: TK.criticalTint,
}
const font = '"DM Sans","Segoe UI",sans-serif'

const periodLabel = (r: { period_label?: string | null; month?: number; fy?: string }) =>
  r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`

const initialsOf = (n: string) =>
  (n || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '—'

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} d ago`
}

const card: React.CSSProperties = {
  background: C.card, borderRadius: 16, padding: '20px 22px', marginBottom: 16,
  boxShadow: '0 1px 4px rgba(37,99,235,0.06)', border: `1px solid ${C.border}`,
}
const inp: React.CSSProperties = {
  fontFamily: font, fontSize: 12.5, color: C.navy, width: '100%',
  border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', background: TK.surface, outline: 'none',
}
const fieldLbl: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase',
  letterSpacing: '0.03em', display: 'block', marginBottom: 4,
}

// ── One employee row ───────────────────────────────────────────────────────
// Outside the parent: a table of 300 rows that re-mounts on every keystroke in the
// reason box would drop the checkbox state the user just set.
function EmpRow({ r, checked, onToggle, isGroup }: {
  r: LockRow; checked: boolean; onToggle: () => void; isGroup: boolean
}) {
  const td: React.CSSProperties = { padding: '10px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle' }
  // Every row is selectable, in both directions. Only locked rows used to be, which left
  // the whole screen dead for a company where nobody is locked yet — and that is the
  // normal state before the first payroll run. Unlocked rows are tinted rather than
  // faded: a greyed-out row reads as broken, not as "already open".
  return (
    <tr style={{ background: r.is_locked ? 'transparent' : '#F8FDFA' }}>
      <td style={{ ...td, width: 30 }}>
        <input type="checkbox" checked={checked} onChange={onToggle}
          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: C.purple }} />
      </td>
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%', background: C.purpleSoft, color: C.purpleD,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}>{initialsOf(r.full_name)}</div>
          <div>
            <div style={{ fontWeight: 600 }}>{r.full_name || '—'}</div>
            <div style={{ fontSize: 10.5, color: C.muted }}>{r.employee_code}</div>
          </div>
        </div>
      </td>
      <td style={{ ...td, color: C.muted }}>{r.department || '—'}</td>
      {isGroup && <td style={{ ...td, color: C.muted, fontSize: 11.5 }}>{r.company || '—'}</td>}
      <td style={td}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999,
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: r.is_locked ? C.redBg : C.greenBg, color: r.is_locked ? C.red : C.green,
        }}>{r.is_locked ? 'Locked' : 'Unlocked'}</span>
        {/* Why it was reopened, on the row itself — the audit trail below scrolls away,
            this does not. */}
        {!r.is_locked && r.unlock_reason && (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3, maxWidth: 260 }}>“{r.unlock_reason}”</div>
        )}
      </td>
    </tr>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────────
export default function LockUnlock({ companyId, fy }: { companyId: string; fy: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [monthVal, setMonthVal] = useState('')
  const [monthRuns, setMonthRuns] = useState<PayrollRun[]>([])
  const [rows, setRows] = useState<LockRow[]>([])
  const [optionRows, setOptionRows] = useState<LockRow[]>([])
  const [audit, setAudit] = useState<LockAudit[]>([])
  const [filter, setFilter] = useState<LockFilter>(EMPTY_LOCK_FILTER)
  const [applied, setApplied] = useState<LockFilter>(EMPTY_LOCK_FILTER)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const isGroup = !companyId

  useEffect(() => {
    let live = true
    setLoading(true)
    loadRuns(companyId, fy)
      .then(rs => {
        if (!live) return
        const active = rs.filter(r => r.status !== 'CANCELLED')
        setRuns(active)
        const months = Array.from(new Set(active.map(r => r.month))).sort((a, b) => a - b)
        setMonthVal(v => (v && months.includes(Number(v)) ? v : String(months[months.length - 1] ?? '')))
      })
      .catch(e => live && setErr(e?.message || String(e)))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [companyId, fy])

  const refresh = useCallback(async () => {
    if (!monthVal) { setMonthRuns([]); setRows([]); setAudit([]); return }
    setLoading(true); setErr('')
    try {
      const list = await loadRunsForPeriod(companyId, fy, Number(monthVal))
      setMonthRuns(list)
      const thin = list.map(r => ({ id: r.id, company_name: r.company_name }))
      const [data, log] = await Promise.all([loadLockList(thin, applied), loadLockAudit(list.map(r => r.id))])
      setRows(data)
      // Snapshot of the full month, kept for the dropdowns. Only refreshed when nothing
      // is filtered, which is exactly when `data` IS the full month.
      if (!applied.company && !applied.department && !applied.designation
          && !applied.location && !applied.employee.trim()) setOptionRows(data)
      setAudit(log)
      // Anyone who is no longer selectable drops out of the selection, so the button
      // count can never claim more than it will actually act on.
      const present = new Set(data.map(r => r.employee_code))
      setSel(prev => new Set([...prev].filter(c => present.has(c))))
    } catch (e: any) {
      // See the note in lib/payroll/sync.ts: `does not exist` is also what Postgres says
      // for a bad column inside a function that exists, so it cannot stand in for
      // "migration missing" on its own.
      setErr(/could not find the function|schema cache/i.test(e?.message || '')
        ? `Lock / Unlock needs a migration that has not been applied to this database yet. (${e?.message || ''})`
        : (e?.message || String(e)))
      setRows([])
    } finally { setLoading(false) }
  }, [companyId, fy, monthVal, applied])
  useEffect(() => { refresh() }, [refresh])

  // Dropdown choices come from the UNFILTERED list. Building them from the visible rows
  // meant that picking a company emptied the company dropdown of every other company —
  // the filter would narrow itself until it could not be widened again.
  const opts = lockFilterOptions(optionRows.length ? optionRows : rows)
  const companies = opts.companies
  const label = monthRuns[0] ? periodLabel(monthRuns[0]) : ''
  const monthOpts = Array.from(new Map(runs.map(r => [r.month, r])).values()).sort((a, b) => a.month - b.month)
  const lockedCount = rows.filter(r => r.is_locked).length
  // Split by what each selected row actually needs doing. Selecting a mix is fine —
  // each button acts only on the half it applies to, and says how many that is.
  const picked      = rows.filter(r => sel.has(r.employee_code))
  const toUnlock    = picked.filter(r => r.is_locked)
  const toLock      = picked.filter(r => !r.is_locked)

  function toggle(code: string) {
    setSel(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  }
  function toggleAll() {
    const all = rows.map(r => r.employee_code)
    setSel(prev => (all.length > 0 && all.every(c => prev.has(c)) ? new Set() : new Set(all)))
  }

  // Group by run, because in group mode a month is one run per company and each unlock
  // has to be addressed to the run the employee actually sits in.
  function byRun(list: LockRow[]) {
    const m = new Map<string, string[]>()
    list.forEach(r => m.set(r.run_id, [...(m.get(r.run_id) || []), r.employee_code]))
    return m
  }

  async function unlock() {
    if (!toUnlock.length) return
    if (!reason.trim()) { setReasonErr(true); return }
    setReasonErr(false); setBusy(true); setErr(''); setMsg('')
    let count = 0
    const fails: string[] = []
    for (const [runId, codes] of byRun(toUnlock)) {
      const { error, count: n } = await unlockEmployees(runId, codes, reason.trim())
      if (error) fails.push(error); else count += n
    }
    setBusy(false)
    if (fails.length) setErr(fails.join('  ·  '))
    if (count) {
      setMsg(`✓ ${count} employee${count === 1 ? '' : 's'} unlocked — you can now edit their data.`)
      setReason(''); setSel(new Set())
    }
    refresh()
  }

  // Locking by hand. Payroll running is what normally locks people, so this exists for
  // the case that flow cannot cover: an unlock made in error, which has to be closable
  // again without re-running a month's payroll to do it.
  async function lockSelected() {
    if (!toLock.length) return
    setBusy(true); setErr(''); setMsg('')
    let count = 0
    const fails: string[] = []
    for (const [runId, codes] of byRun(toLock)) {
      const { error, count: n } = await lockEmployees(runId, codes)
      if (error) fails.push(error); else count += n
    }
    setBusy(false)
    if (fails.length) setErr(fails.join('  ·  '))
    if (count) { setMsg(`✓ ${count} employee${count === 1 ? '' : 's'} locked.`); setSel(new Set()) }
    refresh()
  }

  async function relock(r: LockRow) {
    setBusy(true); setErr(''); setMsg('')
    const { error, count } = await lockEmployees(r.run_id, [r.employee_code])
    setBusy(false)
    if (error) setErr(error)
    else if (count) setMsg(`✓ ${r.employee_code} locked again.`)
    refresh()
  }

  const unlockedRows = rows.filter(r => !r.is_locked)

  return (
    <div style={{ fontFamily: font, fontSize: 14, color: C.navy, maxWidth: 920 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: '0 0 4px', letterSpacing: '-0.02em', fontWeight: 700 }}>Lock / Unlock</h1>
          <div style={{ fontSize: 13, color: C.muted }}>
            {isGroup ? `Group Companies${monthRuns.length ? ` · ${monthRuns.length} compan${monthRuns.length === 1 ? 'y' : 'ies'}` : ''}` : (monthRuns[0]?.company_name || 'Company')}
            {label ? ` · ${label}` : ''} · Payroll Run
          </div>
        </div>
        <select value={monthVal} onChange={e => { setMonthVal(e.target.value); setSel(new Set()); setMsg('') }}
          style={{ ...inp, width: 'auto', borderRadius: 999, padding: '7px 16px', fontWeight: 600, color: C.purpleD, cursor: 'pointer' }}>
          {monthOpts.length === 0 && <option value="">No month created</option>}
          {monthOpts.map(r => <option key={r.month} value={String(r.month)}>📅 {periodLabel(r)}</option>)}
        </select>
      </div>

      <div style={{ ...card, background: C.purpleSoft, border: `1px solid #DDD6FE`, fontSize: 12, color: C.purpleD, lineHeight: 1.6 }}>
        <b>Once payroll has run for someone, their data locks</b> — attendance, bank, salary, none of it will change. Anyone it has not run for stays unlocked and can be edited normally.
        Payroll <b>will not run again</b> for a locked employee — unlock them here first and only then will Run Payroll pick them up. That is why pressing Run twice cannot quietly change a payslip.
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, margin: '0 0 3px' }}>Find employees</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Filter to select multiple employees at once, or search by employee code directly.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
          {/* Company only in group mode — with one company picked in the header it would
              be a dropdown with a single choice. */}
          {isGroup && companies.length > 1 && (
            <div>
              <label style={fieldLbl}>Company</label>
              <select style={inp} value={filter.company} onChange={e => setFilter({ ...filter, company: e.target.value })}>
                <option value="">All companies</option>
                {companies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={fieldLbl}>Department</label>
            <select style={inp} value={filter.department} onChange={e => setFilter({ ...filter, department: e.target.value })}>
              <option value="">All</option>
              {opts.departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLbl}>Designation</label>
            <select style={inp} value={filter.designation} onChange={e => setFilter({ ...filter, designation: e.target.value })}>
              <option value="">All</option>
              {opts.designations.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLbl}>Location</label>
            <select style={inp} value={filter.location} onChange={e => setFilter({ ...filter, location: e.target.value })}>
              <option value="">All</option>
              {opts.locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLbl}>Employee code</label>
            <input style={inp} value={filter.employee} onChange={e => setFilter({ ...filter, employee: e.target.value })}
              placeholder="e.g. SRS9012, SRS9013" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setApplied({ ...filter })} disabled={busy}
            style={{ fontFamily: font, fontSize: 12.5, fontWeight: 700, color: TK.onAccent, background: C.purple, border: 'none', borderRadius: 8, padding: '9px 20px', cursor: 'pointer' }}>
            Search
          </button>
          <button onClick={() => { setFilter(EMPTY_LOCK_FILTER); setApplied(EMPTY_LOCK_FILTER) }} disabled={busy}
            style={{ fontFamily: font, fontSize: 12.5, fontWeight: 600, color: C.muted, background: TK.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 16px', cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Employees ({rows.length})</div>
          <div style={{ fontSize: 11.5, color: C.muted }}>
            🔒 {lockedCount} locked · 🔓 {rows.length - lockedCount} unlocked
          </div>
          {/* Works on every row now, not just the locked ones — otherwise a company with
              nothing locked yet had no way to select anything at all. */}
          {rows.length > 0 && (
            <button onClick={toggleAll}
              style={{ marginLeft: 'auto', fontFamily: font, fontSize: 11.5, fontWeight: 600, color: C.purpleD, background: TK.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
              {rows.length > 0 && rows.every(r => sel.has(r.employee_code)) ? 'Clear selection' : `Select all ${rows.length}`}
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.muted, margin: '3px 0 14px' }}>
          Tick any row. Locked ones can be unlocked (reason required), unlocked ones can be locked back.
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: C.muted, padding: '20px 0' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12, color: C.muted, padding: '20px 0' }}>
            {monthRuns.length ? 'No employee matches this filter.' : 'No payroll month here yet — create one in Configuration → Payroll Month.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  {['', 'Employee', 'Department', ...(isGroup ? ['Company'] : []), 'Status'].map((h, i) => (
                    <th key={i} style={{ textAlign: 'left', fontSize: 10.5, color: C.muted, textTransform: 'uppercase', padding: 8, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.card }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <EmpRow key={`${r.run_id}:${r.employee_code}`} r={r} isGroup={isGroup}
                    checked={sel.has(r.employee_code)} onToggle={() => toggle(r.employee_code)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, margin: '0 0 3px' }}>
          Reason for unlock <span style={{ color: C.red }}>*</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
          Required — recorded in the audit log against every employee you unlock.
        </div>
        <textarea value={reason} onChange={e => { setReason(e.target.value); if (e.target.value.trim()) setReasonErr(false) }}
          placeholder="e.g. Correcting bank detail after employee update"
          style={{ ...inp, minHeight: 54, resize: 'vertical', borderColor: reasonErr ? C.red : C.border }} />
        {reasonErr && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>A reason is required before you can unlock any employee.</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={unlock} disabled={busy || toUnlock.length === 0}
            style={{
              fontFamily: font, fontSize: 13.5, fontWeight: 700, color: TK.onAccent,
              background: toUnlock.length && !busy ? C.purple: TK.brandTint, border: 'none', borderRadius: 10,
              padding: '12px 22px', cursor: toUnlock.length && !busy ? 'pointer' : 'not-allowed',
              boxShadow: toUnlock.length && !busy ? '0 3px 10px rgba(37,99,235,0.2)' : 'none',
            }}>
            {busy ? 'Working…' : `🔓 Unlock Selected (${toUnlock.length})`}
          </button>
          {/* No reason needed to lock: closing a record back up takes nothing away from
              anyone. Reopening one does, which is why only that side demands a reason. */}
          <button onClick={lockSelected} disabled={busy || toLock.length === 0}
            style={{
              fontFamily: font, fontSize: 13.5, fontWeight: 700,
              color: toLock.length && !busy ? C.red : TK.faint,
              background: TK.surface, border: `1px solid ${toLock.length && !busy ? C.redBd : C.border}`,
              borderRadius: 10, padding: '12px 22px',
              cursor: toLock.length && !busy ? 'pointer' : 'not-allowed',
            }}>Lock Selected ({toLock.length})
          </button>
          {picked.length === 0 && (
            <span style={{ fontSize: 11.5, color: C.muted }}>Tick a row above to enable these.</span>
          )}
        </div>

        {msg && <div style={{ background: C.greenBg, border: `1px solid ${C.greenBd}`, color: C.green, borderRadius: 10, padding: '12px 16px', fontSize: 12.5, fontWeight: 600, marginTop: 12 }}>{msg}</div>}
        {err && <div style={{ background: C.redBg, border: `1px solid ${C.redBd}`, color: C.red, borderRadius: 10, padding: '12px 16px', fontSize: 12.5, marginTop: 12 }}>{err}</div>}
      </div>

      {unlockedRows.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, margin: '0 0 3px' }}>Currently open ({unlockedRows.length})</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            These are editable right now and will be picked up by the next Run Payroll. Lock one back if it was reopened by mistake.
          </div>
          {unlockedRows.map(r => (
            <div key={`${r.run_id}:${r.employee_code}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
              <span style={{ fontWeight: 600 }}>{r.employee_code}</span>
              <span style={{ color: C.muted }}>{r.full_name}</span>
              {r.unlock_reason && <span style={{ color: C.muted, fontSize: 11 }}>— “{r.unlock_reason}”</span>}
              <button onClick={() => relock(r)} disabled={busy}
                style={{ marginLeft: 'auto', fontFamily: font, fontSize: 11, fontWeight: 700, color: C.red, background: TK.surface, border: `1px solid ${C.redBd}`, borderRadius: 8, padding: '5px 12px', cursor: busy ? 'not-allowed' : 'pointer' }}>Lock again
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px' }}>Recent activity</div>
        {audit.length === 0 ? (
          <div style={{ fontSize: 12, color: C.muted }}>Nothing locked or unlocked in this month yet.</div>
        ) : audit.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i === audit.length - 1 ? 'none' : `1px solid ${C.border}`, fontSize: 11.5, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: 700, padding: '2px 9px', borderRadius: 999, fontSize: 10,
              background: a.action === 'EMPLOYEES_LOCKED' ? C.redBg : C.greenBg,
              color: a.action === 'EMPLOYEES_LOCKED' ? C.red : C.green,
            }}>{a.action === 'EMPLOYEES_LOCKED' ? 'LOCKED' : 'UNLOCKED'}</span>
            <span>{a.count === 1 ? a.employees[0] : `${a.count} employees`}</span>
            <span style={{ color: C.muted }}>
              {a.reason ? `— “${a.reason}”` : '— Run Payroll completed'} · {a.by} · {ago(a.at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
