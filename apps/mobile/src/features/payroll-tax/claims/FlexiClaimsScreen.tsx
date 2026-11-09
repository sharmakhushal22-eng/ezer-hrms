// Payroll › Flexi Claims — components/ess/FlexiClaims.tsx on the phone.
//
// Monthly bill submission against flexi entitlements, a per-component balance + history,
// and limit-increase requests. Bills go in from the 1st to the 20th of every month (the
// website's lib/flexi/window, shared); outside it, or with nothing left to claim, the
// uploader stays on screen but locked, as on the website. The website's
// local toast becomes notify(); its right-hand history drawer becomes a sheet.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import { useEmployeeId } from '@/core/session'
import { queryClient } from '@/core/query'
import type { PickedFile } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { S } from '@/ui/theme'
import { Button, Card, ErrorState, Input, Loading, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { Sheet, useOverlay } from '@/ui/overlays'
import { B, Box, Pill } from '../ui'
import { FY, NO_INVOICE, loadFlexiClaims, requestLimit, submitClaim, uploadBillFile, type ComponentLimit, type HistItem } from './data'
import { BillFrame, HistorySheet, blankFrame, inr, type Frame } from './BillFrame'
import { closingDay, nextOpening, windowDaysLeft, windowOpenAt } from '@web/flexi/window'

/** "2026-11-20" → "20 Nov 2026", as the website words the window's days. */
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

function EntitlementCard({ lim, histCount, onHistory, onRequest }: { lim: ComponentLimit; histCount: number; onHistory: () => void; onRequest: () => void }) {
  const { C } = useTheme()
  const noInv = NO_INVOICE.includes(lim.code)
  const remaining = lim.annual_limit - lim.approved - lim.pending
  const usedPct = lim.annual_limit > 0 ? Math.min(100, Math.round((lim.approved / lim.annual_limit) * 100)) : 0
  const exhausted = remaining <= 0
  return (
    <Card style={{ marginBottom: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginBottom: 10 }}>
        <Txt size={15} w={700}>{lim.name}</Txt>
        {lim.overridden && <Pill label="Custom limit" bg={C.brandTint} fg={C.brandDeep} />}
        {noInv && <Pill label="No invoice needed" bg={C.positiveTint} fg={C.positive} />}
        {exhausted && !noInv && <Pill label="Limit exhausted" bg={C.criticalTint} fg={C.critical} />}
        <View style={{ flex: 1 }} />
        <Button size="sm" variant="outline" title={`History${histCount ? ` (${histCount})` : ''}`} onPress={onHistory} />
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.sm }}>
        {([['Annual limit', inr(lim.annual_limit), C.brand], ['Approved', inr(lim.approved), C.positive], ['Pending', inr(lim.pending), C.warning]] as const).map(([l, v, c]) => (
          <View key={l} style={{ flex: 1, backgroundColor: C.sunken, borderRadius: 7, padding: S.sm, alignItems: 'center' }}>
            <Txt size={10} tone="muted" style={{ marginBottom: 2 }}>{l}</Txt>
            <Txt size={14} w={700} color={c}>{v}</Txt>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Txt size={10} tone="muted">Approved: {usedPct}%</Txt><Txt size={10} tone="muted">Remaining: {inr(remaining)}</Txt>
      </View>
      <View style={{ height: 5, backgroundColor: C.line, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${usedPct}%`, backgroundColor: usedPct >= 100 ? C.critical : usedPct >= 80 ? C.warning : C.brand, borderRadius: 3 }} />
      </View>
      {lim.rejected > 0 && <Txt size={10} color={C.warning} style={{ marginTop: 4 }}>⚠ {inr(lim.rejected)} rejected (not deducted from limit)</Txt>}
      {noInv && <Box bg={C.sunken} style={{ marginTop: 10 }}><Txt size={11} tone="muted">Auto-claimed monthly. No bill submission required. Payroll processes this automatically.</Txt></Box>}
      {exhausted && !noInv && (
        <Box bg={C.warningTint} edge={C.warning} style={{ marginTop: 10, gap: S.sm }}>
          <Txt size={12} color={C.warning}>Annual limit reached. You can request an increase from Payroll.</Txt>
          <Pressable onPress={onRequest} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: C.warning, borderRadius: 7 }}>
            <Txt size={11} w={600} color={C.onAccent}>Request increase</Txt>
          </Pressable>
        </Box>
      )}
      {!exhausted && !noInv && <Button size="sm" variant="outline" title="Request limit increase" onPress={onRequest} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}
    </Card>
  )
}

export default function FlexiClaimsScreen() {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const employeeId = useEmployeeId()
  const q = useQuery({ queryKey: ['payroll-tax', 'claims', employeeId], queryFn: () => loadFlexiClaims(employeeId), enabled: !!employeeId })
  const [frames, setFrames] = React.useState<Frame[]>(() => [blankFrame()])
  const [submitting, setSubmitting] = React.useState(false)
  const [reqComp, setReqComp] = React.useState<string | null>(null)
  const [reqAmt, setReqAmt] = React.useState(''); const [reqReason, setReqReason] = React.useState('')
  const [reqErr, setReqErr] = React.useState('')
  const [histComp, setHistComp] = React.useState<string | null>(null)
  const showToast = (m: string) => notify(m, 'info')

  const d = q.data
  const limits = d?.limits || []
  const claimHist: HistItem[] = d?.hist || []
  const companyId = d?.companyId || null

  const remainingOf = (code: string) => {
    const l = limits.find(x => x.code === code)
    return l ? l.annual_limit - l.approved - l.pending : -1
  }
  const billTypeOptions = limits
    .filter(l => !NO_INVOICE.includes(l.code) && (l.annual_limit - l.approved - l.pending) > 0)
    .map(l => ({ code: l.code, name: l.name, remaining: l.annual_limit - l.approved - l.pending }))

  const setFrame = (id: string, patch: Partial<Frame>) => setFrames(p => p.map(f => f.id === id ? { ...f, ...patch } : f))
  const addFrameFiles = (id: string, files: PickedFile[]) => setFrames(p => p.map(f => f.id === id ? { ...f, files: [...f.files, ...files] } : f))
  const removeFrameFile = (id: string, i: number) => setFrames(p => p.map(f => f.id === id ? { ...f, files: f.files.filter((_, j) => j !== i) } : f))
  const addFrame = () => setFrames(p => [...p, blankFrame()])
  const removeFrame = (id: string) => setFrames(p => p.length > 1 ? p.filter(f => f.id !== id) : p)

  const now = new Date(d?.now ?? 0)
  const windowOpen = !!d && windowOpenAt(now)
  const hasBalance = billTypeOptions.length > 0
  const canSubmit = windowOpen && hasBalance
  const reload = () => queryClient.invalidateQueries({ queryKey: ['payroll-tax', 'claims', employeeId] })

  async function submitAll() {
    // Asked again at the moment of submitting: the screen may have been open since the 20th.
    if (!windowOpenAt(new Date())) return showToast(`Bills can be submitted from the 1st to the 20th. The window opens on ${dayLabel(nextOpening(new Date()))}`)
    if (!hasBalance) return showToast('Your balance is ₹0 on every component, so no more bills can be submitted')
    const active = frames.filter(f => f.code || f.amount || f.files.length)
    if (!active.length) return showToast('Add at least one bill')
    for (const f of active) {
      if (!f.code) return showToast(`Bill ${frames.indexOf(f) + 1}: choose a bill type`)
      if (!f.amount || Number(f.amount) <= 0) return showToast(`Bill ${frames.indexOf(f) + 1}: enter an amount`)
      const rem = remainingOf(f.code)
      if (rem >= 0 && Number(f.amount) > rem) return showToast(`Bill ${frames.indexOf(f) + 1}: amount exceeds the remaining limit (${inr(rem)})`)
      if (f.files.length === 0) return showToast(`Bill ${frames.indexOf(f) + 1}: attach at least one file`)
    }
    setSubmitting(true)
    let ok = 0
    const fails: string[] = []
    for (const f of active) {
      const res = await submitClaim({
        employee_id: employeeId, company_id: companyId,
        component_code: f.code, claim_amount: Number(f.amount), bill_date: f.billDate || null,
        bill_no: f.billNo || null, agency_name: f.vendor || null, vendor_desc: f.vendor || null,
      })
      if (res.error || !res.claim_id) { fails.push(`${f.code}: ${res.error || 'failed'}`); continue }
      for (const file of f.files) await uploadBillFile(employeeId, res.claim_id, file)
      ok++
    }
    setSubmitting(false)
    setFrames([blankFrame()])
    void reload()
    if (fails.length) showToast(`${ok} submitted · ${fails.length} failed (${fails[0]})`)
    else showToast(`${ok} bill${ok > 1 ? 's' : ''} submitted · pending HR approval`)
  }

  async function sendLimitRequest() {
    setReqErr('')
    // A toast would sit behind the open sheet, so the sheet repeats the message inline.
    if (!reqComp || !reqAmt || !reqReason.trim()) { setReqErr('All fields are required'); return showToast('All fields are required') }
    const lim = limits.find(l => l.code === reqComp)
    const res = await requestLimit({ employee_id: employeeId, company_id: companyId, fy: FY, component_code: reqComp, current_limit: lim?.annual_limit || 0, requested_limit: Number(reqAmt), reason: reqReason })
    if (res.error) { setReqErr('⚠ ' + res.error); return showToast('⚠ ' + res.error) }
    setReqComp(null); setReqAmt(''); setReqReason(''); showToast('Limit-increase request sent to Payroll')
  }

  const totals = limits.reduce((a, l) => ({ limit: a.limit + l.annual_limit, approved: a.approved + l.approved, pending: a.pending + l.pending, balance: a.balance + (l.annual_limit - l.approved) }), { limit: 0, approved: 0, pending: 0, balance: 0 })
  const activeCount = frames.filter(f => f.code && f.amount && f.files.length).length

  const body = () => {
    if (q.isLoading) return <Loading label="Loading flexi claims…" />
    if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
    return (
      <View>
        <Txt size={17} w={700}>Flexi Reimbursement</Txt>
        <Txt size={12} tone="muted" style={{ marginBottom: S.md }}>Submit monthly bills for your declared flexi components · {d!.regime === 'old' ? 'Old' : 'New'} regime{d!.slabLabel ? ` · Slab ${d!.slabLabel}` : ''}</Txt>

        {/* The window (1st–20th) and whether anything is left to claim */}
        <Box bg={canSubmit ? C.positiveTint : windowOpen ? C.warningTint : C.criticalTint} edge={canSubmit ? C.positive : windowOpen ? C.warningEdge : C.critical} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: S.md }}>
          <Txt size={16}>{canSubmit ? '🟢' : windowOpen ? '🟡' : '🔴'}</Txt>
          <Txt size={12} color={canSubmit ? C.positive : windowOpen ? C.warning : C.critical} style={{ flex: 1 }}>
            {!windowOpen
              ? <>Window closed · bills can be submitted from the 1st to the 20th of every month. It opens again on <B>{dayLabel(nextOpening(now))}</B>.</>
              : hasBalance
                ? <>Window open · submit bills by <B>{dayLabel(closingDay(now))}</B> · {windowDaysLeft(now)} day{windowDaysLeft(now) === 1 ? '' : 's'} left</>
                : limits.length
                  ? <>Window open till <B>{dayLabel(closingDay(now))}</B>, but your balance is ₹0 on every component that takes a bill, so no more bills can be submitted. Ask Payroll for a limit increase on a component below if you need more.</>
                  : <>Window open till <B>{dayLabel(closingDay(now))}</B>, but you have no claimable flexi components yet: file your Flexi &amp; TDS declaration, or ask HR to set up the flexi policy for your band.</>}
          </Txt>
        </Box>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: S.lg }}>
          {([['Annual limit', inr(totals.limit), C.brand], ['Approved', inr(totals.approved), C.positive], ['Pending', inr(totals.pending), C.warning], ['Balance', inr(totals.balance), C.ink]] as const).map(([l, v, c]) => (
            <View key={l} style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: C.sunken, borderRadius: 10, padding: 10, alignItems: 'center' }}>
              <Txt size={18} w={700} color={c}>{v}</Txt>
              <Txt size={10} tone="muted" upper style={{ marginTop: 2 }}>{l}</Txt>
            </View>
          ))}
        </View>

        {(
          <View style={{ borderRadius: 16, marginBottom: S.lg, overflow: 'hidden', borderWidth: 1, borderColor: C.line }}>
            <LinearGradient colors={[C.brand, C.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingVertical: 14, paddingHorizontal: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
                <Txt size={15} w={800} color={C.onAccent} style={{ flexShrink: 1 }}>Upload your bills</Txt>
                {!canSubmit && <Pill label={!windowOpen ? 'Opens on the 1st' : 'Balance ₹0'} bg={C.criticalTint} fg={C.critical} />}
              </View>
              <Txt size={11.5} color={C.onAccent} style={{ opacity: 0.9, marginTop: 1 }}>Pick a bill type, enter the amount, attach photos or files. Add as many bills as you like.</Txt>
            </LinearGradient>
            {/* Locked: every field, picker and button inside stops taking touches, as the website's
                disabled fieldset does. */}
            <View pointerEvents={canSubmit ? 'auto' : 'none'} accessibilityState={{ disabled: !canSubmit }}
              style={{ padding: S.md, backgroundColor: C.canvas, gap: S.md, opacity: canSubmit ? 1 : 0.55 }}>
              {frames.map((f, i) => (
                <BillFrame key={f.id} frame={f} index={i} options={billTypeOptions}
                  remaining={f.code ? remainingOf(f.code) : -1} canRemove={frames.length > 1}
                  onChange={patch => setFrame(f.id, patch)} onFiles={files => addFrameFiles(f.id, files)}
                  onRemoveFile={idx => removeFrameFile(f.id, idx)} onRemove={() => removeFrame(f.id)} />
              ))}
              <Pressable onPress={addFrame} accessibilityRole="button"
                style={({ pressed }) => ({ borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.brand, borderRadius: 12, padding: S.md, minHeight: 48, backgroundColor: pressed ? C.brandEdge : C.brandTint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm })}>
                <Txt size={17} color={C.brandDeep}>＋</Txt><Txt size={13} w={700} color={C.brandDeep}>Add another bill</Txt>
              </Pressable>
              <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.md, gap: S.sm }}>
                <Txt size={11.5} tone="muted">
                  {activeCount > 0 ? <><B color={C.ink}>{activeCount}</B> bill{activeCount > 1 ? 's' : ''} ready to submit</> : 'Fill a bill type, amount and file to submit'}
                </Txt>
                <Button full disabled={submitting || activeCount === 0} loading={submitting} onPress={submitAll}
                  title={submitting ? 'Submitting…' : `Submit ${activeCount || ''} bill${activeCount === 1 ? '' : 's'}`.replace('  ', ' ')} />
              </View>
            </View>
          </View>
        )}

        <Txt size={12} w={700} tone="muted" upper style={{ marginTop: 4, marginBottom: S.sm }}>Your entitlements</Txt>
        {!limits.length && <Card style={{ marginBottom: S.md }}><Txt size={13} tone="muted">No claimable flexi components are configured for your company &amp; salary band yet.</Txt></Card>}
        {limits.map(lim => (
          <EntitlementCard key={lim.code} lim={lim} histCount={claimHist.filter(c => c.component_code === lim.code).length}
            onHistory={() => setHistComp(lim.code)} onRequest={() => { setReqErr(''); setReqComp(lim.code) }} />
        ))}

      </View>
    )
  }

  return (
    <Screen title="Flexi Claims" subtitle="Payroll" onRefresh={() => q.refetch()}>
      {body()}
      <HistorySheet visible={!!histComp} onClose={() => setHistComp(null)}
        label={limits.find(l => l.code === histComp)?.name || histComp || ''}
        items={claimHist.filter(c => c.component_code === histComp)} />
      {/* The website's amber limit-request panel, as a sheet so it opens where the button is tapped. */}
      <Sheet visible={!!reqComp} onClose={() => setReqComp(null)} title={`Request limit increase: ${limits.find(l => l.code === reqComp)?.name || reqComp || ''}`}>
        <Input label="Requested annual limit (₹)" value={reqAmt} onChangeText={setReqAmt} keyboardType="numeric" />
        <Input label="Reason (mandatory)" value={reqReason} onChangeText={setReqReason} placeholder="Official travel increased…" />
        {!!reqErr && <Txt size={12} color={C.critical} style={{ marginBottom: S.sm }}>{reqErr}</Txt>}
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <Pressable onPress={sendLimitRequest} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, minHeight: 46, borderRadius: 10, backgroundColor: C.warning, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
            <Txt size={13} w={600} color={C.onAccent}>Send request</Txt>
          </Pressable>
          <Button variant="outline" title="Cancel" onPress={() => setReqComp(null)} style={{ flex: 1 }} />
        </View>
      </Sheet>
    </Screen>
  )
}
