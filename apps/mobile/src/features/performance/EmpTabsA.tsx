// src/features/performance/EmpTabsA.tsx — My Dashboard, My KRAs, One-to-One Log
// (website: components/pms/EmployeeTabs.tsx §3.1–3.3). Tables become one card
// per row; every rule comes from lib/pms (checkKras, canAdd, canDelete, meter,
// suggestSplit, logRows, gates), imported, never restated.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { STAGES, DEFAULT_RULES, humanDate, type StageKey, type StageState } from '@web/pms/cycle'
import { checkKras, canAdd, canDelete, meter, suggestSplit, CATEGORIES, CATEGORY_LABEL, type Kra, type Category } from '@web/pms/kra'
import { logRows, canLockWeightage, canPublishResult, TYPE_LABEL, TYPE_PURPOSE, DISCUSSION_TYPES, MODES, MODE_LABEL, type Log, type DiscussionType, type Mode } from '@web/pms/oneToOne'
import { bandFor } from '@web/pms/scoring'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet } from '@/ui/overlays'
import { B, Banner, EmptyBlock, K, PCard, Pill, PStat, StatGrid, type PillKind } from './ui'
import type { Who } from './data'

// ── §3.1 My Dashboard ────────────────────────────────────────────────────
export function DashboardTab({ who, stages, current, kraCount, weightage, frequency, periodLabel, lastRating, lastScore, actionLabel, actionNote }: {
  who: Who
  stages: { key: StageKey; state: StageState; detail?: string }[]
  current: StageKey
  kraCount: number; weightage: number; frequency: string; periodLabel: string
  lastRating: number | null; lastScore: number | null
  actionLabel: string; actionNote: string
}) {
  const { C } = useTheme()
  const setOk = kraCount >= DEFAULT_RULES.minKra && weightage === DEFAULT_RULES.totalWeightage
  const band = bandFor(lastRating)
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
            : `Totalling ${weightage}. Needs ${DEFAULT_RULES.minKra}–${DEFAULT_RULES.maxKra} KRAs at exactly ${DEFAULT_RULES.totalWeightage}`} />
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
function KraRow({ k, i, locked, thin, canRemove, removeWhy, onSet, onRemove, onPickCategory }: {
  k: Kra; i: number; locked: boolean; thin: boolean; canRemove: boolean; removeWhy?: string
  onSet: (i: number, patch: Partial<Kra>) => void; onRemove: (i: number) => void; onPickCategory: (i: number) => void
}) {
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
    </View>
  )
}

export function KraTab({ kras, onChange, locked, lockGate, onSubmit, saving }: {
  kras: Kra[]; onChange: (next: Kra[]) => void; locked: boolean
  lockGate: { open: boolean; because: string }; onSubmit: () => void; saving?: boolean
}) {
  const { C } = useTheme()
  const [catFor, setCatFor] = React.useState<number | null>(null)
  const check = checkKras(kras)
  const m = meter(check)
  const add = canAdd(kras)
  const del = canDelete(kras)
  const set = (i: number, patch: Partial<Kra>) => onChange(kras.map((k, j) => j === i ? { ...k, ...patch } : k))
  const remove = (i: number) => onChange(kras.filter((_, j) => j !== i).map((x, j) => ({ ...x, seq_no: j + 1 })))
  const meterColour = m.tone === 'good' ? C.positive : m.tone === 'bad' ? C.critical : C.warning

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
            <K>{m.says} · {check.count} {check.count === 1 ? 'KRA' : 'KRAs'} (minimum {DEFAULT_RULES.minKra}, maximum {DEFAULT_RULES.maxKra})</K>
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

      <PCard title="My KRAs" sub={`At least ${DEFAULT_RULES.minKra}, at most ${DEFAULT_RULES.maxKra}, and the weightages must total exactly ${DEFAULT_RULES.totalWeightage}.`}>
        {kras.length === 0 ? (
          <EmptyBlock title="Nothing written yet" note={`Add ${DEFAULT_RULES.minKra} to ${DEFAULT_RULES.maxKra} KRAs. They are what your rating will be measured against, so they are worth the time.`} />
        ) : kras.map((k, i) => (
          <KraRow key={i} k={k} i={i} locked={locked} thin={check.thin.includes(k.seq_no)} canRemove={del.allowed} removeWhy={del.reason}
            onSet={set} onRemove={remove} onPickCategory={setCatFor} />
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

        {!locked && (
          <View style={{ gap: S.sm, marginTop: S.lg }}>
            <Button full disabled={!check.canSubmit || saving} onPress={onSubmit}
              title={saving ? 'Saving…' : check.canSubmit ? 'Send to my manager' : `Cannot send yet: ${check.faults.length} to fix`} />
            {check.total !== DEFAULT_RULES.totalWeightage && kras.length > 0 && (
              <Button full variant="ghost" title={`Split ${DEFAULT_RULES.totalWeightage} evenly`}
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

// ── §3.3 One-to-One Log ──────────────────────────────────────────────────
const TYPE_PILL: Record<DiscussionType, PillKind> = { KRA_SETTING: 'brand', MID_PERIOD: 'blue', FINAL_REVIEW: 'amber', ADHOC: 'grey' }
const Ack = ({ on }: { on?: boolean | null }) => on ? <Pill kind="green" label="✓ acknowledged" /> : <Pill kind="grey" label="not yet" />

export function OneToOneTab({ logs, managerName, onLog, saving }: { logs: Log[]; managerName: string; onLog: (l: Log) => void; saving?: boolean }) {
  const { C } = useTheme()
  const [type, setType] = React.useState<DiscussionType>('KRA_SETTING')
  const [date, setDate] = React.useState('')
  const [mode, setMode] = React.useState<Mode>('IN_PERSON')
  const [points, setPoints] = React.useState('')
  const [sheet, setSheet] = React.useState<null | 'date' | 'type' | 'mode'>(null)
  const lock = canLockWeightage(logs)
  const publish = canPublishResult(logs)
  const rows = logRows(logs)

  return (
    <>
      {lock.open
        ? <Banner tone="green" glyph="✓">The KRA one-to-one is acknowledged by both of you, so your <B>weightages are locked</B>.</Banner>
        : <Banner tone="amber" glyph="⚠️">Your weightages are <B>not locked yet</B>. {lock.because}</Banner>}

      <PCard title="One-to-one discussion log" sub="Every discussion stays on record: KRA setting, mid-period, and the final review.">
        {rows.map((l, i) => (
          <View key={i} style={{ paddingVertical: S.md, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
              <Pill kind={TYPE_PILL[l.discussion_type]} label={TYPE_LABEL[l.discussion_type]} />
              <Txt size={F.tiny} tone="muted">{l.discussion_date ? humanDate(l.discussion_date) : '-'} · with {managerName || '-'}</Txt>
            </View>
            {l.placeholder ? <K>{TYPE_PURPOSE[l.discussion_type]}</K> : <Txt size={F.tiny}>{l.discussion_points || '-'}</Txt>}
            <View style={{ flexDirection: 'row', gap: S.lg, flexWrap: 'wrap' }}>
              <View style={{ gap: 3 }}><K>You</K><Ack on={l.employee_ack} /></View>
              <View style={{ gap: 3 }}><K>Manager</K><Ack on={l.manager_ack} /></View>
            </View>
          </View>
        ))}
        <K style={{ marginTop: 10 }}>
          Both sides have to acknowledge. One tick on its own is a manager asserting a conversation happened; two is a record worth relying on later.
          {!publish.open ? ` ${publish.because}` : ''}
        </K>
      </PCard>

      <PCard title="Log a discussion" sub="Recorded against this period, and shown to your manager to acknowledge.">
        <PickerField label="Date" value={date ? humanDate(date) : ''} placeholder="Pick a date" onPress={() => setSheet('date')} />
        <PickerField label="Type" value={TYPE_LABEL[type]} onPress={() => setSheet('type')} />
        <PickerField label="How" value={MODE_LABEL[mode]} onPress={() => setSheet('mode')} />
        <Input label="What was discussed" value={points} onChangeText={setPoints} multiline
          placeholder="Weightage changes and why, targets agreed, support asked for" />
        <K>{TYPE_PURPOSE[type]}</K>
        <View style={{ marginTop: S.lg }}>
          <Button full disabled={!date || !points.trim() || saving} title={saving ? 'Saving…' : 'Log it and acknowledge'}
            onPress={() => { onLog({ discussion_type: type, discussion_date: date, mode, discussion_points: points, employee_ack: true }); setPoints(''); setDate('') }} />
        </View>
      </PCard>

      <DateSheet visible={sheet === 'date'} onClose={() => setSheet(null)} value={date || null} onPick={setDate} title="Date" />
      <SelectSheet visible={sheet === 'type'} onClose={() => setSheet(null)} title="Type" value={type}
        options={DISCUSSION_TYPES.map(t => ({ value: t, label: TYPE_LABEL[t] }))} onPick={v => setType(v as DiscussionType)} />
      <SelectSheet visible={sheet === 'mode'} onClose={() => setSheet(null)} title="How" value={mode}
        options={MODES.map(m => ({ value: m, label: MODE_LABEL[m] }))} onPick={v => setMode(v as Mode)} />
    </>
  )
}
