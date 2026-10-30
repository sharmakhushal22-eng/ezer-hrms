// Investment Declaration — components/ess/InvestmentDeclaration.tsx on the phone.
//
// Not in the website's nav (removed on request); reachable by the 'declaration' view
// key. One declaration per employee per FY, saved through the
// save_investment_declaration RPC, plus house property and previous-employer rows.
// Copy (Hinglish included), rules and every Supabase call are the website's.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/core/supabase'
import { useEmployeeId } from '@/core/session'
import { useEmployee } from '@/core/employee'
import { queryClient } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Button, Card, ErrorState, Input, Loading, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { useOverlay } from '@/ui/overlays'
import { groupIN } from '../tax'
import { B, Box, Pill } from '../ui'
import { AmountRow, HousePropertyRow, RegimeCard, YesRow, num } from './parts'

const FY = '2026-27'
const CAP_80C = 150000
const inr = (n: any) => '₹' + groupIN(Math.round(Number(n) || 0))

async function loadDeclaration(employeeId: string) {
  const { data: ss } = await supabase.from('salary_structures')
    .select('employee_pf').eq('employee_id', employeeId).eq('fy', FY)
    .order('effective_date', { ascending: false }).limit(1)
  const { data: d } = await supabase.from('tds_declarations')
    .select('*').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
  const { data: hpRows } = await supabase.from('tds_house_property')
    .select('*').eq('employee_id', employeeId).eq('fy', FY).order('created_at')
  const { data: prev } = await supabase.from('tds_previous_employer')
    .select('*').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
  return { pfMonthly: num((ss as any)?.[0]?.employee_pf), d: d as any, hp: (hpRows || []) as any[], prev: prev as any }
}

function Head({ children, note }: { children: React.ReactNode; note?: string }) {
  const { C } = useTheme()
  return (
    <Txt size={11} w={700} color={C.brandDeep} upper style={{ marginTop: 18, marginBottom: 2 }}>
      {children}{note ? <Txt size={11} w={600} tone="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>{note}</Txt> : null}
    </Txt>
  )
}

export default function DeclarationScreen() {
  const { C } = useTheme()
  const employeeId = useEmployeeId()
  const { emp } = useEmployee()
  const empName: string | undefined = emp?.full_name, empCode: string | undefined = emp?.emp_code
  const q = useQuery({ queryKey: ['payroll-tax', 'declaration', employeeId], queryFn: () => loadDeclaration(employeeId), enabled: !!employeeId })

  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState('')
  // The website's inline ✓/error boxes sit at the end of the page; a phone user who
  // tapped a button further up would not see them, so they are also toasted.
  const { notify } = useOverlay()
  React.useEffect(() => { if (msg) notify(msg) }, [msg, notify])
  React.useEffect(() => { if (err) notify(err, 'error') }, [err, notify])
  const [regime, setRegime] = React.useState('OLD')
  const [lic, setLic] = React.useState('')
  const [ppf, setPpf] = React.useState('')
  const [rent, setRent] = React.useState('')
  const [pan, setPan] = React.useState('')
  const [isMetro, setIsMetro] = React.useState(false)
  const [pf, setPf] = React.useState(0)
  const [savedRegime, setSavedRegime] = React.useState<string | null>(null)
  const [switches, setSwitches] = React.useState(0)
  const [lockedAt, setLockedAt] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState('')
  const [d80dSelf, setD80dSelf] = React.useState('')
  const [d80dParents, setD80dParents] = React.useState('')
  const [d80dParentsSenior, setD80dParentsSenior] = React.useState(false)
  const [d80dPreventive, setD80dPreventive] = React.useState('')
  const [d80e, setD80e] = React.useState('')
  const [d80eYear, setD80eYear] = React.useState('')
  const [d24b, setD24b] = React.useState('')
  const [d80dd, setD80dd] = React.useState(''); const [d80ddSevere, setD80ddSevere] = React.useState(false)
  const [d80ddb, setD80ddb] = React.useState('')
  const [d80eeb, setD80eeb] = React.useState('')
  const [d80g, setD80g] = React.useState('')
  const [d80u, setD80u] = React.useState(''); const [d80uSevere, setD80uSevere] = React.useState(false)
  const [incSavings, setIncSavings] = React.useState('')
  const [incFd, setIncFd] = React.useState('')
  const [incDividend, setIncDividend] = React.useState('')
  const [incOther, setIncOther] = React.useState('')
  const [hp, setHp] = React.useState<any[]>([])
  const [hpBusy, setHpBusy] = React.useState(false)
  const [prevIncome, setPrevIncome] = React.useState('')
  const [prevTds, setPrevTds] = React.useState('')
  const [prevPf, setPrevPf] = React.useState('')
  const [prevPt, setPrevPt] = React.useState('')

  // load(): the website sets each field from what came back (and leaves the rest as typed).
  // Applied when fresh server data arrives, during render (React's adjust-state pattern).
  const [seen, setSeen] = React.useState<typeof q.data>(undefined)
  const x = q.data
  if (x && x !== seen) {
    setSeen(x)
    setPf(x.pfMonthly * 12)
    const d = x.d
    if (d) {
      setRegime(d.regime || 'OLD'); setSavedRegime(d.regime || null)
      const typed = Math.max(0, num(d.sec_80c) - x.pfMonthly * 12)
      setLic(typed ? String(typed) : '')
      setRent(num(d.monthly_rent) ? String(num(d.monthly_rent)) : '')
      setPan(d.landlord_pan || '')
      setIsMetro(!!d.is_metro)
      setSwitches(num(d.regime_switches)); setLockedAt(d.regime_locked_at || null)
      setStatus(d.declaration_status || '')
      const s = (v: any) => (num(v) ? String(num(v)) : '')
      setD80dSelf(s(d.sec_80d_self)); setD80dParents(s(d.sec_80d_parents))
      setD80dParentsSenior(!!d.sec_80d_parents_senior); setD80dPreventive(s(d.sec_80d_preventive))
      if (!num(d.sec_80d_self) && !num(d.sec_80d_parents) && num(d.sec_80d)) setD80dSelf(s(d.sec_80d))
      setD80e(s(d.sec_80e)); setD80eYear(d.sec_80e_first_repayment_year ? String(d.sec_80e_first_repayment_year) : '')
      setD24b(s(d.sec_24b))
      setD80dd(s(d.sec_80dd)); setD80ddSevere(!!d.sec_80dd_severe)
      setD80ddb(s(d.sec_80ddb)); setD80eeb(s(d.sec_80eeb)); setD80g(s(d.sec_80g))
      setD80u(s(d.sec_80u)); setD80uSevere(!!d.sec_80u_severe)
      setIncSavings(s(d.income_interest_savings)); setIncFd(s(d.income_interest_fd))
      setIncDividend(s(d.income_dividend)); setIncOther(s(d.income_other))
    }
    setHp(x.hp)
    const prev = x.prev
    if (prev) {
      setPrevIncome(num(prev.taxable_income) ? String(num(prev.taxable_income)) : '')
      setPrevTds(num(prev.tds_deducted) ? String(num(prev.tds_deducted)) : '')
      setPrevPf(num(prev.pf_deducted) ? String(num(prev.pf_deducted)) : '')
      setPrevPt(num(prev.professional_tax) ? String(num(prev.professional_tax)) : '')
    }
  }
  const load = () => {
    void queryClient.invalidateQueries({ queryKey: ['payroll-tax', 'declaration', employeeId] })
    void queryClient.invalidateQueries({ queryKey: ['payroll-tax', 'proofs', employeeId] })
  }

  const jan1 = new Date(Number(FY.split('-')[0]) + 1, 0, 1)
  const canSwitch = !lockedAt && switches < 1 && new Date() < jan1
  const regimeChanged = savedRegime !== null && savedRegime !== regime
  const regimeBlocked = regimeChanged && !canSwitch
  const typed80c = num(lic) + num(ppf)
  const total80c = Math.min(pf + typed80c, CAP_80C)
  const over80c = pf + typed80c > CAP_80C
  const annualRent = num(rent) * 12
  const panNeeded = annualRent > 100000
  const panMissing = panNeeded && !pan.trim()
  const d80dTotal = num(d80dSelf) + Math.min(num(d80dParents) + num(d80dPreventive), 999999999)
  const totalDeclared = regime === 'NEW' ? 0
    : total80c + d80dTotal + num(d80e) + num(d24b) + num(d80dd) + num(d80ddb) + num(d80eeb) + num(d80g) + num(d80u)

  async function save(submit: boolean) {
    setErr(''); setMsg('')
    if (regimeBlocked) { setErr('Regime ab nahi badal sakta: ek baar badla ja chuka hai ya January nikal gayi.'); return }
    if (regime === 'OLD' && panMissing) { setErr('Landlord PAN zaroori hai: saal ka rent ₹1,00,000 se zyada hai.'); return }
    setBusy(true)
    const isNew = regime === 'NEW'
    const { error } = await supabase.rpc('save_investment_declaration', {
      p_employee_id: employeeId, p_fy: FY, p_regime: regime,
      p_sec_80c: isNew ? 0 : pf + typed80c,
      p_sec_80d: isNew ? 0 : num(d80dSelf),
      p_monthly_rent: isNew ? 0 : num(rent),
      p_landlord_pan: isNew ? null : (pan.trim() || null),
      p_hra_claimed: isNew ? 0 : annualRent,
      p_submit: submit,
      p_sec_80e: isNew ? 0 : num(d80e), p_sec_24b: isNew ? 0 : num(d24b),
      p_sec_80d_self: isNew ? 0 : num(d80dSelf), p_sec_80d_parents: isNew ? 0 : num(d80dParents),
      p_sec_80d_parents_senior: isNew ? false : d80dParentsSenior, p_sec_80d_preventive: isNew ? 0 : num(d80dPreventive),
      p_sec_80dd: isNew ? 0 : num(d80dd), p_sec_80dd_severe: isNew ? false : d80ddSevere,
      p_sec_80ddb: isNew ? 0 : num(d80ddb), p_sec_80eeb: isNew ? 0 : num(d80eeb), p_sec_80g: isNew ? 0 : num(d80g),
      p_sec_80u: isNew ? 0 : num(d80u), p_sec_80u_severe: isNew ? false : d80uSevere,
      p_sec_80e_first_repayment_year: isNew ? null : (Number(d80eYear) || null),
      p_income_interest_savings: num(incSavings), p_income_interest_fd: num(incFd),
      p_income_dividend: num(incDividend), p_income_other: num(incOther),
    })
    if (error) { setBusy(false); setErr(error.message); return }
    await supabase.from('tds_declarations').update({ is_metro: isNew ? null : isMetro }).eq('employee_id', employeeId).eq('fy', FY)
    try {
      const lines: [string, number][] = isNew ? [] : [
        ['80C_EPF', pf], ['80C_LIC', num(lic)], ['80C_PPF', num(ppf)],
        ['80D_SELF', num(d80dSelf)], ['80D_PARENTS', num(d80dParents)], ['80E', num(d80e)], ['24B_SELF', num(d24b)],
        ['80DD', num(d80dd)], ['80DDB', num(d80ddb)], ['80EEB', num(d80eeb)], ['80G', num(d80g)], ['80U', num(d80u)],
      ]
      if (lines.length) {
        await supabase.from('investment_declaration_lines').upsert(
          lines.map(([section_code, declared_amount]) => ({ employee_id: employeeId, fy: FY, section_code, declared_amount, source: 'ess-form', updated_at: new Date().toISOString() })),
          { onConflict: 'employee_id,fy,section_code' })
      }
    } catch { /* lines table optional */ }
    setBusy(false)
    setMsg(submit ? 'Declaration submit ho gayi. Har month ka TDS ab isi se banega.' : 'Draft save ho gaya.')
    load()
  }

  async function saveHouseProperty(row: any) {
    setHpBusy(true); setErr('')
    const { error } = await supabase.rpc('save_tds_house_property', {
      p_id: row.id || null, p_employee_id: employeeId, p_fy: FY,
      p_occupancy_type: row.occupancy_type, p_address: row.address || null,
      p_annual_rent_received: num(row.annual_rent_received), p_municipal_taxes_paid: num(row.municipal_taxes_paid),
      p_interest_on_loan: num(row.interest_on_loan), p_pre_construction_interest: num(row.pre_construction_interest),
      p_lender_name: row.lender_name || null, p_lender_pan: row.lender_pan || null,
      p_lender_address: row.lender_address || null, p_co_owner_share_pct: row.co_owner_share_pct ? num(row.co_owner_share_pct) : null,
    })
    setHpBusy(false)
    if (error) { setErr(error.message); return }
    setMsg('Property save ho gayi.')
    load()
  }
  async function deleteHouseProperty(id: string) {
    setHpBusy(true); setErr('')
    const { error } = await supabase.rpc('save_tds_house_property', { p_id: id, p_employee_id: employeeId, p_delete: true })
    setHpBusy(false)
    if (error) { setErr(error.message); return }
    load()
  }
  async function savePreviousEmployer() {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('save_tds_previous_employer', {
      p_employee_id: employeeId, p_fy: FY,
      p_taxable_income: num(prevIncome), p_tds_deducted: num(prevTds),
      p_pf_deducted: num(prevPf), p_professional_tax: num(prevPt),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setMsg('Previous employer details save ho gaye.')
    load()
  }

  const submitOff = busy || regimeBlocked || (regime === 'OLD' && panMissing)
  const footer = q.data ? (
    <View style={{ flexDirection: 'row', gap: S.sm }}>
      <Button variant="outline" title="Save as draft" onPress={() => save(false)} disabled={busy} style={{ flex: 1 }} />
      <Button title={busy ? 'Saving…' : 'Submit declaration'} onPress={() => save(true)} disabled={submitOff} style={{ flex: 1 }} />
    </View>
  ) : null

  return (
    <Screen title="Investment Declaration" subtitle="Payroll" onRefresh={() => q.refetch()} footer={footer}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <View>
          <View style={{ marginBottom: S.md }}>
            <Txt size={20} w={800}>Investment Declaration</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginTop: 3 }}>
              <Txt size={12} tone="muted">FY {FY} · {empName || '-'}{empCode ? ` · ${empCode}` : ''}</Txt>
              {!!status && <Pill label={status} bg={status === 'SUBMITTED' ? C.positiveTint : C.warningTint} fg={status === 'SUBMITTED' ? C.positive : C.warning} />}
            </View>
          </View>

          <Box bg={C.brandTint} edge={C.brandEdge} style={{ padding: S.lg, marginBottom: S.md, borderRadius: 14 }}>
            <Txt size={13} w={700} color={C.brandDeep}>Applies for the whole financial year.</Txt>
            <Txt size={12} color={C.brandDeep} style={{ marginTop: 3, lineHeight: 18 }}>Ye kisi ek payroll month se juda nahi hai. Har month ka TDS seedha isi se calculate hota hai.</Txt>
          </Box>

          <Card style={{ marginBottom: S.md }}>
            <Txt size={14} w={700} style={{ marginBottom: 3 }}>Choose your tax regime</Txt>
            {canSwitch
              ? <Txt size={12} tone="muted" style={{ lineHeight: 18 }}>January se pehle aap <B>ek baar aur</B> regime badal sakte hain. Uske baad poore FY {FY} ke liye yahi regime rahega.</Txt>
              : <Txt size={12} w={700} color={C.warning} style={{ lineHeight: 18 }}>Regime ab lock hai: {switches >= 1 ? 'ek baar badla ja chuka hai' : 'January nikal gayi'}. Poore FY {FY} ke liye {savedRegime || regime} hi rahega.</Txt>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md, marginTop: S.md }}>
              <RegimeCard code="NEW" title="New Regime" active={regime === 'NEW'} disabled={!canSwitch && savedRegime !== null && savedRegime !== 'NEW'} onPick={setRegime}
                blurb="Kam slab rates. Na HRA exemption, na 80C/80D. Simple: neeche kuch declare nahi karna." />
              <RegimeCard code="OLD" title="Old Regime" active={regime === 'OLD'} disabled={!canSwitch && savedRegime !== null && savedRegime !== 'OLD'} onPick={setRegime}
                blurb="HRA exemption aur Chapter VI-A deductions milti hain. Neeche apna planned investment declare karein." />
            </View>
            {regimeBlocked && <Box bg={C.criticalTint} style={{ marginTop: 10 }}><Txt size={12} color={C.critical}>Ye badlaav save nahi hoga: regime ka ek switch pehle hi use ho chuka hai.</Txt></Box>}
          </Card>

          {regime === 'OLD' && (
            <Card style={{ marginBottom: S.md }}>
              <Txt size={14} w={700} style={{ marginBottom: 3 }}>Declared investments: Old Regime</Txt>
              <Txt size={12} tone="muted" style={{ lineHeight: 18 }}>Saal bhar mein jo invest karne ka plan hai woh likhein. Inke proof saal ke aakhir mein dene honge, ya usse pehle, agar aap resign karte hain.</Txt>

              <Head note={` (cap ${inr(CAP_80C)})`}>Section 80C</Head>
              <AmountRow label="Provident Fund (auto)" hint="Aapke salary structure se, yahan edit nahi hota" value={pf ? String(pf) : '0'} readOnly />
              <AmountRow label="LIC / Insurance premium" value={lic} onChange={setLic} />
              <AmountRow label="PPF / ELSS / other 80C" value={ppf} onChange={setPpf} />
              {over80c && (
                <Box bg={C.warningTint} edge={C.warningEdge} style={{ marginTop: 10 }}>
                  <Txt size={12} color={C.warning}>80C ki legal limit {inr(CAP_80C)} hai. {inr(pf + typed80c)} likhne se exemption nahi badhegi. {inr(CAP_80C)} hi count hoga.</Txt>
                </Box>
              )}

              <Head note=" · self and parents are separate limits">Section 80D (health insurance)</Head>
              <AmountRow label="Self + spouse + children" hint="Cap ₹25,000 · ₹50,000 if you are 60+" value={d80dSelf} onChange={setD80dSelf} />
              <AmountRow label="Parents' premium" hint="Cap ₹25,000 · ₹50,000 if a parent is 60+" value={d80dParents} onChange={setD80dParents} />
              <YesRow label="Parent(s) 60 or above?" checked={d80dParentsSenior} onChange={setD80dParentsSenior} />
              <AmountRow label="Preventive health check-up" hint="Within the limits above, cap ₹5,000" value={d80dPreventive} onChange={setD80dPreventive} />

              <Head>Section 80E &amp; 24(b): loan interest</Head>
              <AmountRow label="Education loan interest (80E)" hint="No cap, but only for 8 years from first repayment" value={d80e} onChange={setD80e} />
              {num(d80e) > 0 && <AmountRow label="First repayment year" hint="e.g. 2024 (the 8-year window is counted from here)" value={d80eYear} onChange={setD80eYear} />}
              <AmountRow label="Home loan interest (24(b))" hint={hp.length ? 'Ignored: a House Property entry below is used instead' : 'Cap ₹2,00,000 (self-occupied only)'} value={d24b} onChange={setD24b} readOnly={hp.length > 0} />

              <Head>The rest of Chapter VI-A</Head>
              <AmountRow label="80DD: disabled dependant" hint="₹75,000 · ₹1,25,000 if severe" value={d80dd} onChange={setD80dd} />
              <YesRow label="Severe disability (80DD)?" checked={d80ddSevere} onChange={setD80ddSevere} />
              <AmountRow label="80DDB: specified disease treatment" hint="₹40,000 · ₹1,00,000 if you are 60+" value={d80ddb} onChange={setD80ddb} />
              <AmountRow label="80EEB: electric vehicle loan interest" hint="Cap ₹1,50,000" value={d80eeb} onChange={setD80eeb} />
              <AmountRow label="80G: donations" hint="Only counted if HR has enabled donations in payroll" value={d80g} onChange={setD80g} />
              <AmountRow label="80U: your own disability" hint="₹75,000 · ₹1,25,000 if severe" value={d80u} onChange={setD80u} />
              <YesRow label="Severe disability (80U)?" checked={d80uSevere} onChange={setD80uSevere} />

              <Head note=" (annual)">Income from other sources</Head>
              <AmountRow label="Savings account interest" hint="80TTA/80TTB exemption is worked out from this automatically" value={incSavings} onChange={setIncSavings} />
              <AmountRow label="Fixed deposit interest" value={incFd} onChange={setIncFd} />
              <AmountRow label="Dividend" value={incDividend} onChange={setIncDividend} />
              <AmountRow label="Any other income" value={incOther} onChange={setIncOther} />

              <Head>HRA exemption</Head>
              <AmountRow label="Monthly rent paid" hint={annualRent > 0 ? `Saal ka ${inr(annualRent)}` : undefined} value={rent} onChange={setRent} />
              {annualRent > 0 && (
                <YesRow label="Rented house is in a metro city?" sub="Mumbai, Delhi, Kolkata, Chennai: 50% of Basic counts instead of 40%" checked={isMetro} onChange={setIsMetro} yes="Yes, metro" />
              )}
              {panNeeded && (
                <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
                  <Txt size={13}>Landlord PAN</Txt>
                  <Txt size={11} color={panMissing ? C.critical : C.muted} style={{ marginTop: 2, marginBottom: 6 }}>Zaroori hai: saal ka rent {inr(100000)} se zyada hai</Txt>
                  <Input value={pan} maxLength={10} placeholder="ABCDE1234F" autoCapitalize="characters" error={panMissing ? ' ' : null}
                    onChangeText={v => setPan(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} style={{ marginBottom: 0 }} />
                </View>
              )}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: S.lg, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
                <Txt size={13} w={700}>Total declared (Chapter VI-A)</Txt>
                <Txt size={19} w={800} color={C.brand}>{inr(totalDeclared)}</Txt>
              </View>
            </Card>
          )}

          {regime === 'NEW' && (
            <Box bg={C.positiveTint} edge={C.positiveEdge} style={{ padding: S.lg, marginBottom: S.md, borderRadius: 14 }}>
              <Txt size={13} color={C.positive} style={{ lineHeight: 20 }}><B>New regime mein kuch declare nahi karna.</B> Slab rates kam hain, par HRA exemption aur 80C/80D deductions nahi milti. Submit karte hi aapke purane declare kiye hue amounts hata diye jaayenge.</Txt>
            </Box>
          )}

          <Card style={{ marginBottom: S.md }}>
            <Txt size={14} w={700} style={{ marginBottom: 3 }}>House property</Txt>
            <Txt size={12} tone="muted" style={{ lineHeight: 18 }}>Ek se zyada property ho sakti hai. Self-occupied ka interest ₹2,00,000 tak, let-out ka poora interest allowed hai.</Txt>
            {hp.map((row, i) => (
              <HousePropertyRow key={row.id || i} row={row}
                onChange={patch => setHp(list => list.map((x, ix) => ix === i ? { ...x, ...patch } : x))}
                onSave={() => saveHouseProperty(hp[i])}
                onDelete={row.id ? () => deleteHouseProperty(row.id) : undefined}
                busy={hpBusy} />
            ))}
            <Button variant="outline" title="+ Add property" onPress={() => setHp(list => [...list, { occupancy_type: 'SELF' }])} style={{ marginTop: hp.length ? 10 : 8, alignSelf: 'flex-start' }} />
          </Card>

          <Card style={{ marginBottom: S.md }}>
            <Txt size={14} w={700} style={{ marginBottom: 3 }}>Previous employer this financial year</Txt>
            <Txt size={12} tone="muted" style={{ lineHeight: 18 }}>Sirf tab bharein agar aap FY {FY} ke beech mein join hue hain aur pehle kahin aur kaam kar rahe the.</Txt>
            <AmountRow label="Taxable income there" value={prevIncome} onChange={setPrevIncome} />
            <AmountRow label="TDS already deducted" value={prevTds} onChange={setPrevTds} />
            <AmountRow label="PF deducted" hint="Record only (transfers via your own PF account)" value={prevPf} onChange={setPrevPf} />
            <AmountRow label="Professional tax paid" hint="Record only" value={prevPt} onChange={setPrevPt} />
            <Button variant="outline" title="Save previous employer details" onPress={savePreviousEmployer} disabled={busy} style={{ marginTop: 10 }} />
          </Card>

          <Box bg={C.sunken} style={{ padding: S.md, marginBottom: S.md }}>
            <Txt size={12} tone="muted" style={{ lineHeight: 19 }}>Proof submission saal ke aakhir mein khulti hai, ya <B>turant, agar aap resign karte hain</B>, taaki aapke last working day se pehle verify ho sake. Jo declare kiya par prove nahi kiya, woh exempt nahi rahega.</Txt>
          </Box>

          {!!msg && <Box bg={C.positiveTint} edge={C.positiveEdge} style={{ padding: S.md, marginBottom: S.md }}><Txt size={13} w={700} color={C.positive}>✓ {msg}</Txt></Box>}
          {!!err && <Box bg={C.criticalTint} style={{ padding: S.md, marginBottom: S.md }}><Txt size={12} color={C.critical}>{err}</Txt></Box>}
        </View>
      )}
    </Screen>
  )
}
