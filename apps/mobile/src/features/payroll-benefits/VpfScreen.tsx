// Voluntary PF — the website's VpfSection (components/ess/EmployeePortal.tsx ~2365).
//
// Same API, same bodies: GET/POST/PATCH /api/ess/vpf with employee_id. The
// figures (88% cap, 50% "that high?" alert, 80C bar against ₹1.5L) are computed
// exactly as the website computes them from the server's EPF wage base.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Checkbox, ErrorState, Input, Loading, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { Screen } from '@/ui/Screen'
import { QK, call, errMsg, inr, isNetwork } from './shared'
import { Box, Bullets, Callout, Heading, Line, Pill, SmallAction, Tile } from './ui'

const MAX_PCT = 88, HIGH_ALERT = 50

export default function VpfScreen() {
  const employeeId = useEmployeeId()
  const { C } = useTheme()
  const { notify } = useOverlay()
  const q = useQuery({
    queryKey: [QK, 'vpf', employeeId],
    queryFn: async () => (await call('/api/ess/vpf', { employeeId })).body,
    enabled: !!employeeId,
  })
  const [pctInput, setPctInput] = React.useState('10')
  const [ack, setAck] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // The website re-seeds the percentage from the active VPF on every load (mount,
  // after submit, after stop) — not on a background refetch mid-edit. Seed when
  // data newer than `seedAfter` arrives (state adjusted during render).
  const [seedAfter, setSeedAfter] = React.useState(-1)
  if (q.data && q.dataUpdatedAt > seedAfter) {
    setSeedAfter(Infinity)
    if (q.data.current_vpf) setPctInput(String(q.data.current_vpf.vpf_percent))
  }
  const reload = () => { setSeedAfter(q.dataUpdatedAt); return q.refetch() }

  const frame = (body: React.ReactNode) => <Screen title="Voluntary PF" subtitle="Payroll" onRefresh={reload}>{body}</Screen>
  if (q.isLoading) return frame(<Loading label="Loading…" />)
  if (q.error && isNetwork(q.error)) return frame(<ErrorState error={q.error} onRetry={() => q.refetch()} />)
  const e = q.data?.employee
  if (!e) return frame(<Txt size={F.small} tone="critical" style={{ padding: S.sm }}>Salary data not found.</Txt>)

  const base = Number(e.epf_wage_base) || 0
  const current = q.data?.current_vpf
  let rawPct = parseFloat(pctInput) || 0
  let capHit = false
  if (rawPct > MAX_PCT) { capHit = true; rawPct = MAX_PCT }
  const vpfMonthly = Math.round(base * rawPct / 100)
  const vpfAnnual = vpfMonthly * 12
  const total80c = e.epf_annual + vpfAnnual
  const over80c = total80c > e.c80_limit
  const barPct = Math.min(100, Math.round(total80c / e.c80_limit * 100))
  const showHighAlert = rawPct > HIGH_ALERT && !capHit

  const submit = async () => {
    setSaving(true)
    try {
      const r = await call('/api/ess/vpf', { method: 'POST', body: { employee_id: employeeId, vpf_percent: rawPct, effective_from_month: 4, acknowledged: true } })
      if (r.ok) { notify('VPF request submitted ✓'); setAck(false); void invalidate('today'); await reload() }
      else notify('Failed: ' + (r.body.error || ''), 'error')
    } catch (err) { notify('Failed: ' + errMsg(err), 'error') }
    finally { setSaving(false) }
  }
  const stop = async () => {
    try {
      const r = await call('/api/ess/vpf', { method: 'PATCH', body: { employee_id: employeeId, stopped_reason: 'Employee requested', stopped_from_month: 4 } })
      if (r.ok) { notify('VPF stopped'); void invalidate('today'); await reload() } else notify('Failed to stop', 'error')
    } catch { notify('Failed to stop', 'error') }
  }

  return frame(
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.sm }}>
        <View style={{ flex: 1 }}><Heading title="Voluntary PF (VPF)" sub="Extra PF deducted from your EPF wages. Set your own percentage." /></View>
        {current && <Pill bg={C.positiveTint} fg={C.positive} text={`Active · ${current.vpf_percent}%`} />}
      </View>

      {!e.has_ctc && (
        <Callout bg={C.warningTint}>
          <Txt size={F.tiny} color={C.warning}>Your CTC is not configured yet, so the EPF wage base shows ₹0. Ask HR to set your CTC (ctc_master). Then VPF will calculate correctly.</Txt>
        </Callout>
      )}

      {current && (
        <Callout bg={C.positiveTint} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm }}>
          <Txt size={F.tiny} tone="ink" style={{ flex: 1 }}>Active VPF: <Txt size={F.tiny} w={700}>{current.vpf_percent}%</Txt> ({inr(current.monthly_vpf_amount)}/mo). Modify below</Txt>
          <SmallAction title="Stop VPF" color={C.critical} onPress={stop} />
        </Callout>
      )}

      <Box bg={C.brandTint} edge={C.brandEdge}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: S.sm }}>
          <View style={{ flexShrink: 1 }}>
            <Txt size={F.tiny} tone="muted">Your EPF wages (from database)</Txt>
            <Txt size={24} w={700} color={C.brandDeep} style={{ marginTop: 2 }}>{inr(base)} <Txt size={F.tiny} tone="muted">a month</Txt></Txt>
          </View>
          <Pill bg={e.is_capped ? C.surface : C.positiveTint} fg={e.is_capped ? C.brandDeep : C.positive} text={e.is_capped ? 'Capped ₹15,000' : 'Actual (Gross − HRA)'} />
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: 4 }}>
          <Tile name="Current mandatory EPF (12%)" value={inr(e.mandatory_epf_monthly)} unit=" /mo" />
          <Tile name={`VPF at ${Math.round(rawPct)}%`} value={inr(vpfMonthly)} unit=" /mo" />
        </View>
      </Box>

      <Box>
        <Txt size={F.body} w={700} style={{ marginBottom: S.sm }}>VPF percentage</Txt>
        <Input value={pctInput} onChangeText={setPctInput} keyboardType="numeric" placeholder="e.g. 25" accessibilityLabel="VPF percentage"
          help="Percentage of your EPF wages." inputStyle={{ fontSize: 16, fontWeight: '600' }}
          right={<Txt size={15} w={700} color={C.brand} style={{ paddingRight: S.md }}>%</Txt>} />
        {showHighAlert && (
          <Callout bg={C.criticalTint} style={{ marginTop: S.sm, marginBottom: 0, paddingVertical: 10, paddingHorizontal: 12 }}>
            <Txt size={F.tiny} color={C.critical} style={{ lineHeight: 19 }}><Txt size={F.tiny} w={700} color={C.critical}>That high?</Txt> {Math.round(rawPct)}% ({inr(vpfMonthly)}/mo) VPF will cut your net in-hand a lot. Please confirm.</Txt>
          </Callout>
        )}
        {capHit && (
          <Callout bg={C.warningTint} style={{ marginTop: S.sm, marginBottom: 0, paddingVertical: 10, paddingHorizontal: 12 }}>
            <Txt size={F.tiny} color={C.warning} style={{ lineHeight: 19 }}>Max {MAX_PCT}% allowed (12% mandatory + {MAX_PCT}% = 100%). Set to {MAX_PCT}%.</Txt>
          </Callout>
        )}
      </Box>

      <Box>
        <Txt size={F.body} w={700} style={{ marginBottom: 4 }}>Effect on your pay</Txt>
        <Line label="VPF deduction (monthly)" value={inr(vpfMonthly)} valueWeight={700} valueColor={C.brandDeep} />
        <Line top label="VPF (annual)" value={inr(vpfAnnual)} />
        <Line top label="Net in-hand impact" labelColor={C.critical} value={`−${inr(vpfMonthly)}/mo`} valueWeight={700} valueColor={C.critical} />
      </Box>

      <Box>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, gap: S.sm }}>
          <Txt size={F.body} w={700} style={{ flexShrink: 1 }}>80C usage (₹1.5L max)</Txt>
          <Txt size={F.tiny} tone="muted">{inr(Math.min(total80c, e.c80_limit))} / ₹1.5L</Txt>
        </View>
        <View style={{ height: 8, backgroundColor: C.line, borderRadius: 20, overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${barPct}%`, backgroundColor: over80c ? C.warning : C.brand, borderRadius: 20 }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm, marginTop: 6 }}>
          <Txt size={F.micro} tone="muted" style={{ flex: 1 }}>EPF ({inr(e.epf_annual)}) + VPF ({inr(vpfAnnual)}) = {inr(total80c)}{over80c ? ` (no 80C benefit on ${inr(total80c - e.c80_limit)})` : ''}</Txt>
          <Txt size={F.micro} tone="muted">{barPct}%</Txt>
        </View>
      </Box>

      <Callout bg={C.warningTint}>
        <Txt size={F.tiny} w={700} color={C.warning}>Choose carefully</Txt>
        <Bullets color={C.ink} lines={[
          <>VPF will <Txt size={F.tiny} w={700}>reduce your net in-hand salary</Txt></>,
          <>The 80C exemption only goes <Txt size={F.tiny} w={700}>up to ₹1.5 lakh</Txt> (EPF + VPF + your other 80C)</>,
          'It is deducted every month until you stop it',
        ]} />
      </Callout>

      <Box>
        <Checkbox checked={ack} onChange={setAck}
          label={<Txt size={F.tiny} tone="soft" style={{ flex: 1, lineHeight: 19 }}>I understand this will reduce my net in-hand salary and that the 80C exemption is capped at ₹1.5L. I request this VPF deduction.</Txt>} />
        <View style={{ height: 12 }} />
        <Button title={saving ? 'Saving…' : 'Acknowledge & submit'} full disabled={!ack || saving} onPress={submit} />
      </Box>
    </>,
  )
}
