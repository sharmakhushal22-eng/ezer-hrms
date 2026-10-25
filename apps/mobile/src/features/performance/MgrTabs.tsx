// src/features/performance/MgrTabs.tsx — the RM side, "My team" (website:
// components/pms/ManagerTabs.tsx §4.1–4.4). READ-ONLY IN ESS, as on the
// website: Performance.tsx passes no onSendBack / onAcknowledge / onRaise and
// a no-op onSubmit, so every action control here stays disabled and Rate My
// Team always asks you to pick somebody (nothing in ESS sets the pick).
import * as React from 'react'
import { View } from 'react-native'
import { teamQueue, teamStats, type TeamMember, type QueueRow } from '@web/pms/team'
import { FLAG_LABEL } from '@web/pms/employment'
import { humanDate, DEFAULT_RULES } from '@web/pms/cycle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet } from '@/ui/overlays'
import { B, Banner, EmptyBlock, Field, K, PCard, Pill, PStat, StatGrid, usePmsLiterals } from './ui'

export const EMPTY_TEAM = 'Nobody reports to you in the org data for this period, or migration 066 has not been applied yet.'

export function FlagPill({ r }: { r: QueueRow }) {
  if (r.flag === 'EXITED') return <Pill kind="orange" label={`${FLAG_LABEL.EXITED}${r.member.dateOfLeaving ? ` · ${humanDate(r.member.dateOfLeaving)}` : ''}`} />
  if (r.flag === 'NOTICE_PERIOD') return <Pill kind="amber" label={`Notice${r.member.dateOfLeaving ? ` · last day ${humanDate(r.member.dateOfLeaving)}` : ''}`} />
  if (r.flag === 'NEW_JOINER') return <Pill kind="blue" label={FLAG_LABEL.NEW_JOINER} />
  return <Pill kind="green" label={FLAG_LABEL.ACTIVE} />
}

export function ExitBanner({ rows }: { rows: QueueRow[] }) {
  const notice = rows.filter(r => r.flag === 'NOTICE_PERIOD').length
  const exited = rows.filter(r => r.flag === 'EXITED').length
  if (!notice && !exited) return null
  return (
    <Banner tone="amber" glyph="🔶">
      {notice > 0 ? <><B>{notice} {notice === 1 ? 'person is' : 'people are'} serving notice</B>: rate them before their last working day, after which the record locks and the rating can never be given.{exited > 0 ? ' ' : ''}</> : null}
      {exited > 0 ? <><B>{exited} {exited === 1 ? 'has' : 'have'} already left</B>: still finalisable, but read-only once done, and the result is emailed before their login closes.</> : null}
    </Banner>
  )
}

/** One queue row as a card (the website's QueueTable row). */
export function QueueCard({ r, children }: { r: QueueRow; children?: React.ReactNode }) {
  const { C } = useTheme()
  const lit = usePmsLiterals()
  const bg = r.tone === 'exit' ? lit.rowExit : r.tone === 'notice' ? lit.rowNotice : C.surface
  const m = r.member
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.sm, backgroundColor: bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: 6 }}>
        <Txt size={F.small} w={600} style={{ flex: 1 }}>{m.name}</Txt>
        <Txt size={F.micro} tone="muted">{m.code}</Txt>
      </View>
      <Field label="Employment"><FlagPill r={r} /></Field>
      <Field label="KRAs">{m.kraCount}</Field>
      <Field label="Wt"><Txt size={F.tiny} w={600} color={m.totalWeightage === DEFAULT_RULES.totalWeightage ? C.positive : C.critical}>{m.totalWeightage}</Txt></Field>
      <Field label="1-on-1">{m.oneToOneDone ? <Pill kind="green" label="✓" /> : <Pill kind="grey" label="not yet" />}</Field>
      <Field label="Self">{m.selfSubmitted ? <Pill kind="green" label="submitted" /> : <Pill kind="amber" label="waiting" />}</Field>
      <Field label="Self score">{m.selfScore === null ? '-' : m.selfScore.toFixed(2)}</Field>
      <View style={{ marginTop: 6 }}>
        <K>{r.next}{r.priorityNote ? <>{'\n'}<B>{r.priorityNote}</B></> : null}</K>
      </View>
      {children}
    </View>
  )
}

export function QueueList({ rows, empty, extra }: { rows: QueueRow[]; empty: string; extra?: (r: QueueRow) => React.ReactNode }) {
  if (rows.length === 0) return <EmptyBlock title="Nobody here yet" note={empty} />
  return <>{rows.map(r => <QueueCard key={r.member.employeeId} r={r}>{extra?.(r)}</QueueCard>)}</>
}

// ── §4.1 Team Dashboard ──────────────────────────────────────────────────
export function TeamTab({ members, today, managerName }: { members: TeamMember[]; today: string; managerName: string }) {
  const rows = teamQueue(members, today)
  const s = teamStats(rows)
  return (
    <>
      <ExitBanner rows={rows} />
      <StatGrid>
        <PStat tone="accent" label="Your rating is owed" value={s.pendingWithMe} note={s.pendingWithMe ? 'Nobody else can do these' : 'Nothing waiting on you'} />
        <PStat label="Team size" value={s.size} />
        <PStat label="Self ratings in" value={`${s.selfSubmitted} of ${s.size}`} note="You cannot rate before they submit" />
        <PStat tone={s.noticePeriod ? 'warn' : undefined} label="Serving notice" value={s.noticePeriod} note={s.noticePeriod ? 'Rate before their last day' : 'None'} />
        <PStat label="Finalised" value={s.finalised} note={`of ${s.size}`} />
      </StatGrid>
      <PCard title={`My team: ${managerName}`} sub="Ordered by whose deadline cannot move, then by what is actually owed.">
        <QueueList rows={rows} empty={EMPTY_TEAM} />
      </PCard>
    </>
  )
}

// ── §4.2 KRA Approval & One-to-One ───────────────────────────────────────
export function ApproveTab({ members, today }: { members: TeamMember[]; today: string }) {
  const [reason, setReason] = React.useState<Record<string, string>>({})
  const rows = teamQueue(members, today).filter(r => !r.member.selfSubmitted || !r.member.oneToOneDone)
  return (
    <>
      <Banner tone="blue" glyph="ℹ️">
        A set is valid at <B>{DEFAULT_RULES.minKra} to {DEFAULT_RULES.maxKra} KRAs totalling exactly {DEFAULT_RULES.totalWeightage}</B>. Weightage locks only once you and they have both acknowledged the KRA one-to-one. One tick is a manager asserting a conversation happened, two is a record.
      </Banner>
      <PCard title="Waiting on the discussion" sub="Sets to check, and the one-to-ones that lock them.">
        <QueueList rows={rows} empty="Every set is settled and locked." extra={r => {
          const valid = r.member.kraCount >= DEFAULT_RULES.minKra && r.member.kraCount <= DEFAULT_RULES.maxKra && r.member.totalWeightage === DEFAULT_RULES.totalWeightage
          return (
            <View style={{ marginTop: S.sm }}>
              {!valid ? (
                <>
                  <Input placeholder="What they need to change" value={reason[r.member.employeeId] ?? ''} style={{ marginBottom: S.sm }}
                    accessibilityLabel={`Reason for sending ${r.member.name}'s KRAs back`}
                    onChangeText={t => setReason(p => ({ ...p, [r.member.employeeId]: t }))} />
                  {/* No onSendBack in ESS: always disabled, as on the website. */}
                  <Button size="sm" variant="ghost" title="Send back" disabled />
                </>
              ) : !r.member.oneToOneDone ? (
                <Button size="sm" title="Acknowledge & lock" disabled />
              ) : <Pill kind="green" label="locked" />}
            </View>
          )
        }} />
        <K style={{ marginTop: 10 }}>Sending a set back needs a reason. “Rejected” on its own means the employee guesses at what to change, and the set comes back wrong a second time.</K>
      </PCard>
    </>
  )
}

// ── §4.3 Rate My Team — `member` is always null in ESS ───────────────────
export function RateTab() {
  return (
    <PCard title="Pick somebody to rate">
      <K>Choose a team member from the dashboard. Their KRAs and their own ratings appear here beside yours.</K>
    </PCard>
  )
}

// ── §4.4 PIP Request — no onRaise in ESS, so the send button stays disabled ──
interface PipArea { area: string; current: string; target: string; measure: string; reviewOn: string }
const blankArea = (): PipArea => ({ area: '', current: '', target: '', measure: '', reviewOn: '' })

export function PipRequestTab({ members, today }: { members: TeamMember[]; today: string }) {
  const { C } = useTheme()
  const rows = teamQueue(members, today)
  const [who, setWho] = React.useState('')
  const [support, setSupport] = React.useState('')
  const [areas, setAreas] = React.useState<PipArea[]>([blankArea()])
  const [pickWho, setPickWho] = React.useState(false)
  const [dateFor, setDateFor] = React.useState<number | null>(null)
  const set = (i: number, patch: Partial<PipArea>) => setAreas(areas.map((a, j) => j === i ? { ...a, ...patch } : a))
  const label = (m: TeamMember) => `${m.name} (${m.code})${m.finalRating !== null ? ` · last rated ${m.finalRating}` : ''}`
  const picked = rows.find(r => r.member.employeeId === who)?.member

  return (
    <>
      <Banner tone="blue" glyph="ℹ️">
        You raise the request; <B>HR decides whether a PIP starts</B>. That is not a formality: the plan is the documentation trail that answers a claim under the Industrial Disputes Act, and HR gatekeeping is what keeps it consistent enough to rely on. HR can adjust your dates, drop an area, send it back, or decline it.
      </Banner>
      <PCard title="Raise a PIP request" sub="Every area needs a measurable target and a way to check it. An area without one cannot be reviewed, and a plan nobody can review protects nobody.">
        <PickerField label="Who" value={picked ? label(picked) : ''} placeholder="Choose a team member" onPress={() => setPickWho(true)} />
        <Input label="Support you are offering" value={support} onChangeText={setSupport} placeholder="Training, mentoring, a change of workload" />
        {areas.map((a, i) => (
          <View key={i} style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.md }}>
            <Txt size={F.small} w={700} style={{ marginBottom: S.sm }}>#{i + 1}</Txt>
            <Input label="Improvement area" value={a.area} accessibilityLabel={`Area ${i + 1}`} onChangeText={t => set(i, { area: t })} />
            <Input label="Where they are" value={a.current} placeholder="0.6% error rate" onChangeText={t => set(i, { current: t })} />
            <Input label="Target" value={a.target} placeholder="under 0.2%" onChangeText={t => set(i, { target: t })} />
            <Input label="How it is measured" value={a.measure} placeholder="monthly run audit" onChangeText={t => set(i, { measure: t })} />
            <PickerField label="Review on" value={a.reviewOn ? humanDate(a.reviewOn) : ''} placeholder="Pick a date" onPress={() => setDateFor(i)} style={{ marginBottom: 0 }} />
          </View>
        ))}
        <View style={{ gap: S.sm }}>
          <Button size="sm" variant="ghost" title="+ Add an area" onPress={() => setAreas([...areas, blankArea()])} />
          <Button full title="Send the request to HR" disabled />
        </View>
      </PCard>
      <SelectSheet visible={pickWho} onClose={() => setPickWho(false)} title="Who" value={who}
        options={[{ value: '', label: 'Choose a team member' }, ...rows.map(r => ({ value: r.member.employeeId, label: label(r.member) }))]}
        onPick={v => setWho(String(v))} />
      <DateSheet visible={dateFor !== null} onClose={() => setDateFor(null)} value={dateFor !== null ? areas[dateFor]?.reviewOn || null : null}
        onPick={d => { if (dateFor !== null) set(dateFor, { reviewOn: d }) }} title="Review on" />
    </>
  )
}
