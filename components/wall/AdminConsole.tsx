'use client'
// components/wall/AdminConsole.tsx — the Wall of Fame admin console.
//
// v8 REDESIGN. A settings layout: the six areas as a navigation column on
// the left, each with its icon and a lock when the viewer lacks the grant,
// and the chosen area on the right. On a narrow screen the column sits
// above the content.
//
// NOTHING ABOUT WHAT IT DOES HAS CHANGED:
//   - one gate pass: wof_can for every permission, wof_explain_access for
//     each one refused — the database's sentence is shown verbatim
//   - areas read-only, company-scoped, same columns as v7
//   - Screens is the one writable area and calls the SAME four actions as
//     v7 (create_board_screen, set_board_screen_active,
//     rotate_board_pair_code, delete_board_screen).
//
//     FIXED IN THE ROUTE, NOT HERE. These four used to answer "Unknown
//     action" because the route exposed migration 106's names with different
//     parameters, and 106 has no delete at all. The route now maps all four
//     to migration 101's wrappers, which match what this file already sends.
//     The component was always right; nothing here changed.
//
// DENIAL IS A STATE, NOT A 404. Sub-components at module scope.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { wallRpc } from '@/lib/wall/rpc'
import { C, F, W, S } from '@/lib/ui'
import {
  Button, Empty, FieldLabel, Icon, Notice, Pill, RAD, Skeleton, inputStyle, type IconName,
} from '@/components/wall/ui'

const MISSING = 'PGRST205'
const gone = (e: unknown) =>
  (e as { code?: string } | null)?.code === MISSING ||
  /PGRST205|does not exist|could not find/i.test(String((e as { message?: string } | null)?.message ?? ''))

/** The surfaces the console offers, each with the permission it needs. */
const AREAS = [
  { k: 'awards',  label: 'Awards',         perm: 'wof.configure',    icon: 'trophy',
    blurb: 'What can be won, who may nominate, and how often' },
  { k: 'values',  label: 'Company values', perm: 'wof.configure',    icon: 'heart',
    blurb: 'The values a shoutout can be tagged against' },
  { k: 'badges',  label: 'Badges',         perm: 'wof.badge.manage', icon: 'medal',
    blurb: 'Shapes, glyphs and the rules that unlock them' },
  { k: 'screens', label: 'Screens',        perm: 'wof.board.manage', icon: 'tv',
    blurb: 'Televisions on the wall, and their pair codes' },
  { k: 'admins',  label: 'Administrators', perm: 'wof.admin.grant',  icon: 'users',
    blurb: 'Who may change any of this, and why they were granted it' },
  { k: 'audit',   label: 'Audit',          perm: 'wof.report.view',  icon: 'clock',
    blurb: 'Every configuration change, who made it and when' },
] as const satisfies readonly { k: string; label: string; perm: string; icon: IconName; blurb: string }[]

type AreaKey = (typeof AREAS)[number]['k']
type Cell = string | number | null

// ── module scope ─────────────────────────────────────────────────────────

function NavItem({ label, icon, on, locked, onClick }: {
  label: string; icon: IconName; on: boolean; locked: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} aria-current={on ? 'page' : undefined}
      className={on ? 'wof-btn' : 'wof-btn wof-btn-ghost'}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
               padding: '9px 11px', borderRadius: RAD.control, cursor: 'pointer',
               fontFamily: 'inherit', fontSize: F.small,
               fontWeight: on ? W.bold : W.semi, border: 'none',
               background: on ? C.brandTint : 'transparent',
               color: on ? C.brand : locked ? C.faint : C.inkSoft }}>
      <Icon name={icon} size={16} />
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {locked && <span title="Locked" style={{ color: C.faint }}><Icon name="lock" size={13} /></span>}
    </button>
  )
}

function AreaHeader({ label, blurb, icon, right }: {
  label: string; blurb: string; icon: IconName; right?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                  gap: 10, flexWrap: 'wrap', marginBottom: S.md }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ color: C.brand }}><Icon name={icon} size={20} /></span>
        <div>
          <div style={{ fontSize: F.body, fontWeight: W.bold, color: C.ink }}>{label}</div>
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 1 }}>{blurb}</div>
        </div>
      </div>
      {right}
    </div>
  )
}

/** An area the person cannot open. Shown, with the reason — never hidden. */
function Locked({ label, blurb, icon, reason }: {
  label: string; blurb: string; icon: IconName; reason: string
}) {
  return (
    <div>
      <AreaHeader label={label} blurb={blurb} icon={icon} right={<Pill tone="neutral" icon="lock">Locked</Pill>} />
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: S.md,
                    borderRadius: RAD.tile, background: C.sunken, border: `1px solid ${C.line}` }}>
        <span style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, display: 'grid',
                       placeItems: 'center', background: C.surface, color: C.muted,
                       border: `1px solid ${C.line}` }}>
          <Icon name="lock" size={17} />
        </span>
        <div>
          <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>You can&rsquo;t open this yet</div>
          {/* The database's own sentence. It names the level required and who
              can grant it, which is the only useful thing to say here. */}
          <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 4, lineHeight: 1.6 }}>{reason}</div>
        </div>
      </div>
    </div>
  )
}

function StatusCell({ value }: { value: string }) {
  const good = value === 'active'
  return <Pill tone={good ? 'positive' : 'neutral'}>{value}</Pill>
}

function Table({ head, rows, empty, statusCol }: {
  head: string[]; rows: Cell[][]; empty: string; statusCol?: number
}) {
  if (!rows.length) return <Empty icon="list" compact>{empty}</Empty>
  return (
    <div style={{ overflowX: 'auto', minWidth: 0, maxWidth: '100%', border: `1px solid ${C.line}`,
                  borderRadius: RAD.tile }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 440 }}>
        <thead>
          <tr style={{ background: C.sunken }}>
            {head.map((h, i) => (
              <th key={i} scope="col" style={{ textAlign: 'left', padding: '9px 12px', whiteSpace: 'nowrap',
                                               fontSize: F.micro, fontWeight: W.bold, color: C.muted,
                                               borderBottom: `1px solid ${C.line}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="wof-row" style={{ borderTop: ri ? `1px solid ${C.line}` : 'none' }}>
              {r.map((c, i) => (
                <td key={i} style={{ padding: '10px 12px', fontSize: F.small, verticalAlign: 'middle',
                                     color: i === 0 ? C.ink : C.inkSoft,
                                     fontWeight: i === 0 ? W.semi : W.regular }}>
                  {i === statusCol && typeof c === 'string' ? <StatusCell value={c} /> : (c ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface Loc { id: string; location_name: string }
interface Screen { id: string; screen_name: string; pair_code: string; rotate_seconds: number; is_active: boolean; location_id: string }

function ScreenCard({ sc, locName, copied, confirming, onCopy, onRotate, onToggle, onRemove, onCancel }: {
  sc: Screen; locName?: string; copied: boolean; confirming: boolean
  onCopy: () => void; onRotate: () => void; onToggle: () => void; onRemove: () => void; onCancel: () => void
}) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: RAD.tile, padding: 14,
                  display: 'grid', gap: 12, background: C.surface }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'grid',
                       placeItems: 'center', background: sc.is_active ? C.brandTint : C.sunken,
                       color: sc.is_active ? C.brand : C.faint }}>
          <Icon name="tv" size={19} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.screen_name}</div>
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2 }}>
            {[locName, `${sc.rotate_seconds}s rotation`].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Pill tone={sc.is_active ? 'positive' : 'neutral'}>{sc.is_active ? 'active' : 'off'}</Pill>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={onCopy} title="Copy pair code" className="wof-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                   fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: F.small,
                   fontWeight: W.bold, letterSpacing: '.14em', color: C.brandDeep,
                   background: C.brandTint, border: `1px dashed ${C.brandEdge}`,
                   borderRadius: RAD.control, padding: '6px 12px' }}>
          {copied ? <>Copied <Icon name="check" size={13} stroke={2.6} /></> : <>{sc.pair_code} <Icon name="copy" size={13} /></>}
        </button>
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="refresh" onClick={onRotate}>New code</Button>
        <Button size="sm" icon="power" onClick={onToggle}>{sc.is_active ? 'Deactivate' : 'Activate'}</Button>
        {confirming ? (
          <>
            <Button size="sm" variant="danger" icon="trash" onClick={onRemove}>Confirm remove</Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>Keep</Button>
          </>
        ) : (
          <Button size="sm" variant="danger" icon="trash" onClick={onRemove}>Remove</Button>
        )}
      </div>
    </div>
  )
}

// The Screens area, writable. Every change goes through /api/ess/wall.
function ScreensManager({ employeeId }: { employeeId: string }) {
  const [locs, setLocs] = useState<Loc[]>([])
  const [screens, setScreens] = useState<Screen[]>([])
  const [name, setName] = useState('')
  const [locId, setLocId] = useState('')
  const [rotate, setRotate] = useState('8')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: me } = await supabase.from('employees').select('company_id').eq('id', employeeId).maybeSingle()
    const co = me?.company_id
    if (co) {
      const { data: l } = await supabase.from('locations').select('id, location_name').eq('company_id', co).eq('status', 'Active').order('location_name')
      setLocs((l ?? []) as Loc[])
      if (l?.length && !locId) setLocId(l[0].id)
    }
    const { data: s } = await supabase.from('board_screens').select('id, screen_name, pair_code, rotate_seconds, is_active, location_id').order('created_at', { ascending: false })
    setScreens((s ?? []) as Screen[])
  }, [employeeId])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const flash = (setter: (v: string) => void, v: string) => { setter(v); setTimeout(() => setter(''), 3000) }

  async function add() {
    setErr(''); setMsg('')
    if (!name.trim()) return flash(setErr, 'Give the screen a name')
    if (!locId) return flash(setErr, 'Pick a location')
    setBusy(true)
    const { error } = await wallRpc('create_board_screen', { p_location: locId, p_name: name.trim(), p_rotate: Number(rotate) || 8 }, employeeId)
    setBusy(false)
    if (error) return flash(setErr, error.message)
    setName(''); flash(setMsg, 'Screen added — share its pair code with the TV'); load()
  }
  async function toggle(sc: Screen) {
    const { error } = await wallRpc('set_board_screen_active', { p_screen: sc.id, p_active: !sc.is_active }, employeeId)
    if (error) return flash(setErr, error.message); load()
  }
  async function rotateCode(sc: Screen) {
    const { error } = await wallRpc('rotate_board_pair_code', { p_screen: sc.id }, employeeId)
    if (error) return flash(setErr, error.message); flash(setMsg, 'New pair code issued — the old one no longer works'); load()
  }
  async function remove(sc: Screen) {
    if (confirmId !== sc.id) { setConfirmId(sc.id); return }
    setConfirmId(null)
    const { error } = await wallRpc('delete_board_screen', { p_screen: sc.id }, employeeId)
    if (error) return flash(setErr, error.message); load()
  }
  const copy = async (code: string) => { try { await navigator.clipboard.writeText(code) } catch { /* best effort */ } flash(setCopied, code) }

  const locName = (id: string) => locs.find(l => l.id === id)?.location_name

  return (
    <div>
      <AreaHeader label="Screens" blurb="Televisions on the wall, and their pair codes" icon="tv" />

      {/* Add a screen */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
                    marginBottom: S.md, padding: 14, background: C.sunken,
                    borderRadius: RAD.tile, border: `1px solid ${C.line}` }}>
        <div style={{ flex: '2 1 200px' }}>
          <FieldLabel htmlFor="wof-sc-name">Screen name</FieldLabel>
          <input id="wof-sc-name" style={inputStyle} placeholder="Manesar Plant · Gate 2"
            value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <FieldLabel htmlFor="wof-sc-loc">Location</FieldLabel>
          <select id="wof-sc-loc" style={{ ...inputStyle, cursor: 'pointer' }} value={locId}
            onChange={e => setLocId(e.target.value)}>
            {locs.length === 0 && <option value="">No locations</option>}
            {locs.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 0 110px' }}>
          <FieldLabel htmlFor="wof-sc-rot">Rotate every (s)</FieldLabel>
          <input id="wof-sc-rot" type="number" min={5} max={120} style={inputStyle}
            value={rotate} onChange={e => setRotate(e.target.value)} />
        </div>
        <Button variant="primary" icon="plus" onClick={add} busy={busy}>
          {busy ? 'Adding…' : 'Add screen'}
        </Button>
      </div>

      {msg && <div style={{ marginBottom: S.sm }}><Notice tone="positive" role="status">{msg}</Notice></div>}
      {err && <div style={{ marginBottom: S.sm }}><Notice tone="critical" role="alert">{err}</Notice></div>}

      {screens.length === 0 ? (
        <Empty icon="tv" title="No screens paired yet">
          Add one to put the wall on a television.
        </Empty>
      ) : (
        <div style={{ display: 'grid', gap: 10,
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {screens.map(sc => (
            <ScreenCard key={sc.id} sc={sc} locName={locName(sc.location_id)}
              copied={copied === sc.pair_code} confirming={confirmId === sc.id}
              onCopy={() => copy(sc.pair_code)} onRotate={() => rotateCode(sc)}
              onToggle={() => toggle(sc)} onRemove={() => remove(sc)}
              onCancel={() => setConfirmId(null)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── the console ──────────────────────────────────────────────────────────

const HEADS: Record<AreaKey, string[]> = {
  awards: ['Award', 'Cadence', 'Status'],
  values: ['Value', 'Code', 'Status'],
  badges: ['Badge', 'Shape', 'Tier', 'Status'],
  screens: ['Screen', 'Pair code', 'Rotates', 'Status'],
  admins: ['Level', 'Why they were granted it', 'Status'],
  audit: ['Action', 'Entity', 'When'],
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

export default function AdminConsole({ employeeId }: { employeeId: string }) {
  const [area, setArea] = useState<AreaKey>('awards')
  const [ready, setReady] = useState<boolean | null>(null)
  const [allowed, setAllowed] = useState<Record<string, boolean>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<Cell[][]>([])
  const [err, setErr] = useState<string | null>(null)

  // One pass over every permission, so the console renders in its true
  // state at once rather than revealing locks tab by tab.
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
    }[area] as [string, string, (r: Record<string, unknown>) => Cell[]]

    // SCOPED TO THE VIEWER'S COMPANY — every table here holds one row per company.
    const meRow = await supabase.from('employees')
      .select('company_id').eq('id', employeeId).maybeSingle()
    const companyId = (meRow.data as { company_id?: string } | null)?.company_id ?? null

    let query = supabase.from(q[0]).select(q[1]).limit(100)
    query = companyId ? query.eq('company_id', companyId) : query.limit(0)
    const res = await query
    if (res.error) { setRows([]); return }
    setRows(((res.data ?? []) as unknown as Record<string, unknown>[]).map(q[2]))
  }, [area, may, employeeId])

  useEffect(() => { loadArea() }, [loadArea])

  if (ready === null) return <Skeleton lines={4} />

  if (ready === false) {
    return (
      <Notice tone="warning" title="The Wall of Fame is not installed yet">
        <span style={{ display: 'block', maxWidth: '70ch' }}>
          {err ?? 'Migrations 082 and 084–087 are written and handed over but not applied to '
                + 'this database. Once they run, EZER switches the module on for your company '
                + 'and your HR team names a Wall Owner. Nothing after that needs SQL.'}
        </span>
      </Notice>
    )
  }

  const openCount = AREAS.filter(a => allowed[a.perm] === true).length

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.lg, alignItems: 'flex-start' }}>
      <nav aria-label="Wall settings" style={{ flex: '1 1 200px', maxWidth: '100%', minWidth: 0 }}>
        <div style={{ display: 'grid', gap: 2, padding: 6, borderRadius: RAD.tile,
                      background: C.sunken, border: `1px solid ${C.line}` }}>
          {AREAS.map(a => (
            <NavItem key={a.k} label={a.label} icon={a.icon} on={a.k === area}
              locked={allowed[a.perm] === false} onClick={() => setArea(a.k)} />
          ))}
        </div>
        <div style={{ fontSize: F.micro, color: C.faint, marginTop: 8, paddingLeft: 6 }}>
          You can open {openCount} of {AREAS.length}
        </div>
      </nav>

      <div style={{ flex: '999 1 420px', minWidth: 0 }}>
        {may && area === 'screens' ? (
          <ScreensManager employeeId={employeeId} />
        ) : may ? (
          <div>
            <AreaHeader label={current.label} blurb={current.blurb} icon={current.icon}
              right={<Pill tone="neutral" icon="eye">Read-only</Pill>} />
            <Table head={HEADS[area]} rows={rows} empty={EMPTY[area]} statusCol={STATUS_COL[area]} />
            {/* Read-only from here. A Save button that always failed would be
                worse than none. */}
            <div style={{ fontSize: F.micro, color: C.faint, marginTop: S.md, lineHeight: 1.5 }}>
              Read-only in this build. Changing configuration needs a server route that proves who
              is asking, because the database rejects an unidentified write.
            </div>
          </div>
        ) : (
          <Locked label={current.label} blurb={current.blurb} icon={current.icon}
            reason={reasons[current.perm] ?? 'You do not have access to this.'} />
        )}
      </div>
    </div>
  )
}
