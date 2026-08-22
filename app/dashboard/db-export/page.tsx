'use client'
// app/dashboard/db-export/page.tsx — one-click full database export to Excel.
import { useState } from 'react'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = { bg: TK.canvas, navy: TK.ink, purple: TK.brand, muted: TK.muted, border: TK.line, green: TK.positive, red: TK.critical }
const font = '"DM Sans","Segoe UI",sans-serif'

export default function DbExportPage() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  async function download() {
    setBusy(true); setErr(''); setDone(false)
    try {
      const res = await fetch('/api/db-export')
      if (!res.ok) {
        let msg = 'Export failed (' + res.status + ')'
        try { msg = (await res.json()).error || msg } catch { /* non-json */ }
        throw new Error(msg)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `EZER_HRMS_full_export_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      setDone(true)
    } catch (e: any) { setErr(e?.message || 'Export failed') }
    setBusy(false)
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', fontFamily: font, color: C.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: TK.surface, border: `1px solid ${C.border}`, borderRadius: 18, padding: '38px 40px', maxWidth: 520, width: '100%', textAlign: 'center', boxShadow: '0 10px 40px rgba(30,27,75,0.10)' }}>
        <div style={{ width: 66, height: 66, borderRadius: 18, background: 'linear-gradient(135deg,#1E1B4B,#2563EB)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 18px' }}></div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Database Export</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
          Download the <b>entire HRMS database</b> — every table, every column, all rows — into one Excel workbook (a sheet per table, with column headers). Nothing is left out.
        </div>

        <button onClick={download} disabled={busy} style={{
          marginTop: 24, padding: '14px 28px', borderRadius: 12, border: 'none',
          background: busy ? TK.faint : 'linear-gradient(120deg,#059669,#047857)', color: TK.onAccent,
          fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', width: '100%',
          boxShadow: busy ? 'none' : '0 6px 18px rgba(5,150,105,0.32)',
        }}>
          {busy ? 'Exporting the whole database…' : '⬇ Download entire database (Excel)'}
        </button>

        {busy && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 12 }}>This can take a while for large databases — please keep this tab open.</div>}
        {done && <div style={{ fontSize: 12.5, color: C.green, marginTop: 14, fontWeight: 600 }}>Export downloaded.</div>}
        {err && <div style={{ fontSize: 12.5, color: C.red, marginTop: 14 }}>⚠ {err}</div>}

        <div style={{ fontSize: 11, color: C.muted, marginTop: 22, borderTop: `1px dashed ${C.border}`, paddingTop: 14, lineHeight: 1.6 }}>
          Uses the service-role key server-side, so row-level security never hides anything. Encrypted columns (e.g. Aadhaar/bank) export as their stored ciphertext. For very large databases, run this on <b>localhost</b> (a hosted response has a size cap).
        </div>
      </div>
    </div>
  )
}
