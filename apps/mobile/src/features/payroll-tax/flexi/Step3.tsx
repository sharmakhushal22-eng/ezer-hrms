// Step 3 — Investments (FlexiTdsCalculator.tsx lines 568–649). The website's two
// columns (Old | New) stack on a phone, Old first.
import * as React from 'react'
import { View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Button, Card, Checkbox, Input, Txt } from '@/ui/primitives'
import { MONTHS, N, R, type Form, type Sal } from '../tax'
import { B, Box, NumField, SecHead, SelectField } from '../ui'

/** The website hardcodes the Old-regime accent (#C05621) in the calculator. */
export const OLD_EDGE = '#C05621'

const MONTH_OPTS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))
const CITY_OPTS = [{ value: 'nonmetro', label: 'Non-Metro (40% of Basic)' }, { value: 'metro', label: 'Metro (50% of Basic)' }]
const CITY_OPTS2 = [{ value: 'nonmetro', label: 'Non-Metro (40%)' }, { value: 'metro', label: 'Metro (50%)' }]

function Row2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: S.sm }}>{children}</View>
}

export function Step3({ f, set, setMany, rw, sal, hraExempt, c80Total, addITotal }: {
  f: Form; set: (k: string, v: string) => void; setMany: (p: Partial<Form>) => void; rw: boolean; sal: Sal
  hraExempt: number; c80Total: number; addITotal: number
}) {
  const { C } = useTheme()
  const dis = !rw
  const num = (k: string, label: string) => <NumField label={label} value={f[k]} onValue={v => set(k, v)} disabled={dis} />
  return (
    <View>
      {/* OLD */}
      <Card style={{ marginBottom: S.md, borderLeftWidth: 3, borderLeftColor: OLD_EDGE }}>
        <Txt size={14} w={700} color={C.critical}>Old Regime Declaration</Txt>
        <Txt size={12} tone="muted" style={{ marginBottom: S.sm }}>Std Deduction ₹50,000 | 80C max ₹1,50,000</Txt>
        {sal.hra > 0 && (
          <Box bg={C.brandTint} edge={C.brandEdge} style={{ padding: S.md, marginBottom: S.md }}>
            <Txt size={11} w={700} color={C.brandDeep} style={{ marginBottom: 6 }}>Your HRA: Annual {R(sal.hra)} · Monthly {R(sal.hra / 12)}</Txt>
            <Button title="Apply suggested rent →" size="sm" disabled={dis} style={{ alignSelf: 'flex-start' }}
              onPress={() => setMany({ rentM: String(Math.round(sal.hra / 12)), hra1From: '1', hra1To: '12' })} />
          </Box>
        )}
        <SecHead>HRA Exemption (Old Regime only)</SecHead>
        <Box bg={C.sunken} edge={C.line} style={{ padding: S.md, marginBottom: 10 }}>
          <Txt size={12} w={700} style={{ marginBottom: S.sm }}>Period 1: Rent Paid</Txt>
          <Row2>
            <SelectField label="From Month" value={f.hra1From} options={MONTH_OPTS} onChange={v => set('hra1From', v)} disabled={dis} style={{ flex: 1 }} />
            <SelectField label="To Month" value={f.hra1To} options={MONTH_OPTS} onChange={v => set('hra1To', v)} disabled={dis} style={{ flex: 1 }} />
          </Row2>
          {num('rentM', 'Monthly Rent Paid (₹)')}
          <SelectField label="City Type" value={f.cityType} options={CITY_OPTS} onChange={v => set('cityType', v)} disabled={dis} />
          <Input label="Landlord PAN (required if annual rent > ₹1,00,000)" value={f.landlordPAN} editable={!dis} autoCapitalize="characters"
            onChangeText={v => set('landlordPAN', v.toUpperCase())} placeholder="ABCDE1234F" style={{ marginBottom: 0 }} />
        </Box>
        <Box bg={C.brandTint} style={{ marginBottom: 10 }}>
          <Checkbox checked={!!f.showHra2} onChange={v => set('showHra2', v ? 'y' : '')} disabled={dis}
            label={<Txt size={12} w={600} color={C.brandDeep} style={{ flex: 1 }}>Changed residence mid-year? Add second HRA period</Txt>} />
        </Box>
        {!!f.showHra2 && (
          <Box bg={C.sunken} edge={C.lineStrong} style={{ padding: S.md, marginBottom: 10 }}>
            <Txt size={12} w={700} style={{ marginBottom: S.sm }}>Period 2</Txt>
            <Row2>
              <SelectField label="From Month" value={f.hra2From} options={MONTH_OPTS} onChange={v => set('hra2From', v)} disabled={dis} style={{ flex: 1 }} />
              <SelectField label="To Month" value={f.hra2To} options={MONTH_OPTS} onChange={v => set('hra2To', v)} disabled={dis} style={{ flex: 1 }} />
            </Row2>
            {num('rentM2', 'Monthly Rent Paid (₹)')}
            <SelectField label="City Type" value={f.cityType2} options={CITY_OPTS2} onChange={v => set('cityType2', v)} disabled={dis} style={{ marginBottom: 0 }} />
          </Box>
        )}
        {N(f.rentM) > 0 && (
          <Box bg={C.positiveTint} edge={C.lineStrong} style={{ marginBottom: 10 }}>
            <Txt size={12} color={C.positive}>Total HRA Exempt: <B>{R(hraExempt)}</B></Txt>
          </Box>
        )}

        <SecHead>Section 80C (Max ₹1,50,000)</SecHead>
        <Box bg={C.sunken} edge={C.line} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: S.sm }}>
          <Txt size={11} tone="muted">Employee PF (auto)</Txt><Txt size={11} w={700}>{R(sal.epf)}</Txt>
        </Box>
        {num('lic', 'LIC Premium')}{num('ppf', 'PPF')}{num('elss', 'ELSS / Mutual Funds')}
        {num('tuit', 'Tuition Fees')}{num('hlP', 'Home Loan Principal')}
        <Box bg={c80Total >= 150000 ? C.positiveTint : C.warningTint} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt size={12} w={700} color={c80Total >= 150000 ? C.positive : C.warning}>Total 80C</Txt>
          <Txt size={12} w={700} color={c80Total >= 150000 ? C.positive : C.warning}>{R(c80Total)} / ₹1,50,000</Txt>
        </Box>

        <SecHead>80D, Home Loan &amp; NPS</SecHead>
        {num('medSelf', '80D Self + Family (max ₹25,000)')}
        {num('medParents', '80D Parents (max ₹50,000)')}
        {num('hlInt', 'Home Loan Interest Sec 24(b) (max ₹2,00,000)')}
        <SelectField label="NPS Self 80CCD(1B) (max ₹50,000)" value={f.npsSelf} onChange={v => set('npsSelf', v)} disabled={dis}
          options={[{ value: '0', label: '₹0: Not investing' }, { value: '50000', label: '₹50,000: Max benefit' }]} />
        <SelectField label="Employer NPS 80CCD(2): 10% of Basic (fully exempt)" value={f.emplrNpsOld} onChange={v => set('emplrNpsOld', v)} disabled={dis}
          options={[{ value: '0', label: '₹0: Not applicable' }, { value: 'on', label: `${R(Math.round(sal.basic * .1))} (Basic × 10%)` }]} />

        <SecHead>Other Deductions (80E · 80DD · 80DDB · 80G)</SecHead>
        {num('eduLoan', '80E: Education Loan Interest (max ₹2,00,000)')}
        <SelectField label="80DD: Dependent Disability (fixed)" value={f.dep80dd} onChange={v => set('dep80dd', v)} disabled={dis}
          options={[{ value: '0', label: '₹0: Not applicable' }, { value: '75000', label: '₹75,000: 40–80% (Normal)' }, { value: '125000', label: '₹1,25,000: 80%+ Severe' }]} />
        {num('dis80ddb', '80DDB: Specified Disease (max ₹1,00,000)')}
        {num('pmFund', '80G: PM Relief / PM CARES (100%, max ₹2,00,000)')}
      </Card>

      {/* NEW */}
      <Card style={{ marginBottom: S.md, borderLeftWidth: 3, borderLeftColor: C.positive }}>
        <Txt size={14} w={700}>New Regime Declaration</Txt>
        <Txt size={12} tone="muted" style={{ marginBottom: S.sm }}>Std Deduction ₹75,000 | No HRA / 80C / 80D</Txt>
        <Box bg={C.positiveTint} edge={C.lineStrong} style={{ padding: S.md, marginBottom: 13 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Txt size={12} w={500} color={C.positive}>Standard Deduction (auto)</Txt><Txt size={12} w={700}>₹75,000</Txt>
          </View>
          <Txt size={10} color={C.positive}>HRA · LTA · 80C · 80D · Home Loan: Not applicable</Txt>
        </Box>
        <SelectField label="Employer NPS 80CCD(2): 14% of Basic (fully exempt)" value={f.emplrNpsNew} onChange={v => set('emplrNpsNew', v)} disabled={dis}
          options={[{ value: '0', label: '₹0: Not applicable' }, { value: 'on', label: `${R(Math.round(sal.basic * .14))} (Basic × 14%)` }]} />
        <SecHead>Additional Income (FY 2026-27)</SecHead>
        {num('oi', 'Other Income (rental, freelance)')}
        {num('bon', 'Bonus / Commission')}
        {num('iinc', 'Incentive / Award')}
        {num('varEx', 'Variable Pay Expected (rest of year)')}
        {num('iInc', 'Interest Income (FD / Savings)')}
        <Box bg={C.positiveTint} edge={C.lineStrong} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt size={12} w={700} color={C.positive}>Total Additional Income</Txt><Txt size={12} w={700} color={C.positive}>{R(addITotal)}</Txt>
        </Box>
      </Card>
    </View>
  )
}
