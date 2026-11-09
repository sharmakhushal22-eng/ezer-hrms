// src/features/performance/EmpKras.tsx — §3.2 My KRAs (website:
// components/pms/EmployeeTabs.tsx KraTab). One card per KRA; under it the
// KPIs that measure it (220–222: each takes an equal share of the KRA's
// weightage and is rated on its own), and beside each KPI the employee's own
// rating when this stage asks for it. Every rule is lib/pms: checkKras,
// meter, canAdd/canDelete, checkKpis, canAddKpi/canRemoveKpi, submitGate.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { DEFAULT_RULES, type Rules } from '@web/pms/cycle'
import { checkKras, canAdd, canDelete, meter, suggestSplit, CATEGORIES, CATEGORY_LABEL, type Kra, type Category } from '@web/pms/kra'
import { blankKpi, canAddKpi, canRemoveKpi, checkKpis, renumber, selfKey, shareOf, submitGate, type Kpi } from '@web/pms/kpi'
import { CONFIRM_LABEL, CONFIRM_WHY } from '@web/pms/oneToOne'
import { DEFAULT_BANDS, type Band } from '@web/pms/scoring'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Checkbox, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet, useOverlay } from '@/ui/overlays'
import { B, Banner, EmptyBlock, K, PCard } from './ui'
import { blankKra, mixOklab, type KraSelf } from './logic'

/** 10 stays "10"; 8.3333… becomes "8.33" (EmployeeTabs.tsx round2). */
const round2 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))

/** One shade of the brand per KRA, shared by its bar segment and its number badge. */
function useShade() {
  const { C } = useTheme()
  return (i: number) => mixOklab(C.brandTint, C.brand, Math.max(30, 100 - i * 11))
}

interface KpiRowProps {
  k: Kra; i: number; x: Kpi; j: number; locked: boolean; rules: Rules; share: number; fault?: string
  onKpi: (i: number, j: number, patch: Partial<Kpi>) => void; onRemoveKpi: (i: number, j: number) => void
  self?: KraSelf; onSelf?: (key: string, patch: Partial<KraSelf>) => void; selfSubmitted: boolean; bands: Band[]
}
function KpiRow({ k, i, x, j, locked, rules, share, fault, onKpi, onRemoveKpi, self, onSelf, selfSubmitted, bands }: KpiRowProps) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const fewer = canRemoveKpi(k.kpis ?? [], rules)
  const key = selfKey(k.seq_no, x.seq_no)
  const got = self?.rating ?? null
  const band = bands.find(b => b.value === got)
  return (
    <View style={{ borderWidth: 1, borderColor: fault ? C.critical : C.line, borderRadius: R.md, paddingVertical: S.md, paddingHorizontal: S.sm, marginBottom: S.sm, backgroundColor: C.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.sm }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.sunken, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={F.micro} w={800} tone="muted">{j + 1}</Txt>
        </View>
        <Txt size={F.tiny} w={700} tone="muted" style={{ flex: 1 }}>KPI · share {round2(share)}%</Txt>
        {!locked && (
          // Disabled at the floor, and tapping it says why (the website's title tooltip).
          <Pressable onPress={() => (fewer.allowed ? onRemoveKpi(i, j) : notify(fewer.reason ?? '', 'info'))} accessibilityRole="button"
            accessibilityLabel={`Remove KRA ${i + 1} KPI ${j + 1}`} accessibilityHint={fewer.allowed ? undefined : fewer.reason} accessibilityState={{ disabled: !fewer.allowed }} hitSlop={6}
            style={{ minWidth: 44, height: 36, alignItems: 'center', justifyContent: 'center', opacity: fewer.allowed ? 1 : 0.4 }}>
            <Txt size={F.lead} w={700} tone="brand">×</Txt>
          </Pressable>
        )}
      </View>
      <Input label="KPI" value={x.kpi_metric} editable={!locked} placeholder="How it is measured" error={fault}
        accessibilityLabel={`KRA ${i + 1} KPI ${j + 1} measure`} onChangeText={t => onKpi(i, j, { kpi_metric: t })} />
      <Input label="Target" value={x.target_value} editable={!locked} placeholder="The number to hit"
        accessibilityLabel={`KRA ${i + 1} KPI ${j + 1} target`} onChangeText={t => onKpi(i, j, { target_value: t })} />
      {!!onSelf && (
        <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.md, backgroundColor: got !== null ? C.positiveTint : undefined, marginHorizontal: -S.sm, paddingHorizontal: S.sm, marginBottom: -S.md, paddingBottom: S.md, borderBottomLeftRadius: R.md, borderBottomRightRadius: R.md }}>
          <Input label="What you delivered" value={self?.achievement ?? ''} editable={!selfSubmitted} placeholder="The number you actually hit"
            accessibilityLabel={`Achievement for KRA ${i + 1} KPI ${j + 1}`} onChangeText={t => onSelf(key, { achievement: t })} />
          <Input label="Evidence" value={self?.comment ?? ''} editable={!selfSubmitted} placeholder="Evidence a manager could check" multiline
            accessibilityLabel={`Comment for KRA ${i + 1} KPI ${j + 1}`} onChangeText={t => onSelf(key, { comment: t })} />
          <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Your rating</Txt>
          <View accessibilityRole="radiogroup" accessibilityLabel={`Your rating for KRA ${i + 1} KPI ${j + 1}`} style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {bands.map(b => {
              const on = got === b.value
              return (
                <Pressable key={b.value} disabled={selfSubmitted} onPress={() => onSelf(key, { rating: b.value })}
                  accessibilityRole="radio" accessibilityState={{ checked: on, disabled: selfSubmitted }} accessibilityLabel={`${b.value}: ${b.label}`}
                  style={{ minWidth: 44, height: 44, borderRadius: R.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                    borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brand : C.surface, opacity: selfSubmitted && !on ? 0.6 : 1 }}>
                  <Txt size={F.small} w={800} color={on ? C.onAccent : C.brand}>{b.value}</Txt>
                </Pressable>
              )
            })}
          </View>
          {!!band && <Txt size={F.tiny} w={700} style={{ marginTop: 6 }}>{band.value} · {band.label}</Txt>}
        </View>
      )}
    </View>
  )
}

interface KraCardProps {
  k: Kra; i: number; locked: boolean; thin: boolean; canRemove: boolean; removeWhy?: string; rules: Rules; shade: string
  onSet: (i: number, patch: Partial<Kra>) => void; onRemove: (i: number) => void; onPickCategory: (i: number) => void
  onKpi: (i: number, j: number, patch: Partial<Kpi>) => void; onAddKpi: (i: number) => void; onRemoveKpi: (i: number, j: number) => void
  self?: Record<string, KraSelf>; onSelf?: (key: string, patch: Partial<KraSelf>) => void; selfSubmitted: boolean; bands: Band[]
}
function KraCard(p: KraCardProps) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const { k, i, locked, rules } = p
  const kpis = k.kpis ?? []
  const faults = checkKpis({ seq_no: k.seq_no, kra_title: k.kra_title, weightage: k.weightage, kpis }, rules)
  const setFault = faults.find(f => f.kpiSeq === null)
  const more = canAddKpi(kpis, rules)
  const share = shareOf(k.weightage, kpis.length)
  return (
    <View style={{ borderWidth: 1, borderColor: p.thin ? C.critical : C.line, borderLeftWidth: 4, borderLeftColor: p.shade, borderRadius: R.md, padding: S.md, marginBottom: S.md, backgroundColor: C.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.sm }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: p.shade, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={F.tiny} w={800} color={i < 4 ? C.onAccent : C.brandDeep}>{i + 1}</Txt>
        </View>
        <Txt size={F.small} w={700} style={{ flex: 1 }}>KRA {i + 1}</Txt>
        {!locked && (
          <Pressable onPress={() => (p.canRemove ? p.onRemove(i) : notify(p.removeWhy ?? '', 'info'))} accessibilityRole="button" accessibilityLabel={`Remove KRA ${i + 1}`}
            accessibilityHint={p.canRemove ? undefined : p.removeWhy} accessibilityState={{ disabled: !p.canRemove }} hitSlop={6}
            style={{ minWidth: 44, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: R.sm, opacity: p.canRemove ? 1 : 0.4 }}>
            <Txt size={F.lead} w={700} tone="brand">×</Txt>
          </Pressable>
        )}
      </View>
      <Input label="KRA / objective" value={k.kra_title} editable={!locked} placeholder="What you are accountable for"
        accessibilityLabel={`KRA ${i + 1} title`} onChangeText={t => p.onSet(i, { kra_title: t })} />
      <View style={{ flexDirection: 'row', gap: S.md }}>
        <PickerField label="Category" value={CATEGORY_LABEL[k.category]} disabled={locked} onPress={() => p.onPickCategory(i)} style={{ flex: 1 }} />
        <Input label="Weightage %" value={String(k.weightage)} editable={!locked} keyboardType="number-pad" style={{ width: 112 }} inputStyle={{ width: '100%', minWidth: 0 }}
          accessibilityLabel={`KRA ${i + 1} weightage`} error={p.thin ? ' ' : undefined}
          onChangeText={t => p.onSet(i, { weightage: Number(t.replace(/[^0-9.]/g, '')) || 0 })} />
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.md, marginTop: 2 }}>
        <Txt size={F.small} w={700}>How it is measured</Txt>
        {kpis.length > 0 && (k.weightage || 0) > 0 && (
          <Txt size={F.tiny} w={600} tone="positive" style={{ marginTop: 2 }}>
            {kpis.length === 1 ? `carries all ${k.weightage}%` : `${k.weightage}% split ${kpis.length} ways · ${round2(share)}% each`}
          </Txt>
        )}
        {!locked && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginTop: S.sm, marginBottom: S.sm }}>
            <Button size="sm" variant="ghost" title="+ Add KPI" disabled={!more.allowed} onPress={() => p.onAddKpi(i)} />
            <K>{kpis.length} of {rules.maxKpi}</K>
          </View>
        )}
        {!locked && !more.allowed && !!more.reason && <K style={{ marginBottom: S.sm }}>{more.reason}</K>}
        <View style={{ marginTop: locked ? S.sm : 0 }}>
          {kpis.map((x, j) => (
            <KpiRow key={j} k={k} i={i} x={x} j={j} locked={locked} rules={rules} share={share}
              fault={faults.find(f => f.kpiSeq === x.seq_no)?.says}
              onKpi={p.onKpi} onRemoveKpi={p.onRemoveKpi}
              self={p.self?.[selfKey(k.seq_no, x.seq_no)]} onSelf={p.onSelf} selfSubmitted={p.selfSubmitted} bands={p.bands} />
          ))}
        </View>
        {!!setFault && !locked && <Txt size={F.tiny} tone="critical">{setFault.says}</Txt>}
      </View>
    </View>
  )
}

export function KraTab({ kras, onChange, locked, lockGate, onSubmit, saving, rules = DEFAULT_RULES, carriedFrom, self, onSelfChange, bands = DEFAULT_BANDS, rateRequired = false, selfSubmitted = false, confirmOneToOne, onConfirmOneToOne, oneToOneRequired = false, oneToOneAlready = false }: {
  kras: Kra[]; onChange: (next: Kra[]) => void; locked: boolean
  lockGate: { open: boolean; because: string }; onSubmit: () => void; saving?: boolean
  rules?: Rules; carriedFrom?: string | null
  self?: Record<string, KraSelf>; onSelfChange?: (key: string, patch: Partial<KraSelf>) => void
  bands?: Band[]; rateRequired?: boolean; selfSubmitted?: boolean
  confirmOneToOne?: boolean; onConfirmOneToOne?: (v: boolean) => void; oneToOneRequired?: boolean; oneToOneAlready?: boolean
}) {
  const { C } = useTheme()
  const shade = useShade()
  const [catFor, setCatFor] = React.useState<number | null>(null)
  // `rules` passed to every check: the defaults inside kra.ts / kpi.ts are fallbacks, not the policy.
  const check = checkKras(kras, rules)
  const gate = submitGate(kras.map(k => ({ ...k, kpis: k.kpis ?? [] })), rules, rateRequired
    ? (kpi, kra) => self?.[selfKey(kra.seq_no, kpi.seq_no)]?.rating ?? null
    : undefined)
  const unrated = gate.of - gate.rated
  const m = meter(check, rules)
  const add = canAdd(kras, rules)
  const del = canDelete(kras, rules)
  const set = (i: number, patch: Partial<Kra>) => onChange(kras.map((k, j) => j === i ? { ...k, ...patch } : k))
  const kpisOf = (k: Kra): Kpi[] => k.kpis ?? []
  const setKpi = (i: number, j: number, patch: Partial<Kpi>) => set(i, { kpis: kpisOf(kras[i]).map((x, n) => n === j ? { ...x, ...patch } : x) })
  const addKpi = (i: number) => { if (canAddKpi(kpisOf(kras[i]), rules).allowed) set(i, { kpis: renumber([...kpisOf(kras[i]), blankKpi(kpisOf(kras[i]).length + 1)]) }) }
  const removeKpi = (i: number, j: number) => { if (canRemoveKpi(kpisOf(kras[i]), rules).allowed) set(i, { kpis: renumber(kpisOf(kras[i]).filter((_, n) => n !== j)) }) }
  const remove = (i: number) => onChange(kras.filter((_, j) => j !== i).map((x, j) => ({ ...x, seq_no: j + 1 })))
  const allKpis = kras.flatMap(k => kpisOf(k).map(x => ({ k, x })))
  const ratedByYou = onSelfChange ? allKpis.filter(({ k, x }) => (self?.[selfKey(k.seq_no, x.seq_no)]?.rating ?? null) !== null).length : 0
  const toneC = m.tone === 'good' ? C.positive : m.tone === 'bad' ? C.critical : C.warning
  const needTick = oneToOneRequired && !oneToOneAlready && !confirmOneToOne
  const submitTitle = saving ? 'Saving…'
    : selfSubmitted ? 'Already sent'
    : needTick ? 'Confirm the one-to-one above first'
    : locked ? (unrated > 0 ? `Rate the last ${unrated} ${unrated === 1 ? 'measure' : 'measures'} first` : 'Send my ratings to my manager')
    : !gate.ok ? `Cannot send yet: ${gate.faults.length} to fix`
    : rateRequired ? 'Send KRAs and my ratings to my manager'
    : 'Send to my manager'
  const barMax = Math.max(rules.totalWeightage, check.total || 1)

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

      {/* The weightage as the set's shape: one segment per KRA, sized by its weightage. */}
      <View style={{ backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, marginBottom: 12, gap: S.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: S.md }}>
          <Txt size={26} w={800} color={toneC}>{check.total}<Txt size={F.small} w={700} tone="muted">/{rules.totalWeightage}</Txt></Txt>
          <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 5 }}>Weightage</Txt>
        </View>
        <View accessibilityRole="progressbar" accessibilityLabel="Total weightage" accessibilityValue={{ min: 0, max: rules.totalWeightage, now: check.total }}
          style={{ flexDirection: 'row', height: 12, borderRadius: 6, backgroundColor: C.surface, overflow: 'hidden', gap: 2 }}>
          {kras.map((k, i) => (k.weightage || 0) > 0 && (
            <View key={i} style={{ width: `${Math.min(100, ((k.weightage || 0) / barMax) * 100)}%`, backgroundColor: shade(i) }} />
          ))}
        </View>
        <Txt size={F.small} w={700} color={toneC}>{m.says}</Txt>
        <K>{check.count} {check.count === 1 ? 'KRA' : 'KRAs'} · minimum {rules.minKra}, maximum {rules.maxKra}</K>
        {!!onSelfChange && kras.length > 0 && (
          <Txt size={F.tiny} w={700} color={ratedByYou === allKpis.length ? C.positive : C.inkSoft}>{ratedByYou} of {allKpis.length} rated by you</Txt>
        )}
        {!locked && (
          <View>
            <Button title="+ Add KRA" variant="ghost" size="sm" disabled={!add.allowed} style={{ alignSelf: 'flex-start' }}
              onPress={() => onChange([...kras, blankKra(kras.length + 1)])} />
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
          <KraCard key={i} k={k} i={i} locked={locked} thin={check.thin.includes(k.seq_no)} canRemove={del.allowed} removeWhy={del.reason}
            rules={rules} shade={shade(i)} onSet={set} onRemove={remove} onPickCategory={setCatFor}
            onKpi={setKpi} onAddKpi={addKpi} onRemoveKpi={removeKpi}
            self={self} onSelf={onSelfChange} selfSubmitted={selfSubmitted} bands={bands} />
        ))}

        {/* Every reason the button is off, KPI faults and missing ratings included (submitGate). */}
        {gate.faults.length > 0 && (
          <Banner tone="red" glyph="!" raw style={{ marginTop: 2, marginBottom: S.md }}>
            <Txt size={F.tiny} w={700} tone="critical">Before this can be sent:</Txt>
            {gate.faults.map((f, i) => <Txt key={i} size={F.tiny} tone="critical" style={{ marginTop: 4 }}>• {f}</Txt>)}
          </Banner>
        )}

        {(!locked || !selfSubmitted) && oneToOneRequired && !oneToOneAlready && !!onConfirmOneToOne && (
          <View style={{ borderWidth: 1, borderColor: confirmOneToOne ? C.positive : C.line, backgroundColor: confirmOneToOne ? C.positiveTint : C.surface, borderRadius: R.md, paddingHorizontal: S.md, marginBottom: S.md }}>
            <Checkbox checked={!!confirmOneToOne} onChange={onConfirmOneToOne}
              label={<View style={{ flex: 1 }}><Txt size={F.small} w={700}>{CONFIRM_LABEL.EMPLOYEE}</Txt><K style={{ marginTop: 4 }}>{CONFIRM_WHY.EMPLOYEE}</K></View>} />
          </View>
        )}

        {(!locked || !selfSubmitted) && (
          <View style={{ gap: S.sm, marginTop: S.sm }}>
            <Button full disabled={(locked ? unrated > 0 : !gate.ok) || selfSubmitted || !!saving || needTick} onPress={onSubmit} title={submitTitle} />
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
