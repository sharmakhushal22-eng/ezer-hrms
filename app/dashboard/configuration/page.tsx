'use client'
// app/dashboard/configuration/page.tsx — Configuration: the words of letters, emails and
// in-app notifications.
//
// One place to edit what the portal sends — offer letters (one per engagement), offer emails,
// interview invites, document-collection mails, onboarding links, HR letters, employee-lifecycle
// mails and work notifications — without a deploy. Each template has a Global default and,
// optionally, a version per company and per branch; the workflows pick the branch's version,
// else the company's, else Global, else the built-in wording (lib/config/store.ts).
//
//   Scope selector   Global default → a company → one of its branches
//   Letters / Emails / Notifications   list on the left, editor on the right
//   Activity         every publish / restore / reset, with who and when
//
// Nothing here talks to Supabase directly: every read and write goes through
// /api/config/* (service role, permission-checked — lib/config/access.ts). The
// validation shown while typing is the same function the server runs on publish
// (lib/config/render.ts validateTemplate), so the two cannot disagree.
import { useState, useEffect, useCallback, useRef } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { validateTemplate } from '@/lib/config/render'
import { validateLetterStructure } from '@/lib/config/offer-letter'
import {
  C, F, W, S, R, Page, PageHeader, Card, Button, Badge, Field, Select, Input, Tabs, Notice, Empty,
  SkeletonRows, inputStyle, TableWrap, Th, Td, Tr, eyebrow,
} from '@/lib/ui'

// ── Types (the shapes /api/config/templates returns) ─────────────────────────

type Tab = 'letters' | 'emails' | 'notifications' | 'activity'
type Source = 'BRANCH' | 'COMPANY' | 'GLOBAL' | 'DEFAULT'
type Level = 'GLOBAL' | 'COMPANY' | 'BRANCH'
/** '' = not chosen. company '' = Global; company + branch = that branch. */
interface ScopeSel { company: string; branch: string }
const levelOf = (s: ScopeSel): Level => s.branch ? 'BRANCH' : s.company ? 'COMPANY' : 'GLOBAL'
const qs = (s: ScopeSel) => `company_id=${s.company}&location_id=${s.branch}`

interface TVar { name: string; label: string; sample: string; block?: boolean }
interface ListItem {
  key: string; channel: 'EMAIL' | 'LETTER' | 'NOTIFICATION'; module: string; label: string; description: string
  usedIn: string; recipient: string; subjectLabel: string; variables: TVar[]; hrLetter: boolean; letterLayout: 'offer' | null
  effective: Source; customisedHere: boolean; version: number; draft: boolean
  publishedAt: string | null; publishedBy: string | null
}
interface Access { isSuper: boolean; level: string; companyId: string | null; canEditGlobal: boolean; canEditScope: boolean }
interface Company { id: string; company_name: string; company_code: string | null }
interface Branch { id: string; location_name: string; location_code: string | null; city: string | null }
interface Detail {
  access: Access
  setupNeeded: string | null
  definition: ListItem & { blockVars: string[]; defaults: { subject: string; body: string } }
  row: null | {
    subject: string | null; body: string | null; version: number; is_active: boolean
    draft_subject: string | null; draft_body: string | null; draft_updated_at: string | null; draft_updated_by_name: string | null
    published_at: string | null; published_by_name: string | null
  }
  inherited: { subject: string; body: string; source: Source; version: number }
  current: { subject: string; body: string; source: Source; version: number } | null
  history: { id: string; version: number; action: string; subject: string | null; body: string | null; change_note: string | null; actor_name: string | null; created_at: string }[]
}
interface Activity {
  id: string; template_key: string; template_label: string; company_name: string
  version: number; action: string; change_note: string | null; actor_name: string | null; created_at: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function api(path: string, init?: RequestInit) {
  const res = await fetch(path, { cache: 'no-store', ...init, headers: { ...(await authHeaders()), ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

function sourceText(src: Source, version: number, level: Level): string {
  if (src === 'BRANCH') return `This branch's version ${version}`
  if (src === 'COMPANY') return level === 'BRANCH' ? `Inherits the company's version ${version}` : `This company's version ${version}`
  if (src === 'GLOBAL') return level !== 'GLOBAL' ? `Inherits Global version ${version}` : `Global version ${version}`
  return level !== 'GLOBAL' ? 'Inherits the built-in text' : 'Built-in text'
}
const CHANNEL_LABEL = { LETTER: 'Letter', EMAIL: 'Email', NOTIFICATION: 'In-app notification' } as const

// ── Sub-components (outside the page, so typing never re-mounts them) ────────

function StatusBadges({ t, level }: { t: ListItem; level: Level }) {
  return (
    <span style={{ display: 'inline-flex', gap: S.xs, flexWrap: 'wrap' }}>
      {t.customisedHere
        ? <Badge t="brand" size="sm">{level === 'BRANCH' ? 'Branch version' : level === 'COMPANY' ? 'Company version' : 'Edited'} v{t.version}</Badge>
        : <Badge size="sm">{t.effective === 'COMPANY' ? 'Inherits company' : t.effective === 'GLOBAL' ? 'Inherits Global' : 'Built-in'}</Badge>}
      {t.draft && <Badge t="warning" size="sm">Draft</Badge>}
    </span>
  )
}

function TemplateList({ items, selected, onSelect, level }: {
  items: ListItem[]; selected: string | null; onSelect: (k: string) => void; level: Level
}) {
  const groups = Array.from(new Set(items.map(i => i.module)))
  return (
    <div>
      {groups.map(g => (
        <div key={g} style={{ marginBottom: S.lg }}>
          <div style={{ ...eyebrow, marginBottom: S.sm }}>{g}</div>
          {items.filter(i => i.module === g).map(t => {
            const on = t.key === selected
            return (
              <button key={t.key} onClick={() => onSelect(t.key)} className="ez-press"
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: S.xs,
                  padding: `${S.sm + 2}px ${S.md}px`, borderRadius: R.md, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brandTint : C.surface,
                }}>
                <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, marginBottom: 4 }}>{t.label}</div>
                <StatusBadges t={t} level={level} />
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function NewLetterForm({ onCreated, onCancel }: { onCreated: (key: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function create() {
    setBusy(true); setErr('')
    const r = await api('/api/config/templates', { method: 'POST', body: JSON.stringify({ action: 'create_letter', name, description }) })
    setBusy(false)
    if (!r.ok) { setErr(r.data.error || `HTTP ${r.status}`); return }
    onCreated(r.data.key)
  }
  return (
    <Card pad={S.md} elevation="flat" style={{ marginBottom: S.lg }}>
      <div style={{ display: 'grid', gap: S.sm }}>
        <Field label="Letter name" required><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Experience Letter" /></Field>
        <Field label="Description"><Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this letter is for" /></Field>
        {err && <div style={{ fontSize: F.tiny, color: C.critical }}>{err}</div>}
        <div style={{ display: 'flex', gap: S.sm }}>
          <Button variant="primary" size="sm" disabled={busy || !name.trim()} onClick={create}>{busy ? 'Adding…' : 'Add letter'}</Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Card>
  )
}

function VariablePicker({ vars, onInsert, disabled }: { vars: TVar[]; onInsert: (v: TVar) => void; disabled: boolean }) {
  return (
    <div>
      <div style={{ ...eyebrow, marginBottom: S.sm }}>Insert a value</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {vars.map(v => (
          <button key={v.name} disabled={disabled} onClick={() => onInsert(v)} className="ez-press"
            title={v.block ? 'Inserted as its own paragraph' : `{{${v.name}}} — e.g. ${v.sample}`}
            style={{
              padding: '4px 10px', fontSize: F.tiny, borderRadius: R.sm, fontFamily: 'inherit',
              border: `1px solid ${C.brandEdge}`, background: C.surface, color: C.brandDeep,
              cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1, whiteSpace: 'nowrap',
            }}>
            + {v.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: F.tiny, color: C.muted, marginTop: S.sm, lineHeight: 1.6 }}>
        Optional text: <code>{'{{#if meet_link}}'}</code>…<code>{'{{/if}}'}</code> is kept only when the value is filled.
        Bold: <code>**text**</code>. A blank line starts a new paragraph.
      </div>
    </div>
  )
}

function HistoryList({ items, canEdit, onRestore }: {
  items: Detail['history']; canEdit: boolean; onRestore: (id: string, version: number) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (!items.length) return <div style={{ fontSize: F.small, color: C.muted }}>No changes published at this level yet.</div>
  return (
    <div style={{ display: 'grid', gap: S.sm }}>
      {items.map(h => (
        <div key={h.id} style={{ border: `1px solid ${C.line}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px`, background: C.surface }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
            <Badge t={h.action === 'RESET' ? 'warning' : h.action === 'RESTORED' ? 'info' : 'positive'} size="sm">
              {h.action === 'RESET' ? 'Reset' : h.action === 'RESTORED' ? 'Restored' : 'Published'}{h.action !== 'RESET' ? ` v${h.version}` : ''}
            </Badge>
            <span style={{ fontSize: F.tiny, color: C.muted }}>{when(h.created_at)} · {h.actor_name || '—'}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: S.xs }}>
              {h.action !== 'RESET' && <Button variant="ghost" size="sm" onClick={() => setOpen(open === h.id ? null : h.id)}>{open === h.id ? 'Hide' : 'View'}</Button>}
              {h.action !== 'RESET' && canEdit && <Button size="sm" onClick={() => onRestore(h.id, h.version)}>Restore</Button>}
            </span>
          </div>
          {h.change_note && <div style={{ fontSize: F.tiny, color: C.inkSoft, marginTop: 4 }}>{h.change_note}</div>}
          {open === h.id && (
            <div style={{ marginTop: S.sm, background: C.sunken, borderRadius: R.sm, padding: S.md, fontSize: F.tiny, color: C.inkSoft, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
              <b>{h.subject}</b>{'\n\n'}{h.body}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Preview({ email, pdfUrl, onClose }: {
  email: { subject: string; text: string; unknown: string[] } | null; pdfUrl: string | null; onClose: () => void
}) {
  if (!email && !pdfUrl) return null
  return (
    <Card pad={S.md} style={{ marginTop: S.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, marginBottom: S.sm }}>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>Preview with sample data</div>
        {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: F.tiny, color: C.brandDeep }}>Open in a new tab</a>}
        <span style={{ marginLeft: 'auto' }}><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></span>
      </div>
      {email && (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R.md, padding: S.lg, background: C.surface }}>
          <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink, marginBottom: S.md }}>{email.subject}</div>
          <div style={{ fontSize: F.small, color: C.inkSoft, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{email.text}</div>
          {email.unknown.length > 0 && (
            <div style={{ fontSize: F.tiny, color: C.critical, marginTop: S.md }}>Not filled: {email.unknown.map(u => `{{${u}}}`).join(', ')}</div>
          )}
        </div>
      )}
      {pdfUrl && <iframe src={pdfUrl} title="Letter preview" style={{ width: '100%', height: 640, border: `1px solid ${C.line}`, borderRadius: R.md, background: C.sunken }} />}
    </Card>
  )
}

function TemplateEditor({ tplKey, scope, scopeName, onChanged }: {
  tplKey: string; scope: ScopeSel; scopeName: string; onChanged: () => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ t: 'positive' | 'critical'; text: string } | null>(null)
  const [serverProblems, setServerProblems] = useState<string[]>([])
  const [confirming, setConfirming] = useState<null | 'publish' | 'reset'>(null)
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<{ email: { subject: string; text: string; unknown: string[] } | null; pdfUrl: string | null }>({ email: null, pdfUrl: null })
  const lastFocus = useRef<'subject' | 'body'>('body')
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setLoadErr('')
    const r = await api(`/api/config/templates?key=${encodeURIComponent(tplKey)}&${qs(scope)}`)
    if (!r.ok) { setLoadErr(r.data.error || `HTTP ${r.status}`); return }
    const det = r.data as Detail
    setD(det)
    // Start from: an open draft → this level's published text → what it inherits.
    const row = det.row
    const hasDraft = !!row && (row.draft_body != null || row.draft_subject != null)
    const ownLive = !!row && row.is_active && row.version > 0
    setSubject(hasDraft ? (row!.draft_subject ?? '') : ownLive ? (row!.subject ?? '') : det.inherited.subject)
    setBody(hasDraft ? (row!.draft_body ?? '') : ownLive ? (row!.body ?? '') : det.inherited.body)
    setDirty(false); setServerProblems([]); setConfirming(null); setNote('')
  }, [tplKey, scope.company, scope.branch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])
  useEffect(() => () => { if (preview.pdfUrl) URL.revokeObjectURL(preview.pdfUrl) }, [preview.pdfUrl])

  if (loadErr) return <Notice t="critical" title="Could not open this template">{loadErr}</Notice>
  if (!d) return <Card><SkeletonRows rows={8} /></Card>

  const def = d.definition
  const canEdit = d.access.canEditScope && !d.setupNeeded
  const level = levelOf(scope)
  const allowed = def.variables.map(v => v.name)
  const problems = [
    ...validateTemplate(subject, allowed.filter(n => !def.blockVars.includes(n)), { required: true, label: def.subjectLabel }),
    ...validateTemplate(body, allowed, { required: true, blockVars: def.blockVars, label: 'Body' }),
    ...(def.letterLayout === 'offer' ? validateLetterStructure(body) : []),
  ]
  const inheritsFrom = level === 'BRANCH' ? 'the company (or Global) text' : level === 'COMPANY' ? 'the Global text' : 'the built-in text'
  const thing = def.channel === 'LETTER' ? 'letter' : def.channel === 'NOTIFICATION' ? 'notification' : 'email'
  const row = d.row
  const hasDraft = !!row && (row.draft_body != null || row.draft_subject != null)
  const ownLive = !!row && row.is_active && row.version > 0
  const canReset = ownLive && !(def.hrLetter && level === 'GLOBAL')

  function insert(v: TVar) {
    const token = v.block ? `\n\n{{${v.name}}}\n\n` : `{{${v.name}}}`
    const into = v.block ? 'body' : lastFocus.current
    const el = into === 'subject' ? subjectRef.current : bodyRef.current
    const cur = into === 'subject' ? subject : body
    const start = el?.selectionStart ?? cur.length, end = el?.selectionEnd ?? cur.length
    const next = cur.slice(0, start) + token + cur.slice(end)
    if (into === 'subject') setSubject(next); else setBody(next)
    setDirty(true)
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = start + token.length } })
  }

  async function act(action: string, extra: Record<string, unknown> = {}, okText = 'Saved.') {
    setBusy(action); setMsg(null); setServerProblems([])
    const r = await api('/api/config/templates', {
      method: 'POST',
      body: JSON.stringify({ action, key: tplKey, company_id: scope.company || null, location_id: scope.branch || null, ...extra }),
    })
    setBusy('')
    if (!r.ok) {
      setServerProblems(r.data.problems || [])
      setMsg({ t: 'critical', text: r.data.error || `HTTP ${r.status}` })
      return false
    }
    setMsg({ t: 'positive', text: okText })
    await load(); onChanged()
    return true
  }

  async function runPreview() {
    setBusy('preview'); setMsg(null)
    const res = await fetch('/api/config/preview', {
      method: 'POST', cache: 'no-store', headers: await authHeaders(),
      body: JSON.stringify({ key: tplKey, company_id: scope.company || null, location_id: scope.branch || null, subject, body }),
    })
    setBusy('')
    if (!res.ok) { const e = await res.json().catch(() => ({})); setMsg({ t: 'critical', text: e.error || `Preview failed (HTTP ${res.status})` }); return }
    if ((res.headers.get('content-type') || '').includes('application/pdf')) {
      if (preview.pdfUrl) URL.revokeObjectURL(preview.pdfUrl)
      setPreview({ email: null, pdfUrl: URL.createObjectURL(await res.blob()) })
    } else {
      const j = await res.json()
      setPreview({ email: { subject: j.subject, text: j.text, unknown: j.unknown || [] }, pdfUrl: null })
    }
  }

  const area: React.CSSProperties = { ...inputStyle(), height: 'auto', minHeight: 380, padding: '12px 14px', lineHeight: 1.6, resize: 'vertical' }

  return (
    <div>
      <Card pad={S.lg}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.md, flexWrap: 'wrap', marginBottom: S.md }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: F.lead, fontWeight: W.bold, color: C.ink }}>{def.label}</div>
            <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 3, lineHeight: 1.6 }}>{def.description}</div>
          </div>
          <Badge t={def.channel === 'LETTER' ? 'info' : def.channel === 'NOTIFICATION' ? 'warning' : 'neutral'}>{CHANNEL_LABEL[def.channel]}</Badge>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: S.md, marginBottom: S.lg }}>
          <div><div style={eyebrow}>Used in</div><div style={{ fontSize: F.tiny, color: C.inkSoft, marginTop: 3 }}>{def.usedIn}</div></div>
          <div><div style={eyebrow}>Goes to</div><div style={{ fontSize: F.tiny, color: C.inkSoft, marginTop: 3 }}>{def.recipient}</div></div>
          <div><div style={eyebrow}>{scopeName} uses now</div><div style={{ fontSize: F.tiny, color: C.inkSoft, marginTop: 3 }}>
            {d.current ? sourceText(d.current.source, d.current.version, level) : '—'}
          </div></div>
        </div>

        {d.setupNeeded && <div style={{ marginBottom: S.md }}><Notice t="warning" title="Setup needed">{d.setupNeeded}</Notice></div>}
        {!d.access.canEditScope && !d.setupNeeded && (
          <div style={{ marginBottom: S.md }}><Notice t="info" title="Read only">
            {level !== 'GLOBAL' ? 'You can view this template but not change it.' : 'Only a Super Admin changes the Global default. Pick your company (or one of its branches) above to edit its own version.'}
          </Notice></div>
        )}
        {hasDraft && (
          <div style={{ fontSize: F.tiny, color: C.warning, marginBottom: S.md }}>
            Unpublished draft saved {when(row!.draft_updated_at)}{row!.draft_updated_by_name ? ` by ${row!.draft_updated_by_name}` : ''} — workflows still use the published text until you publish.
          </div>
        )}

        <div style={{ display: 'grid', gap: S.md }}>
          <Field label={def.subjectLabel} required>
            <input ref={subjectRef} value={subject} disabled={!canEdit} style={inputStyle()}
              onFocus={() => { lastFocus.current = 'subject' }}
              onChange={e => { setSubject(e.target.value); setDirty(true) }} />
          </Field>
          <Field label="Text" required hint={def.letterLayout === 'offer'
            ? 'Opening paragraph, then one numbered clause per paragraph starting with [Heading], then the closing. Annexure A notes (one per line), Annexure B terms ([Heading] paragraphs) and the acceptance go under their "--- … ---" lines. Letterhead, reference, figures, salary break-up and signatory are added by the system.'
            : def.channel === 'LETTER' ? 'The letterhead, date and signature image are added by the system.'
            : def.channel === 'NOTIFICATION' ? 'Shown in the bell and in Tasks & Approvals — keep it short.' : undefined}>
            <textarea ref={bodyRef} value={body} disabled={!canEdit} style={area}
              onFocus={() => { lastFocus.current = 'body' }}
              onChange={e => { setBody(e.target.value); setDirty(true) }} />
          </Field>
          <VariablePicker vars={def.variables} onInsert={insert} disabled={!canEdit} />
        </div>

        {(problems.length > 0 || serverProblems.length > 0) && (
          <div style={{ marginTop: S.md }}>
            <Notice t="critical" title="Fix before publishing">
              <ul style={{ margin: 0, paddingLeft: 18 }}>{[...new Set([...problems, ...serverProblems])].map(p => <li key={p}>{p}</li>)}</ul>
            </Notice>
          </div>
        )}
        {msg && <div style={{ fontSize: F.tiny, marginTop: S.md, color: msg.t === 'positive' ? C.positive : C.critical }}>{msg.text}</div>}

        {confirming && (
          <Card pad={S.md} elevation="flat" style={{ marginTop: S.md, background: C.sunken }}>
            <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, marginBottom: 4 }}>
              {confirming === 'publish' ? `Publish for ${scopeName}?` : (level !== 'GLOBAL' ? `Stop using ${scopeName}'s own version?` : 'Go back to the built-in text?')}
            </div>
            <div style={{ fontSize: F.tiny, color: C.muted, marginBottom: S.sm, lineHeight: 1.6 }}>
              {confirming === 'publish'
                ? (level === 'BRANCH'
                    ? `From the next ${thing}, only ${scopeName} uses this text. The rest of the company keeps its own text. Nothing already sent changes.`
                    : level === 'COMPANY'
                    ? `From the next ${thing}, ${scopeName} uses this text — except branches that have their own version. Other companies are not affected. Nothing already sent changes.`
                    : 'From the next send, every company and branch WITHOUT its own version uses this text. Those with their own version keep it. Nothing already sent changes.')
                : (level !== 'GLOBAL' ? `${scopeName} will use ${inheritsFrom} again. Its history is kept.` : 'Companies and branches without their own version will use the built-in text again. History is kept.')}
            </div>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="What changed and why (shown in history)" />
            <div style={{ display: 'flex', gap: S.sm, marginTop: S.sm }}>
              <Button variant={confirming === 'publish' ? 'primary' : 'danger'} size="sm" disabled={!!busy}
                onClick={async () => {
                  const ok = confirming === 'publish'
                    ? await act('publish', { subject, body, change_note: note }, 'Published — in use from the next send.')
                    : await act('reset', { change_note: note }, 'Reset — the inherited text is in use again.')
                  if (ok) setConfirming(null)
                }}>
                {busy === 'publish' || busy === 'reset' ? 'Working…' : confirming === 'publish' ? 'Publish' : 'Reset'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>Cancel</Button>
            </div>
          </Card>
        )}

        <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap', marginTop: S.lg }}>
          <Button variant="primary" disabled={!canEdit || !!busy || problems.length > 0} onClick={() => { setConfirming('publish'); setNote('') }}>Publish…</Button>
          <Button disabled={!canEdit || !!busy || !dirty} onClick={() => act('save_draft', { subject, body }, 'Draft saved — not in use until published.')}>
            {busy === 'save_draft' ? 'Saving…' : 'Save draft'}
          </Button>
          <Button disabled={!!busy} onClick={runPreview}>{busy === 'preview' ? 'Rendering…' : 'Preview'}</Button>
          {hasDraft && canEdit && <Button variant="ghost" disabled={!!busy} onClick={() => act('discard_draft', {}, 'Draft discarded.')}>Discard draft</Button>}
          {dirty && <Button variant="ghost" disabled={!!busy} onClick={load}>Undo changes</Button>}
          {canReset && canEdit && (
            <Button variant="danger" disabled={!!busy} onClick={() => { setConfirming('reset'); setNote('') }} style={{ marginLeft: 'auto' }}>
              {level === 'BRANCH' ? 'Use company text' : level === 'COMPANY' ? 'Use Global text' : 'Use built-in text'}
            </Button>
          )}
        </div>
      </Card>

      <Preview email={preview.email} pdfUrl={preview.pdfUrl} onClose={() => setPreview({ email: null, pdfUrl: null })} />

      <Card pad={S.lg} style={{ marginTop: S.lg }}>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink, marginBottom: S.md }}>History — {scopeName}</div>
        <HistoryList items={d.history} canEdit={canEdit}
          onRestore={(id, v) => { if (window.confirm(`Publish version ${v} again for ${scopeName}?`)) act('restore', { version_id: id }, `Version ${v} restored.`) }} />
      </Card>
    </div>
  )
}

function ActivityTable({ rows }: { rows: Activity[] }) {
  if (!rows.length) return <Empty title="No changes yet" hint="Publishing, restoring or resetting a template is recorded here." />
  return (
    <TableWrap minWidth={760}>
      <thead>
        <tr><Th>When</Th><Th>Template</Th><Th>For</Th><Th>Change</Th><Th>By</Th><Th>Note</Th></tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <Tr key={r.id}>
            <Td>{when(r.created_at)}</Td>
            <Td strong>{r.template_label}</Td>
            <Td>{r.company_name}</Td>
            <Td><Badge size="sm" t={r.action === 'RESET' ? 'warning' : r.action === 'RESTORED' ? 'info' : 'positive'}>
              {r.action === 'RESET' ? 'Reset' : r.action === 'RESTORED' ? `Restored v${r.version}` : `Published v${r.version}`}
            </Badge></Td>
            <Td>{r.actor_name || '—'}</Td>
            <Td>{r.change_note || ''}</Td>
          </Tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ConfigurationPage() {
  const [tab, setTab] = useState<Tab>('letters')
  const [scope, setScope] = useState<ScopeSel>({ company: '', branch: '' })   // '' company = Global default
  const [items, setItems] = useState<ListItem[] | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [access, setAccess] = useState<Access | null>(null)
  const [setupNeeded, setSetupNeeded] = useState<string | null>(null)
  const [branchReady, setBranchReady] = useState(true)
  const [denied, setDenied] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [activity, setActivity] = useState<Activity[] | null>(null)
  const scopeSet = useRef(false)

  // ?tab=letters|emails|notifications|activity — HR Letters links straight to the letters list.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'letters' || t === 'emails' || t === 'notifications' || t === 'activity') setTab(t)
  }, [])

  const loadList = useCallback(async () => {
    const r = await api(`/api/config/templates?${qs(scope)}`)
    if (!r.ok) { setDenied(r.data.error || `HTTP ${r.status}`); setItems([]); return }
    setDenied('')
    setItems(r.data.templates); setCompanies(r.data.companies || []); setBranches(r.data.branches || [])
    setAccess(r.data.access); setBranchReady(r.data.branchReady !== false)
    // The branch-migration hint only matters when a branch is (or could be) chosen.
    setSetupNeeded(r.data.setupNeeded && (r.data.branchReady !== false || scope.company) ? r.data.setupNeeded : null)
    // Someone who edits only their own company starts on it, not on read-only Global.
    if (!scopeSet.current) {
      scopeSet.current = true
      const a = r.data.access as Access
      if (!a.isSuper && a.companyId && (r.data.companies || []).some((c: Company) => c.id === a.companyId)) setScope({ company: a.companyId, branch: '' })
    }
  }, [scope])

  const loadActivity = useCallback(async () => {
    const r = await api(`/api/config/templates?activity=1&${qs(scope)}`)
    setActivity(r.ok ? r.data.activity : [])
  }, [scope])

  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { if (tab === 'activity') loadActivity() }, [tab, loadActivity])

  const channel = tab === 'letters' ? 'LETTER' : tab === 'notifications' ? 'NOTIFICATION' : 'EMAIL'
  const shown = (items || []).filter(i => i.channel === channel)
  // The open template: the one picked, or the first in the list when the pick is not
  // in this tab (switching tabs, or a scope change).
  const current = selected && shown.some(i => i.key === selected) ? selected : (shown[0]?.key ?? null)

  const level = levelOf(scope)
  const companyName = companies.find(c => c.id === scope.company)?.company_name || 'This company'
  const branchName = branches.find(b => b.id === scope.branch)?.location_name || 'This branch'
  const scopeName = level === 'BRANCH' ? `${companyName} › ${branchName}` : level === 'COMPANY' ? companyName : 'Global default'
  const count = (ch: ListItem['channel']) => (items || []).filter(i => i.channel === ch).length

  if (denied) {
    return <Page><PageHeader title="Configuration" /><div style={{ marginTop: S.xl }}><Empty title="Configuration is not available to you" hint={denied} /></div></Page>
  }

  return (
    <Page>
      <PageHeader
        title="Configuration"
        context="The words of the letters, emails and notifications the portal sends. Changes apply from the next send — no deploy."
        actions={
          <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 240 }}>
              <Select value={scope.company} onChange={e => { setScope({ company: e.target.value, branch: '' }); setSelected(null) }} aria-label="Company">
                {access?.isSuper && <option value="">Global default (all companies)</option>}
                {!access?.isSuper && <option value="">Global default (view only)</option>}
                {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </Select>
            </div>
            {/* A branch can carry its own version, below the company's. */}
            {scope.company && (
              <div style={{ minWidth: 220 }}>
                <Select value={scope.branch} disabled={!branchReady} onChange={e => { setScope({ company: scope.company, branch: e.target.value }); setSelected(null) }} aria-label="Branch"
                  title={branchReady ? 'Pick a branch to give it its own version' : 'Apply migration 137 to enable branch-level templates'}>
                  <option value="">Whole company (all branches)</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.location_name}{b.city ? ` · ${b.city}` : ''}</option>)}
                </Select>
              </div>
            )}
          </div>
        }
      />

      <div style={{ marginTop: S.xl }}>
        {setupNeeded && <div style={{ marginBottom: S.lg }}><Notice t="warning" title="Setup needed">{setupNeeded}</Notice></div>}
        {level !== 'GLOBAL' && (
          <div style={{ fontSize: F.tiny, color: C.muted, marginBottom: S.md }}>
            {level === 'BRANCH'
              ? `Editing ${scopeName}. A template this branch has not customised uses the company's version, else Global, else the built-in text.`
              : `Editing ${scopeName}. Pick a branch to give one branch its own version; branches without one use this company's text.`}
          </div>
        )}

        <Tabs<Tab>
          tabs={[
            { key: 'letters', label: 'Letters', count: count('LETTER') },
            { key: 'emails', label: 'Emails', count: count('EMAIL') },
            { key: 'notifications', label: 'Notifications', count: count('NOTIFICATION') },
            { key: 'activity', label: 'Activity' },
          ]}
          value={tab}
          onChange={t => setTab(t)}
        />

        {tab === 'activity' ? (
          activity === null ? <Card><SkeletonRows rows={6} /></Card> : <ActivityTable rows={activity} />
        ) : items === null ? (
          <Card><SkeletonRows rows={8} /></Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', gap: S.xl, alignItems: 'start' }}>
            <div>
              {tab === 'letters' && access?.canEditGlobal && level === 'GLOBAL' && (
                adding
                  ? <NewLetterForm onCancel={() => setAdding(false)} onCreated={async key => { setAdding(false); await loadList(); setSelected(key) }} />
                  : <div style={{ marginBottom: S.lg }}><Button size="sm" onClick={() => setAdding(true)}>+ New letter type</Button></div>
              )}
              {shown.length
                ? <TemplateList items={shown} selected={current} onSelect={setSelected} level={level} />
                : <div style={{ fontSize: F.small, color: C.muted }}>Nothing here yet.</div>}
            </div>
            <div style={{ minWidth: 0 }}>
              {current
                ? <TemplateEditor key={`${current}|${scope.company}|${scope.branch}`} tplKey={current} scope={scope} scopeName={scopeName} onChanged={loadList} />
                : <Empty title="Pick a template" hint="Choose a template on the left to view and edit its text." />}
            </div>
          </div>
        )}
      </div>
    </Page>
  )
}
