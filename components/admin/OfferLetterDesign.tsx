'use client'
// components/admin/OfferLetterDesign.tsx — Admin Setup › Offer Letter.
//
// WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT
//
// Owns: the offer letter's BODY template ({{token}} placeholders) and its TERMS
// and ANNEXURES. Both are per-company, falling back to a group-wide default —
// the same Branch > Company > Group spirit the letterhead cascade already uses.
//
// Does NOT own the letterhead or the signature block. Those already exist, are
// already configurable at Group/Company/Branch, and already cascade:
//   components/letters/LetterheadConfig.tsx  (HR Letters › Letterhead & Signatory)
//   letterhead_files / letterhead_signatories + the *_resolved views
// Rebuilding them here would mean two UIs and two sets of tables disagreeing
// about one company's stationery. This screen links to them instead.
//
// The template is stored in letter_templates with letter_type = 'OFFER_LETTER'
// (migration 140), NOT looked up by name: the row was originally identified only
// by the string 'Offer Letter', and a rename would have silently detached it.
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { MERGE_FIELDS, sampleOfferMergeFields } from '@/lib/letters/mergeFields'
import { renderTemplate, extractTokens } from '@/lib/letters/renderTemplate'
import { C as TK, R, E, S as SP, W } from '@/lib/ui'

const LETTER_TYPE = 'OFFER_LETTER'
const font = '"DM Sans","Segoe UI",sans-serif'

// Only Offer and System tokens are offered here. The Employee/Employment/
// Appraisal groups resolve from an employees row, and an offer letter addresses
// a candidate who has none — inserting {{employee_code}} would print the
// literal token on a real offer, because renderTemplate leaves unknown tokens
// visible rather than dropping them.
const OFFER_TOKENS = MERGE_FIELDS.filter(f => f.group === 'Offer' || f.group === 'System')

interface Company { id: string; company_name: string }
interface Clause {
  id: string
  company_id: string | null
  kind: 'TERM' | 'ANNEXURE'
  heading: string | null
  body: string
  sort_order: number
  is_active: boolean
}

// ── Styles, from tokens only ────────────────────────────────────────────────
// No hex literals anywhere in this file: lib/ui/__tests__/theme-hardcoded-colours.test.ts
// counts them per file and fails the build when a count moves in EITHER
// direction, so a new file must score zero.
const S = {
  wrap: { maxWidth: 1040, margin: '0 auto', padding: '18px 24px 40px', boxSizing: 'border-box' as const, fontFamily: font, color: TK.ink },
  card: { background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: R.lg, padding: '16px 18px', marginBottom: SP.md, boxShadow: E.raised },
  h: { fontSize: 14, fontWeight: W.semi, color: TK.ink, marginBottom: 3 },
  sub: { fontSize: 12, color: TK.muted, marginBottom: SP.md },
  label: { fontSize: 11, fontWeight: W.semi, color: TK.brandDeep, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 5 },
  input: { width: '100%', padding: '9px 11px', background: TK.sunken, border: `1px solid ${TK.line}`, borderRadius: R.sm, color: TK.ink, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  ta: { width: '100%', padding: '11px 13px', background: TK.sunken, border: `1px solid ${TK.line}`, borderRadius: R.sm, color: TK.ink, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit', lineHeight: 1.65, resize: 'vertical' as const },
  btn: { padding: '8px 15px', borderRadius: R.sm, border: `1px solid ${TK.line}`, background: TK.surface, color: TK.ink, fontSize: 12, fontWeight: W.semi, cursor: 'pointer', fontFamily: 'inherit' },
  btnP: { padding: '9px 17px', borderRadius: R.sm, border: 'none', background: TK.brand, color: TK.onAccent, fontSize: 12.5, fontWeight: W.semi, cursor: 'pointer', fontFamily: 'inherit' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 99, fontSize: 10.5, fontWeight: W.semi, background: TK.brandTint, color: TK.brandDeep, border: `1px solid ${TK.brandEdge}` },
  tokBtn: { padding: '4px 9px', fontSize: 10.5, borderRadius: R.sm, border: `1px solid ${TK.line}`, background: TK.surface, color: TK.brandDeep, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' as const },
  warn: { background: TK.warningTint, border: `1px solid ${TK.warningEdge}`, color: TK.warning, borderRadius: R.sm, padding: '8px 11px', fontSize: 11.5, marginTop: SP.xs },
  note: { background: TK.brandTint, border: `1px solid ${TK.brandEdge}`, color: TK.brandDeep, borderRadius: R.sm, padding: '9px 12px', fontSize: 11.5 },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
}

// ── Sub-components at MODULE scope ─────────────────────────────────────────
// CLAUDE.md: a sub-component defined inside its parent re-mounts on every
// parent render, so a textarea loses focus after each keystroke. This screen is
// textarea-heavy, which is exactly where that bug bites hardest.

function TokenPicker({ onInsert }: { onInsert: (t: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: SP.xs }}>
      {OFFER_TOKENS.map(f => (
        <button key={f.token} type="button" style={S.tokBtn} title={`Insert {{${f.token}}}`}
          onClick={() => onInsert(f.token)}>
          {f.label}
        </button>
      ))}
    </div>
  )
}

function ClauseRow({ clause, onChange, onRemove, onMove }: {
  clause: Clause
  onChange: (patch: Partial<Clause>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  return (
    <div style={{ border: `1px solid ${TK.line}`, borderRadius: R.md, padding: '11px 13px', marginBottom: SP.xs, background: TK.surface }}>
      <div style={{ ...S.row, marginBottom: 7 }}>
        <span style={S.chip}>{clause.kind === 'TERM' ? 'Term' : 'Annexure'}</span>
        <input style={{ ...S.input, flex: 1, padding: '6px 9px', fontSize: 12.5 }}
          value={clause.heading ?? ''} placeholder={clause.kind === 'TERM' ? 'Heading (optional)' : 'Annexure title'}
          onChange={e => onChange({ heading: e.target.value })} />
        <button type="button" style={S.btn} title="Move up" onClick={() => onMove(-1)}>↑</button>
        <button type="button" style={S.btn} title="Move down" onClick={() => onMove(1)}>↓</button>
        <button type="button" style={S.btn} title="Remove" onClick={onRemove}>Remove</button>
      </div>
      <textarea style={{ ...S.ta, minHeight: 72 }} value={clause.body}
        placeholder={clause.kind === 'TERM' ? 'e.g. This offer is contingent upon successful background verification.' : 'Annexure body'}
        onChange={e => onChange({ body: e.target.value })} />
    </div>
  )
}

// ── The screen ─────────────────────────────────────────────────────────────
export default function OfferLetterDesign() {
  const [companies, setCompanies] = useState<Company[]>([])
  // '' = the group-wide default (company_id NULL), which every company falls
  // back to when it has no template of its own.
  const [companyId, setCompanyId] = useState('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [clauses, setClauses] = useState<Clause[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    supabase.from('companies').select('id, company_name').order('company_name')
      .then(({ data }) => setCompanies((data ?? []) as Company[]))
  }, [])

  // Load the template + clauses for whichever scope is selected. Keyed on
  // letter_type, never on name — see the header note.
  const load = useCallback(async () => {
    setLoading(true)
    setMsg('')
    setPreviewUrl(null)
    let q = supabase.from('letter_templates').select('id, content').eq('letter_type', LETTER_TYPE)
    q = companyId ? q.eq('company_id', companyId) : q.is('company_id', null)
    const { data: tpl } = await q.maybeSingle()
    setTemplateId(tpl?.id ?? null)
    setContent(tpl?.content ?? '')

    let cq = supabase.from('offer_letter_clauses').select('*').eq('is_active', true)
    cq = companyId ? cq.eq('company_id', companyId) : cq.is('company_id', null)
    const { data: cl } = await cq.order('kind').order('sort_order').order('created_at')
    setClauses((cl ?? []) as Clause[])
    setLoading(false)
  }, [companyId])

  useEffect(() => { load() }, [load])

  function insertToken(token: string) {
    const ta = editorRef.current
    if (!ta) { setContent(c => c + `{{${token}}}`); return }
    const start = ta.selectionStart, end = ta.selectionEnd
    setContent(content.slice(0, start) + `{{${token}}}` + content.slice(end))
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + token.length + 4 })
  }

  const used = extractTokens(content)
  // A token with no registered merge field prints literally on the finished
  // letter, so surface it at design time rather than on a candidate's offer.
  const unknown = used.filter(t => !MERGE_FIELDS.some(f => f.token === t))

  function patchClause(id: string, patch: Partial<Clause>) {
    setClauses(cs => cs.map(c => (c.id === id ? { ...c, ...patch } : c)))
  }

  function addClause(kind: 'TERM' | 'ANNEXURE') {
    const peers = clauses.filter(c => c.kind === kind)
    setClauses(cs => [...cs, {
      // A client-side id so a brand-new row can be edited and reordered before
      // it is ever saved. saveAll() distinguishes these from persisted rows by
      // the prefix and inserts rather than updates.
      id: `new-${Math.random().toString(36).slice(2, 9)}`,
      company_id: companyId || null,
      kind,
      heading: '',
      body: '',
      sort_order: peers.length,
      is_active: true,
    }])
  }

  function moveClause(id: string, dir: -1 | 1) {
    setClauses(cs => {
      const row = cs.find(c => c.id === id)
      if (!row) return cs
      const sameKind = cs.filter(c => c.kind === row.kind)
      const i = sameKind.findIndex(c => c.id === id)
      const j = i + dir
      if (j < 0 || j >= sameKind.length) return cs
      const swapped = [...sameKind]
      ;[swapped[i], swapped[j]] = [swapped[j], swapped[i]]
      // Renumber the whole kind so sort_order stays dense; gaps accumulate
      // after enough reorders and make the print order depend on created_at.
      const renumbered = swapped.map((c, k) => ({ ...c, sort_order: k }))
      return cs.map(c => (c.kind === row.kind ? renumbered.find(r => r.id === c.id)! : c))
    })
  }

  async function removeClause(id: string) {
    if (!id.startsWith('new-')) {
      if (!confirm('Remove this clause from the offer letter?')) return
      const { error } = await supabase.from('offer_letter_clauses').delete().eq('id', id)
      if (error) { setMsg('Could not remove: ' + error.message); return }
    }
    setClauses(cs => cs.filter(c => c.id !== id))
  }

  async function saveAll() {
    setSaving(true)
    setMsg('')

    // 1. The template. Insert on first save for this scope, update after —
    // migration 140's unique indexes allow exactly one row per
    // (letter_type, company_id), so a blind insert would fail the second time.
    let tid = templateId
    if (tid) {
      const { error } = await supabase.from('letter_templates').update({ content }).eq('id', tid)
      if (error) { setSaving(false); setMsg('Template not saved: ' + error.message); return }
    } else {
      const { data, error } = await supabase.from('letter_templates').insert({
        name: companyId ? `Offer Letter — ${companies.find(c => c.id === companyId)?.company_name ?? 'Company'}` : 'Offer Letter',
        description: 'Offer letter body template',
        content,
        letter_type: LETTER_TYPE,
        company_id: companyId || null,
        is_active: true,
      }).select('id').single()
      if (error) { setSaving(false); setMsg('Template not saved: ' + error.message); return }
      tid = data?.id ?? null
      setTemplateId(tid)
    }

    // 2. The clauses. Empty-bodied rows are dropped rather than saved: a blank
    // clause would print as an empty numbered line on the letter.
    const keep = clauses.filter(c => c.body.trim() || (c.heading ?? '').trim())
    for (const c of keep) {
      const row = {
        company_id: companyId || null,
        kind: c.kind,
        heading: (c.heading ?? '').trim() || null,
        body: c.body,
        sort_order: c.sort_order,
        is_active: true,
      }
      const res = c.id.startsWith('new-')
        ? await supabase.from('offer_letter_clauses').insert(row)
        : await supabase.from('offer_letter_clauses').update(row).eq('id', c.id)
      if (res.error) { setSaving(false); setMsg('A clause failed to save: ' + res.error.message); return }
    }

    setSaving(false)
    setMsg('Saved.')
    load()
  }

  // Preview reuses /api/letters/preview, which takes {letter_name, body_text}
  // and no employee — it exists precisely because at design time there is no
  // specific person yet. The terms and annexures are appended so the admin sees
  // the whole letter, not just the body.
  async function preview() {
    setPreviewing(true)
    const { text } = renderTemplate(content, sampleOfferMergeFields())
    const terms = clauses.filter(c => c.kind === 'TERM' && (c.body.trim() || c.heading))
    const annex = clauses.filter(c => c.kind === 'ANNEXURE' && (c.body.trim() || c.heading))
    const parts = [text]
    if (terms.length) {
      parts.push('TERMS AND CONDITIONS')
      terms.forEach((c, i) => parts.push(`${i + 1}. ${c.heading ? c.heading + ' — ' : ''}${c.body}`))
    }
    annex.forEach(c => parts.push(`ANNEXURE: ${c.heading || ''}\n\n${c.body}`))
    const res = await fetch('/api/letters/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ letter_name: 'Offer Letter', body_text: parts.join('\n\n') }),
    })
    setPreviewing(false)
    if (!res.ok) { setMsg('Preview failed.'); return }
    setPreviewUrl(URL.createObjectURL(await res.blob()))
  }

  const terms = clauses.filter(c => c.kind === 'TERM')
  const annexures = clauses.filter(c => c.kind === 'ANNEXURE')

  return (
    <div style={S.wrap}>
      {/* Scope */}
      <section style={S.card}>
        <div style={S.h}>Offer letter design</div>
        <div style={S.sub}>The body wording, terms and annexures used when an HR Manager issues an offer.</div>
        <label style={S.label}>Applies to</label>
        <select style={{ ...S.input, maxWidth: 380, cursor: 'pointer' }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
          <option value="">All companies (group default)</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <div style={{ ...S.note, marginTop: SP.md }}>
          <b>Letterhead and signature are configured separately</b>, under <b>HR Letters › Letterhead &amp; Signatory</b>,
          where they already cascade Branch → Company → Group. This screen controls the wording only, so one company's
          stationery is never described in two places.
        </div>
      </section>

      {loading ? (
        <section style={S.card}><span style={{ fontSize: 12, color: TK.muted }}>Loading…</span></section>
      ) : (
        <>
          {/* Body template */}
          <section style={S.card}>
            <div style={S.h}>Body template</div>
            <div style={S.sub}>Insert a field to place a value that is filled in per candidate.</div>
            <textarea ref={editorRef} style={{ ...S.ta, minHeight: 300 }} value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={'Dear {{candidate_name}},\n\nWe are pleased to offer you the position of {{offer_designation}} at {{offer_company}}.\n\nYour annual CTC will be ₹ {{offer_ctc_annual}}, and your proposed date of joining is {{offer_doj}}.'} />
            <TokenPicker onInsert={insertToken} />
            {used.length > 0 && (
              <div style={{ fontSize: 11, color: TK.muted, marginTop: SP.xs }}>
                Fields used: {used.map(t => `{{${t}}}`).join(', ')}
              </div>
            )}
            {unknown.length > 0 && (
              <div style={S.warn}>
                <b>Unrecognised field{unknown.length > 1 ? 's' : ''}:</b> {unknown.map(t => `{{${t}}}`).join(', ')} —
                these will print literally on the letter. Use the buttons above, or remove them.
              </div>
            )}
          </section>

          {/* Terms */}
          <section style={S.card}>
            <div style={{ ...S.row, marginBottom: 3 }}>
              <div style={S.h}>Terms and conditions</div>
              <button type="button" style={{ ...S.btn, marginLeft: 'auto' }} onClick={() => addClause('TERM')}>+ Add term</button>
            </div>
            <div style={S.sub}>Printed as a numbered list after the body, in this order.</div>
            {terms.length === 0
              ? <span style={{ fontSize: 12, color: TK.faint }}>No terms yet.</span>
              : terms.map(c => (
                  <ClauseRow key={c.id} clause={c}
                    onChange={patch => patchClause(c.id, patch)}
                    onRemove={() => removeClause(c.id)}
                    onMove={dir => moveClause(c.id, dir)} />
                ))}
          </section>

          {/* Annexures */}
          <section style={S.card}>
            <div style={{ ...S.row, marginBottom: 3 }}>
              <div style={S.h}>Annexures</div>
              <button type="button" style={{ ...S.btn, marginLeft: 'auto' }} onClick={() => addClause('ANNEXURE')}>+ Add annexure</button>
            </div>
            <div style={S.sub}>Titled blocks printed after the terms.</div>
            {annexures.length === 0
              ? <span style={{ fontSize: 12, color: TK.faint }}>No annexures yet.</span>
              : annexures.map(c => (
                  <ClauseRow key={c.id} clause={c}
                    onChange={patch => patchClause(c.id, patch)}
                    onRemove={() => removeClause(c.id)}
                    onMove={dir => moveClause(c.id, dir)} />
                ))}
          </section>

          {/* Actions */}
          <section style={S.card}>
            <div style={{ ...S.row, flexWrap: 'wrap' as const }}>
              <button type="button" style={S.btnP} onClick={saveAll} disabled={saving}>
                {saving ? 'Saving…' : 'Save design'}
              </button>
              <button type="button" style={S.btn} onClick={preview} disabled={previewing || !content.trim()}
                title={!content.trim() ? 'Write a body template first' : 'Render with sample candidate data'}>
                {previewing ? 'Building…' : 'Preview with sample data'}
              </button>
              {msg && <span style={{ fontSize: 12, color: msg === 'Saved.' ? TK.positive : TK.critical, marginLeft: SP.xs }}>{msg}</span>}
            </div>
            {previewUrl && (
              <div style={{ marginTop: SP.md }}>
                <div style={{ fontSize: 11, color: TK.muted, marginBottom: 5 }}>
                  Sample data, plain page — the real letter is issued on the configured letterhead.
                </div>
                <iframe src={previewUrl} title="Offer letter preview"
                  style={{ width: '100%', height: 520, border: `1px solid ${TK.line}`, borderRadius: R.md, background: TK.surface }} />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
