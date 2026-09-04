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
import { humanDate } from '@/lib/pms/cycle'

export type AdminTab =
  | 'config' | 'setup' | 'policies' | 'fill' | 'upload' | 'pip' | 'reports'

export const ADMIN_TABS: { k: AdminTab; label: string; blurb: string }[] = [
  { k: 'config',   label: 'PMS Configuration',  blurb: 'Frequency, windows and the KRA rules everyone is held to' },
  // The only tab that writes. Everything else on this screen reports.
  { k: 'setup',    label: 'Setup & Controls',   blurb: 'Edit the policy, KRA library and rating scale; generate and open periods' },
  { k: 'policies', label: 'Policy Builder',     blurb: 'Different cycles for different groups, and who falls under which' },
  { k: 'fill',     label: 'Fill Status Tracker',blurb: 'Live status for everyone, and who to chase' },
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
  if (Number.isNaN(d.getTime())) return '—'
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')}-${M[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`
}

/** "01–15 Apr" — a window, collapsed when both ends share a month. */
function windowText(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '—'
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

export function ConfigTab({ freq, onFreq, fyStart, fyLabel, today }: {
  freq: Frequency; onFreq: (f: Frequency) => void
  fyStart: string; fyLabel: string; today: string
}) {
  const periods = previewPeriods(freq, fyStart)
  return (
    <>
      <Card title="Cycle & frequency preview"
            sub="Try a frequency and every period below regenerates, windows and all. This is a preview — nothing here is saved.">
        <div className="grid g4">
          <Fixed label="Company" value="All companies" />
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
          KRAs are agreed at the <b>start</b> of a period and rated after it <b>ends</b> —
          settling KRAs in the last week would leave the one-to-one nothing to influence.
        </div>

        <div className="divider" />
        <Section>KRA rules</Section>
        <div className="grid g4">
          <Fixed label="Minimum KRA count" value={String(DEFAULT_RULES.minKra)}
                 hint="Fewer than four and a rating rests on too little" />
          <Fixed label="Maximum KRA count" value={String(DEFAULT_RULES.maxKra)}
                 hint="Past ten, weightages get too thin to mean anything" />
          <Fixed label="Total weightage must be" value={String(DEFAULT_RULES.totalWeightage)}
                 hint="Exactly — not at least" />
          <Fixed label="Minimum weightage per KRA" value={String(DEFAULT_RULES.minWeightagePerKra)}
                 hint="Stops a token KRA carrying 1%" />
          <Fixed label="Who creates KRAs" value="Employee (RM approves)" />
          <Fixed label="One-to-one mandatory" value="Yes — before weightage lock" />
          <Fixed label="Mid-period check-in" value="Optional" />
          <Fixed label="Final review one-to-one" value="Mandatory before publish" />
        </div>

        <div className="divider" />
        <Section>Workflow &amp; rating</Section>
        <div className="grid g4">
          <Fixed label="Approval chain" value={CHAIN_LABEL[CHAINS[0]]} />
          <Fixed label="Who can finalise" value={FINALISER_LABEL[FINALISERS[0]]} />
          <Fixed label="Rating scale" value="5 point (1–5)" />
          <Fixed label="Self rating mandatory" value="Yes — a manager cannot rate first" />
        </div>

        <div className="divider" />
        <Section>Linkage &amp; eligibility</Section>
        <div className="grid g4">
          <Fixed label="Payout / CTC linkage" value="OFF — developmental only" locked
                 hint="Locked off. No increment, variable or CTC impact." />
          <Fixed label="New joiner cut-off" value="30 days before the period ends" />
          <Fixed label="Notice period employees" value="Include, and highlight" />
          <Fixed label="Exited employees" value="Include, read-only after last working day" />
        </div>
        <div className="banner b-red" style={{ marginTop: 14, marginBottom: 0 }}>
          <span aria-hidden="true">🔒</span>
          <div>
            The payout lock is a database constraint, not a setting:{' '}
            <code>payout_linkage_enabled = false</code>. No screen, admin or API
            call can turn it on — enabling it would take a migration that drops
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
            sub="One company can run several policies at once — sales monthly, leadership half-yearly, workmen annual.">
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
                  <td className="num">—</td>
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
          guessed — silently picking one only surfaces months later, when an appraisal
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
              <div className="note">No policy matches them — they cannot be rated at all</div>
            </div>
            <div className="stat">
              <div className="lbl">Contested</div>
              <div className={`val ${trouble.contested.length ? 'bad' : 'good'}`}>
                {trouble.contested.length}
              </div>
              <div className="note">Two policies match equally — the tie has to be broken by hand</div>
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

export function FillTab({ rows, deptNames, loading }: {
  rows: FillRow[] | null; deptNames: Record<string, string>; loading: boolean
}) {
  const [status, setStatus] = useState<'ALL' | FillStatus>('ALL')
  const [dept, setDept] = useState('ALL')
  const all = rows ?? []
  const roll = rollUp(all)
  const shown = all.filter(r =>
    (status === 'ALL' || r.fill_status === status) &&
    (dept === 'ALL' || (r.department_id ?? '') === dept))

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
                    <td>{r.employee_code ?? '—'}</td>
                    <td style={{ fontWeight: 600 }}>{r.employee_name ?? '—'}</td>
                    <td>{deptNames[r.department_id ?? ''] ?? 'Unknown'}</td>
                    <td className="num">{r.kra_count ?? 0}</td>
                    <td className="num">
                      <span className={wt === DEFAULT_RULES.totalWeightage ? 'ok' : 'bad'}>{wt}</span>
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
          <button className="btn ghost sm" type="button" disabled>⬇ Export to Excel</button>
          <button className="btn ghost sm" type="button" disabled>⬇ Export not-started only</button>
          <button className="btn ghost sm" type="button" disabled>Send bulk reminder</button>
        </div>
        <div className="k" style={{ marginTop: 8 }}>
          Export and reminders switch on once there are rows to send about.
        </div>
      </Card>
    </>
  )
}

/** The chase-list phrasing, trimmed to fit a table cell. */
const FILL_MEANING_SHORT: Record<FillStatus, string> = {
  NOT_STARTED: 'Cannot be rated at all — chase first',
  DRAFT_SAVED: 'Started, nothing sent. A nudge, not an escalation',
  SUBMITTED:   'Waiting on their manager',
  IN_REVIEW:   'Waiting on the next approver or the HOD',
  FINALISED:   'Settled — nothing further owed',
}

// ── §6.4 Final Rating Upload ─────────────────────────────────────────────

export function UploadTab() {
  const [rows, setRows] = useState<UploadRow[] | null>(null)
  const [name, setName] = useState('')
  const preview = rows ? checkUpload(rows, KNOWN_NOTHING) : null

  return (
    <>
      <div className="banner b-amber">
        <span aria-hidden="true">⚠️</span>
        <div>
          These are <b>override rights</b>. A manual upload replaces the rating the
          system computed, and every row is written to the audit log with the actor,
          the timestamp and the reason. Use it for an offline calibration or a legacy
          migration — not to correct one person.
        </div>
      </div>

      <Card title="Final rating upload"
            sub="For when a calibration happened offline, or legacy data has to be brought in.">
        <div className="grid g3">
          <Field label="Period"><select disabled><option>The open period</option></select></Field>
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
          {preview ? `Validation preview — ${preview.rows.length} rows` : 'Validation preview'}
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
                  <td>{r.row.employee_code || '—'}</td>
                  <td>{r.row.period_code || '—'}</td>
                  <td className="num">{r.computed ?? '—'}</td>
                  <td className="num">{r.uploaded ?? '—'}</td>
                  <td>{r.delta === null ? <Pill tone="grey">—</Pill>
                     : r.delta === 0 ? <Pill tone="grey">No change</Pill>
                     : <Pill tone="amber">{r.delta > 0 ? `+${r.delta}` : r.delta}</Pill>}</td>
                  <td className={r.errors.includes('ERROR_REASON_MISSING') ? 'bad' : undefined}>
                    {r.row.override_reason || (r.errors.includes('ERROR_REASON_MISSING') ? 'Missing' : '—')}
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
              <button className="btn ghost sm" type="button" disabled={!preview.errorCount}>
                ⬇ Download error rows
              </button>
              <button className="btn dark sm" type="button" disabled={!preview.canCommit}>
                {preview.canCommit
                  ? `Commit upload — ${preview.rows.length} rows`
                  : `Commit blocked — ${preview.errorCount} ${preview.errorCount === 1 ? 'row needs' : 'rows need'} fixing`}
              </button>
            </div>
            <div className="k" style={{ marginTop: 8, lineHeight: 1.6 }}>{summarise(preview)}</div>
          </>
        )}
        <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
          A reason is owed only where the rating actually <b>changes</b>. Demanding one
          on an unchanged row teaches people to type &ldquo;n/a&rdquo;, which is worse
          than not asking. And a part-applied upload is worse than a refused one — some
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

/** Minimal CSV read — the template has no quoted commas in it. */
function parseCsv(text: string): UploadRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const head = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    head.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row as unknown as UploadRow
  })
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

      <Card title="PIP requests — HR action queue"
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
                    <td>{nx.who ?? '—'}</td>
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
  { n: 1, who: 'RM',         what: 'Raises the request — trigger rating, proposed dates, improvement areas with a current state, a target, a measure and a review date, plus the support being offered' },
  { n: 2, who: 'HR Manager', what: 'Reviews: adjusts dates, drops an area that does not belong, rejects with a reason, or sends it back to the RM. Writes a note to the employee and an internal one to the RM' },
  { n: 3, who: 'HR',         what: 'Initiates. Review frequency is set — fortnightly or monthly — and the employee is notified' },
  { n: 4, who: 'Employee',   what: 'Acknowledges, with an optional note of their own' },
  { n: 5, who: 'RM + HR',    what: 'Periodic reviews — each area marked improved, partial or no change, with notes' },
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
        Exports are UTF-8 with a BOM, the EZER standard — without it Excel mangles
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
    contains: 'Every KRA per employee — title, KPI, target, weightage, category, achievement, self, RM L1, RM L2, final, comments and the weighted contribution' },
  { n: 2,  name: 'Fill status', filters: 'All, plus employment type',
    contains: 'Not started, draft saved, submitted, finalised — with the last action timestamp' },
  { n: 3,  name: 'Rating summary', filters: 'Company, dept, rating',
    contains: 'Final rating per employee with department, RM, HOD and who finalised it' },
  { n: 4,  name: 'Self vs manager gap', filters: 'Dept, RM, delta range',
    contains: 'Self score, final score and the delta — an expectation-mismatch detector' },
  { n: 5,  name: 'KRA weightage compliance', filters: 'Company, dept',
    contains: 'Fewer than four KRAs, totals that are not 100, one-to-ones that never happened' },
  { n: 6,  name: 'One-to-one log', filters: 'Dept, RM, type',
    contains: 'Every discussion — date, type, points covered, and both acknowledgements' },
  { n: 7,  name: 'Exit & notice period', filters: 'Company, dept',
    contains: 'Ratings still owed before somebody’s last working day' },
  { n: 8,  name: 'Appreciation & benefits register', filters: 'Company, dept, type',
    contains: 'Who received what recognition — certificate, nomination, award' },
  { n: 9,  name: 'PIP register', filters: 'Status, outcome',
    contains: 'Request to initiation to reviews to outcome — the full trail' },
  { n: 10, name: 'Period-on-period trend', filters: 'Employee, dept',
    contains: 'Rating movement across periods, per employee or per department' },
  { n: 11, name: 'Category analysis', filters: 'Dept, category',
    contains: 'Business, process, people and compliance averages' },
  { n: 12, name: 'Manager rating behaviour', filters: 'Dept, RM',
    contains: 'Per-RM average and distribution, with a lenient or harsh flag' },
  { n: 13, name: 'Override / audit log', filters: 'Actor, date range',
    contains: 'Manual uploads and changes — actor, old value, new value, reason, timestamp' },
  { n: 14, name: 'Cycle completion', filters: 'Dept, location, grade',
    contains: 'Completion percentage by department, location and grade' },
]

// ── the flow and the hierarchy, §1 and §2 ────────────────────────────────

export function FlowTab({ chainCoverage }: { chainCoverage?: React.ReactNode }) {
  return (
    <>
      <Card title="How a period runs, start to finish"
            sub="Spec §1. Each step names the gate that stops it — most delays are one of these, not somebody being slow.">
        <div className="tblwrap">
          <table>
            <thead><tr><th className="num">#</th><th>Who</th><th>What happens</th><th>The gate</th></tr></thead>
            <tbody>
              {FLOW.map(s => (
                <tr key={s.n} className={s.n >= 9 ? 'noticerow' : undefined}>
                  <td className="num">{s.n}</td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.actor}</td>
                  <td>{s.what}</td>
                  <td className="k">{s.gate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="banner b-green" style={{ marginTop: 14, marginBottom: 0 }}>
          <span aria-hidden="true">✓</span><div><b>{FLOW_ENDS}</b></div>
        </div>
        <div className="k" style={{ marginTop: 8 }}>
          Steps 9 to 12 only run when a rating is low — they are the PIP branch.
        </div>
      </Card>

      <Card title="The reporting line"
            sub="Ratings travel up it; nothing skips a level unless the policy says so.">
        <div className="flowbox">{REPORTING_LINE.join('  →  ')}</div>
      </Card>

      <Card title="Who may do what"
            sub="Spec §2, cell for cell. ⚙ means the policy decides — see “who can finalise” in the cycle setup.">
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
                         : <span className="k">—</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="k" style={{ marginTop: 10, lineHeight: 1.6 }}>
          Two rows are worth reading twice. <b>Initiate PIP</b> is HR only — an RM can
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
