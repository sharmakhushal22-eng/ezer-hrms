'use client'
// components/learning/studio/AssignWizard.tsx — giving learning out, one decision at a time:
// what, who, on what terms, then a last look before anyone is enrolled.
//
// It sends exactly what admin/AssignForm sends to /api/lms/admin/assignments, so the server's
// rules are unchanged: only published courses and paths, the whole company only with
// organisation-wide rights, branch HR only within their branch. Rules for new joiners and
// for candidates live in Automation and Preboarding, where their extra settings are, and the
// wizard sends people there rather than half-doing them here.
import { useEffect, useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { IconCheck, IconSearch } from '@/lib/ui'
import { ActionNotes, LoadError, NeedCompany, TRIGGER, Toggle, plural, today, useAction, useLoad, type Ctx, type Target } from '../admin/shared'
import { ASSIGN_KINDS, AudienceEditor, AudiencePreview, KIND_LABEL } from '../admin/AudienceEditor'
import { useAssignData, type Item } from '../admin/assign-parts'
import { CourseArt, Skel } from '../shared'
import { GArrowLeft, GArrowRight, GBook, GLayers, GRedo, GTarget, GUsers } from '../glyphs'
import { linkProps, to } from '../app/router'

type StepKey = 'what' | 'who' | 'rules' | 'review'
type WhoMode = 'people' | 'groups' | 'company'

interface Terms {
  name: string; mandatory: boolean; priority: string; dueMode: string; dueDate: string; dueDays: string
  startAt: string; reminder: string; retake: boolean; note: string; dynamic: boolean
}
const START: Terms = { name: '', mandatory: true, priority: 'NORMAL', dueMode: 'AFTER_ASSIGN', dueDate: '', dueDays: '14', startAt: '', reminder: '', retake: false, note: '', dynamic: false }
const key = (i: Item) => i.course_id || i.path_id || ''
const COMPLETION_WORD: Record<string, string> = { ALL_REQUIRED: 'Every required lesson', PERCENT: 'A share of the lessons', FINAL_ONLY: 'Passing the final assessment' }

function PickCard({ on, title, sub, id, src, onClick }: { on: boolean; title: string; sub: string; id: string; src?: string | null; path?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="lx-st-pick" aria-pressed={on} onClick={onClick}>
      <CourseArt src={src} id={id} title={title} word={false} />
      <span style={{ minWidth: 0 }}><b className="lx-clamp2">{title}</b><small>{sub}</small></span>
      <span className="lx-st-pick-tick"><IconCheck size={13} /></span>
    </button>
  )
}

function What({ courses, paths, value, onChange }: { courses: any[]; paths: any[]; value: Item[]; onChange: (v: Item[]) => void }) {
  const [q, setQ] = useState('')
  const t = q.trim().toLowerCase()
  const match = (s: string) => !t || s.toLowerCase().includes(t)
  const has = (id: string) => value.some(i => key(i) === id)
  const toggle = (id: string, item: Item) => onChange(has(id) ? value.filter(i => key(i) !== id) : [...value, item])
  const cs = courses.filter(c => match(`${c.title} ${c.code} ${(c.tags || []).join(' ')}`))
  const ps = paths.filter(p => match(`${p.title} ${p.code}`))
  return (
    <>
      <label className="lx-search" style={{ maxWidth: 'none' }}>
        <IconSearch size={17} />
        <input type="search" data-no-titlecase="" placeholder="Search published courses and paths" aria-label="Search courses and paths" value={q} onChange={e => setQ(e.target.value)} />
      </label>
      {!courses.length && !paths.length && <div className="lx-note" data-t="warning">Nothing is published yet. Only published courses and paths can be assigned.</div>}
      {cs.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="lx-st-label"><GBook size={13} /> Courses</div>
          <div className="lx-st-picks">
            {cs.map(c => <PickCard key={c.id} id={c.id} on={has(c.id)} title={c.title} src={c.thumbnail} sub={`${c.code}${c.is_compliance ? ' · Compliance' : ''}${c.lessons ? ` · ${plural(c.lessons, 'lesson')}` : ''}`} onClick={() => toggle(c.id, { course_id: c.id, title: c.title })} />)}
          </div>
        </div>
      )}
      {ps.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="lx-st-label"><GLayers size={13} /> Learning paths</div>
          <div className="lx-st-picks">
            {ps.map(p => <PickCard key={p.id} id={p.id} path on={has(p.id)} title={p.title} sub={`${p.code} · ${plural((p.items || []).length, 'course')}`} onClick={() => toggle(p.id, { path_id: p.id, title: p.title })} />)}
          </div>
        </div>
      )}
      {t && !cs.length && !ps.length && <div className="lx-st-hint">Nothing matches “{q}”.</div>}
    </>
  )
}

function Mode({ on, icon, title, sub, disabled, onClick }: { on: boolean; icon: React.ReactNode; title: string; sub: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="lx-st-mode" aria-pressed={on} disabled={disabled} onClick={onClick}>
      <span>{icon}</span><b>{title}</b><small>{sub}</small>
    </button>
  )
}

function Who({ ctx, mode, setMode, targets, setTargets, lookups, onExcel }: {
  ctx: Ctx; mode: WhoMode; setMode: (m: WhoMode) => void; targets: Target[]; setTargets: (t: Target[]) => void; lookups: any; onExcel: () => void
}) {
  const canCompany = ctx.caps.automate && !ctx.branchOnly
  const groups = ASSIGN_KINDS.filter(k => k !== 'EMPLOYEE' && !(ctx.branchOnly && k === 'LOCATION'))
  const pickMode = (m: WhoMode) => {
    setMode(m)
    if (m === 'company') setTargets([{ kind: 'COMPANY', value: '', label: 'Everyone', exclude: false }, ...targets.filter(t => t.exclude)])
    else if (targets.some(t => t.kind === 'COMPANY')) setTargets(targets.filter(t => t.kind !== 'COMPANY'))
  }
  return (
    <>
      <div className="lx-st-modes">
        <Mode on={mode === 'people'} icon={<GUsers size={18} />} title="Specific people" sub="Search by name or employee code and pick as many as you need." onClick={() => pickMode('people')} />
        <Mode on={mode === 'groups'} icon={<GLayers size={18} />} title="Groups and teams" sub={`${groups.slice(0, 4).map(k => KIND_LABEL[k].toLowerCase()).join(', ')} and more.`} onClick={() => pickMode('groups')} />
        <Mode on={mode === 'company'} icon={<GTarget size={18} />} title="Whole company" disabled={!canCompany}
          sub={canCompany ? 'Every active employee, with anyone you leave out.' : ctx.branchOnly ? 'Your access covers your branch only.' : 'Needs organisation-wide Learning rights.'} onClick={() => pickMode('company')} />
        <Mode on={false} icon={<GBook size={18} />} title="From an Excel file" sub="Employee codes and course codes in a sheet, checked before anything is saved." onClick={onExcel} />
      </div>
      {mode === 'people' && <AudienceEditor value={targets} onChange={setTargets} lookups={lookups} kinds={['EMPLOYEE']} exclusions={false} logicHint={false} />}
      {mode === 'groups' && <AudienceEditor value={targets} onChange={setTargets} lookups={lookups} kinds={groups} />}
      {mode === 'company' && <AudienceEditor value={targets} onChange={setTargets} lookups={lookups} kinds={ASSIGN_KINDS.filter(k => !(ctx.branchOnly && k === 'LOCATION'))} allowCompany logicHint={false} />}
      {targets.some(t => !t.exclude) && mode !== 'company' && <div className="lx-st-hint">People named directly are always included. Pick from different group types and people must match all of them.</div>}
    </>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label style={{ display: 'grid', gap: 2, minWidth: 0 }}><span className="lx-st-label">{label}</span>{children}{hint && <span className="lx-st-hint">{hint}</span>}</label>
}

/** The pass marks and completion rule of what is being assigned, from its live version. */
function Passing({ items, courses }: { items: Item[]; courses: any[] }) {
  const picked = items.filter(i => i.course_id).map(i => courses.find(c => c.id === i.course_id)).filter(Boolean).slice(0, 4)
  const details = useLoad<any[]>(() => Promise.all(picked.map(c => lmsApi(`/api/lms/admin/courses/${c.id}${c.live ? `?version=${c.live.id}` : ''}`).catch(() => null))), [picked.map(c => c.id)])
  if (!picked.length) return <div className="lx-st-hint">Paths take their rules from each course in them.</div>
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {picked.map((c, i) => {
        const d = details.data?.[i]
        const v = d?.tree?.version
        const quizzes = (d?.tree?.lessons || []).filter((l: any) => l.quiz_id).map((l: any) => d.tree.quizzes.find((q: any) => q.id === l.quiz_id)).filter(Boolean)
        return (
          <div key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--ez-line)' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
              <div style={{ fontWeight: 700 }}>{c.title}</div>
              {!d ? <Skel h={12} w="60%" style={{ marginTop: 6 }} /> : (
                <div className="lx-st-hint" style={{ marginTop: 3 }}>
                  To finish: {COMPLETION_WORD[v?.completion_mode] || 'Every required lesson'}{v?.completion_mode === 'PERCENT' ? ` (${v.completion_pct}%)` : ''}
                  {v?.min_overall_pct != null ? ` · overall score ${v.min_overall_pct}%` : ''}
                  {quizzes.length ? ` · ${plural(quizzes.length, 'quiz', 'quizzes')}, pass ${[...new Set(quizzes.map((q: any) => `${q.pass_pct}%`))].join(' / ')}` : ' · no quiz'}
                </div>
              )}
            </div>
            <a className="lx-sec-link" {...linkProps(to.studio('courses', c.id))}>Edit rules</a>
          </div>
        )
      })}
    </div>
  )
}

function Rules({ ctx, t, set, items, courses, policy }: { ctx: Ctx; t: Terms; set: (p: Partial<Terms>) => void; items: Item[]; courses: any[]; policy: any }) {
  return (
    <>
      <div>
        <div className="lx-st-label">How it applies</div>
        <div className="lx-st-modes">
          <Mode on={!t.dynamic} icon={<GTarget size={18} />} title="One time" sub="Enrol everyone who matches today." onClick={() => set({ dynamic: false })} />
          <Mode on={t.dynamic} icon={<GRedo size={18} />} title="Keep applying" disabled={!ctx.caps.automate}
            sub={ctx.caps.automate ? 'Also enrols anyone who comes to match later, such as a move into the department.' : 'Needs organisation-wide Learning rights.'} onClick={() => set({ dynamic: true })} />
          {ctx.caps.automate && <a className="lx-st-mode" style={{ textDecoration: 'none' }} {...linkProps(to.studio('automation'))}><span><GUsers size={18} /></span><b>New joiners (onboarding)</b><small>Set up in Automation, with the joining window and per-course due days.</small></a>}
          <a className="lx-st-mode" style={{ textDecoration: 'none' }} {...linkProps(to.studio('preboarding'))}><span><GArrowRight size={18} /></span><b>Before they join</b><small>Candidates get a private link. Set up in Preboarding.</small></a>
        </div>
      </div>
      <div>
        <div className="lx-st-label">Is it required?</div>
        <div className="lx-st-modes">
          <Mode on={t.mandatory} icon={<IconCheck size={18} />} title="Mandatory" sub="Counts in compliance, and people are reminded until it is done." onClick={() => set({ mandatory: true })} />
          <Mode on={!t.mandatory} icon={<GBook size={18} />} title="Optional" sub="Suggested to people, not chased." onClick={() => set({ mandatory: false })} />
        </div>
      </div>
      <div className="lx-st-fields">
        <Field label="Due">
          <select className="lx-select" value={t.dueMode} onChange={e => set({ dueMode: e.target.value })}>
            <option value="NONE">No due date</option><option value="FIXED">On a fixed date</option><option value="AFTER_ASSIGN">Days after assigned</option>
          </select>
        </Field>
        {t.dueMode === 'FIXED' && <Field label="Due date"><input className="lx-input" type="date" min={today()} value={t.dueDate} onChange={e => set({ dueDate: e.target.value })} /></Field>}
        {t.dueMode === 'AFTER_ASSIGN' && <Field label="Days after assigned"><input className="lx-input" type="number" min={0} value={t.dueDays} placeholder="Company default" onChange={e => set({ dueDays: e.target.value })} /></Field>}
        <Field label="Assign on" hint="Blank assigns it now."><input className="lx-input" type="date" min={today()} value={t.startAt} onChange={e => set({ startAt: e.target.value })} /></Field>
        <Field label="Priority">
          <select className="lx-select" value={t.priority} onChange={e => set({ priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option></select>
        </Field>
        <Field label="Remind every (days)" hint="Blank uses the company's reminders."><input className="lx-input" type="number" min={1} value={t.reminder} onChange={e => set({ reminder: e.target.value })} /></Field>
      </div>
      {policy && (
        <div className="lx-note">
          <GRedo size={16} />
          <span>Company reminders: {policy.email_enabled ? 'email is on' : 'email is off'}, {policy.reminder_days_before?.length ? `${policy.reminder_days_before.join(', ')} days before the due date` : 'nothing before the due date'}, then every {policy.overdue_every_days} days once overdue{policy.escalate_after_days ? `, and the manager is told after ${policy.escalate_after_days} days` : ''}.
            {ctx.caps.publish && <> <a className="lx-sec-link" style={{ padding: 0 }} {...linkProps(to.studio('settings'))}>Change in Settings</a></>}</span>
        </div>
      )}
      <Toggle label="Include people who already completed it" hint="Use this for a retake. Off leaves anyone with a valid completion alone." checked={t.retake} onChange={v => set({ retake: v })} />
      <div>
        <div className="lx-st-label">Passing criteria</div>
        <Passing items={items} courses={courses} />
      </div>
      <div className="lx-st-fields">
        <Field label="Name" hint="Blank names it after the first course."><input className="lx-input" data-no-titlecase="" value={t.name} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="Note" hint="For HR's records."><input className="lx-input" data-no-titlecase="" value={t.note} onChange={e => set({ note: e.target.value })} /></Field>
      </div>
    </>
  )
}

function dueWords(t: Terms) {
  if (t.dueMode === 'NONE') return 'No due date'
  if (t.dueMode === 'FIXED') return t.dueDate ? `Due on ${new Date(`${t.dueDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Choose the date'
  return t.dueDays ? `Due ${t.dueDays} days after assigned` : 'Company default due days'
}

function Summary({ ctx, items, targets, t, step }: { ctx: Ctx; items: Item[]; targets: Target[]; t: Terms; step: StepKey }) {
  const inc = targets.filter(x => !x.exclude), exc = targets.filter(x => x.exclude)
  const by = (list: Target[]) => [...new Set(list.map(x => x.kind))].map(k => `${k === 'COMPANY' ? 'Everyone' : KIND_LABEL[k]}${k === 'COMPANY' ? '' : `: ${list.filter(x => x.kind === k).map(x => x.label || x.value).slice(0, 3).join(', ')}${list.filter(x => x.kind === k).length > 3 ? ` +${list.filter(x => x.kind === k).length - 3}` : ''}`}`)
  return (
    <aside className="lx-st-sum">
      <div className="lx-st-sum-head">
        {ctx.company && inc.length ? <AudiencePreviewHead company={ctx.company} targets={targets} trigger={t.dynamic ? 'DYNAMIC' : 'ONCE'} /> : <><b>—</b><span>Choose who it is for to count them</span></>}
      </div>
      <div className="lx-st-sum-body">
        <div className="lx-st-sum-row"><span>Learning</span><div>{items.length ? items.map(i => i.title).join(', ') : 'Nothing chosen yet'}</div></div>
        <div className="lx-st-sum-row"><span>People</span><div>{inc.length ? by(inc).join('; ') : 'Nobody chosen yet'}{exc.length ? <div style={{ color: 'var(--ez-muted)' }}>Leaving out {by(exc).join('; ')}</div> : null}</div></div>
        {(step === 'rules' || step === 'review') && <div className="lx-st-sum-row"><span>Terms</span><div>{t.mandatory ? 'Mandatory' : 'Optional'} · {TRIGGER[t.dynamic ? 'DYNAMIC' : 'ONCE']} · {dueWords(t)}{t.startAt ? ` · from ${t.startAt}` : ''}</div></div>}
      </div>
    </aside>
  )
}

/** The live count, laid out for the summary's header. */
function AudiencePreviewHead(p: { company: string; targets: Target[]; trigger: string }) {
  return <div className="lx-st-sum-count"><AudiencePreview {...p} /></div>
}

export default function AssignWizard({ ctx, onDone, onCancel, onExcel }: { ctx: Ctx; onDone: (note: string) => void; onCancel: () => void; onExcel: () => void }) {
  const data = useAssignData(ctx.company)
  const [step, setStep] = useState<StepKey>('what')
  const [items, setItems] = useState<Item[]>([])
  const [targets, setTargets] = useState<Target[]>([])
  const [mode, setMode] = useState<WhoMode>('people')
  const [t, setT] = useState(START)
  const [policy, setPolicy] = useState<any>(null)
  const a = useAction()
  const set = (p: Partial<Terms>) => setT(x => ({ ...x, ...p }))

  useEffect(() => {
    if (!ctx.company) return
    lmsApi(`/api/lms/admin/settings?company=${ctx.company}`).then(r => setPolicy(r.settings)).catch(() => setPolicy(null))
  }, [ctx.company])

  const courses = useMemo(() => data.data?.courses || [], [data.data])
  if (!ctx.company) return <div className="lx-st-wpanel"><NeedCompany doing="assign learning" /><div><button className="lx-btn" onClick={onCancel}>Back</button></div></div>

  const hasWho = targets.some(x => !x.exclude)
  const blocked: Record<StepKey, string> = {
    what: items.length ? '' : 'Choose at least one course or path.',
    who: hasWho ? '' : 'Choose who it is for.',
    rules: t.dueMode === 'FIXED' && !t.dueDate ? 'Choose the due date.' : '',
    review: '',
  }
  const order: StepKey[] = ['what', 'who', 'rules', 'review']
  const at = order.indexOf(step)
  const reachable = (s: StepKey) => order.slice(0, order.indexOf(s)).every(x => !blocked[x])
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

  const steps: { key: StepKey; label: string; sub: string }[] = [
    { key: 'what', label: 'What', sub: items.length ? plural(items.length, 'item') : 'Courses and paths' },
    { key: 'who', label: 'Who', sub: hasWho ? `${targets.filter(x => !x.exclude).length} chosen` : 'People and groups' },
    { key: 'rules', label: 'Rules', sub: `${t.mandatory ? 'Mandatory' : 'Optional'}, ${t.dueMode === 'NONE' ? 'no due date' : 'with a due date'}` },
    { key: 'review', label: 'Review', sub: 'Check and assign' },
  ]
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <nav className="lx-st-wsteps" aria-label="Assignment steps">
        {steps.map((s, i) => (
          <button key={s.key} className="lx-st-step" aria-current={s.key === step ? 'step' : undefined} disabled={!reachable(s.key)} onClick={() => setStep(s.key)}>
            <em>{i < at ? <IconCheck size={13} /> : i + 1}</em><span><b>{s.label}</b><small>{s.sub}</small></span>
          </button>
        ))}
      </nav>
      <LoadError error={data.error} setup={data.setup} />
      <div className="lx-st-wiz">
        <section className="lx-st-wpanel" key={step}>
          {!data.data && !data.error ? <Skel h={260} r={14} /> : (
            <>
              {step === 'what' && <><h2>What are you assigning?</h2><p>Only published courses and paths can be assigned. Pick as many as you like.</p><What courses={courses} paths={data.data?.paths || []} value={items} onChange={setItems} /></>}
              {step === 'who' && <><h2>Who is it for?</h2><p>Name people, choose groups, or give it to the whole company.</p><Who ctx={ctx} mode={mode} setMode={setMode} targets={targets} setTargets={setTargets} lookups={data.data?.lookups || null} onExcel={onExcel} /></>}
              {step === 'rules' && <><h2>On what terms?</h2><p>Due dates, reminders and whether it counts as mandatory.</p><Rules ctx={ctx} t={t} set={set} items={items} courses={courses} policy={policy} /></>}
              {step === 'review' && (
                <>
                  <h2>Ready to assign</h2>
                  <p>{t.startAt ? 'It will be scheduled for the date you chose.' : 'People are enrolled straight away and see it under My learning. Assigning again never enrols anyone twice.'}</p>
                  <div className="lx-st-picks">
                    {items.map(i => {
                      const c = courses.find(x => x.id === i.course_id)
                      return <PickCard key={key(i)} id={key(i)} on title={i.title} src={c?.thumbnail} path={!!i.path_id} sub={i.path_id ? 'Learning path' : c?.code || 'Course'} onClick={() => setStep('what')} />
                    })}
                  </div>
                  <div className="lx-st-sum-body" style={{ padding: 0 }}>
                    <div className="lx-st-sum-row"><span>Applies</span><div>{TRIGGER[t.dynamic ? 'DYNAMIC' : 'ONCE']}{t.startAt ? `, from ${t.startAt}` : ', from today'}</div></div>
                    <div className="lx-st-sum-row"><span>Terms</span><div>{t.mandatory ? 'Mandatory' : 'Optional'} · {t.priority.toLowerCase()} priority · {dueWords(t)}</div></div>
                    <div className="lx-st-sum-row"><span>Reminders</span><div>{t.reminder ? `Every ${t.reminder} days` : 'The company\'s reminders'}{t.retake ? ' · includes people who already completed it' : ''}</div></div>
                    {(t.name || t.note) && <div className="lx-st-sum-row"><span>Record</span><div>{[t.name, t.note].filter(Boolean).join(' · ')}</div></div>}
                  </div>
                  <ActionNotes a={a} />
                </>
              )}
              <div className="lx-st-wfoot">
                <button className="lx-btn lx-btn--ghost" onClick={at === 0 ? onCancel : () => setStep(order[at - 1])}><GArrowLeft size={15} /> {at === 0 ? 'Cancel' : 'Back'}</button>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {blocked[step] && <span className="lx-st-hint">{blocked[step]}</span>}
                  {step === 'review'
                    ? <button className="lx-btn lx-btn--primary lx-btn--lg" disabled={a.busy} onClick={() => void submit()}>{a.busy ? 'Assigning…' : t.startAt ? 'Schedule' : 'Assign now'}</button>
                    : <button className="lx-btn lx-btn--primary" disabled={!!blocked[step]} onClick={() => setStep(order[at + 1])}>Continue <GArrowRight size={15} /></button>}
                </div>
              </div>
            </>
          )}
        </section>
        <Summary ctx={ctx} items={items} targets={targets} t={t} step={step} />
      </div>
    </div>
  )
}
