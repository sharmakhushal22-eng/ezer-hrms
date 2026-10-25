// src/features/attendance/DayPanel.tsx — (D) the panel under the calendar:
// the month donut when no day is picked (EmployeePortal.tsx DayPanelResting),
// the day's detail when one is (DayDetailPanel).
import * as React from 'react'
import { View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useTheme } from '@/ui/ThemeProvider'
import { R } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { useDayPunches } from './api'
import { CORRECTABLE, fmtLongDay, fmtT, mixHex, type DayInfo, type MonthSummary, type RegularisationRequest } from './model'
import { StatusBadge, TintBox, useVocab, WarnButton } from './bits'

export function DayPanelResting({ summary }: { summary: MonthSummary }) {
  const { C } = useTheme()
  const V = useVocab()
  const rows: [string, number, string][] = [
    ['Present', Math.max(0, summary.present - summary.missPunch), V.bar('PRESENT')],
    // a lighter red than Absent: color-mix(in srgb, critical 50%, surface)
    ['Missed punch', summary.missPunch, mixHex(V.bar('MISS_OUT'), C.surface, 0.5)],
    ['Half day', summary.halfDay, V.bar('HALF_DAY')],
    ['Absent', summary.absent + summary.lopDays, V.bar('ABSENT')],
    ['On leave', summary.onLeave, V.bar('ON_LEAVE')],
  ]
  const total = rows.reduce((a, r) => a + r[1], 0)
  const D = 168, RAD = 66, SW = 18, CIRC = 2 * Math.PI * RAD
  let at = 0
  return (
    <Card style={{ marginBottom: 10 }}>
      <Txt size={11} w={700} tone="muted" upper>This month so far</Txt>
      <View style={{ alignItems: 'center', gap: 18, paddingTop: 14, paddingBottom: 10 }}>
        <View style={{ width: D, height: D }} accessibilityLabel={rows.map(([k, v]) => `${k} ${v}`).join(', ')}>
          <Svg width={D} height={D} viewBox={`0 0 ${D} ${D}`}>
            <Circle cx={D / 2} cy={D / 2} r={RAD} fill="none" stroke={C.sunken} strokeWidth={SW} />
            {total > 0 && rows.map(([k, v, c]) => {
              if (!v) return null
              const len = (v / total) * CIRC
              const seg = (
                <Circle key={k} cx={D / 2} cy={D / 2} r={RAD} fill="none" strokeWidth={SW} stroke={c}
                  strokeDasharray={`${Math.max(0, len - 2.5)} ${CIRC}`} strokeDashoffset={-at}
                  transform={`rotate(-90 ${D / 2} ${D / 2})`} />
              )
              at += len
              return seg
            })}
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={28} w={800} style={{ lineHeight: 30, letterSpacing: -0.5 }}>{summary.pct === null ? '–' : `${summary.pct}%`}</Txt>
            <Txt size={11} tone="muted" style={{ marginTop: 4 }}>attendance</Txt>
          </View>
        </View>
        <View style={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 6 }}>
          {rows.map(([k, v, c]) => (
            <View key={k} style={{ width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, backgroundColor: C.sunken }}>
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: c, opacity: v ? 1 : 0.35 }} />
              <Txt size={12} tone="soft" style={{ flex: 1 }} numberOfLines={1}>{k}</Txt>
              <Txt size={13} w={700} color={v === 0 ? C.faint : C.ink}>{v}</Txt>
            </View>
          ))}
        </View>
      </View>
      <View style={{ paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line }}>
        <Txt size={12} tone="muted" style={{ lineHeight: 18 }}><Txt size={12} w={600}>Pick a day</Txt> on the calendar to see its punches, hours and status.</Txt>
      </View>
    </Card>
  )
}

function Punches({ date }: { date: string }) {
  const { C } = useTheme()
  const q = useDayPunches(date)
  const punches = q.data || []
  // Web: loadDayPunches() never fails visibly (an error reads as no punches).
  if (q.isPending) return <Txt size={12} tone="faint">Loading punches…</Txt>
  if (!punches.length) return <Txt size={12} tone="faint">No raw punches recorded.</Txt>
  return (
    <View>
      {punches.map((p, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.brandEdge }}>
          <Txt size={12} w={600} style={{ minWidth: 52 }}>{fmtT(p.punch_time)}</Txt>
          <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: p.punch_type === 'IN' ? C.positiveTint : C.criticalTint }}>
            <Txt size={10} w={600} color={p.punch_type === 'IN' ? C.positive : C.critical}>{p.punch_type}</Txt>
          </View>
          <Txt size={12} tone="muted" style={{ flexShrink: 1 }} numberOfLines={1}>{p.source || '-'}</Txt>
          {!!p.geofence_status && <Txt size={10} tone="faint" style={{ marginLeft: 'auto' }}>{p.geofence_status}</Txt>}
        </View>
      ))}
    </View>
  )
}

export function DayDetailPanel({ date, dayInfo, onRaise, todayStr, correction: fromRegs }: {
  date: string; dayInfo: DayInfo; onRaise: (d: string) => void; todayStr: string
  /** A correction already filed for this day, if any. */
  correction?: RegularisationRequest | null
}) {
  const { C } = useTheme()
  const { status, rec, holiday, leave, day } = dayInfo
  const correction: Pick<RegularisationRequest, 'status' | 'requested_in' | 'requested_out' | 'waiting_on' | 'decided_by' | 'review_remark'> | null =
    fromRegs ?? (day?.correction ? {
      status: day.correction.status, requested_in: day.correction.requested_in || '', requested_out: day.correction.requested_out || '',
      waiting_on: day.correction.waiting_on, decided_by: day.correction.decided_by, review_remark: day.correction.review_remark,
    } : null)
  const worked = rec?.total_minutes != null ? `${Math.floor(rec.total_minutes / 60)}h ${rec.total_minutes % 60}m` : '—'
  const canRaise = date < todayStr && CORRECTABLE.includes(status) && !rec?.regularized_at
    && correction?.status !== 'PENDING' && correction?.status !== 'APPROVED'

  return (
    <Card style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <Txt size={14} w={700}>{fmtLongDay(date)}</Txt>
        <StatusBadge status={status} />
      </View>

      {holiday && <TintBox fg={C.brand} bg={C.brandTint} size={13}>🎌 {holiday.description}{holiday.is_optional ? ' (Optional)' : ''}</TintBox>}
      {status === 'WEEKLY_OFF' && <TintBox fg={C.faint} bg={C.sunken} size={13}>Weekly Off</TintBox>}
      {leave && (
        <TintBox fg={C.brandDeep} bg={C.brandTint} size={13}>
          On Leave — {leave.name}{leave.half_day ? ` (Half day${leave.half_session ? `, ${leave.half_session} half` : ''})` : ''}
        </TintBox>
      )}
      {(status === 'MISS_IN' || status === 'MISS_OUT') && (
        <TintBox fg={C.critical} bg={C.warningTint}>
          {status === 'MISS_IN' ? 'No punch-in was recorded' : 'No punch-out was recorded'} for this day. Raise a regularisation with the right time.
        </TintBox>
      )}
      {status === 'HALF_DAY' && (
        <TintBox fg={C.warning} bg={C.warningTint}>Marked half day — the first punch came after the shift's last allowed punch-in time.</TintBox>
      )}
      {!!day?.expected_in && !['HOLIDAY', 'WEEKLY_OFF', 'ON_LEAVE'].includes(status) && (
        <Txt size={11.5} tone="muted" style={{ marginBottom: 8 }}>Shift {day.shift_code || ''} · expected {day.expected_in}–{day.expected_out}</Txt>
      )}

      {rec && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginBottom: 10 }}>
          {([['In', fmtT(rec.work_in)], ['Out', fmtT(rec.work_out)], ['Worked', worked], ['Late', `${rec.late_minutes || 0}m`], ['OT', `${rec.overtime_minutes || 0}m`]] as [string, string][]).map(([k, v]) => (
            <View key={k} style={{ width: '48.8%', backgroundColor: C.sunken, borderRadius: R.sm, paddingVertical: 7, paddingHorizontal: 10 }}>
              <Txt size={10} w={600} tone="faint" style={{ textTransform: 'uppercase' }}>{k}</Txt>
              <Txt size={13} w={600} style={{ marginTop: 2 }}>{v}</Txt>
            </View>
          ))}
        </View>
      )}

      <Txt size={11} w={600} color={C.brandDeep} style={{ textTransform: 'uppercase', letterSpacing: 0.55, marginBottom: 6 }}>Punch Timeline</Txt>
      <Punches date={date} />

      {!!rec?.regularized_at && (
        <TintBox fg={C.positive} bg={C.positiveTint} size={12} style={{ marginTop: 10, marginBottom: 0 }}>Corrected through an approved regularisation.</TintBox>
      )}
      {correction?.status === 'PENDING' && (
        <TintBox fg={C.warning} bg={C.warningTint} size={12} style={{ marginTop: 10, marginBottom: 0 }}>
          Correction to {String(correction.requested_in).slice(0, 5)}–{String(correction.requested_out).slice(0, 5)} is waiting on {correction.waiting_on?.name || 'HR'}{correction.waiting_on?.role ? ` (${correction.waiting_on.role})` : ''}.
        </TintBox>
      )}
      {correction?.status === 'REJECTED' && (
        <TintBox fg={C.critical} bg={C.criticalTint} size={12} style={{ marginTop: 10, marginBottom: 0 }}>
          Your correction was declined{correction.decided_by ? ` by ${correction.decided_by}` : ''}{correction.review_remark ? `: ${correction.review_remark}` : '.'}
        </TintBox>
      )}
      {canRaise && <WarnButton title={correction?.status === 'REJECTED' ? 'Raise again' : 'Raise regularisation'} onPress={() => onRaise(date)} />}
    </Card>
  )
}
