// src/features/performance/HodTabs.tsx — analytics and the HOD's tabs
// (website: components/pms/ManagerTabs.tsx §4.5, §5.1–5.3). Live as on the
// website: choose a final rating, Log final review (once a rating is chosen),
// Finalise (pms_finalise); Feedback & Recognition → Publish when the policy
// gives that step to the finaliser; Published Results, read-only. "Nudge RM
// L2" has no handler in ESS and stays disabled, as on the website.
import * as React from 'react'
import { View } from 'react-native'
import { teamQueue, finaliseQueue, distribution, type TeamMember, type FinaliseRow } from '@web/pms/team'
import { score, byCategory, bandFor, checkFeedback, DEFAULT_BANDS, type Band } from '@web/pms/scoring'
import { canPublishResult, type Log } from '@web/pms/oneToOne'
import { CHAIN_LABEL, FINALISER_LABEL, type Chain, type Finaliser, type Role } from '@web/pms/hierarchy'
import { chainLabel, type Stage } from '@web/pms/chain'
import { humanDate } from '@web/pms/cycle'
import type { FlagRules } from '@web/pms/employment'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { ABar, B, Banner, EmptyBlock, Field, K, PCard, Pill, PStat, StatGrid } from './ui'
import { BENEFIT_LABEL, BENEFIT_TYPES, type BenefitType } from './data'
import type { FeedbackDraft, PublishedResult } from './dataTeam'
import { publishedFirst } from './logic'
import { EMPTY_TEAM, ExitBanner, QueueCard } from './MgrTabs'

// ── §4.5 / §5.3 analytics (lines are always [] and averages null in ESS) ──
export function TeamAnalyticsTab({ members, today, scopeLabel, bands = DEFAULT_BANDS, flagRules }: {
  members: TeamMember[]; today: string; scopeLabel: string; bands?: Band[]; flagRules?: FlagRules
}) {
  const rows = teamQueue(members, today, flagRules)
  const dist = distribution(rows)
  const rated = dist.reduce((s, d) => s + d.n, 0)
  const cats = byCategory([], 'final')
  return (
    <>
      <PCard title={`How ${scopeLabel} was rated`} sub="For information. There is no curve to fit. With no pay attached, a forced distribution would be rationing nothing.">
        {rated === 0 ? <K>Nothing has been finalised yet, so there is no distribution to show.</K>
          : dist.map(d => <ABar key={d.rating} name={`${d.rating} · ${bandFor(d.rating, bands)?.label ?? ''}`} final={d.n / rated} solidOnly value={`${d.n} · ${Math.round((d.n / rated) * 100)}%`} />)}
      </PCard>
      <StatGrid>
        <PStat label={`${scopeLabel} average`} value="-" />
        <PStat label="Company average" value="-" />
        <PStat label="Rated 2 or below" value={dist.filter(d => d.rating <= 2).reduce((s, d) => s + d.n, 0)} note="Each of these owes improvement feedback" />
      </StatGrid>
      <PCard title="Where the strength is, by category" sub="A low category across a whole team is a training need, not a run of individual failures.">
        {cats.length === 0 ? <K>No finalised ratings yet.</K>
          : cats.map(c => <ABar key={c.category} name={c.label} final={(c.score ?? 0) / 5} solidOnly value={c.score === null ? '-' : c.score.toFixed(2)} />)}
      </PCard>
    </>
  )
}

// ── §5.1 Review & Finalise ───────────────────────────────────────────────
interface FinaliseHandlers {
  onFinalise?: (id: string, rating: number) => void
  onLogFinalReview?: (id: string) => void
  saving?: boolean
}
function FinaliseCard({ r, bands, finalReviewRequired, onFinalise, onLogFinalReview, saving }: FinaliseHandlers & {
  r: FinaliseRow; bands: Band[]; finalReviewRequired: boolean
}) {
  const [picked, setPicked] = React.useState<number | null>(null)
  const [open, setOpen] = React.useState(false)
  const m = r.member
  const band = picked ? bands.find(b => b.value === picked) : null
  let action: React.ReactNode
  if (m.finalised) action = <K>done</K>
  else if (r.canFinalise) action = <Button size="sm" title="Finalise" disabled={!picked || !onFinalise || saving} onPress={() => picked && onFinalise?.(m.employeeId, picked)} />
  else if (r.insteadDo?.startsWith('RM L2')) action = <Button size="sm" variant="ghost" title="Nudge RM L2" disabled />
  else if (finalReviewRequired && !m.finalReviewLogged && r.precedingDone) {
    // The rating comes first: the final review is the conversation about it.
    action = (
      <View style={{ gap: 4 }}>
        <Button size="sm" title="Log final review" disabled={!onLogFinalReview || saving || !picked} onPress={() => onLogFinalReview?.(m.employeeId)} style={{ alignSelf: 'flex-start' }} />
        {!picked && <K>Choose the rating first — this records the conversation about it.</K>}
      </View>
    )
  } else action = <K>{r.insteadDo}</K>
  return (
    <QueueCard r={r}>
      <View style={{ marginTop: 8 }}>
        <Field label="RM L1">{m.rmL1Score?.toFixed(2) ?? '-'}</Field>
        <Field label="RM L2">{m.rmL2Score?.toFixed(2) ?? '-'}</Field>
        <Field label="Final rating">
          {m.finalised ? <Pill kind="green" label={`${m.finalRating} · finalised`} />
            // canChoose, not canFinalise: the number can be picked as soon as the chain ahead is clear.
            : <PickerField value={band ? `${band.value} · ${band.label}` : ''} placeholder="Choose" disabled={!r.canChoose}
                onPress={() => setOpen(true)} style={{ marginBottom: 0 }} />}
        </Field>
        <Field label="Action">{action}</Field>
      </View>
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={`Final rating for ${m.name}`} value={picked ?? undefined}
        options={bands.map(b => ({ value: b.value, label: `${b.value} · ${b.label}` }))} onPick={v => setPicked(Number(v))} />
    </QueueCard>
  )
}

export function FinaliseTab({ members, today, role, chain, whoCanFinalise, deptName, bands = DEFAULT_BANDS, finalReviewRequired = false, flagRules, ...h }: FinaliseHandlers & {
  members: TeamMember[]; today: string; role: Role; chain: Chain | readonly Stage[]; whoCanFinalise: Finaliser; deptName: string
  bands?: Band[]; finalReviewRequired?: boolean; flagRules?: FlagRules
}) {
  const rows = finaliseQueue(members, today, { role, chain, whoCanFinalise, finalReviewRequired, rules: flagRules })
  const awaiting = rows.filter(r => !r.member.finalised).length
  const done = rows.filter(r => r.member.finalised).length
  const urgent = rows.filter(r => r.tone !== 'normal' && !r.member.finalised).length
  const avg = score(rows.filter(r => r.member.finalRating !== null).map(r => ({
    goalId: r.member.employeeId, title: r.member.name, category: 'BUSINESS' as const, weightage: 1, final: r.member.finalRating,
  })), 'final')
  return (
    <>
      <Banner tone="blue" glyph="ℹ️">
        The chain is <B>{chainLabel(chain, CHAIN_LABEL)}</B>, and under this policy <B>{FINALISER_LABEL[whoCanFinalise]}</B> may finalise. A row cannot be finalised while a step ahead of it is still open. That is not a nicety, it is the difference between a rating that went through the chain and one that skipped it.
      </Banner>
      <ExitBanner rows={rows} />
      <StatGrid>
        <PStat tone="accent" label="Awaiting finalisation" value={awaiting} note={`of ${rows.length}`} />
        <PStat label="Finalised" value={done} />
        <PStat tone={urgent ? 'warn' : undefined} label="Exit or notice" value={urgent} note={urgent ? 'Clear these first. Their deadline cannot move' : 'None outstanding'} />
        <PStat label={`${deptName} average`} value={avg === null ? '-' : avg.toFixed(2)} />
      </StatGrid>
      <PCard title={`Finalisation queue: ${deptName}`} sub="Exit and notice rows are pinned to the top, because after a last working day the record locks for good.">
        {rows.length === 0 ? <EmptyBlock title="Nothing to finalise" note={EMPTY_TEAM} />
          : rows.map(r => <FinaliseCard key={r.member.employeeId} r={r} bands={bands} finalReviewRequired={finalReviewRequired} {...h} />)}
      </PCard>
    </>
  )
}

// ── §5.2 Feedback & Recognition ──────────────────────────────────────────
/** 202: HR owns the step by default. The tab stays, and says where the controls went. */
export function FeedbackOwnedByHr() {
  return (
    <>
      <Banner tone="blue" glyph="📋">
        <B>HR writes this now.</B> Once you settle a rating, HR writes the appreciation and improvement feedback, awards any recognition and publishes the result. What went out is on <B>Published Results</B>, read-only. Your part ends at the rating.
      </Banner>
      <PCard>
        <K>If your company would rather the finaliser did all of it — the appreciation remark, the improvement feedback and the recognition awards, as the spec’s Stage 6 describes — HR can switch this policy’s <B>post-finalisation owner</B> back to the finaliser in Setup &amp; Controls, and these controls return here.</K>
      </PCard>
    </>
  )
}

function BenefitRow({ b, i, onType, onNote }: { b: FeedbackDraft['benefits'][number]; i: number; onType: (i: number) => void; onNote: (i: number, t: string) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.sm }}>
      <PickerField label="Type" value={BENEFIT_LABEL[b.type]} onPress={() => onType(i)} />
      <Input label="What for" value={b.note} style={{ marginBottom: 0 }} accessibilityLabel={`Recognition ${i + 1} what for`} onChangeText={t => onNote(i, t)} />
    </View>
  )
}

export function FeedbackTab({ member, rating, appreciation, improvement, benefits, logs, bands = DEFAULT_BANDS, onChange, onPublish, onAcknowledgeFinalReview, saving }: {
  member: TeamMember | null; rating: number | null
  appreciation: string; improvement: string; benefits: FeedbackDraft['benefits']; logs: Log[]
  bands?: Band[]; onChange: (patch: Partial<FeedbackDraft>) => void; onPublish?: () => void
  /** The manager's half of the final-review sign-off, which gates publication (200 / 207). */
  onAcknowledgeFinalReview?: () => void; saving?: boolean
}) {
  const [typeFor, setTypeFor] = React.useState<number | null>(null)
  if (!member) {
    return (
      <PCard title="Pick somebody">
        <K>Choose a person from the finalisation queue to write their feedback.</K>
      </PCard>
    )
  }
  const check = checkFeedback(rating, { appreciation, improvement }, bands)
  const publish = canPublishResult(logs)
  const band = bandFor(rating, bands)
  const canPublish = check.ok && publish.open
  const setB = (i: number, patch: Partial<FeedbackDraft['benefits'][number]>) => onChange({ benefits: benefits.map((x, j) => j === i ? { ...x, ...patch } : x) })
  return (
    <>
      <StatGrid>
        <PStat tone="accent" label="Writing feedback for" value={member.name} note={member.code} />
        <PStat label="Final rating" value={rating === null ? '-' : `${rating}${band ? ` · ${band.label}` : ''}`} />
        <PStat tone={band?.improvementMandatory ? 'warn' : undefined} label="Improvement feedback" value={band?.improvementMandatory ? 'Required' : 'Optional'}
          note={band?.improvementMandatory ? 'Mandatory at this rating' : 'Write it anyway if there is something to say'} />
      </StatGrid>
      <Input label="🏆 Appreciation" value={appreciation} multiline onChangeText={t => onChange({ appreciation: t })}
        placeholder="What they did well, specifically enough that they could repeat it" />
      <Input label="📈 Where to improve" value={improvement} multiline onChangeText={t => onChange({ improvement: t })}
        placeholder="What would change the rating, and what support goes with it" />
      <PCard title="🎁 Recognition" sub="Non-monetary only: a certificate, a nomination, an award. Anything with a cash component would touch payroll, and this module does not.">
        {benefits.map((b, i) => <BenefitRow key={i} b={b} i={i} onType={setTypeFor} onNote={(j, t) => setB(j, { note: t })} />)}
        <Button size="sm" variant="ghost" title="+ Add recognition" style={{ alignSelf: 'flex-start' }}
          onPress={() => onChange({ benefits: [...benefits, { type: 'CERTIFICATE', note: '' }] })} />
      </PCard>
      {(!check.ok || !publish.open) && (
        <Banner tone="amber" glyph="!" raw>
          <Txt size={F.tiny} w={700} tone="warning">Before this can be published:</Txt>
          {check.faults.map((f, i) => <Txt key={i} size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• {f}</Txt>)}
          {!publish.open && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• {publish.because}</Txt>}
        </Banner>
      )}
      <View style={{ gap: S.sm }}>
        <Button full disabled={!canPublish || !onPublish || saving} onPress={onPublish}
          title={saving ? 'Publishing…' : canPublish ? 'Publish the result' : 'Cannot publish yet'} />
        {!publish.open && logs.some(l => l.discussion_type === 'FINAL_REVIEW' && !l.manager_ack) && !!onAcknowledgeFinalReview && (
          <Button full variant="outline" title="Acknowledge the final review" disabled={saving} onPress={onAcknowledgeFinalReview} />
        )}
      </View>
      <SelectSheet visible={typeFor !== null} onClose={() => setTypeFor(null)} title="Type"
        value={typeFor !== null ? benefits[typeFor]?.type : undefined}
        options={BENEFIT_TYPES.map(t => ({ value: t, label: BENEFIT_LABEL[t] }))}
        onPick={v => { if (typeFor !== null) setB(typeFor, { type: v as BenefitType }) }} />
    </>
  )
}

// ── §5.3 Published Results — the department's record, read-only ──────────
export function PublishedResultsTab({ members, bands = DEFAULT_BANDS, results = [], deptName, hrHead }: {
  members: TeamMember[]; bands?: Band[]; results?: PublishedResult[]; deptName?: string
  hrHead?: { name: string; code: string } | null
}) {
  const { C } = useTheme()
  const rows = publishedFirst(members)
  const byId = new Map(results.map(r => [r.employeeId, r]))
  const acked = rows.filter(r => r.resultAcknowledged).length
  return (
    <>
      <Banner tone="blue" glyph="🔒">
        These results are out. {deptName ? `${deptName}'s ` : 'Your department’s '}record of what each person was told, and nothing here can be changed — the employee has already read it. A rating that genuinely needs correcting goes through{' '}
        {hrHead?.name ? <>the HR Head, <B>{hrHead.name}</B>{hrHead.code ? ` (${hrHead.code})` : ''}.</>
          : <>HR — no HR Head is named for this company yet, so ask an administrator to set one in Setup &amp; Controls.</>}
      </Banner>
      <StatGrid>
        <PStat tone="accent" label="Published" value={rows.length} />
        <PStat label="Acknowledged by the employee" value={acked} note={rows.length ? `${rows.length - acked} still to read theirs` : undefined} />
        <PStat label="Average rating" value={rows.length ? (rows.reduce((s, r) => s + (r.finalRating ?? 0), 0) / rows.length).toFixed(2) : '—'} />
      </StatGrid>
      <PCard title="Released results" sub="Oldest at the bottom. Read-only.">
        {!rows.length ? (
          <EmptyBlock title="Nothing published yet" note="A result appears here once it has been released to the employee. Until then it sits in Review & Finalise, then Feedback & Recognition." />
        ) : rows.map((m, i) => {
          const band = bandFor(m.finalRating, bands)
          const fb = byId.get(m.employeeId)
          return (
            <View key={m.employeeId} style={{ paddingVertical: S.md, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
                <Txt size={F.small} w={600} style={{ flex: 1 }}>{m.name}</Txt>
                <Txt size={F.micro} tone="muted">{m.code}</Txt>
              </View>
              <Field label="Rating"><Txt size={F.tiny}><B>{m.finalRating ?? '—'}</B>{band ? ` · ${band.label}` : ''}</Txt></Field>
              <Field label="Published">{m.publishedAt ? humanDate(String(m.publishedAt).slice(0, 10)) : '—'}</Field>
              <Field label="Read by them">{m.resultAcknowledged ? <Pill kind="green" label="✓ acknowledged" /> : <Pill kind="amber" label="not yet" />}</Field>
              {!fb?.appreciation && !fb?.improvement ? <K>No written feedback went out.</K> : (
                <View style={{ gap: 4 }}>
                  {!!fb?.appreciation && <Txt size={F.tiny} tone="soft"><B>Appreciation.</B> {fb.appreciation}</Txt>}
                  {!!fb?.improvement && <Txt size={F.tiny} tone="soft"><B>Improvement.</B> {fb.improvement}</Txt>}
                </View>
              )}
              {!!fb?.benefits?.length && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {fb.benefits.map((b, j) => <Pill key={j} kind="brand" label={`${b.type.replace(/_/g, ' ').toLowerCase()}${b.note ? ` · ${b.note}` : ''}`} />)}
                </View>
              )}
            </View>
          )
        })}
      </PCard>
    </>
  )
}
