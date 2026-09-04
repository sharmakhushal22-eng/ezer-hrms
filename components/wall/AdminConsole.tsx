'use client'
// components/wall/AdminConsole.tsx — the Wall of Fame admin console.
//
// DENIAL IS A STATE, NOT A 404.
//
// Someone who lacks a permission sees the screen, disabled, with the reason
// from wof_explain_access() printed inline. Telling an HR Manager "this needs
// Wall Administrator level wall_admin — ask a Wall Owner" is worth far more
// than a blank page, because it names the person who can fix it. A 404 makes
// them think the feature is missing and open a ticket.
//
// NOTHING HERE IS SELF-SERVE, AND THAT IS ENFORCED BELOW THIS FILE.
//
// Config tables carry write triggers that reject anyone without a current
// grant, so a stray route cannot bypass the check and neither can this
// screen. What it renders is therefore an honest picture of what the person
// may do, not the gate itself.
//
// Sub-components at module scope.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
// WHITE ON THE BRAND FILL IS A TRAP THIS CODEBASE ALREADY DOCUMENTED.
//
// tokens.ts says it plainly next to onAccent: the brand blue lightens in dark
// mode and white on it falls to 2.5:1. Measured here at 2.54 on the Send
// button. C.onAccent is the theme-aware ink for an accent fill and is what
// every one of these should have used from the start.
import { C, F, W, S, R } from '@/lib/ui'

const MISSING = 'PGRST205'
const gone = (e: unknown) =>
  (e as { code?: string } | null)?.code === MISSING ||
  /PGRST205|does not exist|could not find/i.test(String((e as { message?: string } | null)?.message ?? ''))

/** The surfaces the console offers, each with the permission it needs. */
const AREAS = [
  { k: 'awards',  label: 'Awards',        perm: 'wof.configure',
    blurb: 'What can be won, who may nominate, and how often' },
  { k: 'values',  label: 'Company values', perm: 'wof.configure',
    blurb: 'The values a shoutout can be tagged against' },
  { k: 'badges',  label: 'Badges',        perm: 'wof.badge.manage',
    blurb: 'Shapes, glyphs and the rules that unlock them' },
  { k: 'screens', label: 'Screens',       perm: 'wof.board.manage',
    blurb: 'Televisions on the wall, and their pair codes' },
  { k: 'admins',  label: 'Administrators', perm: 'wof.admin.grant',
    blurb: 'Who may change any of this, and why they were granted it' },
  { k: 'audit',   label: 'Audit',         perm: 'wof.report.view',
    blurb: 'Every configuration change, who made it and when' },
] as const

type AreaKey = (typeof AREAS)[number]['k']

// ── module scope ─────────────────────────────────────────────────────────

function Card({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'off' }) {
  const edge = tone === 'warn' ? `${C.warning}44` : C.line
  const fill = tone === 'warn' ? C.warningTint : tone === 'off' ? C.sunken : C.surface
  return (
    <div style={{ background: fill, border: `1px solid ${edge}`, borderRadius: R.sm,
                  padding: `${S.md}px ${S.lg}px` }}>{children}</div>
  )
}

/** An area the person cannot open. Shown, greyed, with the reason — never
 *  hidden, because a missing tab is indistinguishable from a missing feature. */
function Locked({ label, blurb, reason }: { label: string; blurb: string; reason: string }) {
  return (
    <Card tone="off">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.inkSoft }}>{label}</span>
        <span aria-hidden style={{ fontSize: F.micro, color: C.muted }}>locked</span>
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3 }}>{blurb}</div>
      {/* The database's own sentence. It names the level required and who can
          grant it, which is the only useful thing to say here. */}
      <div style={{ fontSize: F.small, color: C.ink, marginTop: 9, lineHeight: 1.55 }}>
        {reason}
      </div>
    </Card>
  )
}

function Row({ cells, head }: { cells: (string | number | null)[]; head?: boolean }) {
  return (
    <tr style={{ borderTop: head ? 'none' : `1px solid ${C.line}` }}>
      {cells.map((c, i) => (
        head ? (
          <th key={i} style={{ textAlign: 'left', padding: '0 10px 8px', whiteSpace: 'nowrap',
                               fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.08em',
                               textTransform: 'uppercase', color: C.muted }}>{c}</th>
        ) : (
          <td key={i} style={{ padding: '9px 10px', fontSize: F.small,
                               color: i === 0 ? C.ink : C.inkSoft,
                               fontWeight: i === 0 ? W.semi : W.regular }}>{c ?? '—'}</td>
        )
      ))}
    </tr>
  )
}

function Table({ head, rows, empty }: {
  head: string[]; rows: (string | number | null)[][]; empty: string
}) {
  if (!rows.length) {
    return <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>{empty}</div>
  }
  return (
    <div style={{ overflowX: 'auto', minWidth: 0, maxWidth: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
        <thead><Row cells={head} head /></thead>
        <tbody>{rows.map((r, i) => <Row key={i} cells={r} />)}</tbody>
      </table>
    </div>
  )
}

// ── the console ──────────────────────────────────────────────────────────

export default function AdminConsole({ employeeId }: { employeeId: string }) {
  const [area, setArea] = useState<AreaKey>('awards')
  const [ready, setReady] = useState<boolean | null>(null)
  const [allowed, setAllowed] = useState<Record<string, boolean>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<(string | number | null)[][]>([])
  const [err, setErr] = useState<string | null>(null)

  // One pass over every permission the console offers, so the whole screen
  // renders in its true state at once rather than revealing locks tab by tab.
  const loadGates = useCallback(async () => {
    const probe = await supabase.from('wall_config').select('module_enabled').limit(1)
    if (probe.error) {
      if (gone(probe.error)) { setReady(false); return }
      setErr(probe.error.message); setReady(false); return
    }
    setReady(true)

    const perms = [...new Set(AREAS.map(a => a.perm))]
    const can: Record<string, boolean> = {}
    const why: Record<string, string> = {}
    for (const p of perms) {
      const c = await supabase.rpc('wof_can', {
        p_employee: employeeId, p_permission: p, p_company: null, p_branch: null,
      })
      can[p] = c.data === true
      if (!can[p]) {
        const e = await supabase.rpc('wof_explain_access', {
          p_employee: employeeId, p_permission: p, p_company: null,
        })
        why[p] = (e.data as string) ?? 'You do not have access to this.'
      }
    }
    setAllowed(can); setReasons(why)
  }, [employeeId])

  useEffect(() => { loadGates() }, [loadGates])

  const current = AREAS.find(a => a.k === area)!
  const may = allowed[current.perm] === true

  const loadArea = useCallback(async () => {
    if (!may) { setRows([]); return }
    const q = {
      // `frequency`, not `cadence`. There is no cadence column on
      // recognition_awards, and a wrong name fails the WHOLE select with
      // 42703 — so the Awards panel showed nothing at all rather than a
      // blank column. Found by checking every selected column against the
      // database once the migrations were applied.
      awards:  ['recognition_awards', 'name, frequency, is_active', (r: Record<string, unknown>) =>
                 [r.name as string, r.frequency as string, r.is_active ? 'active' : 'off']],
      values:  ['recognition_values', 'label, code, is_active', (r: Record<string, unknown>) =>
                 [r.label as string, r.code as string, r.is_active ? 'active' : 'off']],
      badges:  ['badge_master', 'label, shape, base_tier, is_active', (r: Record<string, unknown>) =>
                 [r.label as string, r.shape as string, r.base_tier as string, r.is_active ? 'active' : 'off']],
      screens: ['board_screens', 'screen_name, pair_code, rotate_seconds, is_active',
                 (r: Record<string, unknown>) =>
                 [r.screen_name as string, r.pair_code as string,
                  `${r.rotate_seconds}s`, r.is_active ? 'active' : 'off']],
      admins:  ['wall_admins', 'employee_id, admin_level, grant_reason, is_active',
                 (r: Record<string, unknown>) =>
                 [r.admin_level as string, r.grant_reason as string, r.is_active ? 'active' : 'revoked']],
      audit:   ['wall_audit_log', 'action, entity, created_at', (r: Record<string, unknown>) =>
                 [r.action as string, r.entity as string,
                  r.created_at ? new Date(r.created_at as string).toLocaleString('en-IN') : '—']],
    }[area] as [string, string, (r: Record<string, unknown>) => (string | number | null)[]]

    const res = await supabase.from(q[0]).select(q[1]).limit(100)
    if (res.error) { setRows([]); return }
    setRows(((res.data ?? []) as unknown as Record<string, unknown>[]).map(q[2]))
  }, [area, may])

  useEffect(() => { loadArea() }, [loadArea])

  if (ready === null) {
    return <div style={{ fontSize: F.small, color: C.muted }}>Loading…</div>
  }

  if (ready === false) {
    return (
      <Card tone="warn">
        <div style={{ fontSize: F.body, fontWeight: W.bold, color: C.ink }}>
          The Wall of Fame is not installed yet
        </div>
        <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 7, lineHeight: 1.6,
                      maxWidth: '70ch' }}>
          {err ?? 'Migrations 082 and 084–087 are written and handed over but not applied to '
                + 'this database. Once they run, EZER switches the module on for your company '
                + 'and your HR team names a Wall Owner. Nothing after that needs SQL.'}
        </div>
      </Card>
    )
  }

  const HEADS: Record<AreaKey, string[]> = {
    awards: ['Award', 'Cadence', 'Status'],
    values: ['Value', 'Code', 'Status'],
    badges: ['Badge', 'Shape', 'Tier', 'Status'],
    screens: ['Screen', 'Pair code', 'Rotates', 'Status'],
    admins: ['Level', 'Why they were granted it', 'Status'],
    audit: ['Action', 'Entity', 'When'],
  }
  const EMPTY: Record<AreaKey, string> = {
    awards: 'No awards yet. Your Wall Owner adds the first one.',
    values: 'No values yet. A values programme is optional.',
    badges: 'No badges yet. Service milestones generate their own.',
    screens: 'No screens paired. Add one to put the wall on a television.',
    admins: 'Only the Wall Owner, so far.',
    audit: 'Nothing changed yet.',
  }

  return (
    <div style={{ display: 'grid', gap: S.md }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {AREAS.map(a => {
          const on = a.k === area
          const locked = allowed[a.perm] === false
          return (
            <button key={a.k} type="button" onClick={() => setArea(a.k)} aria-pressed={on}
              style={{ cursor: 'pointer', fontFamily: 'inherit', padding: '7px 13px',
                       borderRadius: R.sm, fontSize: F.small,
                       fontWeight: on ? W.bold : W.semi,
                       border: `1px solid ${on ? C.brand : C.line}`,
                       background: on ? C.brand : C.surface,
                       color: on ? C.onAccent : locked ? C.faint : C.inkSoft }}>
              {a.label}{locked ? ' · locked' : ''}
            </button>
          )
        })}
      </div>

      {may ? (
        <Card>
          <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>{current.label}</div>
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3, marginBottom: S.md }}>
            {current.blurb}
          </div>
          <Table head={HEADS[area]} rows={rows} empty={EMPTY[area]} />
          {/* Read-only from here. Writes need a server route that establishes
              session identity, or the config triggers reject them with 42501
              — and a Save button that always failed would be worse than none. */}
          <div style={{ fontSize: F.micro, color: C.faint, marginTop: S.md, lineHeight: 1.5 }}>
            Read-only in this build. Changing configuration needs a server route that proves who
            is asking, because the database rejects an unidentified write.
          </div>
        </Card>
      ) : (
        <Locked label={current.label} blurb={current.blurb}
                reason={reasons[current.perm] ?? 'You do not have access to this.'} />
      )}
    </div>
  )
}
