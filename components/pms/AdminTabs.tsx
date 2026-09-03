'use client'
// components/pms/AdminTabs.tsx — the HR Admin side of the PMS. Spec §6.
//
// Six tabs, named as the spec names them:
//   PMS Configuration · Policy Builder · Fill Status Tracker
//   Final Rating Upload · PIP Management · Reports & Export
//
// HR Admin is NOT a step in the approval chain. The chain runs
// Employee → RM L1 → RM L2 → finalised by RM/HOD per policy. This screen sits
// across all of it: configuring, chasing, correcting and reporting.
//
// THE ONE NON-NEGOTIABLE, restated where somebody might try to change it:
// the PMS is developmental. payout_linkage_enabled is pinned false by a CHECK
// constraint. No config surface here can turn it on, and none should try.
//
// Sub-components at module scope — inputs lose focus on every keystroke
// otherwise, a bug this codebase has already had once.

import { useState } from 'react'
import { C, F, W, S, R } from '@/lib/ui'
import { PERIODS_PER_YEAR, previewPeriods, resolvePolicy,
         type Frequency, type Policy } from '@/lib/pms/policy'
import { FLAG_LABEL, FLAG_MEANING, type Flag } from '@/lib/pms/employment'
import { TEMPLATE_COLUMNS, ERROR_TEXT } from '@/lib/pms/upload'
import { STATUS_LABEL, whatNext, type PipStatus } from '@/lib/pms/pip'

export type AdminTab =
  | 'config' | 'policies' | 'fill' | 'upload' | 'pip' | 'reports'

export const ADMIN_TABS: { k: AdminTab; label: string; blurb: string }[] = [
  { k: 'config',   label: 'Cycle setup',   blurb: 'Frequency, windows and the KRA rules everyone is held to' },
  { k: 'policies', label: 'Policies',      blurb: 'Different cycles for different groups, and who falls under which' },
  { k: 'fill',     label: 'Who has filled',blurb: 'Live status for everyone, and who to chase' },
  { k: 'upload',   label: 'Rating upload', blurb: 'Bulk override from an offline calibration' },
  { k: 'pip',      label: 'PIP',           blurb: 'Requests from managers, and the plans you have started' },
  { k: 'reports',  label: 'Reports',       blurb: 'The fourteen reports, and Excel export' },
]

// ── module scope ─────────────────────────────────────────────────────────

function Card({ title, sub, children, tone }: {
  title?: string; sub?: string; children: React.ReactNode; tone?: 'warn' | 'locked'
}) {
  const edge = tone === 'warn' ? `${C.warning}44` : tone === 'locked' ? C.line : C.line
  const fill = tone === 'warn' ? C.warningTint : tone === 'locked' ? C.sunken : C.surface
  return (
    <div style={{ background: fill, border: `1px solid ${edge}`, borderRadius: R.sm,
                  padding: `${S.md}px ${S.lg}px ${S.lg}px`, marginBottom: S.sm, minWidth: 0 }}>
      {title && (
        <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>{title}</div>
      )}
      {sub && <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3, marginBottom: S.md }}>{sub}</div>}
      {!sub && title && <div style={{ height: S.md }} />}
      {children}
    </div>
  )
}

function Rule({ k, v, why }: { k: string; v: string; why: string }) {
  return (
    <div style={{ display: 'grid', gap: 2, gridTemplateColumns: 'minmax(160px, 240px) 1fr',
                  alignItems: 'baseline' }}>
      <div style={{ fontSize: F.small, color: C.muted }}>{k}</div>
      <div>
        <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>{v}</div>
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{why}</div>
      </div>
    </div>
  )
}

function Table({ head, rows, empty }: {
  head: string[]; rows: (string | number | null)[][]; empty: string
}) {
  if (!rows.length) return <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>{empty}</div>
  return (
    <div style={{ overflowX: 'auto', minWidth: 0, maxWidth: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
        <thead>
          <tr>{head.map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '0 10px 8px', whiteSpace: 'nowrap',
                                 fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.08em',
                                 textTransform: 'uppercase', color: C.muted }}>{h}</th>))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
              {r.map((cell, j) => (
                <td key={j} style={{ padding: '9px 10px', fontSize: F.small,
                                     color: j === 0 ? C.ink : C.inkSoft,
                                     fontWeight: j === 0 ? W.semi : W.regular,
                                     whiteSpace: 'nowrap' }}>{cell ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The frequency picker, showing what it will actually create. A dropdown
 *  reading "Quarterly (4 periods)" does not tell anybody that Q1 runs April
 *  to June — and the periods generate the moment it is saved. */
function FrequencyPreview({ freq, onPick, fyStart }: {
  freq: Frequency; onPick: (f: Frequency) => void; fyStart: string
}) {
  const periods = previewPeriods(freq, fyStart)
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: S.md }}>
        {(Object.keys(PERIODS_PER_YEAR) as Frequency[]).map(f => {
          const on = f === freq
          return (
            <button key={f} type="button" onClick={() => onPick(f)} aria-pressed={on}
              style={{ cursor: 'pointer', fontFamily: 'inherit', padding: '8px 14px',
                       borderRadius: R.sm, fontSize: F.small, fontWeight: on ? W.bold : W.semi,
                       border: `1px solid ${on ? C.brand : C.line}`,
                       background: on ? C.brand : C.surface,
                       color: on ? C.onAccent : C.inkSoft }}>
              {f === 'MONTHLY' ? 'Every month' : f === 'QUARTERLY' ? 'Every three months'
                : f === 'HALF_YEARLY' ? 'Twice a year' : 'Once a year'}
              <span style={{ opacity: .8, marginLeft: 6 }}>· {PERIODS_PER_YEAR[f]}</span>
            </button>
          )
        })}
      </div>
      <Table head={['Period', 'Covers', 'Starts', 'Ends']}
             rows={periods.map(p => [p.code, p.label, p.start, p.end])}
             empty="Pick a financial-year start date to see the periods." />
      <div style={{ fontSize: F.micro, color: C.faint, marginTop: S.sm, lineHeight: 1.5 }}>
        Saving this calls pms_generate_periods(), which creates every period above along with its
        KRA, self-rating, review and finalise windows. Changing the frequency later regenerates them.
      </div>
    </>
  )
}

// ── the tabs ─────────────────────────────────────────────────────────────

function ConfigTab({ freq, setFreq, fyStart }: {
  freq: Frequency; setFreq: (f: Frequency) => void; fyStart: string
}) {
  return (
    <>
      <Card title="How often the cycle runs"
            sub="Choosing a frequency generates every period and its windows.">
        <FrequencyPreview freq={freq} onPick={setFreq} fyStart={fyStart} />
      </Card>

      <Card title="The rules every KRA set is held to"
            sub="Enforced by pms_validate_kras() in the database, not only by the screen.">
        <div style={{ display: 'grid', gap: 12 }}>
          <Rule k="KRAs per person" v="4 to 10"
                why="Fewer than four and a rating rests on too little; more than ten and nothing carries real weight." />
          <Rule k="Weightage must total" v="exactly 100"
                why="A set that does not add up cannot be submitted, so a manager can never approve one that is short." />
          <Rule k="Smallest weightage on one KRA" v="5"
                why="Stops a goal being added for appearances and then weighted to nothing." />
          <Rule k="Who writes them" v="the employee"
                why="They draft their own; the manager agrees them in the one-to-one before they lock." />
          <Rule k="One-to-one before locking" v="required"
                why="Both sides acknowledge it. Without that, pms_lock_kras() refuses and the weightage never locks." />
          <Rule k="Final review one-to-one" v="required before publishing"
                why="pms_finalise() blocks without it, so a result cannot reach somebody who was never spoken to." />
        </div>
      </Card>

      <Card title="Who is included" sub="Eligibility, and how leavers are treated.">
        <div style={{ display: 'grid', gap: 12 }}>
          {(['NEW_JOINER', 'NOTICE_PERIOD', 'EXITED'] as Flag[]).map(f => (
            <Rule key={f} k={FLAG_LABEL[f]} v={f === 'NEW_JOINER' ? 'Not rated' : 'Included and flagged'}
                  why={FLAG_MEANING[f]} />
          ))}
        </div>
      </Card>

      {/* The rule that must never move, stated where somebody would look to
          change it — not hidden in a migration comment. */}
      <Card tone="locked" title="Pay, increment and CTC linkage"
            sub="Locked off. This is not a setting.">
        <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.6, maxWidth: '72ch' }}>
          This module is developmental. A rating here changes nothing about anyone&apos;s salary,
          increment, variable pay or CTC, and additional benefits are recognition only — a
          certificate, a nomination, an award, never cash.
          <br /><br />
          The database pins it: <code style={{ background: C.sunken, padding: '1px 6px',
            borderRadius: 5, fontSize: F.micro }}>CHECK (payout_linkage_enabled = false)</code>.
          No screen, no admin and no API call can set it true — turning it on would take a
          migration that drops the constraint.
        </div>
      </Card>
    </>
  )
}

function PolicyTab({ policies }: { policies: Policy[] }) {
  return (
    <Card title="Policies running at once"
          sub="A company can run several. An employee is on exactly one.">
      <Table
        head={['Policy', 'Applies to', 'How often', 'KRAs', 'Finalised by']}
        rows={policies.map(p => [
          p.name,
          p.locationId ? `Location ${p.locationId}`
            : p.grades?.length ? `Grades ${p.grades.join(', ')}`
            : p.departmentId ? `Department ${p.departmentId}` : 'Everyone else',
          p.frequency === 'MONTHLY' ? 'Every month' : p.frequency === 'QUARTERLY' ? 'Every three months'
            : p.frequency === 'HALF_YEARLY' ? 'Twice a year' : 'Once a year',
          `${p.minKra}–${p.maxKra}`,
          p.whoCanFinalise.replace(/_/g, ' → ').replace('RM1', 'RM L1').replace('RM2', 'RM L2'),
        ])}
        empty="No policies yet. Everyone follows the default cycle until one is added." />
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: S.md, lineHeight: 1.6,
                    maxWidth: '74ch' }}>
        <strong style={{ color: C.ink }}>When two policies could both apply, the narrower one
        wins</strong> — location, then grade, then department, then everyone. Somebody in Sales at
        the Pune plant follows the Pune policy, not the Sales one. Two policies of the same
        narrowness claiming the same person is refused rather than guessed: it is a configuration
        mistake, and picking one silently would only surface when an appraisal routed to the wrong
        manager.
      </div>
    </Card>
  )
}

function UploadTab() {
  return (
    <>
      <Card title="Bulk rating upload"
            sub="For an offline calibration, or migrating ratings from an old system.">
        <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.6, maxWidth: '72ch' }}>
          Upload a file with these columns. Every row is checked before anything is written, and
          the whole file is rejected until every row is clean — a half-applied upload would leave
          some people on the system&apos;s rating and some on the spreadsheet&apos;s, with nothing
          on screen to say which.
        </div>
        <div style={{ marginTop: S.md, overflowX: 'auto' }}>
          <code style={{ fontSize: F.micro, color: C.inkSoft, whiteSpace: 'nowrap' }}>
            {TEMPLATE_COLUMNS.join(' · ')}
          </code>
        </div>
      </Card>

      <Card title="What will stop a file" sub="Each of these blocks the commit.">
        <div style={{ display: 'grid', gap: 10 }}>
          {(Object.keys(ERROR_TEXT) as (keyof typeof ERROR_TEXT)[]).map(k => (
            <div key={k} style={{ display: 'grid', gap: 2,
                                  gridTemplateColumns: 'minmax(150px, 210px) 1fr' }}>
              <code style={{ fontSize: F.micro, color: C.critical, fontWeight: W.semi }}>{k}</code>
              <div style={{ fontSize: F.small, color: C.inkSoft }}>{ERROR_TEXT[k]}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: S.md, lineHeight: 1.6,
                      maxWidth: '72ch' }}>
          A reason is required only where the uploaded rating actually differs from the computed
          one. Asking for one on an unchanged row would train people to type &quot;n/a&quot;, which
          is worse than not asking. Every changed row is written to
          <code style={{ fontSize: F.micro }}> pms_rating_upload_log</code> with who did it, when,
          and why.
        </div>
      </Card>
    </>
  )
}

function PipTab() {
  const STEPS: { n: number; who: string; what: string }[] = [
    { n: 1, who: 'Manager', what: 'Raises a request — dates, improvement areas, targets, how each is measured, support offered.' },
    { n: 2, who: 'HR Manager', what: 'Reviews it. Can adjust dates, drop an area, send it back or decline it.' },
    { n: 3, who: 'HR Manager', what: 'Initiates. The employee is notified and a review frequency is set.' },
    { n: 4, who: 'Employee', what: 'Acknowledges the plan, with an optional note of their own.' },
    { n: 5, who: 'Manager', what: 'Records each periodic review — improved, partial or no change, per area.' },
    { n: 6, who: 'HR Manager', what: 'Closes it: improved, extended, or referred for separation review.' },
  ]
  return (
    <>
      <Card title="How a PIP moves" sub="Six steps, and step 3 is the one that matters.">
        <div style={{ display: 'grid', gap: 12 }}>
          {STEPS.map(s => (
            <div key={s.n} style={{ display: 'flex', gap: S.md, alignItems: 'flex-start' }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                             display: 'grid', placeItems: 'center', fontSize: F.micro,
                             fontWeight: W.bold, background: C.sunken, color: C.inkSoft }}>{s.n}</span>
              <div>
                <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>{s.who}</div>
                <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.55 }}>{s.what}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card tone="warn" title="A manager cannot start a PIP"
            sub="They raise a request. HR initiates it.">
        <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.65, maxWidth: '74ch' }}>
          This is a legal position, not a procedural one. A PIP is the documentation trail. If a
          separation ever happens on performance grounds, this record is what answers a claim under
          the Industrial Disputes Act — documented targets, documented reviews and documented
          employee acknowledgement, all three. HR gatekeeping is what keeps that trail consistent
          enough to rely on.
        </div>
      </Card>

      <Card title="What each state is waiting for">
        <Table head={['State', 'Waiting on', 'What happens next']}
               rows={(Object.keys(STATUS_LABEL) as PipStatus[]).map(s => {
                 const n = whatNext({ status: s })
                 return [STATUS_LABEL[s], n.who ?? '—', n.what]
               })}
               empty="" />
      </Card>
    </>
  )
}

function ReportsTab() {
  const REPORTS = [
    'Employee-wise KRA detail', 'Fill status', 'Rating summary', 'Self vs manager gap',
    'KRA weightage compliance', 'One-to-one log', 'Exit and notice period',
    'Appreciation and benefits register', 'PIP register', 'Period-on-period trend',
    'Category analysis', 'Manager rating behaviour', 'Override and audit log',
    'Cycle completion',
  ]
  return (
    <Card title="Reports" sub="All fourteen, in the portal and as Excel.">
      <div style={{ display: 'grid', gap: 7,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {REPORTS.map((r, i) => (
          <div key={r} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
            <span style={{ fontSize: F.micro, color: C.faint, fontVariantNumeric: 'tabular-nums',
                           minWidth: 18 }}>{i + 1}</span>
            <span style={{ fontSize: F.small, color: C.inkSoft }}>{r}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: S.md, lineHeight: 1.6,
                    maxWidth: '72ch' }}>
        Each is scoped to what the reader may see: HR and Admin get every column, a manager gets
        their own team, an HOD their department, an employee only themselves.
      </div>
    </Card>
  )
}

export { ConfigTab, PolicyTab, UploadTab, PipTab, ReportsTab, Card as AdminCard, Table as AdminTable }
