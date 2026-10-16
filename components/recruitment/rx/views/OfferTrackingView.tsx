'use client'

/**
 * OfferTrackingView — the redesigned look of the Offer Tracking stage
 * (tab key `offers`, component `OffersTab`).
 *
 * PRESENTATIONAL ONLY.
 *  - It reads nothing and writes nothing. markAccepted / markRevision /
 *    markBackout stay in `OffersTab` and still write exactly what they wrote;
 *    this view only calls them back.
 *  - It derives no offer state. The container's `offerState` is the single
 *    source, including its documented ordering subtlety.
 *
 * Two things this screen does NOT do, on purpose:
 *  - the five counts are read-outs, never filters. The screen has never
 *    filtered by them, and making them clickable would be new behaviour rather
 *    than a new look.
 *  - the reply actions still raise the browser's own prompt/confirm, because
 *    those carry the wording the writes depend on. Swapping them for a styled
 *    dialog changes an interaction, not a look.
 *
 * Styling reuses the `rxn-*` grammar of the Negotiation and Offer Approval
 * screens, so all three stages of one flow read alike.
 */

import { useState } from 'react'
import {
  otGroups,
  type OtCandidateVM,
  type OtCount,
  type OtGroup,
  type OtTone,
  type OtTrailStep,
} from '../logic/offerTrackingView'
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
  close: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  send: 'M4 12l16-7-6 16-3-7-7-2z',
  refresh: 'M5 12a7 7 0 0112-5l2 2M19 5v4h-4M19 12a7 7 0 01-12 5l-2-2M5 19v-4h4',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
  chevron: 'M6 9l6 6 6-6',
  info: 'M12 11v6M12 7.5v.5M12 21a9 9 0 100-18 9 9 0 000 18z',
}

/** Which `rxn-sect` tone class paints each group. */
const SECTION_TONE: Record<OtTone, string> = {
  brand: '',
  warn: 'warn',
  pos: 'review',
  crit: 'bad',
  mute: 'waiting',
}

const SECTION_ICON: Record<OtTone, string> = {
  brand: I.clock,
  warn: I.refresh,
  pos: I.check,
  crit: I.close,
  mute: I.doc,
}

/** Whose move it is, as the section's tag. */
const SECTION_WHOSE: Record<OtTone, string> = {
  brand: 'With the candidate',
  warn: 'With the HR Head',
  pos: 'Done',
  crit: 'Closed',
  mute: 'In Offer Letters',
}

export interface OtFilterSel {
  key: string
  label: string
  value: string
  options: { value: string; label: string }[]
}

export interface OfferTrackingViewProps {
  search: string
  onSearch: (value: string) => void

  /** The same four selects — company, department, location, position. */
  filters: OtFilterSel[]
  onFilter: (key: string, value: string) => void

  /** Read-outs. Deliberately not filters; see the note at the top. */
  counts: OtCount[]

  /** Already filtered by the container. */
  rows: OtCandidateVM[]
  /** Everyone at the offer stage, before the search and filters. */
  total: number

  selectedId: string | null
  onSelect: (id: string) => void

  onAccepted: (id: string) => void
  onRevision: (id: string) => void
  onBackout: (id: string) => void
}

interface CountsProps {
  counts: OtCount[]
}

/**
 * Static read-outs, so these are plain elements rather than buttons. A button
 * that does nothing when pressed is worse than a number.
 */
function Counts({ counts }: CountsProps) {
  return (
    <div className="rxn-tally ro">
      {counts.map((c) => (
        <div key={c.key} className="rxn-tally-i ro">
          <span className={c.count === 0 ? 'rxn-tally-n' : `rxn-tally-n ${c.tone}`}>{c.count}</span>
          <span className="rxn-tally-l">{c.label}</span>
        </div>
      ))}
    </div>
  )
}

interface ToolbarProps {
  search: string
  onSearch: (value: string) => void
  filters: OtFilterSel[]
  onFilter: (key: string, value: string) => void
  shown: number
  total: number
}

function Toolbar({ search, onSearch, filters, onFilter, shown, total }: ToolbarProps) {
  const [open, setOpen] = useState(false)
  const setCount = filters.filter((f) => f.value !== '').length
  const narrowed = search.trim() !== '' || setCount > 0
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
        </div>
      )}
    </div>
  )
}

interface TrailProps {
  steps: OtTrailStep[]
}

/** Two steps here, so the grid is told to be two wide. */
function Trail({ steps }: TrailProps) {
  return (
    <div className="rxn-trail two">
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
  c: OtCandidateVM
  selected: boolean
  onSelect: (id: string) => void
  onAccepted: (id: string) => void
  onRevision: (id: string) => void
  onBackout: (id: string) => void
}

/**
 * A plain element, not a button: the reply controls live inside it and a button
 * inside a button is invalid markup. The selected highlight therefore rides on
 * a data attribute rather than aria-pressed, which would need a button role.
 */
function Row({ c, selected, onSelect, onAccepted, onRevision, onBackout }: RowProps) {
  const where = c.mrfNumber === null ? c.stage : `${c.mrfNumber} · ${c.stage}`
  return (
    <div className="rxn-row flat" data-sel={selected} onClick={() => onSelect(c.id)}>
      <span className="rxn-row-who">
        <span className="rxn-av">{initialsOf(c.name)}</span>
        <span className="rxn-row-b">
          <span className="rxn-row-n">{c.name}</span>
          <span className="rxn-row-p">
            {c.currentCompany} · {c.expectedCtcLabel}
            <span className="rxn-row-x"> · {where}</span>
          </span>
        </span>
      </span>

      <span className="rxn-cell mrf" title={where}>
        {where}
        <span className="rxn-chips">
          {c.revised && <span className="rxn-chip warn sm">Revised</span>}
          {c.blacklisted && <span className="rxn-chip bad sm">Blacklisted</span>}
        </span>
      </span>

      <span className="rxn-cell tr">
        <Trail steps={c.trail} />
      </span>

      <span className="rxn-cell go">
        {c.canRecordReply ? (
          /* The three writes, unchanged. Click is stopped so recording a reply
             never doubles as selecting the row. */
          <span className="rxn-reply">
            <button type="button" className="rxn-btn ok sm" onClick={(e) => { e.stopPropagation(); onAccepted(c.id) }}>Accepted</button>
            <button type="button" className="rxn-btn warn sm" onClick={(e) => { e.stopPropagation(); onRevision(c.id) }}>Revision</button>
            <button type="button" className="rxn-btn danger sm" onClick={(e) => { e.stopPropagation(); onBackout(c.id) }}>Backout</button>
          </span>
        ) : c.state === 'accepted' ? (
          <span className="rxn-chip ok">Moved to Pre-onboarding</span>
        ) : c.state === 'revision' ? (
          <span className="rxn-chip warn">With the HR Head</span>
        ) : c.state === 'backout' ? (
          <span className="rxn-chip bad">Backed out</span>
        ) : (
          <span className="rxn-chip">Not sent</span>
        )}
      </span>
    </div>
  )
}

interface SectionProps {
  g: OtGroup
  closed: boolean
  onToggle: () => void
  selectedId: string | null
  onSelect: (id: string) => void
  onAccepted: (id: string) => void
  onRevision: (id: string) => void
  onBackout: (id: string) => void
}

function Section({ g, closed, onToggle, selectedId, onSelect, onAccepted, onRevision, onBackout }: SectionProps) {
  const tone = SECTION_TONE[g.tone]
  return (
    <section className={tone === '' ? 'rxn-sect ot' : `rxn-sect ot ${tone}`} aria-label={g.title}>
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
            <span className="go">Reply</span>
          </div>
          <div className="rxn-none oa-hint">{g.hint}</div>
          {g.rows.map((c) => (
            <Row
              key={c.id}
              c={c}
              selected={c.id === selectedId}
              onSelect={onSelect}
              onAccepted={onAccepted}
              onRevision={onRevision}
              onBackout={onBackout}
            />
          ))}
        </>
      )}
    </section>
  )
}

export default function OfferTrackingView(props: OfferTrackingViewProps) {
  const { search, onSearch, filters, onFilter, counts, rows, total, selectedId, onSelect, onAccepted, onRevision, onBackout } = props

  const [closed, setClosed] = useState<string[]>([])
  const toggle = (key: string) => setClosed((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))

  const groups = otGroups(rows)
  const narrowed = search.trim() !== '' || filters.some((f) => f.value !== '')

  return (
    <div className="rxn">
      {total > 0 && <Counts counts={counts} />}

      <Toolbar
        search={search}
        onSearch={onSearch}
        filters={filters}
        onFilter={onFilter}
        shown={rows.length}
        total={total}
      />

      {groups.length === 0 ? (
        <div className="rxn-empty">
          <div className="rxn-empty-dot brand">
            <Icon d={I.send} size={18} />
          </div>
          <div className="rxn-empty-t">{narrowed ? 'No matching candidate' : 'No offers at this stage yet'}</div>
          <div className="rxn-empty-s">
            {narrowed
              ? 'Clear a filter or the search to see more candidates.'
              : 'A candidate appears here once the HR Head approves their offer, or once a letter has been sent.'}
          </div>
        </div>
      ) : (
        <div className="rxn-list">
          {groups.map((g) => (
            <Section
              key={g.key}
              g={g}
              closed={closed.includes(g.key)}
              onToggle={() => toggle(g.key)}
              selectedId={selectedId}
              onSelect={onSelect}
              onAccepted={onAccepted}
              onRevision={onRevision}
              onBackout={onBackout}
            />
          ))}
        </div>
      )}

      {/* Where letters actually come from. This screen owns the reply, not the
          dispatch, and saying so here is the only thing that prevents someone
          hunting for a send button that was deliberately removed. */}
      <div className="rxn-alert">
        <Icon d={I.info} />
        <div className="rxn-alert-b">
          <span>
            Offer letters are drafted and sent from <b>Offer Letters</b>, where the body comes from the template in
            Admin Setup, prints onto the company&rsquo;s letterhead and goes out by email.
          </span>
          <span>
            Record the candidate&rsquo;s reply here once it arrives — <b>Accepted</b> moves them to Pre-onboarding,{' '}
            <b>Revision</b> sends the offer back to the HR Head and reopens the requisition, <b>Backout</b> rejects the
            candidate and reopens it for hiring.
          </span>
        </div>
      </div>
    </div>
  )
}
