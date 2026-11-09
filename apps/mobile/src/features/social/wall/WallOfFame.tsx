// src/features/social/wall/WallOfFame.tsx — the Wall of Fame, first tab of Social
// (components/ess/WallOfFame.tsx).
//
// Same reads in the same order as the website: the wall_config probe, the feed
// through the wall route (get_company_feed), then awards, winners, the
// leaderboard view and my badges straight from Supabase with the anon client.
// Errors from the last four are swallowed, as on the web: the section stays empty.
//
// Phone layout: one column. Hero → composer (when open, so "Open below" is
// directly below) → spotlight → jump bar →
// feed → most recognised → hall of legends → my badges → manage the wall.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/core/supabase'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { wallRpc } from './rpc'
import { FilterChips, GroupLabel, Icon, JumpBar, Panel, Skeleton, WButton, WEmpty, WNotice, type IconName } from './ui'
import { FeedCard, isAward, type FeedRow } from './FeedCard'
import { HallOfLegends, Leaderboard, Spotlight, type LeaderRow, type Winner } from './Spotlight'
import { BadgeCabinet, type MyBadge } from './Badge'
import { AdminConsole } from './AdminConsole'
import { AppreciationComposer, ShoutoutComposer } from './composerSlot'

const missing = (e: unknown) =>
  (e as { code?: string } | null)?.code === 'PGRST205' ||
  /PGRST205|does not exist/i.test(String((e as { message?: string } | null)?.message ?? ''))

type Mode = null | 'shoutout' | 'note'
type FeedFilter = 'all' | 'shoutout' | 'award'

function bucketOf(iso: string | null): string {
  if (!iso) return 'Earlier'
  const d = new Date(iso); const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 864e5)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'This week'
  if (diff < 31) return 'This month'
  return 'Earlier'
}

const JUMPS: { k: string; label: string; icon: IconName }[] = [
  { k: 'feed', label: 'Feed', icon: 'megaphone' },
  { k: 'leaders', label: 'Most recognised', icon: 'list' },
  { k: 'legends', label: 'Legends', icon: 'trophy' },
  { k: 'badges', label: 'My badges', icon: 'medal' },
  { k: 'manage', label: 'Manage', icon: 'shield' },
]

interface WallData {
  ready: boolean; err: string | null; boardOn: boolean
  feed: FeedRow[]; winner: Winner | null; legends: Winner[]; board: LeaderRow[]; badges: MyBadge[]
}

async function loadWall(employeeId: string): Promise<WallData> {
  const out: WallData = { ready: false, err: null, boardOn: true, feed: [], winner: null, legends: [], board: [], badges: [] }
  const probe = await supabase.from('wall_config').select('module_enabled, leaderboard_enabled').limit(1)
  if (probe.error) {
    if (!missing(probe.error)) out.err = probe.error.message
    return out
  }
  out.ready = true
  const cfg = (probe.data ?? [])[0] as { leaderboard_enabled?: boolean } | undefined
  out.boardOn = cfg?.leaderboard_enabled !== false

  const f = await wallRpc('get_company_feed', { p_scope: 'company', p_limit: 20 }, employeeId)
  if (!f.error) out.feed = (f.data ?? []) as unknown as FeedRow[]

  const aw = await supabase.from('recognitions')
    .select('id, message, cycle_label, published_at, receiver_employee_ids, recognition_awards(name)')
    .eq('kind', 'award').eq('is_archived', false)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false }).limit(12)
  if (!aw.error) {
    const rows = (aw.data ?? []) as unknown as (Record<string, unknown> & { recognition_awards?: { name?: string } | null })[]
    const ids = [...new Set(rows.flatMap(r => (r.receiver_employee_ids as string[]) ?? []))]
    const who = ids.length
      ? await supabase.from('employees').select('id, full_name, designation, date_of_leaving').in('id', ids)
      : { data: [], error: null }
    const byId = new Map(((who.data ?? []) as unknown as { id: string; full_name: string; designation: string | null; date_of_leaving: string | null }[]).map(e => [e.id, e]))
    const all = rows.map((r): Winner | null => {
      const first = ((r.receiver_employee_ids as string[]) ?? [])[0]
      const e = first ? byId.get(first) : undefined
      if (!e) return null
      return {
        id: String(r.id), name: e.full_name, designation: e.designation,
        awardName: r.recognition_awards?.name ?? 'Award',
        cycleLabel: (r.cycle_label as string) ?? null, message: (r.message as string) ?? null,
        publishedAt: (r.published_at as string) ?? null, hasLeft: Boolean(e.date_of_leaving),
      }
    }).filter(Boolean) as Winner[]
    out.winner = all.find(w => !w.hasLeft) ?? null
    out.legends = all.slice(1)
  }

  const lb = await supabase.from('v_wall_leaderboard')
    .select('employee_id, full_name, designation, recognition_count, points')
    .order('recognition_count', { ascending: false }).limit(5)
  if (!lb.error) {
    out.board = ((lb.data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
      employeeId: String(r.employee_id), name: String(r.full_name), designation: (r.designation as string) ?? null,
      recognitionCount: Number(r.recognition_count) || 0, points: (r.points as number) ?? null,
    }))
  }

  const b = await supabase.from('employee_badges')
    .select('badge_code, earned_count, tier, progress_pct, last_earned_on, badge_master(label, glyph, shape)')
    .eq('employee_id', employeeId).limit(60)
  if (!b.error) {
    const rows = (b.data ?? []) as unknown as (Record<string, unknown> & { badge_master?: { label?: string; glyph?: string; shape?: string } | null })[]
    out.badges = rows.map(r => ({
      badge_code: String(r.badge_code), label: r.badge_master?.label ?? String(r.badge_code),
      glyph: r.badge_master?.glyph ?? null, shape: r.badge_master?.shape ?? null, tier: (r.tier as string) ?? null,
      earned_count: (r.earned_count as number) ?? 0, progress_pct: (r.progress_pct as number) ?? 0, earned_at: (r.last_earned_on as string) ?? null,
    }))
  }
  return out
}

// ── module-level pieces ──────────────────────────────────────────────────

function Pending() {
  return (
    <WNotice tone="warning" title="The Wall of Fame is not switched on yet">
      <View style={{ gap: 8 }}>
        <Txt size={F.small} tone="soft" style={{ lineHeight: 20 }}>The screens are built and waiting. The tables they read come from migrations 082 and 084–087, which are written and handed over but not applied to this database yet. Nothing here is broken.</Txt>
        <Txt size={F.small} tone="muted" style={{ lineHeight: 20 }}>Once they are applied, EZER switches the module on for your company and your HR team picks a Wall Owner. Everything after that happens without any more SQL.</Txt>
      </View>
    </WNotice>
  )
}

function Launcher({ icon, title, text, on, onPress }: { icon: IconName; title: string; text: string; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded: on }}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1.5, borderColor: on ? C.brand : pressed ? C.brandEdge : C.line, backgroundColor: on || pressed ? C.brandTint : C.surface })}>
      <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.brand : C.brandTint }}>
        <Icon name={icon} size={20} color={on ? C.onAccent : C.brand} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.body} w={700} color={on ? C.brand : C.ink}>{title}</Txt>
        <Txt size={F.micro} tone="muted" style={{ marginTop: 2, lineHeight: 16 }}>{on ? 'Open below · tap again to close' : text}</Txt>
      </View>
      <View style={{ transform: [{ rotate: on ? '180deg' : '0deg' }] }}><Icon name="chevronDown" size={16} stroke={2} color={on ? C.brand : C.faint} /></View>
    </Pressable>
  )
}

function Hero({ composing, onCompose }: { composing: Mode; onCompose: (m: Exclude<Mode, null>) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ borderRadius: 22, paddingVertical: 24, paddingHorizontal: 18, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, gap: 16, overflow: 'hidden' }}>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Icon name="sparkle" size={14} color={C.brand} />
          <Txt size={F.micro} w={600} tone="brand">Recognition, company-wide</Txt>
        </View>
        <Txt size={30} w={700} style={{ letterSpacing: -0.7, lineHeight: 34 }}>Wall of Fame</Txt>
        <Txt size={F.body} tone="soft" style={{ marginTop: 10, lineHeight: 22 }}>
          What your colleagues have noticed. Noticed someone doing something well? Say so: a shoutout goes on the wall for everyone, a note goes only to them.
        </Txt>
      </View>
      <View style={{ gap: 10 }}>
        <Launcher icon="megaphone" title="Give a shoutout" text="Public praise, on the wall" on={composing === 'shoutout'} onPress={() => onCompose('shoutout')} />
        <Launcher icon="mail" title="Send a private note" text="Only they will see it" on={composing === 'note'} onPress={() => onCompose('note')} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 }}>
          <View style={{ marginTop: 1 }}><Icon name="shield" size={13} color={C.muted} /></View>
          <Txt size={F.micro} tone="muted" style={{ flex: 1, lineHeight: 16 }}>Recognition here is thanks, never pay. It changes nothing about anyone’s salary.</Txt>
        </View>
      </View>
    </View>
  )
}

function FeedPanel({ feed, onLayout }: { feed: FeedRow[]; onLayout: (y: number) => void }) {
  const [filter, setFilter] = React.useState<FeedFilter>('all')
  const counts = { all: feed.length, award: feed.filter(isAward).length, shoutout: feed.filter(r => !isAward(r)).length }
  const groups = React.useMemo(() => {
    const shown = feed.filter(r => (filter === 'all' ? true : filter === 'award' ? isAward(r) : !isAward(r)))
    const out: { label: string; rows: FeedRow[] }[] = []
    for (const r of shown) {
      const label = bucketOf(r.published_at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.rows.push(r)
      else out.push({ label, rows: [r] })
    }
    return out
  }, [feed, filter])
  return (
    <Panel onLayout={onLayout} icon="megaphone" title="Recently recognised"
      sub={feed.length ? `The last ${feed.length} across your company` : 'Across your company'}
      action={feed.length > 0 && counts.award > 0 && counts.shoutout > 0 ? (
        <FilterChips label="Show" value={filter} onPick={setFilter} options={[
          { k: 'all', label: 'All', count: counts.all },
          { k: 'shoutout', label: 'Shoutouts', count: counts.shoutout },
          { k: 'award', label: 'Awards', count: counts.award },
        ]} />
      ) : undefined}>
      {feed.length ? (
        <View style={{ gap: 8 }}>
          {groups.map(g => (
            <View key={g.label} accessibilityLabel={g.label} style={{ gap: 8 }}>
              <GroupLabel>{g.label}</GroupLabel>
              {g.rows.map(r => <FeedCard key={r.id} row={r} />)}
            </View>
          ))}
        </View>
      ) : (
        <WEmpty icon="megaphone" title="Be the first on the wall">Nothing yet. Birthdays and service anniversaries fill this on their own from the first day, so it will not stay empty for long.</WEmpty>
      )}
    </Panel>
  )
}

function LoadingShell() {
  const { C } = useTheme()
  return (
    <View style={{ gap: 16 }} accessibilityLabel="Loading the Wall of Fame">
      <View style={{ minHeight: 230, borderRadius: 22, backgroundColor: C.sunken, padding: 16 }}><Skeleton lines={4} /></View>
      <View style={{ minHeight: 230, borderRadius: 20, backgroundColor: C.sunken, padding: 16 }}><Skeleton lines={3} /></View>
      <Panel title="Recently recognised"><Skeleton lines={5} /></Panel>
      <Panel title="Most recognised"><Skeleton lines={4} /></Panel>
    </View>
  )
}

/** The screen. `onJump(y)` scrolls the Social page to a y inside this view. */
export function WallOfFame({ employeeId, onJump }: { employeeId: string; onJump?: (y: number) => void }) {
  const { notify } = useOverlay()
  const q = useQuery({ queryKey: ['wall', employeeId], queryFn: () => loadWall(employeeId), enabled: !!employeeId })
  const [composing, setComposing] = React.useState<Mode>(null)
  const [pos] = React.useState(() => new Map<string, number>())
  const at = (k: string) => (y: number) => { pos.set(k, y) }

  const toggle = React.useCallback((m: Exclude<Mode, null>) => setComposing(v => (v === m ? null : m)), [])
  const shoutoutSent = React.useCallback(() => {
    setComposing(null); void invalidate('wall'); notify('Shoutout posted to the wall', 'success')
  }, [notify])
  const noteSent = React.useCallback(() => { setComposing(null); notify('Note sent. It is in their inbox', 'success') }, [notify])

  if (q.isPending) return <LoadingShell />
  if (q.isError) return <WNotice tone="critical" title="Could not read the Wall of Fame.">{(q.error as Error).message}</WNotice>
  const d = q.data
  if (!d.ready) {
    return (
      <View style={{ gap: 16 }}>
        <Txt size={F.title} w={700}>Wall of Fame</Txt>
        {d.err ? <WNotice tone="critical" title="Could not read the Wall of Fame.">{d.err}</WNotice> : <Pending />}
      </View>
    )
  }
  return (
    <View style={{ gap: 16 }}>
      <Hero composing={composing} onCompose={toggle} />
      {composing && (
        <Panel key={composing} icon={composing === 'shoutout' ? 'megaphone' : 'mail'}
          title={composing === 'shoutout' ? 'Give a shoutout' : 'Send a private note'}
          sub={composing === 'shoutout' ? 'Public, on the wall. Recognition here is thanks, never pay.' : 'Straight to them, in their inbox.'}
          action={<WButton variant="ghost" size="sm" icon="close" onPress={() => setComposing(null)}>Close</WButton>}>
          {composing === 'shoutout'
            ? <ShoutoutComposer actorId={employeeId} onSent={shoutoutSent} />
            : <AppreciationComposer actorId={employeeId} onSent={noteSent} />}
        </Panel>
      )}
      <Spotlight winner={d.winner} />
      <JumpBar items={JUMPS} onJump={k => { const y = pos.get(k); if (y !== undefined) onJump?.(y) }} />
      <FeedPanel feed={d.feed} onLayout={at('feed')} />
      <Panel onLayout={at('leaders')} icon="list" title="Most recognised" sub="A count of thanks. It affects nothing else.">
        <Leaderboard rows={d.board} enabled={d.boardOn} />
      </Panel>
      <Panel onLayout={at('legends')} icon="trophy" title="Hall of legends" sub="Everyone who has won an award here">
        <HallOfLegends winners={d.legends} />
      </Panel>
      <Panel onLayout={at('badges')} icon="medal" title="My badges" sub="Awards, company values and service milestones">
        <BadgeCabinet badges={d.badges} />
      </Panel>
      {/* Shown to everybody, as on the website: without a grant each area is
          locked WITH the database's reason. */}
      <Panel onLayout={at('manage')} icon="shield" title="Manage the wall" sub="Awards, values, badges, screens and who may change them">
        <AdminConsole employeeId={employeeId} />
      </Panel>
    </View>
  )
}
