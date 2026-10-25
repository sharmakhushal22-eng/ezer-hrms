// src/features/leave/ApplyPanel.tsx — "Apply for leave".
// Source: components/ess/LeaveSection.tsx (the Apply section, chooseType,
// pickDay, setStart/setEnd, submit, the split-with-LWP offer).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Input, Notice, Txt } from '@/ui/primitives'
import { DateSheet, useOverlay } from '@/ui/overlays'
import { IconCalendar } from '@/ui/icons'
import { useEmployeeId } from '@/core/session'
import { applyLeave, afterLeaveWrite } from './data'
import { LeaveCalendar } from './LeaveCalendar'
import {
  balanceAfterOf, BLANK, dayLong, endInto, estimateOf, fmtSlot, fromIso, pickInto, plural, rangeLabel, startInto,
  type DayRules, type Estimate, type LeaveForm, type LeaveType, type Payload, type SplitOffer,
} from './logic'

export function PanelHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: S.md }}>
      <Txt size={F.lead} w={700}>{title}</Txt>
      {!!meta && <Txt size={F.micro} w={600} tone="faint">{meta}</Txt>}
    </View>
  )
}

function FLabel({ children }: { children: React.ReactNode }) {
  return <Txt size={F.micro} w={700} tone="muted" upper>{children}</Txt>
}

function TypeChip({ t, on, onPress }: { t: LeaveType; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: !t.eligible }}
      accessibilityLabel={!t.eligible && t.reason ? `${t.name}: ${t.reason}` : t.name}
      style={({ pressed }) => ({
        minHeight: 40, paddingHorizontal: 12, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', gap: 6,
        borderWidth: 1, borderStyle: t.eligible ? 'solid' : 'dashed',
        borderColor: on ? C.brand : C.lineStrong,
        backgroundColor: on ? C.brand : pressed && t.eligible ? C.brandTint : C.surface,
        opacity: t.eligible ? 1 : 0.5,
      })}>
      <Txt size={F.small} w={700} color={on ? C.onAccent : C.ink}>{t.short_name}</Txt>
      {t.available != null && <Txt size={F.tiny} w={600} color={on ? C.onAccent : C.muted} style={on ? { opacity: 0.75 } : undefined}>{t.available}</Txt>}
    </Pressable>
  )
}

function DateSlot({ label, value, onPress, first }: { label: string; value: string; onPress: () => void; first?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}${value ? `, ${fmtSlot(value)}` : ''}`}
      style={({ pressed }) => ({
        flex: 1, minHeight: 54, paddingHorizontal: S.md, paddingVertical: 8, justifyContent: 'center',
        backgroundColor: value || pressed ? C.brandTint : C.surface,
        borderLeftWidth: first ? 0 : 1, borderLeftColor: C.lineStrong,
        borderBottomWidth: value ? 2 : 0, borderBottomColor: C.brand,
      })}>
      <Txt size={10} w={700} upper color={value ? C.brandDeep : C.muted}>{label}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <Txt size={F.body} w={600} color={value ? C.ink : C.faint}>{value ? fmtSlot(value) : 'dd/mm/yyyy'}</Txt>
        <IconCalendar size={15} color={C.faint} />
      </View>
    </Pressable>
  )
}

function Summary({ form, est, sel, balanceAfter }: { form: LeaveForm; est: Estimate | null; sel: LeaveType | null; balanceAfter: number | null }) {
  const { C } = useTheme()
  const box = { padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.sunken }
  if (!form.from_date) {
    return <View style={box}><Txt size={F.small} tone="muted">Tap a day in the calendar, or type the dates above. One day is one tap.</Txt></View>
  }
  return (
    <View style={[box, { backgroundColor: C.brandTint, borderColor: C.brandEdge }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: S.sm }}>
        <Txt size={F.body} w={700} style={{ flex: 1 }}>{rangeLabel(form.from_date, form.to_date)}</Txt>
        <Txt size={F.body} w={700} color={C.brandDeep}>{est ? `${est.working} day${plural(est.working)}` : '-'}</Txt>
      </View>
      {est && (
        <>
          <Txt size={F.tiny} tone="soft" style={{ marginTop: 4 }}>
            {form.half_day
              ? 'Half day.'
              : est.offs > 0
                ? <>{est.span} calendar day{plural(est.span)}, <Txt size={F.tiny} w={600} color={C.warning}>{est.offs} not counted</Txt>
                  {est.hols.length ? ` (${est.hols.map(x => x.description).join(', ')})` : ''}. Confirmed when you submit.</>
                : <>{est.span} calendar day{plural(est.span)}, all working. Confirmed when you submit.</>}
            {est.working > 0 && balanceAfter != null && balanceAfter >= 0 && sel ? ` You would have ${balanceAfter} ${sel.short_name} left.` : ''}
          </Txt>
          {/* Warned, not blocked — the server has the final say. */}
          {est.working <= 0 && !form.half_day && (
            <Txt size={F.tiny} w={600} tone="critical" style={{ marginTop: 6 }}>Every day here is a weekly-off or holiday, so there is nothing to apply for.</Txt>
          )}
          {balanceAfter != null && balanceAfter < 0 && sel && (
            <Txt size={F.tiny} w={600} tone="critical" style={{ marginTop: 6 }}>
              That is {Math.abs(balanceAfter)} day{plural(Math.abs(balanceAfter))} more {sel.short_name} than you can book{sel.pending ? ' (pending requests included)' : ''}. Submitting will offer to apply the extra days as Leave Without Pay.
            </Txt>
          )}
        </>
      )}
    </View>
  )
}

function SegBtn({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ flex: 1, minHeight: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: C.brandEdge }}>
      <Txt size={F.small} w={600} color={on ? C.brandDeep : C.muted}>{label}</Txt>
    </Pressable>
  )
}

export function ApplyPanel({ data, rules, today, floor, busy, setBusy }: {
  data: Payload; rules: DayRules; today: string; floor: string
  busy: boolean; setBusy: (b: boolean) => void
}) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const employeeId = useEmployeeId()
  const [form, setForm] = React.useState<LeaveForm>(BLANK)
  const [typeNote, setTypeNote] = React.useState('')
  const [splitOffer, setSplitOffer] = React.useState<SplitOffer | null>(null)
  const [cursor, setCursor] = React.useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [picker, setPicker] = React.useState<'' | 'start' | 'end'>('')

  const types = data.types || []
  const sel = types.find(t => t.id === form.leave_type_id) || null
  const est = React.useMemo(() => estimateOf(form, rules), [form, rules])
  const balanceAfter = balanceAfterOf(sel, est)

  const chooseType = (t: LeaveType) => {
    if (!t.eligible) { setTypeNote(`${t.name}: ${t.reason || 'not available to you'}.`); return }
    setTypeNote('')
    // Switching type clears any half-day flag, so a stale half day never survives.
    setForm(f => ({ ...f, leave_type_id: t.id, half_day: false, half_session: '' }))
  }

  const pickDay = (key: string) => {
    if (key < floor) return
    // Leave may SPAN a holiday or weekly off, but may not start or end on one.
    if (rules.isNonWorking(key)) {
      const h = rules.holByDate.get(key)
      setTypeNote(`${dayLong(key)} is ${h ? h.description : 'a weekly off'}. Leave cannot start or end on it.`)
      return
    }
    setTypeNote('')
    setForm(f => pickInto(f, key))
  }

  const showMonthOf = (d: string) => {
    const x = fromIso(d)
    setCursor(c => (c.getFullYear() === x.getFullYear() && c.getMonth() === x.getMonth()) ? c : new Date(x.getFullYear(), x.getMonth(), 1))
  }
  const setStart = (v: string) => { setForm(f => startInto(f, v, floor)); if (v) showMonthOf(v < floor ? floor : v) }
  const setEnd = (v: string) => { setForm(f => endInto(f, v, floor)); if (v) showMonthOf(v < floor ? floor : v) }

  const formKey = `${form.leave_type_id}|${form.from_date}|${form.to_date}|${form.half_day}`
  const offer = splitOffer && splitOffer.key === formKey ? splitOffer : null

  const submit = async (splitWithLwp = false) => {
    if (!form.leave_type_id || !form.from_date || !form.to_date) { notify('Select leave type and dates', 'error'); return }
    if (form.half_day && !form.half_session) { notify('Select 1st half or 2nd half', 'error'); return }
    setBusy(true)
    try {
      const res = await applyLeave(employeeId, form, splitWithLwp)
      const to = res.waiting_on || null
      if (res.split?.length) {
        notify(`Sent as ${res.split.map(x => `${x.days} day${plural(x.days)} ${x.leave_type}`).join(' + ')}${to ? ` to ${to.name}` : ''} ✓`)
      } else {
        notify(`${res.days} day${plural(res.days)} sent${to ? ` to ${to.name} (${to.role})` : ''} for approval ✓`)
      }
      if (res.unrouted) notify('No approver is configured for you — HR will see it in their Requests list. Please tell HR.', 'error')
      setForm(BLANK)
      setSplitOffer(null)
      afterLeaveWrite()
    } catch (e: any) {
      const b = e?.body
      if (b?.can_split && b.split_preview) {
        // Over balance: say so, and offer the usual remedy — the extra days as LWP.
        setSplitOffer({ key: formKey, message: e.message, paid_days: b.split_preview.paid_days, lwp_days: b.split_preview.lwp_days, lwp_type: b.split_preview.lwp_type || 'Leave Without Pay' })
      } else {
        setSplitOffer(null)
        notify(e?.message || 'Could not submit', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card style={{ marginBottom: S.md }}>
      <PanelHead title="Apply for leave" />

      {/* Leave type */}
      <View style={{ marginBottom: S.lg }}>
        <View style={{ marginBottom: 8 }}><FLabel>Leave type</FLabel></View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {types.map(t => <TypeChip key={t.id} t={t} on={form.leave_type_id === t.id} onPress={() => chooseType(t)} />)}
        </View>
        {sel && (
          <Txt size={F.tiny} tone="muted" style={{ marginTop: 8 }}>
            {sel.name}{sel.available != null ? ` · ${sel.available} day${plural(sel.available)} left` : ' · no balance needed'}{sel.pending ? ` · ${sel.pending} pending` : ''}
          </Txt>
        )}
        {!!typeNote && <Txt size={F.tiny} w={600} tone="warning" style={{ marginTop: 6 }}>{typeNote}</Txt>}
      </View>

      {/* Dates */}
      <View style={{ marginBottom: S.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: 8, minHeight: 28 }}>
          <View style={{ flex: 1 }}><FLabel>Dates</FLabel></View>
          {est && <Txt size={F.tiny} w={700} color={C.brandDeep}>{est.working} day{plural(est.working)} selected</Txt>}
          {!!form.from_date && (
            <Pressable onPress={() => setForm(f => ({ ...f, from_date: '', to_date: '' }))} hitSlop={8} accessibilityRole="button"
              style={{ minHeight: 32, paddingHorizontal: 8, justifyContent: 'center' }}>
              <Txt size={F.tiny} w={600} tone="muted">Clear</Txt>
            </Pressable>
          )}
        </View>
        <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.md, overflow: 'hidden' }}>
          <DateSlot label="Start" value={form.from_date} onPress={() => setPicker('start')} first />
          <DateSlot label="End" value={form.to_date} onPress={() => setPicker('end')} />
        </View>
        <LeaveCalendar cursor={cursor} onCursor={setCursor} floor={floor} today={today} form={form} rules={rules} onPick={pickDay} />
      </View>

      <View style={{ marginBottom: S.lg }}>
        <Summary form={form} est={est} sel={sel} balanceAfter={balanceAfter} />
      </View>

      {/* Driven by the selected type's own allow_half_day flag. */}
      {sel?.allow_half_day && !!form.from_date && form.from_date === form.to_date && (
        <View style={{ marginBottom: S.lg }}>
          <View style={{ marginBottom: 8 }}><FLabel>Duration</FLabel></View>
          <View accessibilityLabel="Duration" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: R.md, backgroundColor: C.sunken }}>
            <SegBtn label="Full day" on={!form.half_day} onPress={() => setForm(f => ({ ...f, half_day: false, half_session: '' }))} />
            <SegBtn label="1st half" on={form.half_day && form.half_session === '1st'} onPress={() => setForm(f => ({ ...f, half_day: true, half_session: '1st' }))} />
            <SegBtn label="2nd half" on={form.half_day && form.half_session === '2nd'} onPress={() => setForm(f => ({ ...f, half_day: true, half_session: '2nd' }))} />
          </View>
        </View>
      )}

      <Input label="Reason" value={form.reason} placeholder="Brief reason for your manager"
        onChangeText={v => setForm(f => ({ ...f, reason: v }))} />

      <View style={{ gap: S.sm }}>
        <Button title={busy ? 'Submitting…' : 'Submit request'} loading={busy} full
          disabled={busy || !form.leave_type_id || !form.from_date || !form.to_date}
          onPress={() => submit(false)} />
        {!!(form.leave_type_id || form.from_date || form.reason) && (
          <Button title="Clear" variant="ghost" full onPress={() => { setForm(BLANK); setTypeNote('') }} />
        )}
      </View>

      {offer && (
        <Notice tone="warning" style={{ marginTop: S.md }}>
          <Txt size={F.small} color={C.warning}>
            {offer.message}{' '}
            {offer.paid_days > 0
              ? <>You can apply <Txt size={F.small} w={700} color={C.warning}>{offer.paid_days} day{plural(offer.paid_days)} as {sel?.short_name}</Txt> and the remaining <Txt size={F.small} w={700} color={C.warning}>{offer.lwp_days} as {offer.lwp_type}</Txt> (unpaid).</>
              : <>You can apply all <Txt size={F.small} w={700} color={C.warning}>{offer.lwp_days} day{plural(offer.lwp_days)} as {offer.lwp_type}</Txt> (unpaid) instead.</>}
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <Button size="sm" variant="outline" disabled={busy} loading={busy}
              title={offer.paid_days > 0 ? `Apply ${offer.paid_days} + ${offer.lwp_days} LWP` : `Apply as ${offer.lwp_type}`}
              onPress={() => submit(true)} />
            <Button size="sm" variant="outline" title="Change dates" onPress={() => setSplitOffer(null)} />
          </View>
        </Notice>
      )}

      {data.diagnostics?.noApprover && (
        <Notice tone="warning" style={{ marginTop: S.md }}>
          No reporting or HR manager is recorded against you, so a request may not reach anyone. Ask HR to set your manager before applying.
        </Notice>
      )}

      <DateSheet visible={picker === 'start'} onClose={() => setPicker('')} title="Start"
        value={form.from_date || null} min={floor} onPick={setStart} />
      <DateSheet visible={picker === 'end'} onClose={() => setPicker('')} title="End"
        value={form.to_date || form.from_date || null} min={form.from_date || floor} onPick={setEnd} />
    </Card>
  )
}
