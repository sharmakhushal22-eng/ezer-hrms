'use client'
// components/learning/admin/AutomationTab.tsx — rules that keep working after they are set up.
// Underneath, each is an assignment whose trigger is not ONCE. The explanations below describe
// when each really fires: lms_daily_sweep, onEmployeeCreated and preboardingSweep.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, Card, Empty, Field, IconLearning, IconPlus, Notice, S, Select, Skeleton, SkeletonRows } from '@/lib/ui'
import {
  ActionNotes, Hint, LoadError, NeedCompany, Panel, RadioList, TextInput, Toggle, grid, row, stack, today, useAction, useLoad, withCompany, type Ctx, type Target,
} from './shared'
import { ASSIGN_KINDS, AudienceEditor, AudiencePreview } from './AudienceEditor'
import { AssignmentTable, ItemPicker, useAssignData, type Item } from './assign-parts'

type Kind = 'ON_JOIN' | 'DYNAMIC' | 'PREBOARD'

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'ON_JOIN', label: 'New joiners', hint: 'For onboarding. Each morning, and when an employee record is created, anyone matching who joined within the window gets these courses. Long-serving staff are not touched.' },
  { value: 'DYNAMIC', label: 'Anyone who matches, now and later', hint: 'Everyone matching gets it today, and the daily job adds anyone who comes to match, such as someone moving into the department.' },
  { value: 'PREBOARD', label: 'Pre-joining candidates', hint: 'Applied when a candidate is invited. While this rule is active, the daily job also invites candidates from onboarding and accepted offers who have a joining date ahead.' },
]

interface Terms { name: string; mandatory: boolean; priority: string; dueMode: string; dueDays: string; dueDate: string; window: string; reminder: string }
const START: Terms = { name: '', mandatory: true, priority: 'NORMAL', dueMode: 'AFTER_JOIN', dueDays: '7', dueDate: '', window: '30', reminder: '' }
const EVERYONE: Record<Kind, { label: string; hint: string }> = {
  ON_JOIN: { label: 'Every new joiner', hint: 'Anyone who joins the company, in any department. You can still leave some out below.' },
  DYNAMIC: { label: 'Everyone in the company', hint: 'Every active employee, including people who join later. You can still leave some out below.' },
  PREBOARD: { label: 'Every candidate', hint: 'Anyone invited to learn before joining.' },
}
const DUE_START: Record<Kind, string> = { ON_JOIN: 'AFTER_JOIN', DYNAMIC: 'AFTER_ASSIGN', PREBOARD: 'BEFORE_JOIN' }

function DueFields({ kind, t, set }: { kind: Kind; t: Terms; set: (p: Partial<Terms>) => void }) {
  const days = t.dueMode === 'AFTER_JOIN' || t.dueMode === 'AFTER_ASSIGN' || t.dueMode === 'BEFORE_JOIN'
  return (
    <div style={grid(190)}>
      {kind !== 'ON_JOIN' && (
        <Field label="Due">
          <Select value={t.dueMode} onChange={e => set({ dueMode: e.target.value })}>
            {kind === 'PREBOARD' && <option value="BEFORE_JOIN">Days before their joining date</option>}
            <option value="AFTER_ASSIGN">Days after assigned</option>
            {kind === 'DYNAMIC' && <option value="FIXED">On a fixed date</option>}
            {kind === 'DYNAMIC' && <option value="NONE">No due date</option>}
          </Select>
        </Field>
      )}
      {days && (
        <Field label={t.dueMode === 'AFTER_JOIN' ? 'Due, days after joining' : t.dueMode === 'BEFORE_JOIN' ? 'Days before joining' : 'Days after assigned'}>
          <TextInput type="number" min={0} value={t.dueDays} onChange={e => set({ dueDays: e.target.value })} />
        </Field>
      )}
      {t.dueMode === 'FIXED' && <Field label="Due date" required><TextInput type="date" min={today()} value={t.dueDate} onChange={e => set({ dueDate: e.target.value })} /></Field>}
      {kind === 'ON_JOIN' && (
        <Field label="Joined within the last (days)" hint="How far back a joiner still counts.">
          <TextInput type="number" min={0} value={t.window} onChange={e => set({ window: e.target.value })} />
        </Field>
      )}
      <Field label="Priority">
        <Select value={t.priority} onChange={e => set({ priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option></Select>
      </Field>
      <Field label="Remind every (days)" hint="Blank uses the company's reminders."><TextInput type="number" min={1} value={t.reminder} onChange={e => set({ reminder: e.target.value })} /></Field>
    </div>
  )
}

function RuleForm({ ctx, onDone, onCancel }: { ctx: Ctx; onDone: (note: string) => void; onCancel: () => void }) {
  const data = useAssignData(ctx.company)
  const [kind, setKind] = useState<Kind>('ON_JOIN')
  const [items, setItems] = useState<Item[]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [t, setT] = useState(START)
  const a = useAction()
  const set = (p: Partial<Terms>) => setT(x => ({ ...x, ...p }))
  const switchKind = (k: Kind) => {
    setKind(k); set({ dueMode: DUE_START[k] })
    // Candidates can only be matched on what is known about them.
    if (k === 'PREBOARD') setTargets(x => x.filter(r => ['COMPANY', 'DEPARTMENT', 'DESIGNATION'].includes(r.kind) && !r.exclude))
  }
  const hasWho = targets.some(x => !x.exclude)
  const incomplete = !items.length ? 'Choose the courses.' : !hasWho ? 'Choose who it is for.' : t.dueMode === 'FIXED' && !t.dueDate ? 'Choose the due date.' : ''
  const windowDays = kind === 'ON_JOIN' ? Number(t.window || 30) : undefined
  const submit = async () => {
    const dayMode = ['AFTER_JOIN', 'AFTER_ASSIGN', 'BEFORE_JOIN'].includes(t.dueMode)
    const r = await a.run(() => lmsApi('/api/lms/admin/assignments', {
      company_id: ctx.company, name: t.name || undefined, trigger_type: kind, mandatory: t.mandatory, priority: t.priority, targets,
      items: items.map(({ course_id, path_id, due_days }) => ({ course_id, path_id, due_days: kind === 'ON_JOIN' ? due_days ?? null : null })),
      due_mode: t.dueMode, due_date: t.dueMode === 'FIXED' ? t.dueDate : null, due_days: dayMode && t.dueDays !== '' ? Number(t.dueDays) : null,
      join_window_days: windowDays, reminder_every_days: t.reminder ? Number(t.reminder) : null,
    }))
    if (r) onDone(`Rule created.${r.enrolled ? ` ${r.enrolled} enrolled so far.` : ''}`)
  }
  return (
    <div style={{ display: 'flex', gap: S.lg, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '3 1 480px', minWidth: 0 }}>
        <LoadError error={data.error} setup={data.setup} />
        <Panel title="When it applies"><RadioList name="rule-kind" value={kind} options={KINDS} onChange={switchKind} /></Panel>
        {!data.data && !data.error ? <Skeleton h={220} /> : (
          <>
            <Panel title="What" hint={kind === 'ON_JOIN' ? 'Add several courses to build an onboarding plan. Each can have its own due day.' : undefined}>
              <ItemPicker courses={data.data?.courses || []} paths={data.data?.paths || []} value={items} onChange={setItems} perItemDue={kind === 'ON_JOIN'} dueWord="days after joining" />
            </Panel>
            <Panel title="Who">
              <AudienceEditor value={targets} onChange={setTargets} lookups={data.data?.lookups || null}
                kinds={kind === 'PREBOARD' ? ['DEPARTMENT', 'DESIGNATION'] : ctx.branchOnly ? ASSIGN_KINDS.filter(k => k !== 'LOCATION') : ASSIGN_KINDS}
                allowCompany={!ctx.branchOnly} exclusions={kind !== 'PREBOARD'} logicHint={kind !== 'PREBOARD'} everyone={EVERYONE[kind]} />
              {kind === 'PREBOARD' && <Hint style={{ marginTop: S.sm }}>Before someone joins, only their department and designation are known, so those are all you can match on.</Hint>}
            </Panel>
            <Panel title="Settings">
              <div style={stack()}>
                <Toggle label="Mandatory" hint="Counts in compliance, and people are reminded until it is done." checked={t.mandatory} onChange={v => set({ mandatory: v })} />
                <DueFields kind={kind} t={t} set={set} />
                <Field label="Name" hint="Blank names it after the first course."><TextInput value={t.name} onChange={e => set({ name: e.target.value })} /></Field>
              </div>
            </Panel>
          </>
        )}
      </div>
      <div style={{ flex: '1 1 260px', minWidth: 0, position: 'sticky', top: S.lg }}>
        <Card elevation="flat">
          <div style={stack(S.sm)}>
            <AudiencePreview company={ctx.company!} targets={targets} trigger={kind} joinWindowDays={windowDays} />
            <ActionNotes a={a} />
            {incomplete && <Hint>{incomplete}</Hint>}
            <div style={row()}>
              <Button variant="primary" disabled={a.busy || !!incomplete} onClick={submit}>Create rule</Button>
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default function AutomationTab({ ctx }: { ctx: Ctx }) {
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/assignments')), [ctx.company])
  const rows: any[] = useMemo(() => (list.data?.assignments || []).filter((a: any) => a.trigger_type !== 'ONCE'), [list.data])
  if (adding) {
    if (!ctx.company) return <><NeedCompany doing="create an automation rule" /><Button onClick={() => setAdding(false)}>Back</Button></>
    return <RuleForm ctx={ctx} onCancel={() => setAdding(false)} onDone={t => { setNote(t); setAdding(false); list.reload() }} />
  }
  return (
    <>
      {note && <Notice t="positive">{note}</Notice>}
      <LoadError error={list.error} setup={list.setup} />
      <div style={{ ...row(), justifyContent: 'space-between', marginBottom: S.md }}>
        <Hint>Rules assign learning by themselves. Pausing one stops new enrolments and leaves existing ones alone.</Hint>
        <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => { setNote(''); setAdding(true) }}>New rule</Button>
      </div>
      {list.loading && !list.data ? <SkeletonRows /> : rows.length
        ? <AssignmentTable ctx={ctx} rows={rows} onChanged={list.reload} />
        : <Empty icon={<IconLearning size={22} />} title="No rules yet" hint="Start with an onboarding plan, so every new joiner gets the right courses without anyone remembering to assign them." />}
    </>
  )
}
