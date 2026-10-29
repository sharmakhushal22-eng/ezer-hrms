'use client'
// components/pms/AdminTabs.tsx — the HR Admin side of the PMS. Spec §6.
//
// Six tabs, named as the spec names them:
//   PMS Configuration · Policy Builder · Fill Status Tracker
//   Final Rating Upload · PIP Management · Reports & Export
//
// LAYOUT COMES FROM THE MOCKUP, COLOUR COMES FROM THE APP
//
// The structure here is EZER-PMS-Mockup-v2.html's, close to literally: the
// same cards, the same four-up field grids, the same bordered scroll tables,
// the same pills. The mockup's violet is not carried over — every colour
// resolves through --ez-* in pms.css, so this looks like the rest of the HRMS
// and follows the theme toggle. See that file's header for the full mapping.
//
// WHAT IS REAL AND WHAT IS WAITING
//
// Migration 066 — the 15 pms_* tables — WAS APPLIED on 3 September. Verified
// against the live database, not assumed: 3 policies, 12 periods and 395
// enrolment rows. So an empty table on this screen means nothing has been
// configured, NOT that a migration is missing, and the copy says so.
//
// (On this branch 079 is group_profile and 055-057 are an old rolled-back RMS
// attempt. The spec folder ships the same schema as 079_pms_module_v2.sql;
// 066 is the file that carries it here.)
// So the tabs divide into two kinds, and it matters which is which:
//
//   Real now  — Cycle setup (periods are computed here, not fetched), Fill
//               status (reads vw_pms_fill_status when it exists), Reports
//               (the catalogue is the spec's own table).
//   Structure — Policies, Upload, PIP. These render their real shape with an
//               honest empty state. The mockup fills them with
//               sample employees; inventing Rajesh Mehta here would be worse
//               than an empty table, because somebody would try to act on him.
//
// HR Admin is NOT a step in the approval chain. The chain runs
// Employee → RM L1 → RM L2 → finalised by whoever the policy appoints. This
// screen sits across all of it: configuring, chasing, correcting, reporting.
//
// THE ONE NON-NEGOTIABLE, restated where somebody might try to change it:
// the PMS is developmental. payout_linkage_enabled is pinned false by a CHECK
// constraint. No config surface here can turn it on, and none should try.
//
// Sub-components live at module scope — declared inside the parent they
// remount on every keystroke and inputs lose focus, a bug this codebase has
// already had once.

import { useState, useMemo } from 'react'
import './pms.css'
import { PERIODS_PER_YEAR, previewPeriods, windowsFor, periodState, conflicts,
         type Frequency, type Policy, type Person } from '@/lib/pms/policy'
import { FLAG_LABEL, FLAG_MEANING, type Flag } from '@/lib/pms/employment'
import { TEMPLATE_COLUMNS, ERROR_TEXT, checkUpload, summarise,
         type UploadRow } from '@/lib/pms/upload'
import { STATUS_LABEL, whatNext, type Pip } from '@/lib/pms/pip'
import { CHAINS, CHAIN_LABEL, FINALISERS, FINALISER_LABEL, FLOW, FLOW_ENDS,
         ROLES, ROLE_LABEL, ACTIONS, ACTION_LABEL, may, SCOPE_NOTE,
         REPORTING_LINE, type Role } from '@/lib/pms/hierarchy'
import { DEFAULT_RULES } from '@/lib/pms/cycle'
import { FILL_ORDER, FILL_LABEL, type FillStatus } from '@/lib/pms/status'
import { rollUp, type FillRow } from '@/lib/pms/rollup'
import { csvText, parseCsv } from '@/lib/pms/csv'
import { pmsAdmin } from '@/lib/pms/adminClient'
import { humanDate } from '@/lib/pms/cycle'

/** §6.1's configuration, as the policy row holds it. Named in the screen's
 *  own terms rather than the column names, so the page does the mapping once
 *  and this file never has to know about snake_case. */
export interface PolicyConfig {
  /** Which policy these values came from, so the screen can say so. With one
   *  policy per company the config screen shows one of several and must not
   *  imply it is describing all of them. */
  policyName?: string | null
  companyName?: string | null
  /** Identity, so the tab can offer a choice between policies rather than
   *  silently describing whichever one came back first — the bug that made
   *  edits in Setup & Controls look as though they had not applied. */
  policyId?: string | null
  companyId?: string | null
  policyCount?: number
  minKra: number
  maxKra: number
  totalWeightage: number
  minWeightagePerKra: number
  kraCreatedBy?: string | null
  oneToOneMandatory?: boolean | null
  midPeriodCheckin?: boolean | null
  finalReviewOneToOne?: boolean | null
  approvalChain?: string | null
  whoCanFinalise?: string | null
  ratingScaleType?: string | null
  selfRatingMandatory?: boolean | null
  newJoinerCutoffDays?: number | null
  includeNoticePeriod?: boolean | null
  includeExited?: boolean | null
  /** 202: who runs the appraisal after the rating is settled. */
  postFinalOwner?: string | null
  /** 203: may this company's employees be published from a combined list. */
  publishScope?: string | null
}

export type AdminTab =
  | 'config' | 'setup' | 'policies' | 'fill' | 'publish' | 'summary' | 'upload'
  | 'pip' | 'reports'

export const ADMIN_TABS: { k: AdminTab; label: string; blurb: string }[] = [
  { k: 'config',   label: 'PMS Configuration',  blurb: 'Frequency, windows and the KRA rules everyone is held to' },
  // The only tab that writes. Everything else on this screen reports.
  { k: 'setup',    label: 'Setup & Controls',   blurb: 'Edit the policy, KRA library and rating scale; generate and open periods' },
  { k: 'policies', label: 'Policy Builder',     blurb: 'Different cycles for different groups, and who falls under which' },
  { k: 'fill',     label: 'Fill Status Tracker',blurb: 'Live status for everyone, and who to chase' },
  { k: 'publish',  label: 'Publish Results',    blurb: 'Settled ratings: write the feedback, award recognition, release' },
  { k: 'summary',  label: 'Ratings Summary',    blurb: 'Every employee\'s rating and where their appraisal stands' },
  { k: 'upload',   label: 'Final Rating Upload',blurb: 'Bulk override from an offline calibration' },
  { k: 'pip',      label: 'PIP Management',     blurb: 'Requests from managers, and the plans you have started' },
  { k: 'reports',  label: 'Reports & Export',   blurb: 'The fourteen reports, and Excel export' },
]

// ── shared pieces, all at module scope ───────────────────────────────────

function Card({ title, sub, children }: {
  title?: string; sub?: string; children: React.ReactNode
}) {
  return (
    <div className="card">
      {title && <h3>{title}</h3>}
      {sub && <div className="sub">{sub}</div>}
      {children}
    </div>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 10px' }}>{children}</h3>
}

function Field({ label, hint, locked, children }: {
  label: string; hint?: string; locked?: boolean; children: React.ReactNode
}) {
  return (
    <div className={locked ? 'fld locked' : 'fld'}>
      <label>{label}</label>
      {children}
      {hint && <div className="k">{hint}</div>}
    </div>
  )
}

/**
 * A value that is in force but cannot be edited here.
 *
 * Everything on this screen writes to pms_policies, which does not exist yet.
 * The first version drew these as <input readOnly> to match the mockup's
 * fields — and that was a promise the screen could not keep: a bordered white
 * box with a caret invites typing, and an admin who types gets silence. This
 * renders as a value instead, so the shape of the thing tells the truth about
 * what it does.
 */
function Fixed({ label, value, hint, locked }: {
  label: string; value: string; hint?: string; locked?: boolean
}) {
  return (
    <Field label={label} hint={hint} locked={locked}>
      <div className="ro">{value}</div>
    </Field>
  )
}

function Pill({ tone, children }: {
  tone: 'green' | 'brand' | 'amber' | 'red' | 'grey' | 'blue' | 'orange'
  children: React.ReactNode
}) {
  return <span className={`pill p-${tone}`}>{children}</span>
}

/** The same three-up figure the manager surfaces use, so a count means the
 *  same thing and looks the same on both sides of the product. */
function Stat({ label, value, note, tone }: {
  label: string; value: React.ReactNode; note?: string; tone?: 'accent' | 'warn'
}) {
  return (
    <div className={tone === 'accent' ? 'stat accent' : tone === 'warn' ? 'stat warn' : 'stat'}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  )
}

function Note({ tone = 'info', children }: {
  tone?: 'info' | 'warn'; children: React.ReactNode
}) {
  return (
    <div className={tone === 'warn' ? 'banner b-amber' : 'banner b-blue'}>
      <span aria-hidden="true">{tone === 'warn' ? '!' : 'ℹ️'}</span>
      <div>{children}</div>
    </div>
  )
}

function Empty({ what, why }: { what: string; why: string }) {
  return (
    <div style={{ padding: '22px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{what}</div>
      <div className="k" style={{ maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>{why}</div>
    </div>
  )
}

/**
 * "No rows" is NOT "no table", and saying the wrong one wastes somebody's day.
 *
 * 066 was applied on 3 September and the live database now holds 3 policies,
 * 12 periods and 395 enrolment rows. An empty table here therefore means
 * nothing has been CONFIGURED yet — telling HR that a migration is missing
 * would send them to the DBA for a problem they can solve themselves in five
 * minutes. The genuine missing-table case is caught upstream by the PGRST205
 * probe, which renders its own screen.
 */
const NOTHING_CONFIGURED_YET =
  'The performance tables are live, so this is empty because nothing has been ' +
  'set up yet rather than because anything is broken. Configure it in the tabs ' +
  'above and rows appear here.'

/** dd-Mmm-yy, the mockup's date format, which is what an Indian HR team reads. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return '-'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')}-${M[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`
}

/** "01–15 Apr" — a window, collapsed when both ends share a month. */
function windowText(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '-'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = (d: Date) => String(d.getUTCDate()).padStart(2, '0')
  return a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()
    ? `${dd(a)}–${dd(b)} ${M[b.getUTCMonth()]}`
    : `${dd(a)} ${M[a.getUTCMonth()]} – ${dd(b)} ${M[b.getUTCMonth()]}`
}

// ── §6.1 PMS Configuration ───────────────────────────────────────────────

const FREQ_LABEL: Record<Frequency, string> = {
  MONTHLY: 'Monthly', QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-Yearly', ANNUAL: 'Annual',
}

/**
 * §6.1's configuration, READ FROM THE POLICY.
 *
 * Every value on this screen used to be a literal. DEFAULT_RULES for the KRA
 * counts, the string "Employee (RM approves)" for who writes them,
 * CHAIN_LABEL[CHAINS[0]] and FINALISER_LABEL[FINALISERS[0]] for the workflow
 * — the FIRST entry of each array rather than the policy's own value. So it
 * showed "RM L1, RM L2 or HOD" while every company in the database is
 * actually HOD_ONLY, and an admin who changed anything in Setup & Controls
 * saw this screen report the old values back. Reported as "changing
 * configuration is not getting in effect, and not reflected on PMS
 * Configuration".
 *
 * `policy` is optional so the screen still renders before the first load, and
 * says so rather than printing confident defaults.
 */
export function ConfigTab({ freq, onFreq, fyStart, fyLabel, today, policy,
                            choices = [], onChoosePolicy }: {
  freq: Frequency; onFreq: (f: Frequency) => void
  fyStart: string; fyLabel: string; today: string
  policy?: PolicyConfig | null
  /** Every policy in scope. More than one means this tab MUST let the admin
   *  say which it is describing — see the note on the selector below. */
  choices?: PolicyConfig[]
  onChoosePolicy?: (policyId: string) => void
}) {
  const yn = (v: boolean | null | undefined, yes: string, no: string) =>
    v === null || v === undefined ? '—' : v ? yes : no
  const periods = previewPeriods(freq, fyStart)
  return (
    <>
      <Card title="Cycle & frequency preview"
            sub="Try a frequency and every period below regenerates, windows and all. This is a preview. Nothing here is saved.">
        <div className="grid g4">
          {/* NOT "All companies". Three policies exist, one per company, and
              this screen reads one of them — saying "all" was a claim it could
              not support and hid the fact that the others may differ. */}
          {/* A SELECTOR, NOT A LABEL, once there is more than one policy.
              This tab used to describe whichever policy came back first from
              an unordered query, with no company shown — so editing one
              company's policy in Setup & Controls and returning here showed a
              different company's settings, unchanged, and the edit looked lost.
              The name alone cannot distinguish them: all three are called
              "Standard Quarterly". */}
          {choices.length > 1 && onChoosePolicy ? (
            <Field label="Policy shown here"
                   hint={`${choices.length} policies exist and they differ. Pick the one you edited.`}>
              <select value={policy?.policyId ?? ''}
                      onChange={e => onChoosePolicy(e.target.value)}>
                {choices.map(c => (
                  <option key={c.policyId ?? ''} value={c.policyId ?? ''}>
                    {c.companyName ? `${c.companyName} · ` : ''}{c.policyName ?? 'Policy'}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Fixed label="Policy shown here"
                   value={policy?.policyName
                     ? `${policy.companyName ? policy.companyName + ' · ' : ''}${policy.policyName}`
                     : '—'} />
          )}
          <Fixed label="Financial year" value={fyLabel} hint={`Starts ${shortDate(fyStart)}`} />
          {/* A preview control, and now labelled as one. It sat beside real
              settings reading just "Frequency", so changing it looked like a
              change that would stick — onFreq only ever set React state.
              The control that saves is in Setup & Controls. */}
          <Field label="Frequency (preview only)"
                 hint="Save it in Setup & Controls → Policy rules">
            <select value={freq} onChange={e => onFreq(e.target.value as Frequency)}>
              {(Object.keys(PERIODS_PER_YEAR) as Frequency[]).map(f => (
                <option key={f} value={f}>
                  {FREQ_LABEL[f]} ({PERIODS_PER_YEAR[f]} {PERIODS_PER_YEAR[f] === 1 ? 'period' : 'periods'})
                </option>
              ))}
            </select>
          </Field>
          <Fixed label="Applicable to" value="All employees" />
        </div>

        <div className="divider" />
        <Section>Periods this creates</Section>
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Period</th><th>From</th><th>To</th>
                <th>KRA window</th><th>Self rating</th><th>RM review</th>
                <th>Finalise</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(p => {
                const w = windowsFor(p, freq)
                const st = periodState(p, freq, today)
                return (
                  <tr key={p.code} className={st === 'active' ? 'currentrow' : undefined}>
                    <td style={{ fontWeight: st === 'active' ? 700 : 400, whiteSpace: 'nowrap' }}>
                      {p.label}
                    </td>
                    <td>{shortDate(p.start)}</td>
                    <td>{shortDate(p.end)}</td>
                    <td>{windowText(w.kra.start, w.kra.end)}</td>
                    <td>{windowText(w.self.start, w.self.end)}</td>
                    <td>{windowText(w.rm.start, w.rm.end)}</td>
                    <td>{windowText(w.finalise.start, w.finalise.end)}</td>
                    <td>
                      {st === 'active'    && <Pill tone="brand">Open now</Pill>}
                      {st === 'closed'    && <Pill tone="grey">Closed</Pill>}
                      {st === 'scheduled' && <Pill tone="blue">Scheduled</Pill>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="k" style={{ marginTop: 8, lineHeight: 1.6 }}>
          KRAs are agreed at the <b>start</b> of a period and rated after it <b>ends</b>.
          Settling KRAs in the last week would leave the one-to-one nothing to influence.
        </div>

        <div className="divider" />
        <Section>KRA rules</Section>
        <div className="grid g4">
          <Fixed label="Minimum KRA count" value={String(policy?.minKra ?? DEFAULT_RULES.minKra)}
                 hint="Fewer than four and a rating rests on too little" />
          <Fixed label="Maximum KRA count" value={String(policy?.maxKra ?? DEFAULT_RULES.maxKra)}
                 hint="Past ten, weightages get too thin to mean anything" />
          <Fixed label="Total weightage must be" value={String(policy?.totalWeightage ?? DEFAULT_RULES.totalWeightage)}
                 hint="Exactly, not at least" />
          <Fixed label="Minimum weightage per KRA" value={String(policy?.minWeightagePerKra ?? DEFAULT_RULES.minWeightagePerKra)}
                 hint="Stops a token KRA carrying 1%" />
          <Fixed label="Who creates KRAs" value={
            policy?.kraCreatedBy === 'MANAGER' ? 'Their manager'
            : policy?.kraCreatedBy === 'BOTH' ? 'Either may write them'
            : policy?.kraCreatedBy === 'EMPLOYEE' ? 'The employee (RM approves)' : '—'} />
          <Fixed label="One-to-one mandatory"
                 value={yn(policy?.oneToOneMandatory, 'Yes, before weightage lock', 'No')} />
          <Fixed label="Mid-period check-in"
                 value={yn(policy?.midPeriodCheckin, 'Yes', 'Optional')} />
          <Fixed label="Final review one-to-one"
                 value={yn(policy?.finalReviewOneToOne, 'Mandatory before publish', 'Not required')} />
        </div>

        <div className="divider" />
        <Section>Workflow &amp; rating</Section>
        <div className="grid g4">
          <Fixed label="Approval chain" value={
            policy?.approvalChain
              ? ((CHAIN_LABEL as Record<string, string>)[policy.approvalChain]
                 // A chain the schema allows but lib/pms/hierarchy does not
                 // model — SELF_RM1_RM2_HOD_MD — has no label. Show the raw
                 // value and say so, rather than rendering "undefined".
                 ?? `${policy.approvalChain} (not supported yet)`)
              : '—'} />
          <Fixed label="Who can finalise" value={
            policy?.whoCanFinalise
              ? ((FINALISER_LABEL as Record<string, string>)[policy.whoCanFinalise]
                 ?? policy.whoCanFinalise)
              : '—'} />
          <Fixed label="Rating scale" value={
            policy?.ratingScaleType === 'FOUR_POINT_NR' ? '4 point + NR'
            : policy?.ratingScaleType === 'TEN_POINT' ? '10 point (1–10)'
            : policy?.ratingScaleType === 'FIVE_POINT' ? '5 point (1–5)' : '—'} />
          <Fixed label="Self rating mandatory"
                 value={yn(policy?.selfRatingMandatory, 'Yes, a manager cannot rate first', 'No')} />
        </div>

        <div className="divider" />
        <Section>Linkage &amp; eligibility</Section>
        <div className="grid g4">
          <Fixed label="Payout / CTC linkage" value="OFF (developmental only)" locked
                 hint="Locked off. No increment, variable or CTC impact." />
          <Fixed label="New joiner cut-off" value={
            policy?.newJoinerCutoffDays == null ? '—'
            : `${policy.newJoinerCutoffDays} days before the period ends`} />
          <Fixed label="Notice period employees"
                 value={yn(policy?.includeNoticePeriod, 'Include, and highlight', 'Exclude')} />
          <Fixed label="Exited employees"
                 value={yn(policy?.includeExited, 'Include, read-only after last working day', 'Exclude')} />
        </div>
        <div className="banner b-red" style={{ marginTop: 14, marginBottom: 0 }}>
          <span aria-hidden="true">🔒</span>
          <div>
            The payout lock is a database constraint, not a setting:{' '}
            <code>payout_linkage_enabled = false</code>. No screen, admin or API
            call can turn it on. Enabling it would take a migration that drops
            the CHECK. This PMS is developmental, and additional benefits stay
            recognition-only: certificate, nomination, award, no cash component.
          </div>
        </div>
      </Card>
    </>
  )
}

// ── §6.2 Policy Builder ──────────────────────────────────────────────────

export function PolicyTab({ policies, people }: {
  policies: Policy[]; people: (Person & { id: string })[]
}) {
  const trouble = useMemo(() => conflicts(policies, people), [policies, people])
  return (
    <>
      <Card title="Policy builder"
            sub="One company can run several policies at once: sales monthly, leadership half-yearly, workmen annual.">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Policy</th><th>Applies to</th><th>Frequency</th>
                <th>KRA min / max</th><th>Finalised by</th>
                <th className="num">Employees</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 0 }}>
                  <Empty what="No policies configured yet" why={NOTHING_CONFIGURED_YET} />
                </td></tr>
              ) : policies.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 700 }}>{p.name}</td>
                  <td>{[p.locationId, (p.grades ?? []).join('/'), p.departmentId].filter(Boolean).join(' · ') || 'All employees'}</td>
                  <td>{FREQ_LABEL[p.frequency]}</td>
                  <td>{p.minKra} / {p.maxKra}</td>
                  <td>{FINALISER_LABEL[p.whoCanFinalise]}</td>
                  <td className="num">-</td>
                  <td>{p.isActive ? <Pill tone="green">Active</Pill> : <Pill tone="amber">Draft</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divider" />
        <Section>Which policy an employee falls under</Section>
        <div className="flowbox">{
          'narrowest match wins\n\n' +
          '  location   ← most specific, checked first\n' +
          '  grade\n' +
          '  department\n' +
          '  all        ← the fallback\n\n' +
          'so a Sales person at the Pune plant follows Pune, not Sales.'
        }</div>
        <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Rule 14 says an employee is in <b>exactly one</b> active policy. Two policies
          of equal narrowness is a configuration mistake, so it is refused rather than
          guessed. Silently picking one only surfaces months later, when an appraisal
          routes to the wrong manager.
        </div>
      </Card>

      <Card title="Coverage check"
            sub="Run before a cycle opens, while a gap is still a five-minute fix.">
        {people.length === 0 ? (
          <Empty what="Nothing to check yet"
                 why="This reads the employee list against the configured policies. Add a policy in the tab above and the check runs against everybody." />
        ) : (
          <div className="grid g2">
            <div className="stat">
              <div className="lbl">Not covered</div>
              <div className={`val ${trouble.uncovered.length ? 'bad' : 'good'}`}>
                {trouble.uncovered.length}
              </div>
              <div className="note">No policy matches them. They cannot be rated at all</div>
            </div>
            <div className="stat">
              <div className="lbl">Contested</div>
              <div className={`val ${trouble.contested.length ? 'bad' : 'good'}`}>
                {trouble.contested.length}
              </div>
              <div className="note">Two policies match equally. The tie has to be broken by hand</div>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}

// ── §6.3 Fill Status Tracker ─────────────────────────────────────────────

const FILL_TONE: Record<FillStatus, 'red' | 'amber' | 'brand' | 'blue' | 'green'> = {
  NOT_STARTED: 'red', DRAFT_SAVED: 'amber', SUBMITTED: 'brand',
  IN_REVIEW: 'blue', FINALISED: 'green',
}

export function FillTab({ rows, deptNames, loading, totalWeightage = DEFAULT_RULES.totalWeightage}: {
  /** The policy's total, so a correct set is not coloured red on a policy
   *  whose total is not 100. */
  totalWeightage?: number
  rows: FillRow[] | null; deptNames: Record<string, string>; loading: boolean
}) {
  const [status, setStatus] = useState<'ALL' | FillStatus>('ALL')
  const [dept, setDept] = useState('ALL')
  const all = rows ?? []
  const roll = rollUp(all)
  const shown = all.filter(r =>
    (status === 'ALL' || r.fill_status === status) &&
    (dept === 'ALL' || (r.department_id ?? '') === dept))
  // The not-started export is deliberately NOT the filtered set: §6.3 lists it
  // as its own action, for chasing everybody who has not begun, and a
  // department filter left on from a previous look would quietly shrink the
  // chase list without saying so.
  const notStarted = all.filter(r => r.fill_status === 'NOT_STARTED')

  return (
    <>
      {/* Six cards, six columns. In a five-column grid the sixth wraps alone
          onto a second row beside a run of empty space, which reads as a
          rendering fault rather than a layout. */}
      <div className="grid g6" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="lbl">Total employees</div>
          <div className="val">{roll.total}</div>
        </div>
        {FILL_ORDER.map(s => {
          const n = roll.counts[s]
          const pct = roll.total ? Math.round((n / roll.total) * 1000) / 10 : 0
          const tone = s === 'NOT_STARTED' ? 'bad' : s === 'DRAFT_SAVED' ? 'wait'
                     : s === 'FINALISED' ? 'good' : 'brand'
          return (
            <div className="stat" key={s}>
              <div className="lbl">{FILL_LABEL[s]}</div>
              <div className={`val ${tone}`}>{n}</div>
              <div className="note">{pct}%</div>
            </div>
          )
        })}
      </div>

      <Card title="Fill status tracker"
            sub="Who has done what, live. Every column here is in the Excel export.">
        <div className="grid g5" style={{ marginBottom: 14 }}>
          <Field label="Department">
            <select value={dept} onChange={e => setDept(e.target.value)}>
              <option value="ALL">All departments</option>
              {Object.entries(deptNames).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={e => setStatus(e.target.value as 'ALL' | FillStatus)}>
              <option value="ALL">All statuses</option>
              {FILL_ORDER.map(s => <option key={s} value={s}>{FILL_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Employment"><select disabled><option>All</option></select></Field>
          <Field label="Company"><select disabled><option>All companies</option></select></Field>
          <div className="fld" style={{ alignSelf: 'end' }}>
            <button className="btn" style={{ width: '100%' }} type="button"
                    onClick={() => { setStatus('ALL'); setDept('ALL') }}>
              Clear filters
            </button>
          </div>
        </div>

        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Code</th><th>Employee</th><th>Department</th>
                <th className="num">KRAs</th><th className="num">Weightage</th>
                <th>Status</th><th>What is owed, and by whom</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 0 }}>
                  <Empty what="Loading" why="Reading vw_pms_fill_status." />
                </td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 0 }}>
                  <Empty
                    what={all.length ? 'Nothing matches those filters' : 'No fill status yet'}
                    why={all.length
                      ? 'Widen the department or status filter above.'
                      : NOTHING_CONFIGURED_YET} />
                </td></tr>
              ) : shown.map((r, i) => {
                const s = (r.fill_status ?? '') as FillStatus
                const known = FILL_ORDER.includes(s)
                const wt = r.total_weightage ?? 0
                return (
                  <tr key={`${r.employee_code ?? i}`}>
                    <td>{r.employee_code ?? '-'}</td>
                    <td style={{ fontWeight: 600 }}>{r.employee_name ?? '-'}</td>
                    <td>{deptNames[r.department_id ?? ''] ?? 'Unknown'}</td>
                    <td className="num">{r.kra_count ?? 0}</td>
                    <td className="num">
                      <span className={wt === totalWeightage ? 'ok' : 'bad'}>{wt}</span>
                    </td>
                    <td>{known
                      ? <Pill tone={FILL_TONE[s]}>{FILL_LABEL[s]}</Pill>
                      : <Pill tone="grey">Unknown</Pill>}</td>
                    <td className="k">{known ? FILL_MEANING_SHORT[s] : 'Status not recognised'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="btnrow">
          {/* Exports the FILTERED set, not everything. What is on screen is
              what the admin has narrowed to, and a file that silently
              disagrees with the table above it is worse than no file. */}
          <button className="btn ghost sm" type="button" disabled={!shown.length}
                  onClick={() => exportFill(shown, deptNames, 'pms-fill-status')}>
            ⬇ Export {status === 'ALL' && dept === 'ALL' ? 'all' : 'this view'} ({shown.length})
          </button>
          <button className="btn ghost sm" type="button" disabled={!notStarted.length}
                  onClick={() => exportFill(notStarted, deptNames, 'pms-not-started')}>
            ⬇ Export not-started only ({notStarted.length})
          </button>
          {/* NOT WIRED, and labelled so. §12's notification layer does not
              exist yet, so there is nothing to send with. A disabled button
              under the words "switches on once there are rows" was a promise
              the code could not keep: `disabled` was a literal, so it could
              never switch on at any number of rows. */}
          <button className="btn ghost sm" type="button" disabled
                  title="Needs the notification layer (§12), which is not built yet">
            Send bulk reminder — not available yet
          </button>
        </div>
        <div className="k" style={{ marginTop: 8 }}>
          Exports are CSV with a UTF-8 byte-order mark, which is what stops Excel
          mangling names. Per-rung manager ratings are not in the file: the
          fill-status view carries the self score only.
        </div>
      </Card>
    </>
  )
}

/** §6.3's export. Columns in the order the spec lists them, as far as the
 *  view actually carries them. The CSV text is built by csvText in
 *  lib/pms/csv.ts, where the quoting rules can be tested against the reader
 *  that has to parse them back; this half is only the browser download. */
function exportFill(rows: FillRow[], deptNames: Record<string, string>, name: string): void {
  const head = ['Code', 'Name', 'Department', 'Employment flag', 'KRA count',
                'Total weightage', 'One-to-one', 'Self score', 'Fill status',
                'Workflow status', 'Final rating', 'Rating code', 'Finalised by',
                'Last action']
  const body = rows.map(r => [
    r.employee_code, r.employee_name,
    deptNames[r.department_id ?? ''] ?? r.department_id,
    r.employment_flag, r.kra_count, r.total_weightage,
    r.one_to_one_status, r.self_score,
    FILL_LABEL[r.fill_status as FillStatus] ?? r.fill_status,
    r.workflow_status, r.final_rating, r.final_rating_code,
    r.finalised_by_role, r.last_action_at,
  ])
  // UTF-8 BOM — the EZER export standard, same as downloadTemplate below.
  const blob = new Blob(['﻿' + csvText(head, body)],
                        { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** The chase-list phrasing, trimmed to fit a table cell.
 *
 *  Kept in step with FILL_MEANING in lib/pms/status.ts — same five states,
 *  shorter sentences, and a test reads BOTH so they cannot drift apart.
 *  They did drift: 191 folded KRA_LOCKED into DRAFT_SAVED and only the long
 *  copy was reworded, so this cell still told an admin "nothing sent" about
 *  Nikhil Reddy's four LOCKED KRAs. Observed on the live tracker. */
const FILL_MEANING_SHORT: Record<FillStatus, string> = {
  NOT_STARTED: 'Cannot be rated at all. Chase first',
  // Covers KRA_DRAFT and KRA_LOCKED. Phrased by WHOSE MOVE IT IS, which is
  // the one thing both states agree on and the only thing this column is
  // asked — and it reads in parallel with the two rows below it.
  DRAFT_SAVED: 'Waiting on the employee. A nudge, not an escalation',
  SUBMITTED:   'Waiting on their manager',
  IN_REVIEW:   'Waiting on the next approver or the HOD',
  FINALISED:   'Settled, nothing further owed',
}

// ── the last rung: HR publishes ───────────────────────────────────────────

export interface PublishRow {
  employeeId: string
  name: string
  code: string
  departmentId?: string | null
  /**
   * WHICH CYCLE AND WHICH COMPANY this row belongs to.
   *
   * HR Head spans companies, and each company runs its own period. Without
   * these the summary is three organisations' ratings in one undifferentiated
   * list, and publishing would have to guess which period it was acting on —
   * so the actions take the period from the row rather than from the page.
   */
  periodId?: string | null
  periodLabel?: string | null
  companyName?: string | null
  finalRating: number | null
  finalRatingCode: string | null
  finalisedByRole: string | null
  finalisedAt: string | null
  published: boolean
  /**
   * The words that go out beside the number. HR writes these when the policy
   * says post_final_owner = 'HR', which is the default — see migration 202.
   */
  appreciation?: string | null
  improvement?: string | null
  benefits?: { type: string; note: string }[]
  /**
   * Whether the final-review one-to-one carries BOTH acknowledgements.
   *
   * 200's trg_pms_publish_needs_signoff refuses a publish without it, so this
   * has to be on the row: offering the button to HR and letting the database
   * answer with a raw P0001 is the behaviour that gate exists to replace.
   */
  signedOff?: boolean
  /** Whether the employee has confirmed reading the result. */
  acknowledged?: boolean
}

/**
 * §(none) — asked for directly: "hr manager have authorities to publish the
 * result… they just see it and publish it".
 *
 * WHAT IS DELIBERATELY ABSENT FROM THIS SCREEN. There is no rating field, no
 * KRA list, no comment box and no reject button. That is the requirement, not
 * an unfinished tab: HR cannot change what the chain decided, only release it.
 * 197 enforces the same thing from the other side — HR's rung has no reject
 * path, and pms_chain_reject refuses outright at stage HR with a sentence
 * saying a rating that needs changing goes back through the HOD.
 *
 * The rating IS shown, because publishing a number without seeing it is not a
 * decision anybody can take responsibly. Shown, not editable.
 *
 * ROWS COME FROM chain_stage, NOT workflow_status. FINALISED says a rating
 * exists; stage HR says it has reached HR and nobody below has it any more.
 * Reading the status instead would list appraisals that are settled but still
 * sitting with a HOD who has not passed them on.
 *//**
 * §(none) — HR runs the appraisal after the rating is settled.
 *
 * Requested: once the HOD finalises, the result moves here and every step
 * after the rating — the appreciation remark, the improvement feedback, the
 * recognition awards, and the publish itself — is HR's. The HOD's part ends
 * at the number.
 *
 * WHICH MEANS THIS TAB WRITES, and the previous version did not. It listed
 * settled ratings and offered one button. The controls it now carries were on
 * the HOD's Feedback & Recognition tab, which migration 202's default takes
 * away from them.
 *
 * WHAT IT STILL CANNOT DO IS CHANGE THE RATING. That was settled earlier and
 * has not moved: there is no rating input anywhere on this screen, and 188's
 * guards would refuse one. HR writes the words beside the number and releases
 * it; the number belongs to the chain.
 *
 * THE SIGN-OFF IS SHOWN, NOT DISCOVERED. 200's trg_pms_publish_needs_signoff
 * refuses any publish before the final-review one-to-one carries both
 * acknowledgements. Offering the button anyway and letting the database answer
 * with a raw P0001 is exactly the behaviour that gate was written to replace,
 * so the row says whether it is signed and the button waits.
 */
export function PublishTab({ rows, loading, onPublish, onSaveFeedback, publishing,
                             periodLabel, bands = [], canAct = true, note,
                             company, onCompany, companies = [], allowAll = false }: {
  rows: PublishRow[] | null
  loading?: boolean
  onPublish?: (employeeId: string) => void
  /** Write the words that go out beside the rating. */
  onSaveFeedback?: (employeeId: string, patch: {
    appreciation: string; improvement: string
    benefits: { type: string; note: string }[]
  }) => void
  /** The id currently being published, so one button can show progress
   *  without freezing the whole table. */
  publishing?: string | null
  periodLabel?: string | null
  /** The configured scale, for the improvement-feedback threshold. */
  bands?: { value: number; label: string; improvementMandatory?: boolean }[]
  /** Whether the viewer's role owns this step under the policy. False renders
   *  the record read-only rather than hiding it — HR Admin still needs to see
   *  where a cycle has got to even when a company runs docx Stage 6. */
  canAct?: boolean
  note?: string | null
  /**
   * WHICH COMPANY'S RESULTS THIS LIST SHOWS. 203.
   *
   * Publishing is irreversible and the names repeat across companies — two of
   * the three here have an employee coded *9030. A combined list is the right
   * shape for a report and the wrong shape for a release, so this one is
   * always narrowed to a company unless every company in it has opted in.
   */
  company?: string | null
  onCompany?: (company: string) => void
  companies?: { name: string; allowsAll: boolean }[]
  /** Whether an "all companies" option is offered at all — true only when at
   *  least one company's policy sets publish_scope = 'ALL'. */
  allowAll?: boolean
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ appreciation: string; improvement: string
                                       benefits: { type: string; note: string }[] } | null>(null)

  if (loading || rows === null) return <div className="k">Loading…</div>

  /**
   * NARROWED BEFORE ANYTHING ELSE IS COMPUTED, so no count, no editor and no
   * button can reach a row outside the chosen company. Filtering further down
   * would leave the stats describing a wider set than the list.
   *
   * 'ALL' lists only the companies that opted in — a company left at the
   * default is reachable only by selecting it by name.
   */
  const optedIn = new Set(companies.filter(c => c.allowsAll).map(c => c.name))
  const scoped = company === 'ALL'
    ? rows.filter(r => optedIn.has(r.companyName ?? ''))
    : rows.filter(r => (r.companyName ?? '') === (company ?? ''))

  /**
   * A RESULT HAS TO EXIST BEFORE IT CAN BE PUBLISHED.
   *
   * This listed every enrolment in the period that was not already
   * published — which is almost all of them. MEASURED on the live database:
   * 392 rows in "waiting to publish", of which 2 had a final rating. 386
   * were NOT_STARTED. The card calls itself "finalised by the chain and now
   * with you" and it was mostly people the chain had not begun with.
   *
   * That is not only noise. It is the one screen whose entire job is "which
   * results are ready", answered with a list in which 99.5% of the rows are
   * not — so the two that were ready were unfindable, and every count above
   * the table was wrong.
   *
   * final_rating is the marker because pms_finalise is what sets it; a
   * published row always has one, and the `|| r.published` keeps a
   * hypothetical published row with a null rating visible rather than
   * vanishing it from the record.
   */
  const settled = scoped.filter(r => r.finalRating !== null || r.published)
  const waiting = settled.filter(r => !r.published)
  const done = settled.filter(r => r.published)
  /** Counted, not listed. Saying nothing about them would make a shrunken
   *  list look like data loss to somebody who saw the old one. */
  const stillInChain = scoped.length - settled.length
  const member = scoped.find(r => r.employeeId === picked) ?? null

  // Seeded from the row, so re-picking somebody shows what is actually on
  // record rather than the last person's text — the bug a single shared draft
  // always produces.
  const d = draft ?? {
    appreciation: member?.appreciation ?? '',
    improvement: member?.improvement ?? '',
    benefits: member?.benefits ?? [],
  }
  const band = bands.find(b => b.value === member?.finalRating)
  const improvementRequired = !!band?.improvementMandatory
  const faults: string[] = []
  if (member) {
    if (!d.appreciation.trim()) faults.push('An appreciation remark is needed.')
    if (improvementRequired && !d.improvement.trim()) {
      faults.push(`Improvement feedback is mandatory at a rating of ${member.finalRating}.`)
    }
    if (member.signedOff === false) {
      faults.push('The final review one-to-one is not acknowledged by both of '
                + 'them yet. The rating is settled; it is the employee seeing '
                + 'it that waits on their acknowledgement.')
    }
  }
  const publishable = !!member && faults.length === 0

  return (
    <>
      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          {note ?? <>
            These ratings are settled{periodLabel ? ` for ${periodLabel}` : ''}. You
            write the feedback and any recognition, then release the result. The
            rating itself is the chain’s — a number that needs changing goes back
            through the HOD.
          </>}
        </div>
      </div>

      {companies.length > 1 && onCompany && (
        <Card title="Whose results"
              sub="Publishing acts on one company at a time. A result released to the wrong person cannot be unreleased.">
          <div className="grid g2">
            <Field label="Company"
                   hint={allowAll
                     ? 'Companies that have opted in can also be worked on together.'
                     : 'No company has enabled a combined list. Set publish scope in Setup & Controls to change that.'}>
              <select value={company ?? ''} onChange={e => { onCompany(e.target.value); setPicked(null) }}>
                {companies.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
                {allowAll && <option value="ALL">All companies that allow it</option>}
              </select>
            </Field>
          </div>
        </Card>
      )}

      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="Waiting on you" value={waiting.length} tone={waiting.length ? 'accent' : undefined} />
        <Stat label="Published" value={done.length} />
        <Stat label="Acknowledged by the employee"
              value={done.filter(r => r.acknowledged).length} />
      </div>

      <Card title={`Waiting to publish (${waiting.length})`}
            sub={`Finalised by the chain and now with you.${
              stillInChain ? ` ${stillInChain} other${stillInChain === 1 ? ' appraisal is' : ' appraisals are'}`
                + ' still with the chain and will appear here once settled.' : ''}`}>
        {!waiting.length
          ? <Empty what="Nothing is waiting"
                   why={stillInChain
                     ? `A rating reaches this list once the last approver in the chain has settled it. ${stillInChain} ${stillInChain === 1 ? 'appraisal is' : 'appraisals are'} still in the chain.`
                     : 'A rating reaches this list once the last approver in the chain has settled it.'} />
          : (
            <div className="tblwrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th><th>Employee</th><th className="num">Rating</th>
                    <th>Settled by</th><th>Settled on</th><th>Sign-off</th><th />
                  </tr>
                </thead>
                <tbody>
                  {waiting.map(r => (
                    <tr key={r.employeeId}>
                      <td>{r.code}</td>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td className="num">
                        {r.finalRating == null ? <span className="k">—</span>
                          : <b>{r.finalRating}{r.finalRatingCode ? ` · ${r.finalRatingCode}` : ''}</b>}
                      </td>
                      <td className="k">{r.finalisedByRole ?? '—'}</td>
                      <td className="k">{r.finalisedAt ? r.finalisedAt.slice(0, 10) : '—'}</td>
                      <td>{r.signedOff === false
                        ? <Pill tone="amber">not signed</Pill>
                        : <Pill tone="green">signed</Pill>}</td>
                      <td>
                        <button className="btn ghost sm" type="button"
                                onClick={() => { setPicked(r.employeeId); setDraft(null) }}>
                          {picked === r.employeeId ? 'Open' : 'Work on this'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
          A row with no rating cannot be published: there would be nothing to
          show. That means the chain has not finished with it, however far
          along it looks.
        </div>
      </Card>

      {member && (
        <Card title={`${member.name} — ${member.code}`}
              sub={`Rated ${member.finalRating ?? '—'}${band ? ` · ${band.label}` : ''} by ${member.finalisedByRole ?? 'the chain'}`
                   + `${member.companyName ? ` · ${member.companyName}` : ''}`
                   + `${member.periodLabel ? ` · ${member.periodLabel}` : ''}`
                   + '. You are writing what they read.'}>
          {!canAct ? (
            <Note tone="warn">
              Under this policy the finaliser writes the feedback and publishes.
              This is here so you can see where the cycle has got to.
            </Note>
          ) : (
            <>
              <div className="fld">
                <label htmlFor="pf-appr">Appreciation remark</label>
                <textarea id="pf-appr" rows={3} value={d.appreciation}
                          placeholder="What they did well, in their own terms."
                          onChange={e => setDraft({ ...d, appreciation: e.target.value })} />
              </div>
              <div className="fld">
                <label htmlFor="pf-impr">
                  Improvement feedback{improvementRequired ? ' (mandatory at this rating)' : ''}
                </label>
                <textarea id="pf-impr" rows={3} value={d.improvement}
                          placeholder={improvementRequired
                            ? 'Required: what has to change, and the support for it.'
                            : 'Optional.'}
                          onChange={e => setDraft({ ...d, improvement: e.target.value })} />
              </div>

              <Section>Recognition</Section>
              {d.benefits.map((b, i) => (
                <div className="grid g2" key={i} style={{ marginBottom: 8 }}>
                  <Field label="Award">
                    <select value={b.type}
                            onChange={e => setDraft({ ...d, benefits: d.benefits.map(
                              (x, j) => j === i ? { ...x, type: e.target.value } : x) })}>
                      {['CERTIFICATE','SPOT_AWARD','TRAINING_NOMINATION',
                        'SPECIAL_MENTION','STAR_PERFORMER','OTHER'].map(k => (
                        <option key={k} value={k}>{k.replace(/_/g, ' ').toLowerCase()}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Note">
                    <input value={b.note}
                           onChange={e => setDraft({ ...d, benefits: d.benefits.map(
                             (x, j) => j === i ? { ...x, note: e.target.value } : x) })} />
                  </Field>
                </div>
              ))}
              <div className="btnrow">
                <button className="btn ghost sm" type="button"
                        onClick={() => setDraft({ ...d, benefits: [...d.benefits,
                          { type: 'CERTIFICATE', note: '' }] })}>
                  + Add recognition
                </button>
                {d.benefits.length > 0 && (
                  <button className="btn ghost sm" type="button"
                          onClick={() => setDraft({ ...d, benefits: d.benefits.slice(0, -1) })}>
                    Remove the last
                  </button>
                )}
              </div>

              {faults.length > 0 && (
                <div className="banner b-amber" style={{ marginTop: 12 }}>
                  <span aria-hidden="true">!</span>
                  <div>
                    <b>Before this can be published:</b>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                      {faults.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              <div className="btnrow">
                <button className="btn ghost" type="button"
                        disabled={!onSaveFeedback}
                        onClick={() => onSaveFeedback?.(member.employeeId, d)}>
                  Save without publishing
                </button>
                <button className="btn" type="button"
                        disabled={!publishable || !onPublish || publishing === member.employeeId}
                        onClick={() => { onSaveFeedback?.(member.employeeId, d)
                                         onPublish?.(member.employeeId) }}>
                  {publishing === member.employeeId ? 'Publishing…'
                    : publishable ? 'Save and publish' : 'Cannot publish yet'}
                </button>
              </div>
            </>
          )}
        </Card>
      )}

      {done.length > 0 && (
        <Card title={`Already published (${done.length})`}
              sub="The employee can see these. Read-only.">
          <div className="tblwrap">
            <table>
              <thead>
                <tr><th>Code</th><th>Employee</th><th className="num">Rating</th>
                    <th>Read by them</th><th>What they were told</th></tr>
              </thead>
              <tbody>
                {done.map(r => (
                  <tr key={r.employeeId}>
                    <td>{r.code}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="num">{r.finalRating ?? '—'}{r.finalRatingCode ? ` · ${r.finalRatingCode}` : ''}</td>
                    <td>{r.acknowledged
                      ? <Pill tone="green">✓ acknowledged</Pill>
                      : <Pill tone="amber">not yet</Pill>}</td>
                    <td style={{ maxWidth: 340 }}>
                      {!r.appreciation && !r.improvement
                        ? <span className="k">No written feedback went out.</span>
                        : <div style={{ display: 'grid', gap: 4 }}>
                            {r.appreciation && <div><b>Appreciation.</b> {r.appreciation}</div>}
                            {r.improvement && <div><b>Improvement.</b> {r.improvement}</div>}
                            {!!r.benefits?.length && (
                              <div className="chips">
                                {r.benefits.map((b, i) => (
                                  <Pill key={i} tone="brand">
                                    {b.type.replace(/_/g, ' ').toLowerCase()}{b.note ? ` · ${b.note}` : ''}
                                  </Pill>
                                ))}
                              </div>
                            )}
                          </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

// ── the whole company, on one screen ─────────────────────────────────────

/**
 * §(none) — "hr head also show a summary of all the employees ratings and pms
 * details".
 *
 * WHY NOT THE FILL STATUS TRACKER, which already lists everybody. That answers
 * "who has not done their part yet" — it is a chase list, ordered by what is
 * missing. This answers "what did the company score", which is a different
 * question with a different shape: the distribution first, then the detail.
 * Collapsing them would make one screen that serves neither.
 *
 * READ-ONLY. Releasing a result is Publish Results; this is the view HR reads
 * before and after. No control here writes anything.
 */
export function SummaryTab({ rows, deptNames = {}, bands = [], loading, periodLabel }: {
  rows: PublishRow[] | null
  deptNames?: Record<string, string>
  bands?: { value: number; label: string }[]
  loading?: boolean
  periodLabel?: string | null
}) {
  const [dept, setDept] = useState('all')
  const [co, setCo] = useState('all')
  if (loading || rows === null) return <div className="k">Loading…</div>

  /**
   * COMPANY FIRST, then department.
   *
   * An HR Head over three companies gets all of them here — the loader stopped
   * narrowing to one open period, which was quietly showing a third of the
   * organisation. Department names are not unique across companies, so the
   * department list has to follow the company choice or "Operations" means two
   * different teams in one dropdown.
   */
  const byCo = co === 'all' ? rows : rows.filter(r => (r.companyName ?? '') === co)
  const inScope = dept === 'all' ? byCo : byCo.filter(r => (r.departmentId ?? '') === dept)
  const rated = inScope.filter(r => r.finalRating != null)
  const avg = rated.length
    ? rated.reduce((s, r) => s + (r.finalRating ?? 0), 0) / rated.length : null

  // The configured scale, not a hardcoded 1-5: a company on a 1-4 scale would
  // otherwise get a phantom band with nobody in it and a missing one at the top.
  const buckets = bands.map(b => ({
    ...b, n: rated.filter(r => r.finalRating === b.value).length,
  }))
  const widest = Math.max(1, ...buckets.map(b => b.n))

  const depts = [...new Set(byCo.map(r => r.departmentId ?? '').filter(Boolean))]
  const cos = [...new Set(rows.map(r => r.companyName ?? '').filter(Boolean))].sort()
  const spansCompanies = cos.length > 1

  return (
    <>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat tone="accent" label="Rated" value={rated.length}
              note={`of ${inScope.length} enrolled`} />
        <Stat label="Average rating" value={avg === null ? '—' : avg.toFixed(2)} />
        <Stat label="Published" value={inScope.filter(r => r.published).length} />
        <Stat label="Acknowledged" value={inScope.filter(r => r.acknowledged).length} />
      </div>

      <Card title={`Distribution${periodLabel ? ` — ${periodLabel}` : ''}`}
            sub="Against the configured rating scale.">
        <div className="grid g2" style={{ marginBottom: 12 }}>
          {spansCompanies && (
            <Field label="Company"
                   hint={`${cos.length} companies are running a cycle.`}>
              <select value={co}
                      onChange={e => { setCo(e.target.value); setDept('all') }}>
                <option value="all">All companies</option>
                {cos.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          )}
          <Field label="Department">
            <select value={dept} onChange={e => setDept(e.target.value)}>
              <option value="all">All departments</option>
              {depts.map(d => (
                <option key={d} value={d}>{deptNames[d] ?? d.slice(0, 8)}</option>
              ))}
            </select>
          </Field>
        </div>
        {!buckets.length ? (
          <Empty what="No rating scale configured"
                 why="Set the scale in Setup & Controls and the distribution appears here." />
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {buckets.map(b => (
              <div key={b.value} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 150, fontSize: 12 }}>
                  <b>{b.value}</b> · {b.label}
                </div>
                {/* A bar, because 11 of 390 and 190 of 390 read identically as
                    numerals in a column and not at all alike as lengths. */}
                <div style={{ flex: 1, minWidth: 60 }}>
                  <div style={{ height: 14, borderRadius: 7, width: `${(b.n / widest) * 100}%`,
                                minWidth: b.n ? 6 : 0,
                                background: 'var(--ez-brand)' }} />
                </div>
                <div className="num" style={{ width: 70, fontSize: 12 }}>
                  {b.n}{rated.length ? ` · ${Math.round((b.n / rated.length) * 100)}%` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Every employee (${inScope.length})`}
            sub="Highest rating first; unrated at the bottom.">
        {!inScope.length ? (
          <Empty what="Nobody enrolled"
                 why="Open a period in Setup & Controls and enrolments appear here." />
        ) : (
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Employee</th>
                  {spansCompanies && <th>Company</th>}
                  <th>Department</th>
                  <th className="num">Rating</th><th>Settled by</th>
                  <th>Stage</th><th>Recognition</th>
                </tr>
              </thead>
              <tbody>
                {[...inScope].sort((a, b) =>
                  (b.finalRating ?? -1) - (a.finalRating ?? -1)
                  || a.code.localeCompare(b.code)).map(r => (
                  <tr key={r.employeeId}>
                    <td>{r.code}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    {spansCompanies && <td className="k">{r.companyName ?? '—'}</td>}
                    <td className="k">{deptNames[r.departmentId ?? ''] ?? '—'}</td>
                    <td className="num">
                      {r.finalRating == null ? <span className="k">not rated</span>
                        : <b>{r.finalRating}{r.finalRatingCode ? ` · ${r.finalRatingCode}` : ''}</b>}
                    </td>
                    <td className="k">{r.finalisedByRole ?? '—'}</td>
                    <td>
                      {r.acknowledged ? <Pill tone="green">acknowledged</Pill>
                        : r.published ? <Pill tone="blue">published</Pill>
                        : r.finalRating != null ? <Pill tone="amber">with you</Pill>
                        : <Pill tone="grey">in the chain</Pill>}
                    </td>
                    <td>
                      {!r.benefits?.length ? <span className="k">—</span>
                        : <div className="chips">
                            {r.benefits.map((b, i) => (
                              <Pill key={i} tone="brand">
                                {b.type.replace(/_/g, ' ').toLowerCase()}
                              </Pill>
                            ))}
                          </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

// ── §6.4 Final Rating Upload ─────────────────────────────────────────────

export function UploadTab({ rows: enrolled, scale, improvementAtOrBelow,
                            periodId, periodLabel, onCommitted }: {
  /** vw_pms_fill_status for the open period. Null while loading. */
  rows?: FillRow[] | null
  scale?: number[]
  improvementAtOrBelow?: number | null
  /** The open period. Without it the commit has nowhere to write. */
  periodId?: string | null
  periodLabel?: string
  /**
   * Called with the success sentence, NOT just as a refresh signal.
   *
   * The parent reloads on commit, and the reload unmounts this tab — the
   * whole tab block sits behind `!loading`. So a success banner held in local
   * state disappears the instant it is set: the upload worked, the file
   * cleared, and the screen said nothing at all about what had happened.
   * Observed after a commit that landed correctly. The message has to be held
   * by whoever survives the reload.
   */
  onCommitted?: (message: string) => void
} = {}) {
  const [rows, setRows] = useState<UploadRow[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  /**
   * THE REAL LOOKUP. This was KNOWN_NOTHING, which answered "no such
   * employee" to everything — the honest answer while nothing was loaded, but
   * it meant the validation preview could only ever show 24 red rows, so the
   * one screen whose whole purpose is checking a file before it is applied
   * could not check anything.
   *
   * `computed` is the rating the system currently holds, which is
   * final_rating. The fill-status view does not carry rm_l1_score,
   * rm_l2_score or hod_score, so for a row that has not been finalised there
   * is no system rating to compare against and the Change column honestly
   * reads "-" rather than inventing a delta against nothing.
   *
   * `readOnly` is DERIVED, because the view does not expose is_readonly:
   * exited AND already rated is what rule 12 locks. Erring here is one-way —
   * a false positive refuses a row an admin could then query, a false
   * negative would let an upload overwrite a locked record.
   */
  const known = useMemo(() => {
    const by = new Map<string, FillRow>()
    for (const r of enrolled ?? []) {
      const code = String(r.employee_code ?? '').trim().toUpperCase()
      if (code) by.set(code, r)
    }
    return {
      lookup: (empCode: string, periodCode: string) => {
        const r = by.get(String(empCode ?? '').trim().toUpperCase())
        if (!r) return null
        // The period must be the one actually loaded. A file naming last
        // quarter would otherwise be validated against this quarter's data
        // and look fine.
        const pc = String(r.period_code ?? '').trim().toUpperCase()
        const want = String(periodCode ?? '').trim().toUpperCase()
        if (pc && want && pc !== want) return null
        const flag = String(r.employment_flag ?? '').toUpperCase()
        const rated = r.final_rating !== null && r.final_rating !== undefined
        return {
          computed: rated ? Number(r.final_rating) : null,
          eligible: flag !== 'NEW_JOINER',
          readOnly: flag === 'EXITED' && rated,
        }
      },
      scale: scale?.length ? scale : [1, 2, 3, 4, 5],
      improvementMandatoryAtOrBelow: improvementAtOrBelow ?? 2,
    }
  }, [enrolled, scale, improvementAtOrBelow])

  const preview = rows ? checkUpload(rows, enrolled ? known : KNOWN_NOTHING) : null

  return (
    <>
      <div className="banner b-amber">
        <span aria-hidden="true">⚠️</span>
        <div>
          These are <b>override rights</b>. A manual upload replaces the rating the
          system computed, and every row is written to the audit log with the actor,
          the timestamp and the reason. Use it for an offline calibration or a legacy
          migration, not to correct one person.
        </div>
      </div>

      <Card title="Final rating upload"
            sub="For when a calibration happened offline, or legacy data has to be brought in.">
        {result && (
          <div className={result.ok ? 'banner b-green' : 'banner b-amber'}>
            <span aria-hidden="true">{result.ok ? '✓' : '⚠️'}</span>
            <div>{result.text}</div>
          </div>
        )}
        <div className="grid g3">
          <Field label="Period" hint="Uploads apply to the period that is open">
            <select disabled><option>{periodLabel || 'The open period'}</option></select>
          </Field>
          <Field label="Upload file" hint={name || 'CSV, using the template below'}>
            <input type="file" accept=".csv,text/csv"
                   onChange={e => {
                     const f = e.target.files?.[0]
                     setName(f ? f.name : '')
                     if (!f) { setRows(null); return }
                     f.text().then(t => setRows(parseCsv(t))).catch(() => setRows([]))
                   }} />
          </Field>
          <div className="fld" style={{ alignSelf: 'end' }}>
            <button className="btn ghost" style={{ width: '100%' }} type="button"
                    onClick={() => downloadTemplate()}>
              ⬇ Download template
            </button>
          </div>
        </div>

        <div className="flowbox">{`Template columns:\n\n  ${TEMPLATE_COLUMNS.join('\n  ')}`}</div>

        <div className="divider" />
        <Section>
          {preview ? `Validation preview: ${preview.rows.length} rows` : 'Validation preview'}
        </Section>
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th className="num">Row</th><th>Code</th><th>Period</th>
                <th className="num">System</th><th className="num">Uploaded</th>
                <th>Change</th><th>Override reason</th><th>Validation</th>
              </tr>
            </thead>
            <tbody>
              {!preview ? (
                <tr><td colSpan={8} style={{ padding: 0 }}>
                  <Empty what="Choose a file to see what it would do"
                         why="Every row is checked before anything is written. Nothing commits while a single row still has an error." />
                </td></tr>
              ) : preview.rows.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 0 }}>
                  <Empty what="That file had no data rows" why="A header line on its own, or a format the parser did not recognise." />
                </td></tr>
              ) : preview.rows.map((r, i) => (
                <tr key={i} className={r.errors.length ? 'exitrow' : undefined}>
                  <td className="num">{i + 1}</td>
                  <td>{r.row.employee_code || '-'}</td>
                  <td>{r.row.period_code || '-'}</td>
                  <td className="num">{r.computed ?? '-'}</td>
                  <td className="num">{r.uploaded ?? '-'}</td>
                  <td>{r.delta === null ? <Pill tone="grey">-</Pill>
                     : r.delta === 0 ? <Pill tone="grey">No change</Pill>
                     : <Pill tone="amber">{r.delta > 0 ? `+${r.delta}` : r.delta}</Pill>}</td>
                  <td className={r.errors.includes('ERROR_REASON_MISSING') ? 'bad' : undefined}>
                    {r.row.override_reason || (r.errors.includes('ERROR_REASON_MISSING') ? 'Missing' : '-')}
                  </td>
                  <td>{r.errors.length
                    ? <Pill tone="red">{ERROR_TEXT[r.errors[0]]}</Pill>
                    : <Pill tone="green">OK</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {preview && (
          <>
            <div className="btnrow">
              {/* The rejected rows, in the SAME shape as the template plus a
                  reason column — so the admin fixes this file and uploads it
                  again, rather than hunting the originals by eye. Keeping the
                  original line number is the point: "row 14" is how they find
                  it in their spreadsheet. */}
              <button className="btn ghost sm" type="button" disabled={!preview.errorCount}
                      onClick={() => exportErrorRows(preview)}>
                ⬇ Download error rows ({preview.errorCount})
              </button>
              <button className="btn dark sm" type="button"
                      disabled={!preview.canCommit || !periodId || busy}
                      onClick={async () => {
                        setBusy(true); setResult(null)
                        const r = await pmsAdmin<{ message?: string; applied?: number }>(
                          'upload_commit',
                          { period_id: periodId, actor_role: 'HR_MANAGER',
                            rows: preview.rows.map(x => x.row) })
                        setBusy(false)
                        if (r.error) { setResult({ ok: false, text: r.error.message }); return }
                        const msg = r.data?.message ?? 'Committed.'
                        setResult({ ok: true, text: msg })
                        // The file is spent: its preview was computed against
                        // ratings this commit has just changed, so leaving it
                        // on screen would invite a second application of the
                        // same batch against different numbers.
                        setRows(null); setName('')
                        onCommitted?.(msg)
                      }}>
                {busy ? 'Committing…'
                  : preview.canCommit
                  ? `Commit upload (${preview.rows.length} ${preview.rows.length === 1 ? 'row' : 'rows'})`
                  : `Commit blocked: ${preview.errorCount} ${preview.errorCount === 1 ? 'row needs' : 'rows need'} fixing`}
              </button>
            </div>
            {!periodId && (
              <div className="k bad" style={{ marginTop: 8 }}>
                No open period is loaded, so there is nowhere to commit this to.
              </div>
            )}
            <div className="k" style={{ marginTop: 8, lineHeight: 1.6 }}>{summarise(preview)}</div>
          </>
        )}
        <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
          A reason is owed only where the rating actually <b>changes</b>. Demanding one
          on an unchanged row teaches people to type &ldquo;n/a&rdquo;, which is worse
          than not asking. And a part-applied upload is worse than a refused one: some
          people on the system&rsquo;s rating, some on the spreadsheet&rsquo;s, and
          nothing on screen to say which.
        </div>
      </Card>
    </>
  )
}

/**
 * What the checker knows before migration 066 exists: nothing.
 *
 * That is deliberately not a stub that waves rows through. With no lookup,
 * every row comes back ERROR_NOT_FOUND, which is the honest answer — the file
 * may well be perfect, but nothing here can confirm a single employee code
 * against a table that is not there. A permissive stub would show a green
 * "OK" on all 24 rows and teach an admin to trust a check that never ran.
 */
const KNOWN_NOTHING = {
  lookup: () => null,
  scale: [1, 2, 3, 4, 5],
  improvementMandatoryAtOrBelow: 2,
}

/** §6.4's rejected rows, re-exported for correction and re-upload. */
function exportErrorRows(preview: { rows: { row: UploadRow; line: number; errors: string[] }[] }): void {
  const bad = preview.rows.filter(r => r.errors.length)
  const head = ['source_row', ...TEMPLATE_COLUMNS, 'what_is_wrong']
  const body = bad.map(r => [
    r.line,
    ...TEMPLATE_COLUMNS.map(c => (r.row as Record<string, unknown>)[c]),
    // Every error, not just the first: the table shows one to stay readable,
    // but a file for fixing should not hide a second problem that will bounce
    // the row again on the next attempt.
    r.errors.map(e => ERROR_TEXT[e as keyof typeof ERROR_TEXT] ?? e).join(' '),
  ])
  const blob = new Blob(['﻿' + csvText(head, body)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `pms-upload-errors-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function downloadTemplate() {
  // UTF-8 BOM — the EZER export standard, and what stops Excel mangling names.
  const blob = new Blob(['﻿' + TEMPLATE_COLUMNS.join(',') + '\n'],
                        { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'pms-final-rating-template.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── §6.5 PIP Management ──────────────────────────────────────────────────

export interface PipRow { code: string; name: string; raisedBy: string; pip: Pip }

export function PipTab({ queue }: { queue: PipRow[] }) {
  return (
    <>
      <div className="banner b-blue">
        <span aria-hidden="true">ℹ️</span>
        <div>
          <b>RM raises a request → HR Manager reviews → HR initiates → the employee
          is notified and acknowledges.</b> An RM cannot start a PIP themselves. That
          is not a permissions detail: the PIP is the documentation trail that answers
          a claim under the Industrial Disputes Act, and HR gatekeeping is what keeps
          it consistent enough to rely on.
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="stat accent">
          <div className="lbl">Pending my review</div>
          <div className="val">{queue.filter(r => r.pip.status === 'PENDING_HR').length}</div>
        </div>
        <div className="stat">
          <div className="lbl">Active PIPs</div>
          <div className="val">{queue.filter(r => r.pip.status === 'ACKNOWLEDGED' || r.pip.status === 'IN_REVIEW').length}</div>
        </div>
        <div className="stat">
          <div className="lbl">Awaiting acknowledgement</div>
          <div className="val">{queue.filter(r => r.pip.status === 'INITIATED').length}</div>
        </div>
        <div className="stat">
          <div className="lbl">Closed this year</div>
          <div className="val">{queue.filter(r => r.pip.status === 'CLOSED').length}</div>
        </div>
      </div>

      <Card title="PIP requests: HR action queue"
            sub="Raised by managers, waiting on a decision from HR.">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th><th>Raised by</th><th>Status</th>
                <th>Waiting on</th><th>What happens next</th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 0 }}>
                  <Empty what="No PIP requests" why={NOTHING_CONFIGURED_YET} />
                </td></tr>
              ) : queue.map((r, i) => {
                const nx = whatNext(r.pip)
                return (
                  <tr key={r.code || i}>
                    <td style={{ fontWeight: 600 }}>{r.name} <span className="k">{r.code}</span></td>
                    <td>{r.raisedBy}</td>
                    <td><Pill tone={r.pip.status === 'REJECTED' ? 'red'
                                  : r.pip.status === 'CLOSED' ? 'grey'
                                  : r.pip.status === 'IN_REVIEW' || r.pip.status === 'ACKNOWLEDGED' ? 'green'
                                  : 'amber'}>
                      {STATUS_LABEL[r.pip.status]}
                    </Pill></td>
                    <td>{nx.who ?? '-'}</td>
                    <td className="k">{nx.what}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="The six steps" sub="Spec §7, in order. Each one is a gate, not a status label.">
        <div className="tblwrap">
          <table>
            <thead><tr><th className="num">Step</th><th>Who</th><th>What happens</th></tr></thead>
            <tbody>
              {PIP_STEPS.map(s => (
                <tr key={s.n}>
                  <td className="num">{s.n}</td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.who}</td>
                  <td>{s.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

const PIP_STEPS = [
  { n: 1, who: 'RM',         what: 'Raises the request: trigger rating, proposed dates, improvement areas with a current state, a target, a measure and a review date, plus the support being offered' },
  { n: 2, who: 'HR Manager', what: 'Reviews: adjusts dates, drops an area that does not belong, rejects with a reason, or sends it back to the RM. Writes a note to the employee and an internal one to the RM' },
  { n: 3, who: 'HR',         what: 'Initiates. Review frequency is set (fortnightly or monthly) and the employee is notified' },
  { n: 4, who: 'Employee',   what: 'Acknowledges, with an optional note of their own' },
  { n: 5, who: 'RM + HR',    what: 'Periodic reviews: each area marked improved, partial or no change, with notes' },
  { n: 6, who: 'HR',         what: 'Outcome: improved, extended, or referred for separation review' },
]

// ── §6.6 Reports & Export ────────────────────────────────────────────────

export function ReportsTab() {
  return (
    <Card title="Report library"
          sub="Every one of these is readable in the portal and exports to Excel or CSV.">
      <div className="tblwrap">
        <table>
          <thead>
            <tr><th className="num">#</th><th>Report</th><th>What it contains</th><th>Filters</th><th /></tr>
          </thead>
          <tbody>
            {REPORTS.map(r => (
              <tr key={r.n}>
                <td className="num">{r.n}</td>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                <td>{r.contains}</td>
                <td className="k" style={{ whiteSpace: 'nowrap' }}>{r.filters}</td>
                <td><button className="btn sm" type="button" disabled>⬇ Excel</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
        Exports are UTF-8 with a BOM, the EZER standard. Without it Excel mangles
        every name with an accent in it. Columns are filtered by role: HR and admin
        see all of them, an RM sees their own team, a HOD their department, an
        employee only their own row.
      </div>
    </Card>
  )
}

/** Spec §9, all fourteen. */
const REPORTS = [
  { n: 1,  name: 'Employee-wise KRA detail', filters: 'Company, dept, RM, period, status',
    contains: 'Every KRA per employee: title, KPI, target, weightage, category, achievement, self, RM L1, RM L2, final, comments and the weighted contribution' },
  { n: 2,  name: 'Fill status', filters: 'All, plus employment type',
    contains: 'Not started, draft saved, submitted, finalised, with the last action timestamp' },
  { n: 3,  name: 'Rating summary', filters: 'Company, dept, rating',
    contains: 'Final rating per employee with department, RM, HOD and who finalised it' },
  { n: 4,  name: 'Self vs manager gap', filters: 'Dept, RM, delta range',
    contains: 'Self score, final score and the delta: an expectation-mismatch detector' },
  { n: 5,  name: 'KRA weightage compliance', filters: 'Company, dept',
    contains: 'Fewer than four KRAs, totals that are not 100, one-to-ones that never happened' },
  { n: 6,  name: 'One-to-one log', filters: 'Dept, RM, type',
    contains: 'Every discussion: date, type, points covered, and both acknowledgements' },
  { n: 7,  name: 'Exit & notice period', filters: 'Company, dept',
    contains: 'Ratings still owed before somebody’s last working day' },
  { n: 8,  name: 'Appreciation & benefits register', filters: 'Company, dept, type',
    contains: 'Who received what recognition: certificate, nomination, award' },
  { n: 9,  name: 'PIP register', filters: 'Status, outcome',
    contains: 'Request to initiation to reviews to outcome: the full trail' },
  { n: 10, name: 'Period-on-period trend', filters: 'Employee, dept',
    contains: 'Rating movement across periods, per employee or per department' },
  { n: 11, name: 'Category analysis', filters: 'Dept, category',
    contains: 'Business, process, people and compliance averages' },
  { n: 12, name: 'Manager rating behaviour', filters: 'Dept, RM',
    contains: 'Per-RM average and distribution, with a lenient or harsh flag' },
  { n: 13, name: 'Override / audit log', filters: 'Actor, date range',
    contains: 'Manual uploads and changes: actor, old value, new value, reason, timestamp' },
  { n: 14, name: 'Cycle completion', filters: 'Dept, location, grade',
    contains: 'Completion percentage by department, location and grade' },
]

// ── the flow and the hierarchy, §1 and §2 ────────────────────────────────

export function FlowTab({ chainCoverage }: { chainCoverage?: React.ReactNode }) {
  return (
    <>
      <Card title="How a period runs, start to finish"
            sub="Spec §1. Each step names the gate that stops it. Most delays are one of these, not somebody being slow.">
        <div className="tblwrap">
          <table>
            <thead><tr><th className="num">#</th><th>Who</th><th>What happens</th><th>The gate</th></tr></thead>
            <tbody>
              {FLOW.map(s => (
                <tr key={s.n} className={s.n >= 9 ? 'noticerow' : undefined}>
                  <td className="num">{s.n}</td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.actor}</td>
                  <td>{s.what}</td>
                  <td className="k">{s.gate ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="banner b-green" style={{ marginTop: 14, marginBottom: 0 }}>
          <span aria-hidden="true">✓</span><div><b>{FLOW_ENDS}</b></div>
        </div>
        <div className="k" style={{ marginTop: 8 }}>
          Steps 9 to 12 only run when a rating is low. They are the PIP branch.
        </div>
      </Card>

      <Card title="The reporting line"
            sub="Ratings travel up it; nothing skips a level unless the policy says so.">
        <div className="flowbox">{REPORTING_LINE.join('  →  ')}</div>
      </Card>

      <Card title="Who may do what"
            sub="Spec §2, cell for cell. ⚙ means the policy decides (see “who can finalise” in the cycle setup).">
        <div className="tblwrap">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                {ROLES.map(r => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {ACTIONS.map(a => (
                <tr key={a}>
                  <td style={{ fontWeight: 600 }}>{ACTION_LABEL[a]}</td>
                  {ROLES.map(r => {
                    const p = may(r, a)
                    const scope = SCOPE_NOTE[a]?.[r]
                    return (
                      <td key={r} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {p === 'yes' ? (scope
                            ? <span className="pill p-green">{scope}</span>
                            : <span className="ok" style={{ fontWeight: 800 }}>✓</span>)
                         : p === 'policy' ? <span className="pill p-amber">policy</span>
                         : <span className="k">-</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Two rows are worth reading twice. <b>Initiate PIP</b> is HR only: an RM can
          raise a request and nothing more. <b>Finalise rating</b>{' '}
          {/* An explicit space, not a literal one. The text chunk that follows
              </b> starts with a space AND contains an entity (&rsquo;), and in
              that combination the chunk's leading space is dropped — this
              rendered as "Finalise ratingis" until it was measured in the DOM.
              {' '} is not whitespace the parser can collapse. */}
          is the policy&rsquo;s call for the three manager roles, so treating it
          as a plain yes would let an
          RM L1 finalise under a HOD-only policy, and treating it as a no would hide the
          button from the person the policy appointed.
        </div>
      </Card>

      {chainCoverage}
    </>
  )
}

export { FLAG_LABEL, FLAG_MEANING }
export type { Flag, Role }
