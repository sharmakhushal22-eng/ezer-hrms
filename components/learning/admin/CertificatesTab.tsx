'use client'
// components/learning/admin/CertificatesTab.tsx — every certificate issued, and revoking one.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Badge, Button, C, Empty, F, Field, IconAward, S, SkeletonRows, TableWrap, Td, Th, Tr, numeric, type Tone } from '@/lib/ui'
import { ActionNotes, Hint, LoadError, SearchBox, TextInput, day, row, stack, useAction, useLoad, withCompany, type Ctx } from './shared'

function stateOf(c: any): { label: string; t: Tone } {
  if (c.revoked_at) return { label: 'Revoked', t: 'critical' }
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return { label: 'Expired', t: 'warning' }
  return { label: 'Valid', t: 'positive' }
}

function RevokeRow({ c, cols, busy, onRevoke, onClose }: { c: any; cols: number; busy: boolean; onRevoke: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <tr>
      <td colSpan={cols} style={{ padding: S.md, background: C.criticalTint, borderBottom: `1px solid ${C.line}` }}>
        <div style={stack(S.sm)}>
          <Hint>Anyone who checks {c.cert_no} will see it has been revoked. This cannot be undone.</Hint>
          <div style={{ ...row(), alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 320px' }}><Field label="Why it is being revoked" required><TextInput autoFocus value={reason} onChange={e => setReason(e.target.value)} /></Field></div>
            <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => onRevoke(reason.trim())}>Revoke certificate</Button>
            <Button variant="ghost" onClick={onClose}>Keep it</Button>
          </div>
        </div>
      </td>
    </tr>
  )
}

export default function CertificatesTab({ ctx }: { ctx: Ctx }) {
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/certificates')), [ctx.company])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const a = useAction()
  const all: any[] = useMemo(() => list.data?.certificates || [], [list.data])
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? all.filter(c => `${c.cert_no} ${c.recipient_name} ${c.title}`.toLowerCase().includes(t)) : all
  }, [all, q])
  const canRevoke = ctx.caps.publish
  const cols = canRevoke ? 8 : 7
  const revoke = async (id: string, reason: string) => {
    if (await a.run(() => lmsApi('/api/lms/admin/certificates', { id, reason }), 'Certificate revoked.')) { setOpen(null); list.reload() }
  }
  return (
    <>
      <LoadError error={list.error} setup={list.setup} />
      <ActionNotes a={a} />
      <div style={{ ...row(), justifyContent: 'space-between', marginBottom: S.md }}>
        <SearchBox value={q} onChange={setQ} placeholder="Number, name or course" />
        <Hint>{all.length === 500 ? 'The latest 500 certificates.' : `${all.length} certificates`}</Hint>
      </div>
      {list.loading && !list.data ? <SkeletonRows /> : rows.length ? (
        <TableWrap minWidth={860} stagger={false}>
          <thead><tr><Th>Number</Th><Th>Person</Th><Th>Title</Th><Th align="right">Score</Th><Th>Issued</Th><Th>Valid until</Th><Th>Status</Th>{canRevoke && <Th />}</tr></thead>
          <tbody>
            {rows.flatMap(c => {
              const s = stateOf(c)
              const line = (
                <Tr key={c.id}>
                  <Td mono style={{ whiteSpace: 'nowrap' }}>{c.cert_no}</Td><Td strong>{c.recipient_name}</Td><Td>{c.title}</Td>
                  <Td align="right">{c.score_pct != null ? `${Number(c.score_pct)}%` : '-'}</Td>
                  <Td style={{ whiteSpace: 'nowrap', ...numeric }}>{day(c.issued_at)}</Td><Td style={{ whiteSpace: 'nowrap', ...numeric }}>{c.expires_at ? day(c.expires_at) : 'No expiry'}</Td>
                  <Td><Badge t={s.t} size="sm">{s.label}</Badge>{c.revoke_reason && <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2 }}>{c.revoke_reason}</div>}</Td>
                  {canRevoke && <Td align="right">{!c.revoked_at && <Button size="sm" variant="danger" onClick={() => setOpen(open === c.id ? null : c.id)}>Revoke</Button>}</Td>}
                </Tr>
              )
              return open === c.id ? [line, <RevokeRow key={`${c.id}-x`} c={c} cols={cols} busy={a.busy} onClose={() => setOpen(null)} onRevoke={r => revoke(c.id, r)} />] : [line]
            })}
          </tbody>
        </TableWrap>
      ) : <Empty icon={<IconAward size={22} />} title={all.length ? 'Nothing matches that search' : 'No certificates yet'} hint={all.length ? undefined : 'Certificates are issued automatically when someone completes a course.'} />}
    </>
  )
}
