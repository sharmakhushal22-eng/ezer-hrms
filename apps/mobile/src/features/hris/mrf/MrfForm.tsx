// MrfForm — components/ess/MrfForm.tsx as a multi-step phone form.
//
// Same wizard as the website: one section at a time, "Step i of n", "{done} of
// {required} required done", steps reachable only up to the furthest seen, Next
// refused with the gate's own message (beside the button and as a toast), Save
// Draft on every step, Submit for Approval on the last. Quick Hire drops §7 and
// §9. The gates are save()'s own guards, moved earlier — no new requirement.
// Read-only review mode (focus mode on the web) is not reachable from Tasks &
// Approvals, so it is not ported.
import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api, currentToken } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { IconLock } from '@/ui/icons'
import { errMsg, LoadingLine } from '../ui'
import { buildPayload, compOf, EMPTY, insertSkill, loadRefs, QUICK_HIRE_CAP, reserveMrfNumber, type Form, type Refs } from './model'
import {
  LaneToggle, StepApproval, StepAttachments, StepBudget, StepCandidate, StepEmployment, StepJustification, StepMeta,
  StepPosition, StepSourcing, StepTimeline, type StepProps,
} from './steps'

const NO_DEPT = 'Your employee record has no department, and the MRF takes it from there. Ask HR to set your department first.'

const STEP_VIEW: Record<string, (p: StepProps) => React.ReactElement> = {
  meta: StepMeta, pos: StepPosition, emp: StepEmployment, budget: StepBudget, just: StepJustification,
  time: StepTimeline, cand: StepCandidate, appr: StepApproval, src: StepSourcing, att: StepAttachments,
}

function SuccessPanel({ done, onAnother, onResubmit, onDone }: { done: { id: string; mrf_number?: string; confidential?: boolean }; onAnother: () => void; onResubmit: () => void; onDone: () => void }) {
  const { C } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: C.positiveEdge, borderRadius: 20, padding: S.xl, backgroundColor: C.positiveTint, alignItems: 'center' }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.positive, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
        <Txt size={34} w={700} color={C.onAccent}>✓</Txt>
      </View>
      <Txt size={18} w={700} center>{done.confidential ? 'Confidential MRF raised and approved' : 'You have successfully raised the MRF'}</Txt>
      {!!done.mrf_number && (
        <View style={{ marginTop: 8, paddingHorizontal: 14, paddingVertical: 4, borderRadius: R.pill, backgroundColor: C.brandTint }}>
          <Txt size={F.small} w={700} color={C.brandDeep}>Requisition ID: {done.mrf_number}</Txt>
        </View>
      )}
      <Txt size={F.small} tone="muted" center style={{ marginTop: 6, lineHeight: 20 }}>
        {done.confidential
          ? <>It is <Txt size={F.small} w={700} tone="muted">approved already</Txt> — no approval chain, and nobody has been notified. Only you and the HR Manager can see it; add the candidate from Recruitment → Pipeline.</>
          : 'It’s been sent for approval through your reporting chain (RM2 → HR Head).'}
        {' '}You can raise another, or resubmit this one if you spotted a mistake (the one you just submitted will be scrapped).
      </Txt>
      <View style={{ alignSelf: 'stretch', gap: S.sm, marginTop: 20 }}>
        <Button title="＋ Raise one more MRF" onPress={onAnother} full />
        <Button title="↺ Resubmit (fix this one)" variant="outline" onPress={onResubmit} full />
        <Button title="Done" variant="outline" onPress={onDone} full />
      </View>
    </View>
  )
}

export default function MrfForm({ employeeId, onDone, onCancel, initial, replaceId, onShowTop }: {
  employeeId: string; onDone: () => void; onCancel: () => void; initial?: Form | null; replaceId?: string | null
  /** Bring the form's top (the stepper) into view — the host owns the scroll view. */
  onShowTop?: () => void
}) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const [form, setForm] = React.useState<Form>({ ...EMPTY, ...(initial || {}) })
  const [done, setDone] = React.useState<null | { id: string; mrf_number?: string; confidential?: boolean }>(null)
  const [replaceRef, setReplaceRef] = React.useState<string | null>(replaceId || null)
  const [saving, setSaving] = React.useState(false)
  const [extraSkills, setExtraSkills] = React.useState<string[]>([])
  const [stepIdx, setStepIdx] = React.useState(0)
  const [maxSeen, setMaxSeen] = React.useState(0)
  const scroller = React.useRef<ScrollView>(null)

  const rq = useQuery({ queryKey: ['approvals', 'mrf-refs', employeeId], queryFn: () => loadRefs(employeeId), enabled: !!employeeId, staleTime: 5 * 60_000 })
  const refs: Refs | null = rq.data ? { ...rq.data, skills: [...new Set([...rq.data.skills, ...extraSkills])].sort((a, b) => a.localeCompare(b)) } : null

  const set = React.useCallback((k: string, v: any) => setForm(f => ({ ...f, [k]: v })), [])
  const reserve = React.useCallback(() => { void reserveMrfNumber().then(n => { if (n) setForm(f => ({ ...f, mrf_number: n })) }) }, [])
  React.useEffect(() => { if (!(initial as any)?.mrf_number) reserve() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Pre-fill "Raised By" from the bundle once it lands, keeping anything already typed
  // (adjusting state during render, React's recommended alternative to an effect).
  const [prefilled, setPrefilled] = React.useState<Refs | null>(null)
  if (rq.data && prefilled !== rq.data) {
    const a = rq.data.auto
    setPrefilled(rq.data)
    setForm(f => ({ ...f, raised_by_name: f.raised_by_name || a.name, raised_by_role: f.raised_by_role || a.role }))
  }

  const addSkill = (name: string) => {
    const n = name.trim(); if (!n) return
    setExtraSkills(s => (s.some(x => x.toLowerCase() === n.toLowerCase()) ? s : [...s, n]))
    void insertSkill(n)
  }

  const isQuick = form.mrf_type === 'Quick Hire'
  const isReplacement = form.hiring_type === 'Replacement' || form.hiring_type === 'Backfill'
  const comp = compOf(form.employment_type)
  const annualMax = (Number(form.budget_max) || 0) * (comp.period === 'MONTHLY' ? 12 : 1)
  const laneShouldBe = annualMax > QUICK_HIRE_CAP ? 'Full MRF' : 'Quick Hire'
  const laneMismatch = !!form.budget_max && laneShouldBe !== form.mrf_type

  const STEPS: { id: string; title: string; required?: boolean; gate?: () => string | null }[] = [
    { id: 'meta', title: 'Requisition Meta' },
    // The offer letter states the designation, department and work location
    // (lib/recruitment/position-required.ts), so none of them may be left blank.
    { id: 'pos', title: 'Position Details', required: true, gate: () => !String(form.designation || '').trim() ? 'Designation is required.'
      : !refs?.auto.department_id ? NO_DEPT : null },
    { id: 'emp', title: 'Employment Details', required: true, gate: () => form.location_id ? null : 'Work location is required.' },
    { id: 'budget', title: 'Budget & Cost', gate: () => {
      const lo = Number(form.budget_min) || 0, hi = Number(form.budget_max) || 0
      return lo && hi && lo > hi ? `${comp.label} range minimum cannot be more than the maximum.` : null
    } },
    { id: 'just', title: 'Justification', required: true, gate: () => !form.reason ? 'Reason for hire is required.'
      : (isReplacement && !form.outgoing_employee_id) ? 'Pick the outgoing employee for a replacement.' : null },
    { id: 'time', title: 'Timeline', required: true, gate: () => form.target_joining_date ? null : 'Target joining date is required.' },
    ...(!isQuick ? [{ id: 'cand', title: 'Candidate Requirements', required: true,
      gate: () => (String(form.skills_required || '').trim() || String(form.job_description || '').trim()) ? null : 'Add mandatory skills or a job description.' }] : []),
    { id: 'appr', title: 'Approval Workflow' },
    ...(!isQuick ? [{ id: 'src', title: 'Sourcing' }] : []),
    { id: 'att', title: 'Attachments' },
  ]
  const step = Math.min(stepIdx, STEPS.length - 1)
  const activeId = STEPS[step].id
  const blocked = STEPS[step].gate?.() ?? null
  const requiredTotal = STEPS.filter(s => s.required).length
  const requiredDone = STEPS.filter(s => s.required && !s.gate!()).length
  const goTo = (i: number) => { setStepIdx(i); scroller.current?.scrollTo({ x: Math.max(0, i * 120 - 60), animated: true }); onShowTop?.() }
  const goNext = () => {
    if (blocked) { notify(blocked, 'error'); return }
    const n = Math.min(step + 1, STEPS.length - 1)
    goTo(n); setMaxSeen(m => Math.max(m, n))
  }

  async function save(status: 'DRAFT' | 'SUBMITTED') {
    const designation = String(form.designation || '').trim()
    if (!designation) { notify('Designation is required.', 'error'); return }
    const bMin = Number(form.budget_min) || 0, bMax = Number(form.budget_max) || 0
    if (bMin && bMax && bMin > bMax) { notify(`${comp.label} range minimum (₹${bMin.toLocaleString('en-IN')}) cannot be more than the maximum (₹${bMax.toLocaleString('en-IN')}).`, 'error'); return }
    if (status === 'SUBMITTED') {
      if (!refs?.auto.department_id) { notify(NO_DEPT, 'error'); return }
      if (!form.location_id) { notify('Work location is required to submit.', 'error'); return }
      if (!form.reason) { notify('Reason for hire is required to submit.', 'error'); return }
      if (!form.target_joining_date) { notify('Target joining date is required to submit.', 'error'); return }
      if (!isQuick && !String(form.skills_required || '').trim() && !String(form.job_description || '').trim()) { notify('Add mandatory skills or a job description to submit a Full MRF.', 'error'); return }
      if (isReplacement && !form.outgoing_employee_id) { notify('Pick the outgoing employee for a replacement.', 'error'); return }
    }
    // lib/ess-session-client essSessionExpired(): say so before the round trip, answers kept.
    if (!currentToken()) { notify('Your ESS session has expired. Sign in again in another tab, then press save — your answers are kept.', 'error'); return }
    setSaving(true)
    try {
      const payload = buildPayload(form, status, { replaceRef, canConfidential: !!refs?.canConfidential, hodId: refs?.auto.hod_id || null })
      const res = await api<{ id?: string; mrf_number?: string; confidential?: boolean }>('/api/ess/mrf', { method: 'POST', body: payload, employeeId })
      if (status === 'DRAFT') { notify('MRF saved as draft.'); onDone(); return }
      setReplaceRef(null)
      setDone({ id: res?.id || '', mrf_number: res?.mrf_number || form.mrf_number || '', confidential: !!res?.confidential })
    } catch (e) { notify(errMsg(e), 'error') } finally { setSaving(false) }
  }

  function raiseAnother() {
    setForm({ ...EMPTY, raised_by_name: refs?.auto.name || '', raised_by_role: refs?.auto.role || '' })
    setReplaceRef(null); setDone(null); setStepIdx(0); setMaxSeen(0)
    reserve(); onShowTop?.()
  }
  function resubmit() {
    setReplaceRef(done?.id || null); setDone(null)
    goTo(0); setMaxSeen(STEPS.length - 1)   // every step was filled already — all reachable
  }

  if (rq.error) return <Txt size={F.small} tone="critical">{errMsg(rq.error)}</Txt>
  if (!refs) return <LoadingLine label="Loading form…" />
  if (done) return <SuccessPanel done={done} onAnother={raiseAnother} onResubmit={resubmit} onDone={onDone} />

  const View_ = STEP_VIEW[activeId]
  return (
    <View>
      {replaceRef && (
        <View style={{ backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warningEdge, borderRadius: 11, padding: 12, marginBottom: 12 }}>
          <Txt size={12.5} tone="warning"><Txt size={12.5} w={700} tone="warning">Editing / resubmitting.</Txt> When you submit, the previous requisition is scrapped and this corrected one goes for approval afresh.</Txt>
        </View>
      )}
      <LaneToggle value={form.mrf_type} onChange={v => set('mrf_type', v)} />
      {laneMismatch && (
        <View style={{ backgroundColor: C.criticalTint, borderWidth: 1, borderColor: C.criticalEdge, borderRadius: 11, padding: 10, marginTop: 10, gap: 8 }}>
          <Txt size={12.5} tone="critical">This budget suits <Txt size={12.5} w={700} tone="critical">{laneShouldBe}</Txt>.</Txt>
          <Button title={`Switch to ${laneShouldBe}`} variant="outline" size="sm" onPress={() => set('mrf_type', laneShouldBe)} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 }}>
        <Txt size={12.5} w={600} tone="soft">Step {step + 1} of {STEPS.length}</Txt>
        <Txt size={F.tiny} tone="muted">{requiredDone} of {requiredTotal} required done</Txt>
      </View>
      <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }} style={{ marginBottom: 14 }}>
        {STEPS.map((s, i) => {
          const cleared = i < maxSeen && !(s.gate?.() ?? null)
          const reachable = i <= maxSeen
          const now = i === step
          return (
            <Button key={s.id} size="sm" title={`${cleared && !now ? '✓' : i + 1}  ${s.title}`} variant={now ? 'primary' : cleared ? 'soft' : 'outline'}
              disabled={!reachable} onPress={() => { if (reachable) goTo(i) }} />
          )
        })}
      </ScrollView>

      <View_ form={form} set={set} refs={refs} addSkill={addSkill} />

      <View style={{ marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line, gap: S.sm }}>
        {blocked && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill, backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warningEdge }}>
            <IconLock size={13} color={C.warning} /><Txt size={F.tiny} w={600} tone="warning">{blocked}</Txt>
          </View>
        )}
        {step < STEPS.length - 1 && (
          <Button title={`Next · ${STEPS[step + 1].title} →`} disabled={saving} onPress={goNext} full style={blocked ? { opacity: 0.55 } : undefined} />
        )}
        {step === STEPS.length - 1 && (
          <Button title={saving ? 'Submitting…' : 'Submit for Approval'} disabled={saving} onPress={() => void save('SUBMITTED')} full />
        )}
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <Button title="← Back" variant="outline" disabled={saving || step === 0} onPress={() => goTo(step - 1)} style={{ flex: 1 }} />
          <Button title="Save Draft" variant="outline" disabled={saving} onPress={() => void save('DRAFT')} style={{ flex: 1 }} />
        </View>
        <Button title="Cancel" variant="ghost" disabled={saving} onPress={onCancel} full />
      </View>
    </View>
  )
}
