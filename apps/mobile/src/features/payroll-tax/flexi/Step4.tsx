// Step 4 — TDS Report (FlexiTdsCalculator.tsx lines 839–1001).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Button, Card, Txt } from '@/ui/primitives'
import { R, SLAB_LABELS, type Regime, type Sal, type Tax } from '../tax'
import { B, Box, Line, Pill } from '../ui'
import { OLD_EDGE } from './Step3'

// Literal colours the website hardcodes in this step (hero gradients, regime inks).
const HERO_OLD = ['#B45309', '#C2410C'] as const
const HERO_NEW = ['#059669', '#047857'] as const
const OLD_INK = '#9b2c2c'
const NEW_INK = '#1c4532'

function MRow({ l, o, n, exempt, indent }: { l: string; o: string; n: string; exempt?: boolean; indent?: boolean }) {
  const { C } = useTheme()
  const col = exempt ? C.positive : C.ink
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 10, backgroundColor: exempt ? C.positiveTint : 'transparent', gap: 6 }}>
      <Txt size={12} color={col} style={{ flex: 1.6, paddingLeft: indent ? 10 : 0 }}>{l}</Txt>
      <Txt size={12} color={col} style={{ flex: 1, textAlign: 'right' }}>{o}</Txt>
      <Txt size={12} color={col} style={{ flex: 1, textAlign: 'right' }}>{n}</Txt>
    </View>
  )
}
function BRow({ l, o, n, bg, col }: { l: string; o: string; n: string; bg: string; col: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: bg, gap: 6 }}>
      <Txt size={13} w={700} color={col} style={{ flex: 1.6 }}>{l}</Txt>
      <Txt size={13} w={700} color={col} style={{ flex: 1, textAlign: 'right' }}>{o}</Txt>
      <Txt size={13} w={700} color={col} style={{ flex: 1, textAlign: 'right' }}>{n}</Txt>
    </View>
  )
}
function SecRow({ t }: { t: string }) {
  const { C } = useTheme()
  return <View style={{ paddingVertical: 8, paddingHorizontal: 10, backgroundColor: C.brandTint }}><Txt size={11} w={700} color={C.brandDeep}>{t}</Txt></View>
}

function RegimeOption({ rg, sel, rec, locked, tax, mo, onPick }: { rg: Regime; sel: boolean; rec: boolean; locked: boolean; tax: number; mo: number; onPick: () => void }) {
  const { C, isDark } = useTheme()
  const isOld = rg === 'OLD'
  const accent = isOld ? OLD_EDGE : C.positive
  return (
    <Pressable onPress={locked ? undefined : onPick} accessibilityRole="radio" accessibilityState={{ selected: sel, disabled: locked }}
      style={{ flex: 1, minWidth: 140, padding: S.md, borderRadius: 10, borderWidth: 2, borderColor: sel ? (isOld ? C.warningEdge : C.positive) : C.line,
        backgroundColor: sel ? (isOld ? C.warningTint : C.positiveTint) : C.surface, opacity: locked && !sel ? 0.45 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <View style={{ width: 16, height: 16, borderRadius: 99, borderWidth: 2, borderColor: sel ? accent : C.line, backgroundColor: sel ? accent : C.surface }} />
        <Txt size={14} w={700} color={isDark ? (isOld ? C.critical : C.positive) : (isOld ? OLD_INK : NEW_INK)}>{isOld ? 'Old Regime' : 'New Regime'}</Txt>
        {rec && <Pill label="Recommended" bg={C.brandTint} fg={C.brandDeep} style={{ paddingHorizontal: 7 }} />}
      </View>
      <Txt size={11} tone="muted" style={{ marginTop: 6 }}>Annual tax <B color={C.ink}>{R(tax)}</B> · Monthly TDS <B color={C.ink}>{R(mo)}</B></Txt>
    </Pressable>
  )
}

export interface Step4Props {
  T: Tax | null; sal: Sal; chosenRegime: Regime | null; recRegime: Regime | null; userPicked: boolean
  isSubmitted: boolean; editMode: null | 'flexi' | 'all'; status: 'NEW' | 'DRAFT' | 'SUBMITTED'; saving: boolean; draftMsg: string
  onPick: (rg: Regime) => void; onSubmit: () => void; onDraft: () => void; onEdit: () => void; onCancelEdit: () => void
  onPdf: () => void; onExcel: () => void; onBack: () => void
}

export function Step4(p: Step4Props) {
  const { C, isDark } = useTheme()
  const { T, sal } = p
  if (!T) return <Card style={{ alignItems: 'center', padding: 40 }}><Txt tone="muted" center>Complete Steps 1–3 first.</Txt></Card>
  const rec: Regime = T.fO <= T.fN ? 'OLD' : 'NEW', save = Math.abs(T.fO - T.fN)
  const metrics = [
    { l: 'Annual CTC', v: R(sal.ctc), s: SLAB_LABELS[sal.si] }, { l: T.mid ? 'Earned Salary' : 'Flexi Wallet', v: R(T.mid ? sal.ctc * T.pr : sal.other), s: T.mid ? `${T.months} mo · ${Math.round(T.pr * 100)}%` : 'Other Reimb.' },
    { l: 'Old Regime Tax', v: R(T.fO), s: 'Eff ' + T.efO + '%' }, { l: 'New Regime Tax', v: R(T.fN), s: 'Eff ' + T.efN + '%' },
    { l: 'HRA Exemption', v: R(T.hE), s: T.hE ? 'Old only' : 'No rent' }, { l: 'Tax Savings', v: R(save), s: rec + ' wins' },
    { l: 'Monthly TDS', v: R(rec === 'OLD' ? T.moO : T.moN), s: 'Recommended' }, { l: 'Best Regime', v: rec, s: 'For you' },
  ]
  const isErr = p.draftMsg.startsWith('⚠')
  return (
    <View>
      <LinearGradient colors={rec === 'OLD' ? HERO_OLD : HERO_NEW} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 14, padding: S.lg, marginBottom: S.md, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: S.md }}>
        <View>
          <Txt size={17} w={700} color="#FFFFFF">Recommended: {rec === 'OLD' ? 'Old' : 'New'} Regime</Txt>
          <Txt size={12} color="#FFFFFF" style={{ opacity: 0.9 }}>You save <B>{R(save)}</B> annually</Txt>
        </View>
        <View style={{ alignItems: 'flex-end', flexGrow: 1 }}>
          <Txt size={32} w={800} color="#FFFFFF">{R(rec === 'OLD' ? T.fO : T.fN)}</Txt>
          <Txt size={11} color="#FFFFFF" style={{ opacity: 0.85 }}>Annual Tax · Monthly TDS {R(rec === 'OLD' ? T.moO : T.moN)}</Txt>
        </View>
      </LinearGradient>

      <Card style={{ marginBottom: S.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginBottom: 10 }}>
          <Txt size={14} w={700}>Save &amp; Submit: Tax Regime</Txt>
          {p.isSubmitted && !p.editMode && <Pill label="Submitted & locked" bg={C.positiveTint} fg={C.positive} />}
          {!!p.editMode && <Pill label={`Editing ${p.editMode === 'all' ? 'flexi + investments' : 'flexi only'}`} bg={C.warningTint} fg={C.warning} />}
          {p.status === 'DRAFT' && <Pill label="Draft saved" bg={C.infoTint} fg={C.info} />}
        </View>
        {!p.userPicked && !p.isSubmitted && !!p.recRegime && (
          <Box bg={C.infoTint} edge={C.brandEdge} style={{ marginBottom: 10 }}>
            <Txt size={12} color={C.brand}>We&apos;ve pre-selected the <B>{p.recRegime === 'OLD' ? 'Old' : 'New'} Regime</B>. It gives you the <B>lower annual tax</B>. You can change it below before submitting.</Txt>
          </Box>
        )}
        {p.isSubmitted && !p.editMode && (
          <Box bg={C.brandTint} edge={C.brandEdge} style={{ marginBottom: 10 }}>
            <Txt size={12} color={C.brandDeep}>You submitted the <B>{p.chosenRegime === 'OLD' ? 'Old' : 'New'} Regime</B>. Your regime is locked. {p.chosenRegime === 'OLD' ? 'Use Edit to change your flexi & investment declarations.' : 'Use Edit to change your flexi declaration (investment sections don’t apply to the New Regime).'}</Txt>
          </Box>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: S.md }}>
          {(['OLD', 'NEW'] as const).map(rg => (
            <RegimeOption key={rg} rg={rg} sel={p.chosenRegime === rg} rec={rec === rg} locked={p.isSubmitted}
              tax={rg === 'OLD' ? T.fO : T.fN} mo={rg === 'OLD' ? T.moO : T.moN} onPick={() => p.onPick(rg)} />
          ))}
        </View>
        <View style={{ gap: S.sm }}>
          {(!p.isSubmitted || !!p.editMode) && (
            <Button full title={p.saving ? 'Saving…' : p.editMode ? 'Save & re-submit' : `Submit ${p.chosenRegime || ''} declaration`}
              disabled={!p.chosenRegime || p.saving} onPress={p.onSubmit} />
          )}
          {!p.isSubmitted && <Button full variant="outline" title="Save Draft" disabled={p.saving} onPress={p.onDraft} />}
          {p.isSubmitted && !p.editMode && <Button full title={`Edit ${p.chosenRegime === 'OLD' ? 'flexi & investments' : 'flexi'}`} onPress={p.onEdit} />}
          {p.isSubmitted && !p.editMode && (
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <Button variant="outline" title="⬇ Download PDF" onPress={p.onPdf} style={{ flex: 1 }} />
              <Button variant="outline" title="⬇ Excel" onPress={p.onExcel} style={{ flex: 1 }} />
            </View>
          )}
          {!!p.editMode && <Button full variant="outline" title="Cancel edit" onPress={p.onCancelEdit} />}
          {!!p.draftMsg && <Txt size={11} w={600} color={isErr ? C.critical : C.positive}>{p.draftMsg}</Txt>}
        </View>
      </Card>

      {T.mid && (
        <Box bg={C.infoTint} edge={C.brandEdge} style={{ padding: S.lg, marginBottom: S.md, borderRadius: 14 }}>
          <Txt size={12} color={C.brand} style={{ lineHeight: 20 }}>📅 <B>Pro-rated for mid-year joining:</B> salary income taxed for <B>{T.months} of 12 months</B> (≈{Math.round(T.pr * 100)}%). Annual tax above is spread over the <B>{T.months} remaining pay month{T.months === 1 ? '' : 's'}</B>Monthly TDS = Annual Tax ÷ {T.months}. Standard deduction &amp; your actual investment declarations are counted in full.</Txt>
        </Box>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
        {metrics.map(m => (
          <Card key={m.l} style={{ flexGrow: 1, flexBasis: '45%', padding: S.md }}>
            <Txt size={10} w={600} tone="muted">{m.l}</Txt>
            <Txt size={16} w={700} style={{ marginVertical: 2 }}>{m.v}</Txt>
            <Txt size={10} tone="muted">{m.s}</Txt>
          </Card>
        ))}
      </View>

      <View style={{ gap: S.md }}>
        {(['OLD', 'NEW'] as const).map(rg => {
          const io = rg === 'OLD', ir = rec === rg
          const tax = io ? T.fO : T.fN, gr = io ? T.gO : T.gN, ded = io ? T.dO : T.dN, tx2 = io ? T.tO : T.tN, mo = io ? T.moO : T.moN, eff = io ? T.efO : T.efN
          return (
            <Card key={rg} style={[{ borderLeftWidth: 3, borderLeftColor: io ? OLD_EDGE : C.positive }, ir && { borderWidth: 2, borderColor: C.brand, borderLeftWidth: 3 }]}>
              <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
                <Txt size={13} w={700} color={isDark ? (io ? C.critical : C.positive) : (io ? OLD_INK : NEW_INK)}>{io ? 'Old' : 'New'} Regime</Txt>
                {ir && <Pill label="Recommended" bg={C.brand} fg={C.onAccent} style={{ paddingHorizontal: 7 }} />}
              </View>
              <Txt size={26} w={800} color={io ? OLD_EDGE : C.positive} style={{ marginVertical: 4 }}>{R(tax)}</Txt>
              <Txt size={11} tone="muted" style={{ marginBottom: S.sm }}>Effective {eff}% · Monthly TDS {R(mo)}</Txt>
              {[['Gross Income', R(gr)], ['(–) Deductions', R(ded)], ['= Net Taxable', R(tx2)], ['Annual Tax', R(tax)], ['Monthly TDS', R(mo)]].map(([l, v]) => <Line key={l} label={l} value={v} />)}
            </Card>
          )
        })}
      </View>

      <Card padded={false} style={{ marginTop: S.md, marginBottom: S.md, overflow: 'hidden' }}>
        <View style={{ padding: S.md, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <Txt size={13} w={700}>Taxable Income Breakup (Component-wise)</Txt>
          <Txt size={11} tone="muted">What is taxable, what is exempt, and how TDS is computed</Txt>
        </View>
        <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, backgroundColor: C.brandTint, gap: 6 }}>
          <Txt size={11} w={600} tone="muted" style={{ flex: 1.6 }}>Component</Txt>
          <Txt size={11} w={600} color={C.warning} style={{ flex: 1, textAlign: 'right' }}>Old (₹)</Txt>
          <Txt size={11} w={600} color={C.positive} style={{ flex: 1, textAlign: 'right' }}>New (₹)</Txt>
        </View>
        <SecRow t={T.mid ? `📌 INCOME (${T.months} months · pro-rated ${Math.round(T.pr * 100)}%)` : 'INCOME'} />
        <MRow l="Basic Salary (100% taxable)" o={R(T.eBasic)} n={R(T.eBasic)} />
        <MRow l={'HRA Received (' + R(T.eHra) + ')'} o="" n="" />
        {T.hE > 0 && <MRow indent l="✓ HRA Exemption" o={`(${R(T.hE)})`} n="N/A" exempt />}
        <MRow indent l="= Net Taxable HRA" o={R(T.eHra - T.hE)} n={R(T.eHra)} />
        <MRow l={'Flexi Wallet: Total ' + R(T.eOther)} o="" n="" />
        {(T.oClaim > 0 || T.nClaim > 0) && <MRow indent l="✓ Flexi Claimed (exempt on bills)" o={T.oClaim ? `(${R(T.oClaim)})` : '-'} n={T.nClaim ? `(${R(T.nClaim)})` : '-'} exempt />}
        <MRow indent l="= Wallet Balance (taxable)" o={R(T.walBalO)} n={R(T.walBalN)} />
        {T.eVari > 0 && <MRow l="Variable Pay" o={R(T.eVari)} n={R(T.eVari)} />}
        {T.addI > 0 && <MRow l="Additional Income" o={R(T.addI)} n={R(T.addI)} />}
        {(T.oPerq > 0 || T.nPerq > 0) && <MRow l="Car+Driver Perquisite (₹10,000/mo)" o={T.oPerq ? `+${R(T.oPerq)}` : '-'} n={T.nPerq ? `+${R(T.nPerq)}` : '-'} />}
        <BRow l="Gross Taxable Income" o={R(T.grossO)} n={R(T.grossN)} bg={C.sunken} col={C.ink} />
        <SecRow t="DEDUCTIONS" />
        <MRow l="Standard Deduction" o="(₹50,000)" n="(₹75,000)" exempt />
        {T.ltaAmt > 0 && <MRow l="Leave Travel Allowance" o={`(${R(T.ltaAmt)})`} n="N/A" exempt />}
        {T.c80 > 0 && <MRow l="80C: EPF + Investments" o={`(${R(T.c80)})`} n="N/A" exempt />}
        {T.medS > 0 && <MRow l="80D Self + Family" o={`(${R(T.medS)})`} n="N/A" exempt />}
        {T.medP > 0 && <MRow l="80D Parents" o={`(${R(T.medP)})`} n="N/A" exempt />}
        {T.hlI > 0 && <MRow l="Home Loan Interest 24(b)" o={`(${R(T.hlI)})`} n="N/A" exempt />}
        {T.dep80dd > 0 && <MRow l="80DD: Dependent Disability" o={`(${R(T.dep80dd)})`} n="N/A" exempt />}
        {T.dis80ddb > 0 && <MRow l="80DDB: Disease Treatment" o={`(${R(T.dis80ddb)})`} n="N/A" exempt />}
        {T.pmFund > 0 && <MRow l="80G: PM Relief Fund" o={`(${R(T.pmFund)})`} n="N/A" exempt />}
        {T.eduLoan > 0 && <MRow l="80E: Education Loan" o={`(${R(T.eduLoan)})`} n="N/A" exempt />}
        {T.npsS > 0 && <MRow l="NPS Self 80CCD(1B)" o={`(${R(T.npsS)})`} n="N/A" exempt />}
        {(T.eNpsO > 0 || T.eNpsN > 0) && <MRow l="Employer NPS 80CCD(2)" o={T.eNpsO ? `(${R(T.eNpsO)})` : '-'} n={T.eNpsN ? `(${R(T.eNpsN)})` : '-'} exempt />}
        <BRow l="Net Taxable Income" o={R(T.tO)} n={R(T.tN)} bg={C.brandTint} col={C.brandDeep} />
        <SecRow t="TAX" />
        <MRow l="Tax on income (slab)" o={R(T.bO)} n={R(T.bN)} />
        <MRow l="Rebate u/s 87A" o={T.tO <= 500000 ? `(${R(Math.min(T.bO, 12500))})` : '-'} n={T.tN <= 1200000 ? `(${R(T.bN)})` : '-'} exempt />
        <MRow l="Add: 4% Health & Edu Cess" o={R(Math.round(T.fO / 1.04 * .04))} n={R(Math.round(T.fN / 1.04 * .04))} />
        <BRow l="TOTAL ANNUAL TAX" o={R(T.fO)} n={R(T.fN)} bg={C.brandTint} col={C.brandDeep} />
        <BRow l={`MONTHLY TDS (÷${T.months})`} o={R(T.moO)} n={R(T.moN)} bg={C.sunken} col={C.ink} />
      </Card>

      <Box bg={C.warningTint} edge={C.warningEdge} style={{ padding: S.lg, marginBottom: S.md, borderRadius: 14 }}>
        <Txt size={13} w={700} color={C.warning} style={{ marginBottom: 6 }}>Important Disclaimer</Txt>
        <Txt size={12} color={C.warning} style={{ lineHeight: 20 }}>This is an <B>estimate</B> for comparison &amp; investment planning only. Actual TDS may vary with final proofs, payroll processing, mid-year changes or tax-law amendments. Please confirm with your HR / Finance team and file your full investment declaration on the HRMS portal for accurate TDS. Not tax or financial advice. FY 2026-27 (AY 2027-28).</Txt>
      </Box>
      <Button variant="outline" title="Back" onPress={p.onBack} style={{ alignSelf: 'flex-start' }} />
    </View>
  )
}
