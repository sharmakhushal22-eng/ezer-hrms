'use client'
// components/learning/admin/AssignmentsTab.tsx — what has been given out, and to whom.
// Enrolments read the reports route, so that sub-view needs Learning Reports.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, Empty, IconLearning, IconPlus, IconUpload, Notice, S, Select, SkeletonRows, Tabs } from '@/lib/ui'
import { Hint, LoadError, TRIGGER, row, useLoad, withCompany, type Ctx } from './shared'
import { AssignmentTable } from './assign-parts'
import AssignForm from './AssignForm'
import ExcelAssign from './ExcelAssign'
import EnrolmentsView from './EnrolmentsView'

type View = 'history' | 'enrolments'

export default function AssignmentsTab({ ctx }: { ctx: Ctx }) {
  const [view, setView] = useState<View>('history')
  const [mode, setMode] = useState<'list' | 'form' | 'excel'>('list')
  const [note, setNote] = useState('')
  const [kind, setKind] = useState('')
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/assignments')), [ctx.company])
  const rows: any[] = useMemo(() => (list.data?.assignments || []).filter((a: any) => !kind || a.trigger_type === kind), [list.data, kind])
  const done = (text: string) => { setNote(text); setMode('list'); setView('history'); list.reload() }

  if (mode === 'form') return <AssignForm ctx={ctx} onDone={done} onCancel={() => setMode('list')} />
  if (mode === 'excel') return <ExcelAssign ctx={ctx} onDone={done} onCancel={() => setMode('list')} />

  const tabs: { key: View; label: string }[] = [{ key: 'history', label: 'Assignment history' }]
  const canEnrolments = ctx.caps.reports || ctx.caps.assign
  if (canEnrolments) tabs.push({ key: 'enrolments', label: 'Enrolments' })
  const showing = canEnrolments ? view : 'history'

  return (
    <>
      {note && <Notice t="positive">{note}</Notice>}
      <div style={{ ...row(), justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 240 }}><Tabs tabs={tabs} value={showing} onChange={v => { setNote(''); setView(v) }} /></div>
        {ctx.caps.assign && (
          <div style={row()}>
            <Button icon={<IconUpload size={15} />} onClick={() => { setNote(''); setMode('excel') }}>Import from Excel</Button>
            <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => { setNote(''); setMode('form') }}>Assign learning</Button>
          </div>
        )}
      </div>
      {showing === 'enrolments' ? <EnrolmentsView ctx={ctx} /> : (
        <>
          <LoadError error={list.error} setup={list.setup} />
          <div style={{ ...row(), marginBottom: S.md }}>
            <Select aria-label="Type" value={kind} onChange={e => setKind(e.target.value)} style={{ width: 200 }}>
              <option value="">All types</option>
              {Object.entries(TRIGGER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Hint>Assigning a course again never enrols anyone twice.</Hint>
          </div>
          {list.loading && !list.data ? <SkeletonRows /> : rows.length
            ? <AssignmentTable ctx={ctx} rows={rows} onChanged={list.reload} />
            : <Empty icon={<IconLearning size={22} />} title="Nothing assigned yet" hint={ctx.caps.assign ? 'Choose a published course, pick who it is for, and set a due date.' : 'Assignments appear here once someone has made one.'} />}
        </>
      )}
    </>
  )
}
