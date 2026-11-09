// src/features/performance/KraPanel.tsx — the reviewer's panel (website:
// components/pms/ManagerTabs.tsx KraDetail + KraStepper). Rating, confirming
// and approving are one act: the rung holding the appraisal works through the
// KRAs one at a time, measure by measure, with their own answer beside each,
// then a review step; under it the comparison, the overall remark, training,
// the PIP / recognition the score invites, the one-to-one tick and the
// approval. Somebody only reading gets the whole record at once instead.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { TeamMember } from '@web/pms/team'
import { STAGE_SHORT } from '@web/pms/chain'
import type { ConfirmStage } from '@web/pms/oneToOne'
import { bandFor, type Band } from '@web/pms/scoring'
import { scoreInvites, type PipIntent, type RecognitionIntent } from '@web/pms/training'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet, useOverlay } from '@/ui/overlays'
import { Ava, B, Banner, Bar, EmptyBlock, K, PCard, Pill, RampChips, RDot, useTone } from './ui'
import { compareFor, kraChip, kraProgress, panelGate, type KpiLine, type KraLine, type Rate, type TrainingDraft } from './logic'
import { useReveal } from './scroll'
import { ConfirmStep, OverallComment, RatingSummary, ScoreInvitesBlock, TrainingBlock, type AiBin } from './PanelExtras'

const pct = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(2))

function KpiCard({ k, kraTitle, mine, comment, bands, onRate }: {
  k: KpiLine; kraTitle: string; mine: number | null; comment: string; bands: Band[]
  onRate: (kpiId: string, patch: { rating?: number | null; comment?: string }) => void
}) {
  const { C } = useTheme()
  const t = useTone(mine, bands)
  const differs = mine != null && k.selfRating != null && mine !== k.selfRating
  return (
    <View style={{ borderWidth: 1, borderColor: t?.tone ?? C.line, borderLeftWidth: 4, borderRadius: R.md, padding: S.md, marginBottom: S.md, backgroundColor: t?.card ?? C.surface }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Txt size={F.small} w={700}>{k.metric}</Txt>
          {!!k.target && <K>target {k.target}</K>}
        </View>
        <Txt size={F.tiny} w={700} tone="muted">{pct(k.share)}%</Txt>
      </View>
      {/* Their answer first: a manager rates against what the employee claimed. */}
      <View style={{ marginTop: S.sm, padding: S.sm, borderRadius: R.sm, backgroundColor: C.sunken, gap: 2 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Txt size={F.micro} w={700} tone="muted" upper>They said</Txt>
          {k.selfRating == null ? <K>Not rated</K> : <><RDot v={k.selfRating} bands={bands} /><Txt size={F.tiny} w={600}>{bandFor(k.selfRating, bands)?.label ?? ''}</Txt></>}
        </View>
        {!!k.achievement && <K>Delivered: {k.achievement}</K>}
        {!!k.selfComment && <K style={{ fontStyle: 'italic' }}>“{k.selfComment}”</K>}
      </View>
      <Txt size={F.micro} w={700} tone="muted" upper style={{ marginTop: S.md, marginBottom: 6 }}>Your rating</Txt>
      <RampChips bands={bands} value={mine} label={`Your rating for ${kraTitle}, ${k.metric}`} onPick={v => onRate(k.kpiId, { rating: v })} />
      {mine != null && <Txt size={F.tiny} w={700} style={{ marginTop: 6 }}>{bandFor(mine, bands)?.label ?? ''}</Txt>}
      <Input value={comment} multiline style={{ marginTop: S.md, marginBottom: 0 }} accessibilityLabel={`Why you rated ${k.metric} this way`}
        placeholder={differs ? `Why ${mine} and not their ${k.selfRating}? They will read this.` : 'A line on why — they will read this.'}
        onChangeText={t2 => onRate(k.kpiId, { comment: t2 })} />
    </View>
  )
}

/** KraStepper — one KRA at a time, then a review step listing every KRA with its rolled-up rating. */
function Stepper({ lines, rate, onRate, bands, at, onAt }: {
  lines: KraLine[]; rate: Rate; onRate: (kpiId: string, patch: { rating?: number | null; comment?: string }) => void
  bands: Band[]; at: number; onAt: (n: number) => void
}) {
  const { C } = useTheme()
  const n = lines.length
  const onReview = at >= n
  const fullCount = lines.filter(l => kraProgress(l, rate).full).length
  const firstUnrated = lines.findIndex(l => !kraProgress(l, rate).full)
  const cur = lines[at]
  const cp = kraProgress(cur, rate)
  return (
    <View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: S.sm, marginBottom: S.md }}>
        <Txt size={F.lead} w={700}>{onReview ? 'Review before sending' : `KRA ${at + 1} of ${n}`}</Txt>
        <K>{onReview ? `${fullCount} of ${n} KRAs fully rated` : `${fullCount} of ${n} KRAs done`}</K>
      </View>
      {onReview ? (
        <View>
          <K style={{ marginBottom: S.sm }}>Every KRA, as you have rated it. Tap one to go back and change it.</K>
          {lines.map((l, i) => {
            const p = kraProgress(l, rate)
            return (
              <Pressable key={l.goalId ?? i} onPress={() => onAt(i)} accessibilityRole="button" accessibilityLabel={`Go to KRA ${i + 1}, ${l.title}`}
                style={{ paddingVertical: S.sm, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, backgroundColor: p.full ? undefined : C.warningTint, paddingHorizontal: p.full ? 0 : S.sm, borderRadius: p.full ? 0 : R.sm }}>
                <Txt size={F.small} w={600} tone="brand">{i + 1}. {l.title}</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md, marginTop: 2 }}>
                  <K>Weightage {l.weightage}%</K>
                  <K>Rated {p.done} of {p.of}</K>
                  <K>Your rating <Txt size={F.micro} w={700}>{p.rollup === null ? '—' : p.rollup.toFixed(2)}</Txt>{p.rollup !== null ? ` ${bandFor(Math.round(p.rollup), bands)?.label ?? ''}` : ''}</K>
                </View>
              </Pressable>
            )
          })}
          {firstUnrated >= 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.sm, marginTop: S.sm }}>
              <Txt size={F.tiny} w={600} tone="warning">KRA {firstUnrated + 1} is not fully rated.</Txt>
              <Button size="sm" variant="ghost" title="Go to it" onPress={() => onAt(firstUnrated)} />
            </View>
          )}
        </View>
      ) : (
        <View>
          <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', marginBottom: S.md }}>
            <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
              <Txt size={F.tiny} w={800} color={C.onAccent}>{at + 1}</Txt>
            </View>
            <Txt size={F.body} w={700} style={{ flex: 1 }}>{cur?.title}</Txt>
            <Pill kind="brand" label={`${cur?.weightage}%`} />
          </View>
          {(cur?.kpis ?? []).length === 0 ? (
            <Txt size={F.tiny} w={600} tone="warning">This KRA has no measure under it, so there is nothing to rate. Send it back and ask for one.</Txt>
          ) : (cur?.kpis ?? []).map(k => (
            <KpiCard key={k.kpiId} k={k} kraTitle={cur.title} mine={rate[k.kpiId]?.rating ?? null} comment={rate[k.kpiId]?.comment ?? ''} bands={bands} onRate={onRate} />
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: S.sm }}>
            <K>This KRA so far</K>
            <Txt size={F.lead} w={800}>{cp.rollup === null ? '—' : cp.rollup.toFixed(2)}</Txt>
            <K>{cp.done} of {cp.of} measures rated</K>
          </View>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
        <Button variant="outline" title="← Back" disabled={at === 0} onPress={() => onAt(Math.max(0, at - 1))} style={{ flex: 1 }} />
        {!onReview && <Button variant="outline" title={at === n - 1 ? 'Review all →' : 'Next KRA →'} onPress={() => onAt(at + 1)} style={{ flex: 1 }} />}
      </View>
    </View>
  )
}

/** The whole record at once, for somebody only reading. Each measure is shown with the employee's own answer. */
function ReadOnlyList({ lines, bands }: { lines: KraLine[]; bands: Band[] }) {
  const { C } = useTheme()
  return (
    <View style={{ gap: S.sm }}>
      {lines.map(l => (
        <View key={l.seqNo} style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md }}>
          <Txt size={F.small} w={700}>{l.seqNo}. {l.title || 'untitled'}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            <Pill kind="brand" label={`${l.weightage}%`} />
            {!!l.category && <Pill kind="grey" label={l.category.toLowerCase()} />}
            {!!l.status && <Pill kind={l.status === 'LOCKED' ? 'green' : 'amber'} label={l.status.replace(/_/g, ' ').toLowerCase()} />}
            {l.source === 'CARRIED_FORWARD' && <Pill kind="blue" label="carried forward" />}
          </View>
          {(l.kpis ?? []).length ? (l.kpis ?? []).map(k => (
            <View key={k.kpiId} style={{ marginTop: S.sm, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line, gap: 2 }}>
              <Txt size={F.tiny} w={600}>{k.metric || '—'}{k.target ? ` · target ${k.target}` : ''}</Txt>
              <K>They delivered: {k.achievement || 'Nothing recorded.'}</K>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><K>They rated themselves</K>{k.selfRating == null ? <K>Not rated</K> : <RDot v={k.selfRating} bands={bands} />}</View>
              {!!k.selfComment && <K style={{ fontStyle: 'italic' }}>“{k.selfComment}”</K>}
            </View>
          )) : (
            <View style={{ marginTop: S.sm, gap: 2 }}>
              <K>How it is measured: {l.kpi || '—'}</K>
              <K>Target: {l.target || '—'}</K>
              <K>They delivered: {l.achievement || 'Nothing recorded.'}</K>
            </View>
          )}
        </View>
      ))}
    </View>
  )
}

export interface KraPanelProps {
  member: TeamMember; lines: KraLine[] | null; onClose: () => void
  /** The rung the viewer holds on this appraisal. Absent: read-only. */
  myRung: ConfirmStage | null
  rate: Rate; onRate: (kpiId: string, patch: { rating?: number | null; comment?: string }) => void
  bands: Band[]; confirmed: boolean; onConfirm: (v: boolean) => void; alreadyConfirmed: boolean
  finalises: boolean; finalRating: string; onFinalRating: (v: string) => void
  overall: string; onOverall: (s: string) => void
  training: TrainingDraft[]; onTraining: (t: TrainingDraft[]) => void; ai?: AiBin
  pip: PipIntent; onPip: (p: Partial<PipIntent>) => void; recog: RecognitionIntent; onRecog: (r: Partial<RecognitionIntent>) => void
  today: string; onApprove: (finalRating?: number) => void; saving?: boolean
}

export function KraPanel(p: KraPanelProps) {
  const { C } = useTheme()
  const { confirm } = useOverlay()
  const [stepAt, setStepAt] = React.useState(0)
  const [pickFinal, setPickFinal] = React.useState(false)
  const stepRef = React.useRef<View>(null)
  const reveal = useReveal()
  const lines = p.lines
  const rating = !!p.myRung
  const cmp = compareFor(lines, p.rate)
  const total = (lines ?? []).reduce((s, l) => s + (Number(l.weightage) || 0), 0)
  const unsaved = cmp.lines.filter(l => l.mine != null || l.hasReason).length
  const tryClose = async () => {
    if (unsaved > 0 && rating) {
      const ok = await confirm({ title: 'Discard this review?', destructive: true, confirm: 'Discard', cancel: 'Keep editing',
        message: `${unsaved === 1 ? 'One KRA has your rating or your reason on it.' : `${unsaved} KRAs have your rating or your reason on them.`} Nothing here is saved until you send it on.` })
      if (!ok) return
    }
    p.onClose()
  }
  const gate = panelGate({ cmp, alreadyConfirmed: p.alreadyConfirmed, confirmed: p.confirmed, finalises: p.finalises, finalRating: p.finalRating,
    bands: p.bands, overall: p.overall, training: p.training, pip: p.pip, recog: p.recog })
  const jump = (kpiId: string) => {
    const i = (lines ?? []).findIndex(l => (l.kpis ?? []).some(k => k.kpiId === kpiId))
    if (i >= 0) { setStepAt(i); reveal(stepRef.current) }
  }
  const fb = p.finalRating ? p.bands.find(b => String(b.value) === p.finalRating) : null

  return (
    <PCard>
      <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'flex-start' }}>
        <Ava name={p.member.name} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.lead} w={700}>{p.member.name}</Txt>
          <K>{p.member.code} · {lines?.length ?? 0} KRAs, weightage {total}{p.myRung ? <> · You are <B>{STAGE_SHORT[p.myRung]}</B> on this</> : null}</K>
        </View>
        <Pressable onPress={() => void tryClose()} hitSlop={8} accessibilityRole="button"
          accessibilityLabel={unsaved > 0 && rating ? `Close without saving ${unsaved} rated KRA${unsaved === 1 ? '' : 's'}` : 'Close this review'}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.criticalTint, borderWidth: 1, borderColor: C.criticalEdge }}>
          <Txt size={F.title} w={700} tone="critical">×</Txt>
        </Pressable>
      </View>
      <K style={{ marginTop: S.sm }}>
        {!rating ? 'The KRA form as they filled it, read-only.' : p.finalises ? 'Yours is the last review. What you settle here is the rating they are told.' : 'Read it, score it, and send it up the chain.'}
      </K>
      {cmp.total > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.md }}>
          <Score label="They said" value={cmp.selfScore === null ? '—' : cmp.selfScore.toFixed(2)} />
          {rating && <Score label="You say" value={cmp.myScore === null ? '—' : cmp.myScore.toFixed(2)} mine />}
          {rating && cmp.delta !== null && cmp.delta !== 0 && <Score label="Difference" value={cmp.delta > 0 ? `+${cmp.delta}` : String(cmp.delta)} />}
        </View>
      )}

      {/* How far through this is, and a chip per KRA that is also the stepper's control. */}
      {rating && cmp.total > 0 && (
        <View style={{ marginTop: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.sunken, gap: S.sm }}>
          <Txt size={F.small} w={700}>
            {cmp.rated === cmp.total ? `All ${cmp.total} rated` : `${cmp.rated} of ${cmp.total} rated`}
            <Txt size={F.tiny} tone="muted">{cmp.rated === cmp.total ? ' · check the comparison below' : ` · ${cmp.total - cmp.rated} to go`}</Txt>
          </Txt>
          <Bar pct={(cmp.rated / cmp.total) * 100} tone={cmp.rated === cmp.total ? 'green' : 'brand'} />
          <View accessibilityLabel="Go to a KRA" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(lines ?? []).map((l, i) => {
              const ch = kraChip(l, cmp)
              const at = i === stepAt
              return (
                <Pressable key={l.goalId ?? i} onPress={() => setStepAt(i)} accessibilityRole="button"
                  accessibilityLabel={`Go to KRA ${i + 1}, ${l.title} — ${ch.rated} of ${ch.of} measures rated${ch.needs ? ', one needs a reason' : ''}`}
                  style={{ minWidth: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: at ? 2 : 1,
                    borderColor: at ? C.brand : ch.done ? C.positive : ch.needs ? C.info : C.line,
                    backgroundColor: ch.done ? C.positiveTint : ch.needs ? C.infoTint : C.surface }}>
                  <Txt size={F.small} w={800} color={ch.done ? C.positive : ch.needs ? C.info : C.ink}>{i + 1}</Txt>
                </Pressable>
              )
            })}
            {(lines ?? []).length > 0 && (
              <Pressable onPress={() => setStepAt((lines ?? []).length)} accessibilityRole="button" accessibilityLabel="Go to the review step"
                style={{ minWidth: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: stepAt >= (lines ?? []).length ? 2 : 1,
                  borderColor: stepAt >= (lines ?? []).length ? C.brand : C.line, backgroundColor: C.surface }}>
                <Txt size={F.small} w={800} tone="brand">✓</Txt>
              </Pressable>
            )}
          </View>
          {cmp.missingReasons.length > 0 && <Pill kind="amber" label={`${cmp.missingReasons.length} need${cmp.missingReasons.length === 1 ? 's' : ''} a reason`} />}
        </View>
      )}

      <View ref={stepRef} style={{ marginTop: S.lg }}>
        {lines === null ? <K>Loading their form…</K>
          : !lines.length ? <EmptyBlock title="Nothing written yet" note="They have not saved any KRAs for this period." />
          : rating ? <Stepper lines={lines} rate={p.rate} onRate={p.onRate} bands={p.bands} at={stepAt} onAt={setStepAt} />
          : <ReadOnlyList lines={lines} bands={p.bands} />}
      </View>

      {rating && p.myRung && (
        <View style={{ marginTop: S.lg }}>
          <RatingSummary s={cmp} onJump={jump} />
          <OverallComment value={p.overall} onChange={p.onOverall} myScore={cmp.myScore} bands={p.bands} />
          <TrainingBlock rows={p.training} onChange={p.onTraining} ai={p.ai} />
          <ScoreInvitesBlock invites={scoreInvites(cmp.myScore, p.bands)} pip={p.pip} onPip={p.onPip} rec={p.recog} onRec={p.onRecog} today={p.today} />
          <ConfirmStep rung={p.myRung} confirmed={p.confirmed} onConfirm={p.onConfirm} alreadyConfirmed={p.alreadyConfirmed} />
          {!gate.ready && (
            <Banner tone="amber" glyph="!" raw>
              <Txt size={F.tiny} w={700} tone="warning">Before this can go on:</Txt>
              {!gate.allRated && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• Rate every KRA — {gate.rated} of {gate.total} done. The next rung cannot settle anything until yours are in.</Txt>}
              {!gate.reasoned && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• Say why where your rating differs from theirs — {cmp.missingReasons.length} still unexplained ({cmp.missingReasons.map(m => m.title).join(', ')}).</Txt>}
              {!gate.remark.ok && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• {gate.remark.fault}</Txt>}
              {gate.trainingFaults.map(f => <Txt key={f} size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• {f}</Txt>)}
              {!!gate.pipFault && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• {gate.pipFault}</Txt>}
              {!!gate.recFault && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• {gate.recFault}</Txt>}
              {!gate.ticked && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• Confirm the one-to-one above.</Txt>}
              {!gate.frOk && <Txt size={F.tiny} tone="warning" style={{ marginTop: 4 }}>• Give the final rating ({gate.lo}–{gate.hi}). Yours is the last approval, so this is the number they are told.</Txt>}
            </Banner>
          )}
          {p.finalises && (
            <PickerField label="Final rating" value={fb ? `${fb.value} · ${fb.label}` : ''} placeholder="Choose…" onPress={() => setPickFinal(true)} />
          )}
          <View style={{ gap: S.sm }}>
            <Button full disabled={!gate.ready || p.saving} onPress={() => p.onApprove(p.finalises ? gate.fr ?? undefined : undefined)}
              title={p.saving ? 'Sending…' : !gate.ready ? 'Not ready to send on' : p.finalises ? 'Rate, confirm and finalise' : 'Rate, confirm and approve'} />
            <Button full variant="outline" title="Close" onPress={() => void tryClose()} />
          </View>
          <SelectSheet visible={pickFinal} onClose={() => setPickFinal(false)} title="Final rating" value={p.finalRating}
            options={[{ value: '', label: 'Choose…' }, ...p.bands.map(b => ({ value: String(b.value), label: `${b.value} · ${b.label}` }))]}
            onPick={v => p.onFinalRating(String(v))} />
        </View>
      )}
      {!rating && <Button variant="outline" title="Close" onPress={p.onClose} style={{ marginTop: S.lg, alignSelf: 'flex-start' }} />}
    </PCard>
  )
}

function Score({ label, value, mine }: { label: string; value: string; mine?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flexGrow: 1, minWidth: 92, padding: S.sm, borderRadius: R.md, borderWidth: 1, borderColor: mine ? C.brandEdge : C.line, backgroundColor: mine ? C.brandTint : C.surface }}>
      <Txt size={F.micro} w={700} tone="muted" upper>{label}</Txt>
      <Txt size={F.title} w={800} color={mine ? C.brandDeep : C.ink}>{value}</Txt>
    </View>
  )
}
