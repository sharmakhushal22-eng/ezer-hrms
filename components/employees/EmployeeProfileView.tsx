'use client'
// components/employees/EmployeeProfileView.tsx — one employee's record: Personal,
// Employment, Statutory, Bank.
//
// This used to live inside app/dashboard/employees/page.tsx as a closure over that
// screen's edit state, so only HR could ever see it. An employee looking at their own
// profile in ESS got a different, thinner screen — different fields, different order,
// different answers to the same question. There is one record; there should be one way
// of reading it.
//
// So the four sections moved here, verbatim, and both screens render this:
//   · Employee Master  passes editMode/editForm/setEditForm and gets the editable form
//   · ESS Profile      passes nothing and gets the same layout, read-only
//
// Everything past Bank — Documents, Salary, Onboarding, HR Actions, History — stays in
// the master screen. Those are HR's tools for working ON somebody, not a view of them.
//
// Layout: each group is a card with a plain heading, fields sit in a responsive grid
// with the label above the value, and a group with nothing in it says so rather than
// printing a column of dashes.
import type React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import EmployeeOrgFlow from '@/components/rms/EmployeeOrgFlow'
import HRActionPanel from '@/components/employees/HRActionPanel'
import { C, F, W, S, R, E, M, tone, numeric, eyebrow, inputStyle, Badge, type Tone } from '@/lib/ui'

export const P = {
  navy: C.ink, purple: C.brand, purpleDark: C.brandDeep,
  purpleBg: C.brandTint, purpleLight: C.sunken,
  border: C.line, card: C.surface, page: C.canvas,
  text: C.ink, muted: C.muted, green: C.positive, greenBg: tone('positive').bg,
  red: C.critical, redBg: tone('critical').bg, amber: C.warning, amberBg: tone('warning').bg,
}

/** Blank is null, undefined or ''. Zero and false are values. */
export const isBlank = (v: any) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
export const fmt = (v: any) => isBlank(v) ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)
/** "01 Jan 2010". Four-digit years: "01 Jan 10" cannot be told apart from 1910 or a
 *  day-month pair at a glance, and a date of birth is exactly where that matters. */
export const fmtDate = (v: string | null | undefined) => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
/** "3y 4m" from a joining date, or '—'. */
export const tenureOf = (v: string | null | undefined) => {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
  if (now.getDate() < d.getDate()) m -= 1
  if (m < 0) return '—'
  const y = Math.floor(m / 12), r = m % 12
  return y ? `${y}y ${r}m` : `${r}m`
}

// ── shared skins ─────────────────────────────────────────────────────────
const FIELD_H = 36
const labelStyle: React.CSSProperties = {
  fontSize: F.tiny, fontWeight: W.medium, color: C.muted, marginBottom: 5, lineHeight: 1.3,
}
const ctl: React.CSSProperties = { ...inputStyle(), height: FIELD_H, fontSize: F.small }
/** inputStyle() sets outline:none, which also removes the global focus ring, so focus
 *  is drawn here instead. Mutating the element's own style keeps this stateless. */
export const focusOn = (e: React.FocusEvent<HTMLElement>) => {
  e.currentTarget.style.borderColor = C.brand
  e.currentTarget.style.boxShadow = `0 0 0 3px ${C.brandTint}`
}
export const focusOff = (e: React.FocusEvent<HTMLElement>) => {
  e.currentTarget.style.borderColor = C.lineStrong
  e.currentTarget.style.boxShadow = 'none'
}

/** One labelled value. In edit mode the value becomes a control of the same height, so
 *  switching modes does not reflow the grid. `readOnly` keeps a field static in edit
 *  mode — drawn as a disabled control so it is plainly not forgotten, just not editable. */
export function Field({ label, value, editMode, fieldKey, editForm, setEditForm, type, opts, readOnly, mono, wide, reserve: reserveProp }: {
  label: string; value?: React.ReactNode; editMode?: boolean; fieldKey?: string
  editForm?: Record<string, any>; setEditForm?: (fn: any) => void
  type?: string; opts?: string[]; readOnly?: boolean; mono?: boolean; wide?: boolean
  /** Reserve the control height in view mode. Defaults to "this record can be edited". */
  reserve?: boolean
}) {
  const editable = !!(editMode && setEditForm && fieldKey && !readOnly)
  // Reserve the control height wherever the record CAN be edited, so view and edit
  // modes line up. The read-only ESS rendering stays compact.
  const reserve = reserveProp ?? !!setEditForm
  const set = (v: string) => setEditForm?.((p: any) => ({ ...p, [fieldKey as string]: v }))
  const empty = value === undefined || value === null || value === '' || value === '—'
  const raw = editForm?.[fieldKey as string]

  let body: React.ReactNode
  if (editable && opts) {
    body = (
      <select style={{ ...ctl, cursor: 'pointer' }} value={raw ?? ''} onFocus={focusOn} onBlur={focusOff}
              onChange={e => set(e.target.value)}>
        <option value="">Select…</option>
        {opts.map(o => <option key={o}>{o}</option>)}
        {/* A stored value outside the list stays selectable rather than vanishing. */}
        {raw && !opts.includes(raw) && <option>{raw}</option>}
      </select>
    )
  } else if (editable) {
    body = (
      <input type={type || 'text'} style={{ ...ctl, ...(mono ? numeric : null) }}
             value={type === 'date' ? String(raw ?? '').slice(0, 10) : (raw ?? '')}
             onFocus={focusOn} onBlur={focusOff}
             onChange={e => set(e.target.value)} />
    )
  } else if (editMode && reserve) {
    body = (
      <div title="Not editable here" style={{
        ...ctl, display: 'flex', alignItems: 'center', background: C.sunken,
        borderColor: C.line, color: empty ? C.faint : C.muted, overflow: 'hidden',
        whiteSpace: 'nowrap', textOverflow: 'ellipsis', ...(mono ? numeric : null),
      }}>{empty ? '—' : value}</div>
    )
  } else {
    body = (
      <div style={{
        minHeight: reserve ? FIELD_H : undefined, display: 'flex', alignItems: 'center',
        fontSize: F.small, fontWeight: empty ? W.regular : W.medium,
        color: empty ? C.faint : C.ink, lineHeight: 1.45, overflowWrap: 'anywhere',
        ...(mono ? { ...numeric, letterSpacing: '.02em' } : null),
      }}>{empty ? '—' : value}</div>
    )
  }

  return (
    <div style={{ minWidth: 0, gridColumn: wide ? '1 / -1' : undefined }}>
      <div style={labelStyle}>{label}</div>
      {body}
    </div>
  )
}

/** A titled card. `empty` replaces the body with one line saying nothing is recorded. */
export function Section({ title, hint, actions, empty, emptyText, children }: {
  title: string
  /** Accepted for older callers; no longer drawn. */
  icon?: string
  hint?: React.ReactNode; actions?: React.ReactNode
  empty?: boolean; emptyText?: string
  children?: React.ReactNode
}) {
  return (
    <section style={{
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg,
      boxShadow: E.flat, padding: `${S.lg}px ${S.lg + 2}px`, marginBottom: S.md, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    gap: S.md, flexWrap: 'wrap', marginBottom: empty ? S.sm : S.lg }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: F.body, fontWeight: W.semi, color: C.ink, letterSpacing: '-.005em' }}>{title}</h3>
          {hint && <div style={{ marginTop: 3, fontSize: F.tiny, color: C.muted, lineHeight: 1.5, maxWidth: 640 }}>{hint}</div>}
        </div>
        {actions}
      </div>
      {empty
        ? <div style={{ fontSize: F.small, color: C.faint }}>{emptyText || `No ${title.toLowerCase()} on record yet.`}</div>
        : children}
    </section>
  )
}

/** The field grid. Named Grid2 for its callers; it is as many columns as fit. */
export function Grid2({ children, min = 220 }: { children: React.ReactNode; min?: number }) {
  return (
    <div style={{
      display: 'grid', gap: `${S.md + 2}px ${S.xl}px`,
      gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`,
    }}>{children}</div>
  )
}

/** A small heading inside a card, for a second group of fields. */
function SubHead({ children }: { children: React.ReactNode }) {
  return <div style={{ ...eyebrow, margin: `${S.lg + 2}px 0 ${S.md}px`, paddingTop: S.md, borderTop: `1px solid ${C.line}` }}>{children}</div>
}

/** Label-over-value facts, as many columns as fit. Used by the record header. */
export function FactsGrid({ facts, min = 150 }: { facts: { l: string; v: React.ReactNode }[]; min?: number }) {
  return (
    <dl style={{
      margin: 0, display: 'grid', gap: `${S.md}px ${S.xl}px`,
      gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`,
    }}>
      {facts.map(x => {
        const empty = x.v === undefined || x.v === null || x.v === '' || x.v === '—'
        return (
          <div key={x.l} style={{ minWidth: 0 }}>
            <dt style={{ ...eyebrow, fontWeight: W.semi, marginBottom: 4 }}>{x.l}</dt>
            <dd style={{
              margin: 0, fontSize: F.small, fontWeight: empty ? W.regular : W.semi,
              color: empty ? C.faint : C.ink, lineHeight: 1.4, overflowWrap: 'anywhere', ...numeric,
            }}>{empty ? '—' : x.v}</dd>
          </div>
        )
      })}
    </dl>
  )
}

// ── Other Info — the employee's role line, straight from the role-upload sheet ──
// RM1/RM2/HOD are per-employee (from their own manager columns). The company-level
// holders are exactly the sheet's values — one person per role — resolved by the
// emp_codes the sheet carries for every employee. Read-only, one value per field.
const SHEET_COMPANY_HOLDERS: [string, string][] = [
  ['HR Head', 'SRS9047'],
  ['HR Manager', 'SRS9010'],
  ['Payroll Manager', 'SRS9066'],
  ['Admin Manager', 'SRS9016'],
  ['IT Manager', 'SRS9062'],
  ['Finance Executive', 'SRS9074'],
  ['Branch HR Executive', 'STC9040'],
]

export function OtherInfoSection({ emp }: { emp: any }) {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    if (!emp?.id) return
    let live = true
    ;(async () => {
      // Self-contained: fetch this employee's own hierarchy row so the section works
      // with just an id (ESS) or a full emp object (Employee Master).
      const { data: selfRow } = await supabase.from('employees')
        .select('id, l1_manager_id, l2_manager_id, hod_id, departments!employees_department_id_fkey(dept_name)')
        .eq('id', emp.id).maybeSingle()
      const self: any = selfRow || emp

      // Resolve RM1/RM2/HOD (by id) and the fixed sheet holders (by emp_code) together.
      const ids = [self.l1_manager_id, self.l2_manager_id, self.hod_id].filter(Boolean)
      const codes = SHEET_COMPANY_HOLDERS.map(([, c]) => c)
      const PSEL = 'id, emp_code, full_name, departments!employees_department_id_fkey(dept_name)'
      const [byIdRes, byCodeRes] = await Promise.all([
        ids.length
          ? supabase.from('employees').select(PSEL).in('id', ids)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('employees').select(PSEL).in('emp_code', codes),
      ])
      const mById: Record<string, any> = {}
      ;(byIdRes.data || []).forEach((m: any) => { mById[m.id] = m })
      const mByCode: Record<string, any> = {}
      ;(byCodeRes.data || []).forEach((m: any) => { mByCode[m.emp_code] = m })
      // "Full Name (EMP_CODE) (Department)"
      const fmt = (e: any) => { const d = e?.departments?.dept_name; return `${e.full_name} (${e.emp_code})${d ? ` (${d})` : ''}` }
      const nameById = (id: string | null) => (id && mById[id]) ? fmt(mById[id]) : '—'
      const nameByCode = (c: string) => mByCode[c] ? fmt(mByCode[c]) : '—'
      // The hierarchy must never look empty: a missing RM1 / RM2 / HOD slot is filled
      // from whatever else the chain has, in the sensible order for that slot — even if
      // that repeats a name across two lines. (140 employees have no L2 set; their L2
      // then shows their HOD, and so on.)
      const rm1Id = self.l1_manager_id || self.l2_manager_id || self.hod_id || null
      const rm2Id = self.l2_manager_id || self.hod_id || self.l1_manager_id || null
      const hodId = self.hod_id || self.l2_manager_id || self.l1_manager_id || null

      // The employee's own role(s).
      let ownRoles: string[] = []
      const { data: acct } = await supabase.from('ess_accounts').select('id').eq('employee_id', emp.id).maybeSingle()
      if (acct?.id) {
        const { data: ur } = await supabase.from('ess_user_roles')
          .select('ess_roles(role_name)').eq('ess_account_id', acct.id).eq('is_active', true)
        ownRoles = (ur || []).map((r: any) => r.ess_roles?.role_name).filter(Boolean)
      }
      // Every person is an Employee — that base role is automatic, so it always shows,
      // even for a brand-new record with no account or assigned roles yet.
      if (!ownRoles.some(r => r.toLowerCase() === 'employee')) ownRoles = ['Employee', ...ownRoles]

      const dept = self.departments?.dept_name || emp.departments?.dept_name || emp.dept_name || '—'
      if (live) setData({
        dept, ownRoles,
        rm1: nameById(rm1Id), rm2: nameById(rm2Id), hod: nameById(hodId),
        holders: SHEET_COMPANY_HOLDERS.map(([label, code]) => [label, nameByCode(code)] as [string, string]),
      })
    })()
    return () => { live = false }
  }, [emp?.id])

  return (
    <Section title="Other info" hint="Read-only. Reporting lines come from the employee's manager fields; company role holders from the role sheet.">
      {!data ? <div style={{ fontSize: F.small, color: C.muted }}>Loading…</div> : (
        <>
          <Grid2>
            <Field label="Role" value={data.ownRoles.length ? data.ownRoles.join(', ') : '—'} />
            <Field label="Department" value={data.dept} />
            <Field label="Reporting manager 1" value={data.rm1} />
            <Field label="Reporting manager 2" value={data.rm2} />
            <Field label="HOD" value={data.hod} />
          </Grid2>
          <SubHead>Company role holders</SubHead>
          <Grid2>
            {data.holders.map(([label, val]: [string, string]) => <Field key={label} label={label} value={val} />)}
          </Grid2>
        </>
      )}
    </Section>
  )
}

// The employee's ESS role(s), read-only — shown in Employment Details on the Employee
// Master. Roles are assigned in ESS & Roles, not here, so this is display-only. Every
// person is an Employee (that base role is automatic), so it always shows at least that.
export function EmpRoleField({ emp, reserve }: { emp: any; reserve?: boolean }) {
  const [roles, setRoles] = useState<string[] | null>(null)
  useEffect(() => {
    if (!emp?.id) { setRoles(null); return }
    let live = true
    ;(async () => {
      let names: string[] = []
      const { data: acct } = await supabase.from('ess_accounts').select('id').eq('employee_id', emp.id).maybeSingle()
      if (acct?.id) {
        const { data: ur } = await supabase.from('ess_user_roles')
          .select('ess_roles(role_name)').eq('ess_account_id', acct.id).eq('is_active', true)
        names = (ur || []).map((r: any) => r.ess_roles?.role_name).filter(Boolean)
      }
      if (!names.some(n => n.toLowerCase() === 'employee')) names = ['Employee', ...names]
      if (live) setRoles(names)
    })()
    return () => { live = false }
  }, [emp?.id])
  return (
    <Field label="Role(s)" value={roles == null ? 'Loading…' : roles.join(', ')} reserve={reserve} />
  )
}

// Editable L1 / L2 / HOD pickers — Employee Master edit mode only. Writes the `employees`
// columns the live app actually reads (ess_menu derives RM/HOD from them; the org chart
// and Other Info read them too). Options are the employee's own company, minus themselves
// — nobody can be their own manager.
function ManagerPick({ label, field, opts, editForm, setEditForm }: {
  label: string; field: string
  opts: { id: string; emp_code: string; full_name: string; designation: string | null }[]
  editForm: any; setEditForm: (fn: any) => void
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={labelStyle}>{label}</div>
      <select style={{ ...ctl, cursor: 'pointer' }} value={editForm?.[field] ?? ''}
              onFocus={focusOn} onBlur={focusOff}
              onChange={e => setEditForm((p: any) => ({ ...p, [field]: e.target.value || null }))}>
        <option value="">None</option>
        {opts.map(o => <option key={o.id} value={o.id}>{o.full_name} ({o.emp_code}){o.designation ? ` — ${o.designation}` : ''}</option>)}
      </select>
    </div>
  )
}

export function ManagerEditor({ emp, editForm, setEditForm }: { emp: any; editForm: any; setEditForm: (fn: any) => void }) {
  const [opts, setOpts] = useState<{ id: string; emp_code: string; full_name: string; designation: string | null }[]>([])
  useEffect(() => {
    if (!emp?.company_id) { setOpts([]); return }
    let live = true
    supabase.from('employees').select('id, emp_code, full_name, designation')
      .eq('company_id', emp.company_id).neq('id', emp.id)
      .eq('employment_status', 'Active').order('full_name')
      .then(({ data }) => { if (live) setOpts((data as any[]) || []) })
    return () => { live = false }
  }, [emp?.company_id, emp?.id])
  return (
    <Section title="Reporting managers"
             hint="L1, L2 and HOD set the reporting line — they drive approvals, the team view, MRF routing and the org chart. Same company only; saved with the rest of the profile.">
      <Grid2>
        <ManagerPick label="Reporting manager 1 (L1)" field="l1_manager_id" opts={opts} editForm={editForm} setEditForm={setEditForm} />
        <ManagerPick label="Reporting manager 2 (L2)" field="l2_manager_id" opts={opts} editForm={editForm} setEditForm={setEditForm} />
        <ManagerPick label="HOD" field="hod_id" opts={opts} editForm={editForm} setEditForm={setEditForm} />
      </Grid2>
    </Section>
  )
}

// Give / remove the manager roles (L1 / L2 / HOD) for this employee — Employee Master
// edit mode only. This is the "employee details" home for these three roles; the ESS &
// Roles screen keeps them locked and points here. Writes ess_user_roles directly and
// applies immediately (a role grant is separate from the employees.update the drawer's
// Save button handles). EMPLOYEE stays automatic; other functional roles are read-only
// here (they live in ESS & Roles).
const HIER_ROLE_META: { code: string; label: string; desc: string }[] = [
  { code: 'L1_MANAGER', label: 'L1 Manager', desc: 'First-line manager — approves their team’s requests' },
  { code: 'L2_MANAGER', label: 'L2 Manager', desc: 'Second-line / skip-level manager' },
  { code: 'HOD',        label: 'HOD',        desc: 'Head of Department' },
]

function Toggle({ on, busy, label, onClick }: { on: boolean; busy: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={busy}
      aria-label={`Toggle ${label}`}
      style={{
        width: 40, height: 23, borderRadius: 99, position: 'relative', flexShrink: 0, padding: 0,
        background: on ? C.brand : C.lineStrong, border: 'none',
        cursor: busy ? 'wait' : 'pointer', transition: `background ${M.quick}`, opacity: busy ? 0.7 : 1,
      }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 19 : 2, width: 19, height: 19, borderRadius: '50%',
        background: C.surface, transition: `left ${M.quick}`, boxShadow: E.raised,
      }} />
    </button>
  )
}

export function EmpRoleEditor({ emp }: { emp: any }) {
  const [acctId, setAcctId] = useState<string | null>(null)
  const [held, setHeld] = useState<Set<string>>(new Set())
  const [otherRoles, setOtherRoles] = useState<string[]>([])
  const [hier, setHier] = useState<{ code: string; label: string; desc: string; id: string }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!emp?.id) return
    let live = true
    ;(async () => {
      setLoading(true)
      const { data: rroles } = await supabase.from('ess_roles').select('id, role_code, role_name').in('role_code', HIER_ROLE_META.map(m => m.code))
      const idByCode: Record<string, string> = {}
      ;(rroles || []).forEach((r: any) => { idByCode[r.role_code] = r.id })
      const { data: acct } = await supabase.from('ess_accounts').select('id').eq('employee_id', emp.id).maybeSingle()
      const set = new Set<string>(); const others: string[] = []
      if (acct?.id) {
        const { data: ur } = await supabase.from('ess_user_roles')
          .select('role_id, ess_roles(role_code, role_name)').eq('ess_account_id', acct.id).eq('is_active', true)
        ;(ur || []).forEach((r: any) => {
          set.add(r.role_id)
          const code = r.ess_roles?.role_code
          if (code && code !== 'EMPLOYEE' && !HIER_ROLE_META.some(m => m.code === code)) others.push(r.ess_roles.role_name)
        })
      }
      if (!live) return
      setAcctId(acct?.id || null)
      setHier(HIER_ROLE_META.filter(m => idByCode[m.code]).map(m => ({ ...m, id: idByCode[m.code] })))
      setHeld(set); setOtherRoles(others); setLoading(false)
    })()
    return () => { live = false }
  }, [emp?.id])

  async function ensureAcct(): Promise<string | null> {
    if (acctId) return acctId
    const { data, error } = await supabase.from('ess_accounts')
      .upsert({ employee_id: emp.id, status: 'INACTIVE' }, { onConflict: 'employee_id' }).select('id').single()
    if (error || !data) return null
    setAcctId(data.id); return data.id
  }

  async function toggle(roleId: string, label: string) {
    setMsg(null); setBusy(roleId)
    const acc = await ensureAcct()
    if (!acc) { setMsg({ text: 'Could not create an ESS account for this employee.', ok: false }); setBusy(null); return }
    const on = held.has(roleId)
    const { error } = on
      ? await supabase.from('ess_user_roles').delete().eq('ess_account_id', acc).eq('role_id', roleId)
      : await supabase.from('ess_user_roles').upsert({ ess_account_id: acc, role_id: roleId, is_active: true }, { onConflict: 'ess_account_id,role_id' })
    if (error) { setMsg({ text: 'Failed: ' + error.message, ok: false }); setBusy(null); return }
    setHeld(prev => { const n = new Set(prev); on ? n.delete(roleId) : n.add(roleId); return n })
    setMsg({ text: `${label} ${on ? 'removed' : 'assigned'}.`, ok: true })
    setBusy(null)
  }

  return (
    <Section title="Manager roles"
             hint={<>Give or remove the manager roles for this employee — these apply immediately, not on Save. Other functional roles (HR Manager, Payroll and so on) are set in <b>ESS &amp; Roles</b>.</>}>
      {loading ? <div style={{ fontSize: F.small, color: C.muted }}>Loading roles…</div> : (
        <div>
          {hier.map((m, i) => {
            const on = held.has(m.id); const saving = busy === m.id
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: S.md, padding: `${S.md - 2}px 0`,
                                       borderTop: i ? `1px solid ${C.line}` : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{m.label}</div>
                  <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 1 }}>{m.desc}</div>
                </div>
                <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: on ? C.positive : C.muted, minWidth: 56, textAlign: 'right' }}>
                  {saving ? 'Saving…' : on ? 'Assigned' : 'Off'}
                </span>
                <Toggle on={on} busy={saving} label={m.label} onClick={() => { if (!saving) toggle(m.id, m.label) }} />
              </div>
            )
          })}
          <SubHead>All roles held</SubHead>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Badge t="brand">Employee · automatic</Badge>
            {hier.filter(m => held.has(m.id)).map(m => <Badge key={m.id} t="positive">{m.label}</Badge>)}
            {otherRoles.map((n, i) => <Badge key={i} t="brand">{n}</Badge>)}
          </div>
          {msg && <div role="status" style={{ fontSize: F.tiny, color: msg.ok ? C.positive : C.critical, marginTop: S.md, fontWeight: W.medium }}>{msg.text}</div>}
        </div>
      )}
    </Section>
  )
}

/** A statutory flag: applicable or not. Says it in words, so colour is never the only signal. */
export function StatChip({ label, value }: { label: string; value: boolean }) {
  const k = tone(value ? 'positive' : 'neutral')
  return (
    <div style={{ padding: `${S.md - 2}px ${S.md}px`, borderRadius: R.md, background: value ? k.bg : C.surface,
                  border: `1px solid ${k.edge}`, minWidth: 0 }}>
      <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{label}</div>
      <div style={{ fontSize: F.tiny, color: value ? C.positive : C.muted, marginTop: 2, fontWeight: W.medium }}>
        {value ? 'Applicable' : 'Not applicable'}
      </div>
    </div>
  )
}

export const PROFILE_TABS = [
  { id: 'personal',   label: 'Personal',   icon: '' },
  { id: 'employment', label: 'Employment', icon: '' },
  { id: 'statutory',  label: 'Statutory',  icon: '' },
  { id: 'bank',       label: 'Bank',       icon: '' },
]

/** What an employee sees of their own record in ESS.
 *
 *  Everything the Employee Master drawer shows EXCEPT "HR Actions". That tab is not
 *  information about somebody — it is the panel for putting them on a PIP, marking
 *  them absconding, starting a sabbatical or a transfer. Handing an employee those
 *  buttons on their own record would be a bug, not a feature. Say the word and it
 *  goes in; it is one line. */
export const ESS_RECORD_TABS = [
  ...PROFILE_TABS,
  { id: 'documents',  label: 'Documents',  icon: '' },
  { id: 'salary',     label: 'Salary',     icon: '' },
  { id: 'onboarding', label: 'Onboarding', icon: '' },
  { id: 'history',    label: 'History',    icon: '' },
]

/** The facts somebody checks first about a record, as label-over-value pairs. */
export function recordFacts(emp: any, extra: { l1?: string } = {}) {
  const facts: { l: string; v: React.ReactNode }[] = [
    { l: 'Company DOJ',   v: fmtDate(emp.company_doj) },
    { l: 'Group DOJ',     v: fmtDate(emp.group_doj) },
    { l: 'Tenure',        v: tenureOf(emp.group_doj || emp.company_doj) },
    { l: 'Confirmation',  v: fmt(emp.confirmation_status) },
    { l: 'Department',    v: emp.departments?.dept_name || emp.dept_name || '—' },
    { l: 'Location',      v: emp.locations?.location_name || emp.location_name || '—' },
    { l: 'Notice period', v: isBlank(emp.notice_period_days) ? '—' : `${emp.notice_period_days} days` },
  ]
  if (extra.l1 !== undefined) facts.push({ l: 'Reporting manager', v: extra.l1 })
  if (emp.last_working_date) facts.push({ l: 'Last working day', v: fmtDate(emp.last_working_date) })
  return facts
}

/** The facts strip, drawn for a light background. */
export function RecordQuickStats({ emp }: { emp: any }) {
  return (
    <div style={{ padding: `${S.md + 2}px ${S.lg + 2}px`, background: C.sunken, borderBottom: `1px solid ${C.line}` }}>
      <FactsGrid facts={recordFacts(emp)} />
    </div>
  )
}

export interface ProfileSectionProps {
  emp: any
  /** 'personal' | 'employment' | 'statutory' | 'bank' */
  profileTab: string
  /** Omit for the read-only view — that is what ESS renders. */
  editMode?: boolean
  editForm?: Record<string, any>
  setEditForm?: (fn: any) => void
  /** ESS has no org-chart component to hand; the master screen does. */
  showManagerChain?: boolean
}

const STATUS_TONE: Record<string, Tone> = {
  Active: 'positive', Resigned: 'critical', Terminated: 'critical', Absconding: 'warning', Abscond: 'warning',
}

export default function EmployeeProfileSections({
  emp, profileTab, editMode = false, editForm, setEditForm, showManagerChain = true,
}: ProfileSectionProps) {
  const ef = editForm || {}
  const e = emp as any
  const has = (k: string) => !isBlank(e[k])
  /** In view mode, true when none of these keys hold anything. Edit mode always shows
   *  the fields — that is where they get filled in. */
  const none = (...keys: string[]) => !editMode && keys.every(k => !has(k))
  const F_ = (label: string, key: string, type?: string, opts?: string[], o: { mono?: boolean; wide?: boolean } = {}) => (
    <Field key={key} label={label}
      value={type === 'date' ? fmtDate(e[key]) : fmt(e[key])}
      editMode={editMode} fieldKey={key} editForm={ef} setEditForm={setEditForm} type={type} opts={opts}
      mono={o.mono} wide={o.wide} />
  )
  /** Shown in edit mode as a disabled control: visible, but not changed from here. */
  const RO = (label: string, value: React.ReactNode, o: { mono?: boolean } = {}) => (
    <Field key={label} label={label} value={value} editMode={editMode} setEditForm={setEditForm} readOnly mono={o.mono} />
  )
  const aadhaar = e.aadhar_last4 ? `XXXX XXXX ${e.aadhar_last4}` : '—'

  if (profileTab === 'personal') return (
    <div>
      <Section title="Identity" empty={none('full_name','common_code','first_name','last_name','gender','date_of_birth','blood_group','marital_status','nationality','religion','birth_place')}>
        <Grid2>
          {F_('Full name','full_name')}
          {RO('Common code', fmt(e.common_code), { mono: true })}
          {F_('First name','first_name')} {F_('Last name','last_name')}
          {F_('Gender','gender','text',['Male','Female','Other'])}
          {F_('Date of birth','date_of_birth','date')}
          {F_('Blood group','blood_group','text',['A+','A-','B+','B-','O+','O-','AB+','AB-'])}
          {F_('Marital status','marital_status','text',['Single','Married','Divorced','Widowed'])}
          {F_('Nationality','nationality')} {F_('Religion','religion')}
          {F_('Birth place','birth_place')}
        </Grid2>
      </Section>
      <Section title="Family" empty={none('father_name','mother_name','spouse_name')} emptyText="No family details on record yet.">
        <Grid2>
          {F_("Father's name",'father_name')} {F_("Mother's name",'mother_name')}
          {F_('Spouse name','spouse_name')}
        </Grid2>
      </Section>
      <Section title="Contact" empty={none('mobile','alternate_mobile','personal_email','office_email','pan_number','uan_number','aadhar_last4')} emptyText="No contact details on record yet.">
        <Grid2>
          {F_('Mobile','mobile','tel',undefined,{ mono: true })} {F_('Alternate mobile','alternate_mobile','tel',undefined,{ mono: true })}
          {F_('Personal email','personal_email','email')} {F_('Office email','office_email','email')}
          {RO('Aadhaar', aadhaar, { mono: true })}
          {F_('PAN','pan_number',undefined,undefined,{ mono: true })} {F_('UAN','uan_number',undefined,undefined,{ mono: true })}
        </Grid2>
      </Section>
      <Section title="Residential address" empty={none('res_address1','res_city','res_state','res_pin')} emptyText="No residential address on record yet.">
        <Grid2>
          {F_('Address','res_address1',undefined,undefined,{ wide: true })}
          {F_('City','res_city')} {F_('State','res_state')} {F_('PIN','res_pin',undefined,undefined,{ mono: true })}
        </Grid2>
      </Section>
      <Section title="Permanent address" empty={none('perm_address1','perm_city','perm_state','perm_pin')} emptyText="No permanent address on record yet.">
        <Grid2>
          {F_('Address','perm_address1',undefined,undefined,{ wide: true })}
          {F_('City','perm_city')} {F_('State','perm_state')} {F_('PIN','perm_pin',undefined,undefined,{ mono: true })}
        </Grid2>
      </Section>
      <Section title="Emergency contacts" empty={none('emergency_name','emergency_relation','emergency_mobile','emergency2_name','emergency2_relation','emergency2_mobile')} emptyText="No emergency contact on record yet.">
        <Grid2>
          {F_('Contact 1 — name','emergency_name')} {F_('Contact 1 — relation','emergency_relation')}
          {F_('Contact 1 — mobile','emergency_mobile','tel',undefined,{ mono: true })}
        </Grid2>
        {(editMode || has('emergency2_name') || has('emergency2_relation') || has('emergency2_mobile')) && (
          <>
            <SubHead>Second contact</SubHead>
            <Grid2>
              {F_('Contact 2 — name','emergency2_name')} {F_('Contact 2 — relation','emergency2_relation')}
              {F_('Contact 2 — mobile','emergency2_mobile','tel',undefined,{ mono: true })}
            </Grid2>
          </>
        )}
      </Section>
    </div>
  )

  if (profileTab === 'employment') return (
    <div>
      <Section title="Employment details">
        <Grid2>
          {F_('Designation','designation')}
          {!editMode && <EmpRoleField key="role" emp={emp} reserve={!!setEditForm} />}
          {F_('Grade','grade')}
          {F_('Employment type','employment_type','text',['Employee','Intern','NAPS','NATS','Consultant','Contract'])}
          {F_('Employment status','employment_status','text',['Active','Resigned','Sabbatical','Abscond','Inactive'])}
          {F_('Collar type','collar_type','text',['White Collar','Blue Collar'])}
          {F_('Function','employee_function')}
          {F_('Category','employee_category')}
          {F_('Notice period (days)','notice_period_days','number')}
          {e.employment_type === 'Intern' && F_('Intern pay (₹)','intern_pay','number')}
          {e.employment_type === 'Consultant' && F_('Consultant pay (₹)','consultant_pay','number')}
          {e.employment_type === 'Contract' && F_('Contract pay (₹)','contract_pay','number')}
        </Grid2>
      </Section>
      <Section title="Joining and confirmation">
        <Grid2>
          {F_('Group DOJ','group_doj','date')}
          {F_('Company DOJ','company_doj','date')}
          {F_('Confirmation status','confirmation_status','text',['Probation','Confirmed'])}
          {RO('Company', e.companies?.company_name || e.company_name || '—')}
          {RO('Location / branch', e.locations?.location_name || e.location_name || '—')}
          {RO('Department', e.departments?.dept_name || e.dept_name || '—')}
        </Grid2>
      </Section>
      {showManagerChain && !editMode && (
        <Section title="Manager information">
          <EmployeeOrgFlow employeeId={emp.id} companyId={emp.company_id} employeeName={emp.full_name} />
        </Section>
      )}
      {editMode && setEditForm && (
        <ManagerEditor emp={emp} editForm={ef} setEditForm={setEditForm} />
      )}
      {editMode && setEditForm && <EmpRoleEditor emp={emp} />}
      <OtherInfoSection emp={emp} />
      {e.employment_status === 'Resigned' && (
        <Section title="Exit details"
                 actions={<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                   <Badge t={e.rehire_eligible ? 'positive' : 'neutral'}>{e.rehire_eligible ? 'Rehire eligible' : 'Not rehire eligible'}</Badge>
                   {e.blacklisted && <Badge t="critical">Blacklisted</Badge>}
                 </div>}>
          <Grid2>
            {F_('Date of resignation','date_of_resignation','date')}
            {F_('Last working date','last_working_date','date')}
          </Grid2>
        </Section>
      )}
    </div>
  )

  if (profileTab === 'statutory') return (
    <div>
      <Section title="Statutory applicability">
        <div style={{ display: 'grid', gap: S.sm, gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px, 100%), 1fr))' }}>
          <StatChip label="PF / EPF" value={!!e.pf_applicable} />
          <StatChip label="ESIC" value={!!e.esic_applicable} />
          <StatChip label="Professional tax" value={!!e.pt_applicable} />
          <StatChip label="LWF" value={!!e.lwf_applicable} />
        </div>
      </Section>
      <Section title="Statutory IDs" empty={none('uan_number','pan_number','aadhar_last4')} emptyText="No statutory IDs on record yet.">
        <Grid2>
          {F_('UAN','uan_number',undefined,undefined,{ mono: true })}
          {F_('PAN','pan_number',undefined,undefined,{ mono: true })}
          {RO('Aadhaar', aadhaar, { mono: true })}
        </Grid2>
      </Section>
    </div>
  )

  // Documents / Salary / Onboarding / History are the same read-only views the master
  // drawer delegates to, so an employee sees their own papers, structure and trail.
  if (['documents', 'salary', 'onboarding', 'history'].includes(profileTab)) {
    return <HRActionPanel employee={emp} activeTab={profileTab} />
  }

  if (profileTab === 'bank') return (
    <Section title="Salary account"
             hint="Bank details change through a request to Payroll, not from this screen."
             actions={(has('bank_name') || has('bank_account_last4')) ? <Badge t="positive" dot>Primary</Badge> : undefined}
             empty={!has('bank_name') && !has('bank_account_last4') && !has('ifsc_code')}
             emptyText="No salary account on record yet.">
      <Grid2>
        <Field label="Bank name" value={fmt(e.bank_name)} />
        <Field label="Account type" value={fmt(e.account_type)} />
        <Field label="Account number" value={e.bank_account_last4 ? `XXXX XXXX ${e.bank_account_last4}` : '—'} mono />
        <Field label="IFSC" value={fmt(e.ifsc_code)} mono />
      </Grid2>
    </Section>
  )

  return null
}

// Status tone, for callers that draw the record's state as a chip.
export const statusTone = (s: string | null | undefined): Tone => (s && STATUS_TONE[s]) || 'neutral'
