// src/features/profile/EditHub.tsx — Profile360 EditHub, the "Edit profile"
// sheet: what is left to complete, what you can change yourself (saves at
// once), what needs approval (and to whom, by name), and what HR maintains.
//
// "Request a change" opens the same sheet; on the website it scrolls to
// "Needs approval". A bottom sheet cannot be scrolled from outside, so on a
// phone that section is put first instead.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { goesTo, SCHEME_LABEL, type Scheme } from '@web/profile/self-service'
import { maySee, type ProfileField, type ProfilePayload } from '@web/profile/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { IconChevronDown } from '@/ui/icons'
import { val } from './format'
import { ALL_FIELDS, fieldMode, NIL, shownValue } from './rules'
import { TodoRow } from './Identity'

function HubRow({ label, value, action, sub, first, onPress }: {
  label: string; value: string | null; action: string; sub?: string; first?: boolean; onPress: () => void
}) {
  const { C } = useTheme()
  const empty = value === NIL || !value
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.sm, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.micro} w={700} tone="muted" upper>{label}</Txt>
        {value !== null && (
          empty ? <Txt size={F.small} tone="faint" style={{ fontStyle: 'italic' }}>Not added</Txt>
            : <Txt size={F.small} w={600} numberOfLines={2}>{value}</Txt>
        )}
        {!!sub && <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{sub}</Txt>}
      </View>
      <Button title={action} variant="outline" size="sm" onPress={onPress} />
    </View>
  )
}

function HubSec({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: S.lg }}>
      <Txt size={F.body} w={700}>{title}</Txt>
      {!!sub && <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{sub}</Txt>}
      <View style={{ marginTop: S.xs }}>{children}</View>
    </View>
  )
}

export function EditHub({ payload, focus, onField, onAction, onFix }: {
  payload: ProfilePayload; focus: 'edit' | 'request'
  onField: (f: ProfileField) => void; onAction: (a: string) => void; onFix: (s: string) => void
}) {
  const { C } = useTheme()
  const [lockOpen, setLockOpen] = React.useState(false)
  const ap = payload.self?.approvers
  const pending = payload.completeness.pending ?? []
  const nom = (s: Scheme) => {
    const rows = payload.nominations.filter(n => String(n.scheme) === s)
    return rows.length ? rows.map(r => `${val(r.nominee_name)} ${Number(r.share_percent)}%`).join(', ') : ''
  }

  const mine: ProfileField[] = [], approval: ProfileField[] = [], locked: ProfileField[] = []
  for (const f of ALL_FIELDS) {
    const m = fieldMode(f, payload, true)
    if (m.kind === 'edit' || m.kind === 'add') mine.push(f)
    else if (m.kind === 'request') { if (f.editor !== 'bank') approval.push(f) }
    else if (f.state === 'locked' && maySee(payload.viewer_role, f.min)) locked.push(f)
  }
  const hasBank = !!payload.self?.ids?.has_bank

  const todo = pending.length > 0 && (
    <HubSec title="To complete">
      {pending.map((p, i) => <TodoRow key={p} sentence={p} first={i === 0} onFix={() => onFix(p)} />)}
    </HubSec>
  )
  const yours = (
    <HubSec title="Change it yourself" sub="Saves straight away.">
      <HubRow first label="Profile photo" value={payload.photoUrl ? 'Set' : ''} action={payload.photoUrl ? 'Change' : 'Upload'} onPress={() => onAction('photo')} />
      {mine.map(f => (
        <HubRow key={f.key} label={f.label} value={shownValue(f, payload).text} action={fieldMode(f, payload, true).label} onPress={() => onField(f)} />
      ))}
      {(['pf', 'gratuity'] as Scheme[]).map(s => (
        <HubRow key={s} label={`${SCHEME_LABEL[s]} nominees`} value={nom(s)} action={nom(s) ? 'Edit' : 'Add'}
          onPress={() => onAction(s === 'pf' ? 'nominee_pf' : 'nominee_gratuity')} />
      ))}
      <HubRow label="Documents" value={null} action="Open" sub="Aadhaar, PAN, certificates. HR verifies each upload." onPress={() => onAction('documents')} />
    </HubSec>
  )
  const needs = (
    <HubSec title="Needs approval" sub="Nothing changes until the approver accepts it. Follow it in Change history.">
      {approval.map((f, i) => (
        <HubRow key={f.key} first={i === 0} label={f.label} value={shownValue(f, payload).text} action="Request change"
          sub={`Goes to ${goesTo(f.key, ap).summary}`} onPress={() => onField(f)} />
      ))}
      <HubRow first={!approval.length} label="Salary account"
        value={hasBank ? `${val(payload.employee.bank_name)} · ${payload.self?.ids?.bank_masked ?? ''}` : ''}
        action={hasBank ? 'Request change' : 'Add'} sub={`Goes to ${goesTo('salary_account', ap).summary}`} onPress={() => onAction('bank')} />
    </HubSec>
  )

  return (
    <View>
      {focus === 'request' ? <>{needs}{todo}{yours}</> : <>{todo}{yours}{needs}</>}
      {locked.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md }}>
          <Pressable onPress={() => setLockOpen(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: lockOpen }}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 32 }}>
            <Txt size={F.small} w={700} style={{ flex: 1 }}>Maintained by HR ({locked.length})</Txt>
            <View style={{ transform: [{ rotate: lockOpen ? '180deg' : '0deg' }] }}><IconChevronDown size={16} color={C.muted} /></View>
          </Pressable>
          {lockOpen && (
            <>
              <Txt size={F.tiny} tone="muted" style={{ marginTop: 4 }}>Your organisation keeps these. If one is wrong, ask HR to correct it.</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>
                {locked.map(f => (
                  <View key={f.key} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: R.pill, backgroundColor: C.sunken }}>
                    <Txt size={F.tiny} tone="soft">{f.label}</Txt>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  )
}
