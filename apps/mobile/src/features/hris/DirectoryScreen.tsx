// Team Directory — components/ess/hris/TeamDirectory.tsx + PersonModal.tsx.
//
// DATA IS THE WEBSITE'S: lib/supabase-ess.ts loadDirectory(), the same select,
// the same order, the same client filter (drop blacklisted, drop a past LWD) and
// the same search (split on , ; newline — ANY term matches). A rejected query
// throws instead of rendering an empty roster. Known web quirk kept: no company
// or employment_status filter, and company_name is loaded but never shown.
import * as React from 'react'
import { FlatList, Linking, Pressable, RefreshControl, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/core/supabase'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Button, Card, Txt, webNoOutline } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { Sheet, SelectSheet } from '@/ui/overlays'
import { IconChevronDown, IconClose } from '@/ui/icons'
import { Ic } from './icons'
import { HueAvatar, NoteBox } from './ui'

export interface DirectoryRow {
  id: string; emp_code: string; full_name: string; designation: string | null
  dept_name: string | null; location_name: string | null; company_name: string | null
  mobile: string | null; office_email: string | null; personal_email: string | null
}

async function loadDirectory(): Promise<DirectoryRow[]> {
  const { data, error } = await supabase.from('employees')
    .select('id, emp_code, full_name, designation, mobile, office_email, personal_email, blacklisted, last_working_date, departments!employees_department_id_fkey(dept_name), locations!location_id(location_name), companies!employees_company_id_fkey(company_name)')
    .order('full_name')
  if (error) throw new Error(error.message)
  const t0 = new Date(); t0.setHours(0, 0, 0, 0)
  return (data || [])
    .filter((e: any) => !e.blacklisted && !(e.last_working_date && new Date(e.last_working_date) < t0))
    .map((e: any) => ({
      id: e.id, emp_code: e.emp_code, full_name: e.full_name, designation: e.designation,
      dept_name: e.departments?.dept_name || null, location_name: e.locations?.location_name || null,
      company_name: e.companies?.company_name || null,
      mobile: e.mobile, office_email: e.office_email, personal_email: e.personal_email,
    }))
}

const waDigits = (m: string | null) => (m || '').replace(/\D/g, '').slice(-10)
const open = (url: string) => { void Linking.openURL(url).catch(() => {}) }

function ContactLink({ k, label, onPress }: { k: 'mail' | 'phone' | 'chat'; label: string; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={4}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: R.sm, borderWidth: 1, borderColor: C.brandEdge, backgroundColor: pressed ? C.brandTint : C.surface })}>
      <Ic k={k} size={15} color={C.brandDeep} />
      <Txt size={F.tiny} w={600} color={C.brandDeep}>{label}</Txt>
    </Pressable>
  )
}

function Contacts({ e, full }: { e: DirectoryRow; full?: boolean }) {
  const digits = waDigits(e.mobile)
  const style = full ? { flex: 1 } : undefined
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
      {!!e.office_email && <View style={style}><ContactLink k="mail" label="Email" onPress={() => open(`mailto:${e.office_email}`)} /></View>}
      {!!e.mobile && <View style={style}><ContactLink k="phone" label="Call" onPress={() => open(`tel:${e.mobile}`)} /></View>}
      {!!digits && <View style={style}><ContactLink k="chat" label="WhatsApp" onPress={() => open(`https://wa.me/91${digits}`)} /></View>}
    </View>
  )
}

function Tag({ label, tone, pin }: { label: string; tone: 'code' | 'dept' | 'loc'; pin?: boolean }) {
  const { C } = useTheme()
  const bg = tone === 'dept' ? C.brandTint : C.sunken
  const fg = tone === 'dept' ? C.brandDeep : tone === 'code' ? C.muted : C.inkSoft
  const edge = tone === 'dept' ? C.brandEdge : C.line
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 9, borderRadius: R.pill, backgroundColor: bg, borderWidth: 1, borderColor: edge, maxWidth: '100%' }}>
      {pin && <Ic k="pin" size={11} color={fg} />}
      <Txt size={11.5} w={600} color={fg} numberOfLines={1}>{label}</Txt>
    </View>
  )
}

function PersonCard({ e, onOpen }: { e: DirectoryRow; onOpen: (e: DirectoryRow) => void }) {
  return (
    <Card onPress={() => onOpen(e)} style={{ marginBottom: S.sm }}>
      <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
        <HueAvatar name={e.full_name} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.body} w={700} numberOfLines={1}>{e.full_name}</Txt>
          <Txt size={F.tiny} tone="muted" numberOfLines={1}>{e.designation || '-'}</Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.md }}>
        <Tag label={e.emp_code} tone="code" />
        {!!e.dept_name && <Tag label={e.dept_name} tone="dept" />}
        {!!e.location_name && <Tag label={e.location_name} tone="loc" pin />}
      </View>
      <View style={{ marginTop: S.md }}><Contacts e={e} /></View>
    </Card>
  )
}

function DRow({ l, v }: { l: string; v: string | null | undefined }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <Txt size={F.small} tone="muted">{l}</Txt>
      <Txt size={F.small} w={600} selectable style={{ flexShrink: 1, textAlign: 'right' }}>{v || '-'}</Txt>
    </View>
  )
}

function PersonSheet({ person, onClose }: { person: DirectoryRow | null; onClose: () => void }) {
  const { C } = useTheme()
  const e = person
  return (
    <Sheet visible={!!e} onClose={onClose}>
      {e && (
        <View accessibilityLabel="Colleague details">
          <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'center', paddingTop: S.sm, paddingBottom: S.md }}>
            <HueAvatar name={e.full_name} size={48} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={16} w={700}>{e.full_name}</Txt>
              <Txt size={F.tiny} tone="muted">{[e.designation, e.emp_code].filter(Boolean).join(' · ') || '-'}</Txt>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} style={{ padding: 8 }}>
              <IconClose size={18} color={C.muted} />
            </Pressable>
          </View>
          <DRow l="Department" v={e.dept_name} />
          <DRow l="Location" v={e.location_name} />
          <DRow l="Office email" v={e.office_email} />
          <DRow l="Mobile" v={e.mobile} />
          <View style={{ marginTop: 14 }}><Contacts e={e} full /></View>
        </View>
      )}
    </Sheet>
  )
}

function FilterButton({ label, onPress, on }: { label: string; onPress: () => void; on: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: R.sm + 1, borderWidth: 1, borderColor: on ? C.brand : C.lineStrong, backgroundColor: pressed ? C.brandTint : C.surface })}>
      <Txt size={F.small} w={on ? 600 : 400} color={on ? C.brandDeep : C.ink} numberOfLines={1} style={{ flex: 1 }}>{label}</Txt>
      <IconChevronDown size={14} color={C.faint} />
    </Pressable>
  )
}

export default function DirectoryScreen() {
  const { C } = useTheme()
  const q = useQuery({ queryKey: ['hris', 'directory'], queryFn: loadDirectory, staleTime: 5 * 60_000 })
  const rows = React.useMemo(() => q.data || [], [q.data])
  const [query, setQuery] = React.useState('')
  const [dept, setDept] = React.useState('')
  const [loc, setLoc] = React.useState('')
  const [pick, setPick] = React.useState<'dept' | 'loc' | null>(null)
  const [openP, setOpenP] = React.useState<DirectoryRow | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  const depts = React.useMemo(() => [...new Set(rows.map(r => r.dept_name).filter(Boolean))].sort() as string[], [rows])
  const locs = React.useMemo(() => [...new Set(rows.map(r => r.location_name).filter(Boolean))].sort() as string[], [rows])
  const filtered = React.useMemo(() => {
    const terms = query.split(/[,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
    return rows.filter(e => {
      if (dept && e.dept_name !== dept) return false
      if (loc && e.location_name !== loc) return false
      if (!terms.length) return true
      return terms.some(t =>
        e.full_name.toLowerCase().includes(t)
        || (e.designation || '').toLowerCase().includes(t)
        || (e.dept_name || '').toLowerCase().includes(t)
        || (e.emp_code || '').toLowerCase().includes(t)
        || (e.location_name || '').toLowerCase().includes(t)
        || (e.office_email || '').toLowerCase().includes(t))
    })
  }, [rows, query, dept, loc])

  const loading = q.isLoading
  const hasFilter = !!(query || dept || loc)
  const count = loading ? 'Loading colleagues…'
    : `${filtered.length}${filtered.length !== rows.length ? ` of ${rows.length}` : ''} colleague${filtered.length === 1 ? '' : 's'}`
  const err = q.error ? ((q.error as Error).message || 'Could not load the directory.') : ''

  const header = (
    <View>
      <Card style={{ marginBottom: S.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.md }}>
          <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: C.brandTint, alignItems: 'center', justifyContent: 'center' }}>
            <Ic k="users" size={20} color={C.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={F.lead} w={700}>Employee Directory</Txt>
            <Txt size={F.tiny} tone="muted">{count}</Txt>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm + 1, paddingHorizontal: S.md, backgroundColor: C.surface }}>
          <Ic k="search" size={16} color={C.faint} />
          <TextInput value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" accessibilityLabel="Search the directory"
            placeholder="Search name, code, designation, department or email" placeholderTextColor={C.faint}
            style={[{ flex: 1, height: 46, fontFamily: FONT[400], fontSize: F.small, color: C.ink }, webNoOutline]} />
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.sm }}>
          <FilterButton label={dept || 'All departments'} on={!!dept} onPress={() => setPick('dept')} />
          <FilterButton label={loc || 'All locations'} on={!!loc} onPress={() => setPick('loc')} />
        </View>
        {hasFilter && (
          <Button title="Clear filters" variant="outline" size="sm" style={{ marginTop: S.sm, alignSelf: 'flex-start' }}
            onPress={() => { setQuery(''); setDept(''); setLoc('') }} />
        )}
      </Card>
      {!!err && <NoteBox tone="d" style={{ marginBottom: S.md }}>{err}</NoteBox>}
      {loading && Array.from({ length: 6 }, (_, i) => (
        <Card key={i} style={{ marginBottom: S.sm }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.sunken }} />
            <View style={{ flex: 1, gap: 8 }}>
              <View style={{ height: 12, width: '60%', borderRadius: 6, backgroundColor: C.sunken }} />
              <View style={{ height: 9, width: '42%', borderRadius: 5, backgroundColor: C.sunken }} />
            </View>
          </View>
        </Card>
      ))}
      {!loading && !err && filtered.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: S.xxl, gap: S.sm }}>
          <Ic k="search" size={28} color={C.faint} sw={1.5} />
          <Txt size={F.lead} w={600} center>No colleagues match that search</Txt>
          <Txt size={F.small} tone="muted" center>Try a different name, code or department{(dept || loc) ? ', or clear the filters' : ''}.</Txt>
        </View>
      )}
    </View>
  )

  return (
    <Screen title="Team Directory" subtitle="HR Services" scroll={false} padded={false}>
      <FlatList
        data={err ? [] : loading ? [] : filtered}
        keyExtractor={e => e.id}
        renderItem={({ item }) => <PersonCard e={item} onOpen={setOpenP} />}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl }}
        initialNumToRender={12}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.brand} colors={[C.brand]}
          onRefresh={async () => { setRefreshing(true); try { await q.refetch() } finally { setRefreshing(false) } }} />}
      />
      <SelectSheet visible={pick === 'dept'} onClose={() => setPick(null)} title="Department" value={dept}
        options={[{ value: '', label: 'All departments' }, ...depts.map(d => ({ value: d, label: d }))]} onPick={setDept} />
      <SelectSheet visible={pick === 'loc'} onClose={() => setPick(null)} title="Location" value={loc}
        options={[{ value: '', label: 'All locations' }, ...locs.map(l => ({ value: l, label: l }))]} onPick={setLoc} />
      <PersonSheet person={openP} onClose={() => setOpenP(null)} />
    </Screen>
  )
}
