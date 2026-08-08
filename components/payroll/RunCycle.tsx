'use client'
// components/payroll/RunCycle.tsx — Payroll → Payroll Run → Run Cycle.
//
// This screen is a gate, not a control panel. Its only job is to answer "can this month
// be paid right now, and if not, who is in the way" — then run it.
//
// The old version of this tab exposed the whole status machine (create month, sync
// employees, advance, cancel) next to Calculate. Two of those were quietly dangerous:
// Sync employees deleted the month's snapshot before rewriting eleven columns, and
// Advance walked a run to APPROVED with zero payroll lines. Month creation lives in
// Configuration → Payroll Month (where the previous-month readiness check runs) and
// per-category sync lives in Data Sync, so neither is repeated here.
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { loadRuns, loadRunsForPeriod, loadRunRegister, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { calculateRun } from '@/lib/payroll/engine'
import { loadReadiness, blockerSummary, type Readiness, type ReadinessCheck } from '@/lib/payroll/readiness'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#6D28D9', purpleSoft: '#F3EEFF',
  card: '#FFFFFF', border: '#ECEAFB', muted: '#6B7280',
  green: '#059669', greenBg: '#ECFDF5', greenBd: '#A7F3D0',
  amber: '#B45309', amberBg: '#FFFBEB', amberBd: '#FDE68A',
  red: '#DC2626', redBg: '#FEF2F2', redBd: '#FECACA', redDark: '#B91C1C',
}
const font = '"DM Sans","Segoe UI",sans-serif'

const periodLabel = (r: { period_label?: string | null; month?: number; fy?: string }) =>
  r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`

const inr = (n: number) => '₹' + Math.round(n || 0).toLocaleString('en-IN')

// ── Tab strip button ───────────────────────────────────────────────────────
// Defined outside the parent: a tab that re-mounts on every render loses its hover
// state mid-click, and the whole strip re-renders each time the count refreshes.
function Tab({ check, active, onPick }: { check: ReadinessCheck; active: boolean; onPick: () => void }) {
  const off = !check.available
  const n = check.rows.length
  const blocked = check.blocking && n > 0
  const clear = check.available && n === 0

  const countStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
    background: active
      ? 'rgba(255,255,255,0.28)'
      : blocked ? C.red : clear ? C.greenBg : 'rgba(0,0,0,0.08)',
    color: active ? '#fff' : blocked ? '#fff' : clear ? C.green : C.navy,
  }
  return (
    <button
      onClick={off ? undefined : onPick}
      disabled={off}
      title={off ? check.unavailableNote : undefined}
      style={{
        flexShrink: 0, background: active ? C.purple : C.card,
        border: `1px solid ${active ? C.purple : C.border}`, borderRadius: 10,
        padding: '10px 16px', cursor: off ? 'not-allowed' : 'pointer',
        fontSize: 12.5, fontWeight: 600, color: active ? '#fff' : C.navy,
        display: 'flex', alignItems: 'center', gap: 8, fontFamily: font,
        opacity: off ? 0.45 : 1, transition: 'all .15s',
      }}>
      {check.icon} {check.label}
      <span style={countStyle}>{off ? '—' : n}</span>
    </button>
  )
}

// ── The selected check's employee list ─────────────────────────────────────
function CheckPanel({ check, isGroup }: { check: ReadinessCheck; isGroup: boolean }) {
  const th: React.CSSProperties = {
    textAlign: 'left', fontSize: 10.5, color: C.muted, textTransform: 'uppercase',
    letterSpacing: '0.03em', padding: 8, borderBottom: `1px solid ${C.border}`, fontWeight: 600,
  }
  const td: React.CSSProperties = { padding: '10px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 17 }}>{check.icon}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{check.label}</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, marginLeft: 27 }}>{check.desc}</div>

      {check.rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: C.green }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Nobody in this month has this problem.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={th}>Employee</th>
                {isGroup && <th style={th}>Company</th>}
                <th style={th}>Impact if unresolved</th>
              </tr>
            </thead>
            <tbody>
              {check.rows.map(e => (
                <tr key={e.code}>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', background: C.purpleSoft, color: C.purpleD,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                      }}>{e.initials}</div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{e.name || '—'}</div>
                        <div style={{ fontSize: 10.5, color: C.muted }}>{e.code}</div>
                      </div>
                    </div>
                  </td>
                  {isGroup && <td style={{ ...td, color: C.muted, fontSize: 11.5 }}>{e.company || '—'}</td>}
                  <td style={{ ...td, color: check.blocking ? C.redDark : C.amber, fontSize: 11.5 }}>{e.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Banner ─────────────────────────────────────────────────────────────────
function Banner({ tone, title, sub }: { tone: 'red' | 'green' | 'amber'; title: string; sub: string }) {
  const t = tone === 'red'
    ? { bg: 'linear-gradient(135deg,#FEF2F2,#FFF5F5)', bd: C.redBd, dot: C.red, fg: C.red, sub: C.redDark, ic: '⚠️' }
    : tone === 'green'
      ? { bg: 'linear-gradient(135deg,#ECFDF5,#F3FDF8)', bd: C.greenBd, dot: C.green, fg: C.green, sub: '#047857', ic: '✓' }
      : { bg: 'linear-gradient(135deg,#FFFBEB,#FFFDF5)', bd: C.amberBd, dot: C.amber, fg: C.amber, sub: '#92400E', ic: '⏳' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, borderRadius: 14, padding: '16px 20px',
      marginBottom: 20, background: t.bg, border: `1px solid ${t.bd}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0, fontSize: 18, background: t.dot, color: '#fff',
      }}>{t.ic}</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.fg }}>{title}</div>
        <div style={{ fontSize: 12, color: t.sub, marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  )
}

// ── Screen ─────────────────────────────────────────────────────────────────
export default function RunCycle({ companyId, headerFy }: { companyId: string; headerFy: string }) {
  const fy = headerFy
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [monthVal, setMonthVal] = useState('')
  const [monthRuns, setMonthRuns] = useState<PayrollRun[]>([])
  const [rd, setRd] = useState<Readiness | null>(null)
  const [tab, setTab] = useState('bank')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<{ processed: number; skipped: number; net: number } | null>(null)

  const isGroup = !companyId

  // Months that exist for this FY. One entry per month even in group mode, where a
  // single month legitimately spans one run per company.
  useEffect(() => {
    let live = true
    setLoading(true); setErr(''); setResult(null)
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
    if (!monthVal) { setMonthRuns([]); setRd(null); return }
    setLoading(true); setErr('')
    try {
      const list = await loadRunsForPeriod(companyId, fy, Number(monthVal))
      setMonthRuns(list)
      setRd(await loadReadiness(list.map(r => ({ id: r.id, company_name: r.company_name }))))
    } catch (e: any) { setErr(e?.message || String(e)); setRd(null) } finally { setLoading(false) }
  }, [companyId, fy, monthVal])
  useEffect(() => { refresh() }, [refresh])

  const sel = monthRuns[0] || null
  const label = sel ? periodLabel(sel) : monthVal ? `${MONTHS[Number(monthVal) - 1]} ${fy.split('-')[0]}` : ''
  const monthOpts = Array.from(new Map(runs.map(r => [r.month, r])).values()).sort((a, b) => a.month - b.month)

  // A month past DISBURSED is closed to recalculation on purpose — a payslip that was
  // already paid out must not silently change under an employee's feet.
  const CALCULABLE = ['OPEN', 'SYNCED', 'ATTENDANCE_LOCKED', 'CALCULATED']
  const runnable = monthRuns.filter(r => CALCULABLE.includes(r.status))
  const closed = monthRuns.length > 0 && runnable.length === 0
  const calculated = monthRuns.length > 0 && monthRuns.every(r => r.status !== 'OPEN' && r.status !== 'SYNCED' && r.status !== 'ATTENDANCE_LOCKED')
  const blockers = rd?.blockers || []
  const canRun = !!rd && blockers.length === 0 && runnable.length > 0 && !busy

  async function run() {
    if (!canRun) return
    setBusy(true); setErr(''); setResult(null)
    let processed = 0, skipped = 0, net = 0
    const fails: string[] = []
    for (const r of runnable) {
      const { error, result: res } = await calculateRun(r)
      if (error) { fails.push(`${r.company_name || label}: ${error}`); continue }
      processed += res?.processed || 0
      skipped += res?.skipped || 0
      net += res?.totalNet || 0
    }
    setBusy(false)
    if (fails.length) setErr(fails.join('  ·  '))
    if (processed) setResult({ processed, skipped, net })
    refresh()
  }

  async function downloadRegister() {
    setBusy(true); setErr('')
    try {
      const rows: Record<string, any>[] = []
      for (const r of monthRuns) {
        const part = await loadRunRegister(r.id)
        part.forEach(x => rows.push(isGroup ? { Company: r.company_name || '', ...x } : x))
      }
      if (!rows.length) { setErr('No payroll lines for this month yet — run payroll first.'); return }
      const header: string[] = []
      rows.forEach(r => Object.keys(r).forEach(k => { if (!header.includes(k)) header.push(k) }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header }), 'Register')
      XLSX.writeFile(wb, `EZER_Payroll_Register_${label.replace(/\s+/g, '_')}.xlsx`)
    } catch (e: any) { setErr('Export failed: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  const active = rd?.checks.find(c => c.key === tab) || rd?.checks[0] || null

  // Banner text — the point is that HR reads one line and knows whether to keep going.
  const banner = (() => {
    if (loading && !rd) return { tone: 'amber' as const, title: 'Checking the month…', sub: 'Reading every employee in the Month Master.' }
    if (!monthRuns.length) return { tone: 'amber' as const, title: 'No payroll month selected', sub: 'Create one in Configuration → Payroll Month, then come back here.' }
    if (closed) return { tone: 'green' as const, title: `Month is ${monthRuns[0].status.toLowerCase()}`, sub: 'Payroll for this month is closed to recalculation. Reopen it from Lock / Unlock if it genuinely has to change.' }
    if (blockers.length) return { tone: 'red' as const, title: 'Not ready to run', sub: blockerSummary(blockers) }
    if (result) return { tone: 'green' as const, title: 'Payroll run complete', sub: `${result.processed} employees processed${result.skipped ? ` · ${result.skipped} skipped` : ''} · net payable ${inr(result.net)}` }
    if (calculated) return { tone: 'green' as const, title: 'Payroll already calculated', sub: 'Nothing is blocking a re-run — re-run it if attendance or salary changed since.' }
    return { tone: 'green' as const, title: 'Ready to run', sub: `${rd?.cleanEmployees ?? 0} of ${rd?.totalEmployees ?? 0} employees have nothing outstanding.` }
  })()

  const hint = !monthRuns.length ? 'Create a payroll month first'
    : closed ? 'This month is locked — reopen it from Lock / Unlock'
      : blockers.length ? `Resolve ${blockers.map(b => b.label).join(' and ')} to enable this`
        : busy ? 'Working…'
          : `${rd?.totalEmployees ?? 0} employees in this month`

  return (
    <div style={{ fontFamily: font, fontSize: 14, color: C.navy, maxWidth: 960 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, margin: '0 0 4px', letterSpacing: '-0.02em', fontWeight: 700 }}>Payroll Run</h1>
          <div style={{ fontSize: 13, color: C.muted }}>
            🏢 {isGroup ? `Group Companies${monthRuns.length ? ` · ${monthRuns.length} compan${monthRuns.length === 1 ? 'y' : 'ies'}` : ''}` : (sel?.company_name || 'Company')}
          </div>
        </div>
        <select value={monthVal} onChange={e => { setMonthVal(e.target.value); setResult(null) }}
          style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 999, padding: '7px 16px',
            fontSize: 12.5, fontWeight: 600, color: C.purpleD, fontFamily: font, cursor: 'pointer', outline: 'none',
            boxShadow: '0 1px 3px rgba(124,58,237,0.06)',
          }}>
          {monthOpts.length === 0 && <option value="">📅 No month created</option>}
          {monthOpts.map(r => <option key={r.month} value={String(r.month)}>📅 {periodLabel(r)}</option>)}
        </select>
      </div>

      <Banner tone={banner.tone} title={banner.title} sub={banner.sub} />

      {rd && (
        <>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 2 }}>
            {rd.checks.map(c => (
              <Tab key={c.key} check={c} active={active?.key === c.key} onPick={() => setTab(c.key)} />
            ))}
          </div>

          <div style={{
            background: C.card, borderRadius: 16, padding: '22px 24px', marginBottom: 18,
            boxShadow: '0 1px 4px rgba(124,58,237,0.06)', border: `1px solid ${C.border}`,
          }}>
            {active && <CheckPanel check={active} isGroup={isGroup} />}
          </div>
        </>
      )}

      {err && (
        <div style={{ fontSize: 12, color: C.red, background: C.redBg, border: `1px solid ${C.redBd}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>{err}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={run} disabled={!canRun}
          style={{
            fontFamily: font, fontSize: 14, fontWeight: 700, color: '#fff',
            background: canRun ? C.purple : '#D8D3F5', border: 'none', borderRadius: 12,
            padding: '14px 28px', cursor: canRun ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: canRun ? '0 4px 14px rgba(124,58,237,0.25)' : 'none',
          }}>
          {busy ? '⏳ Running…' : calculated ? '▶️ Re-run Payroll' : '▶️ Run Payroll'}
        </button>
        {calculated && (
          <button onClick={downloadRegister} disabled={busy}
            style={{
              fontFamily: font, fontSize: 12.5, fontWeight: 600, color: C.purpleD, background: C.card,
              border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 18px', cursor: busy ? 'not-allowed' : 'pointer',
            }}>📥 Register</button>
        )}
        <span style={{ fontSize: 12, color: C.muted }}>{hint}</span>
      </div>
    </div>
  )
}
