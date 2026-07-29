// ================================================================
// EZER HRMS — Letter Templates: Design & Generate
// Path: app/dashboard/admin/letters/page.tsx
//
// Tab 1 — Templates: create/edit named letter templates with
//   {{merge_field}} tokens, preview against sample data.
// Tab 2 — Generate: pick a template + company, paste employee codes,
//   generate real letters (letterhead + signatory resolved per
//   employee's branch), then download / email / publish to ESS.
//
// Depends on: migration 052_letter_templates.sql, lib/letters/*,
// lib/letterhead/* (from the previous delivery), api/letters/generate.
// ================================================================
'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { MERGE_FIELDS, sampleMergeFields } from '@/lib/letters/mergeFields'
import { renderTemplate, extractTokens } from '@/lib/letters/renderTemplate'
import { getGeneratedLetterDownloadUrl, publishLetterToEss } from '@/lib/letters/actions'
import type { MergeField } from '@/lib/letters/mergeFields'

const C = {
  bg: '#F5F3FF', navy: '#1E1B4B', purple: '#7C3AED', purpleD: '#3C3489',
  card: '#FFFFFF', border: '#E9E7F5', muted: '#6B7280',
  green: '#059669', greenBg: '#ECFDF5', greenBd: '#BBF7D0',
  amber: '#D97706', amberBg: '#FFFBEB', amberBd: '#FDE68A',
  red: '#DC2626', redBg: '#FEF2F2', redBd: '#FCA5A5',
  purpleBg: '#EEEDFE', gray: '#F8F7FF',
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
  const labels = { templates: '📝 Letter Templates', generate: '⚡ Generate Letters' }
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

function TemplateListRow({ tpl, selected, onSelect }: { tpl: Template; selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect} style={{
      padding: '10px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
      background: selected ? C.purpleBg : C.card, border: `1px solid ${selected ? C.purple : C.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.navy }}>{tpl.name}</div>
      {tpl.description && <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{tpl.description}</div>}
    </div>
  )
}

function FieldPickerButton({ field, onInsert }: { field: MergeField; onInsert: (token: string) => void }) {
  return (
    <button onClick={() => onInsert(field.token)}
      style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', color: C.purpleD, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      + {field.label}
    </button>
  )
}

function NewTemplateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, description: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,0.45)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 420 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 14 }}>Add new letter</div>
        <label style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>Name of letter *</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Offer Letter"
          style={{ width: '100%', padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }} />
        <label style={{ fontSize: 10, fontWeight: 700, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional — what this letter is for"
          style={{ width: '100%', padding: '9px 11px', border: '1px solid #DDD6FE', borderRadius: 7, fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!name.trim()} onClick={() => onCreate(name.trim(), description.trim())}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: C.purple, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: !name.trim() ? 0.5 : 1 }}>
            Create & design
          </button>
          <button onClick={onClose} style={{ padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function ResultRow({ r }: { r: GenResult }) {
  const [downloading, setDownloading] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState(false)

  const statusMeta: Record<string, [string, string, string]> = {
    GENERATED: [C.greenBg, C.green, '✓ Generated'],
    SKIPPED_NOT_FOUND: [C.redBg, C.red, '✗ Code not found'],
    SKIPPED_NO_LETTERHEAD: [C.amberBg, C.amber, '⚠ No letterhead configured for branch'],
    SKIPPED_UNKNOWN_TOKENS: [C.amberBg, C.amber, '⚠ Template has unknown fields'],
    ERROR: [C.redBg, C.red, '✗ Error'],
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
    await fetch('/api/letters/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generated_letter_id: r.generated_letter_id }) })
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
      <td style={{ padding: '9px 8px', fontSize: 12, color: C.navy }}>{r.employee_name ?? '—'}</td>
      <td style={{ padding: '9px 8px' }}>
        <span style={{ fontSize: 10, padding: '2px 9px', borderRadius: 999, background: bg, color: fg, fontWeight: 700 }}>{label}</span>
        {r.unknown_tokens && <div style={{ fontSize: 9.5, color: C.amber, marginTop: 3 }}>{r.unknown_tokens.map(t => `{{${t}}}`).join(', ')}</div>}
        {r.error && <div style={{ fontSize: 9.5, color: C.red, marginTop: 3 }}>{r.error}</div>}
      </td>
      <td style={{ padding: '9px 8px' }}>
        {r.status === 'GENERATED' && (
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={handleDownload} disabled={downloading}
              style={{ padding: '4px 9px', fontSize: 10, borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer' }}>
              {downloading ? '…' : '⬇ Download'}
            </button>
            <button onClick={handleEmail} disabled={emailing}
              style={{ padding: '4px 9px', fontSize: 10, borderRadius: 6, border: `1px solid ${C.border}`, background: '#fff', cursor: 'pointer' }}>
              {emailing ? '…' : '✉ Email'}
            </button>
            <button onClick={handlePublish} disabled={publishing || published}
              style={{ padding: '4px 9px', fontSize: 10, borderRadius: 6, border: `1px solid ${published ? C.greenBd : C.border}`, background: published ? C.greenBg : '#fff', color: published ? C.green : C.navy, cursor: published ? 'default' : 'pointer' }}>
              {published ? '✓ Published to ESS' : publishing ? '…' : '📤 Publish to ESS'}
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// ── Main component (rendered inside the HR Letters section) ──────
export default function LetterTemplates() {
  const [tab, setTab] = useState<'templates' | 'generate'>('templates')

  // Templates tab state
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTpl, setSelectedTpl] = useState<Template | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  // Generate tab state
  const [companies, setCompanies] = useState<Company[]>([])
  const [genCompanyId, setGenCompanyId] = useState('')
  const [genTemplateId, setGenTemplateId] = useState('')
  const [codesText, setCodesText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genResults, setGenResults] = useState<GenResult[] | null>(null)

  const loadTemplates = useCallback(async () => {
    const { data } = await supabase.from('letter_templates').select('*').eq('is_active', true).order('updated_at', { ascending: false })
    setTemplates((data ?? []) as Template[])
  }, [])

  useEffect(() => { loadTemplates() }, [loadTemplates])
  useEffect(() => { supabase.from('companies').select('id, company_name').order('company_name').then(({ data }) => setCompanies((data ?? []) as Company[])) }, [])
  useEffect(() => { setContent(selectedTpl?.content ?? ''); setPreviewUrl(null) }, [selectedTpl])

  async function createTemplate(name: string, description: string) {
    const { data } = await supabase.from('letter_templates').insert({ name, description }).select().single()
    setShowNewModal(false)
    await loadTemplates()
    if (data) setSelectedTpl(data as Template)
  }

  async function saveContent() {
    if (!selectedTpl) return
    setSaving(true)
    await supabase.from('letter_templates').update({ content }).eq('id', selectedTpl.id)
    setSaving(false)
    loadTemplates()
  }

  function insertField(token: string) {
    const ta = editorRef.current
    if (!ta) { setContent(c => c + `{{${token}}}`); return }
    const start = ta.selectionStart, end = ta.selectionEnd
    const next = content.slice(0, start) + `{{${token}}}` + content.slice(end)
    setContent(next)
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + token.length + 4 })
  }

  async function previewSample() {
    if (!selectedTpl) return
    setPreviewing(true)
    const { text } = renderTemplate(content, sampleMergeFields())
    const res = await fetch('/api/letters/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ letter_name: selectedTpl.name, body_text: text }),
    })
    if (res.ok) {
      const blob = await res.blob()
      setPreviewUrl(URL.createObjectURL(blob))
    }
    setPreviewing(false)
  }

  const usedTokens = extractTokens(content)
  const unknownInEditor = usedTokens.filter(t => !MERGE_FIELDS.some(f => f.token === t))

  async function handleGenerate() {
    const codes = codesText.split(/[\n,]+/).map(c => c.trim()).filter(Boolean)
    if (!genCompanyId || !genTemplateId || codes.length === 0) return
    setGenerating(true)
    setGenResults(null)
    const res = await fetch('/api/letters/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: genTemplateId, company_id: genCompanyId, employee_codes: codes }),
    })
    const data = await res.json()
    setGenResults(data.results ?? [])
    setGenerating(false)
  }

  const selStyle: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, background: '#F8F7FF', color: C.navy, outline: 'none', width: '100%', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '16px 24px 24px', fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13 }}>
      <TabBar active={tab} onChange={setTab} />

      {tab === 'templates' && (
        <div style={{ display: 'flex', gap: 20 }}>
          {/* Template list */}
          <div style={{ width: 260, flexShrink: 0 }}>
            <button onClick={() => setShowNewModal(true)}
              style={{ width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: C.purple, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', marginBottom: 12 }}>
              + Add new letter
            </button>
            {templates.map(t => (
              <TemplateListRow key={t.id} tpl={t} selected={selectedTpl?.id === t.id} onSelect={() => setSelectedTpl(t)} />
            ))}
          </div>

          {/* Designer */}
          <div style={{ flex: 1, minWidth: 0, maxWidth: 700 }}>
            {!selectedTpl ? (
              <div style={{ color: C.muted }}>Select a letter on the left, or add a new one, to start designing.</div>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.navy, marginBottom: 10 }}>{selectedTpl.name}</div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 5 }}>Insert field:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {MERGE_FIELDS.map(f => <FieldPickerButton key={f.token} field={f} onInsert={insertField} />)}
                  </div>
                </div>

                <textarea ref={editorRef} value={content} onChange={e => setContent(e.target.value)}
                  placeholder={'Dear {{employee_name}},\n\nWe are pleased to confirm...'}
                  style={{ width: '100%', height: 280, padding: '14px', border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13, lineHeight: 1.6, fontFamily: 'Georgia, serif', boxSizing: 'border-box', resize: 'vertical' }} />

                {unknownInEditor.length > 0 && (
                  <div style={{ fontSize: 11, color: C.red, background: C.redBg, padding: '6px 10px', borderRadius: 6, marginTop: 6 }}>
                    ⚠ Unknown field{unknownInEditor.length > 1 ? 's' : ''}: {unknownInEditor.map(t => `{{${t}}}`).join(', ')} — these will print literally on the letter.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={saveContent} disabled={saving}
                    style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: C.purple, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={previewSample} disabled={previewing}
                    style={{ padding: '9px 18px', borderRadius: 8, border: `1px solid ${C.purple}`, background: '#fff', color: C.purpleD, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    {previewing ? 'Rendering…' : '👁 Preview sample'}
                  </button>
                  {previewUrl && (
                    <a href={previewUrl} target="_blank" rel="noreferrer"
                      style={{ padding: '9px 18px', borderRadius: 8, border: `1px solid ${C.greenBd}`, background: C.greenBg, color: C.green, fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>
                      ↗ Open preview PDF
                    </a>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'generate' && (
        <div style={{ maxWidth: 640 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px', marginBottom: 14 }}>
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
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Employee codes — one per line or comma-separated</div>
            <textarea value={codesText} onChange={e => setCodesText(e.target.value)}
              placeholder={'SRS0001\nSRS0002\nSRS0007'}
              style={{ width: '100%', height: 110, padding: '10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box', resize: 'vertical' }} />
            <button onClick={handleGenerate} disabled={generating || !genCompanyId || !genTemplateId || !codesText.trim()}
              style={{ marginTop: 10, padding: '10px 20px', borderRadius: 8, border: 'none', background: C.purple, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: (generating || !genCompanyId || !genTemplateId || !codesText.trim()) ? 0.5 : 1 }}>
              {generating ? 'Generating…' : '⚡ Generate letters'}
            </button>
          </div>

          {genResults && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.navy }}>
                    {['Emp code', 'Name', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '9px 8px', textAlign: 'left', fontSize: 10, color: '#A5B4FC', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
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

      {showNewModal && <NewTemplateModal onClose={() => setShowNewModal(false)} onCreate={createTemplate} />}
    </div>
  )
}
