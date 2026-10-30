// src/features/social/wall/AdminConsole.tsx — "Manage the wall"
// (components/wall/AdminConsole.tsx).
//
// THE WEBSITE SHOWS THIS PANEL TO EVERY EMPLOYEE. Somebody without a grant sees
// each of the six areas locked, with the database's own sentence saying why
// (wof_explain_access). That denial state is what an ordinary ESS employee sees,
// so it is built here exactly. The gate calls are the website's direct
// Supabase RPCs, verbatim and sequential.
//
// ADMIN-ONLY WRITES ARE NOT IN THE APP. The Screens area's manager (add a TV,
// new pair code, activate/deactivate, remove) only opens for a holder of
// wof.board.manage; on the phone that area shows the board_screens list
// read-only, using the table definition the web file carries for it. Every
// other area is read-only on the website too.
import * as React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { supabase } from '@/core/supabase'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Icon, Pill, RAD, Skeleton, WEmpty, WNotice, type IconName } from './ui'

const gone = (e: unknown) =>
  (e as { code?: string } | null)?.code === 'PGRST205' ||
  /PGRST205|does not exist|could not find/i.test(String((e as { message?: string } | null)?.message ?? ''))

const AREAS = [
  { k: 'awards', label: 'Awards', perm: 'wof.configure', icon: 'trophy', blurb: 'What can be won, who may nominate, and how often' },
  { k: 'values', label: 'Company values', perm: 'wof.configure', icon: 'heart', blurb: 'The values a shoutout can be tagged against' },
  { k: 'badges', label: 'Badges', perm: 'wof.badge.manage', icon: 'medal', blurb: 'Shapes, glyphs and the rules that unlock them' },
  { k: 'screens', label: 'Screens', perm: 'wof.board.manage', icon: 'tv', blurb: 'Televisions on the wall, and their pair codes' },
  { k: 'admins', label: 'Administrators', perm: 'wof.admin.grant', icon: 'users', blurb: 'Who may change any of this, and why they were granted it' },
  { k: 'audit', label: 'Audit', perm: 'wof.report.view', icon: 'clock', blurb: 'Every configuration change, who made it and when' },
] as const satisfies readonly { k: string; label: string; perm: string; icon: IconName; blurb: string }[]
type AreaKey = (typeof AREAS)[number]['k']
type Cell = string | number | null

const HEADS: Record<AreaKey, string[]> = {
  awards: ['Award', 'Cadence', 'Status'], values: ['Value', 'Code', 'Status'], badges: ['Badge', 'Shape', 'Tier', 'Status'],
  screens: ['Screen', 'Pair code', 'Rotates', 'Status'], admins: ['Level', 'Why they were granted it', 'Status'], audit: ['Action', 'Entity', 'When'],
}
const STATUS_COL: Partial<Record<AreaKey, number>> = { awards: 2, values: 2, badges: 3, screens: 3, admins: 2 }
const EMPTY: Record<AreaKey, string> = {
  awards: 'No awards yet. Your Wall Owner adds the first one.',
  values: 'No values yet. A values programme is optional.',
  badges: 'No badges yet. Service milestones generate their own.',
  screens: 'No screens paired. Add one to put the wall on a television.',
  admins: 'Only the Wall Owner, so far.',
  audit: 'Nothing changed yet.',
}
const QUERY: Record<AreaKey, [string, string, (r: Record<string, unknown>) => Cell[]]> = {
  awards: ['recognition_awards', 'name, frequency, is_active', r => [r.name as string, r.frequency as string, r.is_active ? 'active' : 'off']],
  values: ['recognition_values', 'label, code, is_active', r => [r.label as string, r.code as string, r.is_active ? 'active' : 'off']],
  badges: ['badge_master', 'label, shape, base_tier, is_active', r => [r.label as string, r.shape as string, r.base_tier as string, r.is_active ? 'active' : 'off']],
  screens: ['board_screens', 'screen_name, pair_code, rotate_seconds, is_active', r => [r.screen_name as string, r.pair_code as string, `${r.rotate_seconds}s`, r.is_active ? 'active' : 'off']],
  admins: ['wall_admins', 'employee_id, admin_level, grant_reason, is_active', r => [r.admin_level as string, r.grant_reason as string, r.is_active ? 'active' : 'revoked']],
  audit: ['wall_audit_log', 'action, entity, created_at', r => [r.action as string, r.entity as string, r.created_at ? new Date(r.created_at as string).toLocaleString('en-IN') : '-']],
}

function NavItem({ label, icon, on, locked, onPress }: { label: string; icon: IconName; on: boolean; locked: boolean; onPress: () => void }) {
  const { C } = useTheme()
  const fg = on ? C.brand : locked ? C.faint : C.inkSoft
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 9, paddingHorizontal: 11, borderRadius: RAD.control, backgroundColor: on ? C.brandTint : pressed ? C.surface : 'transparent' })}>
      <Icon name={icon} size={16} color={fg} />
      <Txt size={F.small} w={on ? 700 : 600} color={fg} style={{ flex: 1 }}>{label}</Txt>
      {locked && <View accessibilityLabel="Locked"><Icon name="lock" size={13} color={C.faint} /></View>}
    </Pressable>
  )
}

function AreaHeader({ label, blurb, icon, right }: { label: string; blurb: string; icon: IconName; right?: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Icon name={icon} size={20} color={C.brand} />
        <View style={{ flex: 1 }}>
          <Txt size={F.body} w={700}>{label}</Txt>
          <Txt size={F.micro} tone="muted" style={{ marginTop: 1 }}>{blurb}</Txt>
        </View>
      </View>
      {right}
    </View>
  )
}

function Locked({ label, blurb, icon, reason }: { label: string; blurb: string; icon: IconName; reason: string }) {
  const { C } = useTheme()
  return (
    <View>
      <AreaHeader label={label} blurb={blurb} icon={icon} right={<Pill tone="neutral" icon="lock">Locked</Pill>} />
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', padding: 12, borderRadius: RAD.tile, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
        <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }}>
          <Icon name="lock" size={17} color={C.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={F.small} w={700}>You can’t open this yet</Txt>
          <Txt size={F.small} tone="soft" style={{ marginTop: 4, lineHeight: 21 }}>{reason}</Txt>
        </View>
      </View>
    </View>
  )
}

function Table({ head, rows, empty, statusCol }: { head: string[]; rows: Cell[][]; empty: string; statusCol?: number }) {
  const { C } = useTheme()
  if (!rows.length) return <WEmpty icon="list" compact>{empty}</WEmpty>
  const colW = 150
  return (
    <ScrollView horizontal nestedScrollEnabled style={{ borderWidth: 1, borderColor: C.line, borderRadius: RAD.tile }}>
      <View style={{ minWidth: Math.max(440, head.length * colW) }}>
        <View style={{ flexDirection: 'row', backgroundColor: C.sunken, borderBottomWidth: 1, borderBottomColor: C.line }}>
          {head.map((h, i) => <Txt key={i} size={F.micro} w={700} tone="muted" style={{ width: colW, paddingVertical: 9, paddingHorizontal: 12 }}>{h}</Txt>)}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: ri ? 1 : 0, borderTopColor: C.line }}>
            {r.map((c, i) => (
              <View key={i} style={{ width: colW, paddingVertical: 10, paddingHorizontal: 12 }}>
                {i === statusCol && typeof c === 'string'
                  ? <Pill tone={c === 'active' ? 'positive' : 'neutral'}>{c}</Pill>
                  : <Txt size={F.small} w={i === 0 ? 600 : 400} color={i === 0 ? C.ink : C.inkSoft}>{c ?? '-'}</Txt>}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

export function AdminConsole({ employeeId }: { employeeId: string }) {
  const { C } = useTheme()
  const [area, setArea] = React.useState<AreaKey>('awards')
  const [ready, setReady] = React.useState<boolean | null>(null)
  const [allowed, setAllowed] = React.useState<Record<string, boolean>>({})
  const [reasons, setReasons] = React.useState<Record<string, string>>({})
  const [rows, setRows] = React.useState<Cell[][]>([])
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    let live = true
    ;(async () => {
      const probe = await supabase.from('wall_config').select('module_enabled').limit(1)
      if (!live) return
      if (probe.error) {
        if (gone(probe.error)) { setReady(false); return }
        setErr(probe.error.message); setReady(false); return
      }
      setReady(true)
      const perms = [...new Set(AREAS.map(a => a.perm))]
      const can: Record<string, boolean> = {}
      const why: Record<string, string> = {}
      for (const p of perms) {
        const c = await supabase.rpc('wof_can', { p_employee: employeeId, p_permission: p, p_company: null, p_branch: null })
        can[p] = c.data === true
        if (!can[p]) {
          const e = await supabase.rpc('wof_explain_access', { p_employee: employeeId, p_permission: p, p_company: null })
          why[p] = (e.data as string) ?? 'You do not have access to this.'
        }
      }
      if (live) { setAllowed(can); setReasons(why) }
    })()
    return () => { live = false }
  }, [employeeId])

  const current = AREAS.find(a => a.k === area)!
  const may = allowed[current.perm] === true

  React.useEffect(() => {
    let live = true
    ;(async () => {
      if (!may) { setRows([]); return }
      const q = QUERY[area]
      const meRow = await supabase.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
      const companyId = (meRow.data as { company_id?: string } | null)?.company_id ?? null
      let query = supabase.from(q[0]).select(q[1]).limit(100)
      query = companyId ? query.eq('company_id', companyId) : query.limit(0)
      const res = await query
      if (!live) return
      if (res.error) { setRows([]); return }
      setRows(((res.data ?? []) as unknown as Record<string, unknown>[]).map(q[2]))
    })()
    return () => { live = false }
  }, [area, may, employeeId])

  if (ready === null) return <Skeleton lines={4} />
  if (ready === false) {
    return (
      <WNotice tone="warning" title="The Wall of Fame is not installed yet">
        {err ?? 'Migrations 082 and 084–087 are written and handed over but not applied to this database. Once they run, EZER switches the module on for your company and your HR team names a Wall Owner. Nothing after that needs SQL.'}
      </WNotice>
    )
  }
  const openCount = AREAS.filter(a => allowed[a.perm] === true).length
  return (
    <View style={{ gap: 16 }}>
      <View accessibilityLabel="Wall settings">
        <View style={{ gap: 2, padding: 6, borderRadius: RAD.tile, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
          {AREAS.map(a => <NavItem key={a.k} label={a.label} icon={a.icon} on={a.k === area} locked={allowed[a.perm] === false} onPress={() => setArea(a.k)} />)}
        </View>
        <Txt size={F.micro} tone="faint" style={{ marginTop: 8, paddingLeft: 6 }}>You can open {openCount} of {AREAS.length}</Txt>
      </View>
      <View>
        {may ? (
          <View>
            <AreaHeader label={current.label} blurb={current.blurb} icon={current.icon} right={<Pill tone="neutral" icon="eye">Read-only</Pill>} />
            <Table head={HEADS[area]} rows={rows} empty={EMPTY[area]} statusCol={STATUS_COL[area]} />
            <Txt size={F.micro} tone="faint" style={{ marginTop: 12, lineHeight: 16 }}>
              Read-only in this build. Changing configuration needs a server route that proves who is asking, because the database rejects an unidentified write.
            </Txt>
          </View>
        ) : (
          <Locked label={current.label} blurb={current.blurb} icon={current.icon} reason={reasons[current.perm] ?? 'You do not have access to this.'} />
        )}
      </View>
    </View>
  )
}
