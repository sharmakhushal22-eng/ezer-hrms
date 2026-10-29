// src/features/performance/EmpOneToOne.tsx — §3.3 One-to-One Log (website:
// components/pms/EmployeeTabs.tsx OneToOneTab). The table becomes one card per
// discussion; duration, the agreed weightage changes and an Acknowledge button
// for a discussion somebody else logged, as on the website.
import * as React from 'react'
import { View } from 'react-native'
import { humanDate } from '@web/pms/cycle'
import { logRows, canLockWeightage, canPublishResult, TYPE_LABEL, TYPE_PURPOSE, DISCUSSION_TYPES, MODES, MODE_LABEL,
  type Log, type DiscussionType, type Mode, type WeightageChange } from '@web/pms/oneToOne'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, SelectSheet } from '@/ui/overlays'
import { B, Banner, Field, K, PCard, Pill, type PillKind } from './ui'

const TYPE_PILL: Record<DiscussionType, PillKind> = { KRA_SETTING: 'brand', MID_PERIOD: 'blue', FINAL_REVIEW: 'amber', ADHOC: 'grey' }
const Ack = ({ on }: { on?: boolean | null }) => on ? <Pill kind="green" label="✓ acknowledged" /> : <Pill kind="grey" label="not yet" />
type KraLite = { seq_no: number; kra_title: string; weightage: number }

function ChangeRow({ c, i, kras, onSet, onPickKra }: {
  c: WeightageChange; i: number; kras: KraLite[]
  onSet: (i: number, patch: Partial<WeightageChange>) => void; onPickKra: (i: number) => void
}) {
  const { C } = useTheme()
  const k = kras.find(x => x.seq_no === c.seq_no)
  const numOf = (t: string) => Number(t.replace(/[^0-9.-]/g, '')) || 0
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.sm }}>
      <PickerField label="Which KRA" value={k ? `${k.seq_no}. ${k.kra_title.slice(0, 40)}` : `KRA ${c.seq_no}`} onPress={() => onPickKra(i)} disabled={!kras.length} />
      <View style={{ flexDirection: 'row', gap: S.md }}>
        <Input label="Was" value={String(c.old_wt)} keyboardType="number-pad" style={{ flex: 1 }} accessibilityLabel={`Change ${i + 1} was`}
          onChangeText={t => onSet(i, { old_wt: numOf(t) })} />
        <Input label="Now" value={String(c.new_wt)} keyboardType="number-pad" style={{ flex: 1 }} accessibilityLabel={`Change ${i + 1} now`}
          onChangeText={t => onSet(i, { new_wt: numOf(t) })} />
      </View>
      <Input label="Why" value={c.reason ?? ''} style={{ marginBottom: 0 }} accessibilityLabel={`Change ${i + 1} why`} onChangeText={t => onSet(i, { reason: t })} />
    </View>
  )
}

export function OneToOneTab({ logs, managerName, onLog, onAcknowledge, saving, kras = [] }: {
  logs: Log[]; managerName: string; onLog?: (l: Log) => void; onAcknowledge?: (logId: string) => void; saving?: boolean
  kras?: KraLite[]
}) {
  const { C } = useTheme()
  const [type, setType] = React.useState<DiscussionType>('KRA_SETTING')
  const [date, setDate] = React.useState('')
  const [mode, setMode] = React.useState<Mode>('IN_PERSON')
  const [points, setPoints] = React.useState('')
  const [mins, setMins] = React.useState('')
  const [wtChanges, setWtChanges] = React.useState<WeightageChange[]>([])
  const [sheet, setSheet] = React.useState<null | 'date' | 'type' | 'mode'>(null)
  const [kraFor, setKraFor] = React.useState<number | null>(null)
  const lock = canLockWeightage(logs)
  const publish = canPublishResult(logs)
  const rows = logRows(logs)
  const setChange = (i: number, patch: Partial<WeightageChange>) => setWtChanges(a => a.map((x, j) => j === i ? { ...x, ...patch } : x))
  const addChange = () => setWtChanges(c => [...c, { seq_no: kras[0]?.seq_no ?? 1, old_wt: kras[0]?.weightage ?? 0, new_wt: 0, reason: '' }])

  return (
    <>
      {lock.open
        ? <Banner tone="green" glyph="✓">The KRA one-to-one is acknowledged by both of you, so your <B>weightages are locked</B>.</Banner>
        : <Banner tone="amber" glyph="⚠️">Your weightages are <B>not locked yet</B>. {lock.because}</Banner>}

      <PCard title="One-to-one discussion log" sub="Every discussion stays on record: KRA setting, mid-period, and the final review.">
        {rows.map((l, i) => (
          <View key={l.id ?? `p${i}`} style={{ paddingVertical: S.md, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
              <Pill kind={TYPE_PILL[l.discussion_type]} label={TYPE_LABEL[l.discussion_type]} />
              <Txt size={F.tiny} tone="muted">{l.discussion_date ? humanDate(l.discussion_date) : '-'} · with {managerName || '-'}</Txt>
            </View>
            {l.placeholder ? <K>{TYPE_PURPOSE[l.discussion_type]}</K> : <Txt size={F.tiny}>{l.discussion_points || '-'}</Txt>}
            {!l.placeholder && (
              <>
                <Field label="Mins">{l.duration_minutes == null ? '-' : String(l.duration_minutes)}</Field>
                <Field label="Weightage changes">
                  {!l.weightage_changes?.length ? <K>-</K> : (
                    <View>{l.weightage_changes.map((c, j) => (
                      <K key={j}>• KRA {c.seq_no}: {c.old_wt} → {c.new_wt}{c.reason ? ` · ${c.reason}` : ''}</K>
                    ))}</View>
                  )}
                </Field>
              </>
            )}
            <View style={{ flexDirection: 'row', gap: S.lg, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <View style={{ gap: 3 }}>
                <K>You</K>
                {l.employee_ack ? <Ack on /> : onAcknowledge && l.id
                  ? <Button size="sm" title="Acknowledge" disabled={saving} onPress={() => onAcknowledge(l.id!)} />
                  : <Ack on={false} />}
              </View>
              <View style={{ gap: 3 }}><K>Manager</K><Ack on={l.manager_ack} /></View>
            </View>
          </View>
        ))}
        <K style={{ marginTop: 10 }}>
          Both sides have to acknowledge. One tick on its own is a manager asserting a conversation happened; two is a record worth relying on later.
          {!publish.open ? ` ${publish.because}` : ''}
        </K>
      </PCard>

      {!!onLog && (
        <PCard title="Log a discussion" sub="Recorded against this period, and shown to your manager to acknowledge.">
          <PickerField label="Date" value={date ? humanDate(date) : ''} placeholder="Pick a date" onPress={() => setSheet('date')} />
          <PickerField label="Type" value={TYPE_LABEL[type]} onPress={() => setSheet('type')} />
          <PickerField label="How" value={MODE_LABEL[mode]} onPress={() => setSheet('mode')} />
          <Input label="How long (minutes)" value={mins} keyboardType="number-pad" placeholder="e.g. 30"
            hint="Optional, but a four-minute discussion and an hour-long one are different events."
            onChangeText={t => setMins(t.replace(/[^0-9]/g, ''))} />
          <Input label="What was discussed" value={points} onChangeText={setPoints} multiline
            placeholder="Weightage changes and why, targets agreed, support asked for" />
          {type === 'KRA_SETTING' && (
            <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: S.md, marginBottom: S.md }}>
              <Txt size={F.tiny} w={700} style={{ marginBottom: S.sm }}>Weightage changes agreed</Txt>
              {wtChanges.length === 0 && (
                <K style={{ marginBottom: S.sm }}>None. Add one for each weightage the two of you agreed to move — the old figure is recorded here because after you edit your KRAs it cannot be recovered.</K>
              )}
              {wtChanges.map((c, i) => <ChangeRow key={i} c={c} i={i} kras={kras} onSet={setChange} onPickKra={setKraFor} />)}
              <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                <Button size="sm" variant="ghost" title="+ Add a weightage change" onPress={addChange} />
                {wtChanges.length > 0 && <Button size="sm" variant="ghost" title="Remove the last" onPress={() => setWtChanges(c => c.slice(0, -1))} />}
              </View>
            </View>
          )}
          <K>{TYPE_PURPOSE[type]}</K>
          <View style={{ marginTop: S.lg }}>
            <Button full disabled={!date || !points.trim() || saving} title={saving ? 'Saving…' : 'Log it and acknowledge'}
              onPress={() => {
                // Only changes that say something (website): 0 → 0 is a row somebody added and abandoned.
                const changes = wtChanges.filter(c => c.old_wt !== c.new_wt)
                onLog({
                  discussion_type: type, discussion_date: date, mode, discussion_points: points,
                  duration_minutes: mins.trim() ? Number(mins) : null,
                  weightage_changes: changes.length ? changes : null, employee_ack: true,
                })
                setPoints(''); setDate(''); setMins(''); setWtChanges([])
              }} />
          </View>
        </PCard>
      )}

      <DateSheet visible={sheet === 'date'} onClose={() => setSheet(null)} value={date || null} onPick={setDate} title="Date" />
      <SelectSheet visible={sheet === 'type'} onClose={() => setSheet(null)} title="Type" value={type}
        options={DISCUSSION_TYPES.map(t => ({ value: t, label: TYPE_LABEL[t] }))} onPick={v => setType(v as DiscussionType)} />
      <SelectSheet visible={sheet === 'mode'} onClose={() => setSheet(null)} title="How" value={mode}
        options={MODES.map(m => ({ value: m, label: MODE_LABEL[m] }))} onPick={v => setMode(v as Mode)} />
      <SelectSheet visible={kraFor !== null} onClose={() => setKraFor(null)} title="Which KRA"
        value={kraFor !== null ? wtChanges[kraFor]?.seq_no : undefined}
        options={kras.map(k => ({ value: k.seq_no, label: `${k.seq_no}. ${k.kra_title.slice(0, 40)}` }))}
        onPick={v => {
          if (kraFor === null) return
          const seq = Number(v)
          const k = kras.find(x => x.seq_no === seq)
          setWtChanges(a => a.map((x, j) => j === kraFor ? { ...x, seq_no: seq, old_wt: k?.weightage ?? x.old_wt } : x))
        }} />
    </>
  )
}
