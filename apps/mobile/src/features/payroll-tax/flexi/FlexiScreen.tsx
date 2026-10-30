// Payroll › Flexi Benefits — components/ess/FlexiTdsCalculator.tsx on the phone.
//
// A 4-step wizard: plan the flexi declaration for both regimes, enter HRA and
// investments, compare Old vs New tax for FY 2026-27, and submit a regime (which
// locks). Every figure comes from ../tax.ts (the website's maths, extracted); every
// read and write from ./data.ts (the website's Supabase calls, verbatim).
import * as React from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useEmployeeId } from '@/core/session'
import { useEmployee } from '@/core/employee'
import { invalidate, queryClient } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Button, ErrorState, Loading, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { useOverlay } from '@/ui/overlays'
import {
  STEPS, addITotalOf, applyFlexi, c80TotalOf, computeTax, deriveJoin, deriveSal, gates, hraExemptOf, initialChild, initialForm,
  newLimit, oldLimit, recOf, submitConfirmText, sumFlexi, type Child, type Flexi, type Form, type Regime,
} from '../tax'
import { loadSalaryDetail } from '../salary'
import { B, Box } from '../ui'
import { initFrom, loadFlexi, persistForm, submitWrites } from './data'
import { downloadExcel, downloadPdf, type ExportCtx } from './exports'
import { Step1 } from './Step1'
import { Step2 } from './Step2'
import { Step3 } from './Step3'
import { Step4 } from './Step4'

function Stepper({ step, onGo }: { step: number; onGo: (n: number) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: S.lg }}>
      {STEPS.map((lbl, i) => {
        const n = i + 1, active = step === n, done = step > n
        return (
          <View key={lbl} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Pressable onPress={() => n <= step && onGo(n)} accessibilityRole="button" accessibilityState={{ selected: active, disabled: n > step }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1,
                borderColor: active ? C.brand : C.line, backgroundColor: active ? C.brand : done ? C.brandTint : C.surface }}>
              <View style={{ width: 18, height: 18, borderRadius: 99, backgroundColor: active ? C.surface : done ? C.brand : C.line, alignItems: 'center', justifyContent: 'center' }}>
                <Txt size={10} w={700} color={active ? C.brand : C.surface}>{done ? '' : n}</Txt>
              </View>
              <Txt size={12} w={600} color={active ? C.surface : done ? C.brandDeep : C.muted}>{lbl}</Txt>
            </Pressable>
            {i < 3 && <View style={{ width: 14, height: 2, borderRadius: 2, backgroundColor: step > n ? C.brand : C.line }} />}
          </View>
        )
      })}
    </View>
  )
}

export default function FlexiScreen() {
  const { C } = useTheme()
  const { notify, confirm } = useOverlay()
  const employeeId = useEmployeeId()
  const { emp } = useEmployee()
  const empName: string | undefined = emp?.full_name, empCode: string | undefined = emp?.emp_code

  const q = useQuery({ queryKey: ['payroll-tax', 'flexi', employeeId], queryFn: () => loadFlexi(employeeId), enabled: !!employeeId })
  // loadSalary(employeeId).then(setReal).catch(() => setReal(null))
  const sq = useQuery({ queryKey: ['payroll-tax', 'salary', employeeId], queryFn: () => loadSalaryDetail(employeeId).catch(() => null), enabled: !!employeeId })
  const rd = sq.data || null

  const [step, setStep] = React.useState(1)
  const [f, setF] = React.useState<Form>(initialForm)
  const [oFlexi, setOFlexi] = React.useState<Flexi>({})
  const [nFlexi, setNFlexi] = React.useState<Flexi>({})
  const [child, setChild] = React.useState<Child>(initialChild)
  const [chosenRegime, setChosenRegime] = React.useState<Regime | null>(null)
  const [companyId, setCompanyId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [userPicked, setUserPicked] = React.useState(false)
  const [defaultedByRule, setDefaultedByRule] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<'NEW' | 'DRAFT' | 'SUBMITTED'>('NEW')
  const [editMode, setEditMode] = React.useState<null | 'flexi' | 'all'>(null)
  const [draftMsg, setDraftMsg] = React.useState('')
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))
  const setMany = (patch: Partial<Form>) => setF(p => ({ ...p, ...patch } as Form))

  // The website's mount effect (restore a saved form or prefill, then the default regime),
  // applied whenever fresh server data arrives — adjusted during render, React's pattern.
  const [seen, setSeen] = React.useState<typeof q.data>(undefined)
  if (q.data && q.data !== seen) {
    setSeen(q.data)
    const s = initFrom(q.data)
    setCompanyId(s.companyId); setF(s.f); setOFlexi(s.oFlexi); setNFlexi(s.nFlexi); setChild(s.child)
    setChosenRegime(s.chosenRegime); setUserPicked(s.userPicked); setStatus(s.status); setDefaultedByRule(s.defaultedByRule)
    setEditMode(null)
  }

  const g = gates(status, editMode)
  const sal = React.useMemo(() => deriveSal(f.ctc, f.variable, rd), [f.ctc, f.variable, rd])
  const join = React.useMemo(() => deriveJoin(f.doj), [f.doj])
  const oLim = (k: string) => oldLimit(sal, child, k)
  const nLim = (k: string) => newLimit(sal, k)
  const oTot = sumFlexi(oFlexi), nTot = sumFlexi(nFlexi)
  const hraExempt = React.useMemo(() => hraExemptOf(f, sal), [f, sal])
  const T = React.useMemo(() => computeTax(sal, join, hraExempt, f, oFlexi, nFlexi), [sal, join, hraExempt, f, oFlexi, nFlexi])
  const recRegime = recOf(T)

  // Default selection follows the lower-tax regime until the employee explicitly picks (or it's
  // locked) — the website's effect on [recRegime, userPicked, isSubmitted], run during render.
  const recKey = `${recRegime}|${userPicked}|${g.isSubmitted}`
  const [recSeen, setRecSeen] = React.useState('')
  if (recKey !== recSeen) {
    setRecSeen(recKey)
    if (recRegime && !userPicked && !g.isSubmitted) setChosenRegime(recRegime)
  }

  const onFlexi = (rg: 'old' | 'new', k: string, v: number) => {
    if (rg === 'old') setOFlexi(p => applyFlexi(p, k, v, oLim)); else setNFlexi(p => applyFlexi(p, k, v, nLim))
  }
  const st = { f, oFlexi, nFlexi, child }
  const ctx = (): ExportCtx | null => (T ? { empName, empCode, chosenRegime, sal, T, f, oFlexi, nFlexi } : null)

  const refreshDependants = () => {
    void queryClient.invalidateQueries({ queryKey: ['payroll-tax', 'flexi', employeeId] })
    void queryClient.invalidateQueries({ queryKey: ['payroll-tax', 'claims'] })
  }

  async function saveDraft() {
    setDraftMsg(''); setSaving(true)
    const { error } = await persistForm(employeeId, companyId, chosenRegime, 'DRAFT', st)
    setSaving(false)
    if (error) { setDraftMsg('⚠ ' + error.message); return }
    setStatus('DRAFT')
    setDraftMsg('Draft saved. You can leave and return anytime')
    setTimeout(() => setDraftMsg(''), 3500)
    refreshDependants()
  }

  async function pdf() {
    const c = ctx(); if (!c) return
    try { await downloadPdf(c) } catch (e: any) { notify(e?.message || 'Could not create the PDF.', 'error') }
  }
  async function excel() {
    const c = ctx(); if (!c) return
    try { await downloadExcel(c) } catch (e: any) { notify(e?.message || 'Could not create the Excel file.', 'error') }
  }

  async function submitRegime() {
    if (!chosenRegime || !T) return
    const ok = await confirm({ title: 'Confirm', message: submitConfirmText(chosenRegime, f), confirm: 'Yes', cancel: 'No' })
    if (!ok) return
    setSaving(true)
    const err = await submitWrites(employeeId, companyId, chosenRegime, T, st)
    setSaving(false)
    if (err) { notify('Could not save your regime: ' + err.message, 'error'); return }
    setStatus('SUBMITTED'); setEditMode(null)
    const c = ctx()
    await invalidate('employee')
    refreshDependants()
    void queryClient.invalidateQueries({ queryKey: ['payroll-tax', 'proofs'] })
    // Auto-download the full declaration (PDF) after submit — best-effort, as on the website.
    if (c) { try { await downloadPdf(c) } catch { /* download best-effort */ } }
  }

  // Own scroller (not Screen's) so a step change can start at the top, as the website's page does.
  const scroller = React.useRef<ScrollView>(null)
  React.useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }) }, [step])
  const [refreshing, setRefreshing] = React.useState(false)
  const refresh = async () => { setRefreshing(true); try { await Promise.all([q.refetch(), sq.refetch()]) } finally { setRefreshing(false) } }
  const isErr = draftMsg.startsWith('⚠')

  let footer: React.ReactNode = null
  if (step === 1 && sal.ctc > 0) footer = <Button full title="Next: Flexi Declaration →" onPress={() => setStep(2)} />
  if (step === 2) footer = <View style={{ flexDirection: 'row', gap: S.sm }}><Button variant="outline" title="Back" onPress={() => setStep(1)} style={{ flex: 1 }} /><Button title="Next: Investments →" onPress={() => setStep(3)} style={{ flex: 2 }} /></View>
  if (step === 3) footer = <View style={{ flexDirection: 'row', gap: S.sm }}><Button variant="outline" title="Back" onPress={() => setStep(2)} style={{ flex: 1 }} /><Button title="Calculate TDS →" onPress={() => setStep(4)} style={{ flex: 2 }} /></View>

  return (
    <Screen title="Flexi Benefits" subtitle="Payroll" footer={q.data ? footer : null} scroll={false} padded={false}>
      <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.lg, paddingBottom: S.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.brand} colors={[C.brand]} />}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap', marginBottom: S.md }}>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Txt size={17} w={700}>Flexi &amp; TDS Calculator</Txt>
              <Txt size={12} tone="muted">Plan your flexi benefit declaration and compare Old vs New tax regime · FY 2026-27</Txt>
            </View>
            {!g.isSubmitted && <Button variant="outline" size="sm" title="Save Draft" disabled={saving} onPress={saveDraft} />}
          </View>
          {!!draftMsg && (
            <Box bg={isErr ? C.criticalTint : C.positiveTint} edge={isErr ? C.critical : C.positive} style={{ marginBottom: 10 }}>
              <Txt size={12} w={600} color={isErr ? C.critical : C.positive}>{draftMsg}</Txt>
            </Box>
          )}
          {!!defaultedByRule && !g.isSubmitted && (
            <Box bg={C.warningTint} edge={C.warning} style={{ marginBottom: S.md }}>
              <Txt size={12} color={C.warning}><B>New Regime applied by default</B>: no regime was chosen by the 4th of the month{/^\d{4}-/.test(defaultedByRule) ? ` (set on ${new Date(defaultedByRule).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''}. Payroll is taxing you on the New Regime. You can still submit your own choice here; submitting replaces the default.</Txt>
            </Box>
          )}
          {g.viewLocked && (
            <Box bg={C.brandTint} edge={C.brandEdge} style={{ marginBottom: S.md }}>
              <Txt size={12} color={C.brandDeep}>This declaration is submitted &amp; locked. Go to <B>Step 4</B> and press <B>Edit</B> to change {chosenRegime === 'OLD' ? 'flexi or investments' : 'your flexi'}.</Txt>
            </Box>
          )}
          <Stepper step={step} onGo={setStep} />
          {step === 1 && <Step1 f={f} empName={empName} empCode={empCode} rd={rd} sal={sal} join={join} />}
          {step === 2 && <Step2 rw={g.flexiRW} budget={sal.other} oFlexi={oFlexi} nFlexi={nFlexi} child={child} setChild={setChild} oLim={oLim} nLim={nLim} onFlexi={onFlexi} oTot={oTot} nTot={nTot} />}
          {step === 3 && <Step3 f={f} set={set} setMany={setMany} rw={g.investRW} sal={sal} hraExempt={hraExempt} c80Total={c80TotalOf(f, sal)} addITotal={addITotalOf(f)} />}
          {step === 4 && (
            <Step4 T={T} sal={sal} chosenRegime={chosenRegime} recRegime={recRegime} userPicked={userPicked}
              isSubmitted={g.isSubmitted} editMode={editMode} status={status} saving={saving} draftMsg={draftMsg}
              onPick={rg => { if (!g.regimeLocked) { setChosenRegime(rg); setUserPicked(true) } }}
              onSubmit={submitRegime} onDraft={saveDraft}
              onEdit={() => setEditMode(chosenRegime === 'OLD' ? 'all' : 'flexi')}
              onCancelEdit={() => { setEditMode(null); setStatus('SUBMITTED') }}
              onPdf={pdf} onExcel={excel} onBack={() => setStep(3)} />
          )}
        </View>
      )}
      </ScrollView>
    </Screen>
  )
}
