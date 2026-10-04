'use client'

/**
 * OfferApprovalView — the redesigned look of the Offer Approval queue
 * (tab key `offerapproval`, component `OfferApprovalTab`).
 *
 * PRESENTATIONAL ONLY.
 *  - It reads nothing and writes nothing: no Supabase, no fetch, no route.
 *  - It decides nothing about eligibility. Who appears here (the candidate
 *    accepted their CTC and is not already sent/closed), whether a request may
 *    be re-created, and every filter stay in `OfferApprovalTab`.
 *  - The status sentences arrive as nodes with the container's own wording, so
 *    what a recruiter reads does not change.
 *
 * The only state held here is how the screen is being looked at: whether the
 * filter row is open on a narrow screen, and which sections are collapsed.
 *
 * Styling reuses the `rxn-*` block from the Negotiation stage rather than a
 * parallel set, so the two adjacent screens share one grammar. The additions
 * this screen needed — a counter band, the `now`/`blocked` trail states, a
 * critical section tone and a four-column grid — live in the same stylesheet.
 *
 * Conventions kept: no Tailwind, no hardcoded colours, stacking only through
 * theme variables, every sub-component defined outside its parent, JSX
 * comments above elements only.
 */

import { useState } from 'react'
import {
  oaGroups,
  type OaCandidateVM,
  type OaCount,
  type OaGroup,
  type OaStatus,
  type OaTone,
  type OaTrailStep,
} from '../logic/offerApprovalView'
import { initialsOf } from '../logic/negotiationView'

interface IconProps {
  d: string
  size?: number
}

function Icon({ d, size = 16 }: IconProps) {
  return (
    <svg className={`rxn-ico s${size}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const I = {
  search: 'M11 4a7 7 0 105.2 11.7L20 19.5M11 4a7 7 0 017 7',
  filter: 'M4 6h16M7 12h10M10 18h4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 8v5M12 16.5v.5M10.3 4.2L2.8 17.5a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  send: 'M4 12l16-7-6 16-3-7-7-2z',
  arrow: 'M9 6l6 6-6 6',
  chevron: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
}

/** Which `rxn-sect` tone class paints each group. */
const SECTION_TONE: Record<OaTone, string> = {
  crit: 'bad',
  brand: '',
  warn: 'waiting',
  pos: 'review',
}

const SECTION_ICON: Record<OaTone, string> = {
  crit: I.alert,
  brand: I.send,
  warn: I.clock,
  pos: I.check,
}

/** Whose move it is, as the section's tag. */
const SECTION_WHOSE: Record<OaTone, string> = {
  crit: 'Your move',
  brand: 'Your move',
  warn: 'With the HR Head',
  pos: 'Done',
}

/** The counter band's colour, keyed by the status filter it applies. */
const TALLY_TONE: Record<string, string> = {
  '*': 'brand',
  NONE: 'brand',
  SUBMITTED: 'warn',
  HR_HEAD_APPROVED: 'pos',
  OFFER_SENT: 'pos',
  HR_HEAD_REJECTED: 'bad',
}

/** The chip tone for a row's own status. */
const CHIP_TONE: Record<OaStatus, string> = {
  NONE: '',
  SUBMITTED: 'warn',
  HR_HEAD_APPROVED: 'ok',
  OFFER_SENT: 'ok',
  HR_HEAD_REJECTED: 'bad',
}

export interface OaFilterSel {
  key: string
  label: string
  value: string
  options: { value: string; label: string }[]
}

export interface OfferApprovalViewProps {
  search: string
  onSearch: (value: string) => void

  /** The four existing selects — company, department, location, position. */
  filters: OaFilterSel[]
  onFilter: (key: string, value: string) => void

  /** The request-status counters. `value` is the filter key the container uses. */
  counts: OaCount[]
  statusFilter: string
  onStatusFilter: (value: string) => void

  /** Already filtered and ordered by the container. */
  rows: OaCandidateVM[]
  /** Eligible candidates before the status filter, for the "showing" line. */
  total: number

  /** Opens the request form for this candidate — the container's `pick`. */
  onRaise: (id: string) => void
}

interface TallyProps {
  counts: OaCount[]
  value: string
  onChange: (value: string) => void
}

function Tally({ counts, value, onChange }: TallyProps) {
  return (
    <div className="rxn-tally" role="group" aria-label="Filter by request status">
      {counts.map((c) => (
        <button
          key={c.value}
          type="button"
          className="rxn-tally-i"
          aria-pressed={value === c.value}
          disabled={c.count === 0 && c.value !== value}
          onClick={() => onChange(c.value)}
        >
          <span className={`rxn-tally-n ${TALLY_TONE[c.value] ?? ''}`}>{c.count}</span>
          <span className="rxn-tally-l">{c.label}</span>
        </button>
      ))}
    </div>
  )
}

interface ToolbarProps {
  search: string
  onSearch: (value: string) => void
  filters: OaFilterSel[]
  onFilter: (key: string, value: string) => void
  shown: number
  total: number
  statusFilter: string
  onStatusFilter: (value: string) => void
}

function Toolbar({ search, onSearch, filters, onFilter, shown, total, statusFilter, onStatusFilter }: ToolbarProps) {
  const [open, setOpen] = useState(false)
  const setCount = filters.filter((f) => f.value !== '').length
  const narrowed = search.trim() !== '' || setCount > 0 || statusFilter !== '*'
  return (
    <div className="rxn-toolbar">
      <div className="rxn-toolbar-row">
        <label className="rxn-search">
          <Icon d={I.search} size={14} />
          <span className="rxn-sr">Search candidates</span>
          <input
            className="rxn-input"
            type="search"
            value={search}
            placeholder="Search candidate…"
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>
        {/* Only shown once the filter row has collapsed behind it. */}
        <button type="button" className="rxn-btn ghost rxn-ftoggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon d={I.filter} size={14} />
          Filters
          {setCount > 0 && <span className="rxn-chip brand sm">{setCount}</span>}
        </button>
      </div>

      <div className={open ? 'rxn-frow open' : 'rxn-frow'}>
        {filters.map((f) => (
          <label key={f.key} className="rxn-fsel" data-on={f.value !== ''}>
            <span className="rxn-sr">{f.label}</span>
            <select className="rxn-input" value={f.value} onChange={(e) => onFilter(f.key, e.target.value)}>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {narrowed && (
        <div className="rxn-active">
          <span className="rxn-active-n">
            Showing {shown} of {total}
          </span>
          {statusFilter !== '*' && (
            <button type="button" className="rxn-btn sm ghost" onClick={() => onStatusFilter('*')}>
              Clear the status filter
              <Icon d={I.close} size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface TrailProps {
  steps: OaTrailStep[]
}

function Trail({ steps }: TrailProps) {
  return (
    <div className="rxn-trail">
      {steps.map((s) => (
        <div key={s.label} className="rxn-trail-i" data-state={s.state} data-done={s.state === 'done'}>
          <span className="rxn-trail-d">
            {s.state === 'done' ? <Icon d={I.check} size={12} /> : null}
            {s.state === 'blocked' ? <Icon d={I.close} size={12} /> : null}
          </span>
          <span className="rxn-trail-t">{s.label}</span>
          <span className="rxn-trail-s">{s.note}</span>
        </div>
      ))}
    </div>
  )
}

interface RowProps {
  c: OaCandidateVM
  onRaise: (id: string) => void
}

/**
 * A row here is a plain element, not a button: it contains the "Create
 * request" control, and a button inside a button is invalid markup. Nothing
 * else about the row is clickable, so no affordance is lost.
 */
function Row({ c, onRaise }: RowProps) {
  const where = c.mrfNumber === null ? c.stage : `${c.mrfNumber} · ${c.stage}`
  return (
    <div className={c.status === 'NONE' ? 'rxn-row flat' : 'rxn-row flat has-note'}>
      <span className="rxn-row-who">
        <span className="rxn-av">{initialsOf(c.name)}</span>
        <span className="rxn-row-b">
          <span className="rxn-row-n">{c.name}</span>
          <span className="rxn-row-p">
            {c.role}
            <span className="rxn-row-x"> · {where}</span>
          </span>
        </span>
      </span>

      <span className="rxn-cell mrf" title={where}>
        {where}
        {c.revised && <span className="rxn-chip warn sm">Revised</span>}
      </span>

      <span className="rxn-cell tr">
        <Trail steps={c.trail} />
      </span>

      <span className="rxn-cell go">
        {c.canRaise ? (
          <button type="button" className="rxn-btn p sm" onClick={() => onRaise(c.id)}>
            {c.raiseLabel}
            <Icon d={I.arrow} size={13} />
          </button>
        ) : (
          <span className={`rxn-chip ${CHIP_TONE[c.status]}`}>{c.statusLabel}</span>
        )}
      </span>

      {/* The container's own sentence — who it sits with, when, and any
          comment. Spans the row so a long one is never squeezed into a cell. */}
      {c.status !== 'NONE' && <span className="rxn-cell note">{c.statusDetail}</span>}
    </div>
  )
}

interface SectionProps {
  g: OaGroup
  closed: boolean
  onToggle: () => void
  onRaise: (id: string) => void
}

function Section({ g, closed, onToggle, onRaise }: SectionProps) {
  const tone = SECTION_TONE[g.tone]
  return (
    <section className={tone === '' ? 'rxn-sect oa' : `rxn-sect oa ${tone}`} aria-label={g.title}>
      <button type="button" className="rxn-sect-h" aria-expanded={!closed} title={closed ? 'Show this section' : 'Hide this section'} onClick={onToggle}>
        <span className="rxn-sect-i">
          <Icon d={SECTION_ICON[g.tone]} />
        </span>
        <span className="rxn-sect-t">{g.title}</span>
        <span className="rxn-sect-w">{SECTION_WHOSE[g.tone]}</span>
        <span className="rxn-sect-c">{g.rows.length}</span>
        <span className="rxn-sect-v" data-closed={closed}>
          <Icon d={I.chevron} />
        </span>
      </button>
      {!closed && (
        <>
          <div className="rxn-thead" aria-hidden="true">
            <span>Candidate</span>
            <span className="mrf">MRF and stage</span>
            <span className="tr">Progress</span>
            <span className="go">Next step</span>
          </div>
          {/* The hint belongs under the column labels: it describes the rows,
              not the heading. */}
          <div className="rxn-none oa-hint">{g.hint}</div>
          {g.rows.map((c) => (
            <Row key={c.id} c={c} onRaise={onRaise} />
          ))}
        </>
      )}
    </section>
  )
}

interface EmptyStateProps {
  title: string
  text: string
  brand: boolean
}

function EmptyState({ title, text, brand }: EmptyStateProps) {
  return (
    <div className="rxn-empty">
      <div className={brand ? 'rxn-empty-dot brand' : 'rxn-empty-dot'}>
        <Icon d={brand ? I.send : I.check} size={18} />
      </div>
      <div className="rxn-empty-t">{title}</div>
      <div className="rxn-empty-s">{text}</div>
    </div>
  )
}

export default function OfferApprovalView(props: OfferApprovalViewProps) {
  const { search, onSearch, filters, onFilter, counts, statusFilter, onStatusFilter, rows, total, onRaise } = props

  // Which sections are folded away. Never leaves the screen.
  const [closed, setClosed] = useState<string[]>([])
  const toggle = (key: string) => setClosed((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  const groups = oaGroups(rows)
  const narrowed = search.trim() !== '' || statusFilter !== '*' || filters.some((f) => f.value !== '')

  return (
    <div className="rxn">
      <Tally counts={counts} value={statusFilter} onChange={onStatusFilter} />

      <Toolbar
        search={search}
        onSearch={onSearch}
        filters={filters}
        onFilter={onFilter}
        shown={rows.length}
        total={total}
        statusFilter={statusFilter}
        onStatusFilter={onStatusFilter}
      />

      {groups.length === 0 ? (
        <EmptyState
          brand={!narrowed}
          title={narrowed ? 'No matching candidate' : 'Nobody is waiting for sign-off'}
          text={
            narrowed
              ? 'Clear a filter or the search to see more candidates.'
              : 'A candidate appears here once they accept the salary link sent from Negotiation.'
          }
        />
      ) : (
        <div className="rxn-list">
          {groups.map((g) => (
            <Section key={g.key} g={g} closed={closed.includes(g.key)} onToggle={() => toggle(g.key)} onRaise={onRaise} />
          ))}
        </div>
      )}
    </div>
  )
}
