// Loans — the website's LoansSection (components/ess/EmployeePortal.tsx ~2756):
// apply for a loan, track pending requests, sign the agreement of an approved
// one, and request foreclosure or a part-payment on a loan being recovered.
//
// GET/POST/PATCH /api/ess/loans with employee_id, the same bodies as the website.
// Range and eligibility are shown as hints but enforced by the server, exactly
// as on the website.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import type { Palette } from '@/ui/theme'
import { F, S } from '@/ui/theme'
import { Button, ErrorState, Input, Loading, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet, Sheet, useOverlay } from '@/ui/overlays'
import { Screen } from '@/ui/Screen'
import { QK, call, dmy, errMsg, inr, isNetwork } from './shared'
import { Box, Heading, Pill, SmallAction } from './ui'
import { LoanAgreementPanel } from './LoanAgreementPanel'

/** EmployeePortal.tsx loanEmi — reducing-balance EMI. (Always uses interest_rate, as the website does.) */
export function loanEmi(P: number, ratePct: number, n: number): number {
  if (!P || !n) return 0
  if (!ratePct) return Math.round(P / n)
  const r = ratePct / 12 / 100
  const f = Math.pow(1 + r, n)
  return Math.round(P * r * f / (f - 1))
}

/** EmployeePortal.tsx LoanStatusBadge colours. */
function loanStatusColours(C: Palette, s: string): [string, string] {
  const map: Record<string, [string, string]> = {
    SUBMITTED: [C.warningTint, C.warning], IN_APPROVAL: [C.warningTint, C.warning], REQUESTED: [C.warningTint, C.warning], GENERATED: [C.warningTint, C.warning],
    UNDER_REVIEW: [C.brandTint, C.brand], PENDING_PRAN: [C.brandTint, C.brand],
    APPROVED: [C.sunken, C.positive], RECOVERING: [C.sunken, C.positive], DISBURSED: [C.sunken, C.positive], SIGNED: [C.sunken, C.positive],
    REJECTED: [C.criticalTint, C.critical], CANCELLED: [C.criticalTint, C.critical], EXIT_RECOVERY: [C.criticalTint, C.critical],
    CLOSED: [C.sunken, C.muted], FORECLOSED: [C.sunken, C.muted],
  }
  return map[s] || [C.brandTint, C.brandDeep]
}
function LoanStatusBadge({ status }: { status: string }) {
  const { C } = useTheme()
  const s = (status || '').toUpperCase()
  const [bg, fg] = loanStatusColours(C, s)
  return <Pill bg={bg} fg={fg} text={s.replace(/_/g, ' ')} />
}

/** window.prompt('Part-payment amount (₹):', outstanding) — prefilled, numeric. */
function PartPaymentSheet({ loan, onCancel, onOk }: { loan: any | null; onCancel: () => void; onOk: (raw: string) => void }) {
  const [raw, setRaw] = React.useState('')
  const [forLoan, setForLoan] = React.useState<any | null>(null)
  if (loan !== forLoan) { setForLoan(loan); if (loan) setRaw(String(Math.round(loan.outstanding_principal || 0))) }
  return (
    <Sheet visible={!!loan} onClose={onCancel} title="Part-payment"
      footer={<View style={{ flexDirection: 'row', gap: S.sm }}>
        <Button title="Cancel" variant="outline" style={{ flex: 1 }} onPress={onCancel} />
        <Button title="OK" style={{ flex: 1 }} onPress={() => onOk(raw)} />
      </View>}>
      <Input label="Part-payment amount (₹):" value={raw} onChangeText={setRaw} keyboardType="numeric" autoFocus selectTextOnFocus />
    </Sheet>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Txt size={F.body} w={600} style={{ marginBottom: 10 }}>{title}</Txt>
      {children}
    </Box>
  )
}

export default function LoansScreen() {
  const employeeId = useEmployeeId()
  const { C } = useTheme()
  const { notify, confirm } = useOverlay()
  const q = useQuery({
    queryKey: [QK, 'loans', employeeId],
    queryFn: async () => (await call('/api/ess/loans', { employeeId })).body,
    enabled: !!employeeId,
  })
  const [typeChoice, setTypeId] = React.useState('')
  const [typeOpen, setTypeOpen] = React.useState(false)
  const [amount, setAmount] = React.useState('')
  const [tenure, setTenure] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [signingReq, setSigningReq] = React.useState<string | null>(null)
  const [partLoan, setPartLoan] = React.useState<any | null>(null)

  // The website seeds the type with the first loan type on the first load.
  const typeId: string = typeChoice || q.data?.loan_types?.[0]?.id || ''

  const frame = (body: React.ReactNode) => <Screen title="Loans" subtitle="Payroll" onRefresh={() => q.refetch()}>{body}</Screen>
  if (q.isLoading) return frame(<Loading label="Loading…" />)
  if (q.error && isNetwork(q.error)) return frame(<ErrorState error={q.error} onRetry={() => q.refetch()} />)

  const data = q.data || {}
  const loanTypes: any[] = data.loan_types || []
  const myLoans: any[] = data.my_loans || []
  const pending: any[] = data.pending_requests || []
  const hasCtc = data.has_ctc
  const sel = loanTypes.find((t: any) => t.id === typeId)
  const amtNum = parseFloat(amount) || 0
  const tenNum = parseInt(tenure) || 0
  const rate = sel ? Number(sel.interest_rate) || 0 : 0
  const indicativeEmi = loanEmi(amtNum, rate, tenNum)
  const reload = () => { void invalidate('today', 'notifications'); return q.refetch() }

  const submit = async () => {
    if (!sel) { notify('Select a loan type', 'error'); return }
    if (amtNum <= 0) { notify('Enter an amount', 'error'); return }
    if (tenNum <= 0) { notify('Enter tenure in months', 'error'); return }
    setSaving(true)
    try {
      const r = await call('/api/ess/loans', { method: 'POST', body: { employee_id: employeeId, loan_type_id: typeId, requested_amount: amtNum, requested_tenure_months: tenNum, reason } })
      if (r.ok && r.body.success) { notify('Loan request submitted ✓'); setAmount(''); setTenure(''); setReason(''); await reload() }
      else notify(r.body.error || 'Failed to submit', 'error')
    } catch (err) { notify(errMsg(err), 'error') }
    finally { setSaving(false) }
  }

  const sendManage = async (loan: any, request_type: 'CLOSURE' | 'PART_PAYMENT', amt?: number) => {
    try {
      const r = await call('/api/ess/loans', { method: 'PATCH', body: { loan_id: loan.id, employee_id: employeeId, request_type, amount: amt } })
      if (r.ok && r.body.success) { notify(request_type === 'CLOSURE' ? 'Foreclosure request submitted' : 'Part-payment request submitted'); await reload() }
      else notify(r.body.error || 'Failed', 'error')
    } catch (err) { notify(errMsg(err), 'error') }
  }
  const foreclose = async (loan: any) => {
    const ok = await confirm({ title: `Foreclose ${loan.loan_number}?`, message: `Outstanding ${inr(loan.outstanding_principal)} will be recovered.`, confirm: 'OK', destructive: true })
    if (ok) await sendManage(loan, 'CLOSURE')
  }
  const partOk = (raw: string) => {
    const loan = partLoan
    setPartLoan(null)
    const amt = parseFloat(raw) || 0
    if (amt <= 0) { notify('Enter a valid amount', 'error'); return }
    void sendManage(loan, 'PART_PAYMENT', amt)
  }

  return frame(
    <>
      <Heading title="Loans" sub="Apply for a company loan, track approvals, sign your agreement, and manage repayments." />

      {!hasCtc && (
        <Box bg={C.warningTint} edge={C.warningEdge}>
          <Txt size={F.tiny} color={C.warning}>CTC not configured: eligibility shows ₹0; ask HR to set CTC.</Txt>
        </Box>
      )}

      <SectionCard title="Apply for a loan">
        {loanTypes.length === 0 ? <Txt size={F.tiny} tone="muted">No loan types configured for your company.</Txt> : (
          <>
            <PickerField label="Loan type" value={sel?.name || ''} onPress={() => setTypeOpen(true)} style={{ marginBottom: 6 }} />
            {sel && <Txt size={F.micro} color={C.brandDeep} style={{ marginBottom: 12 }}>Max eligible {inr(sel.max_eligible)} · {Number(sel.interest_rate) || 0}% {sel.interest_type ? `(${sel.interest_type})` : ''} · tenure {sel.min_tenure_months}–{sel.max_tenure_months} months</Txt>}
            <SelectSheet visible={typeOpen} onClose={() => setTypeOpen(false)} title="Loan type" value={typeId} onPick={setTypeId}
              options={loanTypes.map((t: any) => ({ value: String(t.id), label: String(t.name) }))} />

            <Input label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="e.g. 100000"
              error={sel && amtNum > Number(sel.max_eligible) ? `Max eligible is ${inr(sel.max_eligible)}` : null} />
            <Input label="Tenure (months)" value={tenure} onChangeText={setTenure} keyboardType="number-pad"
              placeholder={sel ? `${sel.min_tenure_months}–${sel.max_tenure_months}` : 'months'}
              error={sel && tenNum > 0 && (tenNum < sel.min_tenure_months || tenNum > sel.max_tenure_months) ? `Tenure must be ${sel.min_tenure_months}–${sel.max_tenure_months} months` : null} />
            <Input label="Reason" value={reason} onChangeText={setReason} placeholder="Purpose of the loan…" multiline inputStyle={{ minHeight: 70 }} />

            <Box bg={C.brandTint} style={{ marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
              <Txt size={F.tiny} tone="muted" style={{ flex: 1 }}>Indicative EMI (reducing balance)</Txt>
              <Txt size={F.title} w={600} color={C.brandDeep}>{inr(indicativeEmi)}<Txt size={F.micro} tone="muted">/mo</Txt></Txt>
            </Box>
            <Button full title={saving ? 'Submitting…' : 'Submit loan request'} disabled={saving} onPress={submit} />
          </>
        )}
      </SectionCard>

      {signingReq && (
        <LoanAgreementPanel requestId={signingReq} employeeId={employeeId}
          onClose={() => setSigningReq(null)} onDone={() => { setSigningReq(null); void reload() }} />
      )}

      <SectionCard title="Pending requests">
        {pending.length === 0 ? <Txt size={F.tiny} tone="muted">No pending requests.</Txt> : pending.map((p: any, i: number) => {
          const t = loanTypes.find((x: any) => x.id === p.loan_type_id)
          const approved = (p.status || '').toUpperCase() === 'APPROVED'
          return (
            <View key={p.id} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={F.small} w={600}>{t?.name || 'Loan'} · {inr(p.requested_amount)}</Txt>
                  <Txt size={F.micro} tone="muted" style={{ marginTop: 2 }}>EMI {inr(p.indicative_emi)} · {p.requested_tenure_months} mo · approval level {p.current_approval_level ?? '-'}</Txt>
                </View>
                <LoanStatusBadge status={p.status} />
              </View>
              {approved && <View style={{ alignSelf: 'flex-start' }}><SmallAction title="Sign agreement" color={C.brand} filled onPress={() => setSigningReq(p.id)} /></View>}
            </View>
          )
        })}
      </SectionCard>

      <SectionCard title="My loans">
        {myLoans.length === 0 ? <Txt size={F.tiny} tone="muted">No active loans.</Txt> : myLoans.map((l: any, i: number) => {
          const isRecovering = (l.status || '').toUpperCase() === 'RECOVERING'
          const paid = l.paid_installments ?? 0, remaining = l.remaining_installments ?? 0
          return (
            <View key={l.id} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Txt size={F.small} w={600}>{l.loan_number}</Txt>
                <LoanStatusBadge status={l.status} />
              </View>
              <Txt size={F.tiny} tone="muted" style={{ marginTop: 4, lineHeight: 20 }}>
                Principal {inr(l.principal)} · EMI {inr(l.emi_amount)}/mo · Outstanding <Txt size={F.tiny} w={700}>{inr(l.outstanding_principal)}</Txt>{'\n'}
                Paid {paid} / {paid + remaining} installments · {remaining} remaining{l.disbursement_date ? ` · disbursed ${dmy(l.disbursement_date)}` : ''}
              </Txt>
              {isRecovering && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <SmallAction title="Foreclose" color={C.critical} onPress={() => void foreclose(l)} />
                  <SmallAction title="Part-payment" color={C.brandDeep} onPress={() => setPartLoan(l)} />
                </View>
              )}
            </View>
          )
        })}
      </SectionCard>

      <PartPaymentSheet loan={partLoan} onCancel={() => setPartLoan(null)} onOk={partOk} />
    </>,
  )
}
