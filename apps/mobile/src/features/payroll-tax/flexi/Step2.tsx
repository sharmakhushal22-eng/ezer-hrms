// Step 2 — Flexi Declaration (FlexiTdsCalculator.tsx lines 485–565).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Card, Checkbox, Txt } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { IconChevronDown } from '@/ui/icons'
import { COMPS, R, type Child, type Flexi } from '../tax'
import { Box, Pill, SelectField } from '../ui'

function WalletBar({ title, used, io, bud }: { title: string; used: number; io: boolean; bud: number }) {
  const { C } = useTheme()
  const pctv = bud > 0 ? Math.min(used / bud * 100, 100) : 0, ov = used > bud + 1
  const col = ov ? C.critical : pctv > 80 ? C.warning : io ? C.warning : C.positive
  return (
    <Card style={{ flex: 1, minWidth: 260 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: S.sm, gap: 6 }}>
        <Txt size={12} w={700} style={{ flexShrink: 1 }}>{title}</Txt>
        <Txt size={12} w={700} color={col}>{ov ? 'EXCEEDED!' : R(Math.max(0, bud - used)) + ' left'}</Txt>
      </View>
      <View style={{ height: 8, backgroundColor: C.sunken, borderRadius: 99, overflow: 'hidden' }}>
        <View style={{ width: `${pctv}%`, height: '100%', backgroundColor: col }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, flexWrap: 'wrap', gap: 4 }}>
        <Txt size={11} tone="muted">Used: {R(used)}</Txt>
        <Txt size={11} tone="muted">Budget: {R(bud)}</Txt>
      </View>
      {ov && <Box bg={C.criticalTint} style={{ marginTop: S.sm }}><Txt size={11} color={C.critical}>Flexi wallet limit exceeded. Remove some allowances.</Txt></Box>}
    </Card>
  )
}

/** The ₹0 / ₹limit <select> of one cell. */
function AmountPick({ title, lim, val, onPick, disabled }: { title: string; lim: number; val: number; onPick: (v: number) => void; disabled: boolean }) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState(false)
  if (!lim) return <Txt size={11} tone="muted" center>Not eligible</Txt>
  return (
    <>
      <Pressable onPress={disabled ? undefined : () => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${title}: ${R(val)}`}
        style={({ pressed }) => ({ minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: disabled ? C.sunken : pressed ? C.brandTint : C.surface })}>
        <Txt size={12} w={600} numberOfLines={1} color={disabled ? C.muted : C.ink}>{R(val)}</Txt>
        {!disabled && <IconChevronDown size={12} color={C.faint} />}
      </Pressable>
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={title}
        options={[{ value: 0, label: '₹0' }, { value: lim, label: R(lim) }]} value={val} onPick={v => onPick(Number(v))} />
    </>
  )
}

function ChildBox({ n, cd, onChange, disabled }: { n: number; cd: { school: boolean; hostel: boolean }; onChange: (p: Partial<{ school: boolean; hostel: boolean }>) => void; disabled: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flex: 1, minWidth: 140, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: S.md }}>
      <Txt size={13} w={700} color={C.warning} style={{ marginBottom: 4 }}>Child {n}</Txt>
      <Checkbox checked={cd.school} onChange={v => onChange({ school: v })} label="Going to school?" disabled={disabled} />
      <Checkbox checked={cd.hostel} onChange={v => onChange({ hostel: v })} label="Staying in hostel?" disabled={disabled} />
    </View>
  )
}

export function Step2({ rw, budget, oFlexi, nFlexi, child, setChild, oLim, nLim, onFlexi, oTot, nTot }: {
  rw: boolean; budget: number; oFlexi: Flexi; nFlexi: Flexi; child: Child; setChild: (fn: (c: Child) => Child) => void
  oLim: (k: string) => number; nLim: (k: string) => number; onFlexi: (rg: 'old' | 'new', k: string, v: number) => void; oTot: number; nTot: number
}) {
  const { C } = useTheme()
  const carSel = (oFlexi.car || 0) > 0 || (nFlexi.car || 0) > 0
  return (
    <View>
      {carSel && (
        <Box bg={C.warningTint} edge={C.warningEdge} style={{ padding: S.lg, marginBottom: S.md, borderRadius: 14 }}>
          <Txt size={13} w={700} color={C.warning} style={{ marginBottom: S.sm }}>Car Lease + Driver: Perquisite Tax Applied</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[['Car Lease Perq', '₹7,000', 'per month'], ['Driver Perq', '₹3,000', 'per month'], ['Total Perquisite', '₹10,000', '₹1,20,000/yr → taxable']].map(([l, v, sub]) => (
              <View key={l} style={{ flexGrow: 1, flexBasis: '30%', minWidth: 96, backgroundColor: C.surface, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: C.warningEdge }}>
                <Txt size={11} tone="muted">{l}</Txt>
                <Txt size={16} w={700} color={C.warning}>{v}</Txt>
                <Txt size={10} tone="muted">{sub}</Txt>
              </View>
            ))}
          </View>
          <Txt size={11} color={C.critical} style={{ marginTop: S.sm }}>Car lease is tax-exempt; Car + Driver are always selected together.</Txt>
        </Box>
      )}

      <Card style={{ marginBottom: S.md }}>
        <Txt size={15} w={700}>👨‍👩‍👧 Children Details <Txt size={11} color={C.warning}>(Old Regime only)</Txt></Txt>
        <Txt size={12} tone="muted" style={{ marginBottom: 10 }}>Affects Children&apos;s Education &amp; Hostel Allowance limits</Txt>
        <SelectField label="Number of Children" value={child.count} disabled={!rw}
          options={[{ value: 0, label: '0 children' }, { value: 1, label: '1 child' }, { value: 2, label: '2 children (max)' }]}
          onChange={v => setChild(c => ({ ...c, count: Number(v) }))} />
        {child.count > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {[1, 2].slice(0, child.count).map(n => {
              const cd = n === 1 ? child.c1 : child.c2
              return <ChildBox key={n} n={n} cd={cd} disabled={!rw}
                onChange={patch => setChild(c => ({ ...c, [n === 1 ? 'c1' : 'c2']: { ...cd, ...patch } }))} />
            })}
          </View>
        )}
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>
        <WalletBar title="Old Regime Wallet" used={oTot} io bud={budget} />
        <WalletBar title="New Regime Wallet" used={nTot} io={false} bud={budget} />
      </View>

      <Card padded={false} style={{ marginTop: S.md, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', backgroundColor: C.ink, paddingVertical: 10, paddingHorizontal: S.md, gap: 6 }}>
          <Txt size={11} w={700} color={C.surface} style={{ flex: 1.5 }}>Component</Txt>
          <Txt size={11} w={700} color={C.surface} style={{ flex: 1, textAlign: 'center' }}>Old Regime</Txt>
          <Txt size={11} w={700} color={C.surface} style={{ flex: 1, textAlign: 'center' }}>New Regime</Txt>
        </View>
        {COMPS.map(({ k, l, perq }) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: S.md, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: perq ? C.warningTint : C.surface }}>
            <View style={{ flex: 1.5 }}>
              <Txt size={13}>{l}</Txt>
              {perq && <Pill label="Perquisite Tax" bg={C.warningTint} fg={C.warning} style={{ paddingHorizontal: 6, marginTop: 2 }} />}
            </View>
            <View style={{ flex: 1 }}><AmountPick title={`${l} · Old Regime`} lim={oLim(k)} val={oFlexi[k] || 0} onPick={v => onFlexi('old', k, v)} disabled={!rw} /></View>
            <View style={{ flex: 1 }}><AmountPick title={`${l} · New Regime`} lim={nLim(k)} val={nFlexi[k] || 0} onPick={v => onFlexi('new', k, v)} disabled={!rw} /></View>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 10, paddingHorizontal: S.md, borderTopWidth: 2, borderTopColor: C.line }}>
          <Txt size={13} w={700} style={{ flex: 1.5 }}>Total Selected</Txt>
          <Txt size={13} w={700} color={oTot > budget ? C.critical : C.warning} style={{ flex: 1, textAlign: 'center' }}>{R(oTot)}</Txt>
          <Txt size={13} w={700} color={nTot > budget ? C.critical : C.positive} style={{ flex: 1, textAlign: 'center' }}>{R(nTot)}</Txt>
        </View>
      </Card>
    </View>
  )
}
