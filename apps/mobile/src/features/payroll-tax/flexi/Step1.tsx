// Step 1 — Employee & Salary (FlexiTdsCalculator.tsx lines 343–482).
import * as React from 'react'
import { View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Card, Input, Txt } from '@/ui/primitives'
import { R, SLAB_LABELS, type Form, type Join, type Sal } from '../tax'
import type { SalaryBreakup } from '../salary'
import { B, Box, DateField, NumField, Pill, Tile } from '../ui'

function SalRow({ label, m, kind }: { label: string; m: number; kind?: 'sub' | 'net' | 'total' }) {
  const { C } = useTheme()
  const bg = kind === 'total' ? C.canvas : kind === 'net' ? C.positiveTint : kind === 'sub' ? C.sunken : C.surface
  const fg = kind === 'total' ? C.brand : kind === 'net' ? C.positive : C.ink
  const w = kind ? 700 : 400
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: S.md, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: bg }}>
      <Txt size={13} w={w} color={fg} style={{ flex: 1.4 }}>{label}</Txt>
      <Txt size={13} w={w} color={fg} style={{ flex: 1, textAlign: 'right' }}>{R(m)}</Txt>
      <Txt size={13} w={w} color={fg} style={{ flex: 1, textAlign: 'right' }}>{R(m * 12)}</Txt>
    </View>
  )
}

function StructureCard({ rd }: { rd: SalaryBreakup }) {
  const { C } = useTheme()
  return (
    <Card style={{ marginBottom: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <Txt size={15} w={700}>Your Salary Structure</Txt>
        <Pill label="✓ as per your record" bg={C.positiveTint} fg={C.positive} />
        {!!rd.payType && rd.payType !== 'Regular' && <Pill label={rd.payType} bg={C.brandTint} fg={C.brandDeep} />}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: S.md }}>
        <Tile label="Annual CTC" value={R(rd.totalCtc || rd.annualCtc)} color={C.brand} bg={C.canvas} />
        <Tile label="Net Take-home / mo" value={R(rd.net)} color={C.positive} bg={C.positiveTint} />
        <Tile label="Fixed / mo" value={R(rd.fixedMonthly)} color={C.ink} bg={C.sunken} />
      </View>
      <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', paddingVertical: 9, paddingHorizontal: S.md, backgroundColor: C.dark }}>
          <Txt size={11} w={700} color={C.onDark} style={{ flex: 1.4 }}>COMPONENT</Txt>
          <Txt size={11} w={700} color={C.onDark} style={{ flex: 1, textAlign: 'right' }}>MONTHLY</Txt>
          <Txt size={11} w={700} color={C.onDark} style={{ flex: 1, textAlign: 'right' }}>ANNUAL</Txt>
        </View>
        <SalRow label="Basic" m={rd.basic} />
        <SalRow label="HRA" m={rd.hra} />
        {rd.statBonus > 0 && <SalRow label="Statutory Bonus" m={rd.statBonus} />}
        {rd.conveyance > 0 && <SalRow label="Conveyance" m={rd.conveyance} />}
        {rd.special > 0 && <SalRow label="Special Allowance" m={rd.special} />}
        {rd.flexiMonthly > 0 && <SalRow label="Flexi (declared)" m={rd.flexiMonthly} />}
        <SalRow label="Gross" m={rd.gross} kind="sub" />
        {rd.erPf > 0 && <SalRow label="Employer PF" m={rd.erPf} />}
        {rd.erEsic > 0 && <SalRow label="Employer ESIC" m={rd.erEsic} />}
        {rd.gratuity > 0 && <SalRow label="Gratuity" m={rd.gratuity} />}
        {(rd.eePf > 0 || rd.eeEsic > 0 || rd.pt > 0 || rd.lwf > 0) && (
          <View style={{ paddingVertical: 6, paddingHorizontal: S.md, backgroundColor: C.criticalTint, borderTopWidth: 1, borderTopColor: C.line }}>
            <Txt size={10} w={700} color={C.critical}>DEDUCTIONS</Txt>
          </View>
        )}
        {rd.eePf > 0 && <SalRow label="Employee PF" m={rd.eePf} />}
        {rd.eeEsic > 0 && <SalRow label="Employee ESIC" m={rd.eeEsic} />}
        {rd.pt > 0 && <SalRow label="Professional Tax" m={rd.pt} />}
        {rd.lwf > 0 && <SalRow label="LWF" m={rd.lwf} />}
        <SalRow label="Net Take-home" m={rd.net} kind="net" />
        <SalRow label="Fixed" m={rd.fixedMonthly} kind="sub" />
        {rd.variableAnnual > 0 && <SalRow label="Variable" m={Math.round(rd.variableAnnual / 12)} />}
        <SalRow label="Total CTC" m={Math.round(rd.totalCtc / 12)} kind="total" />
      </View>
      <Txt size={10} tone="faint" style={{ marginTop: 6 }}>FY 2026-27 salary structure: the same figures shown in your HR record. Monthly amounts are pro-rated on actual paid days during payroll.</Txt>
    </Card>
  )
}

function WalletBasis({ rd, sal }: { rd: SalaryBreakup | null; sal: Sal }) {
  const { C } = useTheme()
  const sp = rd ? (rd.specialGross || rd.special) : 0
  return (
    <Card style={{ marginBottom: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: S.md }}>
        <Txt size={15} w={700}>{rd ? 'Flexi Wallet Basis' : 'Salary Breakup'}</Txt>
        <Pill label={`Slab: ${SLAB_LABELS[sal.si]}`} bg={C.brandTint} fg={C.brandDeep} />
      </View>
      <LinearGradient colors={[C.brand, C.brand]} style={{ borderRadius: 10, paddingVertical: 14, paddingHorizontal: S.lg }}>
        <Txt size={11} color={C.onAccent} style={{ opacity: 0.85 }}>Flexi Wallet {rd ? '(funded by Special Allowance)' : '(Other Reimbursement)'}</Txt>
        {rd ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginTop: 4, marginBottom: 2 }}>
            <Txt size={24} w={800} color={C.onAccent}>{R(sp)} <Txt size={12} color={C.onAccent}>per month</Txt></Txt>
            <Txt size={17} color={C.onAccent} style={{ opacity: 0.55 }}>|</Txt>
            <Txt size={17} w={700} color={C.onAccent}>{R(sal.other)} <Txt size={12} color={C.onAccent}>per year</Txt></Txt>
          </View>
        ) : (
          <>
            <Txt size={24} w={800} color={C.onAccent}>{R(sal.other)}</Txt>
            <Txt size={11} color={C.onAccent} style={{ opacity: 0.8 }}>Fixed − Basic − HRA − PF</Txt>
          </>
        )}
        {rd && <Txt size={11} color={C.onAccent} style={{ opacity: 0.8 }}>Your full Special Allowance: {R(sp)}/month. {rd.flexiMonthly > 0 ? `${R(rd.flexiMonthly)}/month already declared, ${R(Math.max(0, sp - rd.flexiMonthly))} left.` : ''}</Txt>}
      </LinearGradient>
      <Box bg={C.warningTint} edge={C.warningEdge} style={{ marginTop: 10 }}>
        {rd
          ? <Txt size={12} color={C.warning}><B>Source:</B> full Special Allowance <B>{R(sp)}/month</B> × 12 = <B>{R(sal.other)} annual wallet</B>. Declared flexi is deducted from the Special Allowance paid as salary.</Txt>
          : <Txt size={12} color={C.warning}><B>Formula:</B> {R(sal.fixed)} − {R(sal.basic)} (Basic) − {R(sal.hra)} (HRA) − {R(sal.epf)} (PF) = <B>Flexi Wallet {R(sal.other)}</B></Txt>}
      </Box>
    </Card>
  )
}

export function Step1({ f, set, rw, empName, empCode, rd, sal, join }: {
  f: Form; set: (k: string, v: string) => void; rw: boolean; empName?: string; empCode?: string
  rd: SalaryBreakup | null; sal: Sal; join: Join
}) {
  const { C } = useTheme()
  return (
    <View>
      <Card style={{ marginBottom: S.md }}>
        <Txt size={15} w={700}>Employee Information</Txt>
        <Txt size={12} tone="muted" style={{ marginBottom: S.md }}>Prefilled from your record. Adjust CTC / variable if needed.</Txt>
        <Input label="Employee Name" value={empName || ''} editable={false} />
        <Input label="Employee Code" value={empCode || ''} editable={false} />
        <NumField label="Annual CTC (₹)" value={f.ctc} onValue={v => set('ctc', v)} placeholder="e.g. 1500000" disabled={!rw} />
        <DateField label="Date of Joining" value={f.doj} onChange={v => set('doj', v)} disabled={!rw} placeholder="dd-mm-yyyy" />
        <NumField label="Annual Variable Pay (₹)" value={f.variable} onValue={v => set('variable', v)} placeholder="0 if none" disabled={!rw} />
      </Card>
      {rd && <StructureCard rd={rd} />}
      {sal.ctc > 0 && <WalletBasis rd={rd} sal={sal} />}
      {sal.ctc > 0 && join.mid && (
        <Box bg={C.infoTint} edge={C.brandEdge} style={{ padding: S.lg, marginBottom: S.md, borderRadius: 14 }}>
          <Txt size={13} w={700} color={C.info} style={{ marginBottom: 4 }}>Mid-year joining: pro-rata applies</Txt>
          <Txt size={12} color={C.brand} style={{ lineHeight: 20 }}>You are with the company for <B>{join.months} month{join.months === 1 ? '' : 's'}</B> of FY 2026-27, so your salary income is earned for ≈<B>{Math.round(join.pr * 100)}%</B> of the year. Tax is computed on this pro-rated income and the <B>monthly TDS is spread over the {join.months} remaining pay month{join.months === 1 ? '' : 's'}</B>. (Employees who joined on/before 1 Apr 2026 are taxed on the full 12 months.)</Txt>
        </Box>
      )}
      {sal.ctc > 0 && !join.mid && !!f.doj && (
        <Txt size={12} tone="muted" style={{ marginHorizontal: 4, marginBottom: S.md }}>Joined on/before 1 Apr 2026: taxed on the full financial year.</Txt>
      )}
    </View>
  )
}
