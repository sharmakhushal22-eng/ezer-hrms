// Corporate NPS — the website's NpsSection (components/ess/EmployeePortal.tsx ~2496).
//
// GET/POST/PATCH /api/ess/nps with employee_id, the same bodies as the website.
// The rate (10% of Basic on the old regime, 14% on the new), the 12-digit PRAN
// rule and the effective date all come from the server; this screen only shows
// them and validates the PRAN length the same way the website does.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Checkbox, ErrorState, Input, Loading, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet, useOverlay } from '@/ui/overlays'
import { Screen } from '@/ui/Screen'
import { QK, call, errMsg, inr, isNetwork, longDate, numDate } from './shared'
import { Box, Bullets, Callout, Choice, Heading, SmallAction } from './ui'

/** EmployeePortal.tsx hardcodes these two borders on the current-NPS card. */
const PENDING_EDGE = '#B5D4F4'
const ACTIVE_EDGE = '#C5E8DB'
const TIERS = [{ value: 'Tier I', label: 'Tier I' }, { value: 'Tier II', label: 'Tier II' }]

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Txt size={F.micro} tone="muted">{label}</Txt>
      <Txt size={F.lead} w={500} color={color}>{value}</Txt>
    </View>
  )
}

export default function NpsScreen() {
  const employeeId = useEmployeeId()
  const { C } = useTheme()
  const { notify } = useOverlay()
  const q = useQuery({
    queryKey: [QK, 'nps', employeeId],
    queryFn: async () => (await call('/api/ess/nps', { employeeId })).body,
    enabled: !!employeeId,
  })
  const [hasPran, setHasPran] = React.useState(true)
  const [pran, setPran] = React.useState('')
  const [pranName, setPranName] = React.useState('')
  const [tier, setTier] = React.useState('Tier I')
  const [tierOpen, setTierOpen] = React.useState(false)
  const [ack, setAck] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [submitPran, setSubmitPran] = React.useState('')

  // The website prefills the PRAN name from the employee on every load.
  const [seedAfter, setSeedAfter] = React.useState(-1)
  if (q.data && q.dataUpdatedAt > seedAfter) {
    setSeedAfter(Infinity)
    if (q.data.employee) setPranName(q.data.employee.name)
  }
  const reload = () => { setSeedAfter(q.dataUpdatedAt); return q.refetch() }

  const frame = (body: React.ReactNode) => <Screen title="Corporate NPS" subtitle="Payroll" onRefresh={reload}>{body}</Screen>
  if (q.isLoading) return frame(<Loading label="Loading…" />)
  if (q.error && isNetwork(q.error)) return frame(<ErrorState error={q.error} onRetry={() => q.refetch()} />)
  const e = q.data?.employee
  if (!e) return frame(<Txt size={F.small} tone="critical" style={{ padding: S.sm }}>Salary data not found.</Txt>)

  const current = q.data?.current_nps
  const len: number = e.pran_length
  const effFmt = longDate(e.effective_date)
  const pranClean = pran.replace(/\D/g, '')
  const pranValid = pranClean.length === len
  const canSubmit = ack && (!hasPran || pranValid)

  const submit = async () => {
    setSaving(true)
    try {
      const r = await call('/api/ess/nps', { method: 'POST', body: { employee_id: employeeId, has_existing_pran: hasPran, pran_number: hasPran ? pranClean : null, pran_holder_name: pranName, tier_type: tier, acknowledged: true } })
      if (r.ok) { notify(r.body.pending_pran ? 'PRAN form emailed. Submit within 3 days' : 'NPS enrolment submitted ✓'); setAck(false); void invalidate('today', 'notifications'); await reload() }
      else notify('Failed: ' + (r.body.error || ''), 'error')
    } catch (err) { notify('Failed: ' + errMsg(err), 'error') }
    finally { setSaving(false) }
  }
  const doSubmitPran = async () => {
    try {
      const r = await call('/api/ess/nps', { method: 'PATCH', body: { employee_id: employeeId, action: 'SUBMIT_PRAN', pran_number: submitPran } })
      if (r.ok) { notify('PRAN submitted. NPS active ✓'); setSubmitPran(''); void invalidate('today'); await reload() }
      else notify('Failed: ' + (r.body.error || ''), 'error')
    } catch (err) { notify('Failed: ' + errMsg(err), 'error') }
  }
  const stop = async () => {
    try {
      const r = await call('/api/ess/nps', { method: 'PATCH', body: { employee_id: employeeId, action: 'STOP', stopped_reason: 'Employee requested' } })
      if (r.ok) { notify('NPS stopped'); void invalidate('today'); await reload() } else notify('Failed to stop', 'error')
    } catch { notify('Failed to stop', 'error') }
  }

  const hint = pran.length === 0 ? `Enter your ${len}-digit PRAN` : pranValid ? `Valid ${len}-digit PRAN` : `${len - pranClean.length} more digit(s) needed`
  const hintColor = pran.length === 0 ? C.muted : pranValid ? C.positive : C.warning

  return frame(
    <>
      <Heading title="Corporate NPS enrolment" sub="Employer contributes to your NPS (Tier I). Extra tax benefit under Section 80CCD(2)." />

      {!e.has_ctc && (
        <Box bg={C.warningTint} edge={C.warningEdge}>
          <Txt size={F.tiny} color={C.warning}>Your CTC (Basic) isn&apos;t configured yet, so NPS shows ₹0. Ask HR to set your CTC (ctc_master).</Txt>
        </Box>
      )}

      {current && (current.status === 'PENDING_PRAN' ? (
        <Box bg={C.brandTint} edge={PENDING_EDGE}>
          <Txt size={F.tiny} color={C.brand} style={{ marginBottom: 8 }}>PRAN pending: generate &amp; submit by {current.pran_deadline ? numDate(current.pran_deadline) : '-'}.</Txt>
          <Input value={submitPran} onChangeText={t => setSubmitPran(t.replace(/\D/g, ''))} maxLength={len} keyboardType="number-pad"
            placeholder={`Enter ${len}-digit PRAN`} inputStyle={{ letterSpacing: 2 }} style={{ marginBottom: S.sm }} />
          <Button title="Submit PRAN" size="sm" full onPress={doSubmitPran} disabled={submitPran.replace(/\D/g, '').length !== len} />
        </Box>
      ) : (
        <Box bg={C.sunken} edge={ACTIVE_EDGE} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
          <Txt size={F.tiny} color={C.positive} style={{ flex: 1 }}>Active NPS: {current.contribution_percent}% of Basic ({inr(current.monthly_nps_amount)}/mo)</Txt>
          <SmallAction title="Stop NPS" color={C.critical} onPress={stop} />
        </Box>
      ))}

      <Box bg={C.brandTint}>
        <Txt size={F.tiny} tone="muted" style={{ marginBottom: 8 }}>Your contribution (from salary structure)</Txt>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Figure label="Monthly Basic" value={inr(e.basic_monthly)} />
          <Figure label="Tax regime" value={e.tax_regime === 'OLD' ? 'Old' : 'New'} />
          <Figure label="NPS rate" value={`${e.contribution_percent}%`} color={C.brandDeep} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, marginTop: 10, paddingTop: 8 }}>
          <Txt size={F.tiny} tone="muted">Monthly NPS contribution</Txt>
          <Txt size={F.body} w={500} color={C.brandDeep}>{inr(e.monthly_nps_amount)}/mo</Txt>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 }}>
          <Txt size={F.tiny} tone="muted">Effective from</Txt>
          <Txt size={F.small}>{effFmt}</Txt>
        </View>
        <Txt size={F.micro} tone="muted" style={{ marginTop: 6 }}>Old regime = 10% of Basic · New regime = 14% of Basic</Txt>
      </Box>

      <Box>
      <View style={{ marginBottom: 12 }}>
        <Txt size={F.body} w={700} style={{ marginBottom: 8 }}>Do you already have an NPS account (PRAN)?</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Choice selected={hasPran} label="Yes, I have a PRAN" onPress={() => setHasPran(true)} />
          <Choice selected={!hasPran} label="No, I need one" onPress={() => setHasPran(false)} />
        </View>
      </View>

      {hasPran ? (
        <>
          <Input label={`PRAN number (${len} digits)`} value={pran} maxLength={len} keyboardType="number-pad"
            onChangeText={t => setPran(t.replace(/\D/g, ''))} placeholder="e.g. 110012345678" inputStyle={{ letterSpacing: 2 }} style={{ marginBottom: 4 }} />
          <Txt size={F.micro} color={hintColor} style={{ marginBottom: 12 }}>{hint}</Txt>
          <Input label="Name as per PRAN" value={pranName} onChangeText={setPranName} />
          <PickerField label="Account tier" value={tier} onPress={() => setTierOpen(true)} />
          <SelectSheet visible={tierOpen} onClose={() => setTierOpen(false)} title="Account tier" options={TIERS} value={tier} onPick={setTier} />
        </>
      ) : (
        <Box bg={C.brandTint} edge={C.brandEdge} style={{ marginBottom: 0 }}>
          <Txt size={F.tiny} color={C.brand} style={{ lineHeight: 20 }}>
            <Txt size={F.tiny} w={700} color={C.brand}>A new PRAN will be created for you.</Txt>{'\n'}
            On submit, we&apos;ll email you the PRAN creation form. Generate your PRAN <Txt size={F.tiny} w={700} color={C.brand}>within 3 days</Txt>, then resubmit here. For help, contact the <Txt size={F.tiny} w={700} color={C.brand}>Payroll team</Txt>.
          </Txt>
        </Box>
      )}
      </Box>

      <Callout bg={C.warningTint}>
        <Txt size={F.tiny} w={700} color={C.warning}>Please read carefully</Txt>
        <Bullets color={C.ink} lines={[
          'NPS is a long-term retirement product, locked in until age 60 (limited early withdrawal)',
          'Employer contribution is over & above your ₹1.5L 80C limit (Section 80CCD(2))',
          'Recurring monthly contribution, reflects in your salary structure',
          'Rate follows your tax regime (10% old / 14% new of Basic)',
        ]} />
      </Callout>

      <Box>
      <Checkbox checked={ack} onChange={setAck}
        label={<Txt size={F.tiny} tone="soft" style={{ flex: 1, lineHeight: 19 }}>I confirm I want to enrol in the corporate NPS. I understand the contribution will be a percentage of my Basic as per my tax regime, effective from the 1st of next month, and that NPS is a long-term retirement product with lock-in until age 60.</Txt>} />
      <View style={{ height: 14 }} />
      <Button full disabled={!canSubmit || saving} onPress={submit}
        title={saving ? 'Submitting…' : hasPran ? 'Acknowledge & submit' : 'Submit & email me the PRAN form'} />
      </Box>
    </>,
  )
}
