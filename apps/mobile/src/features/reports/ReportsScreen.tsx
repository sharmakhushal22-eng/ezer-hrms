// Reports — components/ess/RoleTabs.tsx ReportsSection.
// GET /api/ess/reports for the list; GET ?report={key} to Open (first 500 rows,
// as the website) or to Export CSV (fetched again, every row, shared as a file).
// A 403 shows the website's red note. Each row of the wide table is a phone card:
// the first column as its title, every other column as a label / value pair.
import * as React from 'react'
import { FlatList, RefreshControl, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { errMsg, NoteBox, SectionTitle } from '@/features/hris/ui'
import { shareCsv } from './csv'

interface ReportData { key: string; title: string; columns: string[]; rows: (string | number | null)[][] }
const cell = (v: any) => (typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? '-'))

function RowCard({ columns, row }: { columns: string[]; row: (string | number | null)[] }) {
  const { C } = useTheme()
  return (
    <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: 12, marginBottom: 8 }}>
      <Txt size={10} w={700} tone="muted" upper>{columns[0]}</Txt>
      <Txt size={F.small} w={700} style={{ marginBottom: 6 }}>{cell(row[0])}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6 }}>
        {columns.slice(1).map((c, j) => (
          <View key={c} style={{ flexBasis: '46%', flexGrow: 1 }}>
            <Txt size={10} w={700} tone="muted" upper>{c}</Txt>
            <Txt size={12.5} w={500} style={typeof row[j + 1] === 'number' ? { fontVariant: ['tabular-nums'] } : undefined}>{cell(row[j + 1])}</Txt>
          </View>
        ))}
      </View>
    </View>
  )
}

export default function ReportsScreen() {
  const { C } = useTheme()
  const employeeId = useEmployeeId()
  const list = useQuery({
    queryKey: ['reports', 'list', employeeId],
    queryFn: () => api<{ reports?: { key: string; title: string; desc: string }[] }>('/api/ess/reports', { employeeId }).then(d => d.reports || []),
    enabled: !!employeeId,
  })
  const [open, setOpen] = React.useState<ReportData | null>(null)
  const [busy, setBusy] = React.useState('')
  const [err, setErr] = React.useState('')
  const [refreshing, setRefreshing] = React.useState(false)
  const shownErr = err || (list.error ? errMsg(list.error) : '')

  async function run(key: string, download = false) {
    setBusy(key); setErr('')
    try {
      const d = await api<Omit<ReportData, 'key'>>('/api/ess/reports', { query: { report: key }, employeeId })
      if (download) await shareCsv(d.title, d.columns, d.rows)
      else setOpen({ key, ...d })
    } catch (e) { setErr(errMsg(e)) } finally { setBusy('') }
  }

  const header = (
    <View>
      {!!shownErr && <NoteBox tone="d" style={{ marginBottom: S.md }}>{shownErr}</NoteBox>}
      <Card style={{ marginBottom: S.md }}>
        <SectionTitle>Reports</SectionTitle>
        {(list.data || []).map(r => (
          <View key={r.key} style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: 12, marginBottom: 8, gap: 8 }}>
            <View>
              <Txt size={13.5} w={700}>{r.title}</Txt>
              <Txt size={F.tiny} tone="muted">{r.desc}</Txt>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Button title={busy === r.key ? '…' : 'Open'} size="sm" variant="outline" disabled={!!busy} onPress={() => void run(r.key)} style={{ flex: 1 }} />
              <Button title="Export CSV" size="sm" variant="outline" disabled={!!busy} onPress={() => void run(r.key, true)} style={{ flex: 1 }} />
            </View>
          </View>
        ))}
      </Card>
      {open && (
        <Card padded={false} style={{ padding: S.md, marginBottom: S.sm }}>
          <SectionTitle style={{ marginBottom: 0 }} right={<Button title="Close" size="sm" variant="outline" onPress={() => setOpen(null)} />}>
            {`${open.title} · ${open.rows.length} rows`}
          </SectionTitle>
        </Card>
      )}
    </View>
  )
  const footer = open && open.rows.length > 500
    ? <NoteBox style={{ marginTop: S.sm }}>Showing the first 500 rows. Export CSV for everything.</NoteBox>
    : null

  return (
    <Screen title="Reports" subtitle="Attrition, regime comparison, declaration status, TDS register, span of control" scroll={false} padded={false}>
      <FlatList
        data={open ? open.rows.slice(0, 500) : []}
        keyExtractor={(_, i) => `${open?.key}:${i}`}
        renderItem={({ item }) => <RowCard columns={open!.columns} row={item} />}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl }}
        initialNumToRender={10}
        windowSize={7}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.brand} colors={[C.brand]}
          onRefresh={async () => { setRefreshing(true); setErr(''); try { await list.refetch() } finally { setRefreshing(false) } }} />}
      />
    </Screen>
  )
}
