// ================================================================
// EZER HRMS — Letter Templates: Design & Generate
// Path: components/letters/LetterTemplates.tsx (HR Letters → Design & Generate Letters)
//
// Tab 1 — Templates: the letter text is edited in Configuration now
//   (Global default + per-company versions, with history). This tab only
//   points there; the designer that used to live here wrote straight to
//   letter_templates from the browser and had no versions.
// Tab 2 — Generate: pick a template + company, paste employee codes,
//   generate real letters (letterhead + signatory resolved per
//   employee's branch), then download / email / publish to ESS. The
//   text used is the company's Configuration version (api/letters/generate).
//
// Depends on: lib/letters/*, lib/letterhead/*, api/letters/generate,
// lib/config/* (Configuration templates).
// ================================================================
'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { getGeneratedLetterDownloadUrl, publishLetterToEss } from '@/lib/letters/actions'
// Both letter routes are guarded server-side; the session has to go along.
import { authHeaders } from '@/lib/auth-headers'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

const C = {
  bg: TK.canvas, navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep,
  card: TK.surface, border: TK.line, muted: TK.muted,
  green: TK.positive, greenBg: TK.positiveTint, greenBd: TK.positiveTint,
  amber: TK.warning, amberBg: TK.warningTint, amberBd: TK.warningTint,
  red: TK.critical, redBg: TK.criticalTint, redBd: TK.criticalTint,
  purpleBg: TK.brandTint, gray: TK.sunken,
}

interface Template {
  id: string; name: string; description: string | null; content: string; updated_at: string
}
interface Company { id: string; company_name: string }
interface GenResult {
  employee_code: string; status: string; employee_name?: string
  generated_letter_id?: string; unknown_tokens?: string[]; error?: string
}

// ── Sub-components — kept OUTSIDE the main component ──────────────

function TabBar({ active, onChange }: { active: 'templates' | 'generate'; onChange: (t: 'templates' | 'generate') => void }) {
  const tabs: ['templates', 'generate'] = ['templates', 'generate']
  const labels = { templates: 'Letter Templates', generate: 'Generate Letters' }
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.border}` }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onChange(t)}
          style={{
            padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: active === t ? C.purple : C.muted,
            borderBottom: active === t ? `2px solid ${C.purple}` : '2px solid transparent', marginBottom: -1,
          }}>
          {labels[t]}
        </button>
      ))}
    </div>
  )
}

function ResultRow({ r }: { r: GenResult }) {
  const [downloading, setDownloading] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [emailNote, setEmailNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)

  const statusMeta: Record<string, [string, string, string]> = {
    GENERATED: [C.greenBg, C.green, 'Generated'],
    SKIPPED_NOT_FOUND: [C.redBg, C.red, 'Code not found'],
    SKIPPED_NO_LETTERHEAD: [C.amberBg, C.amber, 'No letterhead configured for branch'],
    SKIPPED_UNKNOWN_TOKENS: [C.amberBg, C.amber, 'Template has unknown fields'],
    ERROR: [C.redBg, C.red, 'Error'],
  }
  const [bg, fg, label] = statusMeta[r.status] ?? [C.gray, C.muted, r.status]

  async function handleDownload() {
    if (!r.generated_letter_id) return
    setDownloading(true)
    const { data } = await supabase.from('generated_letters').select('file_url').eq('id', r.generated_letter_id).single()
    if (data?.file_url) {
      const url = await getGeneratedLetterDownloadUrl(data.file_url)
      if (url) window.open(url, '_blank')
    }
    setDownloading(false)
  }

  async function handleEmail() {
    if (!r.generated_letter_id) return
    setEmailing(true)
    setEmailNote(null)
    try {
      const res = await fetch('/api/letters/email', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ generated_letter_id: r.generated_letter_id }) })
      const d = await res.json().catch(() => ({}))
      setEmailNote(res.ok ? { ok: true, text: `Emailed to ${d.to}` } : { ok: false, text: d.error || `HTTP ${res.status}` })
    } catch { setEmailNote({ ok: false, text: 'Network error' }) }
    setEmailing(false)
  }

  async function handlePublish() {
    if (!r.generated_letter_id) return
    setPublishing(true)
    await publishLetterToEss(r.generated_letter_id)
    setPublishing(false)
    setPublished(true)
  }

  return (
    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
      <td style={{ padding: '9px 8px', fontSize: 11, fontFamily: 'monospace', color: C.purpleD, fontWeight: 600 }}>{r.employee_code}</td>
      <td style={{ padding: '9px 8px', fontSize: 12, color: C.navy }}>{r.employee_name ?? '-'}</td>
      <td style={{ padding: '9px 8px' }}>
        <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 999, background: bg, color: fg, fontWeight: 700 }}>{label}</span>
        {r.unknown_tokens && <div style={{ fontSize: 10, color: C.amber, marginTop: 3 }}>{r.unknown_tokens.map(t => `{{${t}}}`).join(', ')}</div>}
        {r.error && <div style={{ fontSize: 10, color: C.red, marginTop: 3 }}>{r.error}</div>}
      </td>
      <td style={{ padding: '9px 8px' }}>
        {r.status === 'GENERATED' && (
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={handleDownload} disabled={downloading}
              style={{ padding: '4px 9px', fontSize: 10, borderRadius: 7, border: `1px solid ${C.border}`, background: TK.surface, cursor: 'pointer' }}>
              {downloading ? '…' : '⬇ Download'}
            </button>
            <button onClick={handleEmail} disabled={emailing}
              style={{ padding: '4px 9px', fontSize: 10, borderRadius: 7, border: `1px solid ${C.border}`, background: TK.surface, cursor: 'pointer' }}>
              {emailing ? '…' : 'Email'}
            </button>
            <button onClick={handlePublish} disabled={publishing || published}
              style={{ padding: '4px 9px', fontSize: 10, borderRadius: 7, border: `1px solid ${published ? C.greenBd : C.border}`, background: published ? C.greenBg: TK.surface, color: published ? C.green : C.navy, cursor: published ? 'default' : 'pointer' }}>
              {published ? 'Published to ESS' : publishing ? '…' : 'Publish to ESS'}
            </button>
          </div>
        )}
        {emailNote && <div style={{ fontSize: 10, marginTop: 4, color: emailNote.ok ? C.green : C.red }}>{emailNote.text}</div>}
      </td>
    </tr>
  )
}

// ── Main component (rendered inside the HR Letters section) ──────
export default function LetterTemplates() {
  // Generate is the working half of this screen now; template text lives in Configuration.
  const [tab, setTab] = useState<'templates' | 'generate'>('generate')

  // Generate tab state
  const [templates, setTemplates] = useState<Template[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [genCompanyId, setGenCompanyId] = useState('')
  const [genTemplateId, setGenTemplateId] = useState('')
  const [codesText, setCodesText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genResults, setGenResults] = useState<GenResult[] | null>(null)
  const [genError, setGenError] = useState('')

  const loadTemplates = useCallback(async () => {
    const { data } = await supabase.from('letter_templates').select('*').eq('is_active', true).order('updated_at', { ascending: false })
    setTemplates((data ?? []) as Template[])
  }, [])

  useEffect(() => { loadTemplates() }, [loadTemplates])
  useEffect(() => { supabase.from('companies').select('id, company_name').order('company_name').then(({ data }) => setCompanies((data ?? []) as Company[])) }, [])

  async function handleGenerate() {
    const codes = codesText.split(/[\n,]+/).map(c => c.trim()).filter(Boolean)
    if (!genCompanyId || !genTemplateId || codes.length === 0) return
    setGenerating(true)
    setGenResults(null)
    setGenError('')
    // Awaited: an un-awaited authHeaders() promise is silently ignored by fetch and the
    // guarded route answers 401 for everyone.
    const res = await fetch('/api/letters/generate', {
      method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: genTemplateId, company_id: genCompanyId, employee_codes: codes }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setGenError(data.error || `HTTP ${res.status}`)
    setGenResults(data.results ?? [])
    setGenerating(false)
  }

  const selStyle: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, background: TK.sunken, color: C.navy, outline: 'none', width: '100%', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '16px 24px 24px', fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13 }}>
      <TabBar active={tab} onChange={setTab} />

      {tab === 'templates' && (
        <div style={{ maxWidth: 640, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, marginBottom: 6 }}>Letter text is edited in Configuration</div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
            Add a letter type and write its text in <b>Configuration → Letters</b>. There you can keep a Global version
            and a different version for each company, preview it with sample data, and see who changed what.
            Letters you generate here always use the version for the company you pick.
          </div>
          <a href="/dashboard/configuration?tab=letters"
            style={{ display: 'inline-block', padding: '9px 18px', borderRadius: 10, background: C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>
            Open Configuration → Letters
          </a>
        </div>
      )}

      {tab === 'generate' && (
        <div style={{ maxWidth: 640 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px', marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Company</div>
                <select value={genCompanyId} onChange={e => setGenCompanyId(e.target.value)} style={selStyle}>
                  <option value="">Select company</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Letter</div>
                <select value={genTemplateId} onChange={e => setGenTemplateId(e.target.value)} style={selStyle}>
                  <option value="">Select letter template</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Employee codes (one per line or comma-separated)</div>
            <textarea value={codesText} onChange={e => setCodesText(e.target.value)}
              placeholder={'SRS0001\nSRS0002\nSRS0007'}
              style={{ width: '100%', height: 110, padding: '10px', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box', resize: 'vertical' }} />
            <button onClick={handleGenerate} disabled={generating || !genCompanyId || !genTemplateId || !codesText.trim()}
              style={{ marginTop: 10, padding: '10px 20px', borderRadius: 10, border: 'none', background: C.purple, color: TK.onAccent, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: (generating || !genCompanyId || !genTemplateId || !codesText.trim()) ? 0.5 : 1 }}>
              {generating ? 'Generating…' : 'Generate letters'}
            </button>
            {genError && <div style={{ fontSize: 11, color: C.red, marginTop: 8 }}>{genError}</div>}
          </div>

          {genResults && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.navy }}>
                    {['Emp code', 'Name', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '9px 8px', textAlign: 'left', fontSize: 10, color: TK.brand, fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {genResults.map(r => <ResultRow key={r.employee_code} r={r} />)}
                </tbody>
              </table>
              <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, background: C.gray, fontSize: 11, color: C.muted }}>
                {genResults.filter(r => r.status === 'GENERATED').length} of {genResults.length} generated successfully
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
