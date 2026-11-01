'use client'
// components/learning/admin/BuilderReach.tsx — who can find this course. Visibility is about
// finding it in the catalogue; being made to do it is an assignment, which ignores this.
// On a published course these are publishing decisions and need publish rights, except
// "featured" and prerequisites, which the server leaves with editors.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, Notice, S } from '@/lib/ui'
import { Chip, Hint, Panel, PickList, RadioList, Toggle, audienceWords, row, stack, useLoad, type PickOption, type Target } from './shared'
import { AudienceEditor, type Lookups } from './AudienceEditor'
import type { BuilderApi } from './builder-api'

const VISIBILITY = [
  { value: 'EVERYONE', label: 'Everyone', hint: 'Listed in the catalogue for all employees.' },
  { value: 'RESTRICTED', label: 'A chosen group', hint: 'Listed only for the people you choose below.' },
  { value: 'HIDDEN', label: 'Nobody', hint: 'Not in the catalogue. People reach it only when it is assigned to them.' },
]
const ENROLMENT = [
  { value: 'SELF', label: 'Anyone who can see it can start', hint: 'People enrol themselves from the catalogue.' },
  { value: 'APPROVAL', label: 'Needs their manager\'s approval', hint: 'People ask, and their manager decides.' },
  { value: 'ASSIGN_ONLY', label: 'Only by assignment', hint: 'It shows in the catalogue, but people cannot start it themselves.' },
]
const COURSE_AUDIENCE = ['DEPARTMENT', 'DESIGNATION', 'LOCATION', 'GRADE', 'EMPLOYMENT_TYPE', 'EMPLOYEE_CATEGORY', 'TEAM']

function AudienceBlock({ b, initial, governed }: { b: BuilderApi; initial: Target[]; governed: boolean }) {
  // Null until someone edits: the saved group shows, and a refetch can never overwrite a draft.
  const [draft, setDraft] = useState<Target[] | null>(null)
  const rows = draft ?? initial
  const dirty = draft !== null
  const [busy, setBusy] = useState(false)
  const look = useLoad<Lookups | null>(() => (governed ? Promise.resolve(null) : lmsApi(`/api/lms/admin/lookups?company=${b.course.company_id}`)), [b.course.company_id, governed])
  const save = async () => {
    setBusy(true)
    const r = await b.patchCourse({ audience: rows.map(({ kind, value, label }) => ({ kind, value, label })) })
    setBusy(false)
    if (r !== false) setDraft(null)
  }
  if (governed) {
    const words = audienceWords(rows).include
    return words.length ? <div style={row(6)}>{words.map(w => <Chip key={w}>{w}</Chip>)}</div> : <Hint>Nobody chosen yet.</Hint>
  }
  return (
    <div style={stack()}>
      {!rows.length && <Notice t="warning">Until you choose a group, nobody will see this course in the catalogue.</Notice>}
      <AudienceEditor value={rows} onChange={setDraft} lookups={look.data} kinds={COURSE_AUDIENCE} exclusions={false} />
      <div style={row()}>
        <Button size="sm" variant="primary" disabled={!dirty || busy} onClick={save}>Save this group</Button>
        {dirty && <Hint>Not saved yet</Hint>}
      </div>
    </div>
  )
}

function Prerequisites({ b, selected, disabled }: { b: BuilderApi; selected: string[]; disabled: boolean }) {
  const c = b.course
  const list = useLoad<any>(() => lmsApi(`/api/lms/admin/courses?company=${c.company_id}`), [c.company_id])
  const options: PickOption[] = useMemo(() => (list.data?.courses || [])
    .filter((x: any) => x.id !== c.id && x.status !== 'ARCHIVED')
    .map((x: any) => ({ value: x.id, label: x.title, meta: `${x.code} · ${x.status === 'PUBLISHED' ? 'Published' : 'Draft'}` })), [list.data, c.id])
  const title = (id: string) => options.find(o => o.value === id)?.label || 'Course'
  const toggle = (id: string) => b.patchCourse({ prerequisites: selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id] })
  return (
    <div style={stack(S.sm)}>
      {selected.length > 0 && <div style={row(6)}>{selected.map(id => <Chip key={id} onRemove={disabled ? undefined : () => toggle(id)}>{title(id)}</Chip>)}</div>}
      {!disabled && <PickList options={options} selected={selected} onToggle={o => toggle(o.value)} placeholder="Search courses" maxHeight={190} emptyText="No other courses yet." />}
      {disabled && !selected.length && <Hint>None set.</Hint>}
    </div>
  )
}

export default function BuilderReach({ b, audience, prerequisites }: { b: BuilderApi; audience: any[]; prerequisites: string[] }) {
  const c = b.course
  const governed = !b.canEdit || (c.status === 'PUBLISHED' && !b.ctx.caps.publish)
  return (
    <>
      {b.canEdit && governed && <Notice t="info" title="This course is live">Changing who it reaches needs publish rights. Someone with them can change these.</Notice>}
      <Panel title="Who can find it" hint="This is about the catalogue. Assigning a course reaches people whatever you choose here.">
        <div style={stack()}>
          <RadioList name="visibility" value={c.visibility} options={VISIBILITY} disabled={governed} onChange={v => b.patchCourse({ visibility: v })} />
          {c.visibility === 'RESTRICTED' && <AudienceBlock b={b} initial={audience} governed={governed} />}
        </div>
      </Panel>
      <Panel title="How people get in">
        <RadioList name="enrolment_mode" value={c.enrolment_mode} options={ENROLMENT} disabled={governed} onChange={v => b.patchCourse({ enrolment_mode: v })} />
      </Panel>
      <Panel title="Labels">
        <div style={stack(S.sm)}>
          <Toggle label="Compliance course" hint="Counted in compliance reporting." checked={c.is_compliance} disabled={governed} onChange={v => b.patchCourse({ is_compliance: v })} />
          <Toggle label="Featured" hint="Picked out in the catalogue and in recommendations." checked={c.is_featured} disabled={!b.canEdit} onChange={v => b.patchCourse({ is_featured: v })} />
        </div>
      </Panel>
      <Panel title="Finish these first" hint="People must complete these courses before this one opens.">
        <Prerequisites b={b} selected={prerequisites} disabled={!b.canEdit} />
      </Panel>
    </>
  )
}
