// Exit Process — components/ess/hris/ExitProcess.tsx.
//
// GET / POST /api/ess/resignation exactly as the website: the reasons list and
// the notice period come from the API, the two-step confirm, the withdraw gate
// (status not RECOVERY_PENDING / SETTLED, and submitted by the employee) and the
// stage machine — which lives in migration 071's fn_resignation_* and is
// enforced there.
//
// The chain is L1, then HR (migration 208); L2 / HOD show only on an older resignation
// where they had already acted. The timeline looks a stage's log row up by 'RM_L1'…
// (as the website now does) and names its approver (who acted, else
// `approvers[RM_L1|…]` from the API, else "nobody assigned yet").
// Submitting takes the employee's tentative last working day (tentative_lwd, migration
// 207; @web/exit/lwd tentativeProblem is the server's own rule), defaulting to the policy
// date: resignation + notice period.
// Under the form / the open resignation: clearance & settlement (exit/MyExitDocuments).
// Exiting somebody else is People → Employees → HR Actions on the website (admin side).
// Changed on purpose: the default "Date of resignation" is today in the phone's
// local time; the website's toISOString() gives yesterday before 05:30 IST.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Card, Input, PickerField, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { DateSheet, fmtDay, SelectSheet, useOverlay, ymd } from '@/ui/overlays'
import { Ic } from './icons'
import { errMsg, fmtDate, fmtDateTime, KpiGrid, LoadingLine, NoteBox, SolidButton } from './ui'
import { MyExitDocuments } from './exit/MyExitDocuments'
import { tentativeProblem } from '@web/exit/lwd'

type Person = { full_name?: string | null; emp_code?: string | null; designation?: string | null }
interface ChainRow { stage: string; action: string; approver?: Person | null; actioned_at: string; note?: string | null; proposed_lwd?: string | null }
interface StageApprover { id: string; full_name: string; emp_code: string | null; designation: string | null }
interface ResignationRecord {
  id: string; status: string; submitted_at?: string | null; created_at?: string | null; notice_period_days?: number | null
  lwd_as_per_policy?: string | null; proposed_lwd?: string | null; final_lwd?: string | null; reason_code?: string | null
  /** The date the employee proposed when resigning, and the notice HR waived (migration 207). */
  tentative_lwd?: string | null; notice_waived_days?: number | null; notice_waiver_reason?: string | null
  exit_reason_master?: { label?: string | null } | null; submitted_by_employee?: boolean | null
}
interface ResignationState {
  current: ResignationRecord | null; chain: ChainRow[]; reasons: { code: string; label: string }[]; notice_period_days: number | null
  /** Who each stage goes to (RM_L1 / RM_L2 / HOD / HR_MANAGER), resolved from the record; null = stage skipped. */
  approvers?: Record<string, StageApprover | null>
  on_probation?: boolean
}

const STAGE_LABEL: Record<string, string> = {
  INITIATED: 'Initiated by HR',
  PENDING_RM_L1: 'With your reporting manager',
  PENDING_RM_L2: 'With your L2 manager',
  PENDING_HOD: 'With your head of department',
  PENDING_HR_MANAGER: 'With HR: final last working day',
  RETENTION_HOLD: 'On hold: your manager wants to talk',
  RECOVERY_PENDING: 'Accepted: notice recovery pending',
  SETTLED: 'Settled',
  WITHDRAWN: 'Withdrawn',
}
/** The stages the timeline walks, in order: L1, then HR (migration 208). L2 / HOD appear only on
 *  an older resignation where they had already acted. */
const STAGE_ORDER = ['PENDING_RM_L1', 'PENDING_HR_MANAGER']
const ALL_STAGES = ['PENDING_RM_L1', 'PENDING_RM_L2', 'PENDING_HOD', 'PENDING_HR_MANAGER']
const CLOSED = ['SETTLED', 'WITHDRAWN']

/** "Aditya Iyer · STC9054 · Assistant Manager" */
const who = (p?: Person | null) => p?.full_name ? [p.full_name, p.emp_code, p.designation].filter(Boolean).join(' · ') : ''

function Timeline({ status, chain, approvers }: { status: string; chain: ChainRow[]; approvers: Record<string, StageApprover | null> }) {
  const { C } = useTheme()
  const byStage: Record<string, ChainRow> = {}
  // The last row per stage (STAMPED first, then the decision); the decision wins.
  for (const c of chain) if (!byStage[c.stage] || c.action !== 'STAMPED') byStage[c.stage] = c
  const logOf = (stg: string) => byStage[stg.replace('PENDING_', '')] || byStage[stg]
  const stages = ALL_STAGES.filter(st => STAGE_ORDER.includes(st) || st === status
    || (byStage[st.replace('PENDING_', '')] && !['SKIPPED', 'STAMPED'].includes(byStage[st.replace('PENDING_', '')].action)))
  const curIdx = stages.indexOf(status)
  const hold = status === 'RETENTION_HOLD'
  const nodes: { key: string; cls: string; st: string; who: string | null; act: string; when: string; note: string | null | undefined }[] = stages.map((stg, i) => {
    const c = logOf(stg)
    const key = stg.replace('PENDING_', '')
    const decided = !!c && c.action !== 'STAMPED'
    const skipped = c?.action === 'SKIPPED'
    const cls = hold ? (decided ? 'done' : '') : i < curIdx ? 'done' : i === curIdx ? 'cur' : ''
    // Who this stage is with: the person who acted, else the one it is stamped to / resolves to.
    const person = c?.approver?.full_name ? c.approver : approvers[key]
    const act = skipped
      ? `skipped${c?.note ? ` · ${c.note.toLowerCase()}` : ''}`
      : decided
        ? `${c.action.toLowerCase().replace(/_/g, ' ')}${c.proposed_lwd ? ` · LWD ${fmtDate(c.proposed_lwd)}` : ''}`
        : (i === curIdx && !hold ? 'pending acknowledgement' : 'upcoming')
    const when = decided ? fmtDateTime(c.actioned_at) : (i === curIdx && !hold ? 'waiting now' : '')
    return { key: stg, cls, st: STAGE_LABEL[stg], who: skipped ? null : (who(person) || 'nobody assigned yet'), act, when, note: decided && !skipped ? c.note : null }
  })
  if (hold) nodes.push({ key: 'hold', cls: 'cur', st: STAGE_LABEL.RETENTION_HOLD, who: null, act: 'chain paused: your manager wants to talk', when: '', note: null })
  return (
    <View>
      {nodes.map((n, i) => {
        const dot = n.cls === 'done' ? C.positive : n.cls === 'cur' ? C.brand : C.lineStrong
        return (
          <View key={n.key} style={{ flexDirection: 'row', gap: S.md }}>
            <View style={{ alignItems: 'center', width: 22 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: dot, backgroundColor: n.cls === 'done' ? C.positive : n.cls === 'cur' ? C.brandTint : C.surface, alignItems: 'center', justifyContent: 'center' }}>
                {n.cls === 'done' && <Ic k="check" size={12} color={C.onAccent} sw={2.2} />}
              </View>
              {i < nodes.length - 1 && <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: C.line }} />}
            </View>
            <View style={{ flex: 1, paddingBottom: S.md }}>
              <Txt size={F.small} w={700} color={n.cls === 'cur' ? C.brandDeep : C.ink}>{n.st}</Txt>
              {!!n.who && <Txt size={F.tiny} w={600}>{n.who}</Txt>}
              <Txt size={F.tiny} tone="muted">{n.act}</Txt>
              {!!n.when && <Txt size={11} tone="faint">{n.when}</Txt>}
              {!!n.note && <Txt size={F.tiny} tone="soft">“{n.note}”</Txt>}
            </View>
          </View>
        )
      })}
    </View>
  )
}

export default function ExitScreen() {
  const { C } = useTheme()
  const employeeId = useEmployeeId()
  const { notify, confirm: ask } = useOverlay()
  const q = useQuery({
    queryKey: ['hris', 'resignation', employeeId],
    queryFn: () => api<ResignationState>('/api/ess/resignation', { employeeId }),
    enabled: !!employeeId,
  })
  const [reason, setReason] = React.useState('')
  const [date, setDate] = React.useState(() => ymd(new Date()))
  const [remarks, setRemarks] = React.useState('')
  // The employee's proposed last working day: starts at the policy date (resignation + notice).
  const [tentative, setTentative] = React.useState('')
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [sheet, setSheet] = React.useState<'reason' | 'date' | 'lwd' | null>(null)

  const refresh = () => invalidate('hris', 'today', 'notifications')

  const noticeDays = Number(q.data?.notice_period_days) || 0
  const policyLwd = (() => { const t = new Date(`${date}T00:00:00Z`); if (isNaN(t.getTime())) return ''; t.setUTCDate(t.getUTCDate() + noticeDays); return t.toISOString().slice(0, 10) })()
  const tentativeLwd = tentative || policyLwd
  const tentativeBad = tentativeLwd ? (tentativeProblem(tentativeLwd, date) ? 'It cannot be before the date of resignation.' : '') : 'Enter your tentative last working day.'

  async function submit() {
    setBusy(true)
    try {
      await api('/api/ess/resignation', { method: 'POST', body: { reason_code: reason, date, remarks, tentative_lwd: tentativeLwd }, employeeId })
      notify('Resignation submitted'); setConfirming(false); void refresh()
    } catch (e) { notify(errMsg(e), 'error') } finally { setBusy(false) }
  }
  async function withdraw(id: string) {
    if (!(await ask({ title: 'Withdraw your resignation? This closes the chain.', confirm: 'Withdraw', destructive: true }))) return
    setBusy(true)
    try {
      await api('/api/ess/resignation', { method: 'POST', body: { action: 'WITHDRAW', id }, employeeId })
      notify('Resignation withdrawn'); void refresh()
    } catch (e) { notify(errMsg(e), 'error') } finally { setBusy(false) }
  }

  const d = q.data
  let body: React.ReactNode
  if (q.error) body = <NoteBox tone="d">{errMsg(q.error)}</NoteBox>
  else if (!d) body = <LoadingLine />
  else {
    const cur = d.current
    const open = !!cur && !CLOSED.includes(cur.status)
    if (open && cur) {
      const lwd = cur.final_lwd || cur.proposed_lwd || cur.lwd_as_per_policy
      const lwdNote = cur.final_lwd ? 'confirmed by HR' : cur.proposed_lwd ? 'proposed by your manager' : 'as per policy'
      const canWithdraw = !['RECOVERY_PENDING', 'SETTLED'].includes(cur.status) && !!cur.submitted_by_employee
      const kpis = [
        { k: 'Status', v: STAGE_LABEL[cur.status] || cur.status, tone: cur.status === 'RETENTION_HOLD' ? 'warn' as const : '' as const },
        { k: 'Submitted', v: fmtDate(cur.submitted_at || cur.created_at) },
        { k: 'Notice period', v: `${cur.notice_period_days ?? '-'} days`, note: Number(cur.notice_waived_days) > 0 ? `${cur.notice_waived_days} days waived by HR` : undefined },
        ...(cur.tentative_lwd ? [{ k: 'Your tentative LWD', v: fmtDate(cur.tentative_lwd), note: 'what you proposed' }] : []),
        { k: 'Last working day', v: lwd ? fmtDate(lwd) : '-', note: lwdNote },
      ].map(k => ({ ...k, small: String(k.v).length > 10 }) as { k: string; v: string; tone?: 'warn' | ''; note?: string; small: boolean })
      body = (
        <>
          <KpiGrid items={kpis} />
          <Card>
            <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>Your resignation</Txt>
            <Txt size={12.5} tone="muted" style={{ marginBottom: 14 }}>Reason: <Txt size={12.5} w={700}>{cur.exit_reason_master?.label || cur.reason_code || '-'}</Txt></Txt>
            <Txt size={12.5} w={700} style={{ marginBottom: 10 }}>Approval chain</Txt>
            <Timeline status={cur.status} chain={d.chain || []} approvers={d.approvers || {}} />
            {canWithdraw && <Button title="Withdraw resignation" variant="danger" disabled={busy} onPress={() => void withdraw(cur.id)} style={{ marginTop: S.sm }} full />}
            <NoteBox style={{ marginTop: 14 }}>Retention pauses the chain; only you can withdraw it. Your last working day becomes final at the HR stage.</NoteBox>
          </Card>
          <MyExitDocuments employeeId={employeeId} resignationId={cur.id} />
        </>
      )
    } else {
      const reasonLabel = (d.reasons || []).find(r => r.code === reason)?.label
      body = (
        <>
        {/* A settled exit keeps its F&F statement and letters downloadable (12 months, spec §11.2). */}
        {cur?.status === 'SETTLED' && <View style={{ marginBottom: S.md }}><MyExitDocuments employeeId={employeeId} resignationId={cur.id} /></View>}
        <Card>
          <Txt size={F.lead} w={700} style={{ marginBottom: S.md }}>Resign</Txt>
          {cur && <NoteBox style={{ marginBottom: 12 }}>{`Your previous resignation is ${(STAGE_LABEL[cur.status] || cur.status).toLowerCase()}.`}</NoteBox>}
          <PickerField label="Reason" value={reasonLabel} placeholder="Select…" onPress={() => setSheet('reason')} />
          <PickerField label="Date of resignation" value={date ? fmtDay(date) : ''} placeholder="Pick a date" onPress={() => setSheet('date')} />
          <PickerField label="Tentative last working day *" value={tentativeLwd ? fmtDay(tentativeLwd) : ''} placeholder="Pick a date" onPress={() => setSheet('lwd')} />
          <Txt size={F.tiny} color={tentativeBad ? C.critical : C.muted} style={{ marginTop: -6, marginBottom: 12, lineHeight: 17 }}>
            {tentativeBad || (policyLwd && tentativeLwd !== policyLwd
              ? `As per your notice period it would be ${fmtDate(policyLwd)}. ${tentativeLwd < policyLwd ? 'An earlier date may mean notice recovery, unless HR waives it.' : ''}`
              : 'As per your notice period. Your approvers see it and confirm their own date.')}
          </Txt>
          <Input label="Anything you want to say (optional)" value={remarks} onChangeText={setRemarks} multiline placeholder="Share context for your manager and HR…" />
          <NoteBox tone="w">
            <Txt size={F.tiny} tone="warning" style={{ lineHeight: 19 }}>
              Your notice period: <Txt size={F.tiny} w={700} tone="warning">{d.notice_period_days ?? '-'} days</Txt>{d.on_probation ? ' (on probation)' : ' (confirmed)'}. Submitting starts the approval chain: your reporting manager approves it with a last working day (seeing your tentative date), then HR sets the final last working day.
            </Txt>
          </NoteBox>
          <View style={{ gap: S.sm, marginTop: 14 }}>
            {!confirming ? (
              <Button title="Submit resignation" disabled={!reason || !!tentativeBad} onPress={() => setConfirming(true)} full />
            ) : (
              <>
                <SolidButton title="Yes, submit" tone="critical" loading={busy} disabled={busy} onPress={() => void submit()} full />
                <Button title="Not now" variant="outline" onPress={() => setConfirming(false)} full />
              </>
            )}
          </View>
          <SelectSheet visible={sheet === 'reason'} onClose={() => setSheet(null)} title="Reason" value={reason}
            options={(d.reasons || []).map(r => ({ value: r.code, label: r.label }))}
            onPick={v => { setReason(String(v)); setConfirming(false) }} />
          <DateSheet visible={sheet === 'date'} onClose={() => setSheet(null)} value={date} onPick={v => { setDate(v); setConfirming(false) }} title="Date of resignation" />
          <DateSheet visible={sheet === 'lwd'} onClose={() => setSheet(null)} value={tentativeLwd} min={date} onPick={v => { setTentative(v); setConfirming(false) }} title="Tentative last working day" />
        </Card>
        </>
      )
    }
  }

  return <Screen title="Exit Process" subtitle="HR Services" onRefresh={() => q.refetch()}>{body}</Screen>
}
