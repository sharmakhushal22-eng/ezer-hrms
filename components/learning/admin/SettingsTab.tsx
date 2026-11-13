'use client'
// components/learning/admin/SettingsTab.tsx — one company's learning settings and categories.
// Permissions are not here: they are the three Learning modules in Roles → Module Access.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, C, F, Field, S, Skeleton, TableWrap, Td, Th, Tr, W } from '@/lib/ui'
import { ActionNotes, Hint, LoadError, NeedCompany, Panel, TextInput, Toggle, grid, row, stack, useAction, useLoad, when, type Ctx } from './shared'

const NUMBER_RULES: Record<string, { min: number; max?: number; label: string; optional?: boolean }> = {
  default_pass_pct: { min: 0, max: 100, label: 'Default pass mark' },
  default_media_pct: { min: 10, max: 100, label: 'Default share to watch' },
  default_max_attempts: { min: 1, label: 'Default attempts', optional: true },
  default_due_days: { min: 1, label: 'Default due days' },
  overdue_every_days: { min: 1, label: 'Overdue reminder interval' },
  escalate_after_days: { min: 0, label: 'Tell the manager after' },
  preboarding_link_days: { min: 1, max: 180, label: 'Link valid for' },
}

/** Numbers stay as text while being typed, so a field can be empty on the way to a new value. */
function toForm(s: any) {
  const out: any = { ...s, reminder_days_before: (s.reminder_days_before || []).join(', ') }
  for (const k of Object.keys(NUMBER_RULES)) out[k] = s[k] == null ? '' : String(s[k])
  return out
}

function problemIn(f: any): string {
  for (const [k, r] of Object.entries(NUMBER_RULES)) {
    if (f[k] === '') { if (r.optional) continue; return `${r.label} cannot be blank.` }
    const n = Number(f[k])
    if (!Number.isInteger(n) || n < r.min || (r.max != null && n > r.max)) return r.max != null ? `${r.label} must be between ${r.min} and ${r.max}.` : `${r.label} must be ${r.min} or more.`
  }
  if (!/^\s*\d+(\s*,\s*\d+)*\s*$|^\s*$/.test(f.reminder_days_before)) return 'Reminder days must be whole numbers separated by commas, such as 7, 3, 1.'
  if (f.cert_title.trim() === '') return 'The certificate needs a title.'
  return ''
}

function toBody(f: any, company: string) {
  const body: any = { ...f, company_id: company, reminder_days_before: f.reminder_days_before.split(',').map((s: string) => s.trim()).filter(Boolean).map(Number) }
  for (const k of Object.keys(NUMBER_RULES)) body[k] = f[k] === '' ? null : Number(f[k])
  body.cert_signatory_name = f.cert_signatory_name || null
  body.cert_signatory_title = f.cert_signatory_title || null
  return body
}

function Num({ f, name, label, hint, set, placeholder }: { f: any; name: string; label: string; hint?: string; set: (p: any) => void; placeholder?: string }) {
  return <Field label={label} hint={hint}><TextInput type="number" value={f[name]} placeholder={placeholder} onChange={e => set({ [name]: e.target.value })} /></Field>
}

function Categories({ company }: { company: string }) {
  const list = useLoad<any>(() => lmsApi(`/api/lms/admin/catalog?company=${company}`), [company])
  const [name, setName] = useState('')
  const a = useAction()
  const save = async (body: any, ok: string) => { if (await a.run(() => lmsApi('/api/lms/admin/catalog', { company_id: company, ...body }), ok)) { setName(''); list.reload() } }
  const rows: any[] = list.data?.categories || []
  return (
    <Panel title="Categories" hint="How courses are grouped in the catalogue.">
      <div style={stack()}>
        <ActionNotes a={a} />
        <LoadError error={list.error} setup={list.setup} />
        {rows.length > 0 && (
          <TableWrap stagger={false} style={{ boxShadow: 'none' }}>
            <thead><tr><Th>Name</Th><Th>In use</Th><Th /></tr></thead>
            <tbody>{rows.map(c => <CategoryRow key={`${c.id}:${c.name}`} c={c} busy={a.busy} onSave={save} />)}</tbody>
          </TableWrap>
        )}
        {!rows.length && !list.loading && <Hint>No categories yet.</Hint>}
        <div style={{ ...row(), alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px' }}><Field label="New category"><TextInput value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) save({ name }, 'Category added.') }} /></Field></div>
          <Button disabled={a.busy || !name.trim()} onClick={() => save({ name }, 'Category added.')}>Add category</Button>
        </div>
      </div>
    </Panel>
  )
}

function CategoryRow({ c, busy, onSave }: { c: any; busy: boolean; onSave: (body: any, ok: string) => void }) {
  const [name, setName] = useState(c.name)
  return (
    <Tr>
      <Td><TextInput aria-label="Category name" value={name} onChange={e => setName(e.target.value)} style={{ height: 32 }} /></Td>
      <Td>{c.is_active ? 'Yes' : 'Hidden'}</Td>
      <Td align="right">
        <div style={{ ...row(4), justifyContent: 'flex-end' }}>
          {name.trim() !== c.name && <Button size="sm" disabled={busy || !name.trim()} onClick={() => onSave({ id: c.id, name, description: c.description, is_active: c.is_active }, 'Category renamed.')}>Save</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSave({ id: c.id, name: c.name, description: c.description, is_active: !c.is_active }, c.is_active ? 'Hidden from new courses.' : 'Back in use.')}>{c.is_active ? 'Hide' : 'Use again'}</Button>
        </div>
      </Td>
    </Tr>
  )
}

export default function SettingsTab({ ctx }: { ctx: Ctx }) {
  const load = useLoad<any>(() => (ctx.company ? lmsApi(`/api/lms/admin/settings?company=${ctx.company}`) : Promise.resolve(null)), [ctx.company])
  const saved = useMemo(() => (load.data?.settings ? toForm(load.data.settings) : null), [load.data])
  // Null until someone edits, so the form shows what is stored.
  const [draft, setDraft] = useState<any>(null)
  const f = draft ?? saved
  const dirty = draft !== null
  const a = useAction()
  const set = (p: any) => { setDraft((x: any) => ({ ...(x ?? saved), ...p })); a.clear() }
  const problem = useMemo(() => (f ? problemIn(f) : ''), [f])

  if (!ctx.company) return <NeedCompany doing="change its learning settings" />
  if (load.error) return <LoadError error={load.error} setup={load.setup} />
  if (!f) return <Skeleton h={320} />
  const company = ctx.company
  const save = async () => {
    const r = await a.run(() => lmsApi('/api/lms/admin/settings', toBody(f, company), 'PUT'), 'Settings saved.')
    if (r) { await load.reload(); setDraft(null) }
  }
  return (
    <>
      <Panel>
        <Hint>Who can build, assign and report is set in Roles → Module Access, through the three Learning modules: Learning Content, Learning Assignment and Learning Reports.</Hint>
      </Panel>
      <Panel title="Defaults" hint="New courses and assignments start from these. Changing them does not touch anything already built.">
        <div style={stack()}>
          <Toggle label="Learning is on for this company" hint="Off hides Learning from employees and stops its daily reminders." checked={f.enabled} onChange={v => set({ enabled: v })} />
          <div style={grid(200)}>
            <Num f={f} set={set} name="default_pass_pct" label="Pass mark for a new quiz (%)" />
            <Num f={f} set={set} name="default_max_attempts" label="Attempts on a new quiz" placeholder="Unlimited" hint="Blank means unlimited." />
            <Num f={f} set={set} name="default_media_pct" label="Share of a video to watch (%)" />
            <Num f={f} set={set} name="default_due_days" label="Days to finish an assignment" />
          </div>
        </div>
      </Panel>
      <Panel title="Publishing">
        <Toggle label="A second person must approve before publishing" hint="Whoever submits a version for review cannot publish it themselves." checked={f.publish_requires_review} onChange={v => set({ publish_requires_review: v })} />
      </Panel>
      <Panel title="Managers">
        <div style={stack(S.sm)}>
          <Toggle label="Managers can assign published courses to their team" checked={f.managers_can_assign} onChange={v => set({ managers_can_assign: v })} />
          <Toggle label="Managers can see their team's scores" hint="Off shows them progress and completion only." checked={f.managers_see_scores} onChange={v => set({ managers_see_scores: v })} />
        </div>
      </Panel>
      <Panel title="Reminders">
        <div style={stack()}>
          <Toggle label="Send e-mail as well as in-app notifications" checked={f.email_enabled} onChange={v => set({ email_enabled: v })} />
          <div style={grid(220)}>
            <Field label="Days before the due date" hint="Separate with commas, such as 7, 3, 1."><TextInput value={f.reminder_days_before} onChange={e => set({ reminder_days_before: e.target.value })} /></Field>
            <Num f={f} set={set} name="overdue_every_days" label="Once overdue, remind every (days)" />
            <Num f={f} set={set} name="escalate_after_days" label="Tell the manager after overdue (days)" />
          </div>
        </div>
      </Panel>
      <Panel title="Certificates">
        <div style={stack()}>
          <Toggle label="Issue certificates" hint="A course can also turn its own certificate off." checked={f.certificates_enabled} onChange={v => set({ certificates_enabled: v })} />
          <div style={grid(220)}>
            <Field label="Certificate title"><TextInput value={f.cert_title} onChange={e => set({ cert_title: e.target.value })} /></Field>
            <Field label="Signed by"><TextInput value={f.cert_signatory_name || ''} onChange={e => set({ cert_signatory_name: e.target.value })} /></Field>
            <Field label="Signatory's title"><TextInput value={f.cert_signatory_title || ''} onChange={e => set({ cert_signatory_title: e.target.value })} /></Field>
          </div>
        </div>
      </Panel>
      <Panel title="Preboarding">
        <div style={stack()}>
          <Toggle label="Allow learning before joining" hint="Lets HR invite candidates through a personal link." checked={f.preboarding_enabled} onChange={v => set({ preboarding_enabled: v })} />
          <div style={{ maxWidth: 240 }}><Num f={f} set={set} name="preboarding_link_days" label="An invitation link lasts (days)" /></div>
        </div>
      </Panel>
      <Panel title="Points and leaderboard" hint="Points, streaks and badges are worked out from what people finish. Nothing is awarded by hand.">
        <div style={stack(S.sm)}>
          <Toggle label="Show points, streaks and badges" hint="Off hides them from every learner. Nothing is lost: turning them back on shows the same totals." checked={f.game_enabled !== false} onChange={v => set({ game_enabled: v })} />
          <Toggle label="Show the leaderboard" hint="The top ten for the week, month and all time, across the company or a department." checked={f.game_enabled !== false && f.leaderboard_enabled !== false} disabled={f.game_enabled === false} onChange={v => set({ leaderboard_enabled: v })} />
          <Toggle label="Show names on the leaderboard" hint="Off shows everyone else as a colleague in their department. Each person always sees their own name." checked={f.game_enabled !== false && f.leaderboard_enabled !== false && f.leaderboard_names !== false} disabled={f.game_enabled === false || f.leaderboard_enabled === false} onChange={v => set({ leaderboard_names: v })} />
        </div>
      </Panel>
      <div style={{ ...row(), marginBottom: S.xl }}>
        <Button variant="primary" disabled={a.busy || !dirty || !!problem} onClick={save}>Save settings</Button>
        {problem && <span style={{ fontSize: F.tiny, color: C.critical, fontWeight: W.medium }}>{problem}</span>}
        {!problem && dirty && <Hint>Not saved yet</Hint>}
        {!dirty && f.updated_by && <Hint>Last changed by {f.updated_by}, {when(f.updated_at)}</Hint>}
      </div>
      <ActionNotes a={a} />
      <Categories company={company} />
    </>
  )
}
