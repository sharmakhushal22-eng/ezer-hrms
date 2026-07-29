'use client'
// components/payroll/MonthSync.tsx — Payroll → Attendance & Sync → Snapshot Sync.
// Re-freeze a payroll month's employee snapshot from current HRMS data (org / statutory /
// bank / CTC / salary + days_in_month) via sync_payroll_month — WITHOUT touching the
// attendance columns. Useful after CTC revisions / master edits once a month already exists.
import { useState, useEffect, useCallback } from 'react'
import { loadRuns, syncPayrollMonth, MONTHS, type PayrollRun } from '@/lib/payroll/core'
import { supabase } from '@/lib/supabase'

const C = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489', card: '#FFFFFF',
  border: '#E9E7F5', muted: '#6B7280', green: '#059669', greenBg: '#ECFDF5',
  greenBd: '#BBF7D0', amber: '#B45309', amberBg: '#FFFBEB', purpleBg: '#EEEDFE', gray: '#F8F7FF',
}
const font = '"DM Sans","Segoe UI",sans-serif'

export default function MonthSync({ companyId, fy }: { companyId: string; fy: string }) {
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [runId, setRunId] = useState('')
  const [snapCount, setSnapCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const reloadRuns = useCallback(async () => {
    const list = await loadRuns(companyId, fy)
    setRuns(list); if (list.length && !runId) setRunId(list[0].id)
  }, [companyId, fy]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reloadRuns() }, [reloadRuns])

  const refreshCount = useCallback(async () => {
    if (!runId) { setSnapCount(null); return }
    const { count } = await supabase.from('payroll_employee_snapshot').select('*', { count: 'exact', head: true }).eq('run_id', runId)
    setSnapCount(count ?? 0)
  }, [runId])
  useEffect(() => { refreshCount() }, [refreshCount])

  async function doSync() {
    if (!runId) return
    setBusy(true); setMsg(''); setErr('')
    const { error, count } = await syncPayrollMonth(runId)
    setBusy(false)
    if (error) { setErr(error); return }
    setMsg(`Snapshot re-synced — ${count} employees frozen from current HRMS data.`)
    refreshCount()
  }

  const runLabel = (r: PayrollRun) => `${r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`} · ${r.status}`
  const inp: React.CSSProperties = { padding: '9px 11px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: '#fff', color: C.navy, fontFamily: font, outline: 'none' }

  return (
    <div style={{ fontFamily: font, fontSize: 13, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, boxShadow: '0 3px 10px rgba(124,58,237,0.28)' }}>🔄</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Snapshot Sync</div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 3 }}>Re-freeze org / statutory / bank / CTC / salary from current HRMS — attendance is never touched</div>
        </div>
      </div>

      {!companyId && <div style={{ fontSize: 12, color: C.amber, background: C.amberBg, border: '1px solid #FDE8C8', padding: '10px 12px', borderRadius: 9, marginBottom: 12 }}>Pick a specific company in the header to see its payroll months.</div>}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(124,58,237,0.06)' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 10, color: C.muted, display: 'block', marginBottom: 4 }}>Payroll month</label>
            <select style={{ ...inp, minWidth: 240 }} value={runId} onChange={e => { setRunId(e.target.value); setMsg(''); setErr('') }}>
              {runs.length === 0 && <option value="">No month created — create one first</option>}
              {runs.map(r => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
            </select>
          </div>
          <button onClick={doSync} disabled={busy || !runId}
            style={{ padding: '10px 20px', borderRadius: 9, border: 'none', background: 'linear-gradient(120deg,#7C3AED,#5B21B6)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: busy || !runId ? 'not-allowed' : 'pointer', opacity: busy || !runId ? 0.6 : 1, boxShadow: '0 3px 10px rgba(124,58,237,0.22)' }}>
            {busy ? 'Syncing…' : '🔄 Re-sync snapshot'}
          </button>
        </div>

        {snapCount != null && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10 }}>Current snapshot rows for this month: <b style={{ color: C.navy }}>{snapCount}</b></div>}
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8, background: C.gray, borderRadius: 8, padding: '9px 11px', lineHeight: 1.5 }}>
          Month Create already runs this automatically. Use it again after a CTC revision, transfer, or master-data edit to refresh the frozen figures for an existing month — <b>paid days, leave and OT stay exactly as uploaded</b>.
        </div>

        {msg && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 9, padding: '10px 14px', marginTop: 12 }}>✓ {msg}</div>}
        {err && <div style={{ fontSize: 12, color: '#DC2626', background: '#FEF2F2', borderRadius: 9, padding: '10px 14px', marginTop: 12 }}>{err}</div>}
      </div>
    </div>
  )
}
