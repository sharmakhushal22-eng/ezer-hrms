'use client'
// components/learning/admin/assign-parts.tsx — what the assign form, the automation rules and
// preboarding share: the data they all load, choosing courses and paths, and the table of
// assignments with its actions.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, C, F, S, TableWrap, Td, Th, Tr, W, numeric } from '@/lib/ui'
import {
  ASSIGN_STATUS, ActionNotes, Chip, Hint, PickList, StatusBadge, TRIGGER, TextInput, Toggle, audienceWords, day, dueText, row, stack, useAction, useLoad, type Ctx, type PickOption,
} from './shared'
import type { Lookups } from './AudienceEditor'

export interface Item { course_id?: string; path_id?: string; title: string; due_days?: number | null }

/** Published courses, published paths and the pick-lists for one company. */
export function useAssignData(company: string | null) {
  return useLoad<{ courses: any[]; paths: any[]; lookups: Lookups } | null>(async () => {
    if (!company) return null
    const [c, p, l] = await Promise.all([
      lmsApi(`/api/lms/admin/courses?company=${company}`),
      lmsApi(`/api/lms/admin/paths?company=${company}`),
      lmsApi(`/api/lms/admin/lookups?company=${company}`),
    ])
    return { courses: c.courses.filter((x: any) => x.status === 'PUBLISHED'), paths: p.paths.filter((x: any) => x.status === 'PUBLISHED'), lookups: l }
  }, [company])
}

const key = (i: Item) => i.course_id || i.path_id || ''

export function ItemPicker({ courses, paths, value, onChange, perItemDue, dueWord }: {
  courses: any[]; paths: any[]; value: Item[]; onChange: (v: Item[]) => void; perItemDue?: boolean; dueWord?: string
}) {
  const options: PickOption[] = useMemo(() => [
    ...courses.map(c => ({ value: c.id, label: c.title, meta: `Course · ${c.code}${c.is_compliance ? ' · Compliance' : ''}` })),
    ...paths.map(p => ({ value: p.id, label: p.title, meta: `Learning path · ${p.code} · ${(p.items || []).length} courses` })),
  ], [courses, paths])
  const toggle = (o: PickOption) => {
    if (value.some(i => key(i) === o.value)) { onChange(value.filter(i => key(i) !== o.value)); return }
    const isCourse = courses.some(c => c.id === o.value)
    onChange([...value, isCourse ? { course_id: o.value, title: o.label } : { path_id: o.value, title: o.label }])
  }
  return (
    <div style={stack(S.sm)}>
      <PickList options={options} selected={value.map(key)} onToggle={toggle} placeholder="Search published courses and paths" emptyText="Nothing is published yet. Only published courses and paths can be assigned." />
      {value.length > 0 && !perItemDue && <div style={row(6)}>{value.map(i => <Chip key={key(i)} onRemove={() => onChange(value.filter(x => x !== i))}>{i.title}</Chip>)}</div>}
      {value.length > 0 && perItemDue && (
        <div style={stack(6)}>
          {value.map(i => (
            <div key={key(i)} style={{ ...row(), justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: F.small, fontWeight: W.medium, color: C.ink, flex: '1 1 200px', minWidth: 0 }}>{i.title}</span>
              <span style={{ ...row(6), fontSize: F.tiny, color: C.muted }}>
                Due
                <TextInput type="number" min={0} aria-label={`Days for ${i.title}`} placeholder="Default" value={i.due_days ?? ''} style={{ width: 86, height: 30 }}
                  onChange={e => onChange(value.map(x => (x === i ? { ...x, due_days: e.target.value === '' ? null : Number(e.target.value) } : x)))} />
                {dueWord}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onChange(value.filter(x => x !== i))}>Remove</Button>
            </div>
          ))}
          <Hint>Set a different number for a course to stage the training, say day 1 and day 30. Blank uses the default below.</Hint>
        </div>
      )}
    </div>
  )
}

function Audience({ targets, names }: { targets: any[]; names: Map<string, string> }) {
  const w = audienceWords(targets || [], names)
  // A pre-joining invitation enrols one named candidate directly, with no audience stored.
  if (!w.include.length) return <div style={{ fontSize: F.tiny, color: C.muted }}>One invited candidate</div>
  return (
    <div style={{ fontSize: F.tiny, color: C.inkSoft, lineHeight: 1.5 }}>
      {w.include.map(t => <div key={t}>{t}</div>)}
      {w.exclude.length > 0 && <div style={{ color: C.muted }}>Leaving out {w.exclude.join('; ')}</div>}
    </div>
  )
}

function CancelRow({ a, cols, busy, onCancel, onKeep }: { a: any; cols: number; busy: boolean; onCancel: (withdraw: boolean) => void; onKeep: () => void }) {
  const [withdraw, setWithdraw] = useState(false)
  return (
    <tr>
      <td colSpan={cols} style={{ padding: S.md, background: C.criticalTint, borderBottom: `1px solid ${C.line}` }}>
        <div style={stack(S.sm)}>
          <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>Cancel “{a.name}”?</div>
          <Hint>Nobody new will be enrolled by it. People who have started keep their progress and can finish.</Hint>
          <Toggle label="Also withdraw people who have not started" checked={withdraw} onChange={setWithdraw} />
          <div style={row()}>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => onCancel(withdraw)}>Cancel this assignment</Button>
            <Button size="sm" variant="ghost" onClick={onKeep}>Keep it</Button>
          </div>
        </div>
      </td>
    </tr>
  )
}

/** Assignments as a table. Actions show only for what this person may do to that row. */
export function AssignmentTable({ ctx, rows, onChanged }: { ctx: Ctx; rows: any[]; onChanged: () => void }) {
  const act = useAction()
  const [cancelling, setCancelling] = useState<string | null>(null)
  const multi = ctx.companies.length > 1 && !ctx.company
  const cols = multi ? 9 : 8
  const look = useLoad<any>(() => (ctx.company ? lmsApi(`/api/lms/admin/lookups?company=${ctx.company}`) : Promise.resolve(null)), [ctx.company])
  const names = useMemo(() => {
    const l = look.data
    return new Map<string, string>([
      ...(l?.employees || []).map((e: any) => [e.id, e.full_name] as [string, string]),
      ...(l?.departments || []).map((d: any) => [d.id, d.dept_name] as [string, string]),
      ...(l?.locations || []).map((d: any) => [d.id, d.location_name] as [string, string]),
    ])
  }, [look.data])
  const go = async (id: string, body: any, ok: string | ((r: any) => string)) => {
    const r = await act.run(() => lmsApi(`/api/lms/admin/assignments/${id}`, body), ok)
    setCancelling(null)
    if (r) onChanged()
  }
  const applied = (r: any) => (r.enrolled ? `${r.enrolled} new ${r.enrolled === 1 ? 'person' : 'people'} enrolled.` : 'Nobody new to enrol. Everyone who matches already has it.')
  return (
    <>
      <ActionNotes a={act} />
      <TableWrap minWidth={1010} stagger={false}>
        <thead>
          <tr>
            <Th>Name</Th>{multi && <Th>Company</Th>}<Th>Learning</Th><Th>Audience</Th><Th>Type and due</Th><Th align="right">Enrolled</Th><Th>Status</Th><Th>By</Th><Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(a => {
            const live = a.status === 'ACTIVE' || a.status === 'PAUSED' || a.status === 'SCHEDULED'
            const standing = a.trigger_type !== 'ONCE'
            const row1 = (
              <Tr key={a.id}>
                <Td strong style={{ minWidth: 150 }}>{a.name}{a.mandatory ? '' : <span style={{ display: 'block', fontSize: F.micro, fontWeight: W.regular, color: C.muted }}>Optional</span>}</Td>
                {multi && <Td>{ctx.companies.find(c => c.id === a.company_id)?.company_code || ''}</Td>}
                <Td style={{ minWidth: 150, fontSize: F.tiny }}>{(a.items || []).map((i: any, n: number) => <div key={n}>{i.title}{i.due_days != null ? ` (${i.due_days} days)` : ''}</div>)}</Td>
                <Td style={{ minWidth: 150 }}><Audience targets={a.targets} names={names} /></Td>
                <Td style={{ whiteSpace: 'nowrap', fontSize: F.tiny }}><div style={{ color: C.ink }}>{TRIGGER[a.trigger_type] || a.trigger_type}</div>{dueText(a)}</Td>
                <Td align="right">{a.enrolled_count}</Td>
                <Td><StatusBadge map={ASSIGN_STATUS} value={a.status} /></Td>
                <Td style={{ fontSize: F.tiny, minWidth: 96 }}><div style={{ color: C.ink }}>{a.created_by_name || 'Automatic'}</div><span style={numeric}>{day(a.created_at)}</span></Td>
                <Td style={{ width: 196 }}>
                  <div style={row(4)}>
                    {ctx.caps.assign && a.status === 'ACTIVE' && (a.targets || []).length > 0 && <Button size="sm" disabled={act.busy} onClick={() => go(a.id, { action: 'apply' }, applied)}>Apply again</Button>}
                    {ctx.caps.automate && standing && a.status === 'ACTIVE' && <Button size="sm" disabled={act.busy} onClick={() => go(a.id, { action: 'pause' }, 'Paused.')}>Pause</Button>}
                    {ctx.caps.automate && standing && a.status === 'PAUSED' && <Button size="sm" disabled={act.busy} onClick={() => go(a.id, { action: 'resume' }, 'Resumed.')}>Resume</Button>}
                    {ctx.caps.assign && live && <Button size="sm" variant="danger" disabled={act.busy} onClick={() => setCancelling(a.id)}>Cancel</Button>}
                  </div>
                </Td>
              </Tr>
            )
            return cancelling === a.id
              ? [row1, <CancelRow key={`${a.id}-x`} a={a} cols={cols} busy={act.busy} onKeep={() => setCancelling(null)}
                  onCancel={w => go(a.id, { action: 'cancel', withdraw_not_started: w }, (r: any) => (r.withdrawn ? `Cancelled. ${r.withdrawn} not-started ${r.withdrawn === 1 ? 'person' : 'people'} withdrawn.` : 'Cancelled.'))} />]
              : [row1]
          })}
        </tbody>
      </TableWrap>
    </>
  )
}
