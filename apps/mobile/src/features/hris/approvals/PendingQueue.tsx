// The core approvals queue — components/ess/hris/TasksApprovals.tsx (KPIs,
// filter chips, PendingCard).
//
// NOTHING ABOUT THE CONTRACT MOVES. GET /api/ess/approvals for the list,
// ?resignation_id= for a chain on demand, POST the same body for an action, and
// the action set is `item.actions` as the server returned it — this file never
// decides who may act. `mine` = stamped to you; anything else is oversight.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { openLink } from '@/core/links'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Input, PickerField, Txt } from '@/ui/primitives'
import { DateSheet, fmtDay, useOverlay } from '@/ui/overlays'
import { Ic, type IconKey } from '../icons'
import { errMsg, fmtDateTime, KpiGrid, LoadingLine, NoteBox, Pill } from '../ui'
import { afterDecision } from './shared'

export interface PendingItem {
  kind: 'LEAVE' | 'LEAVE_CANCEL' | 'REGULARISATION' | 'TRAVEL' | 'RESIGNATION'
  id: string; employee_id: string; who: string; what: string; meta: string; stage: string
  raised_at?: string | null; surfaced_via: string; mine: boolean; actions: string[]
  tone?: 'w' | 'd'; link?: string; facts?: string[]; alert?: string | null
  /** Resignations: the dates the LWD inputs start from — policy (resignation date + notice) and the RM's proposal. */
  lwd_policy?: string | null; lwd_proposed?: string | null; notice_days?: number | null
}
interface ChainRow { stage: string; action: string; approver?: { full_name?: string | null; emp_code?: string | null; designation?: string | null } | null; actioned_at: string; note?: string | null; proposed_lwd?: string | null }

type Filter = 'MINE' | 'ALL' | 'LEAVE' | 'ATTENDANCE' | 'TRAVEL' | 'RESIGNATION'
const CHIPS: [Filter, string][] = [
  ['MINE', 'Waiting on me'], ['ALL', 'Everything'],
  ['LEAVE', 'Leave'], ['ATTENDANCE', 'Attendance'], ['TRAVEL', 'Travel'], ['RESIGNATION', 'Resignation'],
]
const KIND: Record<PendingItem['kind'], [IconKey, string]> = {
  LEAVE: ['clock', 'Leave'], LEAVE_CANCEL: ['x', 'Leave cancellation'], REGULARISATION: ['check', 'Attendance'],
  TRAVEL: ['plane', 'Travel'], RESIGNATION: ['door', 'Resignation'],
}
const needsInput = (a: string) => ['Accept with my date', 'Request retention', 'Set final LWD', 'Decline'].includes(a)

/** TasksApprovals.tsx — where the LWD input's date came from, and a shortfall warning. */
function lwdHint(item: PendingItem, lwd: string) {
  return item.lwd_proposed && lwd === item.lwd_proposed ? `Filled from the manager's proposal (${item.lwd_proposed}); policy LWD is ${item.lwd_policy || '-'}.`
    : item.lwd_policy && lwd === item.lwd_policy ? `Filled as per the notice period${item.notice_days != null ? ` of ${item.notice_days} days` : ''}: ${item.lwd_policy}.`
    : item.lwd_policy ? `Policy LWD ${item.lwd_policy}${item.lwd_proposed ? ` · manager proposed ${item.lwd_proposed}` : ''}${lwd && lwd < item.lwd_policy ? ' · earlier than policy: notice shortfall recovery applies' : ''}` : ''
}

function ToggleBtn({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return <Button title={label} size="sm" variant={on ? 'primary' : 'outline'} onPress={onPress} style={{ flex: 1 }} />
}

function PendingCard({ item, employeeId, onDone }: { item: PendingItem; employeeId: string; onDone: (msg: string) => void }) {
  const { C } = useTheme()
  const [ask, setAsk] = React.useState<string | null>(null)
  const [note, setNote] = React.useState('')
  const [lwd, setLwd] = React.useState('')
  const [regret, setRegret] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')
  const [chain, setChain] = React.useState<ChainRow[] | null>(null)
  const [dateOpen, setDateOpen] = React.useState(false)

  async function fire(a: string) {
    setErr('')
    if (a === 'Open claim') { openLink(item.link || 'claims'); return }
    if (a === 'View') return
    if (a === 'View full chain') {
      if (chain) { setChain(null); return }
      try { const r = await api<{ chain?: ChainRow[] }>('/api/ess/approvals', { query: { resignation_id: item.id }, employeeId }); setChain(r.chain || []) }
      catch (e) { setErr(errMsg(e)) }
      return
    }
    if (needsInput(a) && ask !== a) {
      // The date starts from the RM's proposal, else the policy LWD (resignation date + notice period).
      if (a === 'Set final LWD' || a === 'Accept with my date') setLwd(item.lwd_proposed || item.lwd_policy || '')
      setAsk(a); return
    }
    if (a === 'Set final LWD' && !lwd) { setErr('Pick the final last working day'); return }
    setBusy(true)
    try {
      await api('/api/ess/approvals', { method: 'POST', employeeId, body: { kind: item.kind, id: item.id, action: a, note: note || null, lwd: lwd || null, regrettable: regret } })
      onDone(`${a}: done`)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }

  const [icon, label] = KIND[item.kind] || ['info', item.kind]
  const noteLabel = ask === 'Request retention' ? 'What you plan to discuss' : ask === 'Decline' ? 'Reason (shown to the employee)' : 'Note (optional)'

  return (
    <View style={{ borderWidth: 1, borderStyle: item.mine ? 'solid' : 'dashed', borderColor: item.mine ? C.brandEdge : C.lineStrong, borderLeftWidth: 4, borderLeftColor: item.mine ? C.brand : C.lineStrong, borderRadius: R.md, padding: S.md, marginBottom: S.sm, backgroundColor: C.surface, opacity: busy ? 0.6 : 1 }}>
      <Txt size={F.body} w={700}>{item.who}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.sunken }}>
          <Ic k={icon} size={12} color={C.inkSoft} /><Txt size={11} w={600} tone="soft">{label}</Txt>
        </View>
        <Txt size={F.tiny} tone="muted" style={{ flexShrink: 1 }}>{item.what}</Txt>
      </View>
      <Pill tone={item.mine ? 'warn' : 'mut'} label={item.mine ? item.stage : `${item.stage} · ${item.surfaced_via}`} style={{ marginTop: 8 }} />
      {!!item.meta && <Txt size={11.5} tone="faint" style={{ marginTop: 6 }}>{item.meta}</Txt>}
      {!!item.facts?.length && (
        <View style={{ marginTop: 7, gap: 2 }}>
          {item.facts.map((f, i) => <Txt key={i} size={11.5} tone="muted">•  {f}</Txt>)}
        </View>
      )}
      {!!item.alert && <NoteBox tone="w" style={{ marginTop: 9 }}>{item.alert}</NoteBox>}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {item.actions.map((a, idx) => {
          const primary = idx === 0 && item.mine && a !== 'View'
          const danger = /decline|retention/i.test(a)
          return <Button key={a} title={a} size="sm" disabled={busy} onPress={() => void fire(a)} variant={primary ? 'primary' : danger ? 'danger' : 'outline'} />
        })}
      </View>

      {ask && (
        <View style={{ marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: C.canvas }}>
          {(ask === 'Accept with my date' || ask === 'Set final LWD') && (
            <PickerField label={ask === 'Set final LWD' ? 'Final last working day' : 'Proposed last working day'} value={lwd ? fmtDay(lwd) : ''} placeholder="Pick a date" onPress={() => setDateOpen(true)}
              help={lwdHint(item, lwd) || undefined} />
          )}
          {ask === 'Set final LWD' && (
            <View style={{ marginBottom: S.md }}>
              <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Regrettable exit?</Txt>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <ToggleBtn label="Yes, regrettable" on={regret === true} onPress={() => setRegret(true)} />
                <ToggleBtn label="No" on={regret === false} onPress={() => setRegret(false)} />
              </View>
            </View>
          )}
          <Input label={noteLabel} value={note} onChangeText={setNote} multiline inputStyle={{ minHeight: 60 }} />
          <View style={{ flexDirection: 'row', gap: 7 }}>
            <Button title={`Confirm: ${ask}`} size="sm" disabled={busy} onPress={() => void fire(ask)} style={{ flex: 1 }} />
            <Button title="Cancel" size="sm" variant="outline" onPress={() => { setAsk(null); setNote(''); setLwd('') }} />
          </View>
          <DateSheet visible={dateOpen} onClose={() => setDateOpen(false)} value={lwd || null} onPick={setLwd}
            title={ask === 'Set final LWD' ? 'Final last working day' : 'Proposed last working day'} />
        </View>
      )}

      {item.tone && !ask && <NoteBox tone={item.tone} style={{ marginTop: 10 }}>{item.tone === 'w' ? 'Time-sensitive.' : 'Needs a conversation, not just a click.'}</NoteBox>}
      {!!err && <NoteBox tone="d" style={{ marginTop: 8 }}>{err}</NoteBox>}

      {chain && (
        <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 }}>
          <Txt size={F.tiny} w={700} style={{ marginBottom: 8 }}>Full chain</Txt>
          {chain.length === 0 && <Txt size={F.tiny} tone="faint">No stage entries yet.</Txt>}
          {chain.map((c, i) => (
            <View key={i} style={{ paddingVertical: 4 }}>
              <Txt size={F.tiny}>
                <Txt size={F.tiny} w={700}>{c.stage}</Txt> · {c.action.toLowerCase().replace(/_/g, ' ')}
                {c.approver?.full_name ? ` · ${c.approver.full_name}` : ''}{c.proposed_lwd ? ` · LWD ${c.proposed_lwd}` : ''}
                <Txt size={F.tiny} tone="faint">{'  '}{fmtDateTime(c.actioned_at)}</Txt>
              </Txt>
              {!!c.note && <Txt size={F.tiny} tone="muted" style={{ marginLeft: 8 }}>“{c.note}”</Txt>}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: R.pill, justifyContent: 'center', borderWidth: 1, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brand : C.surface }}>
      <Txt size={F.tiny} w={600} color={on ? C.onAccent : C.inkSoft}>{label}</Txt>
    </Pressable>
  )
}

export function usePendingQueue(employeeId: string) {
  return useQuery({
    queryKey: ['approvals', 'queue', employeeId],
    queryFn: () => api<{ items: PendingItem[]; mine: number }>('/api/ess/approvals', { employeeId }),
    enabled: !!employeeId,
  })
}

export function PendingQueue({ employeeId }: { employeeId: string }) {
  const { notify } = useOverlay()
  const q = usePendingQueue(employeeId)
  const [filter, setFilter] = React.useState<Filter>('MINE')
  if (q.error) return <NoteBox tone="d">{errMsg(q.error)}</NoteBox>
  if (!q.data) return <LoadingLine />
  const items = q.data.items || []
  const mine = items.filter(i => i.mine).length
  const inFilter = (i: PendingItem) => filter === 'ALL' ? true : filter === 'MINE' ? i.mine
    : filter === 'LEAVE' ? i.kind === 'LEAVE' || i.kind === 'LEAVE_CANCEL'
    : filter === 'ATTENDANCE' ? i.kind === 'REGULARISATION' : i.kind === filter
  const shown = items.filter(inFilter)
  return (
    <>
      <KpiGrid items={[
        { k: 'Waiting on you', v: mine, tone: mine ? 'warn' : 'ok' },
        { k: 'In your scope', v: items.length - mine },
        { k: 'Resignations', v: items.filter(i => i.kind === 'RESIGNATION').length },
        { k: 'Leave, attendance & travel', v: items.filter(i => i.kind !== 'RESIGNATION').length },
      ]} />
      <Card>
        <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>Approvals</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: S.md }}>
          {CHIPS.map(([k, l]) => <FilterChip key={k} label={l} on={filter === k} onPress={() => setFilter(k)} />)}
        </View>
        {shown.length === 0
          ? <Txt size={12.5} tone="muted" style={{ paddingVertical: 6 }}>Nothing here: {filter === 'MINE' ? 'nothing is waiting on you.' : 'nothing in this view.'}</Txt>
          : shown.map(it => <PendingCard key={`${it.kind}:${it.id}`} item={it} employeeId={employeeId} onDone={m => { notify(m); void afterDecision() }} />)}
        <Txt size={11.5} tone="muted" style={{ marginTop: S.sm, lineHeight: 17 }}>
          Items stamped to you can be actioned here. Items in your wider scope (HOD department, HR / Finance role) are shown for oversight; the person they are stamped to acts on them. Approving an attendance correction updates the employee’s attendance for those days. Travel claims are actioned from the Travel Claims screen.
        </Txt>
      </Card>
    </>
  )
}
