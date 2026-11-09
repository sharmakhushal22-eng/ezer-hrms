// src/features/performance/MgrTabs.tsx — the RM side, "My team" (website:
// components/pms/ManagerTabs.tsx §4.1, §4.2 with ChainApprovals and the
// grouped discussion queue, §4.4). Approving now happens in the review panel
// (KraPanel.tsx): the card here opens it, and sends back with a reason. PIP
// still has no onRaise in ESS, so its send button stays disabled as on the
// website. Team Ratings (read-only) is RateTab.tsx.
import * as React from 'react'
import { View } from 'react-native'
import { teamQueue, teamStats, type TeamMember, type QueueRow } from '@web/pms/team'
import { FLAG_LABEL, type FlagRules } from '@web/pms/employment'
import { humanDate, DEFAULT_RULES, type Rules } from '@web/pms/cycle'
import { approvalFinalises, heldBy, mayReject, MIN_REMARK, nextRung, rejectDestination, remarkOk, rungFor, rungs, STAGE_SHORT, type Stage } from '@web/pms/chain'
import type { Chain } from '@web/pms/hierarchy'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet } from '@/ui/overlays'
import { Ava, B, Banner, EmptyBlock, Field, K, PCard, Pill, PStat, StatGrid, usePmsLiterals } from './ui'
import { groupQueue } from './logic'

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

/** One queue row as a card (the website's QueueTable row). `grouped` drops "what is owed": the group heading said it. */
export function QueueCard({ r, children, rules = DEFAULT_RULES, grouped }: { r: QueueRow; children?: React.ReactNode; rules?: Rules; grouped?: boolean }) {
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
      {grouped && !!r.priorityNote && <Txt size={F.micro} w={600} tone="warning" style={{ marginBottom: 4 }}>{r.priorityNote}</Txt>}
      <Field label="Employment"><FlagPill r={r} /></Field>
      <Field label="KRAs">{m.kraCount}</Field>
      <Field label="Wt"><Txt size={F.tiny} w={600} color={m.totalWeightage === rules.totalWeightage ? C.positive : C.critical}>{m.totalWeightage}</Txt></Field>
      <Field label="1-on-1">{m.oneToOneDone ? <Pill kind="green" label="✓" /> : <Pill kind="grey" label="not yet" />}</Field>
      <Field label="Self">{m.selfSubmitted ? <Pill kind="green" label="submitted" /> : <Pill kind="amber" label="waiting" />}</Field>
      <Field label="Self score">{m.selfScore === null ? '-' : m.selfScore.toFixed(2)}</Field>
      {!grouped && (
        <View style={{ marginTop: 6 }}>
          <K>{r.next}{r.priorityNote ? <>{'\n'}<B>{r.priorityNote}</B></> : null}</K>
        </View>
      )}
      {children}
    </View>
  )
}

export function QueueList({ rows, empty, extra, rules }: { rows: QueueRow[]; empty: string; extra?: (r: QueueRow) => React.ReactNode; rules?: Rules }) {
  if (rows.length === 0) return <EmptyBlock title="Nobody here yet" note={empty} />
  return <>{rows.map(r => <QueueCard key={r.member.employeeId} r={r} rules={rules}>{extra?.(r)}</QueueCard>)}</>
}

/** Rows stuck on the same thing, said once (ManagerTabs.tsx GroupedQueue). */
function GroupedQueue({ rows, rules, empty, extra }: { rows: QueueRow[]; rules: Rules; empty: string; extra?: (r: QueueRow) => React.ReactNode }) {
  const { C } = useTheme()
  if (!rows.length) return <EmptyBlock title="Nobody here yet" note={empty} />
  return (
    <>
      {groupQueue(rows).map(g => (
        <View key={g.key} style={{ marginBottom: S.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, marginBottom: 4 }}>
            <Txt size={F.small} w={700} style={{ flex: 1 }}>{g.head}</Txt>
            <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.sunken }}>
              <Txt size={F.micro} w={700} tone="muted">{g.rows.length}</Txt>
            </View>
          </View>
          {!!g.why && <K style={{ marginBottom: S.sm }}>{g.why}</K>}
          {g.rows.map(r => <QueueCard key={r.member.employeeId} r={r} rules={rules} grouped>{extra?.(r)}</QueueCard>)}
        </View>
      ))}
    </>
  )
}

// ── §4.1 Team Dashboard ──────────────────────────────────────────────────
export function TeamTab({ members, today, managerName, rules = DEFAULT_RULES, flagRules, viewerId }: {
  members: TeamMember[]; today: string; managerName: string; rules?: Rules; flagRules?: FlagRules
  /** Who is looking: "Your rating is owed" and every row's `next` are about this person. */
  viewerId?: string
}) {
  const rows = teamQueue(members, today, flagRules, undefined, viewerId)
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
        <QueueList rules={rules} rows={rows} empty={EMPTY_TEAM} />
      </PCard>
    </>
  )
}

// ── §4.2 the approval chain (ChainApprovals) ─────────────────────────────

/** The four things that decide whether a set can move, as four marks (ReadyChecks). */
function ReadyChecks({ r, rules }: { r: QueueRow; rules: Rules }) {
  const { C } = useTheme()
  const m = r.member
  const countOk = m.kraCount >= rules.minKra && m.kraCount <= rules.maxKra
  const wtOk = m.totalWeightage === rules.totalWeightage
  const marks = [
    { st: countOk ? 'on' : 'bad', mark: countOk ? '✓' : '!', text: `${m.kraCount} KRA${m.kraCount === 1 ? '' : 's'}` },
    { st: wtOk ? 'on' : 'bad', mark: wtOk ? '✓' : '!', text: `Weightage ${m.totalWeightage}` },
    { st: m.selfSubmitted ? 'on' : 'off', mark: m.selfSubmitted ? '✓' : '○', text: m.selfSubmitted ? 'Self rating in' : 'Self rating waiting' },
    { st: m.oneToOneDone ? 'on' : 'off', mark: m.oneToOneDone ? '✓' : '○', text: m.oneToOneDone ? 'One-to-one logged' : 'One-to-one not yet' },
  ]
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>
      {marks.map(x => {
        const c = x.st === 'on' ? { fg: C.positive, bg: C.positiveTint } : x.st === 'bad' ? { fg: C.critical, bg: C.criticalTint } : { fg: C.muted, bg: C.sunken }
        return (
          <View key={x.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, backgroundColor: c.bg }}>
            <Txt size={F.micro} w={800} color={c.fg}>{x.mark}</Txt>
            <Txt size={F.micro} w={600} color={c.fg}>{x.text}</Txt>
          </View>
        )
      })}
    </View>
  )
}

/** Where this set is in the chain: the employee, then the rungs somebody actually holds; "you" on the viewer's. */
function ChainTrack({ chain, held, now }: { chain: Chain | readonly Stage[]; held: (s: Stage) => boolean; now: Stage }) {
  const { C } = useTheme()
  const steps: Stage[] = ['EMPLOYEE', ...rungs(chain).filter(held)]
  const at = steps.indexOf(now)
  return (
    <View accessibilityLabel="Where this sits in the approval chain" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: S.sm }}>
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <Txt size={F.micro} tone="faint">›</Txt>}
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill,
            backgroundColor: i === at ? C.brand : i < at ? C.positiveTint : C.sunken }}>
            <Txt size={F.micro} w={700} color={i === at ? C.onAccent : i < at ? C.positive : C.muted}>{i === at ? `${STAGE_SHORT[s]} · you` : STAGE_SHORT[s]}</Txt>
          </View>
        </React.Fragment>
      ))}
    </View>
  )
}

function ApprovalCard({ r, viewerId, chain, rules, onReject, onOpenKras, busy }: {
  r: QueueRow; viewerId: string; chain: Chain | readonly Stage[]; rules: Rules
  onReject?: (id: string, remark: string) => void; onOpenKras?: (id: string) => void; busy?: boolean
}) {
  const { C } = useTheme()
  const lit = usePmsLiterals()
  const [remark, setRemark] = React.useState('')
  const [rejecting, setRejecting] = React.useState(false)
  const id = r.member.employeeId
  const myStage = rungFor(r.member, viewerId)!
  const held = heldBy(r.member)
  const finalises = approvalFinalises(chain, myStage, held)
  const canReject = mayReject(myStage)
  const alreadyConfirmed = myStage === 'RM_L1' ? r.member.oneToOneDone === true
    : myStage === 'HOD' ? r.member.finalReviewMgrAcked === true
    : r.member.rmL2ConfirmedOneToOne === true
  const left = MIN_REMARK - remark.trim().length
  const bg = r.tone === 'exit' ? lit.rowExit : r.tone === 'notice' ? lit.rowNotice : C.surface
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.lg, padding: S.md, marginBottom: S.md, backgroundColor: bg }}>
      <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'flex-start' }}>
        <Ava name={r.member.name} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.body} w={700}>{r.member.name}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <Txt size={F.micro} tone="muted">{r.member.code}</Txt>
            <FlagPill r={r} />
            {r.member.selfScore !== null && <Txt size={F.micro} tone="muted">Self score <Txt size={F.micro} w={700}>{r.member.selfScore.toFixed(2)}</Txt></Txt>}
          </View>
        </View>
      </View>
      <ReadyChecks r={r} rules={rules} />
      <ChainTrack chain={chain} held={held} now={myStage} />
      <K style={{ marginTop: S.sm }}>
        {r.next}{r.priorityNote ? <> <B>{r.priorityNote}</B></> : null}{' '}
        {finalises ? <B>Yours is the last review: approving settles the rating.</B>
          : <>Approving sends it to <B>{STAGE_SHORT[nextRung(chain, myStage, held) ?? 'HR']}</B>.</>}
      </K>
      {rejecting && (
        <View style={{ gap: 6, marginTop: S.sm, padding: 10, borderRadius: R.md, backgroundColor: C.criticalTint, borderWidth: 1, borderColor: C.criticalEdge }}>
          <K>This goes <B>{rejectDestination(chain, myStage, held)}</B>.</K>
          <Input placeholder="What has to change, in a sentence" value={remark} onChangeText={setRemark} multiline style={{ marginBottom: 0 }}
            accessibilityLabel={`Reason for rejecting ${r.member.name}'s appraisal`} />
          {!remarkOk(remark) && <K>{left} more character{left === 1 ? '' : 's'} — they read this.</K>}
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
            <Button size="sm" variant="danger" title="Confirm rejection" disabled={!onReject || !remarkOk(remark) || busy}
              onPress={() => { onReject?.(id, remark); setRejecting(false) }} />
            <Button size="sm" variant="ghost" title="Cancel" onPress={() => setRejecting(false)} />
          </View>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap', marginTop: S.md }}>
        {/* Approving needs this rater's score on every measure, so it lives in the panel. */}
        <Button size="sm" title={alreadyConfirmed ? 'Review & send on' : 'Review, rate & approve'} disabled={!onOpenKras} onPress={() => onOpenKras?.(id)} />
        {canReject && !rejecting && <Button size="sm" variant="ghost" title="Send back" disabled={!onReject} onPress={() => setRejecting(true)} />}
      </View>
    </View>
  )
}

function ChainApprovals({ members, today, flagRules, rules, viewerId, chain, onReject, onOpenKras, busy }: {
  members: TeamMember[]; today: string; flagRules?: FlagRules; rules: Rules; viewerId: string; chain: Chain | readonly Stage[]
  onReject?: (id: string, remark: string) => void; onOpenKras?: (id: string) => void; busy?: boolean
}) {
  // Only what is with this person, on the rung they hold for THAT employee. The viewer is passed so
  // `next` speaks to them (the website omits it here, so an RM L1's own card reads "Waiting on RM L1’s rating").
  const rows = teamQueue(members, today, flagRules, undefined, viewerId).filter(r => r.member.chainStage && r.member.chainStage === rungFor(r.member, viewerId))
  if (!viewerId || !rows.length) return null
  return (
    <PCard title={`Waiting on your approval · ${rows.length}`} sub="Sets that have reached your rung. Approving passes them up the chain; the last rung settles the rating.">
      {rows.map(r => <ApprovalCard key={r.member.employeeId} r={r} viewerId={viewerId} chain={chain} rules={rules} onReject={onReject} onOpenKras={onOpenKras} busy={busy} />)}
      <K style={{ marginTop: 4 }}>Sending back goes one rung, never straight to the employee from halfway up — and it needs a reason, which they see. You can change their KRAs or ratings before approving; every change is logged against your name.</K>
    </PCard>
  )
}

function SendBackCell({ name, onSendBack, busy }: { name: string; onSendBack?: (reason: string) => void; busy?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  if (!open) return <Button size="sm" variant="ghost" title="Send back…" disabled={!onSendBack} onPress={() => setOpen(true)} style={{ alignSelf: 'flex-start' }} />
  return (
    <View style={{ gap: S.sm }}>
      <Input placeholder="What they need to change" value={reason} onChangeText={setReason} autoFocus style={{ marginBottom: 0 }}
        accessibilityLabel={`Reason for sending ${name}'s KRAs back`} />
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        <Button size="sm" title="Send back" disabled={!onSendBack || !reason.trim() || busy} onPress={() => onSendBack?.(reason)} />
        <Button size="sm" variant="ghost" title="Cancel" onPress={() => setOpen(false)} />
      </View>
    </View>
  )
}

// ── §4.2 KRA Approval & One-to-One ───────────────────────────────────────
export function ApproveTab({ members, today, onSendBack, onAcknowledge, onAcknowledgeFinalReview, rules = DEFAULT_RULES, flagRules, viewerId = '', chain = 'SELF_RM1_RM2_HOD', onOpenKras, busy }: {
  members: TeamMember[]; today: string
  onSendBack?: (id: string, reason: string) => void; onAcknowledge?: (id: string) => void
  onAcknowledgeFinalReview?: (id: string) => void
  rules?: Rules; flagRules?: FlagRules; viewerId?: string; chain?: Chain | readonly Stage[]
  onOpenKras?: (id: string) => void; busy?: boolean
}) {
  // People who still owe a self rating or a one-to-one; a manager's owed rating is ChainApprovals'.
  const queue = teamQueue(members, today, flagRules, undefined, viewerId)
  const rows = queue.filter(r => !r.member.selfSubmitted || !r.member.oneToOneDone)
  const finalRows = queue.filter(r => r.member.finalReviewLogged && !r.member.finalReviewDone)
  return (
    <>
      <Banner tone="blue" glyph="ℹ️">
        A set is valid at <B>{rules.minKra} to {rules.maxKra} KRAs totalling exactly {rules.totalWeightage}</B>. Weightage locks only once you and they have both acknowledged the KRA one-to-one. One tick is a manager asserting a conversation happened, two is a record.
      </Banner>
      <ChainApprovals members={members} today={today} flagRules={flagRules} rules={rules} viewerId={viewerId} chain={chain}
        onReject={onSendBack} onOpenKras={onOpenKras} busy={busy} />
      <PCard title={`Waiting on the discussion · ${rows.length}`} sub="Sets to check, and the one-to-ones that lock them. Grouped by what each one is waiting for.">
        <GroupedQueue rules={rules} rows={rows} empty="Every set is settled and locked." extra={r => {
          const id = r.member.employeeId
          const valid = r.member.kraCount >= rules.minKra && r.member.kraCount <= rules.maxKra && r.member.totalWeightage === rules.totalWeightage
          return (
            <View style={{ marginTop: S.sm }}>
              {!valid ? <SendBackCell name={r.member.name} busy={busy} onSendBack={onSendBack ? reason => onSendBack(id, reason) : undefined} />
                : !r.member.oneToOneDone ? <Button size="sm" title="Acknowledge & lock" disabled={!onAcknowledge || busy} onPress={() => onAcknowledge?.(id)} style={{ alignSelf: 'flex-start' }} />
                : <Pill kind="green" label="locked" />}
            </View>
          )
        }} />
        <K style={{ marginTop: 4 }}>Sending a set back needs a reason. “Rejected” on its own means the employee guesses at what to change, and the set comes back wrong a second time.</K>
      </PCard>
      {finalRows.length > 0 && (
        <PCard title={`Final review one-to-ones waiting on you · ${finalRows.length}`} sub="They have logged the conversation. The rating cannot be settled until you confirm it happened.">
          <QueueList rules={rules} rows={finalRows} empty="None waiting." extra={r => (
            <View style={{ marginTop: S.sm }}>
              <Button size="sm" title="Acknowledge" disabled={!onAcknowledgeFinalReview || busy} onPress={() => onAcknowledgeFinalReview?.(r.member.employeeId)} style={{ alignSelf: 'flex-start' }} />
            </View>
          )} />
          <K style={{ marginTop: 10 }}>Where the policy asks for a final review, the HOD cannot finalise without both ticks. This is the last thing owed before the result exists.</K>
        </PCard>
      )}
    </>
  )
}

// ── §4.4 PIP Request — no onRaise in ESS, so the send button stays disabled ──
interface PipArea { area: string; current: string; target: string; measure: string; reviewOn: string }
const blankArea = (): PipArea => ({ area: '', current: '', target: '', measure: '', reviewOn: '' })

export function PipRequestTab({ members, today, flagRules }: { members: TeamMember[]; today: string; flagRules?: FlagRules }) {
  const { C } = useTheme()
  const rows = teamQueue(members, today, flagRules)
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
          <Button size="sm" variant="ghost" title="+ Add an area" onPress={() => setAreas([...areas, blankArea()])} style={{ alignSelf: 'flex-start' }} />
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
