// Onboarding approvals — components/ess/OnboardingApprovals.tsx (the list and
// the decisions). GET /api/ess/onboarding-approvals (an error renders nothing,
// as the website), GET ?open={id} for the sheet, POST approve / return / save.
// Returning needs a remark ("Say what the candidate should fix."), collected
// with a prompt; approving needs the team's checklist complete.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { confirmationsOnly, missingItems, type HeadTeam } from '@web/onboarding/checklists'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errMsg, SectionTitle } from '../ui'
import { TEAM, day } from './formSections'
import { OnboardingSheet, type Approval, type OpenState } from './OnboardingSheet'
import { afterDecision } from './shared'

type Item = { id: string; full_name: string; designation: string | null; department: string | null; employment_type: string | null; date_of_joining: string | null; status: string; submitted_at: string | null; approvals: Approval[]; waiting_on_me: string[] }

function ItemCard({ it, busy, onOpen }: { it: Item; busy: boolean; onOpen: (it: Item) => void }) {
  const { C } = useTheme()
  const waiting = it.waiting_on_me.length > 0
  return (
    <View style={{ borderWidth: 1, borderColor: waiting ? C.warningEdge : C.line, backgroundColor: waiting ? C.warningTint : C.surface, borderRadius: R.md, padding: 12, marginBottom: 8, gap: 6 }}>
      <Txt size={13.5} w={700}>{it.full_name} <Txt size={13.5} tone="muted">· {it.designation || '—'}{it.department ? ` · ${it.department}` : ''}</Txt></Txt>
      <Txt size={11.5} tone="muted">Joining {day(it.date_of_joining)} · submitted {day(it.submitted_at)}{waiting ? ` · waiting on you for ${it.waiting_on_me.map(t => TEAM[t]).join(', ')}` : ''}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {it.approvals.map(a => {
          const fg = a.status === 'APPROVED' ? C.positive : a.status === 'RETURNED' ? C.critical : C.warning
          const bg = a.status === 'APPROVED' ? C.positiveTint : a.status === 'RETURNED' ? C.criticalTint : C.warningTint
          return (
            <View key={a.team} accessibilityLabel={a.acted_by_name ? `${a.status === 'RETURNED' ? 'Returned' : 'Approved'} by ${a.acted_by_name} on ${day(a.acted_at)}${a.remark ? `: ${a.remark}` : ''}` : 'Not decided yet'}
              style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: bg }}>
              <Txt size={10} w={700} color={fg}>{TEAM[a.team]} · {a.status === 'APPROVED' ? `✓ ${a.acted_by_name || 'approved'}` : a.status === 'RETURNED' ? 'returned' : 'pending'}</Txt>
            </View>
          )
        })}
      </View>
      <Button title={waiting ? 'Open approval form' : 'View'} size="sm" variant={waiting ? 'primary' : 'outline'} disabled={busy} onPress={() => onOpen(it)} style={{ alignSelf: 'flex-start', marginTop: 2 }} />
    </View>
  )
}

export function OnboardingBlock({ employeeId }: { employeeId: string }) {
  const { notify, prompt } = useOverlay()
  const q = useQuery({
    queryKey: ['approvals', 'onboarding', employeeId],
    queryFn: () => api<{ teams: string[]; items: Item[] }>('/api/ess/onboarding-approvals', { employeeId }).catch(() => ({ teams: [], items: [] })),
    enabled: !!employeeId,
  })
  const [open, setOpen] = React.useState<OpenState | null>(null)
  const [team, setTeam] = React.useState<HeadTeam>('IT')
  const [check, setCheck] = React.useState<Record<string, Record<string, any>>>({})
  const [busy, setBusy] = React.useState(false)
  const d = q.data
  if (!d || !d.teams.length || !d.items.length) return null

  const fetchOpen = (id: string) => api<Omit<OpenState, 'openedAt'>>('/api/ess/onboarding-approvals', { query: { open: id }, employeeId })

  async function review(it: Item) {
    setBusy(true)
    try {
      const x = await fetchOpen(it.id)
      setOpen({ ...x, openedAt: Date.now() }); setCheck(x.checklists || {})
      setTeam((it.waiting_on_me[0] || d!.teams[0]) as HeadTeam)
    } catch (e) { notify(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const setField = (k: string, v: any) => setCheck(c => ({ ...c, [team]: { ...(c[team] || {}), [k]: v } }))

  async function decide(action: 'approve' | 'return' | 'save') {
    if (!open) return
    let remark = ''
    if (action === 'return') {
      const r = await prompt({ title: 'Return to the candidate', message: 'The candidate is emailed your remark and the link, valid 48 hours.', input: { placeholder: 'What should the candidate fix? e.g. the bank account number does not match the cancelled cheque.', required: true }, confirm: 'Return with this remark', destructive: true })
      if (r === null) return
      if (!r.trim()) { notify('Say what the candidate should fix.', 'error'); return }
      remark = r
    }
    if (action === 'approve') { const m = missingItems(team, check[team], open.item?.hiring_track); if (m.length) { notify(`Confirm the checklist first: ${m.join(', ')}.`, 'error'); return } }
    setBusy(true)
    try {
      const r = await api<{ all_approved?: boolean }>('/api/ess/onboarding-approvals', { method: 'POST', employeeId, body: { onboarding_id: open.item.id, team, action, remark, checklist: confirmationsOnly(team, check[team]) } })
      if (action === 'save') { notify('Checklist saved.'); setBusy(false); return }
      if (r.all_approved) notify(`Approved for ${TEAM[team]} — IT, Admin and Payroll have all approved. The HR Manager now generates the employee code (team, roles and the code).`, 'success')
      else notify(action === 'approve' ? `Approved for ${TEAM[team]}.` : 'Returned to the candidate with your remark.')
      setOpen(null); void afterDecision()
    } catch (e) { notify(errMsg(e), 'error') } finally { setBusy(false) }
  }

  const waiting = d.items.filter(i => i.waiting_on_me.length)
  const others = d.items.filter(i => !i.waiting_on_me.length)
  return (
    <Card style={{ marginBottom: S.md }}>
      <SectionTitle>{`Onboarding approvals · ${d.teams.map(t => TEAM[t]).join(' / ')}${waiting.length ? ` · ${waiting.length} waiting on you` : ''}`}</SectionTitle>
      {waiting.map(it => <ItemCard key={it.id} it={it} busy={busy} onOpen={x => void review(x)} />)}
      {others.map(it => <ItemCard key={it.id} it={it} busy={busy} onOpen={x => void review(x)} />)}
      <Txt size={F.tiny} tone="muted" style={{ marginTop: 6, lineHeight: 18 }}>{'These forms are accepted by the HR Manager. Confirm your team\'s checklist and approve; once IT, Admin and Payroll have all approved, the HR Manager generates the employee code. Returning the form reopens the candidate\'s link for 48 hours.'}</Txt>
      {open && open.item && (
        <OnboardingSheet open={open} teams={d.teams} team={team} setTeam={setTeam} check={check} setField={setField} busy={busy}
          onClose={() => setOpen(null)} onDecide={a => void decide(a)} />
      )}
    </Card>
  )
}
