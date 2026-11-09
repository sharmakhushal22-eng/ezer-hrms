'use client'
// components/learning/admin/AssignForm.tsx — giving learning out. One page in the order the
// decision is made: what, who, and on what terms, with the audience counted live alongside.
import { useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, Card, Field, S, Select, Skeleton } from '@/lib/ui'
import { ActionNotes, Hint, LoadError, NeedCompany, Panel, RadioList, TextArea, TextInput, Toggle, grid, plural, row, stack, today, useAction, type Ctx, type Target } from './shared'
import { ASSIGN_KINDS, AudienceEditor, AudiencePreview } from './AudienceEditor'
import { ItemPicker, useAssignData, type Item } from './assign-parts'

interface Terms {
  name: string; mandatory: boolean; priority: string; dueMode: string; dueDate: string; dueDays: string
  startAt: string; reminder: string; retake: boolean; note: string; dynamic: boolean
}
const START: Terms = { name: '', mandatory: true, priority: 'NORMAL', dueMode: 'AFTER_ASSIGN', dueDate: '', dueDays: '14', startAt: '', reminder: '', retake: false, note: '', dynamic: false }

function TermsPanel({ t, set, canAutomate }: { t: Terms; set: (p: Partial<Terms>) => void; canAutomate: boolean }) {
  return (
    <Panel title="3. Settings">
      <div style={stack()}>
        <RadioList name="mandatory" value={t.mandatory ? 'yes' : 'no'} onChange={v => set({ mandatory: v === 'yes' })} options={[
          { value: 'yes', label: 'Mandatory', hint: 'Counts in compliance, and people are reminded until it is done.' },
          { value: 'no', label: 'Optional', hint: 'Suggested to people, not chased.' },
        ]} />
        <div style={grid(190)}>
          <Field label="Priority">
            <Select value={t.priority} onChange={e => set({ priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option></Select>
          </Field>
          <Field label="Due">
            <Select value={t.dueMode} onChange={e => set({ dueMode: e.target.value })}>
              <option value="NONE">No due date</option><option value="FIXED">On a fixed date</option><option value="AFTER_ASSIGN">Days after assigned</option>
            </Select>
          </Field>
          {t.dueMode === 'FIXED' && <Field label="Due date" required><TextInput type="date" min={today()} value={t.dueDate} onChange={e => set({ dueDate: e.target.value })} /></Field>}
          {t.dueMode === 'AFTER_ASSIGN' && <Field label="Days after assigned"><TextInput type="number" min={0} value={t.dueDays} placeholder="Company default" onChange={e => set({ dueDays: e.target.value })} /></Field>}
          <Field label="Start on" hint="Blank starts it now."><TextInput type="date" min={today()} value={t.startAt} onChange={e => set({ startAt: e.target.value })} /></Field>
          <Field label="Remind every (days)" hint="Blank uses the company's reminders."><TextInput type="number" min={1} value={t.reminder} onChange={e => set({ reminder: e.target.value })} /></Field>
        </div>
        <Toggle label="Include people who already completed it" hint="Use this for a retake. Off leaves anyone with a valid completion alone." checked={t.retake} onChange={v => set({ retake: v })} />
        {canAutomate && <Toggle label="Keep applying to people who match later" hint="The daily job adds anyone who comes to match this audience, such as someone who moves into the department." checked={t.dynamic} onChange={v => set({ dynamic: v })} />}
        <Field label="Name" hint="Blank names it after the first course."><TextInput value={t.name} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="Note" hint="For HR's records."><TextArea rows={2} value={t.note} onChange={e => set({ note: e.target.value })} /></Field>
      </div>
    </Panel>
  )
}

export default function AssignForm({ ctx, onDone, onCancel }: { ctx: Ctx; onDone: (note: string) => void; onCancel: () => void }) {
  const data = useAssignData(ctx.company)
  const [items, setItems] = useState<Item[]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [t, setT] = useState(START)
  const a = useAction()
  const set = (p: Partial<Terms>) => setT(x => ({ ...x, ...p }))

  if (!ctx.company) return <><NeedCompany doing="assign learning" /><Button onClick={onCancel}>Back</Button></>

  const kinds = ctx.branchOnly ? ASSIGN_KINDS.filter(k => k !== 'LOCATION') : ASSIGN_KINDS
  const hasWho = targets.some(x => !x.exclude)
  const incomplete = !items.length ? 'Choose what to assign.' : !hasWho ? 'Choose who it is for.' : t.dueMode === 'FIXED' && !t.dueDate ? 'Choose the due date.' : ''
  const submit = async () => {
    const r = await a.run(() => lmsApi('/api/lms/admin/assignments', {
      company_id: ctx.company, name: t.name || undefined, trigger_type: t.dynamic ? 'DYNAMIC' : 'ONCE', mandatory: t.mandatory, priority: t.priority,
      items: items.map(({ course_id, path_id }) => ({ course_id, path_id })), targets,
      due_mode: t.dueMode, due_date: t.dueMode === 'FIXED' ? t.dueDate : null, due_days: t.dueMode === 'AFTER_ASSIGN' && t.dueDays !== '' ? Number(t.dueDays) : null,
      start_at: t.startAt ? `${t.startAt}T09:00:00+05:30` : null, reminder_every_days: t.reminder ? Number(t.reminder) : null, include_completed: t.retake, note: t.note || null,
    }))
    if (!r) return
    if (r.scheduled) onDone(`Scheduled. "${r.name}" starts on the date you chose.`)
    else if (!r.enrolled) onDone(r.matched ? `Nobody new was enrolled: all ${plural(r.matched, 'person', 'people')} already had it.` : 'Nobody matches this audience today, so nobody was enrolled.')
    else onDone(`Assigned. ${plural(r.enrolled, 'person', 'people')} enrolled${r.matched > r.enrolled ? `, and ${plural(r.matched - r.enrolled, 'other')} already had it` : ''}.`)
  }
  return (
    <div style={{ display: 'flex', gap: S.lg, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '3 1 480px', minWidth: 0 }}>
        <LoadError error={data.error} setup={data.setup} />
        {!data.data && !data.error ? <Skeleton h={260} /> : (
          <>
            <Panel title="1. What" hint="Only published courses and paths can be assigned.">
              <ItemPicker courses={data.data?.courses || []} paths={data.data?.paths || []} value={items} onChange={setItems} />
            </Panel>
            <Panel title="2. Who">
              <AudienceEditor value={targets} onChange={setTargets} lookups={data.data?.lookups || null} kinds={kinds} allowCompany={ctx.caps.automate && !ctx.branchOnly} />
            </Panel>
            <TermsPanel t={t} set={set} canAutomate={ctx.caps.automate} />
          </>
        )}
      </div>
      <div style={{ flex: '1 1 260px', minWidth: 0, position: 'sticky', top: S.lg }}>
        <Card elevation="flat">
          <div style={stack(S.sm)}>
            <AudiencePreview company={ctx.company} targets={targets} trigger={t.dynamic ? 'DYNAMIC' : 'ONCE'} />
            <ActionNotes a={a} />
            {incomplete && <Hint>{incomplete}</Hint>}
            <div style={row()}>
              <Button variant="primary" disabled={a.busy || !!incomplete} onClick={submit}>{t.startAt ? 'Schedule' : 'Assign'}</Button>
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
