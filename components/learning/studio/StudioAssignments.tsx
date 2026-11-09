'use client'
// components/learning/studio/StudioAssignments.tsx — what has been given out and to whom, and
// the way in to giving out more: the wizard, or a spreadsheet.
//
// The history table and the enrolments view are admin/AssignmentsTab's, unchanged, so every
// column and action (apply again, pause, resume, cancel, waive, extend) is still here.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { IconPlus } from '@/lib/ui'
import { LoadError, TRIGGER, useLoad, withCompany, type Ctx } from '../admin/shared'
import { AssignmentTable } from '../admin/assign-parts'
import ExcelAssign from '../admin/ExcelAssign'
import EnrolmentsView from '../admin/EnrolmentsView'
import { Skel } from '../shared'
import { GRedo, GTarget, GUsers } from '../glyphs'
import AssignWizard from './AssignWizard'

type View = 'history' | 'enrolments'
type Mode = 'list' | 'form' | 'excel'

export default function StudioAssignments({ ctx, tick }: { ctx: Ctx; tick: { n: number; mode: 'form' | 'excel' } }) {
  const [view, setView] = useState<View>('history')
  const [mode, setMode] = useState<Mode>('list')
  const [note, setNote] = useState('')
  const [kind, setKind] = useState('')
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/assignments')), [ctx.company])
  const all: any[] = useMemo(() => list.data?.assignments || [], [list.data])
  const rows = useMemo(() => all.filter(a => !kind || a.trigger_type === kind), [all, kind])
  // The header's buttons bump tick. One from before this section mounted is already handled.
  const [seenTick, setSeenTick] = useState(tick.n)
  const shown: Mode = tick.n !== seenTick ? tick.mode : mode
  const to = (m: Mode) => { setSeenTick(tick.n); setMode(m) }
  const done = (text: string) => { setNote(text); to('list'); setView('history'); list.reload() }

  if (shown === 'form') return <AssignWizard ctx={ctx} onDone={done} onCancel={() => to('list')} onExcel={() => to('excel')} />
  if (shown === 'excel') return <div className="lx-st-host"><ExcelAssign ctx={ctx} onDone={done} onCancel={() => to('list')} /></div>

  const canEnrolments = ctx.caps.reports || ctx.caps.assign
  const showing = canEnrolments ? view : 'history'
  const active = all.filter(a => a.status === 'ACTIVE').length
  const enrolled = all.reduce((n, a) => n + (Number(a.enrolled_count) || 0), 0)
  const standing = all.filter(a => a.trigger_type !== 'ONCE' && a.status === 'ACTIVE').length

  return (
    <>
      {note && <div className="lx-note" data-t="positive" role="status">{note}</div>}
      {list.data && (
        <div className="lx-st-kpis">
          <div className="lx-st-kpi"><i><GTarget size={18} /></i><b>{active}</b><span>Active assignments</span><small>{all.length} in all</small></div>
          <div className="lx-st-kpi" data-t="positive"><i><GUsers size={18} /></i><b>{enrolled.toLocaleString('en-IN')}</b><span>People enrolled by them</span></div>
          <div className="lx-st-kpi" data-t="gold"><i><GRedo size={18} /></i><b>{standing}</b><span>Keep applying</span><small>new joiners, moves and rules</small></div>
        </div>
      )}
      <div className="lx-st-bar" style={{ justifyContent: 'space-between' }}>
        <div className="lx-tabs" role="tablist">
          <button role="tab" aria-selected={showing === 'history'} onClick={() => { setNote(''); setView('history') }}>Assignment history</button>
          {canEnrolments && <button role="tab" aria-selected={showing === 'enrolments'} onClick={() => { setNote(''); setView('enrolments') }}>Enrolments</button>}
        </div>
        {showing === 'history' && (
          <select className="lx-select" aria-label="Type" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(TRIGGER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
      </div>
      {showing === 'enrolments' ? <div className="lx-st-host"><EnrolmentsView ctx={ctx} /></div> : (
        <>
          <LoadError error={list.error} setup={list.setup} />
          {list.loading && !list.data ? <Skel h={280} r={18} /> : rows.length ? (
            <div className="lx-st-host" style={{ padding: 12 }}>
              <AssignmentTable ctx={ctx} rows={rows} onChanged={list.reload} />
              <div className="lx-st-hint" style={{ padding: '10px 6px 2px' }}>Assigning a course again never enrols anyone twice. Whether people can also enrol themselves is set per course, under Who can find it.</div>
            </div>
          ) : (
            <div className="lx-empty">
              <div className="lx-empty-art"><GTarget size={34} /></div>
              <h3>{all.length ? 'No assignment of this type' : 'Nothing assigned yet'}</h3>
              <p>{ctx.caps.assign ? 'Choose a published course, pick who it is for, and set a due date.' : 'Assignments appear here once someone has made one.'}</p>
              {ctx.caps.assign && <button className="lx-btn lx-btn--primary" onClick={() => to('form')}><IconPlus size={15} /> Assign learning</button>}
            </div>
          )}
        </>
      )}
    </>
  )
}
