// Offer approvals — RoleTabs.tsx OfferApprovals (list mode).
//
// GET /api/ess/offer-approvals → the HR Head's review list (decide here, POST
// approve / reject) or the HR Manager's "yet to be approved / ready to send"
// cards, plus "My offers" for a hiring manager (offers on MRFs assigned to them:
// with the HR Head, approved, sent, accepted…). Renders nothing for anyone else,
// or when there is nothing to show — a GET error renders nothing too, exactly as the website. The rejection reason is
// mandatory (client and server); it is collected with a prompt.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { openWebsite } from '@/core/links'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { Chip, day, errMsg, FullModal, Pill, SectionTitle, SolidButton, type PillTone } from '../ui'
import { afterDecision } from './shared'

const rs = (n: any) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`
const lakh = (n: any) => `₹${(Number(n || 0) / 100000).toFixed(2)}L`

interface OfferData { isHrHead: boolean; isHrManager?: boolean; pending: any[]; recent: any[]; awaiting?: any[]; ready?: any[]; mine?: any[] }

const REPLY: Record<string, [string, PillTone]> = {
  ACCEPTED: ['Accepted by candidate', 'ok'], AWAITING: ['Sent · awaiting reply', 'info'],
  REVISION: ['Revision asked', 'warn'], BACKOUT: ['Backed out', 'dang'],
}
const offerState = (o: any): [string, PillTone] =>
  o.reply ? REPLY[o.reply] : o.status === 'SUBMITTED' ? ['With HR Head', 'warn'] : o.status === 'HR_HEAD_APPROVED' ? ['Approved · ready to send', 'ok'] : o.status === 'HR_HEAD_REJECTED' ? ['Rejected by HR Head', 'dang'] : ['Sent', 'info']

/** RoleTabs MyOffersCard — where each offer on my MRFs has got to: with the HR Head, approved, sent, accepted… */
function MyOffersCard({ rows }: { rows: any[] }) {
  const { C } = useTheme()
  const accepted = rows.filter(o => o.reply === 'ACCEPTED').length
  return (
    <Card style={{ marginBottom: S.md }}>
      <SectionTitle>{`My offers · ${rows.length}${accepted ? ` · ${accepted} accepted` : ''}`}</SectionTitle>
      {rows.map(o => {
        const [label, tone] = offerState(o)
        return (
          <View key={o.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line, gap: 4 }}>
            <Txt size={F.small} w={600}>{o.candidate} · {o.designation || '-'}</Txt>
            {!!o.mrf_number && <Chip label={o.mrf_number} />}
            <Txt size={11.5} tone="muted">{lakh(o.offered_ctc)}{o.proposed_doj ? ` · DOJ ${day(o.proposed_doj)}` : ''}{o.offer_sent_at ? ` · sent ${day(o.offer_sent_at)}` : ` · submitted ${day(o.submitted_at)}`}</Txt>
            <Pill tone={tone} label={label} />
          </View>
        )
      })}
    </Card>
  )
}

function Line({ k, v }: { k: string; v: any }) {
  const { C } = useTheme()
  if (v == null || v === '' || v === false) return null
  return (
    <View style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <Txt size={11.5} tone="muted">{k}</Txt>
      <Txt size={12.5} w={500} selectable>{String(v)}</Txt>
    </View>
  )
}
function Head({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={{ marginTop: 14, marginBottom: 4 }}>
      <Txt size={F.tiny} w={600} tone="brand" upper>{children}</Txt>
      {!!hint && <Txt size={10.5} tone="faint">{hint}</Txt>}
    </View>
  )
}

function OfferReview({ open, busy, onClose, onApprove, onReject }: { open: any; busy: boolean; onClose: () => void; onApprove: () => void; onReject: () => void }) {
  const { C } = useTheme()
  const [tpl, setTpl] = React.useState(false)
  const tiles: [string, string][] = [
    ['Offered CTC', rs(open.offered_ctc) + ' p.a.'],
    ['Monthly in-hand (est.)', open.monthly_inhand ? rs(open.monthly_inhand) : '-'],
    ['Hike', open.hike_pct != null ? `${Number(open.hike_pct).toFixed(1)}%` : '-'],
  ]
  return (
    <FullModal visible onClose={() => { if (!busy) onClose() }} title={`Offer approval: ${open.candidate}`}
      subtitle={`${open.designation || '-'}${open.mrf_number ? ` · ${open.mrf_number}` : ''}${open.raised_by ? ` · MRF raised by ${open.raised_by}` : ''}${open.recruiter ? ` · recruiter ${open.recruiter}` : ''}`}
      footer={
        <View style={{ gap: S.sm }}>
          <SolidButton title={busy ? 'Approving…' : 'Approve offer'} tone="positive" disabled={busy} onPress={onApprove} full />
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button title="Reject" variant="danger" disabled={busy} onPress={onReject} style={{ flex: 1 }} />
            <Button title="Open in Recruitment" variant="outline" onPress={() => void openWebsite(`/ess/recruitment/hrhead?offer=${open.id}`)} style={{ flex: 1 }} />
          </View>
        </View>
      }>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        {tiles.map(([k, v]) => (
          <View key={k} style={{ flexBasis: '30%', flexGrow: 1, backgroundColor: C.brandTint, borderRadius: R.md, padding: 10 }}>
            <Txt size={10} w={700} color={C.brandDeep} upper>{k}</Txt>
            <Txt size={15} w={700} style={{ marginTop: 2 }}>{v}</Txt>
          </View>
        ))}
      </View>

      <Head>Offered package</Head>
      <Line k="Variable" v={open.variable_pct ? `${open.variable_pct}% · ${rs(Number(open.offered_ctc || 0) * Number(open.variable_pct) / 100)} p.a.` : null} />
      <Line k="Joining bonus" v={Number(open.joining_bonus) > 0 ? `${rs(open.joining_bonus)}${open.joining_bonus_freq ? ` (${open.joining_bonus_freq})` : ''}` : null} />
      <Line k="Retention bonus" v={Number(open.retention_bonus) > 0 ? rs(open.retention_bonus) : null} />
      <Line k="ESOP" v={Number(open.esop_value) > 0 ? `${rs(open.esop_value)}${open.esop_vesting ? ` (${open.esop_vesting})` : ''}` : null} />

      <Head>Joining</Head>
      <Line k="State" v={open.state} />
      <Line k="Proposed DOJ" v={open.proposed_doj ? `${day(open.proposed_doj)}${open.days_to_join != null ? ` · ${open.days_to_join} days from submission` : ''}` : null} />
      <Line k="Notice period" v={open.notice_period_days ? `${open.notice_period_days} days` : null} />
      <Line k="Notice buyout" v={open.notice_buyout ? (Number(open.notice_buyout_amount) > 0 ? `Yes · ${rs(open.notice_buyout_amount)}` : 'Yes') : null} />

      <Head hint="(confidential, not shown to the candidate)">Previous employer</Head>
      <Line k="Company" v={open.prev_company_name || open.current_company} />
      <Line k="Address" v={open.prev_company_address} />
      <Line k="Previous total CTC" v={Number(open.prev_total_ctc) > 0 ? `${rs(open.prev_total_ctc)} p.a.` : null} />
      <Line k="Fixed / variable" v={(Number(open.prev_fixed_ctc) > 0 || Number(open.prev_variable) > 0) ? `${Number(open.prev_fixed_ctc) > 0 ? rs(open.prev_fixed_ctc) : '-'} / ${Number(open.prev_variable) > 0 ? rs(open.prev_variable) : '-'}` : null} />
      <Line k="TA / DA (monthly)" v={Number(open.prev_ta_da) > 0 ? rs(open.prev_ta_da) : null} />
      <Line k="Additional" v={open.prev_additional} />
      <Line k="Experience" v={open.experience_years != null ? `${open.experience_years} years` : null} />

      {(open.hiring_manager_remark || open.recruiter_comments) && <>
        <Head>Remarks</Head>
        <Line k="Hiring manager" v={open.hiring_manager_remark} />
        <Line k="Recruiter" v={open.recruiter_comments} />
      </>}

      {!!open.template_content && (
        <View style={{ marginTop: 12 }}>
          <Pressable onPress={() => setTpl(t => !t)} accessibilityRole="button" style={{ minHeight: 40, justifyContent: 'center' }}>
            <Txt size={F.tiny} w={600} color={C.brandDeep}>{tpl ? '▾' : '▸'} Approval request template (as submitted)</Txt>
          </Pressable>
          {tpl && <View style={{ backgroundColor: C.canvas, borderRadius: 8, padding: 12, marginTop: 4 }}><Txt size={11} selectable style={{ lineHeight: 17 }}>{open.template_content}</Txt></View>}
        </View>
      )}
    </FullModal>
  )
}

export function OfferBlock({ employeeId }: { employeeId: string }) {
  const { C } = useTheme()
  const { notify, prompt } = useOverlay()
  const q = useQuery({
    queryKey: ['approvals', 'offers', employeeId],
    queryFn: () => api<OfferData>('/api/ess/offer-approvals', { employeeId }).catch(() => ({ isHrHead: false, pending: [], recent: [] } as OfferData)),
    enabled: !!employeeId,
  })
  const [open, setOpen] = React.useState<any | null>(null)
  const [busy, setBusy] = React.useState(false)
  const d = q.data
  if (!d) return null
  // Offers on the MRFs this person runs as hiring manager — they sent them, so they keep
  // seeing them after they go out and once the candidate accepts (not only the HR Head).
  const mineCard = !d.isHrHead && d.mine?.length ? <MyOffersCard rows={d.mine} /> : null

  if (!d.isHrHead && d.isHrManager) {
    const awaiting = d.awaiting || [], ready = d.ready || []
    if (!awaiting.length && !ready.length) return mineCard
    return (
      <>
      <Card style={{ marginBottom: S.md }}>
        <SectionTitle>{`Offer letters · HR Manager${awaiting.length ? ` · ${awaiting.length} yet to be approved` : ''}${ready.length ? ` · ${ready.length} ready to send` : ''}`}</SectionTitle>
        {awaiting.map(o => (
          <View key={o.id} style={{ backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warningEdge, borderRadius: 9, padding: 12, marginBottom: 8, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Txt size={18}>⏳</Txt>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Txt size={F.small} w={600}>{o.candidate} · {o.designation || '-'}</Txt>
                {!!o.mrf_number && <Chip label={o.mrf_number} />}
                <Txt size={11.5} tone="warning">{'This candidate\'s offer is yet to be approved by the HR Head · '}{lakh(o.offered_ctc)}{o.proposed_doj ? ` · DOJ ${day(o.proposed_doj)}` : ''} · submitted {day(o.submitted_at)}</Txt>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill tone="warn" label="Awaiting HR Head" />
              <SolidButton title="Send offer" size="sm" disabled />
              <Txt size={10.5} tone="faint">Unlocks once the HR Head approves</Txt>
            </View>
          </View>
        ))}
        {ready.map(o => (
          <View key={o.id} style={{ backgroundColor: C.positiveTint, borderWidth: 1, borderColor: C.positiveEdge, borderRadius: 9, padding: 12, marginBottom: 8, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Txt size={18}>✅</Txt>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Txt size={F.small} w={600}>{o.candidate} · {o.designation || '-'}</Txt>
                {!!o.mrf_number && <Chip label={o.mrf_number} />}
                <Txt size={11.5} tone="positive">Approved by the HR Head on {day(o.actioned_at)} · {lakh(o.offered_ctc)} · the offer letter can be sent now</Txt>
              </View>
            </View>
            <SolidButton title="Send offer →" tone="positive" size="sm" onPress={() => void openWebsite('/ess/recruitment/sendoffer')} />
          </View>
        ))}
      </Card>
      {mineCard}
      </>
    )
  }
  if (!d.isHrHead) return mineCard
  if (!d.pending.length && !d.recent.length) return null

  async function decide(action: 'approve' | 'reject') {
    if (!open) return
    let reason = ''
    if (action === 'reject') {
      const r = await prompt({ title: 'Reason for rejection (goes to the recruiter)', input: { placeholder: 'e.g. CTC above the approved band for this grade. Revise and resubmit.', required: true }, confirm: 'Confirm reject', cancel: '← Back', destructive: true })
      if (r === null) return
      if (!r.trim()) { notify('A rejection reason is required', 'error'); return }
      reason = r.trim()
    }
    setBusy(true)
    try {
      const j = await api<{ notified?: number }>('/api/ess/offer-approvals', { method: 'POST', employeeId, body: { action, request_id: open.id, comment: reason } })
      notify(action === 'approve'
        ? `Approved. ${open.candidate}'s offer moves to Send Offers${j.notified ? ` (${j.notified} notified)` : ''}.`
        : `Rejected. The recruiter has been told${j.notified ? ` (${j.notified} notified)` : ''}.`)
      setOpen(null); void afterDecision()
    } catch (e) { notify(errMsg(e), 'error') }
    setBusy(false)
  }

  return (
    <Card style={{ marginBottom: S.md }}>
      <SectionTitle>{`Offer approvals · HR Head${d.pending.length ? ` · ${d.pending.length} waiting` : ''}`}</SectionTitle>
      {d.pending.length > 0 && <>
        <Txt size={F.tiny} w={700} tone="warning" style={{ marginTop: 6, marginBottom: 4 }}>Waiting on you ({d.pending.length})</Txt>
        {d.pending.map(o => (
          <View key={o.id} style={{ backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warningEdge, borderRadius: 9, padding: 12, marginBottom: 8, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Txt size={18}>💼</Txt>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Txt size={F.small} w={600}>{o.candidate} · {o.designation || '-'}</Txt>
                {!!o.mrf_number && <Chip label={o.mrf_number} />}
                <Txt size={11.5} tone="warning">{o.state ? `${o.state} · ` : ''}Offer of {lakh(o.offered_ctc)}{o.variable_pct ? ` (${o.variable_pct}% variable)` : ''}{o.hike_pct ? ` · ${Number(o.hike_pct).toFixed(1)}% hike` : ''}{o.proposed_doj ? ` · DOJ ${day(o.proposed_doj)}` : ''} · needs your review & approval · submitted {day(o.submitted_at)}</Txt>
              </View>
            </View>
            <SolidButton title="Review & approve" tone="positive" size="sm" onPress={() => setOpen(o)} />
          </View>
        ))}
      </>}
      {d.recent.length > 0 && <>
        <Txt size={F.tiny} w={700} tone="muted" style={{ marginTop: 10, marginBottom: 4 }}>Decided recently ({d.recent.length})</Txt>
        {d.recent.map(o => (
          <View key={o.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line, gap: 4 }}>
            <Txt size={F.small} w={600}>{o.candidate} · {o.designation || '-'}</Txt>
            <Txt size={11.5} tone="muted">{lakh(o.offered_ctc)} · {day(o.actioned_at)}{o.comment ? ` · “${o.comment}”` : ''}</Txt>
            <Pill tone={o.status === 'HR_HEAD_REJECTED' ? 'dang' : 'ok'} label={o.status === 'HR_HEAD_REJECTED' ? 'Rejected' : o.status === 'OFFER_SENT' ? 'Approved · offer sent' : 'Approved'} />
          </View>
        ))}
      </>}
      {open && <OfferReview open={open} busy={busy} onClose={() => setOpen(null)} onApprove={() => void decide('approve')} onReject={() => void decide('reject')} />}
    </Card>
  )
}
