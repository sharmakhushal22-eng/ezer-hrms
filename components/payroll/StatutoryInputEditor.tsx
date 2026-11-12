'use client'
// components/payroll/StatutoryInputEditor.tsx — the "Edit" view for a Statutory & Tax section
// (EPF / ESIC / PT / LWF). Shows every in-scope employee's current master inputs as a table;
// "Edit" turns the input columns editable inline, "Save" writes them through the same endpoint
// the bulk sheet uses (/api/payroll/statutory-bulk). The next payroll run reads these — nothing
// frozen is touched.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { C } from '@/lib/ui'
import { authHeaders } from '@/lib/auth-headers'

type Kind = 'epf' | 'esic' | 'pt' | 'lwf'
type Col = { key: string; label: string; type: 'text' | 'bool' | 'num' }
const TITLE: Record<Kind, string> = { epf: 'EPF inputs', esic: 'ESIC inputs', pt: 'Professional Tax inputs', lwf: 'LWF inputs' }
const font = '"DM Sans","Segoe UI",sans-serif'

const th: React.CSSProperties = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', background: C.sunken, position: 'sticky', top: 0, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '7px 12px', fontSize: 12.5, color: C.ink, borderTop: `1px solid ${C.line}`, whiteSpace: 'nowrap' }
const inp: React.CSSProperties = { width: '100%', padding: '6px 8px', background: C.surface, border: `1px solid ${C.lineStrong}`, borderRadius: 7, color: C.ink, fontSize: 12.5, outline: 'none', fontFamily: font, boxSizing: 'border-box' }
const btn: React.CSSProperties = { height: 34, padding: '0 15px', borderRadius: 10, border: `1px solid ${C.brandDeep}`, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: font, background: C.brand, color: C.onAccent, whiteSpace: 'nowrap' }
const btnO: React.CSSProperties = { height: 34, padding: '0 15px', borderRadius: 10, border: `1px solid ${C.lineStrong}`, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: font, background: C.surface, color: C.ink, whiteSpace: 'nowrap' }

export default function StatutoryInputEditor({ kind, companyId, fy }: { kind: Kind; companyId: string; fy: string }) {
  const [cols, setCols] = useState<Col[]>([])
  const [rows, setRows] = useState<any[]>([])
  const [draft, setDraft] = useState<any[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'warn' | 'bad' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setMsg(null); setEditing(false)
    try {
      const res = await fetch(`/api/payroll/statutory-bulk?kind=${kind}&company_id=${companyId}`, { headers: await authHeaders() })
      const d = await res.json()
      if (!res.ok) { setMsg({ text: d.error || 'Could not load', tone: 'bad' }); setRows([]); setCols([]) }
      else { setCols(d.columns || []); setRows(d.rows || []) }
    } catch (e: any) { setMsg({ text: e?.message || 'Load failed', tone: 'bad' }) } finally { setLoading(false) }
  }, [kind, companyId])
  useEffect(() => { load() }, [load])

  const startEdit = () => { setDraft(rows.map(r => ({ ...r }))); setEditing(true); setMsg(null) }
  const cancel = () => { setEditing(false); setDraft([]); setMsg(null) }
  const setCell = (code: string, key: string, val: any) => setDraft(d => d.map(r => r.emp_code === code ? { ...r, [key]: val } : r))

  async function save() {
    // Only the rows that actually changed, so a big list doesn't rewrite everyone.
    const orig = new Map(rows.map(r => [r.emp_code, r]))
    const changed = draft.filter(r => cols.some(c => String(r[c.key] ?? '') !== String(orig.get(r.emp_code)?.[c.key] ?? '')))
    if (!changed.length) { setEditing(false); setMsg({ text: 'Nothing changed.', tone: 'warn' }); return }
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/payroll/statutory-bulk', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ kind, company_id: companyId, rows: changed }) })
      const d = await res.json()
      if (!res.ok) { setMsg({ text: d.error || 'Save failed', tone: 'bad' }); return }
      const s = d.summary || {}
      setMsg({ text: `${s.updated} saved · ${s.errors} error${s.errors === 1 ? '' : 's'}.`, tone: s.errors ? 'warn' : 'ok' })
      await load()
    } catch (e: any) { setMsg({ text: e?.message || 'Save failed', tone: 'bad' }) } finally { setSaving(false) }
  }

  const shown = useMemo(() => {
    const src = editing ? draft : rows
    const terms = q.split(/[\s,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
    if (!terms.length) return src
    return src.filter(r => terms.some(t => String(r.emp_code || '').toLowerCase().includes(t) || String(r.full_name || '').toLowerCase().includes(t)))
  }, [rows, draft, editing, q])

  const toneColor = msg?.tone === 'ok' ? C.positive : msg?.tone === 'warn' ? C.warning : C.critical
  const toneBg = msg?.tone === 'ok' ? C.positiveTint : msg?.tone === 'warn' ? C.warningTint : C.criticalTint

  const renderCell = (r: any, c: Col) => {
    if (!editing) {
      if (c.type === 'bool') return <span style={{ fontWeight: 600, color: String(r[c.key]).toUpperCase() === 'Y' ? C.positive : C.muted }}>{String(r[c.key]).toUpperCase() === 'Y' ? 'Y' : 'N'}</span>
      return <span>{r[c.key] === '' || r[c.key] == null ? '—' : String(r[c.key])}</span>
    }
    if (c.type === 'bool') return <select style={inp} value={String(r[c.key]).toUpperCase() === 'Y' ? 'Y' : 'N'} onChange={e => setCell(r.emp_code, c.key, e.target.value)}><option value="Y">Y</option><option value="N">N</option></select>
    if (c.type === 'num') return <input style={inp} type="number" value={r[c.key] ?? ''} onChange={e => setCell(r.emp_code, c.key, e.target.value)} />
    return <input style={inp} value={r[c.key] ?? ''} onChange={e => setCell(r.emp_code, c.key, e.target.value)} />
  }

  return (
    <div style={{ fontFamily: font, color: C.ink, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>Edit · {TITLE[kind]}</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>FY {fy} · click Edit, change what you need, then Save. The next payroll run picks it up.</div>
        </div>
        <input style={{ ...btnO, cursor: 'text', fontWeight: 400, width: 220 }} placeholder="Employee code or name" value={q} onChange={e => setQ(e.target.value)} />
        {!editing ? (
          <>
            <button style={btnO} onClick={load} disabled={loading}>Refresh</button>
            <button style={{ ...btn, opacity: rows.length ? 1 : 0.5 }} disabled={!rows.length} onClick={startEdit}>✎ Edit</button>
          </>
        ) : (
          <>
            <button style={btnO} onClick={cancel} disabled={saving}>Cancel</button>
            <button style={{ ...btn, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : '✓ Save'}</button>
          </>
        )}
      </div>

      {msg && <div style={{ fontSize: 12, color: toneColor, background: toneBg, border: `1px solid ${toneColor}`, borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>{msg.text}</div>}

      <div style={{ overflow: 'auto', maxHeight: '64vh', borderRadius: 10, border: `1px solid ${C.line}` }}>
        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>{rows.length === 0 ? 'No employees in scope.' : 'Nothing matched this search.'}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={th}>Code</th>
                <th style={th}>Name</th>
                {cols.map(c => <th key={c.key} style={th}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.emp_code}>
                  <td style={{ ...td, fontWeight: 700 }}>{r.emp_code}</td>
                  <td style={td}>{r.full_name}</td>
                  {cols.map(c => <td key={c.key} style={{ ...td, minWidth: c.type === 'text' ? 160 : 110 }}>{renderCell(r, c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
