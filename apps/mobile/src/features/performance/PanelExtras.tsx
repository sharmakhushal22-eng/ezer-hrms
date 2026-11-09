// src/features/performance/PanelExtras.tsx — the blocks under the KRAs in the
// reviewer's panel (website: components/pms/ManagerTabs.tsx RatingSummary,
// the overall comment with its live remark count, TrainingBlock +
// SuggestionBin, ScoreInvitesBlock, and the one-to-one step). Rules come from
// lib/pms/scoring (checkRaterRemark) and lib/pms/training. Dragging a
// suggestion card is a pointer shortcut on the website; "Add to my list" is
// the same action and is what a phone uses.
import * as React from 'react'
import { View } from 'react-native'
import { checkRaterRemark, type Band, type CompareSummary } from '@web/pms/scoring'
import { CONFIRM_LABEL, CONFIRM_WHY, type ConfirmStage } from '@web/pms/oneToOne'
import { checkPip, checkRecognition, checkTrainingBlock, RECOGNITION_KINDS, RECOGNITION_LABEL, TRAINING_CATEGORIES, TRAINING_CATEGORY_LABEL, TRAINING_EXAMPLE,
  type PipIntent, type RecognitionIntent, type RecognitionKind, type ScoreInvites, type TrainingCategory } from '@web/pms/training'
import type { BinSuggestion } from '@web/pms/trainingAi'
import { humanDate } from '@web/pms/cycle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Checkbox, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet } from '@/ui/overlays'
import { B, Banner, K, PCard, Pill } from './ui'
import { EMPTY_TRAINING, type TrainingDraft } from './logic'

const arrow = (d: number | null) => (d === null ? '' : d > 0 ? `+${d} up` : d < 0 ? `${d} down` : 'same')

/** RatingSummary — "Line by line against theirs", with a way to the missing reason. */
export function RatingSummary({ s, onJump }: { s: CompareSummary; onJump: (kpiId: string) => void }) {
  const { C } = useTheme()
  if (!s.total) return null
  const sub = s.rated === 0 ? 'Fills in as you rate. They will see this same comparison.'
    : `${s.rated} of ${s.total} rated · ${s.agreed} the same, ${s.higher} higher, ${s.lower} lower than they said.`
      + (s.delta === null ? '' : s.delta === 0 ? ' Overall you agree.' : ` Overall ${s.delta > 0 ? '+' : ''}${s.delta} against their own score.`)
  return (
    <PCard title="Line by line against theirs" sub={sub}>
      {s.lines.map((l, i) => (
        <View key={l.goalId} style={{ paddingVertical: S.sm, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 4 }}>
          <Txt size={F.small} w={600}>{l.title}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.sm }}>
            <K>Wt {Number.isInteger(l.weightage) ? l.weightage : l.weightage.toFixed(2)}</K>
            <K>Theirs <Txt size={F.micro} w={700}>{l.self ?? '—'}</Txt></K>
            <K>Yours <Txt size={F.micro} w={700}>{l.mine ?? 'not yet'}</Txt></K>
            {l.delta === null ? null : l.flag === 'MAJOR_GAP' ? <Pill kind="amber" label={arrow(l.delta)} />
              : l.flag === 'MINOR_GAP' ? <Pill kind="blue" label={arrow(l.delta)} /> : <Pill kind="green" label="agreed" />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <K>Your reason:</K>
            {!l.needsReason ? <K>not needed</K> : l.hasReason ? <Pill kind="green" label="given" />
              : <Button size="sm" variant="ghost" title="Say why →" onPress={() => onJump(l.goalId)} />}
          </View>
        </View>
      ))}
      {s.missingReasons.length > 0 && (
        <Banner tone="amber" glyph="!" style={{ marginTop: S.md, marginBottom: 0 }}>
          <B>{s.missingReasons.length === 1 ? 'One rating differs from theirs and has no reason yet.' : `${s.missingReasons.length} ratings differ from theirs with no reason yet.`}</B>
          {'\n'}They will see your number next to their own. A difference you have not explained is the single most common thing an appraisal is disputed over — and you will not remember the reason in March.
        </Banner>
      )}
    </PCard>
  )
}

/** The overall comment, with the band's live character demand (rules 10 and 11). */
export function OverallComment({ value, onChange, myScore, bands }: { value: string; onChange: (s: string) => void; myScore: number | null; bands: Band[] }) {
  const { C } = useTheme()
  const r = checkRaterRemark(myScore, value, bands)
  return (
    <View style={{ marginBottom: S.md }}>
      <Input label="Overall comment (optional)" value={value} onChangeText={onChange} multiline style={{ marginBottom: 4 }}
        placeholder="The appraisal as a whole, in your words. Evidence, not adjectives — they read this." />
      {!r.band ? <K>Rate the KRAs and this will say how much the resulting band asks for.</K> : (
        <K>
          <Txt size={F.micro} w={700} color={r.ok ? C.positive : C.warning}>{r.have} / {r.need} characters</Txt>
          {' '}— your score of {myScore?.toFixed(2)} lands in <B>{r.band.label}</B>, which asks for {r.need}.
          {r.improvementNeeded ? <> At this band it must also say <B>what would change it</B>.</> : null}
          {' '}Held back until the result is published; the per-KRA reasons above are separate.
        </K>
      )}
    </View>
  )
}

export interface AiBin { suggestions: BinSuggestion[] | null; busy?: boolean; note?: string | null; onGenerate?: () => void; onDismiss?: (s: BinSuggestion) => void }

function SuggestionBin({ ai, onTake }: { ai: AiBin; onTake: (s: BinSuggestion) => void }) {
  const { C } = useTheme()
  const live = (ai.suggestions ?? []).filter(s => s.status !== 'DISMISSED')
  return (
    <View style={{ borderWidth: 1, borderColor: C.brandEdge, backgroundColor: C.brandTint, borderRadius: R.md, padding: S.md, marginBottom: S.md, gap: S.sm }}>
      <Txt size={F.micro} w={700} tone="muted" upper>Suggested for you</Txt>
      <K>Read from the ratings and the words you have written. Nothing is sent with their name on it.</K>
      <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} disabled={ai.busy || !ai.onGenerate} onPress={ai.onGenerate}
        title={ai.busy ? 'Reading the appraisal…' : live.length ? 'Suggest again' : '✨ Suggest training'} />
      {!!ai.note && <K>{ai.note}</K>}
      {!live.length && !ai.busy && !ai.note && <K>Nothing suggested yet. Rate a few objectives and say what you have seen, then ask — the more you have written, the better this gets.</K>}
      {live.map(s => (
        <View key={s.id ?? s.trainingName} style={{ borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, borderRadius: R.md, padding: S.md, gap: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.sm }}>
            <Pill kind={s.source === 'CATALOGUE' ? 'green' : 'blue'} label={s.source === 'CATALOGUE' ? 'in your catalogue' : 'skill area'} />
            <K>{TRAINING_CATEGORY_LABEL[s.category as TrainingCategory] ?? s.category}</K>
          </View>
          <Txt size={F.small} w={700}>{s.trainingName}</Txt>
          {!!s.rationale && <K>{s.rationale}</K>}
          <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap', marginTop: 4 }}>
            <Button size="sm" title="Add to my list" onPress={() => onTake(s)} />
            <Button size="sm" variant="ghost" title="Not this" disabled={!ai.onDismiss} onPress={() => ai.onDismiss?.(s)} />
          </View>
        </View>
      ))}
      {live.length > 0 && <K>Use <B>Add to my list</B> to take one. Nothing is recorded until you approve.</K>}
    </View>
  )
}

/** Training this rater would suggest — optional and offered at every band. */
export function TrainingBlock({ rows, onChange, ai }: { rows: TrainingDraft[]; onChange: (next: TrainingDraft[]) => void; ai?: AiBin }) {
  const { C } = useTheme()
  const [kindFor, setKindFor] = React.useState<number | null>(null)
  const set = (i: number, patch: Partial<TrainingDraft>) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  const faults = checkTrainingBlock(rows)
  // Taking a suggestion fills the first empty row, or adds one; never the same name twice.
  const take = (s: BinSuggestion) => {
    if (rows.some(r => (r.trainingName ?? '').trim().toLowerCase() === s.trainingName.toLowerCase())) return
    const blank = rows.findIndex(r => !(r.trainingName ?? '').trim() && !(r.details ?? '').trim())
    const filled: TrainingDraft = { trainingName: s.trainingName, category: s.category, details: s.rationale ?? '' }
    onChange(blank >= 0 ? rows.map((r, i) => i === blank ? filled : r) : [...rows, filled])
  }
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.md, backgroundColor: C.surface }}>
      <Txt size={F.micro} w={700} tone="muted" upper>Training you would suggest (optional)</Txt>
      <K style={{ marginTop: 2, marginBottom: S.md }}>Anything that would make the next year easier for them — a tool, a behaviour, a qualification. HR sees these with the result and decides; suggesting one does not commit a budget.</K>
      {!!ai && <SuggestionBin ai={ai} onTake={take} />}
      {rows.map((r, i) => (
        <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: C.line, paddingTop: i ? S.md : 0 }}>
          <Input label="Training" value={r.trainingName} placeholder={TRAINING_EXAMPLE[r.category]} onChangeText={t => set(i, { trainingName: t })} />
          <PickerField label="Kind" value={TRAINING_CATEGORY_LABEL[r.category]} onPress={() => setKindFor(i)} />
          <Input label="Why it would help" value={r.details} placeholder="What it would change, in a line" onChangeText={t => set(i, { details: t })} />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        <Button size="sm" variant="ghost" title="+ Suggest another" onPress={() => onChange([...rows, { ...EMPTY_TRAINING }])} />
        {rows.length > 1 && <Button size="sm" variant="ghost" title="Remove the last" onPress={() => onChange(rows.slice(0, -1))} />}
      </View>
      {faults.length > 0 && <Banner tone="amber" glyph="!" style={{ marginTop: S.md, marginBottom: 0 }}>{faults.join(' ')}</Banner>}
      <SelectSheet visible={kindFor !== null} onClose={() => setKindFor(null)} title="Kind" value={kindFor !== null ? rows[kindFor]?.category : undefined}
        options={TRAINING_CATEGORIES.map(c => ({ value: c, label: TRAINING_CATEGORY_LABEL[c] }))}
        onPick={v => { if (kindFor !== null) set(kindFor, { category: v as TrainingCategory }) }} />
    </View>
  )
}

/** What the score invites: a PIP request at the low end, recognition at the high end — both optional, both HR's to decide. */
export function ScoreInvitesBlock({ invites, pip, onPip, rec, onRec, today }: {
  invites: ScoreInvites; pip: PipIntent; onPip: (p: Partial<PipIntent>) => void
  rec: RecognitionIntent; onRec: (r: Partial<RecognitionIntent>) => void; today: string
}) {
  const { C } = useTheme()
  const [sheet, setSheet] = React.useState<null | 'from' | 'to' | 'kind'>(null)
  if (!invites.band || (!invites.pip && !invites.recognition)) return null
  const pipFault = checkPip(pip)
  const recFault = checkRecognition(rec)
  const band = invites.band
  return (
    <>
      {invites.pip && (
        <View style={{ borderWidth: 1, borderColor: pip.wanted ? C.warning : C.line, backgroundColor: pip.wanted ? C.warningTint : C.surface, borderRadius: R.md, paddingHorizontal: S.md, paddingBottom: pip.wanted ? S.md : 0, marginBottom: S.md }}>
          <Checkbox checked={pip.wanted} onChange={v => onPip({ wanted: v })} label={
            <View style={{ flex: 1 }}>
              <Txt size={F.small} w={700}>Request a performance improvement plan for them</Txt>
              <K style={{ marginTop: 3 }}>Optional. Your score of <B>{band.value}</B> ({band.label.toLowerCase()}) is a band where a plan can be raised. HR reviews the request and decides whether one starts — ticking this does not begin a PIP.</K>
            </View>} />
          {pip.wanted && (
            <View style={{ marginTop: S.sm }}>
              <Input label="Why a plan is needed" value={pip.reason} onChangeText={t => onPip({ reason: t })} multiline
                placeholder="What is going wrong, specifically, and what would have to change. HR reads this and so, eventually, does the employee." />
              <PickerField label="Proposed start" value={pip.proposedStart ? humanDate(pip.proposedStart) : ''} placeholder="Pick a date" onPress={() => setSheet('from')} />
              <PickerField label="Proposed end" value={pip.proposedEnd ? humanDate(pip.proposedEnd) : ''} placeholder="Pick a date" onPress={() => setSheet('to')} />
              {!!pipFault && <Banner tone="amber" glyph="!" style={{ marginTop: S.sm, marginBottom: 0 }}>{pipFault}</Banner>}
            </View>
          )}
        </View>
      )}
      {invites.recognition && (
        <View style={{ borderWidth: 1, borderColor: rec.wanted ? C.positive : C.line, backgroundColor: rec.wanted ? C.positiveTint : C.surface, borderRadius: R.md, paddingHorizontal: S.md, paddingBottom: rec.wanted ? S.md : 0, marginBottom: S.md }}>
          <Checkbox checked={rec.wanted} onChange={v => onRec({ wanted: v })} label={
            <View style={{ flex: 1 }}>
              <Txt size={F.small} w={700}>Recommend recognition for them</Txt>
              <K style={{ marginTop: 3 }}>Optional. Your score of <B>{band.value}</B> ({band.label.toLowerCase()}) is a band where recognition can be proposed. HR decides and awards it — nothing here grants a bonus.</K>
            </View>} />
          {rec.wanted && (
            <View style={{ marginTop: S.sm }}>
              <PickerField label="What you are proposing" value={RECOGNITION_LABEL[rec.kind]} onPress={() => setSheet('kind')} />
              <Input label="What it is for" value={rec.note} onChangeText={t => onRec({ note: t })} multiline
                placeholder="The case for it, in your words. HR approves this, and a bonus with no case attached is one they cannot sign off." />
              {!!recFault && <Banner tone="amber" glyph="!" style={{ marginTop: S.sm, marginBottom: 0 }}>{recFault}</Banner>}
            </View>
          )}
        </View>
      )}
      <DateSheet visible={sheet === 'from'} onClose={() => setSheet(null)} title="Proposed start" value={pip.proposedStart || null} min={today}
        onPick={d => onPip({ proposedStart: d })} />
      <DateSheet visible={sheet === 'to'} onClose={() => setSheet(null)} title="Proposed end" value={pip.proposedEnd || null} min={pip.proposedStart || today}
        onPick={d => onPip({ proposedEnd: d })} />
      <SelectSheet visible={sheet === 'kind'} onClose={() => setSheet(null)} title="What you are proposing" value={rec.kind}
        options={RECOGNITION_KINDS.map(k => ({ value: k, label: RECOGNITION_LABEL[k] }))} onPick={v => onRec({ kind: v as RecognitionKind })} />
    </>
  )
}

/** The one-to-one tick for this rung: a step, green once ticked or already on record. */
export function ConfirmStep({ rung, confirmed, onConfirm, alreadyConfirmed }: { rung: ConfirmStage; confirmed: boolean; onConfirm: (v: boolean) => void; alreadyConfirmed: boolean }) {
  const { C } = useTheme()
  const on = alreadyConfirmed || confirmed
  return (
    <View style={{ borderWidth: 1, borderColor: on ? C.positive : C.line, backgroundColor: on ? C.positiveTint : C.surface, borderRadius: R.md, paddingHorizontal: S.md, marginBottom: S.md }}>
      <Checkbox checked={on} disabled={alreadyConfirmed} onChange={onConfirm} label={
        <View style={{ flex: 1 }}>
          <Txt size={F.small} w={700}>{CONFIRM_LABEL[rung]}</Txt>
          <K style={{ marginTop: 3 }}>{CONFIRM_WHY[rung]}</K>
          {alreadyConfirmed && <Txt size={F.micro} w={600} tone="positive" style={{ marginTop: 4 }}>Already on record — you confirmed this earlier.</Txt>}
        </View>} />
    </View>
  )
}
