'use client'
// components/learning/admin/PreboardingTab.tsx — learning before day one. A candidate gets a
// personal link and a one-time code; they hold no ESS account. Only a hash of the link is
// stored, so the invite's response is the one moment it can be shown.
import { useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Badge, Button, C, Empty, F, Field, IconLearning, IconPlus, Input, Notice, S, Select, SkeletonRows, TableWrap, Td, Th, Tr, W, numeric, type Tone } from '@/lib/ui'
import {
  ActionNotes, ConfirmButton, CopyButton, Hint, LoadError, NeedCompany, Panel, TextInput, Toggle, day, grid, plural, row, stack, today, useAction, useLoad, when, withCompany, type Ctx,
} from './shared'
import { ItemPicker, useAssignData, type Item } from './assign-parts'

interface Draft { company_id: string | null; full_name: string; email: string; date_of_joining: string; department_id: string; designation: string; onboarding_candidate_id?: string | null; recruit_candidate_id?: string | null }
interface Link { name: string; link: string; mailed: boolean; enrolled?: number; deliverable?: boolean }

const empty = (company: string | null): Draft => ({ company_id: company, full_name: '', email: '', date_of_joining: '', department_id: '', designation: '' })

function LinkResult({ r, onClose }: { r: Link; onClose: () => void }) {
  return (
    <Notice t="positive" title={`${r.name}: invitation ready`} action={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}>
      <div style={stack(S.sm)}>
        <div>{r.mailed ? 'The invitation e-mail has gone.' : 'The e-mail did not go. Send them this link yourself.'}{r.enrolled ? ` ${plural(r.enrolled, 'course')} assigned.` : ''}</div>
        <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          <code style={{ fontSize: F.tiny, padding: '6px 8px', borderRadius: 7, background: C.surface, border: `1px solid ${C.line}`, color: C.ink, wordBreak: 'break-all', flex: '1 1 280px' }}>{r.link}</code>
          <CopyButton text={r.link} label="Copy link" />
        </div>
        <div style={{ color: C.ink, fontWeight: W.semi }}>This link is shown only now. It cannot be read back later. Resend makes a new one.</div>
      </div>
    </Notice>
  )
}

function InviteForm({ initial, onDone, onClose }: { initial: Draft; onDone: (r: Link) => void; onClose: () => void }) {
  const [d, setD] = useState(initial)
  const [items, setItems] = useState<Item[]>([])
  const [mandatory, setMandatory] = useState(true)
  const company = d.company_id
  const data = useAssignData(company)
  const a = useAction()
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }))
  const submit = async () => {
    const r = await a.run(() => lmsApi('/api/lms/admin/preboarding', {
      action: 'invite', company_id: company, full_name: d.full_name, email: d.email, date_of_joining: d.date_of_joining || null, department_id: d.department_id || null,
      designation: d.designation || null, onboarding_candidate_id: d.onboarding_candidate_id || null, recruit_candidate_id: d.recruit_candidate_id || null,
      items: items.map(({ course_id, path_id }) => ({ course_id, path_id })), mandatory,
    }))
    if (r) onDone({ name: d.full_name, link: r.link, mailed: r.mailed, enrolled: r.enrolled, deliverable: r.deliverable })
  }
  return (
    <Panel title={d.onboarding_candidate_id || d.recruit_candidate_id ? `Invite ${d.full_name}` : 'Invite someone'} hint="They confirm their e-mail with a one-time code, then see only the courses given to them." actions={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}>
      <div style={stack()}>
        <ActionNotes a={a} />
        <LoadError error={data.error} setup={data.setup} />
        <div style={grid(220)}>
          <Field label="Full name" required><Input value={d.full_name} onChange={e => set({ full_name: e.target.value })} /></Field>
          <Field label="E-mail" required hint="The one-time code goes here."><TextInput type="email" value={d.email} onChange={e => set({ email: e.target.value })} /></Field>
          <Field label="Joining date"><TextInput type="date" min={today()} value={d.date_of_joining} onChange={e => set({ date_of_joining: e.target.value })} /></Field>
          <Field label="Department">
            <Select value={d.department_id} onChange={e => set({ department_id: e.target.value })}>
              <option value="">Not set</option>
              {(data.data?.lookups.departments || []).map(x => <option key={x.id} value={x.id}>{x.dept_name}</option>)}
            </Select>
          </Field>
          <Field label="Designation"><TextInput value={d.designation} onChange={e => set({ designation: e.target.value })} /></Field>
        </div>
        <div>
          <div style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft, marginBottom: 5 }}>Courses and paths</div>
          <ItemPicker courses={data.data?.courses || []} paths={data.data?.paths || []} value={items} onChange={setItems} />
          <Hint style={{ marginTop: S.xs }}>Any active pre-joining rule that fits them applies as well.</Hint>
        </div>
        {items.length > 0 && <Toggle label="Mandatory" hint={d.date_of_joining ? 'Due the day before they join.' : 'Due after the company\'s default number of days.'} checked={mandatory} onChange={setMandatory} />}
        <div><Button variant="primary" disabled={a.busy || !d.full_name.trim() || !d.email.trim()} onClick={submit}>Send invitation</Button></div>
      </div>
    </Panel>
  )
}

function candidateState(c: any): { label: string; t: Tone } {
  if (c.kind === 'EMPLOYEE') return { label: 'Joined', t: 'positive' }
  if (c.status === 'REVOKED' || c.revoked_at) return { label: 'Revoked', t: 'neutral' }
  if (c.token_expires_at && new Date(c.token_expires_at).getTime() < Date.now()) return { label: 'Link expired', t: 'warning' }
  if (c.last_login_at) return { label: 'Signed in', t: 'info' }
  return { label: 'Invited', t: 'neutral' }
}

function Invited({ ctx, rows, onLink, onChanged }: { ctx: Ctx; rows: any[]; onLink: (r: Link) => void; onChanged: () => void }) {
  const a = useAction()
  const resend = async (c: any) => {
    const r = await a.run(() => lmsApi('/api/lms/admin/preboarding', { action: 'resend', learner_id: c.id }))
    if (r) { onLink({ name: c.full_name, link: r.link, mailed: r.mailed }); onChanged() }
  }
  const revoke = async (c: any) => { if (await a.run(() => lmsApi('/api/lms/admin/preboarding', { action: 'revoke', learner_id: c.id }), 'Access revoked.')) onChanged() }
  return (
    <>
      <ActionNotes a={a} />
      <TableWrap minWidth={980} stagger={false}>
        <thead><tr><Th>Candidate</Th><Th>Joining</Th><Th>Status</Th><Th>Last sign-in</Th><Th align="right">Assigned</Th><Th align="right">Completed</Th><Th>Link valid till</Th>{ctx.caps.assign && <Th>Actions</Th>}</tr></thead>
        <tbody>
          {rows.map(c => {
            const s = candidateState(c)
            return (
              <Tr key={c.id}>
                <Td><div style={{ fontWeight: W.semi, color: C.ink }}>{c.full_name}</div><div style={{ fontSize: F.tiny, color: C.muted }}>{[c.email, c.designation].filter(Boolean).join(' · ')}</div></Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{day(c.date_of_joining)}</Td>
                <Td><Badge t={s.t} size="sm">{s.label}</Badge></Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{c.last_login_at ? when(c.last_login_at) : 'Not yet'}</Td>
                <Td align="right">{c.assigned}</Td><Td align="right">{c.completed}</Td>
                <Td style={{ whiteSpace: 'nowrap', ...numeric }}>{c.kind === 'EMPLOYEE' ? '-' : day(c.token_expires_at)}</Td>
                {ctx.caps.assign && (
                  <Td style={{ whiteSpace: 'nowrap' }}>
                    {c.kind === 'CANDIDATE' && (
                      <div style={row(4)}>
                        <Button size="sm" disabled={a.busy} onClick={() => resend(c)}>{c.status === 'REVOKED' ? 'Restore and resend' : 'Resend'}</Button>
                        {c.status !== 'REVOKED' && <ConfirmButton label="Revoke" question="Stop their access now?" confirm="Revoke" disabled={a.busy} onConfirm={() => revoke(c)} />}
                      </div>
                    )}
                  </Td>
                )}
              </Tr>
            )
          })}
        </tbody>
      </TableWrap>
    </>
  )
}

function Pending({ ctx, rows, departments, onInvite }: { ctx: Ctx; rows: any[]; departments: Map<string, string>; onInvite: (p: any) => void }) {
  return (
    <TableWrap minWidth={760} stagger={false}>
      <thead><tr><Th>Candidate</Th><Th>From</Th><Th>Designation</Th><Th>Department</Th><Th>Joining</Th>{ctx.caps.assign && <Th />}</tr></thead>
      <tbody>
        {rows.map((p, i) => (
          <Tr key={p.onboarding_candidate_id || p.recruit_candidate_id || i}>
            <Td><div style={{ fontWeight: W.semi, color: C.ink }}>{p.full_name}</div><div style={{ fontSize: F.tiny, color: C.muted }}>{p.email || 'No e-mail on file'}</div></Td>
            <Td>{p.source === 'ONBOARDING' ? 'Onboarding' : 'Accepted offer'}</Td>
            <Td>{p.designation || '-'}</Td><Td>{departments.get(p.department_id) || '-'}</Td><Td style={{ whiteSpace: 'nowrap' }}>{day(p.date_of_joining)}</Td>
            {ctx.caps.assign && <Td align="right"><Button size="sm" onClick={() => onInvite(p)}>Invite</Button></Td>}
          </Tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

export default function PreboardingTab({ ctx }: { ctx: Ctx }) {
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/preboarding')), [ctx.company])
  const look = useLoad<any>(() => (ctx.company ? lmsApi(`/api/lms/admin/lookups?company=${ctx.company}`) : Promise.resolve(null)), [ctx.company])
  const [form, setForm] = useState<{ key: string; draft: Draft } | null>(null)
  const [link, setLink] = useState<Link | null>(null)
  const [needs, setNeeds] = useState(false)
  const departments = new Map<string, string>((look.data?.departments || []).map((d: any) => [d.id, d.dept_name]))
  const invited: any[] = list.data?.invited || []
  const pending: any[] = list.data?.pending || []
  const manual = () => { if (!ctx.company) { setNeeds(true); return } setNeeds(false); setLink(null); setForm({ key: 'new', draft: empty(ctx.company) }) }
  const fromPending = (p: any) => {
    setLink(null)
    setForm({ key: p.onboarding_candidate_id || p.recruit_candidate_id, draft: {
      company_id: p.company_id, full_name: p.full_name || '', email: p.email || '', date_of_joining: p.date_of_joining || '', department_id: p.department_id || '', designation: p.designation || '',
      onboarding_candidate_id: p.onboarding_candidate_id, recruit_candidate_id: p.recruit_candidate_id,
    } })
  }
  return (
    <>
      <LoadError error={list.error} setup={list.setup} />
      {needs && !ctx.company && <NeedCompany doing="invite someone" />}
      {link && <LinkResult r={link} onClose={() => setLink(null)} />}
      {form && <InviteForm key={form.key} initial={form.draft} onClose={() => setForm(null)} onDone={r => { setLink(r); setForm(null); list.reload() }} />}
      <div style={{ ...row(), justifyContent: 'space-between', marginBottom: S.md }}>
        <Hint>Candidates see only their assigned courses. When they join, everything they did carries over and the link stops working.</Hint>
        {ctx.caps.assign && <Button variant="primary" icon={<IconPlus size={15} />} onClick={manual}>Invite someone</Button>}
      </div>
      {list.loading && !list.data ? <SkeletonRows /> : (
        <>
          <Panel title={`Waiting to be invited (${pending.length})`} hint="From onboarding and accepted offers.">
            {pending.length ? <Pending ctx={ctx} rows={pending} departments={departments} onInvite={fromPending} /> : <Hint>Nobody is waiting.</Hint>}
          </Panel>
          <Panel title={`Invited (${invited.length})`}>
            {invited.length ? <Invited ctx={ctx} rows={invited} onLink={setLink} onChanged={list.reload} /> : <Empty icon={<IconLearning size={22} />} title="Nobody invited yet" hint="Invite a candidate so they can start learning before their first day." />}
          </Panel>
        </>
      )}
    </>
  )
}
