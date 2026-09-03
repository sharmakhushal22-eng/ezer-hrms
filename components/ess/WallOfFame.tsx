'use client'
// components/ess/WallOfFame.tsx — recognition, inside the employee portal.
//
// Built from the v7 bundle: design/EZER-WallOfFame-v7.html is the reference
// and DESIGN-NOTES.md carries the reasoning. Nothing here is redesigned.
//
// THE RULES THAT ARE NOT NEGOTIABLE, restated where they are enforced:
//
//   Recognition never touches pay. Nothing on this screen shows or implies
//   money, and wall_config.payout_linkage is pinned false by a CHECK.
//
//   Gold appears in exactly three places across the whole module — the
//   Spotlight winner's frame, the #1 podium card, and the board's award
//   ribbon. Not on headers, not on buttons. That restraint is what makes
//   gold read as WON rather than as decoration.
//
//   Sub-components live at module scope. Declared inside the parent they
//   remount on every render and inputs lose focus on each keystroke — a bug
//   this codebase has already had once and fixed.
//
//   No browser storage anywhere in this module.
//
// THE TABLES DO NOT EXIST YET
//
// Migrations 082 and 084-087 are written and handed to Nayan, not applied.
// Every read here can legitimately come back PGRST205, and that is a state to
// render rather than an error to swallow — otherwise the module looks broken
// when it is merely waiting.

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import Badge, { BADGE_KEYFRAMES, type BadgeTier, type BadgeShape } from '@/components/wall/Badge'
import ShoutoutComposer from '@/components/wall/ShoutoutComposer'
import { Spotlight, Leaderboard, HallOfLegends,
         type Winner, type LeaderRow } from '@/components/wall/Spotlight'
import { C, F, W, S, R } from '@/lib/ui'

/** PostgREST's "that relation does not exist". */
const MISSING = 'PGRST205'
const missing = (e: unknown) =>
  (e as { code?: string } | null)?.code === MISSING ||
  /PGRST205|does not exist/i.test(String((e as { message?: string } | null)?.message ?? ''))

// ── shapes read from v_company_feed ──────────────────────────────────────
interface FeedRow {
  id: string
  kind: string | null
  message: string | null
  published_at: string | null
  category_label: string | null
  category_glyph: string | null
  award_name: string | null
  badge_code: string | null
  giver_id: string | null
  giver_name: string | null
  giver_designation: string | null
  receiver_names: string[] | null
  visibility: string | null
}

interface MyBadge {
  badge_code: string
  label: string
  glyph: string | null
  tier: string | null
  shape: string | null
  earned_count: number | null
  progress_pct: number | null
  earned_at: string | null
}

// ── module-scope sub-components ──────────────────────────────────────────

function Panel({ title, sub, children, action }: {
  title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <section style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.sm,
      padding: `${S.md}px ${S.lg}px ${S.lg}px`, marginBottom: S.sm,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: S.sm, flexWrap: 'wrap', marginBottom: sub ? 3 : S.md }}>
        <h3 style={{ margin: 0, fontSize: F.body, fontWeight: W.bold, color: C.ink }}>{title}</h3>
        {action}
      </div>
      {sub && <div style={{ fontSize: F.micro, color: C.muted, marginBottom: S.md }}>{sub}</div>}
      {children}
    </section>
  )
}

function Pending() {
  return (
    <div style={{ background: C.warningTint, border: `1px solid ${C.warning}44`,
                  borderRadius: R.sm, padding: `${S.md}px ${S.lg}px` }}>
      <div style={{ fontSize: F.body, fontWeight: W.bold, color: C.ink }}>
        The Wall of Fame is not switched on yet
      </div>
      <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 7, lineHeight: 1.6, maxWidth: '70ch' }}>
        The screens are built and waiting. The tables they read come from migrations 082 and
        084&ndash;087, which are written and handed over but not applied to this database yet.
        Nothing here is broken.
      </div>
      <div style={{ fontSize: F.small, color: C.muted, marginTop: 9, lineHeight: 1.6, maxWidth: '70ch' }}>
        Once they are applied, EZER switches the module on for your company and your HR team
        picks a Wall Owner. Everything after that happens without any more SQL.
      </div>
    </div>
  )
}

/** One recognition. Giver, arrow, receivers, category, message, reactions. */
function FeedCard({ row }: { row: FeedRow }) {
  const names = row.receiver_names ?? []
  const when = row.published_at ? new Date(row.published_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  }) : ''
  return (
    <article style={{
      border: `1px solid ${C.line}`, borderRadius: R.sm, padding: `${S.md}px ${S.md}px`,
      background: C.surface, display: 'grid', gap: 9,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>
          {row.giver_name ?? 'Someone'}
        </span>
        <span aria-hidden style={{ color: C.faint }}>→</span>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>
          {names.length ? names.join(', ') : 'a colleague'}
        </span>
        {row.category_label && (
          <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '2px 8px',
                         borderRadius: 999, background: C.brandTint, color: C.brand }}>
            {row.category_glyph ? `${row.category_glyph} ` : ''}{row.category_label}
          </span>
        )}
        {when && <span style={{ fontSize: F.micro, color: C.faint, marginLeft: 'auto' }}>{when}</span>}
      </div>

      {row.giver_designation && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: -5 }}>{row.giver_designation}</div>
      )}

      {row.message && (
        <p style={{ margin: 0, fontSize: F.small, color: C.inkSoft, lineHeight: 1.6 }}>{row.message}</p>
      )}

      {row.award_name && (
        <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.ink }}>{row.award_name}</div>
      )}

      {/* Visibility is stated on every card. Somebody writing a note deserves
          to know who will read it, and somebody reading one deserves to know
          how far it travelled. */}
      {row.visibility && (
        <div style={{ fontSize: F.micro, color: C.faint }}>
          Visible to {row.visibility.toLowerCase()}
        </div>
      )}
    </article>
  )
}

function BadgeCabinet({ badges }: { badges: MyBadge[] }) {
  if (!badges.length) {
    return (
      <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>
        Nothing here yet. Badges arrive from awards, company values and service milestones —
        the last of those on their own, from your joining date.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.md }}>
      {badges.map(b => (
        <div key={b.badge_code} style={{ width: 132 }}>
          {/* 118px is the cabinet size from DESIGN-NOTES, and showLabel lets
              Badge draw its own caption — rendering a second one underneath
              would have printed every label twice. */}
          <Badge
            size={118}
            tier={(b.tier as BadgeTier) ?? 'blue'}
            shape={(b.shape as BadgeShape) ?? 'shield'}
            glyph={b.glyph ?? '★'}
            label={b.label}
            sub={b.earned_at
              ? new Date(b.earned_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
              : undefined}
            count={b.earned_count ?? 1}
            locked={!b.earned_at}
            progress={b.progress_pct ?? 0}
            showLabel
            interactive
          />
        </div>
      ))}
    </div>
  )
}

// ── the screen ───────────────────────────────────────────────────────────

export default function WallOfFame({ employeeId }: { employeeId: string }) {
  const [ready, setReady] = useState<boolean | null>(null)
  const [feed, setFeed] = useState<FeedRow[]>([])
  const [badges, setBadges] = useState<MyBadge[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [winner, setWinner] = useState<Winner | null>(null)
  const [legends, setLegends] = useState<Winner[]>([])
  const [board, setBoard] = useState<LeaderRow[]>([])
  const [boardOn, setBoardOn] = useState(true)

  const load = useCallback(async () => {
    // One cheap probe against the module's root table decides which screen
    // this is: the real thing, or the honest "not switched on yet".
    const probe = await supabase.from('wall_config')
      .select('module_enabled, leaderboard_enabled').limit(1)
    if (probe.error) {
      if (missing(probe.error)) { setReady(false); return }
      setErr(probe.error.message); setReady(false); return
    }
    setReady(true)
    const cfg = (probe.data ?? [])[0] as { leaderboard_enabled?: boolean } | undefined
    setBoardOn(cfg?.leaderboard_enabled !== false)

    const f = await supabase.rpc('get_company_feed', { p_scope: 'company', p_limit: 20 })
    if (!f.error) setFeed((f.data ?? []) as unknown as FeedRow[])

    // employee_badges holds what you have earned; badge_master holds what a
    // badge IS. There is no v_my_badges view — I had invented that name, and
    // PostgREST answers a missing relation with an error, not a nudge.
    // Awards only. A shoutout is not a spotlight, and mixing them would make
    // winning look like something that happens several times a week.
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
      // One lookup for every winner on screen, rather than one per row.
      // date_of_leaving is read, not filtered: a leaver drops off the feed
      // but stays in the hall of legends.
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
      // The current winner must still be here. Spotlighting somebody who has
      // left reads as the company not knowing they had gone.
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

  if (ready === null) {
    return <div style={{ fontSize: F.small, color: C.muted, padding: S.lg }}>Loading…</div>
  }

  return (
    <div>
      {/* Badge.tsx needs its one keyframe. Injected once, here, rather than
          asking every host page to remember it. */}
      <style>{BADGE_KEYFRAMES}</style>

      <div style={{ marginBottom: S.lg }}>
        <h2 style={{ margin: 0, fontSize: F.title, fontWeight: W.bold, color: C.ink,
                     letterSpacing: '-.015em' }}>Wall of Fame</h2>
        <div style={{ fontSize: F.small, color: C.muted, marginTop: 3 }}>
          What your colleagues have noticed. Recognition here is thanks, never pay.
        </div>
      </div>

      {err && (
        <div style={{ background: C.criticalTint, border: `1px solid ${C.critical}44`,
                      borderRadius: R.sm, padding: `${S.md}px ${S.lg}px`, marginBottom: S.sm }}>
          <strong style={{ color: C.critical }}>Could not read the Wall of Fame.</strong>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 5 }}>{err}</div>
        </div>
      )}

      {ready === false && !err && <Pending />}

      {ready && (
        <>
          <Panel title="Give a shoutout"
                 sub="Recognition here is thanks, never pay — it changes nothing about anyone's salary."
                 action={
                   <button type="button" onClick={() => setComposing(v => !v)}
                     style={{ fontFamily: 'inherit', fontSize: F.small, fontWeight: W.bold,
                              padding: '8px 15px', borderRadius: R.sm, cursor: 'pointer',
                              border: `1px solid ${composing ? C.line : C.brand}`,
                              background: composing ? C.surface : C.brand,
                              color: composing ? C.inkSoft : '#FFFFFF' }}>
                     {composing ? 'Close' : 'Recognise a colleague'}
                   </button>
                 }>
            {composing
              ? <ShoutoutComposer actorId={employeeId} onSent={() => { setComposing(false); load() }} />
              : <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>
                  Noticed someone doing something well? Say so. It takes a minute and they keep it.
                </div>}
          </Panel>

          <Panel title="Recently recognised"
                 sub={feed.length ? `The last ${feed.length} across your company` : undefined}>
            {feed.length ? (
              <div style={{ display: 'grid', gap: S.sm }}>
                {feed.map(r => <FeedCard key={r.id} row={r} />)}
              </div>
            ) : (
              <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>
                Nothing yet. Birthdays and service anniversaries fill this on their own from
                the first day, so it will not stay empty for long.
              </div>
            )}
          </Panel>

          <Panel title="Spotlight" sub="The most recent award winner">
            <Spotlight winner={winner} />
          </Panel>

          <Panel title="Most recognised" sub="This is a count of thanks. It affects nothing else.">
            <Leaderboard rows={board} enabled={boardOn} />
          </Panel>

          <Panel title="Hall of legends" sub="Everyone who has won an award here">
            <HallOfLegends winners={legends} />
          </Panel>

          <Panel title="My badges" sub="Awards, company values and service milestones">
            <BadgeCabinet badges={badges} />
          </Panel>
        </>
      )}
    </div>
  )
}
