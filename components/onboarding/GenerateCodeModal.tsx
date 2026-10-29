'use client'
// components/onboarding/GenerateCodeModal.tsx — Generate code, the last step on the onboarding
// card once IT, Admin and Payroll have approved. Three steps on one sheet:
//   1. Team   — who reports to the joiner: HR pastes employee codes (or searches by name); the
//               plan shows how everybody under them shifts one level down (team-plan.ts) and
//               any member can be left out
//   2. Roles  — the ESS roles, by checkbox, with the union of module permissions they grant
//   3. Code   — the employee code (next type-wise number suggested) and what will happen
// Generating writes the employee record, the reporting lines, the ESS account with the roles,
// and mails the joiner their code and temporary password.
// APIs: /api/onboarding/managers (options), /api/onboarding/team-plan, /api/onboarding/generate-code.
import { useEffect, useMemo, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C as TK, Z, E } from '@/lib/ui'
import { PersonPicker, Avatar, PICKER_CSS, describe, type Emp } from './PeoplePicker'
import { parseCodes, autoRoleCodes, MANAGER_ROLE_CODES, NEW } from '@/lib/onboarding/team-plan'

const isManagerRole = (code: string) => (MANAGER_ROLE_CODES as readonly string[]).includes(code)

type Ref = { id: string; name: string; emp_code: string | null; designation: string | null } | null
type Role = { id: string; role_code: string; role_name: string; scope: string | null; salary_visibility: string | null; permissions: { module: string; access_level: string }[] }
type Chain = { l1: string | null; l2: string | null; hod: string | null }
type Member = { id: string; emp_code: string; full_name: string; designation: string | null; department: string | null; level: number; via: string | null; before: Chain; after: Chain; changed: ('L1' | 'L2' | 'HOD')[] }
type Plan = { joiner: { l1: Ref; l2: Ref; hod: Ref }; direct: Emp[]; unknown: string[]; members: Member[]; problems: string[]; warnings?: string[]; summary: string; names: Record<string, { name: string; emp_code: string | null }> }
type Options = { candidate: any; managers: { l1: Ref; l2: Ref; hod: Ref }; employees: Emp[]; roles: Role[] }
type Approval = { team: string; status: string }

const LABEL: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }
const LEVEL: Record<string, { label: string; color: string; bg: string }> = { VIEW: { label: 'View', color: TK.info, bg: TK.infoTint }, EDIT: { label: 'Edit', color: TK.warning, bg: TK.warningTint }, FULL: { label: 'Full', color: TK.positive, bg: TK.positiveTint } }
const first = (n?: string | null) => String(n || '').trim().split(/\s+/)[0] || ''

const CSS = `
  .gc-card{background:${TK.surface};color:${TK.ink};border-radius:14px;width:min(1080px,100%);margin:0 auto;box-shadow:${E.overlay};font-size:13px;overflow:hidden;display:grid;grid-template-columns:250px minmax(0,1fr);min-height:560px}
  .gc-rail{background:${TK.sunken};border-right:1px solid ${TK.line};padding:22px 18px;display:flex;flex-direction:column;gap:6px}
  .gc-kicker{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${TK.brand}}
  .gc-name{font-size:19px;font-weight:700;letter-spacing:-.01em;line-height:1.15;margin-top:3px}
  .gc-who{font-size:12px;color:${TK.inkSoft};margin-top:3px;line-height:1.4}
  .gc-step{display:flex;gap:11px;align-items:flex-start;padding:10px 10px;border-radius:10px;border:1px solid transparent;cursor:pointer;background:transparent;text-align:left;font-family:inherit;color:${TK.ink};width:100%}
  .gc-step:hover{background:${TK.surface}}
  .gc-step.on{background:${TK.surface};border-color:${TK.brandEdge};box-shadow:${E.flat}}
  .gc-step:disabled{cursor:not-allowed;opacity:.6}
  .gc-num{flex:none;width:24px;height:24px;border-radius:99px;border:2px solid ${TK.lineStrong};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:${TK.muted};background:${TK.surface}}
  .gc-step.on .gc-num{border-color:${TK.brand};color:${TK.brand}}
  .gc-step.done .gc-num{border-color:${TK.positive};background:${TK.positive};color:${TK.onAccent}}
  .gc-st{font-size:13px;font-weight:700;line-height:1.2}
  .gc-sd{font-size:11.5px;color:${TK.muted};line-height:1.35;margin-top:2px}
  .gc-main{display:flex;flex-direction:column;min-width:0}
  .gc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 26px 0}
  .gc-h{font-size:17px;font-weight:700;letter-spacing:-.01em}
  .gc-p{font-size:12.5px;color:${TK.inkSoft};margin-top:3px;line-height:1.45;max-width:640px}
  .gc-body{padding:16px 26px 20px;flex:1}
  .gc-foot{padding:14px 26px 18px;border-top:1px solid ${TK.line};display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:${TK.surface}}
  .gc-btn{padding:10px 18px;border-radius:9px;border:none;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;background:${TK.brand};color:${TK.onAccent}}
  .gc-btn.go{background:${TK.positive}}
  .gc-btn:disabled{opacity:.5;cursor:not-allowed}
  .gc-ghost{padding:8px 13px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;background:${TK.surface};color:${TK.brandDeep};border:1px solid ${TK.brandEdge}}
  .gc-ghost:disabled{opacity:.5;cursor:not-allowed}
  .gc-sub{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${TK.muted};margin-bottom:8px}
  .gc-stamp{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:700;border:1px solid}
  .gc-line{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .gc-mgr{display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid ${TK.line};border-radius:10px;background:${TK.sunken};min-width:0}
  .gc-mgr .lv{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${TK.muted}}
  .gc-mgr .nm{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gc-ta{width:100%;min-height:72px;padding:10px 12px;border:1px solid ${TK.lineStrong};border-radius:9px;font-size:13px;font-family:inherit;color:${TK.ink};background:${TK.surface};box-sizing:border-box;resize:vertical;line-height:1.5;letter-spacing:.02em}
  .gc-ta:focus{outline:none;border-color:${TK.brand};box-shadow:0 0 0 3px ${TK.brandTint}}
  .gc-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 6px 4px 5px;border-radius:99px;background:${TK.surface};border:1px solid ${TK.brandEdge};font-size:12px;font-weight:600}
  .gc-chip.bad{border-color:${TK.criticalEdge};background:${TK.criticalTint};color:${TK.critical};padding-left:10px}
  .gc-chip button{all:unset;cursor:pointer;width:18px;height:18px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;background:${TK.sunken};color:${TK.inkSoft}}
  .gc-chip button:hover{background:${TK.critical};color:${TK.onAccent}}
  .gc-tree{border:1px solid ${TK.line};border-radius:12px;overflow:hidden}
  .gc-row{display:grid;grid-template-columns:28px minmax(220px,1.3fr) repeat(3,minmax(120px,1fr));gap:10px;align-items:center;padding:9px 12px;border-top:1px solid ${TK.line};background:${TK.surface}}
  .gc-row.hd{background:${TK.sunken};border-top:none;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:${TK.muted};font-weight:700;padding:7px 12px}
  .gc-row.joiner{background:${TK.brandTint}}
  .gc-row.off{opacity:.55}
  .gc-row.off .gc-cell{text-decoration:none}
  .gc-cell{min-width:0;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .gc-cell small{display:block;font-size:10.5px;font-weight:500;color:${TK.muted};text-decoration:line-through}
  .gc-cell.ch{color:${TK.brandDeep}}
  .gc-cell.me{color:${TK.brand}}
  .gc-ind{display:flex;align-items:center;gap:9px;min-width:0}
  .gc-elbow{flex:none;width:14px;height:18px;border-left:2px solid ${TK.lineStrong};border-bottom:2px solid ${TK.lineStrong};border-radius:0 0 0 6px;margin-top:-16px}
  .gc-tick{width:18px;height:18px;border-radius:5px;border:2px solid ${TK.lineStrong};display:inline-flex;align-items:center;justify-content:center;background:${TK.surface};cursor:pointer;color:${TK.onAccent};font-size:12px;font-weight:800;padding:0}
  .gc-tick.on{background:${TK.positive};border-color:${TK.positive}}
  .gc-roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
  .gc-role{display:flex;gap:11px;align-items:flex-start;padding:12px 13px;border:1px solid ${TK.line};border-radius:12px;background:${TK.surface};cursor:pointer;text-align:left;font-family:inherit;color:${TK.ink};transition:border-color .12s,background .12s}
  .gc-role:hover{border-color:${TK.brandEdge};background:${TK.brandTint}}
  .gc-role.on{border-color:${TK.brand};background:${TK.brandTint};box-shadow:0 0 0 1px ${TK.brand} inset}
  .gc-role .t{font-size:13px;font-weight:700;line-height:1.2}
  .gc-role .m{font-size:11px;color:${TK.muted};margin-top:3px;line-height:1.4}
  .gc-perms{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px}
  .gc-perm{display:flex;justify-content:space-between;align-items:center;gap:6px;background:${TK.surface};border:1px solid ${TK.line};border-radius:8px;padding:6px 9px;font-size:12px}
  .gc-pill{font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px}
  .gc-code{width:100%;padding:14px 16px;border:1px solid ${TK.brandEdge};border-radius:12px;font-size:26px;font-weight:800;letter-spacing:.1em;font-family:inherit;box-sizing:border-box;background:${TK.surface};color:${TK.ink};text-align:center}
  .gc-code:focus{outline:none;border-color:${TK.brand};box-shadow:0 0 0 4px ${TK.brandTint}}
  .gc-will{display:grid;gap:8px}
  .gc-w{display:flex;gap:11px;align-items:flex-start;padding:10px 12px;border:1px solid ${TK.line};border-radius:10px;background:${TK.sunken}}
  .gc-w .i{flex:none;width:26px;height:26px;border-radius:99px;background:${TK.positiveTint};color:${TK.positive};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800}
  .gc-w .i.warn{background:${TK.warningTint};color:${TK.warning}}
  .gc-w b{font-weight:700}
  .gc-w .d{font-size:12px;color:${TK.inkSoft};margin-top:1px;line-height:1.4}
  .gc-note{font-size:12px;color:${TK.muted};line-height:1.45}
  .gc-warn{font-size:12.5px;color:${TK.warning};background:${TK.warningTint};border:1px solid ${TK.warningEdge};border-radius:9px;padding:9px 12px}
  .gc-err{font-size:12.5px;color:${TK.critical};background:${TK.criticalTint};border:1px solid ${TK.criticalEdge};border-radius:9px;padding:9px 12px}
  @media (max-width:820px){.gc-card{grid-template-columns:1fr}.gc-rail{border-right:none;border-bottom:1px solid ${TK.line};flex-direction:row;flex-wrap:wrap}.gc-rail>.gc-head{flex:1 1 100%}.gc-step{flex:1 1 140px}.gc-row{grid-template-columns:28px minmax(0,1fr)}.gc-row .gc-cell{display:none}.gc-row.hd{display:none}}
`

// ── Sub-components (outside the modal: typing never remounts them) ──────────────────────────

function Stamps({ approvals }: { approvals: Approval[] }) {
  return <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{approvals.map(a => { const ok = a.status === 'APPROVED'; return <span key={a.team} className="gc-stamp" style={{ color: ok ? TK.positive : TK.warning, borderColor: ok ? TK.positive : TK.warning, background: ok ? TK.positiveTint : TK.warningTint }}>{LABEL[a.team] || a.team} {ok ? '✓' : '· pending'}</span> })}</div>
}

function Mgr({ level, r }: { level: string; r: Ref }) {
  return <div className="gc-mgr">{r ? <Avatar name={r.name} size={26} tone="muted" /> : <span style={{ width: 26, height: 26, borderRadius: 99, border: `2px dashed ${TK.lineStrong}`, flex: 'none' }} />}<div style={{ minWidth: 0 }}><div className="lv">{level}</div><div className="nm" style={r ? {} : { color: TK.muted, fontWeight: 500 }}>{r ? r.name : 'not set'}</div></div></div>
}

function ChainCell({ id, before, changed, names, joiner }: { id: string | null; before: string | null; changed: boolean; names: Record<string, { name: string; emp_code: string | null }>; joiner: string }) {
  const nm = (x: string | null) => !x ? '—' : x === NEW ? joiner : names[x]?.name || '—'
  return <div className={`gc-cell${id === NEW ? ' me' : changed ? ' ch' : ''}`} title={id ? (names[id]?.emp_code || '') : ''}>{nm(id)}{changed && before && <small>{nm(before)}</small>}</div>
}

function TreeRows({ members, names, joiner, exclude, onToggle }: { members: Member[]; names: Record<string, { name: string; emp_code: string | null }>; joiner: string; exclude: Set<string>; onToggle: (id: string) => void }) {
  const kids = useMemo(() => { const m = new Map<string | null, Member[]>(); for (const x of members) { const l = m.get(x.via) || []; l.push(x); m.set(x.via, l) } return m }, [members])
  const render = (via: string | null, depth: number): React.ReactNode => (kids.get(via) || []).map(m => {
    const off = exclude.has(m.id)
    return (
      <div key={m.id}>
        <div className={`gc-row${off ? ' off' : ''}`}>
          <button type="button" className={`gc-tick${off ? '' : ' on'}`} onClick={() => onToggle(m.id)} title={off ? 'Left as they are — click to include' : 'Included — click to leave as they are'} aria-pressed={!off}>{off ? '' : '✓'}</button>
          <div className="gc-ind" style={{ paddingLeft: depth * 22 }}>
            {depth > 0 && <span className="gc-elbow" aria-hidden="true" />}
            <Avatar name={m.full_name} size={28} tone={depth === 0 ? 'brand' : 'muted'} />
            <div style={{ minWidth: 0 }}>
              <div className="gc-cell" style={{ fontWeight: 700 }}>{m.full_name}</div>
              <div style={{ fontSize: 10.5, color: TK.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[m.emp_code, m.designation, m.department].filter(Boolean).join(' · ')}{off ? ' · kept as is' : ''}</div>
            </div>
          </div>
          <ChainCell id={m.after.l1} before={m.before.l1} changed={m.changed.includes('L1')} names={names} joiner={joiner} />
          <ChainCell id={m.after.l2} before={m.before.l2} changed={m.changed.includes('L2')} names={names} joiner={joiner} />
          <ChainCell id={m.after.hod} before={m.before.hod} changed={m.changed.includes('HOD')} names={names} joiner={joiner} />
        </div>
        {!off && render(m.id, depth + 1)}
      </div>
    )
  })
  return <>{render(null, 0)}</>
}

// ── The modal ───────────────────────────────────────────────────────────────────────────────

export default function GenerateCodeModal({ onboardingId, candidate, onClose, onDone, onGenerated }: {
  onboardingId: string
  candidate: { full_name: string; designation?: string | null; department?: string | null; employment_type?: string | null; email?: string | null; date_of_joining?: string | null; approvals?: Approval[] }
  onClose: () => void; onDone: (msg: string, type?: 'ok' | 'err') => void
  /** The code exists: the page opens the Letter of Appointment next. */
  onGenerated?: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [opts, setOpts] = useState<Options | null>(null)
  const [err, setErr] = useState('')
  const [code, setCode] = useState(''); const [codeType, setCodeType] = useState(''); const [codeLoading, setCodeLoading] = useState(true)
  // The code is the company series' next number (never typed); `after` is the highest in use.
  // `ahead`: earlier arrivals of the company still without a code — FIFO, this one waits for them.
  const [after, setAfter] = useState<string | null>(null)
  const [ahead, setAhead] = useState<{ id: string; full_name: string; status: string; created_at: string }[]>([])
  // The joining date: required — it becomes company_doj on the employee record.
  const [doj, setDoj] = useState(candidate.date_of_joining ? String(candidate.date_of_joining).slice(0, 10) : '')
  const [paste, setPaste] = useState('')
  const [codes, setCodes] = useState<string[]>([])         // pasted employee codes
  const [ids, setIds] = useState<string[]>([])             // picked by name
  const [exclude, setExclude] = useState<Set<string>>(new Set())
  const [plan, setPlan] = useState<Plan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const name = candidate.full_name, fname = first(name)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const h = await authHeaders()
        const [o, c] = await Promise.all([
          fetch(`/api/onboarding/managers?onboarding_id=${onboardingId}`, { headers: h }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load'); return d as Options }),
          fetch(`/api/onboarding/generate-code?onboarding_id=${onboardingId}`, { headers: h }).then(r => r.json()).catch(() => ({})),
        ])
        if (!alive) return
        setOpts(o)
        const a = o.candidate?.assignment || {}
        if (Array.isArray(a.team?.direct)) setIds(a.team.direct)
        if (Array.isArray(a.team?.exclude)) setExclude(new Set(a.team.exclude))
        const prev: string[] = Array.isArray(a.roles) ? a.roles.map((r: any) => r.role_id) : a.role_id ? [a.role_id] : []
        setRoleIds(new Set(prev.filter((id: string) => o.roles.some(r => r.id === id && !isManagerRole(r.role_code)))))
        setCode(c.suggested || ''); setCodeType(c.employment_type || ''); setAfter(c.after || null); setAhead(Array.isArray(c.fifo_ahead) ? c.fifo_ahead : [])
      } catch (e: any) { if (alive) setErr(e.message) } finally { if (alive) setCodeLoading(false) }
    })()
    return () => { alive = false }
  }, [onboardingId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // The plan, re-drawn whenever the team or the exclusions change (debounced).
  const codesKey = codes.join(','), idsKey = ids.join(','), exKey = [...exclude].join(',')
  useEffect(() => {
    if (!opts) return
    let alive = true
    setPlanLoading(true)
    const t = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ onboarding_id: onboardingId, codes: codesKey, ids: idsKey, exclude: exKey })
        const r = await fetch(`/api/onboarding/team-plan?${q}`, { headers: await authHeaders() })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Could not draw the plan')
        if (alive) setPlan(d)
      } catch (e: any) { if (alive) onDone(e.message, 'err') } finally { if (alive) setPlanLoading(false) }
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [onboardingId, opts, codesKey, idsKey, exKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const addPaste = () => { const c = parseCodes(paste); if (!c.length) return; setCodes(s => [...new Set([...s, ...c])]); setPaste('') }
  const removeDirect = (e: Emp) => { setCodes(s => s.filter(c => c !== e.emp_code.toUpperCase())); setIds(s => s.filter(i => i !== e.id)) }
  const toggleEx = (id: string) => setExclude(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const roles = opts?.roles || []
  const toggleRole = (id: string) => { if (roles.some(r => r.id === id && isManagerRole(r.role_code))) return; setRoleIds(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }) }
  // The manager roles come from the team's depth (L1 → L2 → HOD), never from a tick.
  const includedForRoles = (plan?.members || []).filter(m => !exclude.has(m.id))
  const autoCodes = autoRoleCodes(includedForRoles)
  const autoRoles = roles.filter(r => autoCodes.includes(r.role_code))
  const chosenRoles = [...roles.filter(r => roleIds.has(r.id) && !isManagerRole(r.role_code)), ...autoRoles]
  const union = useMemo(() => {
    const rank: Record<string, number> = { VIEW: 1, EDIT: 2, FULL: 3 }
    const m = new Map<string, string>()
    for (const r of chosenRoles) for (const p of r.permissions) { const cur = m.get(p.module); if (!cur || (rank[p.access_level] || 0) > (rank[cur] || 0)) m.set(p.module, p.access_level) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [chosenRoles])
  const approvals = candidate.approvals || []
  const pending = approvals.filter(a => a.status !== 'APPROVED').map(a => LABEL[a.team] || a.team)
  const managers = opts?.managers
  const hasL1 = !!managers?.l1
  const members = plan?.members || []
  const included = members.filter(m => !exclude.has(m.id))
  const changes = included.reduce((n, m) => n + m.changed.length, 0)
  const directIn = (plan?.direct || []).filter(d => !exclude.has(d.id))

  async function generate() {
    if (!code.trim()) { onDone('Type or accept the employee code.', 'err'); return }
    if (!doj) { onDone('Set the date of joining — it goes on the employee record.', 'err'); return }
    if (!chosenRoles.length) { setStep(2); onDone('Tick at least one role.', 'err'); return }
    setBusy(true)
    try {
      const body = { onboarding_id: onboardingId, date_of_joining: doj, role_ids: chosenRoles.map(r => r.id), team: { direct: (plan?.direct || []).map(d => d.id), exclude: [...exclude] } }
      const post = async (force: boolean) => { const r = await fetch('/api/onboarding/generate-code', { method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, force }) }); return { r, d: await r.json() } }
      let { r, d } = await post(false)
      if (r.status === 409 && Array.isArray(d.pending) && d.pending.length) {
        if (!window.confirm(`Still waiting on ${d.pending.join(', ')} approval${d.pending.length > 1 ? 's' : ''}.\n\nGenerate the employee code anyway?`)) { setBusy(false); return }
        ;({ r, d } = await post(true))
      }
      if (!r.ok) throw new Error(d.error || 'Failed')
      const c = d.employee_code || code
      if (d.employee_synced === false) onDone(`Code ${c} generated, but Employee Master sync FAILED: ${d.sync_error || 'unknown error'}`, 'err')
      else onDone(`✓ ${c} generated for ${name} — in the Employee Master${d.team_changes ? `, ${d.team_changes} reporting line${d.team_changes === 1 ? '' : 's'} of their team re-pointed` : ''}${d.credentials_mailed ? `, login details mailed to ${candidate.email || 'the joiner'}` : `; login mail NOT sent (${d.credentials_error || 'see Roles & access'})`}.${(d.role_warnings || []).length ? ` Warnings: ${d.role_warnings.join('; ')}` : ''}`, d.credentials_mailed ? 'ok' : 'err')
      if (d.employee_synced !== false) onGenerated?.()
      onClose()
    } catch (e: any) { onDone(e.message, 'err') } finally { setBusy(false) }
  }

  const steps: { n: 1 | 2 | 3; t: string; d: string; done: boolean }[] = [
    { n: 1, t: 'Team', d: included.length ? plan?.summary || '' : `Who reports to ${fname}`, done: step > 1 },
    { n: 2, t: 'Roles', d: chosenRoles.length ? chosenRoles.map(r => r.role_name).join(', ') : 'What they can open in ESS', done: step > 2 && chosenRoles.length > 0 },
    { n: 3, t: 'Code', d: code ? code : 'Generate & mail the login', done: false },
  ]

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: Z.modal, overflowY: 'auto', padding: '28px 12px 40px', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      <style>{CSS}{PICKER_CSS}</style>
      <div className="gc-card" role="dialog" aria-label="Generate employee code">
        {/* ── Rail ── */}
        <aside className="gc-rail">
          <div className="gc-head" style={{ marginBottom: 14 }}>
            <div className="gc-kicker">Generate employee code</div>
            <div className="gc-name">{name}</div>
            <div className="gc-who">{[candidate.designation, candidate.department, candidate.employment_type || 'Employee'].filter(Boolean).join(' · ')}</div>
            <div style={{ marginTop: 10 }}><Stamps approvals={approvals} /></div>
          </div>
          {steps.map(s => (
            <button key={s.n} type="button" className={`gc-step${step === s.n ? ' on' : ''}${s.done ? ' done' : ''}`} onClick={() => setStep(s.n)} disabled={busy}>
              <span className="gc-num">{s.done ? '✓' : s.n}</span>
              <span style={{ minWidth: 0 }}><span className="gc-st">{s.t}</span><span className="gc-sd" style={{ display: 'block' }}>{s.d}</span></span>
            </button>
          ))}
          <div style={{ marginTop: 'auto', paddingTop: 14, fontSize: 11, color: TK.muted, lineHeight: 1.45 }}>The managers were set on the review sheet. Everything here lands on the employee record the moment the code is generated.</div>
        </aside>

        {/* ── Main ── */}
        <div className="gc-main">
          <div className="gc-top">
            <div style={{ minWidth: 0 }}>
              {step === 1 && <><div className="gc-h">Who reports to {fname}?</div><div className="gc-p">Paste the employee codes of their direct reports, or search by name. Everybody under them moves one step down: their reports get <b>{fname}</b> as L1, {managers?.l1 ? <b>{first(managers.l1.name)}</b> : 'the L1'} as L2 and {managers?.l2 ? <b>{first(managers.l2.name)}</b> : managers?.hod ? <b>{first(managers.hod.name)}</b> : 'the L2'} as HOD; the people under those reports get {fname} as L2 — and so on. Untick anybody who should stay as they are.</div></>}
              {step === 2 && <><div className="gc-h">What can {fname} open in ESS?</div><div className="gc-p">Tick one or more roles. Every employee gets the employee portal; a role adds the modules below it. The permissions of all ticked roles add up. <b>L1 Manager, L2 Manager and HOD are not ticked by hand</b> — they follow the team from step 1: people reporting to {fname} make them an L1 manager, people under those an L2 manager too, and a third level the HOD as well.</div></>}
              {step === 3 && <><div className="gc-h">The employee code</div><div className="gc-p">The code is the next number in the company's series — the highest one in use plus one, gaps are never filled — and it is taken the moment you generate. Codes go out in the order candidates came into Onboarding. Here is what happens when you press Generate.</div></>}
            </div>
            <button onClick={onClose} className="gc-ghost" aria-label="Close" disabled={busy}>✕ Close</button>
          </div>

          <div className="gc-body">
            {err && <div className="gc-err">{err}</div>}
            {!err && !opts && <div style={{ color: TK.muted, padding: '20px 0' }}>Loading…</div>}
            {opts && step === 1 && (
              <div style={{ display: 'grid', gap: 18 }}>
                <div>
                  <div className="gc-sub">{fname}'s own reporting line · set on the review sheet</div>
                  <div className="gc-line"><Mgr level="L1 · reporting manager" r={managers?.l1 || null} /><Mgr level="L2" r={managers?.l2 || null} /><Mgr level="HOD" r={managers?.hod || null} /></div>
                  {!hasL1 && <div className="gc-warn" style={{ marginTop: 8 }}>The managers are not assigned. Close this, open <b>View form</b> on the card and press <b>Assign managers</b>; the code cannot be generated without the L1.</div>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 14 }}>
                  <div>
                    <div className="gc-sub">Paste employee codes</div>
                    <textarea className="gc-ta" value={paste} onChange={e => setPaste(e.target.value)} placeholder={'e.g. STC9022, STC9007\nSTC9073 — one per line, or separated by commas or spaces'} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addPaste() } }} />
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                      <button type="button" className="gc-ghost" onClick={addPaste} disabled={!parseCodes(paste).length}>+ Add {parseCodes(paste).length || ''} {parseCodes(paste).length === 1 ? 'code' : 'codes'}</button>
                      <span className="gc-note">⌘/Ctrl + Enter adds them too.</span>
                    </div>
                  </div>
                  <div>
                    <div className="gc-sub">Or search by name</div>
                    <PersonPicker label="" value="" onChange={id => { if (id) setIds(s => (s.includes(id) ? s : [...s, id])) }} employees={opts.employees} exclude={[...ids, ...(plan?.direct || []).map(d => d.id)]} placeholder="Type a name — they are added as a direct report" />
                  </div>
                </div>

                {(plan?.direct.length || plan?.unknown.length) ? (
                  <div>
                    <div className="gc-sub">Direct reports · {directIn.length}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {plan!.direct.map(d => <span key={d.id} className="gc-chip" style={exclude.has(d.id) ? { opacity: .55 } : {}} title={describe(d)}><Avatar name={d.full_name} size={20} tone="brand" />{d.full_name} <span style={{ color: TK.muted, fontWeight: 500 }}>{d.emp_code}</span><button type="button" onClick={() => removeDirect(d)} aria-label={`Remove ${d.full_name}`}>×</button></span>)}
                      {plan!.unknown.map(u => <span key={u} className="gc-chip bad" title="No active employee has this code in this company">{u} · not found<button type="button" onClick={() => setCodes(s => s.filter(c => c !== u))} aria-label={`Remove ${u}`}>×</button></span>)}
                    </div>
                  </div>
                ) : null}
                {plan?.problems.map(p => <div key={p} className="gc-err">{p}</div>)}
                {plan?.warnings?.map(w => <div key={w} className="gc-warn">{w}</div>)}

                <div>
                  <div className="gc-sub" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>Reporting-line plan{planLoading ? ' · updating…' : ''}</span><span style={{ color: changes ? TK.brandDeep : TK.muted }}>{included.length ? `${included.length} ${included.length === 1 ? 'person' : 'people'} · ${changes} change${changes === 1 ? '' : 's'}` : ''}</span></div>
                  <div className="gc-tree">
                    <div className="gc-row hd"><span /><span>Person</span><span>L1</span><span>L2</span><span>HOD</span></div>
                    <div className="gc-row joiner">
                      <span /><div className="gc-ind"><Avatar name={name} size={28} /><div style={{ minWidth: 0 }}><div className="gc-cell" style={{ fontWeight: 700 }}>{name} <span style={{ fontSize: 10, color: TK.brand, fontWeight: 700, letterSpacing: '.06em' }}>JOINER</span></div><div style={{ fontSize: 10.5, color: TK.muted }}>{[candidate.designation, candidate.department].filter(Boolean).join(' · ') || 'the new employee'}</div></div></div>
                      <div className="gc-cell">{managers?.l1?.name || '—'}</div><div className="gc-cell">{managers?.l2?.name || '—'}</div><div className="gc-cell">{managers?.hod?.name || '—'}</div>
                    </div>
                    {members.length === 0 && <div style={{ padding: '18px 14px', fontSize: 12.5, color: TK.muted, borderTop: `1px solid ${TK.line}` }}>Nobody reports to {fname} yet — that is fine. Add their team above, or go on to Roles.</div>}
                    {members.length > 0 && plan && <TreeRows members={members} names={plan.names} joiner={name} exclude={exclude} onToggle={toggleEx} />}
                  </div>
                  {members.length > 0 && <div className="gc-note" style={{ marginTop: 6 }}>Struck-through names are today's managers that change. A ticked person is re-pointed when the code is generated; an unticked one is left as they are, and the tree is not followed below them.</div>}
                </div>
              </div>
            )}

            {opts && step === 2 && (
              <div style={{ display: 'grid', gap: 18 }}>
                <div className="gc-roles">
                  {roles.map(r => {
                    const mgr = isManagerRole(r.role_code), on = mgr ? autoCodes.includes(r.role_code) : roleIds.has(r.id)
                    const why = r.role_code === 'L1_MANAGER' ? 'when somebody reports to them' : r.role_code === 'L2_MANAGER' ? 'when their reports have reports' : 'when the team is three levels deep'
                    return (
                    <button key={r.id} type="button" className={`gc-role${on ? ' on' : ''}`} onClick={() => toggleRole(r.id)} aria-pressed={on} disabled={mgr} style={mgr ? { cursor: 'not-allowed', opacity: on ? 1 : .6 } : undefined} title={mgr ? `Assigned automatically ${why} (step 1 · Team)` : undefined}>
                      <span className={`gc-tick${on ? ' on' : ''}`} style={{ marginTop: 1 }}>{on ? '✓' : ''}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="t" style={{ display: 'block' }}>{r.role_name}{mgr && <span className="gc-pill" style={{ marginLeft: 6, color: on ? TK.positive : TK.muted, background: on ? TK.positiveTint : TK.sunken, verticalAlign: 1 }}>{on ? 'auto · from the team' : 'auto'}</span>}</span>
                        <span className="m" style={{ display: 'block' }}>{mgr ? <>Assigned {why}<br /></> : null}{r.role_code}{r.scope ? ` · scope ${r.scope.toLowerCase()}` : ''}{r.salary_visibility && r.salary_visibility !== 'NONE' ? ` · salary ${r.salary_visibility.toLowerCase()}` : ''}<br />{r.permissions.length ? `${r.permissions.length} module${r.permissions.length === 1 ? '' : 's'}` : 'employee portal only'}</span>
                      </span>
                    </button>) })}
                  {roles.length === 0 && <div className="gc-note">No roles are set up yet — add them under Roles & access.</div>}
                </div>
                <div>
                  <div className="gc-sub">What {fname} will be able to open{chosenRoles.length ? ` · ${chosenRoles.map(r => r.role_name).join(' + ')}` : ''}</div>
                  {chosenRoles.length === 0 ? <div className="gc-note">Tick a role above to see its modules.</div>
                    : union.length === 0 ? <div className="gc-note">The employee portal only — no admin module.</div>
                    : <div className="gc-perms">{union.map(([mod, lv]) => { const L = LEVEL[lv] || { label: lv, color: TK.muted, bg: TK.sunken }; return <div key={mod} className="gc-perm"><span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mod}</span><span className="gc-pill" style={{ color: L.color, background: L.bg }}>{L.label}</span></div> })}</div>}
                </div>
              </div>
            )}

            {opts && step === 3 && (
              <div style={{ display: 'grid', gap: 18 }}>
                <div>
                  <div className="gc-sub">Employee code{codeType ? ` · ${codeType}` : ''}</div>
                  <input className="gc-code" value={code} readOnly placeholder={codeLoading ? '…' : ''} spellCheck={false} style={{ background: TK.sunken, cursor: 'default' }} />
                  <div className="gc-note" style={{ marginTop: 6, textAlign: 'center' }}>{codeLoading ? 'Working out the next code…' : after ? `Next in the series after ${after} — not editable.` : 'First code in this company\'s series — not editable.'}</div>
                </div>
                {ahead.length > 0 && (
                  <div className="gc-err">
                    <b>Not their turn yet.</b> {ahead.length === 1 ? `${ahead[0].full_name} came into Onboarding first and has no employee code yet` : `${ahead.length} candidates came into Onboarding first and have no employee code yet (${ahead.map(a => a.full_name).join(', ')})`}. Codes go out in that order — generate theirs first.
                  </div>
                )}
                <div>
                  <div className="gc-sub">Date of joining <span style={{ color: TK.critical }}>*</span>{candidate.date_of_joining ? '' : ' · not set on the onboarding'}</div>
                  <input type="date" className="gc-ta" style={{ minHeight: 0, padding: '10px 12px', maxWidth: 260, borderColor: doj ? TK.lineStrong : TK.warning }} value={doj} onChange={e => setDoj(e.target.value)} />
                  <div className="gc-note" style={{ marginTop: 4 }}>Goes on the employee record as the company joining date — tenure, payroll and the letters read it.</div>
                </div>
                <div className="gc-will">
                  <div className="gc-w"><span className="i">1</span><div><b>Employee Master</b><div className="d">{name} is created as an Active employee with every detail from the form, the IT / Admin / Payroll checklists and the salary structure Payroll approved.{opts.candidate?.hiring_track === 'FOREIGN_IN_INDIA' ? ' Foreign national in India: passport, visa and FRRO dates go on the record and into the immigration tracker; PF as an International Worker unless SSA-exempt.' : opts.candidate?.hiring_track === 'OVERSEAS' ? ` Overseas employee (${opts.candidate.work_country || 'abroad'}${opts.candidate.payroll_currency ? `, ${opts.candidate.payroll_currency}` : ''}): no PF / ESIC / PT, outside the Indian payroll run${opts.candidate.employing_entity ? `, employed via ${opts.candidate.employing_entity}` : ''}.` : ''}</div></div></div>
                  <div className="gc-w"><span className={`i${hasL1 ? '' : ' warn'}`}>2</span><div><b>Reporting line</b><div className="d">{hasL1 ? <>L1 {managers!.l1!.name}{managers?.l2 ? ` · L2 ${managers.l2.name}` : ''}{managers?.hod ? ` · HOD ${managers.hod.name}` : ''}</> : 'Not assigned — Assign managers on the review sheet first.'}</div></div></div>
                  <div className="gc-w"><span className="i">3</span><div><b>Team</b><div className="d">{included.length ? `${plan?.summary} — ${included.filter(m => m.level === 1).map(m => first(m.full_name)).join(', ')}${included.some(m => m.level > 1) ? ' and their teams' : ''}.` : `Nobody reports to ${fname} yet.`}</div></div></div>
                  <div className="gc-w"><span className={`i${chosenRoles.length ? '' : ' warn'}`}>4</span><div><b>ESS access</b><div className="d">{chosenRoles.length ? `${chosenRoles.map(r => autoRoles.includes(r) ? `${r.role_name} (auto, from the team)` : r.role_name).join(' + ')} · ${union.length} module${union.length === 1 ? '' : 's'}` : 'No role ticked yet — go back to Roles.'}</div></div></div>
                  <div className="gc-w"><span className={`i${candidate.email ? '' : ' warn'}`}>5</span><div><b>Login mailed</b><div className="d">{candidate.email ? <>The employee code and a temporary password go to <b>{candidate.email}</b>; they set their own password on first login.</> : 'The candidate has no email on file — the login will have to be shared from Roles & access.'}</div></div></div>
                </div>
                {pending.length > 0 && <div className="gc-warn">Still waiting on {pending.join(', ')} — you will be asked to confirm before the code is generated.</div>}
              </div>
            )}
          </div>

          <div className="gc-foot">
            {step > 1 && <button type="button" className="gc-ghost" onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)} disabled={busy}>← Back</button>}
            {step < 3 && <button type="button" className="gc-btn" onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)} disabled={!opts || busy || (step === 2 && !chosenRoles.length)}>{step === 1 ? (included.length ? `Next · Roles` : 'Skip team · Roles') : 'Next · Code'} →</button>}
            {step === 3 && <button type="button" className="gc-btn go" onClick={generate} disabled={!opts || busy || codeLoading || !code.trim() || !doj || !chosenRoles.length || !hasL1 || ahead.length > 0} title={ahead.length ? `Waiting for ${ahead[0].full_name}'s code first (FIFO)` : !hasL1 ? 'Assign the managers first' : !chosenRoles.length ? 'Tick a role first' : doj ? '' : 'Set the date of joining first'}>{busy ? 'Generating…' : ahead.length ? `⏳ Waiting for ${ahead[0].full_name.split(' ')[0]}'s code` : '⚡ Generate code & create employee'}</button>}
            <span className="gc-note" style={{ marginLeft: 'auto' }}>
              {step === 1 && (included.length ? `${plan?.summary}${autoCodes.length ? ` · roles: ${autoCodes.map(c => c.replace('_MANAGER', '').replace('L1', 'L1 Manager').replace('L2', 'L2 Manager')).join(', ')}` : ''}` : 'The team is optional.')}
              {step === 2 && (chosenRoles.length ? `${chosenRoles.length} role${chosenRoles.length === 1 ? '' : 's'}${autoRoles.length ? ` (${autoRoles.length} from the team)` : ''}` : 'At least one role is required.')}
              {step === 3 && (ahead.length ? 'First come, first coded.' : !hasL1 ? 'Assign the managers on the review sheet first: the L1 is required.' : !chosenRoles.length ? 'Tick at least one role (step 2).' : doj ? 'Numbers are never reused.' : 'The date of joining is required.')}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
