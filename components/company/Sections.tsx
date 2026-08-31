'use client'
// components/company/Sections.tsx — the company profile, in ten sections.
//
// Tabs rather than one long scroll. Ninety fields stacked vertically is a form
// nobody finishes; ten named groups of nine is a thing you can navigate. The
// tab strip also shows a completeness dot per section, so "what is still
// blank" is answerable without opening all ten.
//
// EVERY FIELD RENDERS, filled or not. Same rule as the statutory register: a
// profile that hides what is missing answers "what do we have" when the useful
// question is "what is left".
//
// 077 has not necessarily been applied. Its columns are optional on the type
// and absent from select('*') until it runs, so everything here treats them as
// null and shows "Not recorded" — the screen works today and fills in when the
// migration lands, with no code change.

import { useMemo, useState } from 'react'
import { C, F, W, R } from '@/lib/ui'
import { BarList, Donut, Capacity, Field, StatStrip, CodeChip } from './Charts'
import { GenderSplit, GenderInline } from './GenderSplit'
import { Compliance } from './Compliance'
import { ACCENT, CSS, card, heading, rule, label as lblS, value as valS, stat, statValue, statLabel } from './ui'
import {
  REG_TYPES, regHealth, DOC_TYPES, shiftHours,
  type Company, type Registration, type Branch, type BankAccount,
  type CompanyHeadcount, type PolicyBundle,
} from '@/lib/supabase-company-profile'

const WEEKDAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const MONTH = ['—','January','February','March','April','May','June','July','August','September','October','November','December']
const ord = (n?: number | null) => !n ? null : `${n}${['th','st','nd','rd'][(n % 100 - n % 10 !== 10) ? Math.min(n % 10, 4) : 0] ?? 'th'}`

export interface SectionData {
  co: Company
  group: string
  branches: Branch[]
  regs: Registration[]
  banks: BankAccount[]
  head?: CompanyHeadcount
  departments: { id: string; dept_name: string; cost_center: string | null }[]
  deptHeadcount: Record<string, number>
  employmentMix: Record<string, number>
  leavers12m: number
  policy?: PolicyBundle
}

const SECTIONS = [
  { id: 'basic',      label: 'Basic' },
  { id: 'compliance', label: 'Registration' },
  { id: 'location',   label: 'Location' },
  { id: 'contact',    label: 'Contact' },
  { id: 'finance',    label: 'Banking' },
  { id: 'org',        label: 'Structure' },
  { id: 'payroll',    label: 'Payroll' },
  { id: 'statutory',  label: 'Statutory' },
  { id: 'hr',         label: 'People' },
  { id: 'brand',      label: 'Brand' },
  { id: 'documents',  label: 'Documents' },
  { id: 'policy',     label: 'Policies' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

/** How much of a section is filled — drives the dot on its tab. Counted from
 *  the same values the section renders, so the dot cannot disagree with what
 *  you see when you open it. */
function completeness(id: SectionId, d: SectionData): { done: number; total: number } {
  const co = d.co as any
  const has = (v: any) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)
  const count = (vals: any[]) => ({ done: vals.filter(has).length, total: vals.length })
  switch (id) {
    case 'basic':      return count([co.company_name, co.short_name, co.date_of_inc, co.company_type, co.industry, co.duns_number, co.cin, co.logo_url, co.website_url])
    case 'compliance': return { done: REG_TYPES.filter(t => d.regs.some(r => r.reg_type === t.code && r.reg_number) || (t.legacy && has(co[t.legacy]))).length, total: REG_TYPES.length }
    case 'location':   return count([d.branches.length || null, co.reg_office, co.corp_office, co.timezone, d.branches.some(b => b.latitude) || null])
    case 'contact':    return { done: 0, total: 7 }
    case 'finance':    return count([d.banks.length || null, co.currency, co.fy_start_month])
    case 'org':        return count([co.structure_type, d.departments.length || null, d.branches.length || null, co.approved_strength])
    case 'payroll':    return count([co.payroll_frequency, co.payroll_cycle_start_day, co.salary_disbursement_day, co.currency, co.epf_code, co.esic_code, co.wc_policy_number])
    case 'statutory':  return count([co.pf_status, co.esic_status, co.maternity_compliant, co.dpdp_compliant])
    case 'hr':         return count([co.approved_strength, co.default_employment_type, co.probation_days, co.notice_period_days, co.max_leave_carryforward, co.leave_year_start_month])
    case 'brand':      return count([co.vision_statement, co.mission_statement, co.core_values, co.tagline, co.brand_primary, co.linkedin_url])
    // Documents counts the five standard slots that have a current file, plus
    // whether anyone is on the board — six things a new company must produce.
    case 'documents':  return {
      done: DOC_TYPES.filter(t => d.policy?.docs.some(x => x.doc_type === t.code && x.is_current)).length
            + ((d.policy?.directors.length ?? 0) > 0 ? 1 : 0),
      total: DOC_TYPES.length + 1,
    }
    case 'policy':     return count([
      d.policy?.shifts.length || null, d.policy?.weeklyOff.length || null,
      d.policy?.leaveTypes.length || null, co.attendance_modes?.length || null,
      co.max_leave_carryforward, co.notice_period_days,
    ])
  }
}

const grid = (cols: number): React.CSSProperties => ({
  display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap: '14px 18px',
})
/** Every card in a section carries that section's hue on its left rail, so a
 *  scrolled-past card still tells you which tab you are in. */
let ACC = ACCENT.basic
const block = (): React.CSSProperties => card(ACC)

function Head({ children }: { children: React.ReactNode }) {
  return (
    <div style={heading(ACC)}>
      <span aria-hidden style={rule(ACC)} />
      {children}
    </div>
  )
}

export function CompanySections({ d, isMobile, saveReg }: {
  d: SectionData; isMobile: boolean
  saveReg: (reg_type: string, patch: Record<string, string | null>, location_id?: string | null) => Promise<void>
}) {
  const [tab, setTab] = useState<SectionId>('basic')
  const co = d.co
  const cols = isMobile ? 1 : 3
  // Module-level so block() and Head() can read it without every call site
  // threading it through. Set once per render, before any of them run.
  ACC = ACCENT[tab] ?? ACCENT.basic

  const complete = useMemo(() =>
    Object.fromEntries(SECTIONS.map(s => [s.id, completeness(s.id, d)])) as Record<SectionId, { done: number; total: number }>,
    [d])

  const regHealthSlices = useMemo(() => {
    let valid = 0, expiring = 0, expired = 0, missing = 0
    for (const t of REG_TYPES) {
      const r = d.regs.find(x => x.reg_type === t.code && !x.location_id)
      const legacy = t.legacy ? (co as any)[t.legacy] : null
      const st = regHealth(r ?? (legacy ? ({ reg_number: legacy } as Registration) : undefined)).state
      if (st === 'MISSING') missing++
      else if (st === 'EXPIRED') expired++
      else if (st === 'EXPIRING') expiring++
      else valid++
    }
    return [
      { label: 'Valid',       value: valid,    colour: C.positive },
      { label: 'Expiring',    value: expiring, colour: C.warning },
      { label: 'Expired',     value: expired,  colour: C.critical },
      { label: 'Not recorded',value: missing,  colour: C.line },
    ]
  }, [d.regs, co])

  const headTotal = d.head?.company.total ?? 0

  return (
    <div>
      <style>{CSS}</style>
      {/* Tab strip. The dot is the section's completeness, so somebody filling
          this in can see where the gaps are without opening all ten. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {SECTIONS.map(s => {
          const on = tab === s.id
          const { done, total } = complete[s.id]
          const tone = done === 0 ? C.critical : done < total ? C.warning : C.positive
          return (
            <button key={s.id} onClick={() => setTab(s.id)} className="cp-tab" style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 13px', borderRadius: R.pill, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: F.micro, fontWeight: on ? W.bold : W.semi,
              border: `1px solid ${on ? 'transparent' : C.line}`,
              // The active tab is filled with ITS OWN hue, not one shared
              // brand colour — that is what makes the section you are in
              // identifiable at a glance rather than only by reading.
              background: on
                ? `linear-gradient(145deg, ${ACCENT[s.id]}, ${ACCENT[s.id]}CC)`
                : C.surface,
              color: on ? '#FFFFFF' : C.inkSoft,
              boxShadow: on
                ? `inset 0 1px 0 rgba(255,255,255,.28), 0 4px 12px -3px ${ACCENT[s.id]}70`
                : '0 1px 2px rgba(15,23,42,.05)',
            }}>
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%',
                background: on ? C.onAccent : tone, opacity: on ? .8 : 1 }} />
              {s.label}
              <span style={{ opacity: .65, fontVariantNumeric: 'tabular-nums' }}>{done}/{total}</span>
            </button>
          )
        })}
      </div>

      {/* ── 1. BASIC ── */}
      {tab === 'basic' && (
        <div key={tab} className="cp-in" style={block()}>
          <StatStrip isMobile={isMobile} items={[
            { label: 'Years trading', accent: ACC,
              value: co.date_of_inc ? Math.max(0, new Date().getFullYear() - new Date(co.date_of_inc).getFullYear()) : '—',
              hint: co.date_of_inc ? `since ${new Date(co.date_of_inc).getFullYear()}` : 'no date on record' },
            { label: 'Sites', accent: ACCENT.location, value: d.branches.length,
              hint: `${new Set(d.branches.map(b => b.city).filter(Boolean)).size} cities` },
            { label: 'People', accent: ACCENT.hr, value: headTotal,
              hint: `${d.departments.length} departments` },
            { label: 'Profile filled', accent: ACCENT.org,
              value: `${Math.round((Object.values(complete).reduce((a,c)=>a+c.done,0) /
                       Math.max(1, Object.values(complete).reduce((a,c)=>a+c.total,0))) * 100)}%`,
              fill: Object.values(complete).reduce((a,c)=>a+c.done,0) /
                    Math.max(1, Object.values(complete).reduce((a,c)=>a+c.total,0)),
              hint: 'across all sections' },
          ]} />
          <Head>Company identity</Head>
          <div style={grid(cols)}>
            <Field label="Legal entity name" value={co.company_name} />
            {/* Deduped: short_name and company_code are frequently the same string,
                and joining them blind printed "SRS · SRS". */}
            <Field label="Short name / code" value={
              Array.from(new Set([co.short_name, co.company_code].filter(Boolean))).join(' · ')} />
            <Field label="Established" value={co.date_of_inc ? new Date(co.date_of_inc + 'T00:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : null} />
            <Field label="Company type" value={co.company_type} />
            <Field label="Industry sector" value={co.industry} />
            <Field label="CIN" value={co.cin ? <CodeChip value={co.cin} accent={ACC} /> : null} />
            <Field label="DUNS number" value={co.duns_number ? <CodeChip value={co.duns_number} accent={ACC} /> : null} />
            <Field label="Website" value={co.website_url
              ? <a href={co.website_url} target="_blank" rel="noreferrer" style={{ color: C.brand }}>{co.website_url}</a>
              : null} />
            <Field label="Group" value={d.group} />
          </div>
          {co.logo_url && (
            <div style={{ marginTop: 14 }}>
              <Head>Logo</Head>
              <img src={co.logo_url} alt={`${co.company_name} logo`}
                   style={{ maxHeight: 54, maxWidth: 200, objectFit: 'contain' }} />
            </div>
          )}
        </div>
      )}

      {/* ── 2. REGISTRATION & COMPLIANCE ── */}
      {tab === 'compliance' && (
        <div key={tab} className="cp-in">
          <div style={block()}>
            <StatStrip isMobile={isMobile} items={[
              { label: 'Valid',    accent: '#059669', value: regHealthSlices[0].value },
              { label: 'Expiring', accent: '#D97706', value: regHealthSlices[1].value, hint: 'within 30 days' },
              { label: 'Expired',  accent: '#DC2626', value: regHealthSlices[2].value },
              { label: 'Missing',  accent: '#64748B', value: regHealthSlices[3].value,
                fill: 1 - regHealthSlices[3].value / REG_TYPES.length, hint: `of ${REG_TYPES.length} expected` },
            ]} />
            <Head>Certificate health</Head>
            <Donut slices={regHealthSlices} centre={`${regHealthSlices[0].value}/${REG_TYPES.length}`} />
          </div>
          <Compliance co={co} regs={d.regs} isMobile={isMobile} onSave={saveReg} />
        </div>
      )}

      {/* ── 3. LOCATION ── */}
      {tab === 'location' && (
        <div key={tab} className="cp-in" style={block()}>
          <StatStrip isMobile={isMobile} items={[
            { label: 'Total sites', accent: ACC, value: d.branches.length },
            { label: 'Cities', accent: ACCENT.finance,
              value: new Set(d.branches.map(b => b.city).filter(Boolean)).size },
            { label: 'States', accent: ACCENT.org,
              value: new Set(d.branches.map(b => b.state).filter(Boolean)).size },
            { label: 'Geo-tagged', accent: ACCENT.compliance,
              value: `${d.branches.filter(b => b.latitude != null).length}/${d.branches.length}`,
              fill: d.branches.length ? d.branches.filter(b => b.latitude != null).length / d.branches.length : 0,
              hint: 'have coordinates' },
          ]} />
          <Head>Addresses</Head>
          <div style={grid(isMobile ? 1 : 2)}>
            <Field label="Registered office" value={co.reg_office} />
            <Field label="Corporate office" value={co.corp_office} />
            <Field label="Time zone" value={co.timezone} />
            <Field label="Countries of operation" value={
              Array.from(new Set(d.branches.map(b => (b as any).country).filter(Boolean))).join(', ') || 'India'} />
          </div>
          <div style={{ marginTop: 16 }}>
            <Head>Sites ({d.branches.length})</Head>
            <div style={{ display: 'grid', gap: 8 }}>
              {d.branches.map(b => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                                         padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 9 }}>
                  <span style={{ fontSize: F.small, fontWeight: W.semi, minWidth: 150 }}>{b.location_name}</span>
                  <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: R.pill,
                                 background: C.sunken, color: C.inkSoft }}>{b.location_type}</span>
                  <span style={{ fontSize: F.micro, color: C.muted, flex: 1 }}>
                    {[b.city, b.district, b.state, b.pin_code].filter(Boolean).join(', ') || 'No address'}
                  </span>
                  {b.latitude != null && b.longitude != null ? (
                    <a href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`} target="_blank" rel="noreferrer"
                       style={{ fontSize: F.micro, color: C.brand }}>map</a>
                  ) : <span style={{ fontSize: F.micro, color: C.faint }}>no coords</span>}
                  {/* Headcount belongs on the site row too — this tab lists the
                      sites, and "how many people are here" is the first thing
                      asked about one. */}
                  <div style={{ flexBasis: '100%', paddingTop: 7, marginTop: 2,
                                borderTop: `1px solid ${C.line}` }}>
                    <GenderInline counts={d.head?.byLocation[b.id] ?? { male:0, female:0, other:0, unknown:0, total:0 }} />
                  </div>
                </div>
              ))}
              {!d.branches.length && <span style={{ fontSize: F.micro, color: C.faint }}>No sites recorded.</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── 4. CONTACT ── */}
      {tab === 'contact' && (
        <div key={tab} className="cp-in" style={block()}>
          <Head>Contacts</Head>
          <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>
            Contacts live in <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: F.micro }}>company_contacts</code>,
            a table added by migration <strong>077</strong>. Until that runs there is nowhere to store them, so this
            section has nothing to show — the other nine sections are unaffected.
          </div>
          <div style={{ ...grid(cols), marginTop: 14, opacity: .55 }}>
            {['Primary contact', 'Company email', 'Phone', 'Alternate phone', 'HR email', 'Payroll contact', 'Admin contact']
              .map(l => <Field key={l} label={l} value={null} />)}
          </div>
        </div>
      )}

      {/* ── 5. BANKING ── */}
      {tab === 'finance' && (
        <div key={tab} className="cp-in" style={block()}>
          <StatStrip isMobile={isMobile} items={[
            { label: 'Bank accounts', accent: ACC, value: d.banks.length,
              hint: d.banks.length ? `${d.banks.filter(b => b.is_primary).length} primary` : 'none on record' },
            { label: 'Currency', accent: ACCENT.org, value: co.currency ?? 'INR' },
            { label: 'FY starts', accent: ACCENT.payroll,
              value: co.fy_start_month ? MONTH[co.fy_start_month].slice(0,3) : '—' },
          ]} />
          <Head>Financial</Head>
          <div style={grid(cols)}>
            <Field label="Currency" value={co.currency ?? 'INR'} />
            <Field label="Financial year starts" value={co.fy_start_month ? MONTH[co.fy_start_month] : null} />
            <Field label="Financial year ends" value={co.fy_start_month
              ? `${MONTH[((co.fy_start_month + 10) % 12) + 1]}` : null} />
          </div>
          <div style={{ marginTop: 16 }}>
            <Head>Bank accounts ({d.banks.length})</Head>
            <div style={{ display: 'grid', gap: 8 }}>
              {d.banks.map(b => (
                <div key={b.id} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr 1fr .8fr',
                                         gap: 10, padding: '9px 10px', border: `1px solid ${C.line}`, borderRadius: 9 }}>
                  <Field label="Bank" value={<>{b.bank_name}{b.is_primary && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: R.pill, background: C.brandTint, color: C.brandDeep, fontWeight: W.semi }}>primary</span>}</>} />
                  <Field label="Account" value={b.account_number} mono />
                  <Field label="IFSC" value={b.ifsc_code} mono />
                  <Field label="Type" value={b.account_type} />
                </div>
              ))}
              {!d.banks.length && (
                <span style={{ fontSize: F.micro, color: C.faint }}>
                  No bank account recorded. Salary disbursement needs at least one.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 6. STRUCTURE ── */}
      {tab === 'org' && (
        <div key={tab} className="cp-in">
          <div style={block()}>
            <StatStrip isMobile={isMobile} items={[
              { label: 'Departments', accent: ACC, value: d.departments.length },
              { label: 'Sites', accent: ACCENT.location, value: d.branches.length },
              { label: 'Cost centres', accent: ACCENT.finance,
                value: new Set(d.departments.map(x => x.cost_center).filter(Boolean)).size },
              { label: 'Avg dept size', accent: ACCENT.hr,
                value: d.departments.length ? Math.round(headTotal / d.departments.length) : '—',
                hint: 'people per department' },
            ]} />
            <Head>Organisation</Head>
            <div style={grid(cols)}>
              <Field label="Structure type" value={co.structure_type} />
              <Field label="Departments" value={d.departments.length || null} />
              <Field label="Sites" value={d.branches.length || null} />
              <Field label="Cost centres" value={
                Array.from(new Set(d.departments.map(x => x.cost_center).filter(Boolean))).length || null} />
            </div>
          </div>
          <div style={block()}>
            <Head>Headcount by department</Head>
            <BarList data={d.departments
              .map(dep => ({ label: dep.dept_name, value: d.deptHeadcount[dep.id] ?? 0 }))
              .filter(x => x.value > 0)
              .sort((a, b) => b.value - a.value)} />
          </div>
          <div style={block()}>
            <Head>Headcount by site</Head>
            <BarList data={d.branches
              .map(b => ({ label: b.location_name, value: d.head?.byLocation[b.id]?.total ?? 0 }))
              .sort((a, b) => b.value - a.value)} />
          </div>
        </div>
      )}

      {/* ── 7. PAYROLL ── */}
      {tab === 'payroll' && (
        <div key={tab} className="cp-in" style={block()}>
          <StatStrip isMobile={isMobile} items={[
            { label: 'Frequency', accent: ACC, value: co.payroll_frequency?.replace('_','-').toLowerCase() ?? '—' },
            { label: 'Paid on', accent: ACCENT.finance, value: ord(co.salary_disbursement_day) ?? '—' },
            { label: 'Currency', accent: ACCENT.org, value: co.currency ?? 'INR' },
            { label: 'Registrations', accent: ACCENT.statutory,
              value: `${[co.epf_code, co.esic_code, co.wc_policy_number].filter(Boolean).length}/3`,
              fill: [co.epf_code, co.esic_code, co.wc_policy_number].filter(Boolean).length / 3,
              hint: 'EPF · ESIC · WC' },
          ]} />
          <Head>Payroll configuration</Head>
          <div style={grid(cols)}>
            <Field label="Frequency" value={co.payroll_frequency?.replace('_', '-').toLowerCase()} />
            <Field label="Cycle starts" value={ord(co.payroll_cycle_start_day)} />
            <Field label="Salary disbursed" value={ord(co.salary_disbursement_day)} />
            <Field label="Pay currency" value={co.currency ?? 'INR'} />
            <Field label="EPF registration" value={co.epf_code ? <CodeChip value={co.epf_code} accent={ACC} /> : null} />
            <Field label="ESIC registration" value={co.esic_code ? <CodeChip value={co.esic_code} accent={ACC} /> : null} />
            <Field label="Workmen's compensation" value={co.wc_policy_number} mono />
            <Field label="PT registration" value={
              d.regs.find(r => r.reg_type === 'PT' && !r.location_id)?.reg_number} mono />
          </div>
        </div>
      )}

      {/* ── 8. STATUTORY ── */}
      {tab === 'statutory' && (
        <div key={tab} className="cp-in" style={block()}>
          {(() => {
            const declared = [co.pf_status, co.esic_status, co.maternity_compliant, co.dpdp_compliant]
              .filter(v => v !== null && v !== undefined).length
            const licensed = d.branches.filter(b => {
              const t = (b.location_type || '').toLowerCase().includes('factory') ? 'FACTORY' : 'SE'
              return d.regs.some(r => r.location_id === b.id && r.reg_type === t && r.reg_number)
            }).length
            return (
              <StatStrip isMobile={isMobile} items={[
                { label: 'Status declared', accent: ACC, value: `${declared}/4`, fill: declared / 4,
                  hint: 'PF · ESIC · Maternity · DPDP' },
                { label: 'Sites licensed', accent: ACCENT.location,
                  value: `${licensed}/${d.branches.length}`,
                  fill: d.branches.length ? licensed / d.branches.length : 0 },
                { label: 'Factories', accent: ACCENT.org,
                  value: d.branches.filter(b => (b.location_type||'').toLowerCase().includes('factory')).length },
                { label: 'Other sites', accent: ACCENT.finance,
                  value: d.branches.filter(b => !(b.location_type||'').toLowerCase().includes('factory')).length,
                  hint: 'need S&E' },
              ]} />
            )
          })()}
          <Head>Statutory status</Head>
          <div style={grid(cols)}>
            <Field label="Provident Fund" value={co.pf_status?.replace('_', ' ').toLowerCase()} />
            <Field label="ESIC" value={co.esic_status?.replace('_', ' ').toLowerCase()} />
            <Field label="Maternity Benefit Act" value={
              co.maternity_compliant == null ? null : co.maternity_compliant ? 'Compliant' : 'Not compliant'} />
            <Field label="DPDP Act 2023" value={
              co.dpdp_compliant == null ? null : co.dpdp_compliant ? 'Compliant' : 'Not compliant'} />
          </div>
          <div style={{ marginTop: 16 }}>
            <Head>Establishment licences</Head>
            <div style={{ display: 'grid', gap: 7 }}>
              {d.branches.map(b => {
                const isFactory = (b.location_type || '').toLowerCase().includes('factory')
                const type = isFactory ? 'FACTORY' : 'SE'
                const r = d.regs.find(x => x.location_id === b.id && x.reg_type === type)
                const st = regHealth(r)
                const tone = st.state === 'MISSING' || st.state === 'EXPIRED' ? C.critical
                           : st.state === 'EXPIRING' ? C.warning : C.positive
                return (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                                           padding: '7px 10px', border: `1px solid ${C.line}`, borderRadius: 9 }}>
                    <span style={{ fontSize: F.small, minWidth: 150 }}>{b.location_name}</span>
                    <span style={{ fontSize: F.micro, color: C.muted, minWidth: 120 }}>
                      {isFactory ? 'Factory Licence' : 'Shops & Establishment'}
                    </span>
                    <span style={{ fontSize: F.micro, color: C.ink, flex: 1, fontFamily: 'ui-monospace, monospace' }}>
                      {r?.reg_number || '—'}
                    </span>
                    <span style={{ fontSize: F.micro, color: tone, fontWeight: W.semi }}>
                      {st.state === 'MISSING' ? 'Not recorded' : st.state.toLowerCase()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 9. PEOPLE ── */}
      {tab === 'hr' && (
        <div key={tab} className="cp-in">
          <div style={block()}>
            {(() => {
              const g = d.head?.company
              const fPct = g && g.total ? Math.round((g.female / g.total) * 100) : null
              const attr = headTotal + d.leavers12m > 0
                ? (d.leavers12m / (headTotal + d.leavers12m)) * 100 : null
              return (
                <StatStrip isMobile={isMobile} items={[
                  { label: 'Headcount', accent: ACC, value: headTotal,
                    hint: co.approved_strength ? `of ${co.approved_strength} sanctioned` : 'no cap set',
                    fill: co.approved_strength ? headTotal / co.approved_strength : undefined },
                  { label: 'Women', accent: '#DB2777', value: g?.female ?? 0,
                    hint: fPct != null ? `${fPct}% of headcount` : undefined,
                    fill: fPct != null ? fPct / 100 : undefined },
                  { label: 'Men', accent: '#2563EB', value: g?.male ?? 0,
                    hint: g && g.total ? `${Math.round((g.male / g.total) * 100)}% of headcount` : undefined },
                  { label: 'Attrition', accent: attr != null && attr > 15 ? '#DC2626' : ACCENT.org,
                    value: attr != null ? `${attr.toFixed(1)}%` : '—',
                    hint: `${d.leavers12m} left in 12 months` },
                ]} />
              )
            })()}
            <Head>Headcount</Head>
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', alignItems: 'center' }}>
              <GenderSplit counts={d.head?.company ?? { male:0, female:0, other:0, unknown:0, total:0 }} size={86} />
              <div style={{ minWidth: 230, display: 'grid', gap: 12 }}>
                <Capacity used={headTotal} cap={co.approved_strength ?? null} label="Against sanctioned strength" />
                <div style={grid(2)}>
                  <Field label="Current headcount" value={headTotal} mono />
                  <Field label="Left in last 12 months" value={d.leavers12m} mono />
                </div>
                <Field label="Attrition (12m)" value={
                  headTotal + d.leavers12m > 0
                    ? `${((d.leavers12m / (headTotal + d.leavers12m)) * 100).toFixed(1)}%`
                    : null} mono />
              </div>
            </div>
          </div>
          <div style={block()}>
            <Head>Employment type</Head>
            <BarList data={Object.entries(d.employmentMix)
              .map(([k, v]) => ({ label: k, value: v }))
              .sort((a, b) => b.value - a.value)} />
          </div>
          <div style={block()}>
            <Head>HR defaults</Head>
            <div style={grid(cols)}>
              <Field label="Sanctioned strength" value={co.approved_strength} mono />
              <Field label="Default employment type" value={co.default_employment_type} />
              <Field label="Probation" value={co.probation_days ? `${co.probation_days} days` : null} />
              <Field label="Notice period" value={co.notice_period_days ? `${co.notice_period_days} days` : null} />
              <Field label="Max leave carry-forward" value={co.max_leave_carryforward} mono />
              <Field label="Leave year starts" value={co.leave_year_start_month ? MONTH[co.leave_year_start_month] : null} />
            </div>
          </div>
        </div>
      )}

      {/* ── 10. BRAND ── */}
      {tab === 'brand' && (
        <div key={tab} className="cp-in" style={block()}>
          <StatStrip isMobile={isMobile} items={[
            { label: 'Core values', accent: ACC, value: co.core_values?.length ?? 0 },
            { label: 'Statements', accent: ACCENT.compliance,
              value: `${[co.vision_statement, co.mission_statement, co.tagline].filter(Boolean).length}/3`,
              fill: [co.vision_statement, co.mission_statement, co.tagline].filter(Boolean).length / 3,
              hint: 'vision · mission · tagline' },
            { label: 'Social links', accent: ACCENT.location,
              value: [co.linkedin_url, co.twitter_url, co.facebook_url].filter(Boolean).length },
          ]} />
          <Head>Brand &amp; culture</Head>
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Tagline" value={co.tagline} />
            <Field label="Vision" value={co.vision_statement} />
            <Field label="Mission" value={co.mission_statement} />
            <div>
              <div style={{ fontSize: F.micro, color: C.faint, textTransform: 'uppercase',
                            letterSpacing: .3, fontWeight: W.semi, marginBottom: 5 }}>Core values</div>
              {co.core_values?.length
                ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {co.core_values.map(v => (
                      <span key={v} style={{ fontSize: F.micro, padding: '3px 10px', borderRadius: R.pill,
                        background: C.brandTint, color: C.brandDeep, fontWeight: W.semi }}>{v}</span>
                    ))}
                  </div>
                : <span style={{ fontSize: F.small, color: C.faint }}>Not recorded</span>}
            </div>
            <div style={grid(cols)}>
              <div>
                <div style={{ fontSize: F.micro, color: C.faint, textTransform: 'uppercase',
                              letterSpacing: .3, fontWeight: W.semi, marginBottom: 3 }}>Brand colours</div>
                {co.brand_primary || co.brand_secondary ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {[co.brand_primary, co.brand_secondary].filter(Boolean).map(hex => (
                      <span key={hex!} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: hex!,
                                       border: `1px solid ${C.line}` }} />
                        <code style={{ fontSize: F.micro, color: C.muted }}>{hex}</code>
                      </span>
                    ))}
                  </div>
                ) : <span style={{ fontSize: F.small, color: C.faint }}>Not recorded</span>}
              </div>
              <Field label="Brand font" value={co.brand_font} />
              <Field label="Social" value={
                [['LinkedIn', co.linkedin_url], ['Twitter', co.twitter_url], ['Facebook', co.facebook_url]]
                  .filter(([, u]) => u).length
                  ? <span style={{ display: 'flex', gap: 10 }}>
                      {([['LinkedIn', co.linkedin_url], ['Twitter', co.twitter_url], ['Facebook', co.facebook_url]] as const)
                        .filter(([, u]) => u)
                        .map(([n, u]) => <a key={n} href={u!} target="_blank" rel="noreferrer"
                                            style={{ color: C.brand, fontSize: F.micro }}>{n}</a>)}
                    </span>
                  : null} />
            </div>
          </div>
        </div>
      )}

      {/* ── 11. DOCUMENTS ── */}
      {tab === 'documents' && (
        <div key={tab} className="cp-in">
          <div style={block()}>
            {(() => {
              const onFile = DOC_TYPES.filter(t => d.policy?.docs.some(x => x.doc_type === t.code && x.is_current)).length
              return (
                <StatStrip isMobile={isMobile} items={[
                  { label: 'On file', accent: ACC, value: `${onFile}/${DOC_TYPES.length}`,
                    fill: onFile / DOC_TYPES.length },
                  { label: 'Missing', accent: onFile === DOC_TYPES.length ? ACCENT.finance : '#DC2626',
                    value: DOC_TYPES.length - onFile },
                  { label: 'Directors', accent: ACCENT.compliance, value: d.policy?.directors.length ?? 0 },
                  { label: 'Signatories', accent: ACCENT.org,
                    value: (d.policy?.directors ?? []).filter(x => x.is_signatory).length },
                ]} />
              )
            })()}
            <Head>Document repository</Head>
            <div style={{ display: 'grid', gap: 8 }}>
              {DOC_TYPES.map(t => {
                const doc = d.policy?.docs.find(x => x.doc_type === t.code && x.is_current)
                return (
                  <div key={t.code} style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 10,
                  }}>
                    <span aria-hidden style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: doc ? C.positiveTint : C.sunken, color: doc ? C.positive : C.faint,
                    }}>
                      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M9.5 1.5H4a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V5.5L9.5 1.5Z" strokeLinejoin="round" />
                        <path d="M9.5 1.5v4h4" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <div style={{ flex: 1, minWidth: 170 }}>
                      <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{t.label}</div>
                      <div style={{ fontSize: F.micro, color: doc ? C.muted : C.faint }}>
                        {doc
                          ? [doc.file_name, doc.version && `v${doc.version}`].filter(Boolean).join(' · ')
                          : 'Not uploaded'}
                      </div>
                    </div>
                    {doc?.valid_till && (
                      <span style={{ fontSize: F.micro, color: C.muted }}>
                        valid to {doc.valid_till}
                      </span>
                    )}
                    <span style={{
                      fontSize: F.micro, fontWeight: W.semi, padding: '2px 9px', borderRadius: R.pill,
                      background: doc ? C.positiveTint : C.criticalTint,
                      color: doc ? C.positive : C.critical, whiteSpace: 'nowrap',
                    }}>{doc ? 'On file' : 'Missing'}</span>
                  </div>
                )
              })}
            </div>
            {/* Upload needs both migration 078 AND a storage bucket, and the
                bucket is not something SQL can create. Saying which is
                outstanding beats a button that fails. */}
            <div style={{ marginTop: 12, fontSize: F.micro, color: C.faint, lineHeight: 1.6 }}>
              Uploads need migration <strong>078</strong> and a private
              <code style={{ fontFamily: 'ui-monospace, monospace' }}> company-docs </code>
              storage bucket. Until both exist there is nowhere to put the file.
            </div>
          </div>

          <div style={block()}>
            <Head>Directors &amp; board ({d.policy?.directors.length ?? 0})</Head>
            <div style={{ display: 'grid', gap: 7 }}>
              {(d.policy?.directors ?? []).map(dir => (
                <div key={dir.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  padding: '9px 11px', border: `1px solid ${C.line}`, borderRadius: 9,
                }}>
                  <span style={{ fontSize: F.small, fontWeight: W.semi, minWidth: 150 }}>{dir.person_name}</span>
                  <span style={{ fontSize: F.micro, color: C.muted, minWidth: 120 }}>{dir.designation || '—'}</span>
                  <span style={{ fontSize: F.micro, color: C.muted, fontFamily: 'ui-monospace, monospace' }}>
                    {dir.din ? `DIN ${dir.din}` : ''}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {dir.is_board_member && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: R.pill, background: C.brandTint, color: C.brandDeep, fontWeight: W.semi }}>board</span>}
                    {dir.is_signatory && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: R.pill, background: C.warningTint, color: C.warning, fontWeight: W.semi }}>signatory</span>}
                  </span>
                </div>
              ))}
              {!(d.policy?.directors.length) && (
                <span style={{ fontSize: F.micro, color: C.faint }}>
                  No directors recorded. Needs migration 078.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 12. POLICIES ── */}
      {tab === 'policy' && (
        <div key={tab} className="cp-in">
          <div style={block()}>
            {(() => {
              const offs = new Set((d.policy?.weeklyOff ?? []).filter(w => w.mode === 'EVERY').map(w => w.weekday)).size
              const sh = d.policy?.shifts?.[0]
              const hrs = sh ? shiftHours(sh) : null
              return (
                <StatStrip isMobile={isMobile} items={[
                  { label: 'Working days', accent: ACC, value: d.policy?.weeklyOff.length ? 7 - offs : '—',
                    hint: 'per week' },
                  { label: 'Shift hours', accent: ACCENT.payroll, value: hrs != null ? `${hrs}h` : '—',
                    hint: sh ? `${(sh.in_time||'').slice(0,5)}–${(sh.out_time||'').slice(0,5)}` : undefined },
                  { label: 'Shifts', accent: ACCENT.org, value: d.policy?.shifts.length ?? 0 },
                  { label: 'Leave types', accent: ACCENT.hr, value: d.policy?.leaveTypes.length ?? 0,
                    hint: `${(d.policy?.leaveTypes ?? []).filter(l => l.encashment_after != null).length} encashable` },
                ]} />
              )
            })()}
            <Head>Working days &amp; hours</Head>
            <div style={grid(isMobile ? 1 : 2)}>
              <Field label="Weekly off" value={
                (d.policy?.weeklyOff.length)
                  ? d.policy.weeklyOff.map(w =>
                      `${WEEKDAY[w.weekday] ?? w.weekday}${w.mode && w.mode !== 'EVERY' ? ` (${w.mode.toLowerCase()})` : ''}`
                    ).join(', ')
                  : null} />
              <Field label="Working days" value={
                (d.policy?.weeklyOff.length)
                  ? `${7 - new Set(d.policy.weeklyOff.filter(w => w.mode === 'EVERY').map(w => w.weekday)).size} per week`
                  : null} />
              <Field label="Attendance mode" value={
                co.attendance_modes?.length
                  ? co.attendance_modes.map(m => m.toLowerCase()).join(', ')
                  : null} />
              <Field label="Notice period" value={co.notice_period_days ? `${co.notice_period_days} days` : null} />
            </div>
          </div>

          <div style={block()}>
            <Head>Shifts ({d.policy?.shifts.length ?? 0})</Head>
            <div style={{ display: 'grid', gap: 7 }}>
              {(d.policy?.shifts ?? []).map(sh => {
                const hrs = shiftHours(sh)
                return (
                  <div key={sh.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: '9px 11px', border: `1px solid ${C.line}`, borderRadius: 9,
                  }}>
                    <span style={{ fontSize: F.small, fontWeight: W.semi, minWidth: 120 }}>{sh.shift_code}</span>
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: R.pill,
                                   background: C.sunken, color: C.inkSoft }}>{sh.shift_type || '—'}</span>
                    <span style={{ fontSize: F.small, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
                      {(sh.in_time || '—').slice(0,5)} – {(sh.out_time || '—').slice(0,5)}
                    </span>
                    <span style={{ fontSize: F.micro, color: C.muted }}>
                      {sh.lunch_duration_mins ? `${sh.lunch_duration_mins}m break` : 'no break recorded'}
                    </span>
                    {/* Derived, not stored — see shiftHours(). */}
                    <span style={{ marginLeft: 'auto', fontSize: F.small, fontWeight: W.bold, color: C.brandDeep }}>
                      {hrs != null ? `${hrs} h` : '—'}
                    </span>
                    {sh.overtime_applicable && (
                      <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: R.pill,
                                     background: C.warningTint, color: C.warning, fontWeight: W.semi }}>OT</span>
                    )}
                  </div>
                )
              })}
              {!(d.policy?.shifts.length) && <span style={{ fontSize: F.micro, color: C.faint }}>No shift recorded.</span>}
            </div>
          </div>

          <div style={block()}>
            <Head>Leave types ({d.policy?.leaveTypes.length ?? 0})</Head>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {(d.policy?.leaveTypes ?? []).map(l => (
                <span key={l.id} title={l.name} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: F.micro, padding: '4px 10px', borderRadius: R.pill,
                  background: C.sunken, border: `1px solid ${C.line}`, color: C.ink,
                }}>
                  <strong style={{ color: C.brandDeep }}>{l.short_name || '—'}</strong>
                  <span style={{ color: C.muted }}>{l.name}</span>
                  {l.encashment_after != null && (
                    <span style={{ color: C.faint }}>· encashable</span>
                  )}
                </span>
              ))}
              {!(d.policy?.leaveTypes.length) && <span style={{ fontSize: F.micro, color: C.faint }}>No leave types configured.</span>}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={grid(isMobile ? 1 : 3)}>
                <Field label="Leave year starts" value={co.leave_year_start_month ? MONTH[co.leave_year_start_month] : null} />
                <Field label="Max carry-forward" value={co.max_leave_carryforward} mono />
                <Field label="Probation" value={co.probation_days ? `${co.probation_days} days` : null} />
              </div>
            </div>
          </div>

          <div style={block()}>
            <Head>Bonus &amp; gratuity</Head>
            <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>
              Gratuity eligibility is held per employee
              (<code style={{ fontFamily: 'ui-monospace, monospace', fontSize: F.micro }}>employees.gratuity_eligible</code>),
              not as a company-wide rule, and
              <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: F.micro }}> bonus_config </code>
              exists but has no rows. There is no company-level bonus policy to show yet.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
