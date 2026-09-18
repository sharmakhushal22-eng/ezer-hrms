'use client'
// components/ess/WallOfFame.tsx — recognition, inside the employee portal.
//
// v8 REDESIGN. Reference: preview/EZER-WallOfFame-v8.html.
//
//   ┌ hero ───────────────────────────────┬ spotlight (gold frame) ┐
//   │ Wall of Fame · two launchers         │ latest award winner     │
//   └──────────────────────────────────────┴─────────────────────────┘
//   ┌ composer (opens here when a launcher is chosen) ───────────────┐
//   ┌ jump bar (narrow screens only) ────────────────────────────────┐
//   ┌ feed ────────────────────────────────┬ rail ───────────────────┐
//   │ Recently recognised                  │ Most recognised (podium) │
//   │  filter · grouped by day             │                          │
//   │                                      │ Hall of legends          │
//   │                                      │ My badges                │
//   └──────────────────────────────────────┴──────────────────────────┘
//   ┌ Manage the wall ───────────────────────────────────────────────┐
//
// WHAT DID NOT CHANGE — the whole of the data flow:
//   - the wall_config probe decides real / not-switched-on / error
//   - get_company_feed via wallRpc (scope company, limit 20)
//   - recognitions (kind award) → employees → Spotlight + Hall of legends,
//     leavers kept in the hall and never spotlighted
//   - v_wall_leaderboard, top 5 by recognition_count
//   - employee_badges joined to badge_master
//   - composing: null | 'shoutout' | 'note'; a sent shoutout reloads
//   Every query below is character-for-character the v7 query.
//
// THE RULES THAT ARE NOT NEGOTIABLE:
//   Recognition never touches pay. Gold appears in exactly three places.
//   Sub-components at module scope. No browser storage.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { wallRpc } from '@/lib/wall/rpc'
import { BADGE_KEYFRAMES } from '@/components/wall/Badge'
import ShoutoutComposer from '@/components/wall/ShoutoutComposer'
import AppreciationComposer from '@/components/wall/AppreciationComposer'
import AdminConsole from '@/components/wall/AdminConsole'
import FeedCard, { type FeedRow } from '@/components/wall/FeedCard'
import BadgeCabinet, { type MyBadge } from '@/components/wall/BadgeCabinet'
import { Spotlight, Leaderboard, HallOfLegends,
         type Winner, type LeaderRow } from '@/components/wall/Spotlight'
import {
  Button, Empty, FilterChips, GroupLabel, Icon, JumpBar, Notice, Panel, RAD, Skeleton, Split,
  Toast, WALL_CSS, type IconName,
} from '@/components/wall/ui'
import { C, F, W, S } from '@/lib/ui'

/** PostgREST's "that relation does not exist". */
const MISSING = 'PGRST205'
const missing = (e: unknown) =>
  (e as { code?: string } | null)?.code === MISSING ||
  /PGRST205|does not exist/i.test(String((e as { message?: string } | null)?.message ?? ''))

type Mode = null | 'shoutout' | 'note'
type FeedFilter = 'all' | 'shoutout' | 'award'
const isAward = (r: FeedRow) => r.kind === 'award' || Boolean(r.award_name)

/** Presentation only: which heading a post sits under. */
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

const JUMPS = [
  { href: '#wof-feed', label: 'Feed', icon: 'megaphone' },
  { href: '#wof-leaders', label: 'Most recognised', icon: 'list' },
  { href: '#wof-legends', label: 'Legends', icon: 'trophy' },
  { href: '#wof-badges', label: 'My badges', icon: 'medal' },
  { href: '#wof-manage', label: 'Manage', icon: 'shield' },
] as const satisfies readonly { href: string; label: string; icon: IconName }[]

// ── module-scope sub-components ──────────────────────────────────────────

function Pending() {
  return (
    <Notice tone="warning" title="The Wall of Fame is not switched on yet">
      <p style={{ margin: 0, maxWidth: '70ch' }}>
        The screens are built and waiting. The tables they read come from migrations 082 and
        084&ndash;087, which are written and handed over but not applied to this database yet.
        Nothing here is broken.
      </p>
      <p style={{ margin: '8px 0 0', maxWidth: '70ch', color: C.muted }}>
        Once they are applied, EZER switches the module on for your company and your HR team
        picks a Wall Owner. Everything after that happens without any more SQL.
      </p>
    </Notice>
  )
}

/** One of the two ways to thank somebody. A big, plain target. */
function Launcher({ icon, title, text, on, onClick }: {
  icon: IconName; title: string; text: string; on: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-controls="wof-composer"
      className="wof-tile"
      style={{
        flex: '1 1 220px', minWidth: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', gap: 12, alignItems: 'center', padding: '14px 16px',
        borderRadius: RAD.tile, border: `1.5px solid ${on ? C.brand : C.line}`,
        background: on ? C.brandTint : C.surface,
        boxShadow: on ? 'none' : '0 1px 2px rgba(15,23,42,.05)',
      }}>
      <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: 'grid',
                     placeItems: 'center', background: on ? C.brand : C.brandTint,
                     color: on ? C.onAccent : C.brand }}>
        <Icon name={icon} size={20} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: F.body, fontWeight: W.bold, color: on ? C.brand : C.ink }}>
          {title}
        </span>
        <span style={{ display: 'block', fontSize: F.micro, color: C.muted, marginTop: 2, lineHeight: 1.45 }}>
          {on ? 'Open below · tap again to close' : text}
        </span>
      </span>
      <span aria-hidden="true" style={{ color: on ? C.brand : C.faint, flexShrink: 0,
                                        transform: on ? 'rotate(180deg)' : 'none',
                                        transition: 'transform .25s' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </span>
    </button>
  )
}

function Hero({ composing, onCompose, winner }: {
  composing: Mode; onCompose: (m: Exclude<Mode, null>) => void; winner: Winner | null
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.lg, alignItems: 'stretch' }}>
      <div style={{
        flex: '999 1 440px', minWidth: 0, borderRadius: 22, padding: `${S.lg + 8}px ${S.lg + 4}px`,
        background: C.brandTint, border: `1px solid ${C.brandEdge}`, position: 'relative',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        gap: S.lg,
      }}>
        {/* a quiet field of stars, drawn with the brand edge so it themes */}
        <div aria-hidden="true" style={{
          position: 'absolute', inset: 0, opacity: .55, pointerEvents: 'none',
          backgroundImage: `radial-gradient(${C.brandEdge} 1.2px, transparent 1.3px)`,
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(115deg, transparent 35%, #000 100%)',
          WebkitMaskImage: 'linear-gradient(115deg, transparent 35%, #000 100%)',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.micro,
                        fontWeight: W.semi, color: C.brand, marginBottom: 10 }}>
            <Icon name="sparkle" size={14} /> Recognition, company-wide
          </div>
          <h2 style={{ margin: 0, fontSize: 34, fontWeight: W.bold, color: C.ink,
                       letterSpacing: '-.025em', lineHeight: 1.08 }}>
            Wall of Fame
          </h2>
          <p style={{ margin: '10px 0 0', fontSize: F.body, color: C.inkSoft, lineHeight: 1.6,
                      maxWidth: '48ch' }}>
            What your colleagues have noticed. Noticed someone doing something well? Say so —
            a shoutout goes on the wall for everyone, a note goes only to them.
          </p>
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Launcher icon="megaphone" title="Give a shoutout" text="Public praise, on the wall"
              on={composing === 'shoutout'} onClick={() => onCompose('shoutout')} />
            <Launcher icon="mail" title="Send a private note" text="Only they will see it"
              on={composing === 'note'} onClick={() => onCompose('note')} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12,
                        fontSize: F.micro, color: C.muted }}>
            <Icon name="shield" size={13} />
            Recognition here is thanks, never pay — it changes nothing about anyone&rsquo;s salary.
          </div>
        </div>
      </div>

      <div style={{ flex: '1 1 360px', minWidth: 0 }}>
        <Spotlight winner={winner} />
      </div>
    </div>
  )
}

function ComposerPanel({ mode, employeeId, onClose, onShoutoutSent, onNoteSent }: {
  mode: Exclude<Mode, null>; employeeId: string; onClose: () => void
  onShoutoutSent: () => void; onNoteSent: () => void
}) {
  const shout = mode === 'shoutout'
  return (
    <div id="wof-composer" className="wof-open">
      <Panel
        icon={shout ? 'megaphone' : 'mail'}
        title={shout ? 'Give a shoutout' : 'Send a private note'}
        sub={shout
          ? 'Public, on the wall. Recognition here is thanks, never pay.'
          : 'Straight to them, in their inbox.'}
        action={<Button variant="ghost" size="sm" icon="close" onClick={onClose}>Close</Button>}>
        {shout
          ? <ShoutoutComposer actorId={employeeId} onSent={onShoutoutSent} />
          : <AppreciationComposer actorId={employeeId} onSent={onNoteSent} />}
      </Panel>
    </div>
  )
}

function FeedPanel({ feed }: { feed: FeedRow[] }) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const counts = {
    all: feed.length,
    award: feed.filter(isAward).length,
    shoutout: feed.filter(r => !isAward(r)).length,
  }
  const groups = useMemo(() => {
    const shown = feed.filter(r => filter === 'all' ? true : filter === 'award' ? isAward(r) : !isAward(r))
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
    <Panel id="wof-feed" icon="megaphone" title="Recently recognised"
      sub={feed.length ? `The last ${feed.length} across your company` : 'Across your company'}
      action={feed.length > 0 && counts.award > 0 && counts.shoutout > 0 ? (
        <FilterChips label="Show" value={filter} onPick={setFilter} options={[
          { k: 'all', label: 'All', count: counts.all },
          { k: 'shoutout', label: 'Shoutouts', count: counts.shoutout },
          { k: 'award', label: 'Awards', count: counts.award },
        ]} />
      ) : undefined}>
      {feed.length ? (
        <div style={{ display: 'grid', gap: S.sm }}>
          {groups.map(g => (
            <section key={g.label} aria-label={g.label} style={{ display: 'grid', gap: S.sm }}>
              <GroupLabel>{g.label}</GroupLabel>
              {g.rows.map(r => <FeedCard key={r.id} row={r} />)}
            </section>
          ))}
        </div>
      ) : (
        <Empty icon="megaphone" title="Be the first on the wall">
          Nothing yet. Birthdays and service anniversaries fill this on their own from
          the first day, so it will not stay empty for long.
        </Empty>
      )}
    </Panel>
  )
}

function LoadingShell() {
  return (
    <div style={{ display: 'grid', gap: S.lg }} aria-busy="true" aria-label="Loading the Wall of Fame">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.lg }}>
        <div style={{ flex: '999 1 440px', minHeight: 230, borderRadius: 22, background: C.sunken,
                      padding: S.lg, boxSizing: 'border-box' }}><Skeleton lines={4} /></div>
        <div style={{ flex: '1 1 360px', minHeight: 230, borderRadius: 20, background: C.sunken,
                      padding: S.lg, boxSizing: 'border-box' }}><Skeleton lines={3} /></div>
      </div>
      <Split
        main={<Panel title="Recently recognised"><Skeleton lines={5} /></Panel>}
        rail={<Panel title="Most recognised"><Skeleton lines={4} /></Panel>} />
    </div>
  )
}

// ── the screen ───────────────────────────────────────────────────────────

export default function WallOfFame({ employeeId }: { employeeId: string }) {
  const [ready, setReady] = useState<boolean | null>(null)
  const [feed, setFeed] = useState<FeedRow[]>([])
  const [badges, setBadges] = useState<MyBadge[]>([])
  const [err, setErr] = useState<string | null>(null)
  // Two composers, one slot. They are different channels — a shoutout is
  // published, a note is private and cannot become a conversation.
  const [composing, setComposing] = useState<Mode>(null)
  const [winner, setWinner] = useState<Winner | null>(null)
  const [legends, setLegends] = useState<Winner[]>([])
  const [board, setBoard] = useState<LeaderRow[]>([])
  const [boardOn, setBoardOn] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    // One cheap probe decides which screen this is.
    const probe = await supabase.from('wall_config')
      .select('module_enabled, leaderboard_enabled').limit(1)
    if (probe.error) {
      if (missing(probe.error)) { setReady(false); return }
      setErr(probe.error.message); setReady(false); return
    }
    setReady(true)
    const cfg = (probe.data ?? [])[0] as { leaderboard_enabled?: boolean } | undefined
    setBoardOn(cfg?.leaderboard_enabled !== false)

    const f = await wallRpc('get_company_feed', { p_scope: 'company', p_limit: 20 }, employeeId)
    if (!f.error) setFeed((f.data ?? []) as unknown as FeedRow[])

    // Awards only. A shoutout is not a spotlight.
    const aw = await supabase.from('recognitions')
      .select('id, message, cycle_label, published_at, receiver_employee_ids,'
            + ' recognition_awards(name)')
      .eq('kind', 'award').eq('is_archived', false)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false }).limit(12)

    if (!aw.error) {
      const rows = (aw.data ?? []) as unknown as (Record<string, unknown> & {
        recognition_awards?: { name?: string } | null })[]
      const ids = [...new Set(rows.flatMap(r => (r.receiver_employee_ids as string[]) ?? []))]
      // One lookup for every winner on screen. date_of_leaving is read, not
      // filtered: a leaver drops off the feed but stays in the hall.
      const who = ids.length
        ? await supabase.from('employees')
            .select('id, full_name, designation, date_of_leaving').in('id', ids)
        : { data: [], error: null }
      const byId = new Map(((who.data ?? []) as unknown as {
        id: string; full_name: string; designation: string | null; date_of_leaving: string | null
      }[]).map(e => [e.id, e]))

      const asWinner = (r: typeof rows[number]): Winner | null => {
        const first = ((r.receiver_employee_ids as string[]) ?? [])[0]
        const e = first ? byId.get(first) : undefined
        if (!e) return null
        return {
          id: String(r.id), name: e.full_name, designation: e.designation,
          awardName: r.recognition_awards?.name ?? 'Award',
          cycleLabel: (r.cycle_label as string) ?? null,
          message: (r.message as string) ?? null,
          publishedAt: (r.published_at as string) ?? null,
          hasLeft: Boolean(e.date_of_leaving),
        }
      }
      const all = rows.map(asWinner).filter(Boolean) as Winner[]
      // Spotlighting somebody who has left reads as the company not knowing.
      setWinner(all.find(w => !w.hasLeft) ?? null)
      setLegends(all.slice(1))
    }

    const lb = await supabase.from('v_wall_leaderboard')
      .select('employee_id, full_name, designation, recognition_count, points')
      .order('recognition_count', { ascending: false }).limit(5)
    if (!lb.error) {
      setBoard(((lb.data ?? []) as unknown as Record<string, unknown>[]).map(r => ({
        employeeId: String(r.employee_id), name: String(r.full_name),
        designation: (r.designation as string) ?? null,
        recognitionCount: Number(r.recognition_count) || 0,
        points: (r.points as number) ?? null,
      })))
    }

    const b = await supabase.from('employee_badges')
      .select('badge_code, earned_count, tier, progress_pct, last_earned_on,'
            + ' badge_master(label, glyph, shape)')
      .eq('employee_id', employeeId).limit(60)
    if (!b.error) {
      const rows = (b.data ?? []) as unknown as (Record<string, unknown> & {
        badge_master?: { label?: string; glyph?: string; shape?: string } | null })[]
      setBadges(rows.map(r => ({
        badge_code: String(r.badge_code),
        label: r.badge_master?.label ?? String(r.badge_code),
        glyph: r.badge_master?.glyph ?? null,
        shape: r.badge_master?.shape ?? null,
        tier: (r.tier as string) ?? null,
        earned_count: (r.earned_count as number) ?? 0,
        progress_pct: (r.progress_pct as number) ?? 0,
        earned_at: (r.last_earned_on as string) ?? null,
      })))
    }
  }, [employeeId])

  useEffect(() => { load() }, [load])

  const toggle = useCallback((m: Exclude<Mode, null>) => setComposing(v => v === m ? null : m), [])
  const close = useCallback(() => setComposing(null), [])
  const shoutoutSent = useCallback(() => {
    setComposing(null); load(); setToast('Shoutout posted to the wall')
  }, [load])
  const noteSent = useCallback(() => { setComposing(null); setToast('Note sent — it is in their inbox') }, [])
  const clearToast = useCallback(() => setToast(null), [])

  return (
    <div className="wof-root" style={{ display: 'grid', gap: S.lg, color: C.ink }}>
      {/* Badge.tsx needs its keyframe, the kit needs its hover/focus rules.
          Injected once, here. */}
      <style>{`${BADGE_KEYFRAMES}\n${WALL_CSS}`}</style>

      {ready === null && <LoadingShell />}

      {ready === false && (
        <h2 style={{ margin: 0, fontSize: F.title, fontWeight: W.bold, color: C.ink,
                     letterSpacing: '-.015em' }}>Wall of Fame</h2>
      )}

      {err && (
        <Notice tone="critical" role="alert" title="Could not read the Wall of Fame.">
          {err}
        </Notice>
      )}

      {ready === false && !err && <Pending />}

      {ready && (
        <>
          <Hero composing={composing} onCompose={toggle} winner={winner} />

          {composing && (
            <ComposerPanel key={composing} mode={composing} employeeId={employeeId}
              onClose={close} onShoutoutSent={shoutoutSent} onNoteSent={noteSent} />
          )}

          <JumpBar items={[...JUMPS]} />

          <Split mainMin={520} railMin={360}
            main={<FeedPanel feed={feed} />}
            rail={
              <>
                <Panel id="wof-leaders" icon="list" title="Most recognised" sub="A count of thanks. It affects nothing else.">
                  <Leaderboard rows={board} enabled={boardOn} />
                </Panel>
                <Panel id="wof-legends" icon="trophy" title="Hall of legends" sub="Everyone who has won an award here">
                  <HallOfLegends winners={legends} />
                </Panel>
                <Panel id="wof-badges" icon="medal" title="My badges" sub="Awards, company values and service milestones">
                  <BadgeCabinet badges={badges} />
                </Panel>
              </>
            }
          />

          {/* Shown to everybody. Somebody without a grant sees each area
              locked WITH the reason — a hidden tab is indistinguishable from a
              missing feature. */}
          <Panel id="wof-manage" icon="shield" title="Manage the wall"
            sub="Awards, values, badges, screens and who may change them">
            <AdminConsole employeeId={employeeId} />
          </Panel>
        </>
      )}

      {toast && <Toast message={toast} onDone={clearToast} />}
    </div>
  )
}
