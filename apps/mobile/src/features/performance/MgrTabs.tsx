// src/features/performance/MgrTabs.tsx — the RM side, "My team" (website:
// components/pms/ManagerTabs.tsx §4.1, §4.2 with ChainApprovals, §4.4).
// Live as on the website: acknowledge & lock, send back / reject one rung back
// with a remark, approve up the chain (finalising at the last held rung), and
// the final-review acknowledgement. PIP still has no onRaise in ESS, so its
// send button stays disabled as on the website. Rate My Team is RateTab.tsx.
import * as React from 'react'
import { View } from 'react-native'
import { teamQueue, teamStats, type TeamMember, type QueueRow } from '@web/pms/team'
import { FLAG_LABEL, type FlagRules } from '@web/pms/employment'
import { humanDate, DEFAULT_RULES, type Rules } from '@web/pms/cycle'
import { approvalFinalises, mayReject, rejectDestination, remarkOk, MIN_REMARK, rungFor, heldBy } from '@web/pms/chain'
import type { Chain } from '@web/pms/hierarchy'
import type { Band } from '@web/pms/scoring'
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
export function QueueCard({ r, children, rules = DEFAULT_RULES }: { r: QueueRow; children?: React.ReactNode; rules?: Rules }) {
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
      <Field label="Wt"><Txt size={F.tiny} w={600} color={m.totalWeightage === rules.totalWeightage ? C.positive : C.critical}>{m.totalWeightage}</Txt></Field>
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

export function QueueList({ rows, empty, extra, rules }: { rows: QueueRow[]; empty: string; extra?: (r: QueueRow) => React.ReactNode; rules?: Rules }) {
  if (rows.length === 0) return <EmptyBlock title="Nobody here yet" note={empty} />
  return <>{rows.map(r => <QueueCard key={r.member.employeeId} r={r} rules={rules}>{extra?.(r)}</QueueCard>)}</>
}

// ── §4.1 Team Dashboard ──────────────────────────────────────────────────
export function TeamTab({ members, today, managerName, rules = DEFAULT_RULES, flagRules }: { members: TeamMember[]; today: string; managerName: string; rules?: Rules; flagRules?: FlagRules }) {
  const rows = teamQueue(members, today, flagRules)
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
function ChainAction({ r, viewerId, chain, bands, onApprove, onReject, busy }: {
  r: QueueRow; viewerId: string; chain: Chain; bands?: Band[]
  onApprove?: (id: string, rating?: number) => void; onReject?: (id: string, remark: string) => void; busy?: boolean
}) {
  const [remark, setRemark] = React.useState('')
  const [rating, setRating] = React.useState('')
  const [rejecting, setRejecting] = React.useState(false)
  const id = r.member.employeeId
  const myStage = rungFor(r.member, viewerId)!
  const held = heldBy(r.member)
  const finalises = approvalFinalises(chain, myStage, held)
  const canReject = mayReject(myStage)
  const num = Number(rating)
  const lo = bands?.length ? Math.min(...bands.map(b => b.value)) : 1
  const hi = bands?.length ? Math.max(...bands.map(b => b.value)) : 5
  const ratingOk = !finalises || (rating !== '' && num >= lo && num <= hi)

  if (rejecting) {
    return (
      <View style={{ marginTop: S.sm, gap: S.sm }}>
        <K>This goes <B>{rejectDestination(chain, myStage, held)}</B>.</K>
        <Input placeholder="What has to change, in a sentence" value={remark} onChangeText={setRemark} style={{ marginBottom: 0 }}
          accessibilityLabel={`Reason for rejecting ${r.member.name}'s appraisal`} />
        {!remarkOk(remark) && <K>At least {MIN_REMARK} characters. The database refuses a rejection without a reason.</K>}
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          <Button size="sm" variant="ghost" title="Confirm rejection" disabled={!onReject || !remarkOk(remark) || busy}
            onPress={() => { onReject?.(id, remark); setRejecting(false) }} />
          <Button size="sm" variant="ghost" title="Cancel" onPress={() => setRejecting(false)} />
        </View>
      </View>
    )
  }
  return (
    <View style={{ marginTop: S.sm, gap: S.sm }}>
      {finalises && (
        <Input placeholder={`Final rating (${lo}–${hi})`} value={rating} keyboardType="decimal-pad" style={{ marginBottom: 0 }}
          accessibilityLabel={`Final rating for ${r.member.name}`} onChangeText={t => setRating(t.replace(/[^0-9.]/g, ''))} />
      )}
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        <Button size="sm" title={finalises ? 'Approve & finalise' : 'Approve'} disabled={!onApprove || !ratingOk || busy}
          onPress={() => onApprove?.(id, finalises ? num : undefined)} />
        {canReject && <Button size="sm" variant="ghost" title="Reject" disabled={!onReject || busy} onPress={() => setRejecting(true)} />}
      </View>
    </View>
  )
}

function ChainApprovals({ members, today, flagRules, rules, viewerId, chain, onApprove, onReject, bands, busy }: {
  members: TeamMember[]; today: string; flagRules?: FlagRules; rules: Rules; viewerId: string; chain: Chain
  onApprove?: (id: string, rating?: number) => void; onReject?: (id: string, remark: string) => void; bands?: Band[]; busy?: boolean
}) {
  // Only what is with this person, on the rung they hold for THAT employee.
  const rows = teamQueue(members, today, flagRules).filter(r => r.member.chainStage && r.member.chainStage === rungFor(r.member, viewerId))
  if (!viewerId || !rows.length) return null
  return (
    <PCard title="Waiting on your approval" sub="Sets that have reached your rung. Approving passes them up the chain; the last rung settles the rating.">
      <QueueList rules={rules} rows={rows} empty="Nothing is with you for approval."
        extra={r => <ChainAction r={r} viewerId={viewerId} chain={chain} bands={bands} onApprove={onApprove} onReject={onReject} busy={busy} />} />
      <K style={{ marginTop: 10 }}>A rejection goes back one rung, never straight to the employee from halfway up — and it needs a reason, which they see. You can change their KRAs or ratings before approving; every change is logged against your name.</K>
    </PCard>
  )
}

// ── §4.2 KRA Approval & One-to-One ───────────────────────────────────────
export function ApproveTab({ members, today, onSendBack, onAcknowledge, onAcknowledgeFinalReview, rules = DEFAULT_RULES, flagRules, viewerId = '', chain = 'SELF_RM1_RM2_HOD', onApprove, bands, busy }: {
  members: TeamMember[]; today: string
  onSendBack?: (id: string, reason: string) => void; onAcknowledge?: (id: string) => void
  onAcknowledgeFinalReview?: (id: string) => void
  rules?: Rules; flagRules?: FlagRules; viewerId?: string; chain?: Chain
  onApprove?: (id: string, rating?: number) => void; bands?: Band[]; busy?: boolean
}) {
  const [reason, setReason] = React.useState<Record<string, string>>({})
  const queue = teamQueue(members, today, flagRules)
  const rows = queue.filter(r => !r.member.selfSubmitted || !r.member.oneToOneDone)
  const finalRows = queue.filter(r => r.member.finalReviewLogged && !r.member.finalReviewDone)
  return (
    <>
      <Banner tone="blue" glyph="ℹ️">
        A set is valid at <B>{rules.minKra} to {rules.maxKra} KRAs totalling exactly {rules.totalWeightage}</B>. Weightage locks only once you and they have both acknowledged the KRA one-to-one. One tick is a manager asserting a conversation happened, two is a record.
      </Banner>
      <ChainApprovals members={members} today={today} flagRules={flagRules} rules={rules} viewerId={viewerId} chain={chain}
        onApprove={onApprove} onReject={onSendBack} bands={bands} busy={busy} />
      <PCard title="Waiting on the discussion" sub="Sets to check, and the one-to-ones that lock them.">
        <QueueList rules={rules} rows={rows} empty="Every set is settled and locked." extra={r => {
          const id = r.member.employeeId
          const valid = r.member.kraCount >= rules.minKra && r.member.kraCount <= rules.maxKra && r.member.totalWeightage === rules.totalWeightage
          return (
            <View style={{ marginTop: S.sm }}>
              {!valid ? (
                <>
                  <Input placeholder="What they need to change" value={reason[id] ?? ''} style={{ marginBottom: S.sm }}
                    accessibilityLabel={`Reason for sending ${r.member.name}'s KRAs back`}
                    onChangeText={t => setReason(p => ({ ...p, [id]: t }))} />
                  <Button size="sm" variant="ghost" title="Send back" disabled={!onSendBack || !(reason[id] ?? '').trim() || busy}
                    onPress={() => onSendBack?.(id, reason[id])} />
                </>
              ) : !r.member.oneToOneDone ? (
                <Button size="sm" title="Acknowledge & lock" disabled={!onAcknowledge || busy} onPress={() => onAcknowledge?.(id)} />
              ) : <Pill kind="green" label="locked" />}
            </View>
          )
        }} />
        <K style={{ marginTop: 10 }}>Sending a set back needs a reason. “Rejected” on its own means the employee guesses at what to change, and the set comes back wrong a second time.</K>
      </PCard>
      {finalRows.length > 0 && (
        <PCard title="Final review one-to-ones waiting on you" sub="They have logged the conversation. The rating cannot be settled until you confirm it happened.">
          <QueueList rules={rules} rows={finalRows} empty="None waiting." extra={r => (
            <View style={{ marginTop: S.sm }}>
              <Button size="sm" title="Acknowledge" disabled={!onAcknowledgeFinalReview || busy} onPress={() => onAcknowledgeFinalReview?.(r.member.employeeId)} />
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
