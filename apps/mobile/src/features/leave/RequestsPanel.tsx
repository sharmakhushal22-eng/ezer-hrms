// src/features/leave/RequestsPanel.tsx — "Your requests": status, who it waits
// on, remarks, cancellation state, Withdraw (PENDING) and Request cancellation
// (APPROVED, not started). Source: components/ess/LeaveSection.tsx.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/ui/ThemeProvider'
import type { Palette } from '@/ui/theme'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Input, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { IconChevronDown } from '@/ui/icons'
import { useEmployeeId } from '@/core/session'
import { afterLeaveWrite, requestLeaveCancel, withdrawLeave } from './data'
import { PanelHead } from './ApplyPanel'
import { dayMon, PEEK, plural, resolvedOn, statusKey, type Application, type StatusKey } from './logic'

function statusColours(C: Palette, s: StatusKey) {
  switch (s) {
    case 'PENDING': return { rail: C.warning, fg: C.warning, bg: C.warningTint, tint: C.warningTint }
    case 'APPROVED': return { rail: C.positive, fg: C.positive, bg: C.positiveTint, tint: C.positiveTint }
    case 'REJECTED': return { rail: C.critical, fg: C.critical, bg: C.criticalTint, tint: C.criticalTint }
    case 'CANCELLED': return { rail: C.lineStrong, fg: C.muted, bg: C.sunken, tint: C.sunken }
    default: return { rail: C.lineStrong, fg: C.muted, bg: C.surface, tint: 'transparent' }
  }
}

function Sub({ children }: { children: React.ReactNode }) {
  return <Txt size={F.tiny} tone="muted" style={{ marginTop: 3 }}>{children}</Txt>
}
function Remark({ name, text }: { name?: string | null; text: string }) {
  const { C } = useTheme()
  return (
    <View style={{ marginTop: 8, paddingVertical: 8, paddingHorizontal: 10, borderLeftWidth: 2, borderLeftColor: C.lineStrong, backgroundColor: C.sunken, borderRadius: R.sm }}>
      {!!name && <Txt size={F.tiny} w={600} tone="soft">{name}</Txt>}
      <Txt size={F.tiny} tone="muted">{text}</Txt>
    </View>
  )
}

export function MoreButton({ open, label, onPress }: { open: boolean; label: string; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: open }}
      style={({ pressed }) => ({
        marginTop: S.md, minHeight: 44, borderRadius: R.md, borderWidth: 1, flexDirection: 'row', gap: 6,
        alignItems: 'center', justifyContent: 'center',
        borderColor: pressed ? C.brandEdge : C.line, backgroundColor: pressed ? C.brandTint : 'transparent',
      })}>
      <Txt size={F.tiny} w={600} color={C.brandDeep}>{open ? 'Show fewer' : label}</Txt>
      <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><IconChevronDown size={12} color={C.brandDeep} /></View>
    </Pressable>
  )
}

interface RowProps {
  a: Application; today: string; busy: boolean; last: boolean
  confirmId: string; setConfirmId: (id: string) => void
  cancelId: string; setCancelId: (id: string) => void
  cancelReason: string; setCancelReason: (s: string) => void
  onWithdraw: (id: string) => void; onRequestCancel: (id: string) => void
}

function RequestRow({ a, today, busy, last, confirmId, setConfirmId, cancelId, setCancelId, cancelReason, setCancelReason, onWithdraw, onRequestCancel }: RowProps) {
  const { C } = useTheme()
  const status = String(a.status || '').toUpperCase()
  const sc = statusColours(C, statusKey(status))
  const days = Number(a.days)
  return (
    <View style={{ flexDirection: 'row', gap: 11, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line }}>
      {/* The status reads as colour across the row, fading before the text. */}
      <LinearGradient colors={[sc.tint, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0 }}
        pointerEvents="none" style={{ position: 'absolute', top: 3, bottom: 3, left: -8, right: -8, borderRadius: 12 }} />
      <View style={{ width: 3, borderRadius: 2, backgroundColor: sc.rail }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!!a.leave_types?.short_name && (
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.brandTint }}>
              <Txt size={10} w={700} color={C.brandDeep}>{a.leave_types.short_name}</Txt>
            </View>
          )}
          <Txt size={F.small} w={600} style={{ flexShrink: 1 }}>
            {a.to_date && a.to_date !== a.from_date ? `${dayMon(a.from_date)} – ${dayMon(a.to_date)}` : dayMon(a.from_date)}
          </Txt>
          <View style={{ marginLeft: 'auto', paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, borderWidth: 1, borderColor: sc.fg, backgroundColor: sc.bg }}>
            <Txt size={10} w={700} color={sc.fg}>{status}</Txt>
          </View>
        </View>
        <Sub>
          {days} day{plural(days)}
          {a.half_day ? ` · half day${a.half_session ? ` (${a.half_session})` : ''}` : ''}
          {a.leave_types?.name ? ` · ${a.leave_types.name}` : ''}
          {status === 'PENDING' && a.approval_stage ? ` · stage ${a.approval_stage}` : ''}
        </Sub>

        {status === 'PENDING' && (
          <Sub>
            {a.waiting_on
              ? <>Waiting on <Txt size={F.tiny} w={700} tone="soft">{a.waiting_on.name}</Txt> · {a.waiting_on.role}</>
              : 'No approver is set for you — HR has been shown this request.'}
          </Sub>
        )}
        {(status === 'APPROVED' || status === 'REJECTED') && !!a.approver && (
          <Sub>
            {status === 'APPROVED' ? 'Approved' : 'Declined'} by <Txt size={F.tiny} w={700} tone="soft">{a.approver}</Txt>
            {a.resolved_at ? ` on ${resolvedOn(a.resolved_at)}` : ''}
          </Sub>
        )}
        {!!a.remark && <Remark name={a.approver} text={a.remark} />}
        {a.cancel_status === 'REQUESTED' && (
          <Sub>Cancellation requested — waiting on <Txt size={F.tiny} w={700} tone="soft">{a.cancel_waiting_on?.name || 'HR'}</Txt></Sub>
        )}
        {a.cancel_status === 'DECLINED' && (
          <Remark name={`Cancellation declined${a.cancel_decided_by ? ` by ${a.cancel_decided_by}` : ''}`} text={a.cancel_remark || 'The leave stands.'} />
        )}
        {status === 'CANCELLED' && a.cancel_status === 'APPROVED' && (
          <Sub>Cancelled{a.cancel_decided_by ? ` — approved by ${a.cancel_decided_by}` : ''}; the days are back in your balance.</Sub>
        )}

        {status === 'APPROVED' && a.cancel_status !== 'REQUESTED' && a.from_date > today && (
          <View style={{ marginTop: 8 }}>
            {cancelId === a.id ? (
              <>
                <Input value={cancelReason} onChangeText={setCancelReason} placeholder="Why cancel? (your approver reads this)" style={{ marginBottom: S.sm }} />
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button size="sm" variant="danger" title="Send to approver" disabled={busy} onPress={() => onRequestCancel(a.id)} />
                  <Button size="sm" variant="outline" title="Keep it" onPress={() => { setCancelId(''); setCancelReason('') }} />
                </View>
              </>
            ) : (
              <Button size="sm" variant="outline" title="Request cancellation" disabled={busy} onPress={() => setCancelId(a.id)} style={{ alignSelf: 'flex-start' }} />
            )}
          </View>
        )}

        {status === 'PENDING' && (
          <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {confirmId === a.id ? (
              <>
                <Txt size={F.micro} w={600} tone="critical">Withdraw this request?</Txt>
                <Button size="sm" variant="danger" title="Yes, withdraw" disabled={busy} onPress={() => onWithdraw(a.id)} />
                <Button size="sm" variant="outline" title="Keep it" onPress={() => setConfirmId('')} />
              </>
            ) : (
              <Button size="sm" variant="outline" title="Withdraw" disabled={busy} onPress={() => setConfirmId(a.id)} />
            )}
          </View>
        )}
      </View>
    </View>
  )
}

export function RequestsPanel({ applications, today, busy, setBusy }: {
  applications: Application[]; today: string; busy: boolean; setBusy: (b: boolean) => void
}) {
  const { notify } = useOverlay()
  const employeeId = useEmployeeId()
  const [all, setAll] = React.useState(false)
  const [confirmId, setConfirmId] = React.useState('')
  const [cancelId, setCancelId] = React.useState('')
  const [cancelReason, setCancelReason] = React.useState('')

  const onRequestCancel = async (id: string) => {
    setBusy(true)
    try {
      const res = await requestLeaveCancel(employeeId, id, cancelReason)
      notify(res.message || 'Cancellation requested')
      setCancelId(''); setCancelReason('')
      afterLeaveWrite()
    } catch (e: any) {
      notify(e?.message || 'Could not request cancellation', 'error')
    } finally {
      setBusy(false)
    }
  }
  const onWithdraw = async (id: string) => {
    setBusy(true)
    try {
      await withdrawLeave(employeeId, id)
      notify('Leave request withdrawn')
      setConfirmId('')
      afterLeaveWrite()
    } catch (e: any) {
      notify(e?.message || 'Could not cancel', 'error')
    } finally {
      setBusy(false)
    }
  }

  const shown = all ? applications : applications.slice(0, PEEK)
  return (
    <Card style={{ marginBottom: S.md }}>
      <PanelHead title="Your requests" meta={applications.length ? `Last ${applications.length}` : undefined} />
      {!applications.length ? (
        <View style={{ paddingVertical: S.lg }}>
          <Txt size={F.small} tone="muted" center>
            <Txt size={F.small} w={600} tone="soft">No requests yet.</Txt>{'\n'}Anything you apply for will show here with its status.
          </Txt>
        </View>
      ) : (
        <>
          {shown.map((a, i) => (
            <RequestRow key={a.id} a={a} today={today} busy={busy} last={i === shown.length - 1}
              confirmId={confirmId} setConfirmId={setConfirmId}
              cancelId={cancelId} setCancelId={setCancelId}
              cancelReason={cancelReason} setCancelReason={setCancelReason}
              onWithdraw={onWithdraw} onRequestCancel={onRequestCancel} />
          ))}
          {applications.length > PEEK && (
            <MoreButton open={all} label={`Show all ${applications.length} requests`} onPress={() => setAll(v => !v)} />
          )}
        </>
      )}
    </Card>
  )
}
