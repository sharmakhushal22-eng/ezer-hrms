'use client'

/**
 * OfferApprovalView — the look of the Offer Approval queue
 * (tab key `offerapproval`, component `OfferApprovalTab`).
 *
 * PRESENTATIONAL ONLY. Same contract as the file it replaces:
 *  - It reads nothing and writes nothing: no Supabase, no fetch, no route.
 *  - It decides nothing about eligibility. Who appears here (the candidate
 *    accepted their CTC and is not already sent/closed), whether a request may
 *    be re-created, and every filter stay in `OfferApprovalTab`.
 *  - The status sentences and status labels arrive from the container and are
 *    rendered with their wording untouched.
 *  - `OfferApprovalViewProps` is unchanged, field for field, so the container
 *    needs no edit. `../logic/offerApprovalView` is unchanged too.
 *
 * What this file changes is only how the same props are drawn:
 *  - a summary band that says how many requests are waiting on the recruiter,
 *    with one button that jumps to the most urgent of them (it sets the
 *    existing status filter, nothing else)
 *  - the status counters drawn as the request's journey (still the same
 *    status filter, still `onStatusFilter`), the recruiter's own marked
 *  - one card per candidate, with the action or the status in a stub on the
 *    right, so a long status label can no longer overlap the progress trail,
 *    and one plain line under it saying what happens next
 *  - a removable chip for each filter that is narrowing the list, and a way
 *    to clear them from the "no match" screen
 *  - QUICK FILTERS, a sort and "collapse all" that work only on the rows the
 *    container already sent: Needs me, Revised, Requisition, Stage. They hide
 *    or reorder cards on screen and tell the container nothing, so its
 *    counters keep showing its own numbers (see HANDOFF, section 0)
 *  - the counter strip stays in reach while the page scrolls
 *
 * Colour follows the EZER theme: blue alone means selected or actionable;
 * green, amber and red are state signals and nothing else.
 *
 * The only state held here is how the screen is being looked at: whether the
 * filter row is open on a narrow screen, which sections are collapsed, the
 * quick filters and the sort. It is lost when the view unmounts, by design.
 *
 * Styling is the `rxo-*` block. It needs only the theme tokens.
 *
 * Conventions kept: no Tailwind, no hardcoded colours, no stacking-order
 * declarations, every sub-component defined outside its parent, JSX comments
 * above elements only.
 */

import { Fragment, useState, type ReactNode } from 'react'
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
    <svg className={`rxo-ico s${size}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  stack: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  raise: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M12 12v6M9 15h6',
  mail: 'M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM3.5 7l8.5 6 8.5-6',
  back: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z',
  fold: 'M7 15l5 5 5-5M7 9l5-5 5 5',
  seal: 'M9 12.5l2 2 4-4.5M12 3l2.3 1.7 2.9-.1.9 2.7 2.3 1.7-.9 2.7.9 2.7-2.3 1.7-.9 2.7-2.9-.1L12 21l-2.3-1.7-2.9.1-.9-2.7-2.3-1.7.9-2.7-.9-2.7 2.3-1.7.9-2.7 2.9.1L12 3z',
}

/** The tone each group paints with. The values are the stylesheet's own. */
const SECTION_TONE: Record<OaTone, string> = {
  crit: 'crit',
  brand: 'brand',
  warn: 'warn',
  pos: 'pos',
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

/** A counter's tone, keyed by the status filter it applies. */
const FLOW_TONE: Record<string, string> = {
  '*': 'plain',
  NONE: 'brand',
  SUBMITTED: 'warn',
  HR_HEAD_APPROVED: 'pos',
  OFFER_SENT: 'pos',
  HR_HEAD_REJECTED: 'crit',
}

const FLOW_ICON: Record<string, string> = {
  '*': I.stack,
  NONE: I.raise,
  SUBMITTED: I.clock,
  HR_HEAD_APPROVED: I.seal,
  OFFER_SENT: I.mail,
  HR_HEAD_REJECTED: I.back,
}

/**
 * The four statuses a request passes through, in order. Two of them next to
 * each other in the strip get a chevron between them; anything else ("All",
 * "Sent back") is set apart with a rule, because it is not a step.
 */
const FLOW_STAGES: readonly string[] = ['NONE', 'SUBMITTED', 'HR_HEAD_APPROVED', 'OFFER_SENT']

/** The icon beside a row's status sentence and in its stub. */
const STATUS_ICON: Record<OaStatus, string> = {
  NONE: I.raise,
  SUBMITTED: I.clock,
  HR_HEAD_APPROVED: I.check,
  OFFER_SENT: I.mail,
  HR_HEAD_REJECTED: I.alert,
}

/**
 * What happens next, in one plain line under the action or the status.
 * Fixed wording per status; it repeats what the group heading already says,
 * so a card still explains itself once its heading has scrolled away.
 */
const NEXT_STEP: Record<OaStatus, string> = {
  NONE: 'Opens the request form',
  HR_HEAD_REJECTED: 'Fix the comment, then raise it again',
  SUBMITTED: 'Nothing for you to do yet',
  HR_HEAD_APPROVED: 'The letter goes out from Offer Letters',
  OFFER_SENT: 'Nothing left to do here',
}

/** The counters that are waiting on the recruiter. */
const YOUR_MOVE: readonly string[] = ['NONE', 'HR_HEAD_REJECTED']

/**
 * The quick filters. They exist only in this view: each one is a test on a
 * row the container already sent, so they can hide a card but can never show
 * one the container left out, and they change no query and no rule.
 */
interface Quick {
  /** Not raised or sent back: the two statuses that wait on the recruiter. */
  mine: boolean
  revised: boolean
  /** A requisition number, or '' for all. */
  mrf: string
  /** A pipeline stage, or '' for all. */
  stage: string
}

const QUICK_OFF: Quick = { mine: false, revised: false, mrf: '', stage: '' }

function passesQuick(c: OaCandidateVM, q: Quick): boolean {
  if (q.mine && !YOUR_MOVE.includes(c.status)) return false
  if (q.revised && !c.revised) return false
  if (q.mrf !== '' && c.mrfNumber !== q.mrf) return false
  if (q.stage !== '' && c.stage !== q.stage) return false
  return true
}

function quickCount(q: Quick): number {
  return (q.mine ? 1 : 0) + (q.revised ? 1 : 0) + (q.mrf !== '' ? 1 : 0) + (q.stage !== '' ? 1 : 0)
}

type SortKey = 'default' | 'name' | 'name-desc' | 'mrf'

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'default', label: 'Default order' },
  { value: 'name', label: 'Name, A to Z' },
  { value: 'name-desc', label: 'Name, Z to A' },
  { value: 'mrf', label: 'Requisition number' },
]

/** Reorders a copy. The groups keep their own order; this sorts inside them. */
function sortRows(rows: OaCandidateVM[], key: SortKey): OaCandidateVM[] {
  if (key === 'default') return rows
  const by = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  const out = [...rows]
  if (key === 'name') out.sort((a, b) => by(a.name, b.name))
  if (key === 'name-desc') out.sort((a, b) => by(b.name, a.name))
  if (key === 'mrf') out.sort((a, b) => by(a.mrfNumber ?? '', b.mrfNumber ?? '') || by(a.name, b.name))
  return out
}

/** Distinct values in first-seen order, with `keep` added if it has dropped out. */
function distinct(values: string[], keep: string): string[] {
  const out: string[] = []
  values.forEach((v) => {
    if (v !== '' && !out.includes(v)) out.push(v)
  })
  if (keep !== '' && !out.includes(keep)) out.push(keep)
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

interface HitProps {
  text: string
  term: string
}

/** Marks where the search term sits in a piece of text. Display only. */
function Hit({ text, term }: HitProps): ReactNode {
  const t = term.trim()
  if (t === '') return text
  const at = text.toLowerCase().indexOf(t.toLowerCase())
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className="rxo-hit">{text.slice(at, at + t.length)}</mark>
      {text.slice(at + t.length)}
    </>
  )
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

function countOf(counts: OaCount[], value: string): number | null {
  const hit = counts.find((c) => c.value === value)
  return hit === undefined ? null : hit.count
}

interface HeroCopy {
  title: string
  text: string
  /** Signed off (approved or sent) out of everyone here. Null hides the bar. */
  done: number | null
  all: number
  /** How many are waiting on the recruiter: not raised plus sent back. */
  yours: number
}

/**
 * The band's wording, read off the counters the container already passes.
 * Display only: it adds two counters together to say how many requests are
 * waiting on the recruiter, and never feeds anything back.
 */
function heroCopy(counts: OaCount[], total: number): HeroCopy {
  const back = countOf(counts, 'HR_HEAD_REJECTED')
  const raise = countOf(counts, 'NONE')
  const waiting = countOf(counts, 'SUBMITTED')
  const approved = countOf(counts, 'HR_HEAD_APPROVED')
  const sent = countOf(counts, 'OFFER_SENT')
  const all = countOf(counts, '*') ?? total
  const done = approved === null && sent === null ? null : (approved ?? 0) + (sent ?? 0)

  if (all === 0) {
    return {
      title: 'The queue is clear',
      text: 'Candidates arrive here from Negotiation, once they accept their salary.',
      done,
      all,
      yours: 0,
    }
  }
  if (back === null && raise === null) {
    return {
      title: all === 1 ? '1 candidate in offer approval' : `${all} candidates in offer approval`,
      text: 'Raise a request for each candidate who accepted their salary. The HR Head signs it off before the letter goes out.',
      done,
      all,
      yours: 0,
    }
  }

  const yours = (back ?? 0) + (raise ?? 0)
  const parts: string[] = []
  if (back !== null && back > 0) parts.push(`${back} sent back by the HR Head`)
  if (raise !== null && raise > 0) parts.push(`${raise} ready to raise`)
  if (waiting !== null && waiting > 0) parts.push(`${waiting} with the HR Head`)

  return {
    title: yours === 0 ? 'Nothing needs you right now' : yours === 1 ? '1 offer needs your move' : `${yours} offers need your move`,
    text: parts.length === 0 ? 'Every request here has been signed off.' : `${parts.join(', ')}.`,
    done,
    all,
    yours,
  }
}

interface HeroProps {
  counts: OaCount[]
  total: number
  /** Turns on the "Needs me" quick filter. Null once it is already on. */
  onShowMine: (() => void) | null
}

function Hero({ counts, total, onShowMine }: HeroProps) {
  const copy = heroCopy(counts, total)
  const pct = copy.done === null || copy.all === 0 ? 0 : Math.round((copy.done / copy.all) * 100)
  return (
    <div className="rxo-hero">
      <div className="rxo-hero-main">
        <h2 className="rxo-hero-t">{copy.title}</h2>
        <p className="rxo-hero-s">{copy.text}</p>
        {/* The headline's own shortcut: show exactly the ones it counted. */}
        {copy.yours > 0 && onShowMine !== null && (
          <div className="rxo-hero-a">
            <button type="button" className="rxo-btn on" onClick={onShowMine}>
              <Icon d={I.bolt} size={14} />
              {copy.yours === 1 ? 'Show only this one' : `Show only these ${copy.yours}`}
            </button>
          </div>
        )}
      </div>
      {copy.done !== null && copy.all > 0 && (
        <div className="rxo-hero-side">
          <div className="rxo-hero-row">
            <span>Signed off</span>
            <b>
              {copy.done} of {copy.all}
            </b>
          </div>
          <div className="rxo-prog" role="img" aria-label={`${copy.done} of ${copy.all} signed off`}>
            <div className="rxo-prog-f" style={{ width: `${pct}%` }} />
          </div>
          <span className="rxo-hero-c">Approved by the HR Head, or already sent.</span>
        </div>
      )}
    </div>
  )
}

interface FlowProps {
  counts: OaCount[]
  value: string
  onChange: (value: string) => void
  /** "Needs me" is on: no single status is chosen, two of them are lit. */
  mine: boolean
}

/**
 * The status counters, drawn as the journey a request takes. Each one is the
 * same filter button it always was: same `value`, same disabled rule.
 */
function Flow({ counts, value, onChange, mine }: FlowProps) {
  return (
    <div className="rxo-flow" role="group" aria-label="Filter by request status">
      {counts.map((c, i) => {
        const prev = i === 0 ? null : (counts[i - 1]?.value ?? null)
        const chained = prev !== null && FLOW_STAGES.includes(prev) && FLOW_STAGES.includes(c.value)
        return (
          <Fragment key={c.value}>
            {prev !== null &&
              (chained ? (
                <span className="rxo-flow-sep" aria-hidden="true">
                  <Icon d={I.arrow} size={14} />
                </span>
              ) : (
                <span className="rxo-flow-div" aria-hidden="true" />
              ))}
            <button
              type="button"
              className="rxo-flow-i"
              data-tone={FLOW_TONE[c.value] ?? 'plain'}
              aria-pressed={value === c.value && !(mine && c.value === '*')}
              data-on={mine && value === '*' && YOUR_MOVE.includes(c.value) && c.count > 0}
              disabled={c.count === 0 && c.value !== value}
              title={c.value === '*' ? 'Show everyone' : `Show only: ${c.label}`}
              onClick={() => onChange(c.value)}
            >
              <span className="rxo-flow-d">
                <Icon d={FLOW_ICON[c.value] ?? I.stack} />
              </span>
              <span className="rxo-flow-b">
                <span className="rxo-flow-top">
                  <span className="rxo-flow-n">{c.count}</span>
                  {c.count > 0 && YOUR_MOVE.includes(c.value) && <span className="rxo-flow-you">Your move</span>}
                </span>
                <span className="rxo-flow-l">{c.label}</span>
              </span>
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}

interface PillProps {
  text: string
  onClear: () => void
}

function Pill({ text, onClear }: PillProps) {
  return (
    <button type="button" className="rxo-pill" title={`Remove: ${text}`} onClick={onClear}>
      <span className="rxo-pill-t">{text}</span>
      <span className="rxo-pill-x">
        <Icon d={I.close} size={12} />
      </span>
    </button>
  )
}

interface DockProps {
  search: string
  onSearch: (value: string) => void
  filters: OaFilterSel[]
  onFilter: (key: string, value: string) => void
  shown: number
  total: number
  statusFilter: string
  /** The label of the status counter that is on, or null when it is "All". */
  statusLabel: string | null
  onStatusFilter: (value: string) => void
  onClearAll: () => void

  quick: Quick
  onQuick: (next: Quick) => void
  /** How many of the container's rows each quick chip would keep. */
  mineCount: number
  revisedCount: number
  mrfOptions: string[]
  stageOptions: string[]

  sort: SortKey
  onSort: (key: SortKey) => void
  /** Null when there is at most one group, so there is nothing to fold. */
  allClosed: boolean | null
  onToggleAll: () => void
}

/**
 * Everything that narrows or orders the list, in one panel:
 *  row 1  the container's search and four selects (unchanged)
 *  row 2  quick filters, sort and collapse (this view only)
 *  row 3  what is narrowing the list right now, each with its own remove
 */
function Dock(p: DockProps) {
  const [open, setOpen] = useState(false)
  const set = p.filters.filter((f) => f.value !== '')
  const term = p.search.trim()
  const active = (term !== '' ? 1 : 0) + set.length + (p.statusFilter !== '*' ? 1 : 0) + quickCount(p.quick)
  const q = p.quick

  return (
    <div className="rxo-dock">
      <div className="rxo-tools-row">
        <label className="rxo-search">
          <Icon d={I.search} size={14} />
          <span className="rxo-sr">Search candidates</span>
          <input
            className="rxo-input"
            type="search"
            value={p.search}
            placeholder="Search candidate…"
            onChange={(e) => p.onSearch(e.target.value)}
          />
        </label>
        {/* Only shown once the filter row has collapsed behind it. */}
        <button type="button" className="rxo-btn ghost rxo-ftoggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon d={I.filter} size={14} />
          Filters
          {set.length > 0 && <span className="rxo-badge">{set.length}</span>}
        </button>
        <div className={open ? 'rxo-frow open' : 'rxo-frow'}>
          {p.filters.map((f) => (
            <label key={f.key} className="rxo-fsel" data-on={f.value !== ''}>
              <span className="rxo-sr">{f.label}</span>
              <select className="rxo-input" value={f.value} onChange={(e) => p.onFilter(f.key, e.target.value)}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="rxo-quick">
        <span className="rxo-quick-k">
          <Icon d={I.bolt} size={14} />
          Quick filters
        </span>
        <button
          type="button"
          className="rxo-chip"
          aria-pressed={q.mine}
          disabled={p.mineCount === 0 && !q.mine}
          title="Not raised, or sent back to you"
          onClick={() => p.onQuick({ ...q, mine: !q.mine })}
        >
          Needs me
          <span className="rxo-chip-n">{p.mineCount}</span>
        </button>
        {(p.revisedCount > 0 || q.revised) && (
          <button
            type="button"
            className="rxo-chip"
            aria-pressed={q.revised}
            title="Candidates whose offer was revised"
            onClick={() => p.onQuick({ ...q, revised: !q.revised })}
          >
            Revised
            <span className="rxo-chip-n">{p.revisedCount}</span>
          </button>
        )}
        {/* A select appears only when it has something to choose between. */}
        {(p.mrfOptions.length > 1 || q.mrf !== '') && (
          <label className="rxo-mini" data-on={q.mrf !== ''}>
            <span>Requisition</span>
            <select className="rxo-input sm" value={q.mrf} onChange={(e) => p.onQuick({ ...q, mrf: e.target.value })}>
              <option value="">All</option>
              {p.mrfOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        {(p.stageOptions.length > 1 || q.stage !== '') && (
          <label className="rxo-mini" data-on={q.stage !== ''}>
            <span>Stage</span>
            <select className="rxo-input sm" value={q.stage} onChange={(e) => p.onQuick({ ...q, stage: e.target.value })}>
              <option value="">All</option>
              {p.stageOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="rxo-quick-gap" aria-hidden="true" />
        <label className="rxo-mini" data-on={p.sort !== 'default'}>
          <span>Sort</span>
          <select className="rxo-input sm" value={p.sort} onChange={(e) => p.onSort(SORTS.find((o) => o.value === e.target.value)?.value ?? 'default')}>
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {p.allClosed !== null && (
          <button type="button" className="rxo-btn ghost sm" onClick={p.onToggleAll}>
            <Icon d={I.fold} size={14} />
            {p.allClosed ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {active > 0 && (
        <div className="rxo-active">
          <span className="rxo-active-n">
            Showing {p.shown} of {p.total}
          </span>
          {term !== '' && <Pill text={`Search: ${term}`} onClear={() => p.onSearch('')} />}
          {set.map((f) => (
            <Pill
              key={f.key}
              text={`${f.label}: ${f.options.find((o) => o.value === f.value)?.label ?? f.value}`}
              onClear={() => p.onFilter(f.key, '')}
            />
          ))}
          {p.statusFilter !== '*' && <Pill text={`Status: ${p.statusLabel ?? p.statusFilter}`} onClear={() => p.onStatusFilter('*')} />}
          {q.mine && <Pill text="Needs me" onClear={() => p.onQuick({ ...q, mine: false })} />}
          {q.revised && <Pill text="Revised" onClear={() => p.onQuick({ ...q, revised: false })} />}
          {q.mrf !== '' && <Pill text={`Requisition: ${q.mrf}`} onClear={() => p.onQuick({ ...q, mrf: '' })} />}
          {q.stage !== '' && <Pill text={`Stage: ${q.stage}`} onClear={() => p.onQuick({ ...q, stage: '' })} />}
          {active > 1 && (
            <button type="button" className="rxo-link" onClick={p.onClearAll}>
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface TrackProps {
  steps: OaTrailStep[]
}

function Track({ steps }: TrackProps) {
  return (
    <div className="rxo-track">
      {steps.map((s) => (
        <div key={s.label} className="rxo-stop" data-state={s.state}>
          <span className="rxo-stop-d">
            {s.state === 'done' ? <Icon d={I.check} size={12} /> : null}
            {s.state === 'blocked' ? <Icon d={I.close} size={12} /> : null}
          </span>
          <span className="rxo-stop-t" title={s.label}>
            {s.label}
          </span>
          <span className="rxo-stop-s" title={s.note}>
            {s.note}
          </span>
        </div>
      ))}
    </div>
  )
}

interface CardProps {
  c: OaCandidateVM
  tone: string
  /** The search text, so the card can mark where it matched. */
  term: string
  onRaise: (id: string) => void
}

/**
 * A card is a plain element, not a button: it contains the "Create request"
 * control, and a button inside a button is invalid markup. Nothing else about
 * the card is clickable, so no affordance is lost.
 */
function Card({ c, tone, term, onRaise }: CardProps) {
  return (
    <article className={c.canRaise ? 'rxo-card act' : 'rxo-card'} data-tone={tone} aria-label={`${c.name}, ${c.role}`}>
      <div className="rxo-who">
        <span className="rxo-av" aria-hidden="true">
          {initialsOf(c.name)}
        </span>
        <div className="rxo-who-b">
          <span className="rxo-who-n" title={c.name}>
            <Hit text={c.name} term={term} />
          </span>
          <span className="rxo-who-r" title={c.role}>
            <Hit text={c.role} term={term} />
          </span>
          <div className="rxo-tags">
            {c.mrfNumber !== null && (
              <span className="rxo-tag">
                <Hit text={c.mrfNumber} term={term} />
              </span>
            )}
            <span className="rxo-tag">{c.stage}</span>
            {c.revised && <span className="rxo-tag warn">Revised</span>}
          </div>
        </div>
      </div>

      <Track steps={c.trail} />

      {/* The container's own sentence — who it sits with, when, and any
          comment. Its own line, so a long one is never squeezed into a cell. */}
      {c.status !== 'NONE' && (
        <div className="rxo-note">
          <Icon d={STATUS_ICON[c.status]} size={14} />
          <span className="rxo-note-t">{c.statusDetail}</span>
        </div>
      )}

      <div className="rxo-stub">
        {c.canRaise ? (
          <button type="button" className="rxo-btn p" onClick={() => onRaise(c.id)}>
            {c.raiseLabel}
            <Icon d={I.arrow} size={14} />
          </button>
        ) : (
          <span className="rxo-stub-t">
            <Icon d={STATUS_ICON[c.status]} size={14} />
            {c.statusLabel}
          </span>
        )}
        {/* No line for a not-raised candidate the container will not let
            through: there is nothing true to say about what happens next. */}
        {(c.canRaise || c.status !== 'NONE') && <span className="rxo-stub-s">{NEXT_STEP[c.status]}</span>}
      </div>
    </article>
  )
}

interface SectionProps {
  g: OaGroup
  term: string
  closed: boolean
  onToggle: () => void
  onRaise: (id: string) => void
}

function Section({ g, term, closed, onToggle, onRaise }: SectionProps) {
  const tone = SECTION_TONE[g.tone]
  return (
    <section className="rxo-sect" data-tone={tone} aria-label={g.title}>
      <button type="button" className="rxo-sect-h" aria-expanded={!closed} title={closed ? 'Show this section' : 'Hide this section'} onClick={onToggle}>
        <span className="rxo-sect-i">
          <Icon d={SECTION_ICON[g.tone]} />
        </span>
        <span className="rxo-sect-b">
          <span className="rxo-sect-top">
            <span className="rxo-sect-t">{g.title}</span>
            <span className="rxo-sect-w">{SECTION_WHOSE[g.tone]}</span>
          </span>
          {/* What the group means. It describes the cards, so it sits with
              the heading rather than as a strip above them. */}
          <span className="rxo-sect-s">{g.hint}</span>
        </span>
        <span className="rxo-sect-c">{g.rows.length === 1 ? '1 candidate' : `${g.rows.length} candidates`}</span>
        <span className="rxo-sect-v" data-closed={closed}>
          <Icon d={I.chevron} />
        </span>
      </button>
      {!closed && (
        <div className="rxo-cards">
          {g.rows.map((c) => (
            <Card key={c.id} c={c} tone={tone} term={term} onRaise={onRaise} />
          ))}
        </div>
      )}
    </section>
  )
}

interface EmptyStateProps {
  title: string
  text: string
  brand: boolean
  /** Given only when filters are what emptied the list. */
  onClear?: () => void
}

function EmptyState({ title, text, brand, onClear }: EmptyStateProps) {
  return (
    <div className="rxo-empty" data-tone={brand ? 'brand' : 'plain'}>
      <div className="rxo-empty-dot">
        <Icon d={brand ? I.send : I.search} size={22} />
      </div>
      <div className="rxo-empty-t">{title}</div>
      <div className="rxo-empty-s">{text}</div>
      {onClear !== undefined && (
        <button type="button" className="rxo-btn p" onClick={onClear}>
          Clear the search and filters
        </button>
      )}
    </div>
  )
}

export default function OfferApprovalView(props: OfferApprovalViewProps) {
  const { search, onSearch, filters, onFilter, counts, statusFilter, onStatusFilter, rows, total, onRaise } = props

  // Which sections are folded away. Never leaves the screen.
  const [closed, setClosed] = useState<string[]>([])
  const toggle = (key: string) => setClosed((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  // Quick filters and sort. View-only: the container is never told.
  const [quick, setQuick] = useState<Quick>(QUICK_OFF)
  const [sort, setSort] = useState<SortKey>('default')

  const visible = sortRows(
    rows.filter((r) => passesQuick(r, quick)),
    sort,
  )
  const groups = oaGroups(visible)
  const narrowed = search.trim() !== '' || statusFilter !== '*' || filters.some((f) => f.value !== '') || quickCount(quick) > 0
  const statusLabel = statusFilter === '*' ? null : (counts.find((c) => c.value === statusFilter)?.label ?? null)
  const allClosed = groups.length < 2 ? null : groups.every((g) => closed.includes(g.key))

  // The number on "Needs me" is the band's number: the container's two
  // counters, which do not shrink when a status is chosen. Counting `rows`
  // would read 0 whenever another status is on, and wrongly disable the chip.
  const backCount = countOf(counts, 'HR_HEAD_REJECTED')
  const raiseCount = countOf(counts, 'NONE')
  const mineCount =
    backCount === null && raiseCount === null ? rows.filter((r) => YOUR_MOVE.includes(r.status)).length : (backCount ?? 0) + (raiseCount ?? 0)

  // Undoes everything that is narrowing the list: the container's part
  // through the same three callbacks its controls use, then the view's own.
  const clearAll = () => {
    if (search !== '') onSearch('')
    filters.forEach((f) => {
      if (f.value !== '') onFilter(f.key, '')
    })
    if (statusFilter !== '*') onStatusFilter('*')
    setQuick(QUICK_OFF)
  }

  // A single status and "Needs me" (two statuses) cannot both hold, so
  // choosing one lets go of the other.
  const pickStatus = (value: string) => {
    if (quick.mine) setQuick({ ...quick, mine: false })
    onStatusFilter(value)
  }
  const applyQuick = (next: Quick) => {
    if (next.mine && !quick.mine && statusFilter !== '*') onStatusFilter('*')
    setQuick(next)
  }

  return (
    <div className="rxo">
      <Hero counts={counts} total={total} onShowMine={quick.mine && statusFilter === '*' ? null : () => applyQuick({ ...quick, mine: true })} />
      <Flow counts={counts} value={statusFilter} onChange={pickStatus} mine={quick.mine} />

      <Dock
        search={search}
        onSearch={onSearch}
        filters={filters}
        onFilter={onFilter}
        shown={visible.length}
        total={total}
        statusFilter={statusFilter}
        statusLabel={statusLabel}
        onStatusFilter={onStatusFilter}
        onClearAll={clearAll}
        quick={quick}
        onQuick={applyQuick}
        mineCount={mineCount}
        revisedCount={rows.filter((r) => r.revised).length}
        mrfOptions={distinct(
          rows.map((r) => r.mrfNumber ?? ''),
          quick.mrf,
        )}
        stageOptions={distinct(
          rows.map((r) => r.stage),
          quick.stage,
        )}
        sort={sort}
        onSort={setSort}
        allClosed={allClosed}
        onToggleAll={() => setClosed(allClosed === true ? [] : groups.map((g) => g.key))}
      />

      {groups.length === 0 ? (
        <EmptyState
          {...(narrowed ? { onClear: clearAll } : {})}
          brand={!narrowed}
          title={narrowed ? 'No matching candidate' : 'Nobody is waiting for sign-off'}
          text={
            narrowed
              ? 'Clear a filter or the search to see more candidates.'
              : 'A candidate appears here once they accept the salary link sent from Negotiation.'
          }
        />
      ) : (
        <div className="rxo-list">
          {groups.map((g) => (
            <Section key={g.key} g={g} term={search} closed={closed.includes(g.key)} onToggle={() => toggle(g.key)} onRaise={onRaise} />
          ))}
        </div>
      )}
    </div>
  )
}
