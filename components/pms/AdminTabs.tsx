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
         searchEnrolled, oneRow, finalisedQueue, QUEUE_STATUS_LABEL,
         type Candidate, type Known, type QueueRow,
         type UploadRow } from '@/lib/pms/upload'
import { STATUS_LABEL, whatNext, type Pip } from '@/lib/pms/pip'
import { CHAINS, CHAIN_LABEL, FINALISERS, FINALISER_LABEL, FLOW, FLOW_ENDS,
         ROLES, ROLE_LABEL, ACTIONS, ACTION_LABEL, may, SCOPE_NOTE,
         REPORTING_LINE, type Role } from '@/lib/pms/hierarchy'
import { DEFAULT_RULES } from '@/lib/pms/cycle'
import { chainLabel, type Stage } from '@/lib/pms/chain'
import { FILL_ORDER, FILL_LABEL, type FillStatus } from '@/lib/pms/status'
import { rollUp, type FillRow } from '@/lib/pms/rollup'
import { csvText, parseCsv } from '@/lib/pms/csv'
import { pmsAdmin } from '@/lib/pms/adminClient'
import { humanDate } from '@/lib/pms/cycle'
import { canActDirect, whyNotDirect, checkDirect, suggestedFinal,
         type DirectIntent } from '@/lib/pms/hrDirect'
import { CATEGORIES, CATEGORY_LABEL, type Kra } from '@/lib/pms/kra'
import { publishFaults } from '@/lib/pms/publishGate'
import { selectRows, split as bulkSplit, blockedSummary, choices as bulkChoices,
         outcomeText, type BulkRow, type BulkFilter,
         type BulkOutcome } from '@/lib/pms/bulkPublish'
import { checkFinal, hrFinalState,
         HR_FINAL_PROMPT, type FinalIntent, type HrFinalRow } from '@/lib/pms/hrFinal'
import { type ChainAsks, type ChainAsk, publishWarnings, asksBadge, pipLine } from '@/lib/pms/hrQueue'
import { HR_STATUS_LABEL, TRAINING_CATEGORY_LABEL, type HrStatus,
         type TrainingCategory } from '@/lib/pms/training'

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
  /** 218. The composed chain this policy points at, if any. When chainRungs
   *  is present it is what runs and approvalChain is only the fallback — so
   *  the panel must show this one, not that one. */
  chainId?: string | null
  chainName?: string | null
  chainRungs?: string[] | null
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
  /** 211: whether the HR Head must settle the final rating before publishing. */
  hrHeadFinalRating?: boolean | null
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
          {/* 218: THE COMPOSED CHAIN IS WHAT RUNS when one is selected, so
              it is what this shows. Reading approvalChain unconditionally
              would have this panel — the one an admin opens to confirm the
              configuration — state the preset while the cycle travels
              somewhere else. */}
          <Fixed label="Approval chain" value={
            policy?.chainRungs?.length
              ? `${policy.chainName ?? 'A built chain'}: `
                + chainLabel(policy.chainRungs as Stage[], CHAIN_LABEL)
              : policy?.approvalChain
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
  /** 211: the HR Head's settlement of the final rating, as the row holds it. */
  hrFinal?: HrFinalRow | null
  /** Whether this row's policy requires that settlement before publishing. */
  hrFinalRequired?: boolean
  /** 212: built by the HR Head outside the chain, so 207's rule is waived. */
  hrDirect?: boolean
  hrDirectReason?: string | null
  /** The branch, for the bulk filter. Null where the employee has none. */
  locationId?: string | null
  locationName?: string | null
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
/**
 * WHAT THE CHAIN ASKED FOR, on the card where HR decides.
 *
 * Requested: the PIP requests, training suggestions and recognition the
 * raters proposed all reach the HR Head "at end so they can publish results
 * and give recognizations and act accordingly".
 *
 * Placed inside the member card rather than on a tab of its own, because the
 * decision it informs is the one being made right here — a separate screen
 * would mean reading a proposal, navigating away, and publishing from memory.
 *
 * NONE OF THIS BLOCKS THE PUBLISH BUTTON. See publishWarnings: a rater can
 * attach a proposal to anybody, so a pending one holding the result would
 * let any rater stall any release. The warnings sit above the button and the
 * button still works.
 */
function AskRow({ ask, onDecide }: {
  ask: ChainAsk
  onDecide?: (id: string, status: HrStatus, note: string) => void
}) {
  const [note, setNote] = useState(ask.hrNote ?? '')
  const [open, setOpen] = useState(false)
  const decided = ask.status !== 'PENDING'
  return (
    <div className={`askrow${decided ? ' decided' : ''}`}>
      <div className="askhead">
        <div>
          <b>{ask.name || <span className="k">(unnamed)</span>}</b>
          {ask.kind === 'TRAINING' && ask.category && (
            <span className="k"> · {TRAINING_CATEGORY_LABEL[ask.category as TrainingCategory]
                                    ?? ask.category.toLowerCase()}</span>
          )}
          <div className="k" style={{ marginTop: 2 }}>
            Proposed by {ask.byName ?? ask.byRole ?? 'the chain'}
            {ask.byName && ask.byRole ? ` (${ask.byRole.replace(/_/g, ' ')})` : ''}
            {ask.at ? ` on ${ask.at.slice(0, 10)}` : ''}
          </div>
        </div>
        <Pill tone={ask.status === 'ACCEPTED' ? 'green'
                  : ask.status === 'DECLINED' ? 'grey' : 'amber'}>
          {HR_STATUS_LABEL[ask.status]}
        </Pill>
      </div>

      {ask.details && <div className="askdet">{ask.details}</div>}
      {decided && ask.hrNote && (
        <div className="askdet"><b>Your note.</b> {ask.hrNote}</div>
      )}

      {onDecide && ask.id && (
        !open ? (
          <div className="btnrow">
            <button className="btn ghost sm" type="button" onClick={() => setOpen(true)}>
              {decided ? 'Change this decision' : 'Decide'}
            </button>
          </div>
        ) : (
          <>
            <div className="fld">
              <label htmlFor={`ask-${ask.id}`}>
                Note {ask.kind === 'RECOGNITION'
                  ? '(the employee does not see this; add the award itself under Recognition below)'
                  : '(for the record and for the manager who suggested it)'}
              </label>
              <input id={`ask-${ask.id}`} value={note}
                     placeholder={ask.kind === 'RECOGNITION'
                       ? 'e.g. approved for the January cycle'
                       : 'e.g. budgeted for Q1, nominated'}
                     onChange={e => setNote(e.target.value)} />
            </div>
            <div className="btnrow">
              <button className="btn sm" type="button"
                      onClick={() => { onDecide(ask.id!, 'ACCEPTED', note.trim()); setOpen(false) }}>
                Accept
              </button>
              <button className="btn ghost sm" type="button"
                      onClick={() => { onDecide(ask.id!, 'DECLINED', note.trim()); setOpen(false) }}>
                Decline
              </button>
              <button className="btn ghost sm" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </>
        )
      )}
    </div>
  )
}

function ChainAsksBlock({ asks, onDecide }: {
  asks: ChainAsks | undefined
  onDecide?: (id: string, status: HrStatus, note: string) => void
}) {
  if (!asks || asks.empty) {
    return (
      <>
        <Section>What the chain asked for</Section>
        <div className="k" style={{ lineHeight: 1.6 }}>
          Nobody in the chain proposed training, recognition or a PIP while
          rating this person. That is the usual case — the blocks are optional
          and a rater with nothing to add leaves them alone.
        </div>
      </>
    )
  }
  return (
    <>
      <Section>What the chain asked for</Section>

      {asks.recognition.length > 0 && (
        <div className="askgroup">
          <div className="asklbl">
            Recognition proposed ({asks.recognition.length})
            <span className="k"> — a proposal, not an award. Accepting one records
              your decision; the award itself is the Recognition block below.</span>
          </div>
          {asks.recognition.map((a, i) => (
            <AskRow key={a.id ?? i} ask={a} onDecide={onDecide} />
          ))}
        </div>
      )}

      {asks.training.length > 0 && (
        <div className="askgroup">
          <div className="asklbl">
            Training suggested ({asks.training.length})
            <span className="k"> — not shown to the employee. Your decision here
              does not change what goes out with the rating.</span>
          </div>
          {asks.training.map((a, i) => (
            <AskRow key={a.id ?? i} ask={a} onDecide={onDecide} />
          ))}
        </div>
      )}

      {asks.pips.length > 0 && (
        <div className="askgroup">
          <div className="asklbl">
            PIP {asks.pips.length === 1 ? 'request' : 'requests'} ({asks.pips.length})
            <span className="k"> — read-only here. A PIP has its own six-step
              review in PIP Requests, and an RM cannot start one.</span>
          </div>
          {asks.pips.map((p, i) => (
            <div className="askrow" key={p.id ?? i}>
              <div className="askhead">
                <div>
                  <b>Raised by {p.byName ?? p.byRole ?? 'the chain'}</b>
                  {p.triggerRating !== null && p.triggerRating !== undefined && (
                    <span className="k"> · triggered at {p.triggerRating}</span>
                  )}
                  <div className="k" style={{ marginTop: 2 }}>
                    {p.proposedStart && p.proposedEnd
                      ? `Proposed ${p.proposedStart} to ${p.proposedEnd}` : 'No dates proposed'}
                  </div>
                </div>
                <Pill tone={p.pip.status === 'REJECTED' || p.pip.status === 'CLOSED' ? 'grey'
                          : p.pip.status === 'PENDING_HR' ? 'amber' : 'green'}>
                  {STATUS_LABEL[p.pip.status]}
                </Pill>
              </div>
              {p.reason && <div className="askdet">{p.reason}</div>}
              <div className="k" style={{ marginTop: 6 }}>{pipLine(p)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * THE HR HEAD SETTLING THE FINAL RATING.
 *
 * Requested: a checkbox asking whether the rating was discussed with the
 * company's management; the HR Head's number overwrites what the chain
 * settled and counts as THE final rating; they may instead keep the chain's;
 * and nothing publishes until they have done one or the other.
 *
 * Placed above the feedback boxes because the order is the point: settle
 * what the number is, THEN write the words that go out beside it. Writing
 * an appreciation remark about a 4 and then changing it to a 3 is how a
 * result goes out contradicting itself.
 *
 * READ-ONLY FOR EVERYONE ELSE. An HR Manager sees where the appraisal has
 * got to and who it is waiting on; they do not get the controls, because
 * the owner chose the HR_HEAD role over "any HR-level user" precisely so
 * that an HR Manager cannot set the number that overrides the HOD.
 */
function HrFinalBlock({ row, required, scale, canSettle, onSettle, busy }: {
  row: HrFinalRow | null | undefined
  required: boolean
  scale: number[]
  canSettle: boolean
  onSettle?: (intent: FinalIntent) => void
  busy?: boolean
}) {
  const state = hrFinalState(row)
  const chainRating = state.overrode ? state.chainRating : state.rating
  const [choice, setChoice] = useState<'KEEP' | 'REPLACE'>('KEEP')
  const [rating, setRating] = useState('')
  const [reason, setReason] = useState('')
  const [discussed, setDiscussed] = useState(false)

  if (!required) {
    return (
      <>
        <Section>Final rating</Section>
        <div className="k" style={{ lineHeight: 1.6 }}>
          This policy does not require the HR Head to settle the rating, so
          the chain&rsquo;s rating of <b>{state.rating ?? '—'}</b> stands and the
          result can be published as it is.
        </div>
      </>
    )
  }

  if (state.settled) {
    return (
      <>
        <Section>Final rating</Section>
        <div className="banner b-green">
          <span aria-hidden="true">✓</span>
          <div>
            <b>Settled by the HR Head at {state.rating ?? '—'}</b>
            {state.overrode
              ? <> — replacing the <b>{state.chainRating}</b> the chain settled.</>
              : <> — the rating the chain settled, kept.</>}
            {state.at ? ` ${state.at.slice(0, 10)}.` : ''}
            {state.reason && <div style={{ marginTop: 4 }}>{state.reason}</div>}
            <div className="k" style={{ marginTop: 4 }}>
              Discussed with the company&rsquo;s management.
            </div>
          </div>
        </div>
      </>
    )
  }

  if (!canSettle) {
    return (
      <>
        <Section>Final rating</Section>
        <div className="banner b-amber">
          <span aria-hidden="true">!</span>
          <div>
            The chain settled <b>{state.rating ?? '—'}</b>, and the HR Head has
            not confirmed it yet. <b>This result cannot be published until they
            do.</b> Only the HR Head can settle a final rating.
          </div>
        </div>
      </>
    )
  }

  const intent: FinalIntent = {
    choice,
    rating: rating === '' ? null : Number(rating),
    reason, discussed,
  }
  const check = checkFinal(intent, chainRating, scale)

  return (
    <>
      <Section>Final rating</Section>
      <div className="k" style={{ marginBottom: 8, lineHeight: 1.6 }}>
        The chain settled <b>{chainRating ?? '—'}</b>. Keep it, or set the rating
        that will stand instead — yours replaces it as the final rating. What
        each manager scored stays on the record either way.
      </div>

      <div className="btnrow" style={{ marginBottom: 8 }}>
        <button type="button"
                className={`btn ${choice === 'KEEP' ? '' : 'ghost'} sm`}
                onClick={() => setChoice('KEEP')}>
          Keep {chainRating ?? 'the chain\u2019s rating'}
        </button>
        <button type="button"
                className={`btn ${choice === 'REPLACE' ? '' : 'ghost'} sm`}
                onClick={() => setChoice('REPLACE')}>
          Set a different rating
        </button>
      </div>

      {choice === 'REPLACE' && (
        <>
          <div className="grid g2">
            <Field label="Final rating" hint="This becomes the rating the employee reads">
              <select value={rating} onChange={e => setRating(e.target.value)}>
                <option value="">Choose a rating</option>
                {scale.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>
          <div className="fld">
            <label htmlFor="hrf-reason">Why this replaces the chain&rsquo;s rating</label>
            <textarea id="hrf-reason" rows={2} value={reason}
                      placeholder="The only record of this decision — say what decided it."
                      onChange={e => setReason(e.target.value)} />
          </div>
        </>
      )}

      {/* THE CHECKBOX, on both paths. The question is as live when the HR
          Head agrees with the chain as when they overrule it. */}
      <label className="chk" style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                                      margin: '8px 0', lineHeight: 1.6 }}>
        <input type="checkbox" checked={discussed}
               onChange={e => setDiscussed(e.target.checked)} />
        <span>{HR_FINAL_PROMPT}</span>
      </label>

      {check.faults.length > 0 && discussed && (
        <div className="banner b-amber">
          <span aria-hidden="true">!</span>
          <div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              {check.faults.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="btnrow">
        <button className="btn" type="button" disabled={!check.ok || !onSettle || busy}
                onClick={() => onSettle?.(intent)}>
          {busy ? 'Settling…'
            : choice === 'KEEP' ? `Settle the final rating at ${chainRating ?? '—'}`
            : `Settle the final rating at ${rating || '—'}`}
        </button>
      </div>
    </>
  )
}

/**
 * RELEASING MANY RESULTS AT ONCE.
 *
 * Requested: "Bulk publish at one click for multiple employees with
 * different employee ids in multiple departments filter by
 * group/branch/company. Default filter: selected all."
 *
 * ── THE SHAPE OF THE SCREEN ────────────────────────────────────────────
 *
 * Filters first, then what the filter found, split into who can go and who
 * cannot. The split is the point: a batch that silently publishes some
 * people and ignores others is the worst possible version of this, so the
 * ones left behind are counted, grouped by WHY, and listed by name.
 *
 * Every filter starts at "all", as asked. Group is the whole group of
 * companies — a scope above Company — because the columns literally named
 * unit and business_unit are empty on every employee in the database.
 *
 * ── NOTHING IS RELAXED ─────────────────────────────────────────────────
 *
 * Each person goes through the same publishFaults the single card uses.
 * The difference is only which text is judged: the card weighs what is
 * being typed, this weighs what was saved, because a batch releases
 * results that were already prepared.
 */
function BulkPublish({ rows, deptNames, periodLabel, canAct, onPublishMany }: {
  rows: PublishRow[] | null
  deptNames: Record<string, string>
  periodLabel?: string | null
  canAct: boolean
  onPublishMany?: (ids: string[], onDone: (n: number) => void) => Promise<BulkOutcome>
}) {
  const [filter, setFilter] = useState<BulkFilter>({})
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<{ o: BulkOutcome; skipped: number } | null>(null)

  const all: BulkRow[] = useMemo(() => (rows ?? []).map(r => ({
    employeeId: r.employeeId, periodId: r.periodId, code: r.code, name: r.name,
    companyName: r.companyName, departmentId: r.departmentId,
    departmentName: r.departmentId ? (deptNames[r.departmentId] ?? null) : null,
    locationId: r.locationId, locationName: r.locationName,
    published: r.published,
    finalRating: r.finalRating,
    appreciation: r.appreciation, improvement: r.improvement,
    // The band's own rule travels with the row; the card computes it from
    // `bands` and this must not guess differently.
    improvementRequired: false,
    signedOff: r.signedOff, hrDirect: r.hrDirect,
    hrFinal: r.hrFinal, hrFinalRequired: r.hrFinalRequired,
  })), [rows, deptNames])

  const opts = useMemo(() => bulkChoices(all), [all])
  const inScope = useMemo(() => selectRows(all, filter), [all, filter])
  const { ready, blocked, inChain } = useMemo(() => bulkSplit(inScope), [inScope])
  const summary = useMemo(() => blockedSummary(blocked), [blocked])

  // DEFAULT: EVERYTHING THE FILTER FOUND. `picked` stays null until somebody
  // unticks something, so changing a filter cannot leave a stale selection
  // of people who are no longer on screen.
  const chosen = ready.filter(r => picked === null || picked.has(r.employeeId))
  const toggle = (id: string) => setPicked(p => {
    const next = new Set(p ?? ready.map(r => r.employeeId))
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const setFilterPart = (k: keyof BulkFilter, v: string) => {
    setFilter(f => ({ ...f, [k]: v === '' ? null : v }))
    setPicked(null); setOutcome(null); setConfirming(false)
  }

  if (!canAct) return null

  return (
    <Card title="Publish several at once"
          sub={`Release every settled result in a company, branch or department for ${periodLabel || 'this period'}. Everything starts selected.`}>
      {outcome && (
        <div className={outcome.o.published.length ? 'banner b-green' : 'banner b-amber'}>
          <span aria-hidden="true">{outcome.o.published.length ? '✓' : '!'}</span>
          <div>
            {outcomeText(outcome.o, outcome.skipped)}
            {outcome.o.failed.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                {outcome.o.failed.map(f => (
                  <li key={f.code}><b>{f.name} · {f.code}</b> — {f.message}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="grid g3">
        <Field label="Company" hint="Group — every company at once — is the default">
          <select value={filter.company ?? ''}
                  onChange={e => setFilterPart('company', e.target.value)}>
            <option value="">Group · all companies</option>
            {opts.companies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Branch">
          <select value={filter.location ?? ''}
                  onChange={e => setFilterPart('location', e.target.value)}>
            <option value="">All branches</option>
            {opts.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select value={filter.department ?? ''}
                  onChange={e => setFilterPart('department', e.target.value)}>
            <option value="">All departments</option>
            {opts.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid g3" style={{ margin: '12px 0' }}>
        <Stat label="Ready to publish" value={ready.length}
              tone={ready.length ? 'accent' : undefined}
              note={chosen.length !== ready.length ? `${chosen.length} selected` : 'all selected'} />
        <Stat label="Waiting on you" value={blocked.length}
              note={blocked.length ? 'settled, but missing something' : 'nothing held up'} />
        <Stat label="Still with the chain" value={inChain}
              note="nobody has rated them yet — not yours to act on" />
      </div>

      {ready.length === 0 ? (
        <Empty what="Nothing here is ready to publish"
               why={blocked.length
                 ? 'Every settled result this filter found is still missing something. The reasons are below.'
                 : inChain
                   ? `${inChain} ${inChain === 1 ? 'appraisal is' : 'appraisals are'} still with the chain. A result reaches this list once the chain has settled it.`
                   : 'No unpublished results match this filter. Widen it, or wait for the chain to settle more.'} />
      ) : (
        <>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" aria-label="Select everybody ready"
                           checked={chosen.length === ready.length}
                           onChange={() => setPicked(chosen.length === ready.length
                             ? new Set() : null)} />
                  </th>
                  <th>Code</th><th>Employee</th><th className="num">Rating</th>
                  <th>Company</th><th>Branch</th><th>Department</th>
                </tr>
              </thead>
              <tbody>
                {ready.map(r => (
                  <tr key={r.employeeId}>
                    <td>
                      <input type="checkbox"
                             aria-label={`Publish ${r.name}`}
                             checked={picked === null || picked.has(r.employeeId)}
                             onChange={() => toggle(r.employeeId)} />
                    </td>
                    <td>{r.code}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="num"><b>{r.finalRating}</b></td>
                    <td className="k">{r.companyName ?? '—'}</td>
                    <td className="k">{r.locationName ?? '—'}</td>
                    <td className="k">{r.departmentName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!confirming ? (
            <div className="btnrow">
              <button className="btn" type="button"
                      disabled={!chosen.length || !onPublishMany || running !== null}
                      onClick={() => { setConfirming(true); setOutcome(null) }}>
                {chosen.length
                  ? `Publish ${chosen.length} ${chosen.length === 1 ? 'result' : 'results'}`
                  : 'Nobody selected'}
              </button>
            </div>
          ) : (
            <div className="banner b-amber" style={{ marginTop: 12 }}>
              <span aria-hidden="true">!</span>
              <div>
                <b>Releasing {chosen.length} {chosen.length === 1 ? 'result' : 'results'} to{' '}
                {chosen.length === 1 ? 'that employee' : 'those employees'}.</b> This cannot be
                undone — once a result is out, the employee has seen it.
                <div className="btnrow" style={{ marginTop: 8 }}>
                  <button className="btn" type="button" disabled={running !== null}
                          onClick={async () => {
                            setRunning(0)
                            const o = await onPublishMany!(chosen.map(r => r.employeeId),
                              n => setRunning(n))
                            setRunning(null); setConfirming(false); setPicked(null)
                            setOutcome({ o, skipped: blocked.length })
                          }}>
                    {running !== null
                      ? `Publishing… ${running} of ${chosen.length}`
                      : `Yes, publish ${chosen.length}`}
                  </button>
                  <button className="btn ghost" type="button" disabled={running !== null}
                          onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {blocked.length > 0 && (
        <>
          <Section>Settled, but not ready to go out ({blocked.length})</Section>
          <div className="k" style={{ marginBottom: 8, lineHeight: 1.6 }}>
            These are left exactly as they are. Nothing below was touched.
          </div>
          <div className="chips" style={{ marginBottom: 10 }}>
            {summary.map(s => (
              <Pill key={s.reason} tone="amber">{s.n} · {s.reason}</Pill>
            ))}
          </div>
          <div className="tblwrap">
            <table>
              <thead><tr><th>Code</th><th>Employee</th><th>What is missing</th></tr></thead>
              <tbody>
                {blocked.slice(0, 50).map(b => (
                  <tr key={b.row.employeeId}>
                    <td>{b.row.code}</td>
                    <td style={{ fontWeight: 600 }}>{b.row.name}</td>
                    <td className="k">{b.faults[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {blocked.length > 50 && (
            <div className="k" style={{ marginTop: 8 }}>
              Showing the first 50 of {blocked.length}. Narrow the filter to see the rest.
            </div>
          )}
        </>
      )}
    </Card>
  )
}

export function PublishTab({ rows, loading, onPublish, onSaveFeedback, publishing,
                             periodLabel, bands = [], canAct = true, note,
                             company, onCompany, companies = [], allowAll = false,
                             asks, onDecideAsk,
                             canSettleFinal = false, onSettleFinal, settling,
                             onPublishMany, deptNames = {} }: {
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
  /**
   * WHAT THE CHAIN ASKED FOR, keyed by employee. Loaded by the page, because
   * three tables feed it and this component stays presentational.
   */
  asks?: Record<string, ChainAsks>
  /** Accept or decline one proposal. Absent renders the block read-only. */
  onDecideAsk?: (id: string, status: HrStatus, note: string) => void
  /** 211: whether the viewer holds the HR_HEAD role and may settle a rating. */
  canSettleFinal?: boolean
  onSettleFinal?: (employeeId: string, intent: FinalIntent) => void
  settling?: string | null
  /** Bulk release. Absent hides the whole section. */
  onPublishMany?: (ids: string[], onDone: (n: number) => void) => Promise<BulkOutcome>
  deptNames?: Record<string, string>
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
  /**
   * THE SHARED GATE. This was thirty lines inline, which was fine while the
   * card was the only way to publish; bulk made it two copies waiting to
   * drift, and the looser copy would have become the way to release a
   * result the other refuses. See lib/pms/publishGate.ts for why each fault
   * is there and which of them mirror a database trigger.
   *
   * The DRAFT is passed, not the saved row: somebody typing a remark should
   * watch the fault clear as they type. Bulk passes the saved values,
   * because a batch releases what was already prepared.
   */
  const faults = publishFaults({
    finalRating: member?.finalRating ?? null,
    appreciation: d.appreciation,
    improvement: d.improvement,
    improvementRequired,
    signedOff: member?.signedOff,
    hrDirect: member?.hrDirect,
    hrFinal: member?.hrFinal,
    hrFinalRequired: member?.hrFinalRequired,
  })
  const publishable = !!member && faults.length === 0
  /**
   * REPORTED, NOT ENFORCED, and deliberately computed after `publishable` so
   * nothing here can be folded into the gate by accident. A pending proposal
   * must never hold a result: a rater can attach one to anybody.
   */
  const warnings = member ? publishWarnings(asks?.[member.employeeId]
    ?? { training: [], recognition: [], pips: [], pendingRecommendations: 0,
         pendingPips: 0, empty: true }) : []

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
                    <th>Settled by</th><th>Settled on</th><th>Sign-off</th>
                    <th>Final rating</th><th>Chain asked for</th><th />
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
                      <td>{r.hrDirect
                        ? <Pill tone="grey">waived · direct</Pill>
                        : r.signedOff === false
                          ? <Pill tone="amber">not signed</Pill>
                          : <Pill tone="green">signed</Pill>}</td>
                      <td>
                        {r.hrFinalRequired === false
                          ? <span className="k">not required</span>
                          : hrFinalState(r.hrFinal).settled
                            ? <Pill tone="green">settled</Pill>
                            : <Pill tone="amber">awaiting HR Head</Pill>}
                      </td>
                      <td className="k">
                        {asksBadge(asks?.[r.employeeId]) ?? <span className="k">—</span>}
                      </td>
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

      <BulkPublish rows={scoped} deptNames={deptNames} periodLabel={periodLabel}
                   canAct={canAct && !!onPublishMany} onPublishMany={onPublishMany} />

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
              {/* READ BEFORE WRITING. This sat below the recognition editor,
                  which put what the chain proposed AFTER the box HR writes
                  the result in — the input arriving after the decision it is
                  supposed to inform. */}
              <ChainAsksBlock asks={asks?.[member.employeeId]} onDecide={onDecideAsk} />

              {/* SETTLE THE NUMBER BEFORE WRITING THE WORDS. An appreciation
                  remark composed about a 4 and then published beside a 3
                  is a result that contradicts itself. */}
              {member.hrDirect && (
                <div className="banner b-amber">
                  <span aria-hidden="true">!</span>
                  <div>
                    <b>Built outside the chain.</b> No manager rated this
                    person and there is no final-review one-to-one, so that
                    requirement is waived for this result alone.
                    {member.hrDirectReason && <div style={{ marginTop: 4 }}>
                      {member.hrDirectReason}</div>}
                  </div>
                </div>
              )}

              <HrFinalBlock row={member.hrFinal}
                            required={member.hrFinalRequired !== false}
                            scale={bands.map(b => b.value)}
                            canSettle={canSettleFinal}
                            busy={settling === member.employeeId}
                            onSettle={onSettleFinal
                              ? i => onSettleFinal(member.employeeId, i) : undefined} />

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

              {warnings.length > 0 && (
                <div className="banner b-blue" style={{ marginTop: 12 }}>
                  <span aria-hidden="true">i</span>
                  <div>
                    <b>Worth knowing before you release this:</b>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                      {warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                    {/* Said plainly, because an amber list that does not block
                        trains people to ignore the amber list that does. */}
                    <div className="k" style={{ marginTop: 6 }}>
                      None of these stops the publication.
                    </div>
                  </div>
                </div>
              )}

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

/**
 * ONE COMMIT PATH, used by the file and by the single-employee form.
 *
 * Two call sites writing their own fetch is how the two routes drift: the
 * actor role, the period, the error handling and the audit row all have to
 * be identical, because the RPC behind them treats both as the same kind of
 * override.
 */
async function commitRatings(
  periodId: string,
  rows: UploadRow[],
): Promise<{ ok: boolean; text: string }> {
  const r = await pmsAdmin<{ message?: string; applied?: number }>(
    'upload_commit',
    { period_id: periodId, actor_role: 'HR_MANAGER', rows })
  if (r.error) return { ok: false, text: r.error.message }
  return { ok: true, text: r.data?.message ?? 'Committed.' }
}

/**
 * WHO THE CHAIN HAS FINISHED WITH, on the screen where HR acts on them.
 *
 * Requested: show "all the employees that have already done with
 * finalization from hod and ready for hr final rating upload ... and their
 * current status".
 *
 * Three groups, and the third is a sentence rather than rows: 386 of the
 * 395 people enrolled in this period have not started, and listing them is
 * what made the publish queue unreadable before it was narrowed. The ones
 * already released are kept, separately, so the screen can be used to
 * confirm the cycle is finished — but never mistaken for work outstanding.
 */
function FinalisedQueue({ rows, periodLabel, onPick, picked }: {
  rows?: FillRow[] | null
  periodLabel?: string
  onPick: (c: Candidate) => void
  picked: Candidate | null
}) {
  const q = useMemo(() => finalisedQueue(rows), [rows])
  const toCandidate = (r: QueueRow): Candidate => ({
    code: r.code, name: r.name, rating: r.rating,
    flag: r.flag, periodCode: r.periodCode,
  })

  if (rows === null || rows === undefined) return <div className="k">Loading…</div>

  return (
    <>
      <Card title={`Finalised by the chain, waiting on you (${q.ready.length})`}
            sub={`Settled ratings for ${periodLabel || 'this period'}, whoever signed them off`
               + ` — the finaliser is the HOD on most policies and may be another role.`
               + (q.inChain ? ` ${q.inChain} more ${q.inChain === 1 ? 'appraisal is' : 'appraisals are'}`
                            + ' still with the chain and will appear here once settled.' : '')}>
        {!q.ready.length ? (
          <Empty what="Nothing is waiting"
                 why={q.inChain
                   ? `A rating reaches this list once the chain has settled it. ${q.inChain} ${q.inChain === 1 ? 'appraisal is' : 'appraisals are'} still in the chain.`
                   : 'A rating reaches this list once the chain has settled it.'} />
        ) : (
          <div className="tblwrap">
            <table>
              <thead>
                <tr><th>Code</th><th>Employee</th><th className="num">Rating</th>
                    <th>Finalised by</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {q.ready.map(r => (
                  <tr key={r.code}>
                    <td>{r.code}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="num"><b>{r.rating ?? '—'}</b></td>
                    <td className="k">{(r.finalisedBy ?? '—').replace(/_/g, ' ')}</td>
                    <td>
                      {r.locked
                        ? <Pill tone="grey">locked — exited and rated</Pill>
                        : <Pill tone="amber">{QUEUE_STATUS_LABEL[r.status]}</Pill>}
                    </td>
                    <td>
                      <button className="btn ghost sm" type="button" disabled={r.locked}
                              onClick={() => onPick(toCandidate(r))}>
                        {picked?.code === r.code ? 'Open below' : 'Set rating'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {q.done.length > 0 && (
        <Card title={`Already released (${q.done.length})`}
              sub="Out to the employee. Here so the cycle can be read at a glance, not because anything is owed on them.">
          <div className="tblwrap">
            <table>
              <thead>
                <tr><th>Code</th><th>Employee</th><th className="num">Rating</th>
                    <th>Finalised by</th><th>Status</th></tr>
              </thead>
              <tbody>
                {q.done.map(r => (
                  <tr key={r.code}>
                    <td>{r.code}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="num">{r.rating ?? '—'}</td>
                    <td className="k">{(r.finalisedBy ?? '—').replace(/_/g, ' ')}</td>
                    <td><Pill tone="green">{QUEUE_STATUS_LABEL[r.status]}</Pill></td>
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

/**
 * ONE PERSON'S FINAL RATING, found by employee code or name.
 *
 * Requested: "final rating can be uploaded in bulk or hr can also give
 * rating per employee basis using there employee code and name."
 *
 * A BATCH OF ONE, deliberately. This builds an ordinary UploadRow, runs it
 * through the same checkUpload the file goes through, and commits it with
 * commitRatings. Nothing here can get a rating past a rule the bulk route
 * enforces — eligibility, a locked record, the policy's scale, a reason for
 * an override, the audit row — because it is not a second write path.
 *
 * What differs is the reading, not the writing. A file is checked in bulk
 * and applied; one person is looked up, and the rating they are on NOW is
 * put in front of the reviewer before they change it.
 */
function OneEmployeeRating({ enrolled, known, periodId, periodLabel, onCommitted,
                             picked, onPicked }: {
  enrolled?: FillRow[] | null
  known: Known
  periodId?: string | null
  periodLabel?: string
  onCommitted?: (message: string) => void
  /**
   * CONTROLLED BY THE TAB, so the queue above can hand somebody straight to
   * this form. The tab also keys this component on the person, so choosing
   * a different one remounts it rather than leaving the previous rating,
   * reason and feedback sitting in the boxes under a new name.
   */
  picked: Candidate | null
  onPicked: (c: Candidate | null) => void
}) {
  const [query, setQuery] = useState('')
  const [rating, setRating] = useState(picked?.rating != null ? String(picked.rating) : '')
  const [reason, setReason] = useState('')
  const [improvement, setImprovement] = useState('')
  const [appreciation, setAppreciation] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const matches = picked ? [] : searchEnrolled(enrolled, query)

  const reset = () => {
    onPicked(null); setQuery(''); setRating('')
    setReason(''); setImprovement(''); setAppreciation('')
  }

  // Validated THROUGH THE SHARED ENGINE on every keystroke, so the reviewer
  // sees the same sentence the file would have shown them — before they
  // press anything, rather than after.
  const row = picked && rating
    ? oneRow({ employeeCode: picked.code, periodCode: picked.periodCode,
               finalRating: Number(rating), overrideReason: reason,
               improvementFeedback: improvement, appreciation })
    : null
  const checked = row ? checkUpload([row], known) : null
  const faults = checked?.rows[0]?.errors ?? []
  const delta = checked?.rows[0]?.delta ?? null
  const ready = !!checked?.canCommit && !!periodId && !busy

  return (
    <Card title="One employee at a time"
          sub="Look somebody up by employee code or name and set their final rating. Same rules, same audit trail as the file.">
      {result && (
        <div className={result.ok ? 'banner b-green' : 'banner b-amber'}>
          <span aria-hidden="true">{result.ok ? '✓' : '⚠️'}</span>
          <div>{result.text}</div>
        </div>
      )}

      {!picked ? (
        <>
          <Field label="Employee"
                 hint="Type an employee code or a name. Nothing is listed until you do.">
            <input value={query} placeholder="e.g. SRS9057, or Isha"
                   onChange={e => setQuery(e.target.value)} />
          </Field>
          {query.trim() && !matches.length && (
            <div className="k">Nobody in {periodLabel || 'this period'} matches that.</div>
          )}
          {matches.length > 0 && (
            <div className="tblwrap">
              <table>
                <thead>
                  <tr><th>Code</th><th>Employee</th><th className="num">Rating now</th>
                      <th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {matches.map(m => (
                    <tr key={m.code}>
                      <td>{m.code}</td>
                      <td style={{ fontWeight: 600 }}>{m.name}</td>
                      <td className="num">{m.rating ?? <span className="k">not rated</span>}</td>
                      <td className="k">{(m.flag ?? '').replace(/_/g, ' ').toLowerCase() || '—'}</td>
                      <td>
                        <button className="btn ghost sm" type="button"
                                onClick={() => onPicked(m)}>
                          Choose
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="banner b-blue">
            <span aria-hidden="true">i</span>
            <div>
              <b>{picked.name} · {picked.code}</b> — on record at{' '}
              {picked.rating ?? 'no rating yet'}
              {periodLabel ? ` for ${periodLabel}` : ''}.
              {' '}<button className="btn ghost sm" type="button" onClick={reset}>
                Choose somebody else
              </button>
            </div>
          </div>

          <div className="grid g2">
            <Field label="Final rating"
                   hint={delta ? `${delta > 0 ? '+' : ''}${delta} against the rating on record` : 'The rating that will stand'}>
              <select value={rating} onChange={e => setRating(e.target.value)}>
                <option value="">Choose a rating</option>
                {known.scale.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>

          <div className="fld">
            <label htmlFor="oe-reason">
              Reason{faults.includes('ERROR_REASON_MISSING') ? ' (required: this changes the rating on record)' : ''}
            </label>
            <textarea id="oe-reason" rows={2} value={reason}
                      placeholder="What decided this — a calibration meeting, a correction, a late input."
                      onChange={e => setReason(e.target.value)} />
          </div>

          <div className="fld">
            <label htmlFor="oe-impr">
              Improvement feedback{known.improvementMandatoryAtOrBelow != null
                && Number(rating) <= known.improvementMandatoryAtOrBelow && rating
                ? ' (mandatory at this rating)' : ' (optional)'}
            </label>
            <textarea id="oe-impr" rows={2} value={improvement}
                      onChange={e => setImprovement(e.target.value)} />
          </div>

          <div className="fld">
            <label htmlFor="oe-appr">Appreciation remark (optional)</label>
            <textarea id="oe-appr" rows={2} value={appreciation}
                      onChange={e => setAppreciation(e.target.value)} />
          </div>

          {faults.length > 0 && (
            <div className="banner b-amber">
              <span aria-hidden="true">!</span>
              <div>
                <b>Before this can be saved:</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                  {faults.map(f => <li key={f}>{ERROR_TEXT[f]}</li>)}
                </ul>
              </div>
            </div>
          )}

          <div className="btnrow">
            <button className="btn" type="button" disabled={!ready}
                    onClick={async () => {
                      if (!row || !periodId) return
                      setBusy(true); setResult(null)
                      const r = await commitRatings(periodId, [row])
                      setBusy(false)
                      setResult(r)
                      if (!r.ok) return
                      reset()
                      onCommitted?.(r.text)
                    }}>
              {busy ? 'Saving…' : !rating ? 'Choose a rating'
                : ready ? `Set ${picked.name}'s rating to ${rating}` : 'Cannot save yet'}
            </button>
            <button className="btn ghost" type="button" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
    </Card>
  )
}

/**
 * AN APPRAISAL THE CHAIN NEVER PICKED UP, built by the HR Head.
 *
 * Requested as "a special case feature": set the KRAs, rate them, set the
 * final rating, publish. The exceptions — somebody who transferred in after
 * the cycle opened, a role the routing never covered — who would otherwise
 * end the year with no appraisal at all.
 *
 * ── WHAT THIS FORM DOES NOT DO ─────────────────────────────────────────
 *
 * It does not publish. It builds the record and leaves it FINALISED, which
 * puts it on Publish Results like any other settled appraisal — where the
 * HR Head settles it under 211 and releases it.
 *
 * That is deliberate. The 211 attestation asks whether the rating was
 * discussed with the company's management, and that question is MORE live
 * for an appraisal nobody else saw, not less. Asking it here as well would
 * be asking twice; skipping it would be the one result in the system that
 * never faced it.
 *
 * ── ONLY PEOPLE THE CHAIN NEVER TOUCHED ────────────────────────────────
 *
 * And when somebody is not eligible they are shown with the REASON rather
 * than omitted, because a name missing from a list cannot explain itself.
 */
function DirectAppraisal({ enrolled, scale, periodId, periodLabel, canAct,
                           onDone }: {
  enrolled?: FillRow[] | null
  scale: number[]
  periodId?: string | null
  periodLabel?: string
  canAct: boolean
  onDone?: (employeeId: string, intent: DirectIntent, code: string) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<FillRow | null>(null)
  const [reason, setReason] = useState('')
  const [kras, setKras] = useState<Kra[]>([])
  const [scores, setScores] = useState<Record<number, number | null>>({})
  const [finalRating, setFinalRating] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  if (!canAct) return null

  const matches = (() => {
    const q = query.trim().toUpperCase()
    if (!q || picked) return []
    return (enrolled ?? []).filter(r =>
      String(r.employee_code ?? '').toUpperCase().includes(q)
      || String(r.employee_name ?? '').toUpperCase().includes(q)).slice(0, 8)
  })()

  const reset = () => {
    setPicked(null); setQuery(''); setReason(''); setKras([]); setScores({})
    setFinalRating('')
  }

  const addKra = () => setKras(k => [...k, {
    seq_no: k.length + 1, kra_title: '', kpi_metric: '', target_value: '',
    category: 'BUSINESS', weightage: 0,
  }])
  const setKra = (i: number, patch: Partial<Kra>) =>
    setKras(k => k.map((x, j) => j === i ? { ...x, ...patch } : x))
  const dropKra = (i: number) => setKras(k => k.filter((_, j) => j !== i)
    .map((x, j) => ({ ...x, seq_no: j + 1 })))

  const intent: DirectIntent = {
    reason, kras,
    scores,
    finalRating: finalRating === '' ? null : Number(finalRating),
  }
  const check = checkDirect(intent, scale)
  const suggested = suggestedFinal(intent)

  if (!open) {
    return (
      <Card title="Somebody the chain never picked up"
            sub="Build an appraisal directly — KRAs, a rating for each, and the final rating — for an employee no chain was assigned to.">
        <div className="k" style={{ marginBottom: 10, lineHeight: 1.6 }}>
          A special case, and recorded as one: your name and your reason stay
          on the record, and the final-review sign-off is waived because there
          is no manager to have had that conversation. Everything else — the
          KRA rules, the rating scale, your settlement before publishing —
          applies exactly as it does to everybody else.
        </div>
        <div className="btnrow">
          <button className="btn ghost" type="button" onClick={() => setOpen(true)}>
            Build an appraisal outside the chain
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card title="Building an appraisal outside the chain"
          sub={`For ${periodLabel || 'the open period'}. Recorded against your name, with your reason.`}>
      {result && (
        <div className={result.ok ? 'banner b-green' : 'banner b-amber'}>
          <span aria-hidden="true">{result.ok ? '✓' : '⚠️'}</span>
          <div>{result.text}</div>
        </div>
      )}

      {!picked ? (
        <>
          <Field label="Employee"
                 hint="Employee code or name. Only people the chain never started can be taken outside it.">
            <input value={query} placeholder="e.g. SRS9012, or Priya"
                   onChange={e => setQuery(e.target.value)} />
          </Field>
          {query.trim() && !matches.length && (
            <div className="k">Nobody in {periodLabel || 'this period'} matches that.</div>
          )}
          {matches.length > 0 && (
            <div className="tblwrap">
              <table>
                <thead><tr><th>Code</th><th>Employee</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {matches.map(m => {
                    const why = whyNotDirect({
                      final_rating: m.final_rating, workflow_status: m.workflow_status,
                      kra_count: m.kra_count, self_score: m.self_score,
                    })
                    return (
                      <tr key={String(m.employee_code)}>
                        <td>{m.employee_code}</td>
                        <td style={{ fontWeight: 600 }}>{m.employee_name}</td>
                        <td className="k">{why ?? 'Never started — can be built here'}</td>
                        <td>
                          <button className="btn ghost sm" type="button" disabled={!!why}
                                  onClick={() => setPicked(m)}>
                            {why ? 'Not eligible' : 'Choose'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="btnrow">
            <button className="btn ghost sm" type="button"
                    onClick={() => { reset(); setOpen(false) }}>Close</button>
          </div>
        </>
      ) : (
        <>
          <div className="banner b-blue">
            <span aria-hidden="true">i</span>
            <div>
              <b>{picked.employee_name} · {picked.employee_code}</b> — no KRAs, no
              ratings, nothing from the chain.{' '}
              <button className="btn ghost sm" type="button" onClick={reset}>
                Choose somebody else
              </button>
            </div>
          </div>

          <div className="fld">
            <label htmlFor="da-reason">Why this is being done outside the chain</label>
            <textarea id="da-reason" rows={2} value={reason}
                      placeholder="e.g. Transferred in after the cycle opened; no reporting chain was assigned."
                      onChange={e => setReason(e.target.value)} />
          </div>

          <Section>KRAs and their ratings</Section>
          {!kras.length && (
            <div className="k" style={{ marginBottom: 8 }}>
              Nothing yet. The same rules apply as to anybody else&rsquo;s
              scorecard — the weightages have to add up, and every KRA needs a
              rating.
            </div>
          )}
          {kras.map((k, i) => (
            <div key={i} className="askrow">
              <div className="grid g2">
                <Field label={`KRA ${k.seq_no}`}>
                  <input value={k.kra_title} placeholder="What they were measured on"
                         onChange={e => setKra(i, { kra_title: e.target.value })} />
                </Field>
                <Field label="Measure">
                  <input value={k.kpi_metric} placeholder="How it was measured"
                         onChange={e => setKra(i, { kpi_metric: e.target.value })} />
                </Field>
              </div>
              <div className="grid g3">
                <Field label="Target">
                  <input value={k.target_value}
                         onChange={e => setKra(i, { target_value: e.target.value })} />
                </Field>
                <Field label="Weightage %">
                  <input type="number" value={k.weightage || ''}
                         onChange={e => setKra(i, { weightage: Number(e.target.value) || 0 })} />
                </Field>
                <Field label="Rating">
                  <select value={scores[k.seq_no] ?? ''}
                          onChange={e => setScores(s => ({ ...s,
                            [k.seq_no]: e.target.value === '' ? null : Number(e.target.value) }))}>
                    <option value="">—</option>
                    {scale.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid g2">
                <Field label="Category">
                  <select value={k.category}
                          onChange={e => setKra(i, { category: e.target.value as Kra['category'] })}>
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                    ))}
                  </select>
                </Field>
                <div className="fld" style={{ alignSelf: 'end' }}>
                  <button className="btn ghost sm" type="button" onClick={() => dropKra(i)}>
                    Remove this KRA
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className="btnrow">
            <button className="btn ghost sm" type="button" onClick={addKra}>+ Add a KRA</button>
          </div>

          <Section>Final rating</Section>
          <div className="grid g2">
            <Field label="Final rating"
                   hint={suggested === null
                     ? 'The weighted average appears once the KRAs are rated.'
                     : `The weighted average of what you have rated is ${suggested}. You are not bound by it.`}>
              <select value={finalRating} onChange={e => setFinalRating(e.target.value)}>
                <option value="">Choose a rating</option>
                {scale.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>

          {check.faults.length > 0 && (
            <div className="banner b-amber">
              <span aria-hidden="true">!</span>
              <div>
                <b>Before this can be saved:</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                  {check.faults.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            </div>
          )}

          <div className="k" style={{ margin: '8px 0', lineHeight: 1.6 }}>
            Saving does not publish. The appraisal becomes a settled record and
            appears on <b>Publish Results</b>, where you confirm the final
            rating and release it — the same last step as everybody else.
          </div>

          <div className="btnrow">
            <button className="btn" type="button"
                    disabled={!check.ok || !periodId || busy || !onDone}
                    onClick={async () => {
                      setBusy(true); setResult(null)
                      const err = await onDone?.(String(picked.employee_code), intent,
                        String(picked.employee_code))
                      setBusy(false)
                      if (err) { setResult({ ok: false, text: err }); return }
                      setResult({ ok: true, text: `${picked.employee_name}\u2019s appraisal is `
                        + 'on record and waiting on Publish Results.' })
                      reset()
                    }}>
              {busy ? 'Saving…' : check.ok ? 'Save this appraisal' : 'Cannot save yet'}
            </button>
            <button className="btn ghost" type="button" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
    </Card>
  )
}

export function UploadTab({ rows: enrolled, scale, improvementAtOrBelow,
                            periodId, periodLabel, onCommitted,
                            canBuildDirect = false, onDirect }: {
  /** vw_pms_fill_status for the open period. Null while loading. */
  rows?: FillRow[] | null
  scale?: number[]
  improvementAtOrBelow?: number | null
  /** The open period. Without it the commit has nowhere to write. */
  periodId?: string | null
  periodLabel?: string
  /** 212: whether the viewer holds the HR_HEAD role. */
  canBuildDirect?: boolean
  /** Writes the whole direct appraisal. Returns an error sentence, or null. */
  onDirect?: (employeeCode: string, intent: DirectIntent) => Promise<string | null>
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
  /** Lifted out of the form so a queue row can hand somebody to it. */
  const [picked, setPicked] = useState<Candidate | null>(null)

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
          These are <b>override rights</b>. Setting a rating here replaces the one
          the system computed, and every change is written to the audit log with the
          actor, the timestamp and the reason — whether it arrives in a file or one
          person at a time. A rating that differs from the computed one cannot be
          saved without a reason.
        </div>
      </div>

      <DirectAppraisal enrolled={enrolled} scale={scale?.length ? scale : [1,2,3,4,5]}
                       periodId={periodId} periodLabel={periodLabel}
                       canAct={canBuildDirect}
                       onDone={onDirect ? (code, intent) => onDirect(code, intent) : undefined} />

      <FinalisedQueue rows={enrolled} periodLabel={periodLabel}
                      onPick={setPicked} picked={picked} />

      {/* KEYED ON THE PERSON. Choosing somebody else remounts the form, so
          the previous rating, reason and feedback cannot be left sitting in
          the boxes under a new name — which, on a control that overrides a
          final rating, is the mistake worth designing out. */}
      <OneEmployeeRating key={picked?.code ?? 'none'}
                         enrolled={enrolled} known={known}
                         periodId={periodId} periodLabel={periodLabel}
                         onCommitted={onCommitted}
                         picked={picked} onPicked={setPicked} />

      <Card title="Several at once, from a file"
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
                        // The SAME commit the single-employee form uses.
                        const r = await commitRatings(periodId!, preview.rows.map(x => x.row))
                        setBusy(false)
                        setResult(r)
                        if (!r.ok) return
                        const msg = r.text
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
