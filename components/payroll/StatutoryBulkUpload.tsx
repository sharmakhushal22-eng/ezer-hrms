'use client'
// components/payroll/StatutoryBulkUpload.tsx — the bulk "download → edit → upload" card shown
// in each Statutory & Tax section (EPF, ESIC, VPF, NPS). It downloads the current per-employee
// master inputs prefilled, lets HR edit the sheet, and uploads it to /api/payroll/statutory-bulk,
// which updates the right table. The next payroll Run/Calculate reads these — nothing frozen is
// edited here.
import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { C } from '@/lib/ui'
import { authHeaders } from '@/lib/auth-headers'

type Kind = 'epf' | 'esic' | 'pt' | 'lwf' | 'vpf' | 'nps'
const TITLE: Record<Kind, string> = { epf: 'EPF inputs', esic: 'ESIC inputs', pt: 'Professional Tax inputs', lwf: 'LWF inputs', vpf: 'VPF %', nps: 'NPS (PRAN)' }
const font = '"DM Sans","Segoe UI",sans-serif'

const btn: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 10, border: `1px solid ${C.brandDeep}`, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: font, background: C.brand, color: C.onAccent, whiteSpace: 'nowrap' }
const btnO: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 10, border: `1px solid ${C.lineStrong}`, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: font, background: C.surface, color: C.ink, whiteSpace: 'nowrap' }

export default function StatutoryBulkUpload({ kind, companyId, fy, onApplied }: {
  kind: Kind; companyId: string; fy: string; onApplied?: () => void
}) {
  const [busy, setBusy] = useState<'' | 'download' | 'upload'>('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'bad' } | null>(null)
  const [errLines, setErrLines] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  async function download() {
    setBusy('download'); setMsg(null); setErrLines([])
    try {
      const res = await fetch(`/api/payroll/statutory-bulk?kind=${kind}&company_id=${companyId}`, { headers: await authHeaders() })
      const d = await res.json()
      if (!res.ok) { setMsg({ text: d.error || 'Could not build the sheet', tone: 'bad' }); return }
      const cols: { key: string; label: string }[] = d.columns || []
      const keys = ['emp_code', 'full_name', ...cols.map(c => c.key)]
      const labels = ['Employee Code', 'Name', ...cols.map(c => c.label)]
      const aoa = [labels, ...(d.rows || []).map((r: any) => keys.map(k => r[k] ?? ''))]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = labels.map(l => ({ wch: Math.max(12, Math.min(40, String(l).length + 2)) }))
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, kind.toUpperCase())
      XLSX.writeFile(wb, `EZER_${kind.toUpperCase()}_inputs_${fy}.xlsx`)
      if (!(d.rows || []).length) setMsg({ text: 'No employees in scope — the sheet has headers only.', tone: 'warn' })
    } catch (e: any) { setMsg({ text: e?.message || 'Download failed', tone: 'bad' }) } finally { setBusy('') }
  }

  async function onFile(file: File) {
    setBusy('upload'); setMsg(null); setErrLines([])
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
      if (aoa.length < 2) { setMsg({ text: 'The sheet has no data rows.', tone: 'bad' }); return }
      // Column order matches the template: emp_code, full_name, then this kind's columns.
      const colsRes = await fetch(`/api/payroll/statutory-bulk?kind=${kind}&company_id=${companyId}`, { headers: await authHeaders() }).then(r => r.json()).catch(() => null)
      const cols: { key: string }[] = colsRes?.columns || []
      const keys = ['emp_code', 'full_name', ...cols.map(c => c.key)]
      const rows = aoa.slice(1)
        .map(arr => { const o: any = {}; keys.forEach((k, i) => { o[k] = arr[i] }); return o })
        .filter(o => String(o.emp_code || '').trim())
      if (!rows.length) { setMsg({ text: 'No rows with an employee code were found.', tone: 'bad' }); return }

      const res = await fetch('/api/payroll/statutory-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ kind, company_id: companyId, rows }) })
      const d = await res.json()
      if (!res.ok) { setMsg({ text: d.error || 'Upload failed', tone: 'bad' }); return }
      const s = d.summary || {}
      setMsg({ text: `${s.updated} updated · ${s.skipped} unchanged · ${s.errors} error${s.errors === 1 ? '' : 's'} (of ${s.total}).`, tone: s.errors ? 'warn' : 'ok' })
      setErrLines((d.results || []).filter((r: any) => r.status === 'error').slice(0, 12).map((r: any) => `${r.emp_code || '(no code)'} — ${r.message}`))
      onApplied?.()
    } catch (e: any) { setMsg({ text: e?.message || 'Could not read the file', tone: 'bad' }) } finally { setBusy(''); if (inputRef.current) inputRef.current.value = '' }
  }

  const toneColor = msg?.tone === 'ok' ? C.positive : msg?.tone === 'warn' ? C.warning : C.critical
  const toneBg = msg?.tone === 'ok' ? C.positiveTint : msg?.tone === 'warn' ? C.warningTint : C.criticalTint

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px', marginBottom: 16, fontFamily: font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Bulk update · {TITLE[kind]}</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>Download the current values, edit the sheet, upload it back. The next payroll run picks up the changes.</div>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        <button style={{ ...btnO, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={download}>{busy === 'download' ? 'Preparing…' : '⬇ Download sheet'}</button>
        <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={() => inputRef.current?.click()}>{busy === 'upload' ? 'Uploading…' : '⬆ Upload sheet'}</button>
      </div>
      {msg && (
        <div style={{ marginTop: 10, fontSize: 12, color: toneColor, background: toneBg, border: `1px solid ${toneColor}`, borderRadius: 10, padding: '8px 12px' }}>
          {msg.text}
          {errLines.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
              {errLines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
