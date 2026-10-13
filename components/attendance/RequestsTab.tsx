'use client'
// components/attendance/RequestsTab.tsx — Attendance & Leave → Requests.
//
// Every leave request, cancellation of approved leave and attendance correction
// in the caller's company scope, oldest-waiting first, with whom each is
// waiting on. Before this there was nowhere HR could see leave across the
// company: a request stuck with an absent manager simply waited (one for 87
// days). HR can approve or decline on the approver's behalf; it goes through
// the same workflow as Tasks & Approvals (lib/leave/workflow.ts), so the
// balance check, the attendance write and the employee's notification are the
// same — only the name on it is HR's.
//
// Data: GET/POST /api/attendance/requests (Attendance VIEW to look, EDIT to act).
import { useCallback, useEffect, useState } from 'react'
import {
  C, Badge, Button, Card, Empty, Notice, Select, SkeletonRows, Stat, StatRow, Tabs, TableWrap, Td, Th, Tr,
} from '@/lib/ui'
import type { CompanyLite } from '@/lib/supabase-shift'
import type { RequestRow } from '@/app/api/attendance/requests/route'

type Status = 'PENDING' | 'DECIDED'
type Kind = 'ALL' | 'LEAVE' | 'CANCEL' | 'REGULARISATION'

async function bearer(): Promise<Record<string, string>> {
  const { authToken } = await import('@/lib/rms/client')
  const t = await authToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

const KIND_LABEL: Record<RequestRow['kind'], string> = { LEAVE: 'Leave', CANCEL: 'Cancellation', REGULARISATION: 'Attendance' }
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const span = (r: RequestRow) => r.from_date === r.to_date ? day(r.from_date) : `${day(r.from_date)} – ${day(r.to_date)}`

export default function RequestsTab({ companies, canAct, notify }: {
  companies: CompanyLite[]
  /** EDIT on Attendance: may approve / decline on the approver's behalf. */
  canAct: boolean
  notify: (msg: string, type?: 'success' | 'error') => void
}) {
  const [status, setStatus] = useState<Status>('PENDING')
  const [kind, setKind] = useState<Kind>('ALL')
  const [company, setCompany] = useState('')
  const [rows, setRows] = useState<RequestRow[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<{ key: string; action: 'approve' | 'decline' } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Rows stay on screen while a refresh is in flight; they are replaced, never blanked.
  const load = useCallback(async () => {
    const qs = new URLSearchParams({ status, kind, ...(company ? { company } : {}) })
    const res = await fetch(`/api/attendance/requests?${qs}`, { headers: await bearer(), cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(j.error || `Could not load (${res.status}).`); setRows([]); return }
    setErr('')
    setRows(j.rows || [])
  }, [status, kind, company])
  useEffect(() => { void load() }, [load])

  async function act(r: RequestRow, action: 'approve' | 'decline') {
    if (action === 'decline' && !note.trim()) { notify('Give a reason — the employee reads it.', 'error'); return }
    setBusy(true)
    const res = await fetch('/api/attendance/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await bearer()) },
      body: JSON.stringify({ kind: r.kind, id: r.id, action, note: note.trim() || null }),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { notify(j.error || 'Could not save.', 'error'); return }
    notify(`${KIND_LABEL[r.kind]} for ${r.employee.name} ${action === 'approve' ? 'approved' : 'declined'}${j.stage === 'HR' ? ' (moved to the HR stage)' : ''}.`)
    setOpen(null); setNote('')
    void load()
  }

  const list = rows || []
  const pending = status === 'PENDING'
  const stuck = list.filter(r => (r.waiting_days ?? 0) > 2).length
  const unrouted = list.filter(r => pending && !r.waiting_on).length

  return (
    <div>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tabs<Status> value={status} onChange={setStatus}
            tabs={[{ key: 'PENDING', label: 'Waiting' }, { key: 'DECIDED', label: 'Decided (30 days)' }]} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select value={kind} onChange={e => setKind(e.target.value as Kind)} style={{ width: 190 }}>
              <option value="ALL">All requests</option>
              <option value="LEAVE">Leave</option>
              <option value="CANCEL">Leave cancellations</option>
              <option value="REGULARISATION">Attendance corrections</option>
            </Select>
            {companies.length > 1 && (
              <Select value={company} onChange={e => setCompany(e.target.value)} style={{ width: 220 }}>
                <option value="">All companies</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
            <Button size="sm" onClick={() => void load()}>Refresh</Button>
          </div>
        </div>
      </Card>

      {pending && rows && (
        <StatRow>
          <Stat label="Waiting" value={list.length} />
          <Stat label="Waiting over 2 days" value={stuck} t={stuck ? 'warning' : 'neutral'} />
          <Stat label="With nobody to approve" value={unrouted} t={unrouted ? 'critical' : 'neutral'} />
        </StatRow>
      )}

      {err && <Notice t="critical">{err}</Notice>}
      {pending && unrouted > 0 && (
        <Notice t="warning" title="Requests with no approver">
          These employees have no reporting or HR manager on record, so their requests reached nobody. Decide them here,
          and set their manager in Employees so the next one routes itself.
        </Notice>
      )}

      <Card pad={0} style={{ marginTop: 12 }}>
        {!rows ? <div style={{ padding: 16 }}><SkeletonRows rows={5} /></div>
          : !list.length ? (
            <Empty title={pending ? 'Nothing is waiting' : 'Nothing decided in the last 30 days'}
              hint={pending ? 'Every leave request and attendance correction in your scope has been decided.' : undefined} />
          ) : (
            <TableWrap minWidth={980}>
              <thead>
                <tr>
                  <Th>Employee</Th><Th>Request</Th><Th>Dates</Th><Th align="right">Days</Th>
                  <Th>{pending ? 'Waiting on' : 'Decided by'}</Th>
                  {pending && <Th align="right">Waiting</Th>}
                  {pending && <Th>Balance</Th>}
                  {!pending && <Th>Outcome</Th>}
                  {pending && canAct && <Th align="right">HR override</Th>}
                </tr>
              </thead>
              <tbody>
                {list.map(r => {
                  const key = `${r.kind}:${r.id}`
                  const isOpen = open?.key === key
                  return (
                    <Tr key={key}>
                      <Td strong>
                        {r.employee.name}
                        <div style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>{r.employee.code || ''}</div>
                      </Td>
                      <Td>
                        <Badge size="sm" t={r.kind === 'REGULARISATION' ? 'info' : r.kind === 'CANCEL' ? 'warning' : 'brand'}>{KIND_LABEL[r.kind]}</Badge>{' '}
                        {r.title}{r.stage ? <span style={{ color: C.muted }}> · {r.stage}</span> : null}
                        {r.reason && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>“{r.reason}”</div>}
                        {r.dates_passed && <div style={{ fontSize: 11, color: C.warning, marginTop: 3 }}>Dates already started or passed</div>}
                      </Td>
                      <Td>{span(r)}</Td>
                      <Td align="right" mono>{r.days}</Td>
                      <Td>
                        {pending
                          ? (r.waiting_on ? r.waiting_on.name : <Badge size="sm" t="critical">Nobody</Badge>)
                          : (r.decided_by || '—')}
                      </Td>
                      {pending && (
                        <Td align="right">
                          <span style={{ color: (r.waiting_days ?? 0) > 2 ? C.warning : C.inkSoft, fontWeight: (r.waiting_days ?? 0) > 2 ? 600 : 400 }}>
                            {r.waiting_days ?? 0}d
                          </span>
                        </Td>
                      )}
                      {pending && (
                        <Td>
                          {r.balance
                            ? <span style={{ color: (r.balance.after ?? 0) < 0 ? C.critical : C.inkSoft }}>{r.balance.label} {r.balance.available} → {r.balance.after}</span>
                            : <span style={{ color: C.faint }}>—</span>}
                        </Td>
                      )}
                      {!pending && (
                        <Td>
                          <Badge size="sm" t={['APPROVED'].includes(r.status) ? 'positive' : 'critical'}>
                            {r.kind === 'CANCEL' ? (r.status === 'APPROVED' ? 'Cancelled' : 'Kept') : r.status === 'APPROVED' ? 'Approved' : 'Declined'}
                          </Badge>
                          {r.remark && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>“{r.remark}”</div>}
                        </Td>
                      )}
                      {pending && canAct && (
                        <Td align="right">
                          {isOpen ? (
                            <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
                              <input value={note} onChange={e => setNote(e.target.value)}
                                placeholder={open?.action === 'decline' ? 'Reason (the employee reads it)' : 'Note (optional)'}
                                style={{ padding: '6px 9px', borderRadius: 7, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: 12, fontFamily: 'inherit' }} />
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <Button size="sm" variant={open?.action === 'decline' ? 'danger' : 'primary'} disabled={busy}
                                  onClick={() => void act(r, open!.action)}>
                                  {busy ? 'Saving…' : open?.action === 'decline' ? 'Decline' : 'Approve'}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setOpen(null); setNote('') }}>Cancel</Button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <Button size="sm" variant="primary" onClick={() => { setOpen({ key, action: 'approve' }); setNote('') }}>Approve</Button>
                              <Button size="sm" variant="secondary" onClick={() => { setOpen({ key, action: 'decline' }); setNote('') }}>Decline</Button>
                            </div>
                          )}
                        </Td>
                      )}
                    </Tr>
                  )
                })}
              </tbody>
            </TableWrap>
          )}
      </Card>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
        Approvers act from ESS → Tasks & Approvals. Use the override here when the approver is away or a request has
        nobody to go to. The employee is told by bell and email, with your name as the decider. A leave approval that
        would overdraw the balance is refused — decline it, or ask the employee to re-apply with the extra days as LWP.
      </div>
    </div>
  )
}
