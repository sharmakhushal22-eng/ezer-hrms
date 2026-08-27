'use client'
// components/payroll/PayslipDownload.tsx — the "Download payslips" button beside Run
// Payroll, and the preflight panel behind it.
//
// Enabled only when the month has been calculated and payroll_lines exist (the
// server decides; the button just asks). Before anything is rendered HR sees, on one
// screen: who gets a payslip, who does not and why, the data-quality gaps, and — if
// the run is older than its own inputs — a block that says re-run first (C4/C5/A3).
// Generation is chunked; the combined PDF is merged in the browser with pdf-lib and
// the per-employee ZIP is written by lib/zip-store (A2).
import { useEffect, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { authToken } from '@/lib/rms/client'
import { zipStore } from '@/lib/zip-store'
import { combinedFileName, monthLabel } from '@/lib/payroll/payslip'
import { C as TK } from '@/lib/ui'

const font = '"DM Sans","Segoe UI",sans-serif'
const C = {
  navy: '#1E1B4B', muted: '#6B7280', border: 'rgba(124,58,237,0.12)', card: '#FFFFFF',
  purple: '#7C3AED', purpleD: '#6D28D9', green: '#059669', amber: '#B45309', red: '#DC2626',
  soft: 'rgba(124,58,237,0.08)',
}

interface Preflight {
  run: { id: string; fy: string; month: number; status: string; period_label: string | null }
  company: { name?: string; short_name?: string }
  total: number
  eligible: { code: string; name: string }[]
  missing: { code: string; name: string; reason: string }[]
  stale: string | null
  issues: { code: string; name: string; text: string; blocking: boolean }[]
  batch: number
}

interface RunRef { id: string; company_name?: string | null }

async function api(path: string, init?: RequestInit) {
  const token = await authToken()
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function saveBlob(name: string, data: Uint8Array | Blob, type: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

const outlineBtn = (disabled: boolean) => ({
  fontFamily: font, fontSize: 13, fontWeight: 600 as const, color: C.purpleD, background: C.card,
  border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 18px', cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.55 : 1,
})

export default function PayslipDownload({ runs, enabled, busyOutside }: { runs: RunRef[]; enabled: boolean; busyOutside: boolean }) {
  // The parent keys this component on the month AND on the last run result, so a
  // month change or a re-run remounts it with fresh state — no in-effect resets needed.
  const [pre, setPre] = useState<Preflight[] | null>(null)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number; phase: string } | null>(null)
  const [showMissing, setShowMissing] = useState(false)
  const [showIssues, setShowIssues] = useState(false)

  const runKey = runs.map(r => r.id).join(',')
  useEffect(() => {
    if (!enabled || !runKey) return
    let live = true
    Promise.all(runKey.split(',').map(id => api(`/api/payroll/payslips?run_id=${encodeURIComponent(id)}`)))
      .then(list => { if (live) setPre(list) })
      .catch(e => { if (live) setErr(e?.message || String(e)) })
    return () => { live = false }
  }, [runKey, enabled])
  const loading = enabled && !!runKey && pre === null && !err

  const eligible = pre?.reduce((n, p) => n + p.eligible.length, 0) ?? 0
  const total = pre?.reduce((n, p) => n + p.total, 0) ?? 0
  const missing = pre?.flatMap(p => p.missing.map(m => ({ ...m, company: p.company.name }))) ?? []
  const issues = pre?.flatMap(p => p.issues.map(i => ({ ...i, company: p.company.name }))) ?? []
  const blockingCount = issues.filter(i => i.blocking).length
  const stale = pre?.map(p => p.stale).filter(Boolean) as string[] | undefined
  const busy = busyOutside || loading || !!progress
  const canGenerate = !!pre && eligible > 0 && !(stale && stale.length) && !busy

  async function generate(mode: 'combined' | 'zip') {
    if (!pre) return
    setErr('')
    const files: { file: string; bytes: Uint8Array }[] = []
    const refused: { code: string; reasons: string[] }[] = []
    const totalCodes = eligible
    let done = 0
    setProgress({ done, total: totalCodes, phase: 'Generating' })
    try {
      for (const p of pre) {
        for (const codes of chunk(p.eligible.map(e => e.code), p.batch)) {
          const out = await api('/api/payroll/payslips', { method: 'POST', body: JSON.stringify({ run_id: p.run.id, codes }) })
          out.files.forEach((f: any) => files.push({ file: f.file, bytes: b64ToBytes(f.pdf) }))
          refused.push(...(out.refused || []))
          done += codes.length
          setProgress({ done, total: totalCodes, phase: 'Generating' })
        }
      }
      if (!files.length) throw new Error('No payslip could be generated — see the issues list.')
      const first = pre[0]
      const stem = pre.length > 1 ? `Group_${monthLabel(first.run.fy, first.run.month).replace(' ', '')}` : (first.company.short_name || first.company.name || 'Payslips').replace(/[^A-Za-z0-9]+/g, '')
      if (mode === 'combined') {
        setProgress({ done, total: totalCodes, phase: 'Merging' })
        const doc = await PDFDocument.create()
        for (const f of files) {
          const src = await PDFDocument.load(f.bytes)
          const pages = await doc.copyPages(src, src.getPageIndices())
          pages.forEach(pg => doc.addPage(pg))
        }
        const merged = await doc.save()
        saveBlob(pre.length > 1 ? `${stem}_Payslips.pdf` : combinedFileName(stem, first.run.fy, first.run.month), merged, 'application/pdf')
      } else {
        setProgress({ done, total: totalCodes, phase: 'Zipping' })
        const zip = zipStore(files.map(f => ({ name: f.file, data: f.bytes })))
        saveBlob(`${stem}_${monthLabel(first.run.fy, first.run.month).replace(' ', '')}_Payslips.zip`, zip, 'application/zip')
      }
      if (refused.length) setErr(`${files.length} generated; ${refused.length} refused: ${refused.map(r => `${r.code} (${r.reasons[0]})`).join('; ')}`)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setProgress(null)
    }
  }

  const label = loading ? 'Checking payslips…'
    : progress ? `${progress.phase} ${progress.done}/${progress.total}…`
    : pre ? `Download payslips (${eligible} of ${total})`
    : 'Download payslips'

  return (
    <>
      <button onClick={() => setOpen(o => !o)} disabled={!enabled || busy || !pre}
        title={!enabled ? 'Run payroll for this month first' : undefined}
        style={outlineBtn(!enabled || busy || !pre)}>
        🧾 {label}
      </button>
      {err && !open && <span style={{ fontSize: 12, color: C.red, maxWidth: 520 }}>{err}</span>}

      {open && pre && (
        <div style={{ flexBasis: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginTop: 4, fontFamily: font }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.navy }}>Payslips — {monthLabel(pre[0].run.fy, pre[0].run.month)}</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {eligible} of {total} employee{total === 1 ? '' : 's'} have a payslip
              {pre.length > 1 && ` across ${pre.length} companies`}
            </div>
          </div>

          {stale && stale.length > 0 && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: C.red, fontSize: 12.5 }}>
              <b>Run is out of date — payslips are blocked.</b>
              {stale.map((s, i) => <div key={i} style={{ marginTop: 4 }}>{s}</div>)}
            </div>
          )}

          {blockingCount > 0 && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#FFFBEB', border: '1px solid #FDE68A', color: C.amber, fontSize: 12.5 }}>
              <b>{blockingCount} payslip{blockingCount === 1 ? '' : 's'} will be refused</b> — the stored figures do not tie. They stay out of the download; the rest go through.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => generate('combined')} disabled={!canGenerate}
              style={{ fontFamily: font, fontSize: 13, fontWeight: 700, color: TK.onAccent, background: canGenerate ? C.purple : TK.brandTint, border: 'none', borderRadius: 10, padding: '11px 18px', cursor: canGenerate ? 'pointer' : 'not-allowed' }}>
              📄 One PDF, all employees
            </button>
            <button onClick={() => generate('zip')} disabled={!canGenerate} style={outlineBtn(!canGenerate)}>
              🗜 ZIP — one PDF per employee
            </button>
            {progress && <span style={{ fontSize: 12, color: C.muted }}>{progress.phase} {progress.done}/{progress.total}…</span>}
            <span style={{ fontSize: 11.5, color: C.muted }}>Generated in batches of {pre[0].batch}. Every download is recorded in the payroll audit log.</span>
          </div>
          {err && <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>{err}</div>}

          {missing.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button onClick={() => setShowMissing(s => !s)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: font, fontSize: 12.5, fontWeight: 600, color: C.purpleD }}>
                {showMissing ? '▾' : '▸'} {missing.length} employee{missing.length === 1 ? '' : 's'} without a payslip
              </button>
              {showMissing && (
                <div style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ background: C.soft }}>
                      <th style={{ textAlign: 'left', padding: '6px 10px', color: C.purpleD, fontSize: 11 }}>Code</th>
                      <th style={{ textAlign: 'left', padding: '6px 10px', color: C.purpleD, fontSize: 11 }}>Name</th>
                      {pre.length > 1 && <th style={{ textAlign: 'left', padding: '6px 10px', color: C.purpleD, fontSize: 11 }}>Company</th>}
                      <th style={{ textAlign: 'left', padding: '6px 10px', color: C.purpleD, fontSize: 11 }}>Why</th>
                    </tr></thead>
                    <tbody>{missing.map(m => (
                      <tr key={m.code} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace' }}>{m.code}</td>
                        <td style={{ padding: '6px 10px', color: C.navy }}>{m.name}</td>
                        {pre.length > 1 && <td style={{ padding: '6px 10px', color: C.muted }}>{m.company || '—'}</td>}
                        <td style={{ padding: '6px 10px', color: C.muted }}>{m.reason}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {issues.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button onClick={() => setShowIssues(s => !s)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: font, fontSize: 12.5, fontWeight: 600, color: C.purpleD }}>
                {showIssues ? '▾' : '▸'} {issues.length} data-quality note{issues.length === 1 ? '' : 's'} ({blockingCount} blocking)
              </button>
              {showIssues && (
                <div style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <tbody>{issues.map((i, k) => (
                      <tr key={k} style={{ borderTop: k ? `1px solid ${C.border}` : 'none' }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{i.code}</td>
                        <td style={{ padding: '6px 10px', color: C.navy, whiteSpace: 'nowrap' }}>{i.name}</td>
                        <td style={{ padding: '6px 10px', color: i.blocking ? C.red : C.amber }}>{i.blocking ? '⛔ ' : '⚠ '}{i.text}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
