'use client'
// components/analytics/AccessManager.tsx — People Analytics → Manage access.
//
// Give a named person the organisation view, on exactly the slice they should see:
// which companies, locations, departments and employment types; which tabs; whether
// names, pay and downloads are on; until when. The server (app/api/analytics/access)
// re-checks every field — nobody can give more than they have, or edit their own row.
//
// Also lists who reaches analytics through a ROLE, so the screen answers the whole
// question "who can see this?", not only the half managed here.

import * as React from 'react'
import { createPortal } from 'react-dom'
import { C, F, W, R, S, E, Z, Button, Input, Notice, Skeleton, eyebrow } from '@/lib/ui'
import { authHeaders } from '@/lib/auth-headers'
import { ORG_TABS, TAB_LABEL, PRESETS, type OrgTab } from '@/lib/analytics/access'
import { dLabelLong } from '@/lib/analytics/format'
import { MiniTable, Pill } from './charts'

interface Opt { name: string; companies: string[] }
interface Grant {
  employee_id: string; name: string; code: string | null; designation: string | null; company: string | null
  company_ids: string[] | null; locations: string[] | null; departments: string[] | null; employment_types: string[] | null
  tabs: OrgTab[]; see_names: boolean; see_pay: boolean; can_export: boolean; valid_until: string | null
  note: string | null; granted_by_name: string | null; updated_at: string | null; live: boolean; scopeLabel: string
}
interface Holder { id: string; name: string; code: string | null; designation: string | null; roles: string[] }
interface Manage {
  table: boolean; grants: Grant[]; holders: Holder[]; me: string | null
  options: { companies: { id: string; label: string }[]; allCompanies: boolean; locations: Opt[]; departments: Opt[]; types: string[] }
  can: { pay: boolean; names: boolean }
}
export interface Person { id: string; name: string; code: string | null; designation: string | null; company: string | null }

/** null = every value (including ones added later); [] = none picked yet. */
type Pick = string[] | null

interface Form {
  people: Person[]
  companies: Pick; locations: Pick; departments: Pick; types: Pick
  tabs: OrgTab[]; names: boolean; pay: boolean; exportOk: boolean
  until: string; reason: string
  editing: boolean
}

const emptyForm = (m: Manage): Form => ({
  people: [], companies: m.options.allCompanies ? null : m.options.companies.length === 1 ? [m.options.companies[0].id] : [],
  locations: null, departments: null, types: null,
  tabs: ['workforce', 'attrition', 'attendance', 'performance', 'hiring'], names: m.can.names, pay: false, exportOk: true,
  until: '', reason: '', editing: false,
})

export async function call(path: string, init?: RequestInit) {
  const headers = new Headers((await authHeaders()) as Record<string, string>)
  headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { ...init, headers, cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body
}

export default function AccessManager({ onClose }: { onClose: () => void }) {
  const [m, setM] = React.useState<Manage | null>(null)
  const [err, setErr] = React.useState('')
  const [form, setForm] = React.useState<Form | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [msg, setMsg] = React.useState('')

  const load = React.useCallback(() => {
    call('/api/analytics/access?view=manage').then(b => setM(b as Manage), e => setErr(e?.message || 'Could not load.'))
  }, [])
  React.useEffect(() => { load() }, [load])
  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !form) onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [form, onClose])

  const save = async () => {
    if (!form || !m) return
    const problem = check(form)
    if (problem) { setErr(problem); return }
    setSaving(true); setErr(''); setMsg('')
    try {
      await call('/api/analytics/access', {
        method: 'POST', body: JSON.stringify({
          employee_ids: form.people.map(p => p.id),
          companies: form.companies, locations: form.locations, departments: form.departments, types: form.types,
          tabs: form.tabs.filter(t => t !== 'cost' || form.pay).concat(form.pay && !form.tabs.includes('cost') ? ['cost'] : []),
          see_names: form.names, see_pay: form.pay, can_export: form.exportOk,
          valid_until: form.until || null, reason: form.reason,
        }),
      })
      setMsg(`Saved for ${form.people.map(p => p.name).join(', ')}. It applies the next time they open analytics.`)
      setForm(null); load()
    } catch (e: any) { setErr(e?.message || 'Could not save.') } finally { setSaving(false) }
  }

  const remove = async (g: Grant) => {
    const reason = window.prompt(`Remove ${g.name}'s analytics access? Their role, if they have one, applies again.\n\nWhy? (for the access log)`)
    if (reason == null) return
    setErr(''); setMsg('')
    try {
      await call(`/api/analytics/access?employee_id=${g.employee_id}&reason=${encodeURIComponent(reason)}`, { method: 'DELETE' })
      setMsg(`Removed ${g.name}'s analytics access.`); load()
    } catch (e: any) { setErr(e?.message || 'Could not remove.') }
  }

  const edit = (g: Grant) => {
    setErr(''); setMsg('')
    setForm({
      people: [{ id: g.employee_id, name: g.name, code: g.code, designation: g.designation, company: g.company }],
      companies: g.company_ids, locations: g.locations, departments: g.departments, types: g.employment_types,
      tabs: g.tabs.filter(t => t !== 'cost'), names: g.see_names, pay: g.see_pay, exportOk: g.can_export,
      until: g.valid_until || '', reason: '', editing: true,
    })
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Manage analytics access" style={{
      position: 'fixed', inset: 0, zIndex: Z.modal, background: C.canvas, color: C.ink, fontFamily: F.family,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, padding: '12px 20px', borderBottom: `1px solid ${C.line}`, background: C.surface, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: F.lead, fontWeight: W.semi }}>Who can see People Analytics</div>
          <div style={{ fontSize: F.tiny, color: C.muted }}>Give a person analytics on just their company, site or department — with or without names and pay.</div>
        </div>
        {m?.table && !form && <Button size="sm" variant="primary" onClick={() => { setErr(''); setMsg(''); setForm(emptyForm(m)) }}>Give access</Button>}
        <Button size="sm" onClick={onClose}>Close</Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: `${S.lg}px ${S.lg}px ${S.huge}px` }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: S.lg }}>
          {err && !form && <Notice t="critical" title="Not saved">{err}</Notice>}
          {msg && <Notice t="info" title="Done">{msg}</Notice>}
          {!m && !err && <div style={{ display: 'grid', gap: 10 }}><Skeleton h={80} /><Skeleton h={200} /></div>}
          {m && !m.table && (
            <Notice t="warning" title="One step before you can give access">
              Run <strong>232_analytics_access.sql</strong> in the Supabase SQL editor. Until then, analytics opens only through roles (listed below), as before.
            </Notice>
          )}
          {m && form && <GrantForm m={m} form={form} setForm={setForm} saving={saving} err={err} onSave={save} onCancel={() => { setForm(null); setErr('') }} />}
          {m && m.table && <GrantList m={m} onEdit={edit} onRemove={remove} />}
          {m && <HolderList holders={m.holders} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function check(f: Form): string {
  if (!f.people.length) return 'Pick at least one person.'
  if (f.companies && !f.companies.length) return 'Pick at least one company.'
  if (f.locations && !f.locations.length) return 'Pick at least one location, or choose All locations.'
  if (f.departments && !f.departments.length) return 'Pick at least one department, or choose All departments.'
  if (f.types && !f.types.length) return 'Pick at least one employment type, or choose All types.'
  if (!f.tabs.length && !f.pay) return 'Pick at least one tab.'
  if (!f.reason.trim()) return 'Say why, for the access log.'
  return ''
}

// ── The form ────────────────────────────────────────────────────────────────

function GrantForm({ m, form, setForm, saving, err, onSave, onCancel }: {
  m: Manage; form: Form; setForm: (f: Form) => void; saving: boolean; err: string; onSave: () => void; onCancel: () => void
}) {
  const set = (p: Partial<Form>) => setForm({ ...form, ...p })
  const o = m.options
  // Locations and departments follow the companies picked.
  const inCos = (x: Opt) => !form.companies || x.companies.some(c => form.companies!.includes(c))
  const locs = o.locations.filter(inCos).map(x => x.name)
  const depts = o.departments.filter(inCos).map(x => x.name)
  const coName = (id: string) => o.companies.find(c => c.id === id)?.label || 'Company'
  const summary = [
    form.companies ? form.companies.map(coName).join(', ') || '—' : 'every company',
    form.locations ? form.locations.join(', ') || '—' : 'every location',
    form.departments ? form.departments.join(', ') || '—' : 'every department',
    form.types ? form.types.join(', ') : '',
  ].filter(Boolean).join(' · ')
  const tabWords = [...form.tabs.map(t => TAB_LABEL[t]), ...(form.pay ? [TAB_LABEL.cost] : [])].join(', ')

  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.raised, padding: S.lg }}>
      <h3 style={{ margin: `0 0 ${S.md}px`, fontSize: F.lead, fontWeight: W.semi }}>{form.editing ? `Change ${form.people[0]?.name}'s access` : 'Give analytics access'}</h3>

      <Row label="Who">
        {form.editing
          ? <PersonChip p={form.people[0]} />
          : <PeoplePicker value={form.people} onChange={people => set({ people })} me={m.me} />}
      </Row>

      <Row label="Start from" hint="Fills the tabs and switches below; change anything after.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.filter(p => !p.pay || m.can.pay).map(p => (
            <button key={p.key} type="button" title={p.hint} onClick={() => set({ tabs: p.tabs.filter(t => t !== 'cost'), names: p.names && m.can.names, pay: p.pay && m.can.pay })}
              className="ez-press" style={chip(false)}>{p.label}</button>
          ))}
        </div>
      </Row>

      <Row label="Companies">
        <CheckList all={o.allCompanies ? 'All companies' : null} options={o.companies.map(c => ({ value: c.id, label: c.label }))}
          value={form.companies} onChange={companies => set({ companies, locations: null, departments: null })} />
      </Row>
      <Row label="Locations" hint="A site manager: pick their site.">
        <CheckList all="All locations" options={locs.map(v => ({ value: v, label: v }))} value={form.locations} onChange={locations => set({ locations })} />
      </Row>
      <Row label="Departments">
        <CheckList all="All departments" options={depts.map(v => ({ value: v, label: v }))} value={form.departments} onChange={departments => set({ departments })} />
      </Row>
      {o.types.length > 1 && (
        <Row label="Employment types">
          <CheckList all="All types" options={o.types.map(v => ({ value: v, label: v }))} value={form.types} onChange={types => set({ types })} />
        </Row>
      )}

      <Row label="Tabs" hint="Pulse is always shown, with only these tabs' figures.">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ORG_TABS.filter(t => t !== 'cost').map(t => {
            const on = form.tabs.includes(t)
            return <button key={t} type="button" aria-pressed={on} onClick={() => set({ tabs: on ? form.tabs.filter(x => x !== t) : [...form.tabs, t] })} className="ez-press" style={chip(on)}>{on ? '✓ ' : ''}{TAB_LABEL[t]}</button>
          })}
        </div>
      </Row>

      <Row label="Also">
        <div style={{ display: 'grid', gap: 8 }}>
          <Toggle on={form.names} set={names => set({ names })} disabled={!m.can.names} label="Show employee names"
            hint="Flight-risk watchlist, late marks, probation and other named lists. Off = counts only." />
          <Toggle on={form.pay} set={pay => set({ pay })} disabled={!m.can.pay} label="Show pay & cost"
            hint={m.can.pay ? 'Payroll cost, CTC by grade and department, pay equity.' : 'You need pay access yourself to give it.'} />
          <Toggle on={form.exportOk} set={exportOk => set({ exportOk })} label="Allow downloads" hint="The PDF and Excel buttons." />
        </div>
      </Row>

      <Row label="Ends on" hint="Optional — for a stand-in or an audit.">
        <Input type="date" value={form.until} onChange={e => set({ until: e.target.value })} style={{ maxWidth: 200 }} />
      </Row>
      <Row label="Why">
        <Input value={form.reason} onChange={e => set({ reason: e.target.value })} placeholder="e.g. New site head, Pune plant" maxLength={300} />
      </Row>

      <div style={{ marginTop: S.md, padding: '10px 12px', background: C.sunken, borderRadius: R.md, fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>
        <strong style={{ color: C.ink }}>{form.people.length ? form.people.map(p => p.name).join(', ') : 'They'}</strong> will see <strong style={{ color: C.ink }}>{summary}</strong>
        {' '}— {tabWords || 'no tabs'}; {form.names ? 'names shown' : 'counts only, no names'}; {form.pay ? 'with pay' : 'no pay'}; {form.exportOk ? 'can download' : 'no downloads'}
        {form.until ? `; until ${dLabelLong(form.until)}` : ''}. They find it in ESS → Insights → Organisation, and on the dashboard if they use it.
      </div>

      {err && <div style={{ marginTop: S.md }}><Notice t="critical" title="Not saved">{err}</Notice></div>}
      <div style={{ display: 'flex', gap: S.sm, justifyContent: 'flex-end', marginTop: S.md }}>
        <Button size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : form.editing ? 'Save changes' : 'Give access'}</Button>
      </div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.sm, padding: `${S.sm}px 0`, borderTop: `1px solid ${C.line}` }}>
      <div style={{ flex: '0 0 180px', minWidth: 0 }}>
        <div style={{ ...eyebrow, fontSize: 10 }}>{label}</div>
        {hint && <div style={{ fontSize: F.micro, color: C.faint, marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>{children}</div>
    </div>
  )
}

const chip = (on: boolean): React.CSSProperties => ({
  padding: '5px 11px', borderRadius: R.pill, fontSize: F.tiny, fontFamily: 'inherit', cursor: 'pointer',
  border: `1px solid ${on ? C.brandEdge : C.line}`, background: on ? C.brandTint : C.surface,
  color: on ? C.brandDeep : C.inkSoft, fontWeight: on ? W.semi : W.medium,
})

/** "All …" plus each option; null means all (and anything added later). */
function CheckList({ all, options, value, onChange }: {
  all: string | null; options: { value: string; label: string }[]; value: Pick; onChange: (v: Pick) => void
}) {
  const [more, setMore] = React.useState(false)
  const everything = value === null
  const shown = more || options.length <= 14 ? options : options.slice(0, 14)
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {all && <button type="button" aria-pressed={everything} onClick={() => onChange(everything ? [] : null)} className="ez-press" style={chip(everything)}>{everything ? '✓ ' : ''}{all}</button>}
      {shown.map(o => {
        const on = !everything && value!.includes(o.value)
        return (
          <button key={o.value} type="button" aria-pressed={on} disabled={everything} onClick={() => onChange(on ? value!.filter(v => v !== o.value) : [...(value || []), o.value])}
            className="ez-press" style={{ ...chip(on), opacity: everything ? 0.45 : 1, cursor: everything ? 'default' : 'pointer' }}>{on ? '✓ ' : ''}{o.label}</button>
        )
      })}
      {options.length > 14 && <button type="button" onClick={() => setMore(x => !x)} style={{ background: 'none', border: 'none', color: C.brand, fontSize: F.tiny, fontWeight: W.semi, cursor: 'pointer', fontFamily: 'inherit' }}>{more ? 'Fewer' : `+${options.length - 14} more`}</button>}
      {!options.length && <span style={{ fontSize: F.tiny, color: C.faint }}>None recorded.</span>}
    </div>
  )
}

function Toggle({ on, set, label, hint, disabled }: { on: boolean; set: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
      <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={e => set(e.target.checked)} style={{ marginTop: 3, accentColor: C.brand }} />
      <span>
        <span style={{ display: 'block', fontSize: F.small, color: C.ink, fontWeight: W.medium }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: F.micro, color: C.muted, marginTop: 1 }}>{hint}</span>}
      </span>
    </label>
  )
}

export function PersonChip({ p, onRemove }: { p: Person; onRemove?: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px', borderRadius: R.pill, background: C.sunken, border: `1px solid ${C.line}`, fontSize: F.tiny }}>
      <strong style={{ color: C.ink, fontWeight: W.semi }}>{p.name}</strong>
      <span style={{ color: C.muted }}>{[p.code, p.designation].filter(Boolean).join(' · ')}</span>
      {onRemove && <button type="button" aria-label={`Remove ${p.name}`} onClick={onRemove} style={{ border: 'none', background: 'none', color: C.muted, cursor: 'pointer', fontSize: F.small, lineHeight: 1, padding: '0 4px' }}>×</button>}
    </span>
  )
}

export function PeoplePicker({ value, onChange, me }: { value: Person[]; onChange: (p: Person[]) => void; me: string | null }) {
  const [q, setQ] = React.useState('')
  // Answers are kept with the term they answer, so a stale one is never shown.
  const [found, setFound] = React.useState<{ term: string; people: Person[] } | null>(null)
  const term = q.trim()
  React.useEffect(() => {
    if (term.length < 2) return
    let live = true
    const t = setTimeout(() => {
      call(`/api/analytics/access?search=${encodeURIComponent(term)}`)
        .then(b => { if (live) setFound({ term, people: (b.people || []) as Person[] }) }, () => { if (live) setFound({ term, people: [] }) })
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [term])
  const busy = found?.term !== term
  const hits = !busy && found ? found.people : []
  const picked = new Set(value.map(p => p.id))
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {value.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{value.map(p => <PersonChip key={p.id} p={p} onRemove={() => onChange(value.filter(x => x.id !== p.id))} />)}</div>}
      <div style={{ position: 'relative', maxWidth: 420 }}>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or employee code" aria-label="Search people" />
        {q.trim().length >= 2 && (
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: Z.raised, background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, boxShadow: E.floating, maxHeight: 280, overflowY: 'auto' }}>
            {busy && !hits.length && <div style={{ padding: 10, fontSize: F.tiny, color: C.muted }}>Searching…</div>}
            {!busy && !hits.length && <div style={{ padding: 10, fontSize: F.tiny, color: C.muted }}>Nobody found in your companies.</div>}
            {hits.map(p => {
              const self = p.id === me
              return (
                <button key={p.id} type="button" disabled={picked.has(p.id) || self} onClick={() => { onChange([...value, p]); setQ('') }} className="ez-row" style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'transparent',
                  cursor: picked.has(p.id) || self ? 'default' : 'pointer', fontFamily: 'inherit', opacity: picked.has(p.id) || self ? 0.5 : 1,
                }}>
                  <span style={{ display: 'block', fontSize: F.small, color: C.ink }}>{p.name} {self && <span style={{ color: C.muted, fontSize: F.micro }}>(you — ask another administrator)</span>}</span>
                  <span style={{ display: 'block', fontSize: F.micro, color: C.muted }}>{[p.code, p.designation, p.company].filter(Boolean).join(' · ')}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── The lists ───────────────────────────────────────────────────────────────

function GrantList({ m, onEdit, onRemove }: { m: Manage; onEdit: (g: Grant) => void; onRemove: (g: Grant) => void }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, padding: S.lg }}>
      <h3 style={{ margin: 0, fontSize: F.lead, fontWeight: W.semi }}>Access given here <span style={{ color: C.muted, fontWeight: W.regular, fontSize: F.small }}>· {m.grants.length}</span></h3>
      <div style={{ fontSize: F.tiny, color: C.muted, margin: `3px 0 ${S.md}px` }}>For these people the row below decides — it overrides what their role would give.</div>
      <MiniTable empty="Nobody yet. Use Give access to add someone."
        head={['Person', 'Sees', 'Tabs', 'Names', 'Pay', 'Downloads', 'Ends', 'Set by', '']}
        align={['left', 'left', 'left', 'center', 'center', 'center', 'left', 'left', 'right']}
        rows={m.grants.map(g => [
          <span key="p"><strong style={{ fontWeight: W.semi }}>{g.name}</strong><br /><span style={{ color: C.muted, fontSize: F.micro }}>{[g.code, g.designation, g.company].filter(Boolean).join(' · ')}</span>{!g.live && <> <Pill t="warning">Ended</Pill></>}</span>,
          g.scopeLabel,
          g.tabs.length === ORG_TABS.length ? 'All' : g.tabs.map(t => TAB_LABEL[t]).join(', '),
          g.see_names ? 'Yes' : '—', g.see_pay ? 'Yes' : '—', g.can_export ? 'Yes' : '—',
          g.valid_until ? dLabelLong(g.valid_until) : '—',
          <span key="b">{g.granted_by_name || '—'}{g.updated_at ? <><br /><span style={{ color: C.faint, fontSize: F.micro }}>{dLabelLong(g.updated_at.slice(0, 10))}</span></> : null}</span>,
          <span key="a" style={{ display: 'inline-flex', gap: 6 }}>
            <Button size="sm" onClick={() => onEdit(g)}>Change</Button>
            <Button size="sm" variant="danger" onClick={() => onRemove(g)}>Remove</Button>
          </span>,
        ])} />
    </section>
  )
}

function HolderList({ holders }: { holders: Holder[] }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, padding: S.lg }}>
      <h3 style={{ margin: 0, fontSize: F.lead, fontWeight: W.semi }}>Access through a role <span style={{ color: C.muted, fontWeight: W.regular, fontSize: F.small }}>· {holders.length}</span></h3>
      <div style={{ fontSize: F.tiny, color: C.muted, margin: `3px 0 ${S.md}px` }}>
        Their role carries Reports, Company Dashboard or ESS Reports, so they see every company that role covers. To narrow one of them to a site or department, give them access here — the row then decides.
      </div>
      <MiniTable empty="Nobody holds a reporting role." head={['Person', 'Code', 'Designation', 'Role']}
        rows={holders.map(h => [h.name, h.code || '—', h.designation || '—', h.roles.join(', ')])} />
    </section>
  )
}
