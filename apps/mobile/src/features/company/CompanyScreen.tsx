// Company — components/ess/RoleTabs.tsx CompanySection.
// GET /api/ess/company. Gate: menu.can.company decides whether the section is
// listed; the server decides whether it opens — a 403 ("You do not hold a role
// that opens this.") shows as the website's red note. Tables become row cards on
// a phone, every column kept. No export, no filters, no charts — as the website.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { errMsg, KpiGrid, LoadingLine, NoteBox, Pill, SectionTitle } from '@/features/hris/ui'

interface CompanyData {
  fy: string; quarter_from: string
  kpis: { label: string; value: number }[]
  departments: { dept: string; headcount: number; open_exits: number; push: number }[]
  reasons: { category: string; reason: string; exits: number; regrettable: number; concentration: string }[]
  attrition_note: string | null
  regime: { regime: string; employees: number; costlier: number }[]
  regime_note: string | null
}

function KV({ k, v, color, bold }: { k: string; v: React.ReactNode; color?: string; bold?: boolean }) {
  return (
    <View style={{ flexBasis: '30%', flexGrow: 1 }}>
      <Txt size={10} w={700} tone="muted" upper>{k}</Txt>
      {typeof v === 'string' || typeof v === 'number' ? <Txt size={F.small} w={bold ? 700 : 500} color={color}>{v}</Txt> : v}
    </View>
  )
}
function RowCard({ title, children, first }: { title: React.ReactNode; children: React.ReactNode; first?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      {typeof title === 'string' ? <Txt size={F.small} w={700} style={{ marginBottom: 6 }}>{title}</Txt> : title}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{children}</View>
    </View>
  )
}

export default function CompanyScreen() {
  const { C } = useTheme()
  const employeeId = useEmployeeId()
  const q = useQuery({ queryKey: ['company', employeeId], queryFn: () => api<CompanyData>('/api/ess/company', { employeeId }), enabled: !!employeeId })
  const d = q.data
  let body: React.ReactNode
  if (q.error) body = <NoteBox tone="d">{errMsg(q.error)}</NoteBox>
  else if (!d) body = <LoadingLine />
  else body = (
    <>
      <KpiGrid items={d.kpis.map(k => ({ k: k.label, v: k.value }))} />
      <Card style={{ marginBottom: S.md }}>
        <SectionTitle>Headcount by department</SectionTitle>
        {d.departments.map((x, i) => (
          <RowCard key={x.dept} title={x.dept} first={i === 0}>
            <KV k="Headcount" v={x.headcount} />
            <KV k="Open exits" v={x.open_exits || '-'} />
            <KV k="Push-reason" v={x.push || '-'} color={x.push ? C.critical : undefined} bold={!!x.push} />
          </RowCard>
        ))}
      </Card>
      <Card style={{ marginBottom: S.md }}>
        <SectionTitle>Why people are leaving, this quarter</SectionTitle>
        {d.reasons.length === 0 && <Txt size={12.5} tone="muted">No exits recorded with a reason this quarter.</Txt>}
        {d.reasons.map((x, i) => (
          <RowCard key={x.category + x.reason} first={i === 0}
            title={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Pill tone={x.category === 'PUSH' ? 'dang' : x.category === 'PULL' ? 'info' : 'mut'} label={x.category} />
              <Txt size={F.small} w={700} style={{ flex: 1 }}>{x.reason}</Txt>
            </View>}>
            <KV k="Exits" v={x.exits} />
            <KV k="Regrettable" v={x.regrettable} />
            <View style={{ flexBasis: '100%' }}>
              <Txt size={10} w={700} tone="muted" upper>Concentration</Txt>
              <Txt size={F.tiny} tone="muted">{x.concentration || '-'}</Txt>
            </View>
          </RowCard>
        ))}
        {!!d.attrition_note && (
          <NoteBox tone="d" style={{ marginTop: 10 }}>
            <Txt size={F.tiny} tone="critical" style={{ lineHeight: 19 }}>
              <Txt size={F.tiny} w={700} tone="critical">{d.attrition_note.split('.')[0]}.</Txt>{d.attrition_note.split('.').slice(1).join('.')}
            </Txt>
          </NoteBox>
        )}
      </Card>
      <Card>
        <SectionTitle>{`Regime election: FY ${d.fy}`}</SectionTitle>
        {d.regime.map((x, i) => (
          <RowCard key={x.regime} title={x.regime} first={i === 0}>
            <KV k="Employees" v={x.employees} />
            <KV k="Costlier for how many" v={x.costlier} color={x.costlier ? C.warning : undefined} />
          </RowCard>
        ))}
        {!!d.regime_note && <NoteBox tone="w" style={{ marginTop: 10 }}>{d.regime_note}</NoteBox>}
      </Card>
    </>
  )
  return <Screen title="Company" subtitle="Headcount, attrition and tax-regime trends across the company" onRefresh={() => q.refetch()}>{body}</Screen>
}
