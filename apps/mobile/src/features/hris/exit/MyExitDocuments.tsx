// The employee's own clearance & settlement — ExitFnf.tsx MyExitDocuments, under
// the Exit screen: the five departments' clearance status and, once the F&F is
// approved, the net, the statement and the letters to download (spec §6, §12.2).
// GET /api/exit/fnf?resignation_id= and /api/exit/clearance?resignation_id=; each
// failure is silent (nothing to show), as on the website.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { F, S } from '@/ui/theme'
import { Button, Card, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errMsg, Pill } from '../ui'
import { DEPTS, DEPT_SHORT, pillOf, rs, SIGNOFF } from './ClearanceInbox'
import { openAuthedPdf } from './pdf'

export function MyExitDocuments({ employeeId, resignationId }: { employeeId: string; resignationId: string | null | undefined }) {
  const { notify } = useOverlay()
  const [opening, setOpening] = React.useState('')
  const fq = useQuery({
    queryKey: ['hris', 'exit-fnf', resignationId],
    queryFn: () => api<any>('/api/exit/fnf', { query: { resignation_id: resignationId! }, employeeId }).catch(() => null),
    enabled: !!resignationId && !!employeeId,
  })
  const cq = useQuery({
    queryKey: ['hris', 'exit-clearance', resignationId],
    queryFn: () => api<any>('/api/exit/clearance', { query: { resignation_id: resignationId! }, employeeId }).then(x => (x?.rows || []) as any[]).catch(() => [] as any[]),
    enabled: !!resignationId && !!employeeId,
  })
  const d = fq.data
  const clr = cq.data || []
  if (!resignationId || (!clr.length && !d?.fnf)) return null

  async function download(l: { kind: string; label: string }) {
    setOpening(l.kind)
    try { await openAuthedPdf('/api/exit/letters', { resignation_id: resignationId!, kind: l.kind }, employeeId, `${l.label}.pdf`) }
    catch (e) { notify(errMsg(e), 'error') }
    setOpening('')
  }

  return (
    <Card style={{ marginTop: S.md }}>
      <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>Clearance & settlement</Txt>
      {clr.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {DEPTS.map(dep => {
            const c = clr.find(r => r.dept === dep)
            return <Pill key={dep} tone={pillOf(c?.status)} label={`${DEPT_SHORT[dep]}: ${c ? (c.status === 'CLEARED_WITH_DUES' ? `Dues ${rs(c.recovery)}` : SIGNOFF[c.status]) : '—'}`} />
          })}
        </View>
      )}
      {!!d?.fnf && (
        <Txt size={F.small} style={{ marginBottom: 10 }}>Full & Final: <Txt size={F.small} w={700}>{rs(d.fnf.net_payable)}</Txt> · {d.fnf.status === 'PAID' ? `paid (${d.fnf.paid_ref})` : 'approved, payment in progress'}</Txt>
      )}
      {(d?.letters || []).length > 0 && (
        <View style={{ gap: S.sm }}>
          {d.letters.map((l: any) => (
            <Button key={l.kind} title={opening === l.kind ? 'Opening…' : `Download ${l.label}`} variant="outline" size="sm" disabled={!!opening} onPress={() => void download(l)} full />
          ))}
        </View>
      )}
    </Card>
  )
}
