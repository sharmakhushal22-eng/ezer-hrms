// src/features/attendance/RegularisationList.tsx — (G) "My Regularisation Requests".
// EmployeePortal.tsx RegularisationList: one card per submission (+ status),
// first three, then "Show all"; Withdraw on pending ones.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/ui/ThemeProvider'
import { R } from '@/ui/theme'
import { Button, Card, Txt } from '@/ui/primitives'
import { IconChevronDown } from '@/ui/icons'
import { fmt, fmtDT, fmtT, hm, shortDay, type RegularisationRequest } from './model'
import { Section } from './bits'

const LABEL: Record<string, string> = { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'DECLINED', CANCELLED: 'WITHDRAWN' }

function RequestCard({ rs, busyId, onWithdraw }: { rs: RegularisationRequest[]; busyId: string; onWithdraw: (id: string) => void }) {
  const { C } = useTheme()
  const STY: Record<string, [string, string]> = {
    PENDING: [C.warningTint, C.warning], APPROVED: [C.positiveTint, C.positive], REJECTED: [C.criticalTint, C.critical], CANCELLED: [C.sunken, C.faint],
  }
  const r = rs[0]
  const [bg, c] = STY[r.status] || [C.brandTint, C.brandDeep]
  const sameTimes = new Set(rs.map(x => `${hm(x.requested_in)}-${hm(x.requested_out)}`)).size === 1
  const withdrawId = r.request_group || r.id
  return (
    <View style={{ marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: C.line, borderLeftWidth: 3, borderLeftColor: c, overflow: 'hidden' }}>
      <LinearGradient colors={[bg, C.surface]} locations={[0, 0.65]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Txt size={13} w={600} style={{ flex: 1 }}>
            {rs.length === 1 ? fmt(r.attendance_date) : `${rs.length} days · ${shortDay(rs[0].attendance_date)} – ${shortDay(rs[rs.length - 1].attendance_date)}`}
          </Txt>
          <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: c }}>
            <Txt size={10.5} w={700} color={c}>{LABEL[r.status] || r.status}</Txt>
          </View>
        </View>
        {rs.length > 1 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
            {rs.map(x => (
              <View key={x.id} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
                <Txt size={10.5} tone="soft">{shortDay(x.attendance_date)}{sameTimes ? '' : ` · ${hm(x.requested_in)}–${hm(x.requested_out)}`}</Txt>
              </View>
            ))}
          </View>
        )}
        {rs.length === 1 && (
          <Txt size={11} tone="muted" style={{ marginTop: 3 }}>Recorded: IN {r.recorded_in ? fmtT(r.recorded_in) : '—'} · OUT {r.recorded_out ? fmtT(r.recorded_out) : '—'}</Txt>
        )}
        {sameTimes && <Txt size={11} tone="soft" style={{ marginTop: 3 }}>Requested: {hm(r.requested_in)} → {hm(r.requested_out)}</Txt>}
        {!!r.reason && <Txt size={12} tone="soft" style={{ marginTop: 3 }}>{r.reason}</Txt>}
        {r.status === 'PENDING' && (
          <Txt size={11.5} tone="soft" style={{ marginTop: 3 }}>
            {r.waiting_on ? <>Waiting on <Txt size={11.5} w={700} tone="soft">{r.waiting_on.name}</Txt> · {r.waiting_on.role}</> : 'No approver is set for you — HR has been shown this request.'}
          </Txt>
        )}
        {(r.status === 'APPROVED' || r.status === 'REJECTED') && (
          <Txt size={11.5} tone={r.status === 'APPROVED' ? 'positive' : 'critical'} style={{ marginTop: 3 }}>
            {r.status === 'APPROVED' ? 'Approved — your attendance shows the corrected times' : 'Declined'}{r.decided_by ? ` by ${r.decided_by}` : ''}{r.reviewed_at ? ` on ${fmt(r.reviewed_at)}` : ''}{r.review_remark ? `: “${r.review_remark}”` : ''}
          </Txt>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <Txt size={10} tone="faint" style={{ flex: 1 }}>Submitted {fmtDT(r.created_at)}</Txt>
          {r.status === 'PENDING' && (
            <Button size="sm" variant="outline" disabled={busyId === withdrawId} onPress={() => onWithdraw(withdrawId)}
              title={busyId === withdrawId ? 'Withdrawing…' : rs.length > 1 ? `Withdraw all ${rs.length}` : 'Withdraw'} />
          )}
        </View>
      </LinearGradient>
    </View>
  )
}

export function RegularisationList({ requests, onWithdraw, busyId }: { requests: RegularisationRequest[]; onWithdraw: (id: string) => void; busyId: string }) {
  const { C } = useTheme()
  const groups = React.useMemo(() => {
    const m = new Map<string, RegularisationRequest[]>()
    for (const r of requests) {
      const k = `${r.request_group || r.id}:${r.status}`
      m.set(k, [...(m.get(k) || []), r])
    }
    return [...m.values()].map(rs => rs.sort((a, b) => a.attendance_date.localeCompare(b.attendance_date)))
      .sort((a, b) => String(b[0].created_at).localeCompare(String(a[0].created_at)))
  }, [requests])
  const [all, setAll] = React.useState(false)
  const shown = all ? groups : groups.slice(0, 3)

  return (
    <Card style={{ marginBottom: 10 }}>
      <Section>My Regularisation Requests</Section>
      {groups.length === 0 && <Txt size={12} tone="faint">No regularisation requests yet.</Txt>}
      {shown.map(rs => <RequestCard key={`${rs[0].request_group || rs[0].id}:${rs[0].status}`} rs={rs} busyId={busyId} onWithdraw={onWithdraw} />)}
      {groups.length > 3 && (
        <Pressable onPress={() => setAll(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: all }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: 4,
                                     borderWidth: 1, borderStyle: 'dashed', borderColor: C.lineStrong, borderRadius: R.md, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
          <Txt size={12} w={600} tone="brand">{all ? 'Show fewer' : `Show all ${groups.length} requests`}</Txt>
          <View style={{ transform: [{ rotate: all ? '180deg' : '0deg' }] }}><IconChevronDown size={12} color={C.brand} /></View>
        </Pressable>
      )}
    </Card>
  )
}
