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
import type React from 'react'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import EmployeeOrgFlow from '@/components/rms/EmployeeOrgFlow'
import HRActionPanel from '@/components/employees/HRActionPanel'
import { C, tone } from '@/lib/ui'

export const P = {
  navy: C.ink, purple: C.brand, purpleDark: C.brandDeep,
  purpleBg: C.brandTint, purpleLight: C.sunken,
  border: C.line, card: C.surface, page: C.canvas,
  text: C.ink, muted: C.muted, green: C.positive, greenBg: tone('positive').bg,
  red: C.critical, redBg: tone('critical').bg, amber: C.warning, amberBg: tone('warning').bg,
}

export const fmt = (v: any) => (!v || v === '' ? '—' : String(v))
export const fmtDate = (v: string) => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, ' ')
}

const inp: React.CSSProperties = { width: '100%', padding: '7px 9px', border: `1px solid ${P.border}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: P.card, color: P.text, outline: 'none', boxSizing: 'border-box' }
const sel: React.CSSProperties = { ...inp }

export function Field({ label, value, editMode, fieldKey, editForm, setEditForm, type, opts }: any) {
  return (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${P.border}` }}>
      <div style={{ fontSize: '10px', color: P.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '4px', fontWeight: 500 }}>{label}</div>
      {editMode ? (
        opts ? (
          <select style={sel} value={editForm?.[fieldKey] ?? ''} onChange={e => setEditForm((p: any) => ({ ...p, [fieldKey]: e.target.value }))}>
            <option value="">— Select —</option>
            {opts.map((o: string) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input type={type || 'text'} style={inp}
            value={type === 'date' ? String(editForm?.[fieldKey] ?? '').slice(0, 10) : (editForm?.[fieldKey] ?? '')}
            onChange={e => setEditForm((p: any) => ({ ...p, [fieldKey]: e.target.value }))} />
        )
      ) : (
        <div style={{ fontSize: '13px', color: value && value !== '—' ? P.text : P.muted }}>{value || '—'}</div>
      )}
    </div>
  )
}

export function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0', padding: '16px 20px', borderBottom: `1px solid ${P.border}` }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: P.purple, textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>{icon}</span>{title}
      </div>
      {children}
    </div>
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

  // One field per line, "Label :- Value".
  const line = (label: string, value: React.ReactNode) => (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${P.border}`, fontSize: '13px', color: P.text }}>
      <span style={{ color: P.muted, fontWeight: 500 }}>{label} :- </span>
      {value || '—'}
    </div>
  )

  return (
    <Section title="Other Info" icon="🗂️">
      {!data ? <div style={{ fontSize: 13, color: P.muted }}>Loading…</div> : (
        <div>
          {line('Role', data.ownRoles.length ? data.ownRoles.join(', ') : '—')}
          {line('Department', data.dept)}
          {line('Reporting Manager 1', data.rm1)}
          {line('Reporting Manager 2', data.rm2)}
          {line('HOD', data.hod)}
          {data.holders.map(([label, val]: [string, string]) => (
            <div key={label}>{line(label, val)}</div>
          ))}
        </div>
      )}
    </Section>
  )
}

// Shared field-label style, matching <Field>'s label.
const fieldLabel: React.CSSProperties = { fontSize: '10px', color: P.muted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: '4px', fontWeight: 500 }
const chipStyle = (bg: string, color: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: bg, color, display: 'inline-block' })

// The employee's ESS role(s), read-only — shown in Employment Details on the Employee
// Master. Roles are assigned in ESS & Roles, not here, so this is display-only. Every
// person is an Employee (that base role is automatic), so it always shows at least that.
export function EmpRoleField({ emp }: { emp: any }) {
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
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${P.border}` }}>
      <div style={fieldLabel}>Role(s)</div>
      <div style={{ fontSize: '13px', color: P.text }}>{roles == null ? '…' : roles.join(', ')}</div>
    </div>
  )
}

// Editable L1 / L2 / HOD pickers — Employee Master edit mode only. Writes the `employees`
// columns the live app actually reads (ess_menu derives RM/HOD from them; the org chart
// and Other Info read them too). Options are the employee's own company, minus themselves
// — nobody can be their own manager.
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
  const row = (label: string, field: string) => (
    <div style={{ padding: '8px 0', borderBottom: `1px solid ${P.border}` }}>
      <div style={fieldLabel}>{label}</div>
      <select style={sel} value={editForm?.[field] ?? ''} onChange={e => setEditForm((p: any) => ({ ...p, [field]: e.target.value || null }))}>
        <option value="">— None —</option>
        {opts.map(o => <option key={o.id} value={o.id}>{o.full_name} ({o.emp_code}){o.designation ? ` — ${o.designation}` : ''}</option>)}
      </select>
    </div>
  )
  return (
    <Section title="Reporting Managers" icon="🧭">
      <div style={{ fontSize: 11, color: P.muted, marginBottom: 8, lineHeight: 1.5 }}>
        L1 / L2 / HOD set the reporting line — these drive approvals, team view, MRF routing and the org chart. (Same company only; save to apply.)
      </div>
      {row('Reporting Manager 1 (L1)', 'l1_manager_id')}
      {row('Reporting Manager 2 (L2)', 'l2_manager_id')}
      {row('HOD', 'hod_id')}
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
    <Section title="Roles" icon="🛡️">
      <div style={{ fontSize: 11, color: P.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Give or remove the manager roles for this employee — changes apply immediately. Other functional roles (HR Manager, Payroll, etc.) are set in <b>ESS &amp; Roles</b>.
      </div>
      {loading ? <div style={{ fontSize: 13, color: P.muted }}>Loading roles…</div> : (
        <div>
          {hier.map(m => {
            const on = held.has(m.id); const saving = busy === m.id
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${P.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: P.text }}>{m.label}</div>
                  <div style={{ fontSize: 11, color: P.muted, marginTop: 1 }}>{m.desc}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: on ? P.green : P.muted, minWidth: 56, textAlign: 'right' }}>{saving ? 'Saving…' : on ? 'Assigned' : 'Off'}</span>
                <button onClick={() => { if (!saving) toggle(m.id, m.label) }} disabled={saving} aria-label={`Toggle ${m.label}`}
                  style={{ width: 40, height: 23, borderRadius: 99, background: on ? P.purple : '#D1D5DB', position: 'relative', border: 'none', cursor: saving ? 'wait' : 'pointer', flexShrink: 0, transition: 'background .15s', opacity: saving ? 0.7 : 1 }}>
                  <span style={{ position: 'absolute', top: 2, left: on ? 19 : 2, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
                </button>
              </div>
            )
          })}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: P.muted, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 600, marginBottom: 6 }}>All roles held</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span style={chipStyle(P.purpleBg, P.purpleDark)}>Employee · auto</span>
              {hier.filter(m => held.has(m.id)).map(m => <span key={m.id} style={chipStyle(P.greenBg, P.green)}>{m.label}</span>)}
              {otherRoles.map((n, i) => <span key={i} style={chipStyle(P.purpleBg, P.purpleDark)}>{n}</span>)}
            </div>
          </div>
          {msg && <div style={{ fontSize: 11, color: msg.ok ? P.green : P.red, marginTop: 10, fontWeight: 500 }}>{msg.text}</div>}
        </div>
      )}
    </Section>
  )
}

export function Grid2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>{children}</div>
}

export function StatChip({ label, value }: { label: string; value: boolean }) {
  return (
    <div style={{ flex: 1, padding: '10px 8px', borderRadius: '10px', background: value ? P.greenBg : P.page, border: `1px solid ${value ? '#BBF7D0' : P.border}`, textAlign: 'center' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: P.text }}>{label}</div>
      <div style={{ fontSize: '10px', color: value ? P.green : P.muted, marginTop: '4px', fontWeight: 500 }}>{value ? 'Yes' : 'No'}</div>
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

/** The strip the Employee Master drawer carries under the name — the six facts
 *  somebody checks first. Drawn for a light background here; the master's own
 *  header keeps its dark one. */
export function RecordQuickStats({ emp }: { emp: any }) {
  const rows = [
    { l: 'Group DOJ',     v: fmtDate(emp.group_doj) },
    { l: 'Company DOJ',   v: fmtDate(emp.company_doj) },
    { l: 'Confirmation',  v: fmt(emp.confirmation_status) },
    { l: 'Department',    v: emp.departments?.dept_name || emp.dept_name || '—' },
    { l: 'Location',      v: emp.locations?.location_name || emp.location_name || '—' },
    { l: 'Notice Period', v: emp.notice_period_days ? `${emp.notice_period_days} days` : '—' },
  ]
  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '10px 20px',
                  background: P.purpleLight, borderBottom: `1px solid ${P.border}` }}>
      {rows.map(x => (
        <div key={x.l} style={{ fontSize: 11, color: P.muted }}>
          {x.l}: <span style={{ color: P.text, fontWeight: 500 }}>{x.v}</span>
        </div>
      ))}
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

export default function EmployeeProfileSections({
  emp, profileTab, editMode = false, editForm, setEditForm, showManagerChain = true,
}: ProfileSectionProps) {
  const ef = editForm || {}
  const F = (label: string, key: string, type?: string, opts?: string[]) => (
    <Field key={key} label={label}
      value={key === 'date_of_birth' || key.includes('doj') ? fmtDate((emp as any)[key]) : fmt((emp as any)[key])}
      editMode={editMode} fieldKey={key} editForm={ef} setEditForm={setEditForm} type={type} opts={opts} />
  )

  if (profileTab === 'personal') return (
    <div>
      <Section title="Identity" icon="🪪">
        <Grid2>
          {F('Full Name','full_name')} {F('Common Code','common_code')}
          {F('First Name','first_name')} {F('Last Name','last_name')}
          {F('Gender','gender','text',['Male','Female','Other'])}
          {F('Date of Birth','date_of_birth','date')}
          {F('Blood Group','blood_group','text',['A+','A-','B+','B-','O+','O-','AB+','AB-'])}
          {F('Marital Status','marital_status','text',['Single','Married','Divorced','Widowed'])}
          {F('Nationality','nationality')} {F('Religion','religion')}
          {F('Birth Place','birth_place')}
        </Grid2>
      </Section>
      <Section title="Family" icon="👪">
        <Grid2>
          {F("Father's Name",'father_name')} {F("Mother's Name",'mother_name')}
          {F('Spouse Name','spouse_name')}
        </Grid2>
      </Section>
      <Section title="Contact" icon="📞">
        <Grid2>
          {F('Mobile','mobile')} {F('Alternate Mobile','alternate_mobile')}
          {F('Personal Email','personal_email')} {F('Office Email','office_email')}
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Aadhaar</div>
            <div style={{ fontSize:'13px', color:P.text }}>XXXX-XXXX-{emp.aadhar_last4 || '—'}</div>
          </div>
          {F('PAN Number','pan_number')} {F('UAN Number','uan_number')}
        </Grid2>
      </Section>
      <Section title="Residential Address" icon="🏠">
        <Grid2>
          {F('Address','res_address1')} {F('City','res_city')}
          {F('State','res_state')} {F('PIN','res_pin')}
        </Grid2>
      </Section>
      <Section title="Permanent Address" icon="📍">
        <Grid2>
          {F('Address','perm_address1')} {F('City','perm_city')}
          {F('State','perm_state')} {F('PIN','perm_pin')}
        </Grid2>
      </Section>
      <Section title="Emergency Contact" icon="🚨">
        <Grid2>
          {F('Name','emergency_name')} {F('Relation','emergency_relation')}
          {F('Mobile','emergency_mobile')}
        </Grid2>
        <Grid2>
          {F('Alt. Name','emergency2_name')} {F('Alt. Relation','emergency2_relation')}
          {F('Alt. Mobile','emergency2_mobile')}
        </Grid2>
      </Section>
    </div>
  )

  if (profileTab === 'employment') return (
    <div>
      <Section title="Employment Details" icon="💼">
        <Grid2>
          {F('Designation','designation')}
          {!editMode && <EmpRoleField key="role" emp={emp} />}
          {F('Grade','grade')}
          {F('Employment Type','employment_type','text',['Employee','Intern','NAPS','NATS','Consultant','Contract'])}
          {F('Employment Status','employment_status','text',['Active','Resigned','Sabbatical','Abscond','Inactive'])}
          {F('Collar Type','collar_type','text',['White Collar','Blue Collar'])}
          {F('Function','employee_function')}
          {F('Category','employee_category')}
          {F('Notice Period (Days)','notice_period_days','number')}
          {emp.employment_type === 'Intern' && F('Intern Pay (₹)','intern_pay','number')}
          {emp.employment_type === 'Consultant' && F('Consultant Pay (₹)','consultant_pay','number')}
          {emp.employment_type === 'Contract' && F('Contract Pay (₹)','contract_pay','number')}
        </Grid2>
      </Section>
      <Section title="Joining & Confirmation" icon="📅">
        <Grid2>
          {F('Group DOJ','group_doj','date')}
          {F('Company DOJ','company_doj','date')}
          {F('Confirmation Status','confirmation_status','text',['Probation','Confirmed'])}
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Company</div>
            <div style={{ fontSize:'13px', color:P.text }}>{(emp as any).companies?.company_name || (emp as any).company_name || '—'}</div>
          </div>
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Location / Branch</div>
            <div style={{ fontSize:'13px', color:P.text }}>{(emp as any).locations?.location_name || (emp as any).location_name || '—'}</div>
          </div>
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Department</div>
            <div style={{ fontSize:'13px', color:P.text }}>{(emp as any).departments?.dept_name || (emp as any).dept_name || '—'}</div>
          </div>
        </Grid2>
      </Section>
      {showManagerChain && !editMode && (
        <Section title="Manager Information" icon="🧭">
          <EmployeeOrgFlow employeeId={emp.id} companyId={emp.company_id} employeeName={emp.full_name} />
        </Section>
      )}
      {editMode && setEditForm && (
        <ManagerEditor emp={emp} editForm={ef} setEditForm={setEditForm} />
      )}
      {editMode && setEditForm && <EmpRoleEditor emp={emp} />}
      <OtherInfoSection emp={emp} />
      {emp.employment_status === 'Resigned' && (
        <Section title="Exit Details" icon="🚪">
          <Grid2>
            {F('Date of Resignation','date_of_resignation','date')}
            {F('Last Working Date','last_working_date','date')}
          </Grid2>
          <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
            <div style={{ padding:'6px 12px', borderRadius:'10px', background: emp.rehire_eligible ? P.greenBg : P.page, border:`1px solid ${emp.rehire_eligible ? '#BBF7D0' : P.border}`, fontSize:'11px', color: emp.rehire_eligible ? P.green : P.muted }}>{emp.rehire_eligible ? 'Rehire Eligible' : 'Not Rehire Eligible'}</div>
            {emp.blacklisted && <div style={{ padding:'6px 12px', borderRadius:'10px', background:P.redBg, border:`1px solid #FCA5A5`, fontSize:'11px', color:P.red }}>Blacklisted</div>}
          </div>
        </Section>
      )}
    </div>
  )

  if (profileTab === 'statutory') return (
    <div>
      <Section title="Statutory Applicability" icon="⚖️">
        <div style={{ display:'flex', gap:'8px', marginBottom:'16px' }}>
          <StatChip label="PF / EPF" value={emp.pf_applicable} />
          <StatChip label="ESIC" value={emp.esic_applicable} />
          <StatChip label="Prof. Tax" value={emp.pt_applicable} />
          <StatChip label="LWF" value={emp.lwf_applicable} />
        </div>
        <Grid2>
          {F('UAN Number','uan_number')}
          {F('PAN Number','pan_number')}
          <div style={{ padding:'8px 0', borderBottom:`1px solid ${P.border}` }}>
            <div style={{ fontSize:'10px', color:P.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:'4px', fontWeight:500 }}>Aadhaar</div>
            <div style={{ fontSize:'13px', fontFamily:'monospace', color:P.text }}>XXXX-XXXX-{emp.aadhar_last4 || '—'}</div>
          </div>
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
    <Section title="Salary Account" icon="🏦">
      <div style={{ background:P.greenBg, border:`1px solid #BBF7D0`, borderRadius:'10px', padding:'16px', marginBottom:'12px' }}>
        <div style={{ fontSize:'12px', fontWeight:600, color:C.positive, marginBottom:'12px' }}>Primary Account</div>
        <Grid2>
          {[
            ['Bank Name', emp.bank_name],
            ['Account Type', emp.account_type],
            ['Account No.', emp.bank_account_last4 ? `XXXX XXXX XXXX ${emp.bank_account_last4}` : '—'],
            ['IFSC Code', emp.ifsc_code],
          ].map(([l, v]) => (
            <div key={l as string} style={{ padding:'6px 0', borderBottom:`1px solid #DCFCE7` }}>
              <div style={{ fontSize:'10px', color:C.positive, marginBottom:'3px', fontWeight:500, textTransform:'uppercase', letterSpacing:'.4px' }}>{l}</div>
              <div style={{ fontSize:'13px', color:P.text, fontFamily: l === 'Account No.' || l === 'IFSC Code' ? 'monospace' : 'inherit' }}>{v || '—'}</div>
            </div>
          ))}
        </Grid2>
      </div>
    </Section>
  )

  return null
}
