// src/features/performance/EmpTabsA.tsx — the chain banner, My Dashboard and
// My KRAs (website: components/pms/EmployeeTabs.tsx ChainBanner, §3.1–3.2).
// Tables become one card per row; every rule comes from lib/pms (checkKras,
// canAdd, canDelete, meter, suggestSplit, bandFor), imported, never restated.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { STAGES, DEFAULT_RULES, type Rules, type StageKey, type StageState } from '@web/pms/cycle'
import { checkKras, canAdd, canDelete, meter, suggestSplit, CATEGORIES, CATEGORY_LABEL, type Kra, type Category } from '@web/pms/kra'
import { bandFor, DEFAULT_BANDS, type Band } from '@web/pms/scoring'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { B, Banner, EmptyBlock, K, PCard, PStat, StatGrid } from './ui'
import type { Who } from './data'
import type { KraSelf } from './actions'

// ── where it is in the chain, and why it came back ───────────────────────
const WITH: Record<string, string> = {
  RM_L1: 'your reporting manager', RM_L2: 'your second-level manager',
  HOD: 'your head of department', HR: 'HR, to publish',
}
export function ChainBanner({ stage, sentBackReason, sentBackAt }: { stage?: string | null; sentBackReason?: string | null; sentBackAt?: string | null }) {
  if (!stage || stage === 'DONE') return null
  if (stage === 'EMPLOYEE' && sentBackReason) {
    return (
      <Banner tone="red" glyph="↩️">
        <B>Sent back to you{sentBackAt ? ` on ${sentBackAt.slice(0, 10)}` : ''}.</B> Change what is asked for below and send it again.
        {'\n'}<Txt size={F.tiny} tone="critical" style={{ fontStyle: 'italic' }}>“{sentBackReason}”</Txt>
      </Banner>
    )
  }
  if (stage === 'EMPLOYEE') {
    return <Banner tone="amber" glyph="↩️">This is back with you. No reason was recorded — ask your manager what they want changed.</Banner>
  }
  return <Banner tone="blue" glyph="⏳">Your KRAs and ratings are with {WITH[stage] ?? stage} for approval.</Banner>
}

// ── §3.1 My Dashboard ────────────────────────────────────────────────────
export function DashboardTab({ who, stages, current, kraCount, weightage, frequency, periodLabel, lastRating, lastScore, actionLabel, actionNote, bands = DEFAULT_BANDS, rules = DEFAULT_RULES }: {
  who: Who
  stages: { key: StageKey; state: StageState; detail?: string }[]
  current: StageKey
  kraCount: number; weightage: number; frequency: string; periodLabel: string
  lastRating: number | null; lastScore: number | null
  actionLabel: string; actionNote: string
  bands?: Band[]; rules?: Rules
}) {
  const { C } = useTheme()
  const setOk = kraCount >= rules.minKra && weightage === rules.totalWeightage
  const band = bandFor(lastRating, bands)
  return (
    <>
      <PCard title={`${who.name} · ${who.code}`} sub={[who.designation].filter(Boolean).join(' · ')}>
        <View style={{ gap: 2 }}>
          {STAGES.map((s, i) => {
            const st = stages.find(x => x.key === s.key)
            const done = st?.state === 'done'
            const now = !done && s.key === current
            return (
              <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 5 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: done ? C.positive : now ? C.brand : C.sunken, borderWidth: now ? 4 : 0, borderColor: C.brandTint, margin: now ? -4 : 0 }}>
                  <Txt size={F.micro} w={800} color={done || now ? C.onAccent : C.muted}>{i + 1}</Txt>
                </View>
                <Txt size={F.micro} w={700} style={{ flex: 1 }}>{s.label}</Txt>
                {!!st?.detail && <Txt size={10} tone="muted">{st.detail}</Txt>}
              </View>
            )
          })}
        </View>
      </PCard>

      <StatGrid>
        <PStat tone="accent" label="Owed from you" value={actionLabel} note={actionNote} />
        <PStat label="My KRAs" value={kraCount} tone={setOk ? undefined : 'warn'}
          note={setOk ? `Totalling ${weightage}. The set is valid`
            : `Totalling ${weightage}. Needs ${rules.minKra}–${rules.maxKra} KRAs at exactly ${rules.totalWeightage}`} />
        <PStat label="How often" value={frequency} note={periodLabel} />
        <PStat label="Last time" value={lastRating === null ? '-' : `${lastRating}${band ? ` · ${band.label}` : ''}`}
          note={lastScore === null ? 'No previous period on record' : `Weighted score ${lastScore}`} />
      </StatGrid>

      <Banner tone="blue" glyph="ℹ️">
        This is a <B>developmental</B> review. The rating is not linked to any increment, variable pay, bonus or CTC. It exists to give you feedback and to decide what support you get next. Recognition here is a certificate, a nomination or an award, never a cash component.
      </Banner>
    </>
  )
}

// ── §3.2 My KRAs ─────────────────────────────────────────────────────────
interface RowProps {
  k: Kra; i: number; locked: boolean; thin: boolean; canRemove: boolean; removeWhy?: string
  onSet: (i: number, patch: Partial<Kra>) => void; onRemove: (i: number) => void; onPickCategory: (i: number) => void
  /** §3's merge — rated beside the KRA it belongs to. */
  self?: KraSelf; onSelf?: (seq: number, patch: Partial<KraSelf>) => void; selfLocked: boolean; bands: Band[]
}
function KraRow({ k, i, locked, thin, canRemove, removeWhy, onSet, onRemove, onPickCategory, self, onSelf, selfLocked, bands }: RowProps) {
  const { C } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.md, backgroundColor: C.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: S.sm }}>
        <Txt size={F.small} w={700} style={{ flex: 1 }}>#{i + 1}</Txt>
        {!locked && (
          <Pressable onPress={canRemove ? () => onRemove(i) : undefined} accessibilityRole="button" accessibilityLabel={`Remove KRA ${i + 1}`}
            accessibilityState={{ disabled: !canRemove }} hitSlop={6}
            style={{ minWidth: 44, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: R.sm, opacity: canRemove ? 1 : 0.4 }}>
            <Txt size={F.lead} w={700} tone="brand">×</Txt>
          </Pressable>
        )}
      </View>
      {!locked && !canRemove && !!removeWhy && <K style={{ marginTop: -6, marginBottom: S.sm }}>{removeWhy}</K>}
      <Input label="KRA / objective" value={k.kra_title} editable={!locked} placeholder="What you are accountable for"
        accessibilityLabel={`KRA ${i + 1} title`} onChangeText={t => onSet(i, { kra_title: t })} />
      <Input label="KPI metric" value={k.kpi_metric} editable={!locked} placeholder="How it is measured"
        accessibilityLabel={`KRA ${i + 1} metric`} onChangeText={t => onSet(i, { kpi_metric: t })} />
      <Input label="Target" value={k.target_value} editable={!locked} placeholder="The number to hit"
        accessibilityLabel={`KRA ${i + 1} target`} onChangeText={t => onSet(i, { target_value: t })} />
      <View style={{ flexDirection: 'row', gap: S.md }}>
        <PickerField label="Category" value={CATEGORY_LABEL[k.category]} disabled={locked} onPress={() => onPickCategory(i)} style={{ flex: 1 }} />
        <Input label="Weightage" value={String(k.weightage)} editable={!locked} keyboardType="number-pad" style={{ width: 110 }}
          accessibilityLabel={`KRA ${i + 1} weightage`} error={thin ? ' ' : undefined}
          onChangeText={t => onSet(i, { weightage: Number(t.replace(/[^0-9.]/g, '')) || 0 })} />
      </View>
      {!!onSelf && (
        <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.md, marginTop: 2 }}>
          <Input label="What you delivered" value={self?.achievement ?? ''} editable={!selfLocked} placeholder="The number you actually hit"
            accessibilityLabel={`Achievement for KRA ${i + 1}`} onChangeText={t => onSelf(k.seq_no, { achievement: t })} />
          <Input value={self?.comment ?? ''} editable={!selfLocked} placeholder="Evidence a manager could check"
            accessibilityLabel={`Comment for KRA ${i + 1}`} onChangeText={t => onSelf(k.seq_no, { comment: t })} />
          <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Your rating</Txt>
          <View accessibilityRole="radiogroup" accessibilityLabel={`Your rating for KRA ${i + 1}`} style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {bands.map(b => {
              const on = self?.rating === b.value
              return (
                <Pressable key={b.value} disabled={selfLocked} onPress={() => onSelf(k.seq_no, { rating: b.value })}
                  accessibilityRole="radio" accessibilityState={{ checked: on, disabled: selfLocked }} accessibilityLabel={`${b.value}: ${b.label}`}
                  style={{ minWidth: 44, height: 44, borderRadius: R.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                    borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brand : C.surface, opacity: selfLocked && !on ? 0.6 : 1 }}>
                  <Txt size={F.small} w={800} color={on ? C.onAccent : C.brand}>{b.value}</Txt>
                </Pressable>
              )
            })}
          </View>
        </View>
      )}
    </View>
  )
}

export function KraTab({ kras, onChange, locked, lockGate, onSubmit, saving, rules = DEFAULT_RULES, carriedFrom, self, onSelfChange, bands = DEFAULT_BANDS, rateRequired = false, selfSubmitted = false }: {
  kras: Kra[]; onChange: (next: Kra[]) => void; locked: boolean
  lockGate: { open: boolean; because: string }; onSubmit: () => void; saving?: boolean
  rules?: Rules; carriedFrom?: string | null
  self?: Record<number, KraSelf>; onSelfChange?: (seq: number, patch: Partial<KraSelf>) => void
  bands?: Band[]; rateRequired?: boolean; selfSubmitted?: boolean
}) {
  const { C } = useTheme()
  const [catFor, setCatFor] = React.useState<number | null>(null)
  // As on the website: checkKras / canAdd / canDelete / meter are called without the policy rules.
  const check = checkKras(kras)
  const unrated = rateRequired ? kras.filter(k => (self?.[k.seq_no]?.rating ?? null) === null).length : 0
  const canGo = check.canSubmit && unrated === 0
  const m = meter(check)
  const add = canAdd(kras)
  const del = canDelete(kras)
  const set = (i: number, patch: Partial<Kra>) => onChange(kras.map((k, j) => j === i ? { ...k, ...patch } : k))
  const remove = (i: number) => onChange(kras.filter((_, j) => j !== i).map((x, j) => ({ ...x, seq_no: j + 1 })))
  const meterColour = m.tone === 'good' ? C.positive : m.tone === 'bad' ? C.critical : C.warning
  const rateLeft = `Rate the last ${unrated} ${unrated === 1 ? 'KRA' : 'KRAs'} first`
  const submitTitle = saving ? 'Saving…'
    : selfSubmitted ? 'Already sent'
    : locked ? (unrated > 0 ? rateLeft : 'Send my ratings to my manager')
    : !check.canSubmit ? `Cannot send yet: ${check.faults.length} to fix`
    : unrated > 0 ? rateLeft
    : rateRequired ? 'Send KRAs and my ratings to my manager'
    : 'Send to my manager'

  return (
    <>
      {locked ? (
        <Banner tone="amber" glyph="🔒">
          Your weightages are <B>locked</B>. They were settled in the KRA one-to-one and acknowledged by both of you, which is what makes them the thing your rating is measured against. A change now needs your manager to reopen them.
        </Banner>
      ) : (
        <Banner tone="amber" glyph="⚠️">
          You write your own KRAs and weightages, but a <B>one-to-one with your manager is required before they lock</B>. {lockGate.because}
        </Banner>
      )}

      <View style={{ backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, marginBottom: 12, gap: S.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Txt size={26} w={800} color={m.tone === 'good' ? C.positive : m.tone === 'bad' ? C.critical : C.ink} style={{ minWidth: 56 }}>{check.total}</Txt>
          <View style={{ flex: 1, gap: 6 }}>
            <View accessibilityRole="progressbar" accessibilityLabel="Total weightage" style={{ height: 8, borderRadius: 4, backgroundColor: C.surface, overflow: 'hidden' }}>
              <View style={{ width: `${m.pct}%`, height: '100%', backgroundColor: meterColour, borderRadius: 4 }} />
            </View>
            <K>{m.says} · {check.count} {check.count === 1 ? 'KRA' : 'KRAs'} (minimum {rules.minKra}, maximum {rules.maxKra})</K>
          </View>
        </View>
        {!locked && (
          <View>
            <Button title="+ Add KRA" variant="ghost" size="sm" disabled={!add.allowed}
              onPress={() => onChange([...kras, { seq_no: kras.length + 1, kra_title: '', kpi_metric: '', target_value: '', category: 'BUSINESS', weightage: 0 }])} />
            {!add.allowed && !!add.reason && <K>{add.reason}</K>}
          </View>
        )}
      </View>

      <PCard title="My KRAs" sub={`At least ${rules.minKra}, at most ${rules.maxKra}, and the weightages must total exactly ${rules.totalWeightage}.`}>
        {!!carriedFrom && (
          <Banner tone="blue" glyph="↻">
            These are your KRAs from <B>{carriedFrom}</B>, carried forward as the starting point. Change whatever the new quarter needs — and anything the two of you agree in the one-to-one gets recorded there, including the weightage moves. Nothing is saved until you send it to your manager.
          </Banner>
        )}
        {kras.length === 0 ? (
          <EmptyBlock title="Nothing written yet" note={`Add ${rules.minKra} to ${rules.maxKra} KRAs. They are what your rating will be measured against, so they are worth the time.`} />
        ) : kras.map((k, i) => (
          <KraRow key={i} k={k} i={i} locked={locked} thin={check.thin.includes(k.seq_no)} canRemove={del.allowed} removeWhy={del.reason}
            onSet={set} onRemove={remove} onPickCategory={setCatFor}
            self={self?.[k.seq_no]} onSelf={onSelfChange} selfLocked={selfSubmitted} bands={bands} />
        ))}

        {check.faults.length > 0 && (
          <Banner tone="red" glyph="!" raw style={{ marginTop: 2, marginBottom: 0 }}>
            <Txt size={F.tiny} w={700} tone="critical">Before this can be sent:</Txt>
            {check.faults.map((f, i) => (
              <Txt key={i} size={F.tiny} tone="critical" style={{ marginTop: 4 }}>
                • {f.seq !== null && <B>KRA {f.seq}: </B>}{f.says}
              </Txt>
            ))}
          </Banner>
        )}

        {(!locked || !selfSubmitted) && (
          <View style={{ gap: S.sm, marginTop: S.lg }}>
            <Button full disabled={(locked ? unrated > 0 : !canGo) || selfSubmitted || saving} onPress={onSubmit} title={submitTitle} />
            {check.total !== rules.totalWeightage && kras.length > 0 && (
              <Button full variant="ghost" title={`Split ${rules.totalWeightage} evenly`}
                onPress={() => onChange(kras.map((k, i) => ({ ...k, weightage: suggestSplit(kras.length)[i] })))} />
            )}
          </View>
        )}
      </PCard>

      <SelectSheet visible={catFor !== null} onClose={() => setCatFor(null)} title="Category"
        options={CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABEL[c] }))}
        value={catFor !== null ? kras[catFor]?.category : undefined}
        onPick={v => { if (catFor !== null) set(catFor, { category: v as Category }) }} />
    </>
  )
}
