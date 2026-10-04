'use client'

/**
 * NegotiationView — the redesigned look of the Negotiation stage
 * (tab key `negotiation`, component `NegotiationTab`).
 *
 * PRESENTATIONAL ONLY.
 *  - It does no salary arithmetic. Every figure is computed by `computeCtc()`
 *    and by the budget rule in `NegotiationTab`, and arrives through props.
 *  - It reads nothing and writes nothing: no Supabase, no fetch, no route.
 *  - It owns no negotiation state. `form`, `addItems`, `savedLink`, the
 *    selection and the sub-tab all stay in `NegotiationTab`.
 *
 * The only state held here is how the screen is being looked at: whether the
 * filter panel is open, which status group the list is narrowed to, and whether
 * the payslip shows monthly or annual.
 *
 * Conventions kept: no Tailwind, no hardcoded colours, stacking only through
 * theme variables, every sub-component defined outside its parent, JSX
 * comments above elements only. Styling is `rxn-*` classes from
 * `recruitment.negotiation.css`.
 */

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ADDITIONAL_FREQS,
  JOINING_FREQS,
  MIN_WAGE_SOURCE_LABEL,
  RETENTION_FREQS,
  formatInr,
  formatLakh,
  hasAmount,
  initialsOf,
  laneOf,
  linkStateLabel,
  nextStepLabel,
  rangePct,
  sharePct,
  type AddItem,
  type AddItemKey,
  type BreakdownVM,
  type BudgetInfo,
  type BudgetLine,
  type CompositionPart,
  type FieldValue,
  type Lane,
  type MinWageInfo,
  type NegCandidateVM,
  type NegFilter,
  type NegForm,
  type NegFormKey,
  type NegSubTab,
  type Option,
  type StatementRow,
  type StatementSection,
} from '../logic/negotiationView'

export interface CalculatorProps {
  /** `c.current_ctc`, or null when the container decides not to show it. */
  currentCtc: number | null
  /** The hike the container already computed, or null when it hides it. */
  hikePct: number | null
  /** The MRF budget, annualised by the existing rule. Null when the MRF has none. */
  budget: BudgetInfo | null

  form: NegForm
  onForm: (key: NegFormKey, value: FieldValue | boolean) => void

  /** True only when the candidate has no company. */
  needsCompany: boolean
  companyOptions: Option[]
  companyValue: string
  onCompany: (value: string) => void

  stateOptions: Option[]
  stateInherited: boolean
  stateHint: string
  categoryOptions: Option[]
  categoryInherited: boolean
  categoryHint: string

  /** The existing flags. The view never works these out itself. */
  ctcOverBudget: boolean
  ctcBelowBudget: boolean
  /** The existing line under Total CTC, with its wording unchanged. */
  budgetLine: BudgetLine | null

  minWage: MinWageInfo
  onOpenMinWages: () => void

  bonusRateOptions: Option[]
  bonusModeOptions: Option[]
  joiningFreqOptions?: Option[] | undefined
  retentionFreqOptions?: Option[] | undefined
  additionalFreqOptions?: Option[] | undefined

  addItems: AddItem[]
  onAddItem: () => void
  onRemoveItem: (index: number) => void
  onItem: (index: number, key: AddItemKey, value: FieldValue) => void

  extrasOpen: boolean
  onToggleExtras: () => void

  onRecalculate: () => void
  breakdown: BreakdownVM

  /** The label carries the reason when Save is blocked, exactly as today. */
  saveLabel: string
  saveDisabled: boolean
  onSave: () => void

  savedLink: string | null
  onCopyLink: () => void
  onEmailLink: () => void
  /** When set, Email is disabled and this is its `title`. */
  emailDisabledReason?: string | undefined

  onMoveToRejected: () => void
  onCloseCalculator: () => void

  /** The statement's existing Excel and PDF exports. The screen has carried
   *  both since before the redesign, so they are kept rather than dropped.
   *  Omit either and its button is not drawn. */
  onDownloadExcel?: (() => void) | undefined
  onPrintPdf?: (() => void) | undefined
}

export interface NegotiationViewProps {
  subTab: NegSubTab
  onSubTab: (tab: NegSubTab) => void
  counts: { checks: number; ctc: number }

  search: string
  onSearch: (value: string) => void
  filters: NegFilter[]
  onFilter: (key: string, value: string) => void

  /** The list for the current sub-tab, already filtered by the container. */
  candidates: NegCandidateVM[]
  selectedId: string | null
  onSelect: (id: string) => void

  /** Set when `calcOpen` is true: CTC sub-tab, a candidate picked, not a stipend. */
  calc?: CalculatorProps | null | undefined
  /** The existing `<StipendCalc />`, when `isStipend` is true. Drawn inside the new frame. */
  stipend?: ReactNode
  /** Close handler for the stipend frame. */
  onCloseStipend?: (() => void) | undefined
  /**
   * Optional. Told the candidate ids in the order the list is showing them
   * (after the quick filter and the sort), whenever that order changes. Use it
   * to give the drawer its previous / next candidate.
   */
  onVisibleOrder?: ((ids: string[]) => void) | undefined
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

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
  close: 'M6 6l12 12M18 6L6 18',
  lock: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 8v5M12 16.5v.5M10.3 4.2L2.8 17.5a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z',
  info: 'M12 11v6M12 7.5v.5M12 21a9 9 0 100-18 9 9 0 000 18z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  external: 'M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  chevron: 'M6 9l6 6 6-6',
  arrow: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  long: 'M4 12h15M13 6l6 6-6 6',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
  rupee: 'M7 5h10M7 9h10M7 9c5 0 6 5 0 5l7 6',
  pin: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-4-6-3-5 0M12 7c1.5-4 6-3 5 0',
  send: 'M4 12l16-7-6 16-3-7-7-2z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  table: 'M4 6h16v12H4zM4 10h16M10 6v12',
  refresh: 'M5 12a7 7 0 0112-5l2 2M19 5v4h-4M19 12a7 7 0 01-12 5l-2-2M5 19v-4h4',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
}

/* ------------------------------------------------------------------ */
/* The two steps                                                       */
/* ------------------------------------------------------------------ */

interface StepCardsProps {
  subTab: NegSubTab
  counts: { checks: number; ctc: number }
  onSubTab: (tab: NegSubTab) => void
}

const STEPS: { key: NegSubTab; n: string; when: string; label: string; flow: string[]; one: string; many: string }[] = [
  { key: 'checks', n: '1', when: 'Start here', label: 'Pre-negotiation Checks', flow: ['Send the link', 'Candidate uploads', 'You review'], one: 'candidate', many: 'candidates' },
  { key: 'ctc', n: '2', when: 'Once documents are in', label: 'CTC Negotiations', flow: ['Set the pay', 'Share the break-up', 'Candidate accepts'], one: 'in negotiation', many: 'in negotiation' },
]

/** The two sections of the stage, drawn as a numbered path so the order is obvious. */
function StepCards({ subTab, counts, onSubTab }: StepCardsProps) {
  return (
    <div className="rxn-steps" role="tablist" aria-label="Negotiation steps">
      {STEPS.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && (
            <span className="rxn-steps-link" aria-hidden="true">
              <Icon d={I.long} size={18} />
            </span>
          )}
          <button type="button" role="tab" className="rxn-step" aria-selected={subTab === s.key} onClick={() => onSubTab(s.key)}>
            <span className="rxn-step-n">{s.n}</span>
            <span className="rxn-step-b">
              <span className="rxn-step-k">
                Step {s.n} · {s.when}
              </span>
              <span className="rxn-step-t">{s.label}</span>
              <span className="rxn-step-f">
                {s.flow.map((f, j) => (
                  <span key={f} className="rxn-step-fi">
                    {j > 0 && <Icon d={I.arrow} size={12} />}
                    {f}
                  </span>
                ))}
              </span>
            </span>
            <span className="rxn-step-c">
              <b>{counts[s.key]}</b>
              <span>{counts[s.key] === 1 ? s.one : s.many}</span>
            </span>
          </button>
        </Fragment>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Finding people: quick filters, search, filters, sort                */
/* ------------------------------------------------------------------ */

const LANES: { key: Lane; label: string; whose: string; icon: string }[] = [
  { key: 'send', label: 'Send the link', whose: 'Your move', icon: I.send },
  { key: 'review', label: 'Ready to review', whose: 'Your move', icon: I.eye },
  { key: 'waiting', label: 'Waiting for the candidate', whose: 'Their move', icon: I.clock },
]

interface QuickDef {
  key: string
  label: string
  tone: string
}

const QUICK: Record<NegSubTab, QuickDef[]> = {
  checks: [
    { key: 'all', label: 'All', tone: '' },
    { key: 'send', label: 'To send', tone: 'send' },
    { key: 'review', label: 'To review', tone: 'review' },
    { key: 'waiting', label: 'Waiting', tone: 'waiting' },
    { key: 'expiring', label: 'Expiring in 24h', tone: 'warn' },
  ],
  ctc: [
    { key: 'all', label: 'All', tone: '' },
    { key: 'open', label: 'Not answered yet', tone: 'send' },
    { key: 'rejected', label: 'Offer rejected', tone: 'bad' },
    { key: 'revised', label: 'Revised offer', tone: 'warn' },
  ],
}

const SORTS: Record<NegSubTab, Option[]> = {
  checks: [
    { value: 'default', label: 'Sort: suggested order' },
    { value: 'name', label: 'Sort: name, A to Z' },
    { value: 'urgent', label: 'Sort: link expiring soonest' },
  ],
  ctc: [
    { value: 'default', label: 'Sort: suggested order' },
    { value: 'name', label: 'Sort: name, A to Z' },
  ],
}

/** Narrowing the list that is already on the screen. Nothing is fetched. */
function matchesQuick(c: NegCandidateVM, quick: string, subTab: NegSubTab): boolean {
  if (quick === 'all') return true
  if (subTab === 'checks') {
    if (quick === 'expiring') return c.linkState === 'ACTIVE' && c.hoursLeft !== null && c.hoursLeft <= 24
    return laneOf(c.linkState) === quick
  }
  if (quick === 'open') return c.response === null
  if (quick === 'rejected') return c.response === 'REJECTED'
  if (quick === 'revised') return c.revised
  return true
}

function sortRows(rows: NegCandidateVM[], sort: string): NegCandidateVM[] {
  if (sort === 'name') return [...rows].sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'urgent') {
    const hours = (c: NegCandidateVM) => (c.linkState === 'ACTIVE' && c.hoursLeft !== null ? c.hoursLeft : Number.MAX_SAFE_INTEGER)
    return [...rows].sort((a, b) => hours(a) - hours(b))
  }
  return rows
}

interface ListBarProps {
  subTab: NegSubTab
  /** False while a calculator is open: only search and the stage filters are offered then. */
  listTools: boolean
  candidates: NegCandidateVM[]
  quick: string
  onQuick: (key: string) => void
  sort: string
  onSort: (key: string) => void
  search: string
  onSearch: (value: string) => void
  filters: NegFilter[]
  onFilter: (key: string, value: string) => void
  shown: number
  total: number
}

function ListBar({ subTab, listTools, candidates, quick, onQuick, sort, onSort, search, onSearch, filters, onFilter, shown, total }: ListBarProps) {
  const [open, setOpen] = useState(false)
  const activeFilters = filters.filter((f) => f.value !== '')
  const narrowed = activeFilters.length > 0 || search.trim() !== '' || (listTools && quick !== 'all')
  const clearAll = () => {
    activeFilters.forEach((f) => onFilter(f.key, ''))
    if (search !== '') onSearch('')
    onQuick('all')
  }
  return (
    <div className="rxn-toolbar">
      <div className="rxn-toolbar-row">
        {listTools && (
          <div className="rxn-quick" role="radiogroup" aria-label="Show">
            {QUICK[subTab].map((d) => (
              <button key={d.key} type="button" role="radio" className={`rxn-quick-b ${d.tone}`} aria-checked={quick === d.key} onClick={() => onQuick(d.key)}>
                {d.tone !== '' && <span className="rxn-quick-d" />}
                {d.label} <span className="rxn-count">{candidates.filter((c) => matchesQuick(c, d.key, subTab)).length}</span>
              </button>
            ))}
          </div>
        )}
        <label className="rxn-search">
          <span className="rxn-sr">Search candidates</span>
          <Icon d={I.search} />
          <input className="rxn-input" type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search name or position" />
        </label>
        <button type="button" className="rxn-btn ghost rxn-ftoggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon d={I.filter} />
          Filters
          {activeFilters.length > 0 && <span className="rxn-count on">{activeFilters.length}</span>}
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
        {listTools && (
          <label className="rxn-fsel sort" data-on={sort !== 'default'}>
            <span className="rxn-sr">Sort the list</span>
            <select className="rxn-input" value={sort} onChange={(e) => onSort(e.target.value)}>
              {SORTS[subTab].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {narrowed && (
        <div className="rxn-active">
          {listTools && (
            <span className="rxn-active-n">
              Showing {shown} of {total}
            </span>
          )}
          {search.trim() !== '' && (
            <span className="rxn-chip brand removable">
              Search: {search.trim()}
              <button type="button" className="rxn-chip-x" aria-label="Clear the search" onClick={() => onSearch('')}>
                <Icon d={I.close} size={12} />
              </button>
            </span>
          )}
          {activeFilters.map((f) => (
            <span key={f.key} className="rxn-chip brand removable">
              {f.label}: {f.options.find((o) => o.value === f.value)?.label ?? f.value}
              <button type="button" className="rxn-chip-x" aria-label={`Remove the ${f.label} filter`} onClick={() => onFilter(f.key, '')}>
                <Icon d={I.close} size={12} />
              </button>
            </span>
          ))}
          <button type="button" className="rxn-btn ghost sm" onClick={clearAll}>
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Candidates: sections of rows for both steps, and the rail           */
/* ------------------------------------------------------------------ */

interface StatusChipsProps {
  c: NegCandidateVM
  showLink: boolean
}

function StatusChips({ c, showLink }: StatusChipsProps) {
  const linkTone = c.linkState === 'SUBMITTED' ? 'ok' : c.linkState === 'ACTIVE' ? 'info' : c.linkState === 'EXPIRED' ? 'bad' : ''
  const any = showLink || c.response !== null || c.revised || c.blacklisted
  if (!any) return null
  return (
    <span className="rxn-chips">
      {showLink && <span className={`rxn-chip ${linkTone}`}>{linkStateLabel(c.linkState, c.hoursLeft)}</span>}
      {c.response === 'ACCEPTED' && <span className="rxn-chip ok">Offer accepted</span>}
      {c.response === 'REJECTED' && <span className="rxn-chip bad">Offer rejected</span>}
      {c.revised && <span className="rxn-chip warn">Revised offer</span>}
      {c.blacklisted && <span className="rxn-chip bad">Blacklisted</span>}
    </span>
  )
}

interface MiniTrailProps {
  c: NegCandidateVM
}

/** Link sent, then documents in: two dots and the line between them. The chip beside it says the same in words. */
function MiniTrail({ c }: MiniTrailProps) {
  const sent = c.linkState !== 'NONE'
  const done = c.linkState === 'SUBMITTED'
  return (
    <span className="rxn-mini" data-bad={c.linkState === 'EXPIRED'} aria-hidden="true">
      <span className="rxn-mini-d" data-on={sent}>
        {sent && <Icon d={I.check} size={12} />}
      </span>
      <span className="rxn-mini-l" data-on={done} />
      <span className="rxn-mini-d" data-on={done}>
        {done && <Icon d={I.check} size={12} />}
      </span>
    </span>
  )
}

interface RowProps {
  c: NegCandidateVM
  subTab: NegSubTab
  active: boolean
  onSelect: (id: string) => void
}

function ListRow({ c, subTab, active, onSelect }: RowProps) {
  const role = `${c.mrfNumber} \u00B7 ${c.companyName}`
  const yours = subTab === 'ctc' || laneOf(c.linkState) !== 'waiting'
  return (
    <button type="button" className="rxn-row" aria-pressed={active} onClick={() => onSelect(c.id)}>
      <span className="rxn-row-who">
        <span className="rxn-av">{initialsOf(c.name)}</span>
        <span className="rxn-row-b">
          <span className="rxn-row-n">{c.name}</span>
          <span className="rxn-row-p">
            {c.position}
            <span className="rxn-row-x"> · {c.mrfNumber}</span>
          </span>
        </span>
      </span>
      <span className="rxn-cell mrf" title={role}>
        {role}
      </span>
      <span className="rxn-cell st">
        <MiniTrail c={c} />
        <StatusChips c={c} showLink />
      </span>
      <span className="rxn-cell em" title={c.email ?? undefined}>
        {c.email ?? 'No email on record'}
      </span>
      <span className="rxn-row-go" data-solid={yours}>
        {nextStepLabel(c.linkState, subTab)}
        <Icon d={I.arrow} size={14} />
      </span>
    </button>
  )
}

function RailItem({ c, subTab, active, onSelect }: RowProps) {
  return (
    <button type="button" className="rxn-rail-i" aria-pressed={active} title={`${c.name}, ${c.position}`} onClick={() => onSelect(c.id)}>
      <span className="rxn-av">{initialsOf(c.name)}</span>
      <span className="rxn-row-b">
        <span className="rxn-row-n">{c.name}</span>
        <span className="rxn-row-p">{c.position}</span>
        <StatusChips c={c} showLink={subTab === 'checks'} />
      </span>
    </button>
  )
}

interface SectionProps {
  tone: string
  icon: string
  title: string
  tag: string
  count: number
  closed: boolean
  onToggle: () => void
  children: ReactNode
}

function Section({ tone, icon, title, tag, count, closed, onToggle, children }: SectionProps) {
  return (
    <section className={`rxn-sect ${tone}`} aria-label={title}>
      <button type="button" className="rxn-sect-h" aria-expanded={!closed} title={closed ? 'Show this section' : 'Hide this section'} onClick={onToggle}>
        <span className="rxn-sect-i">
          <Icon d={icon} />
        </span>
        <span className="rxn-sect-t">{title}</span>
        <span className="rxn-sect-w">{tag}</span>
        <span className="rxn-sect-c">{count}</span>
        <span className="rxn-sect-v" data-closed={closed}>
          <Icon d={I.chevron} />
        </span>
      </button>
      {!closed && (
        <>
          <div className="rxn-thead" aria-hidden="true">
            <span>Candidate</span>
            <span className="mrf">MRF and company</span>
            <span className="st">Documents and status</span>
            <span className="em">Email</span>
            <span className="go">Next step</span>
          </div>
          {children}
        </>
      )}
    </section>
  )
}

interface CandidateListProps {
  rows: NegCandidateVM[]
  subTab: NegSubTab
  quick: string
  closed: string[]
  onToggle: (key: string) => void
  selectedId: string | null
  onSelect: (id: string) => void
}

function CandidateList({ rows, subTab, quick, closed, onToggle, selectedId, onSelect }: CandidateListProps) {
  if (rows.length === 0) {
    return <EmptyState title="Nobody matches" text="Clear a filter or the search to see more candidates." />
  }
  if (subTab === 'ctc') {
    return (
      <div className="rxn-list">
        <Section tone="send" icon={I.rupee} title="Ready for the salary discussion" tag="Your move" count={rows.length} closed={closed.includes('ctc')} onToggle={() => onToggle('ctc')}>
          {rows.map((c) => (
            <ListRow key={c.id} c={c} subTab={subTab} active={c.id === selectedId} onSelect={onSelect} />
          ))}
        </Section>
      </div>
    )
  }
  return (
    <div className="rxn-list">
      {LANES.map((l) => {
        const inLane = rows.filter((c) => laneOf(c.linkState) === l.key)
        // An empty section is shown only when the user asked for that one by name.
        if (inLane.length === 0 && quick !== l.key) return null
        return (
          <Section key={l.key} tone={l.key} icon={l.icon} title={l.label} tag={l.whose} count={inLane.length} closed={closed.includes(l.key)} onToggle={() => onToggle(l.key)}>
            {inLane.map((c) => (
              <ListRow key={c.id} c={c} subTab={subTab} active={c.id === selectedId} onSelect={onSelect} />
            ))}
            {inLane.length === 0 && <div className="rxn-none">Nobody here right now.</div>}
          </Section>
        )
      })}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  text: string
}

function EmptyState({ title, text }: EmptyStateProps) {
  return (
    <div className="rxn-empty">
      <div className="rxn-empty-dot">
        <Icon d={I.check} size={18} />
      </div>
      <div className="rxn-empty-t">{title}</div>
      <div className="rxn-empty-s">{text}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Small form pieces                                                   */
/* ------------------------------------------------------------------ */

interface SelectFieldProps {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  inherited?: boolean
  hint?: string | undefined
  title?: string | undefined
}

interface FieldLabelProps {
  label: string
  inherited: boolean
}

function FieldLabel({ label, inherited }: FieldLabelProps) {
  return (
    <span className="rxn-field-l">
      {label}
      {inherited && (
        <span className="rxn-lock" title="Inherited from the MRF">
          <Icon d={I.lock} size={12} />
          <span className="rxn-sr">Inherited from the MRF</span>
        </span>
      )}
    </span>
  )
}

function SelectField({ label, value, options, onChange, disabled = false, inherited = false, hint, title }: SelectFieldProps) {
  return (
    <label className="rxn-field">
      <FieldLabel label={label} inherited={inherited} />
      <select className="rxn-input" value={value} disabled={disabled} title={title} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint !== undefined && hint !== '' && <span className="rxn-hint">{hint}</span>}
    </label>
  )
}

/** A short option list as one segmented control; a long one falls back to a select. */
function PickField({ label, value, options, onChange, disabled = false, inherited = false, hint }: SelectFieldProps) {
  if (options.length > 5) return <SelectField label={label} value={value} options={options} onChange={onChange} disabled={disabled} inherited={inherited} hint={hint} />
  return (
    <div className="rxn-field">
      <FieldLabel label={label} inherited={inherited} />
      <div className="rxn-pick" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" className="rxn-pick-b" aria-checked={value === o.value} disabled={disabled && value !== o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint !== undefined && hint !== '' && <span className="rxn-hint">{hint}</span>}
    </div>
  )
}

interface MoneyFieldProps {
  label: string
  value: FieldValue
  onChange: (value: string) => void
  invalid?: boolean
  hint?: string | undefined
  /** `lg` is the one large field on the screen: Total CTC. */
  size?: 'md' | 'lg'
  /** Show the amount again with Indian digit grouping, so a long number is easy to read. */
  readout?: boolean
}

function MoneyField({ label, value, onChange, invalid = false, hint, size = 'md', readout = false }: MoneyFieldProps) {
  const grouped = readout && hasAmount(value) ? formatInr(Number(value)) : ''
  return (
    <label className="rxn-field">
      {label}
      <span className={grouped !== '' ? `rxn-money ${size} has-r` : `rxn-money ${size}`}>
        <span className="rxn-money-s">{'\u20B9'}</span>
        <input className="rxn-input" type="number" inputMode="numeric" min={0} value={value} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} />
        {grouped !== '' && (
          <span className="rxn-money-r" aria-hidden="true">
            {grouped}
          </span>
        )}
      </span>
      {hint !== undefined && hint !== '' && <span className="rxn-hint">{hint}</span>}
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* Calculator: the band                                                */
/* ------------------------------------------------------------------ */

interface DonutProps {
  parts: CompositionPart[]
}

const DONUT_R = 52
const DONUT_C = 2 * Math.PI * DONUT_R

/** A ring whose segments are sized from the amounts it is given. Display only. */
function Donut({ parts }: DonutProps) {
  const whole = parts.reduce((sum, p) => sum + (p.amount > 0 ? p.amount : 0), 0)
  let turned = 0
  return (
    <svg className="rxn-donut" viewBox="0 0 128 128" aria-hidden="true">
      <circle className="rxn-donut-bg" cx="64" cy="64" r={DONUT_R} />
      {whole > 0 &&
        parts.map((p) => {
          const share = sharePct(p.amount, whole) / 100
          const dash = Math.max(0, share * DONUT_C - 3)
          const offset = -turned * DONUT_C
          turned += share
          return <circle key={p.key} className={`rxn-donut-s ${p.tone}`} cx="64" cy="64" r={DONUT_R} strokeDasharray={`${dash} ${DONUT_C}`} strokeDashoffset={offset} />
        })}
    </svg>
  )
}

export interface CandNav {
  index: number
  total: number
  onPrev: (() => void) | null
  onNext: (() => void) | null
  onBack: (() => void) | null
}

interface NavButtonsProps {
  nav: CandNav
}

/** Back to the list, and step to the previous or next candidate without going back. */
function NavButtons({ nav }: NavButtonsProps) {
  return (
    <div className="rxn-nav">
      {nav.onBack !== null && (
        <button type="button" className="rxn-btn onband sm" onClick={nav.onBack}>
          <Icon d={I.back} size={14} />
          All candidates
        </button>
      )}
      <span className="rxn-nav-step">
        <button type="button" className="rxn-btn onband sm icon" aria-label="Previous candidate" disabled={nav.onPrev === null} onClick={nav.onPrev ?? undefined}>
          <Icon d={I.back} size={14} />
        </button>
        <span className="rxn-nav-n">
          {nav.index + 1} of {nav.total}
        </span>
        <button type="button" className="rxn-btn onband sm icon" aria-label="Next candidate" disabled={nav.onNext === null} onClick={nav.onNext ?? undefined}>
          <Icon d={I.arrow} size={14} />
        </button>
      </span>
    </div>
  )
}

interface BandHeadProps {
  candidate: NegCandidateVM
  nav: CandNav
  chips: ReactNode
  actions: ReactNode
}

function BandHead({ candidate, nav, chips, actions }: BandHeadProps) {
  return (
    <div className="rxn-band-top">
      <NavButtons nav={nav} />
      <div className="rxn-band-who">
        <div className="rxn-av on">{initialsOf(candidate.name)}</div>
        <div className="rxn-row-b">
          <h2 className="rxn-band-n">{candidate.name}</h2>
          <div className="rxn-band-m">
            {candidate.position} · {candidate.mrfNumber} · {candidate.companyName}
          </div>
        </div>
      </div>
      <div className="rxn-band-chips">{chips}</div>
      <div className="rxn-band-a">{actions}</div>
    </div>
  )
}

interface CockpitProps {
  candidate: NegCandidateVM
  calc: CalculatorProps
  nav: CandNav
}

function Cockpit({ candidate, calc, nav }: CockpitProps) {
  const { form, onForm, breakdown, budget } = calc
  const failed = breakdown.failure !== null
  const badCtc = calc.ctcOverBudget || calc.ctcBelowBudget
  const parts = breakdown.composition ?? []
  const hasRange = budget !== null && budget.max > budget.min
  const ctcNum = typeof form.ctc === 'number' ? form.ctc : Number(form.ctc)
  // How far along the track the filled part reaches. Presentation only.
  const fillPct = !hasRange || budget === null ? 0 : calc.ctcOverBudget ? 100 : calc.ctcBelowBudget ? 0 : rangePct(Number.isFinite(ctcNum) ? ctcNum : budget.min, budget.min, budget.max)
  return (
    <div className="rxn-band">
      <BandHead
        candidate={candidate}
        nav={nav}
        chips={
          <>
            {calc.currentCtc !== null && <span className="rxn-hchip">Current CTC {formatInr(calc.currentCtc)}</span>}
            {calc.hikePct !== null && <span className="rxn-hchip">Hike {Number(calc.hikePct.toFixed(1))}%</span>}
            {candidate.response === 'ACCEPTED' && <span className="rxn-hchip">Offer accepted</span>}
            {candidate.response === 'REJECTED' && <span className="rxn-hchip">Offer rejected</span>}
            {candidate.revised && <span className="rxn-hchip">Revised offer</span>}
          </>
        }
        actions={
          <>
            <button type="button" className="rxn-btn onband sm" onClick={calc.onMoveToRejected}>
              Move to Rejected
            </button>
          </>
        }
      />

      <div className="rxn-band-main">
        <div className="rxn-offer">
          <div className="rxn-offer-fields">
            <MoneyField label="Total CTC (annual)" value={form.ctc} invalid={badCtc} size="lg" readout onChange={(v) => onForm('ctc', v)} />
            <MoneyField label="Variable CTC (annual)" value={form.varAmt} size="lg" onChange={(v) => onForm('varAmt', v)} />
          </div>

          {hasRange && budget !== null && (
            <div className="rxn-slider">
              <span className="rxn-slider-e">{formatLakh(budget.min)}</span>
              <label className="rxn-slider-l">
                <span className="rxn-sr">Total CTC within the MRF budget</span>
                <input
                  type="range"
                  min={budget.min}
                  max={budget.max}
                  step={1000}
                  value={Number.isFinite(ctcNum) ? ctcNum : budget.min}
                  style={{ '--rxn-p': `${fillPct}%` } as CSSProperties}
                  onChange={(e) => onForm('ctc', e.target.value)}
                />
              </label>
              <span className="rxn-slider-e">{formatLakh(budget.max)}</span>
            </div>
          )}

          {calc.budgetLine !== null && (
            <div className="rxn-verdict-row">
              <span className={`rxn-verdict ${calc.budgetLine.tone}`} role={calc.budgetLine.tone === 'bad' ? 'alert' : undefined}>
                {calc.budgetLine.text}
              </span>
              {calc.ctcOverBudget && budget !== null && budget.max > 0 && (
                <button type="button" className="rxn-btn onband sm" onClick={() => onForm('ctc', String(budget.max))}>
                  Use MRF max
                </button>
              )}
              {calc.ctcBelowBudget && budget !== null && budget.min > 0 && (
                <button type="button" className="rxn-btn onband sm" onClick={() => onForm('ctc', String(budget.min))}>
                  Use MRF min
                </button>
              )}
            </div>
          )}
        </div>

        <div className="rxn-result">
          {failed ? (
            <div className="rxn-result-fail">
              <Icon d={I.alert} size={18} />
              <div className="rxn-result-k">Below the statutory minimum</div>
              <div className="rxn-hint">The payslip panel shows the amount needed.</div>
            </div>
          ) : (
            <>
              {parts.length > 0 && <Donut parts={parts} />}
              <div className="rxn-result-b">
                <div className="rxn-result-k">Monthly in-hand, before TDS</div>
                <div className="rxn-result-v">{formatInr(breakdown.inHandMonthly)}</div>
                {parts.length > 0 && (
                  <div className="rxn-legend">
                    {parts.map((p) => (
                      <span key={p.key} className="rxn-legend-i">
                        <span className={`rxn-legend-d ${p.tone}`} />
                        <span className="rxn-legend-l">{p.label}</span>
                        <b>{formatInr(p.amount)}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Calculator: rules and extras                                        */
/* ------------------------------------------------------------------ */

interface ExtrasChipsProps {
  form: NegForm
  addItems: AddItem[]
}

function ExtrasChips({ form, addItems }: ExtrasChipsProps) {
  const chips: string[] = []
  if (hasAmount(form.joining_bonus)) chips.push(`Joining bonus ${formatInr(Number(form.joining_bonus))}${form.joining_bonus_freq ? ` \u00B7 ${form.joining_bonus_freq}` : ''}`)
  if (hasAmount(form.retention_bonus)) chips.push(`Retention bonus ${formatInr(Number(form.retention_bonus))}${form.retention_bonus_freq ? ` \u00B7 ${form.retention_bonus_freq}` : ''}`)
  if (hasAmount(form.esop)) chips.push(`ESOP ${formatInr(Number(form.esop))}`)
  const extra = addItems.filter((a) => hasAmount(a.amount)).length
  if (extra > 0) chips.push(`${extra} additional ${extra === 1 ? 'amount' : 'amounts'}`)
  if (form.terms.trim() !== '') chips.push('Terms added')
  if (chips.length === 0) return <span className="rxn-hint">Nothing added yet.</span>
  return (
    <span className="rxn-chips wrap">
      {chips.map((c) => (
        <span key={c} className="rxn-chip brand">
          {c}
        </span>
      ))}
    </span>
  )
}

interface CalcOnlyProps {
  calc: CalculatorProps
}

function ExtrasBody({ calc }: CalcOnlyProps) {
  const { form, onForm } = calc
  const joinOn = hasAmount(form.joining_bonus)
  const retOn = hasAmount(form.retention_bonus)
  const addFreqs = calc.additionalFreqOptions ?? ADDITIONAL_FREQS
  return (
    <div className="rxn-extras-body">
      <div className="rxn-grid2">
        <MoneyField label="Joining bonus" value={form.joining_bonus} onChange={(v) => onForm('joining_bonus', v)} />
        <SelectField
          label="Paid"
          value={form.joining_bonus_freq}
          options={calc.joiningFreqOptions ?? JOINING_FREQS}
          disabled={!joinOn}
          title={joinOn ? undefined : 'Enter a joining bonus first'}
          onChange={(v) => onForm('joining_bonus_freq', v)}
        />
        <MoneyField label="Retention bonus" value={form.retention_bonus} onChange={(v) => onForm('retention_bonus', v)} />
        <SelectField
          label="Paid"
          value={form.retention_bonus_freq}
          options={calc.retentionFreqOptions ?? RETENTION_FREQS}
          disabled={!retOn}
          title={retOn ? undefined : 'Enter a retention bonus first'}
          onChange={(v) => onForm('retention_bonus_freq', v)}
        />
        <MoneyField label="ESOP value" value={form.esop} onChange={(v) => onForm('esop', v)} />
        <label className="rxn-field">
          ESOP plan / vesting
          <input className="rxn-input" type="text" value={form.esop_plan} onChange={(e) => onForm('esop_plan', e.target.value)} />
        </label>
      </div>

      <label className="rxn-field">
        Terms &amp; conditions
        <textarea className="rxn-input area" rows={2} value={form.terms} onChange={(e) => onForm('terms', e.target.value)} />
        <span className="rxn-hint">Shown on the salary link.</span>
      </label>

      <div className="rxn-block">
        <div className="rxn-sub">Additional amounts</div>
        {calc.addItems.map((item, i) => (
          <div key={i} className="rxn-additem">
            <label className="rxn-field">
              <span className="rxn-sr">Amount {i + 1}</span>
              <span className="rxn-money md">
                <span className="rxn-money-s">{'\u20B9'}</span>
                <input className="rxn-input" type="number" inputMode="numeric" min={0} value={item.amount} placeholder="Amount" onChange={(e) => calc.onItem(i, 'amount', e.target.value)} />
              </span>
            </label>
            <label className="rxn-field">
              <span className="rxn-sr">Frequency {i + 1}</span>
              <select className="rxn-input" value={item.freq} onChange={(e) => calc.onItem(i, 'freq', e.target.value)}>
                {addFreqs.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="rxn-field grow">
              <span className="rxn-sr">Remark {i + 1}</span>
              <input className="rxn-input" type="text" value={item.remark} placeholder="Remark" onChange={(e) => calc.onItem(i, 'remark', e.target.value)} />
            </label>
            <button type="button" className="rxn-btn ghost icon" aria-label={`Remove amount ${i + 1}`} onClick={() => calc.onRemoveItem(i)}>
              <Icon d={I.trash} size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="rxn-btn ghost sm start" onClick={calc.onAddItem}>
          <Icon d={I.plus} size={14} />
          Add amount
        </button>
      </div>
    </div>
  )
}

function RulesPanel({ calc }: CalcOnlyProps) {
  const { form, onForm } = calc
  return (
    <div className="rxn-card">
      {calc.needsCompany && (
        <div className="rxn-alert warn">
          <Icon d={I.alert} />
          <div className="rxn-alert-b">
            <b>This candidate has no company yet.</b>
            <SelectField label="Company" value={calc.companyValue} options={calc.companyOptions} onChange={calc.onCompany} />
          </div>
        </div>
      )}

      <section className="rxn-sec">
        <div className="rxn-sec-h">
          <span className="rxn-sec-t">
            <span className="rxn-sec-i">
              <Icon d={I.pin} />
            </span>
            Where and who
          </span>
        </div>
        <div className="rxn-grid2 lead">
          <SelectField
            label="State / UT"
            value={form.state}
            options={calc.stateOptions}
            disabled={calc.stateInherited}
            inherited={calc.stateInherited}
            hint={calc.stateHint}
            onChange={(v) => onForm('state', v)}
          />
          <PickField
            label="Worker category"
            value={form.category}
            options={calc.categoryOptions}
            disabled={calc.categoryInherited}
            inherited={calc.categoryInherited}
            hint={calc.categoryHint}
            onChange={(v) => onForm('category', v)}
          />
        </div>
        <div className="rxn-mw">
          <span className="rxn-mw-b">
            <span className="rxn-mw-k">Minimum wage floor</span>
            <span className="rxn-mw-v">{formatInr(calc.minWage.amount)} a month</span>
          </span>
          <span className={`rxn-chip ${calc.minWage.source === 'master' ? 'ok' : 'warn'}`}>{MIN_WAGE_SOURCE_LABEL[calc.minWage.source]}</span>
          <button type="button" className="rxn-btn ghost sm" onClick={calc.onOpenMinWages}>
            <Icon d={I.table} size={14} />
            View rates
          </button>
        </div>
      </section>

      <section className="rxn-sec">
        <div className="rxn-sec-h">
          <span className="rxn-sec-t">
            <span className="rxn-sec-i">
              <Icon d={I.shield} />
            </span>
            Statutory and benefit rules
          </span>
          <button type="button" className="rxn-btn ghost sm" title="Recalculate Breakdown" onClick={calc.onRecalculate}>
            <Icon d={I.refresh} size={14} />
            Recalculate
          </button>
        </div>
        <div className="rxn-grid2 rules">
          <div className="rxn-field">
            Gratuity
            <label className="rxn-switch">
              <input type="checkbox" checked={form.gratuity} onChange={(e) => onForm('gratuity', e.target.checked)} />
              <span className="rxn-switch-t" />
              <span>{form.gratuity ? 'Included' : 'Not included'}</span>
            </label>
          </div>
          <PickField label="Bonus mode" value={form.bonusMode} options={calc.bonusModeOptions} onChange={(v) => onForm('bonusMode', v)} />
        </div>
        <PickField label="Bonus rate" value={String(form.bonusPct)} options={calc.bonusRateOptions} onChange={(v) => onForm('bonusPct', v)} />
        <span className="rxn-hint">Bonus mode: With Salary puts the statutory bonus inside gross. Only in CTC keeps it as an employer cost. This changes gross and in-hand.</span>
      </section>

      <section className="rxn-sec">
        <div className="rxn-sec-h">
          <span className="rxn-sec-t">
            <span className="rxn-sec-i">
              <Icon d={I.gift} />
            </span>
            One-time payments and extras
          </span>
          <button type="button" className="rxn-btn ghost sm" aria-expanded={calc.extrasOpen} onClick={calc.onToggleExtras}>
            {calc.extrasOpen ? 'Hide' : 'Add or edit'}
            <Icon d={I.chevron} size={14} />
          </button>
        </div>
        <ExtrasChips form={form} addItems={calc.addItems} />
        {calc.extrasOpen && <ExtrasBody calc={calc} />}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Calculator: the payslip preview                                     */
/* ------------------------------------------------------------------ */

type Period = 'monthly' | 'annual'

function amountOf(row: StatementRow, period: Period): number | null {
  return period === 'monthly' ? row.monthly : row.annual
}

interface AmountProps {
  row: StatementRow
  period: Period
}

/** The figure for the chosen period. A line that only exists for the other period shows that one, labelled. */
function Amount({ row, period }: AmountProps) {
  const own = amountOf(row, period)
  if (own !== null) return <span className="rxn-ledger-v">{formatInr(own)}</span>
  const other = period === 'monthly' ? row.annual : row.monthly
  if (other === null) return <span className="rxn-ledger-v">{formatInr(null)}</span>
  return (
    <span className="rxn-ledger-v">
      {formatInr(other)}
      <span className="rxn-ledger-u">{period === 'monthly' ? '/yr' : '/mo'}</span>
    </span>
  )
}

interface LedgerProps {
  section: StatementSection
  period: Period
}

function Ledger({ section, period }: LedgerProps) {
  return (
    <div className={`rxn-ledger ${section.tone}`}>
      <div className="rxn-ledger-h">{section.title}</div>
      {section.rows.map((r) => (
        <div key={r.label} className="rxn-ledger-r">
          <span className="rxn-ledger-l">
            {r.label}
            {r.note !== undefined && r.note !== '' && <span className="rxn-ledger-n">{r.note}</span>}
          </span>
          <Amount row={r} period={period} />
        </div>
      ))}
      {section.total !== undefined && (
        <div className="rxn-ledger-r total">
          <span className="rxn-ledger-l">{section.total.label}</span>
          <Amount row={section.total} period={period} />
        </div>
      )}
    </div>
  )
}

interface ExportButtonsProps {
  onDownloadExcel?: (() => void) | undefined
  onPrintPdf?: (() => void) | undefined
  /** The statutory refusal has no statement to export, so they grey out
   *  rather than disappear -- the same as the old screen's disabled={!calc}. */
  disabled?: boolean
}

function ExportButtons({ onDownloadExcel, onPrintPdf, disabled = false }: ExportButtonsProps) {
  if (onDownloadExcel === undefined && onPrintPdf === undefined) return null
  return (
    <div className="rxn-pick" role="group" aria-label="Export the statement">
      {onDownloadExcel !== undefined && (
        <button type="button" className="rxn-btn ghost sm" disabled={disabled} onClick={onDownloadExcel}
          title={disabled ? 'Nothing to export yet' : 'Download the statement as an Excel workbook'}>
          <Icon d={I.table} /> Excel
        </button>
      )}
      {onPrintPdf !== undefined && (
        <button type="button" className="rxn-btn ghost sm" disabled={disabled} onClick={onPrintPdf}
          title={disabled ? 'Nothing to export yet' : 'Open a print view to save as PDF'}>
          <Icon d={I.doc} /> PDF
        </button>
      )}
    </div>
  )
}

interface PayslipPanelProps {
  breakdown: BreakdownVM
  onDownloadExcel?: (() => void) | undefined
  onPrintPdf?: (() => void) | undefined
}

function PayslipPanel({ breakdown, onDownloadExcel, onPrintPdf }: PayslipPanelProps) {
  const [period, setPeriod] = useState<Period>('monthly')

  if (breakdown.failure !== null) {
    const f = breakdown.failure
    return (
      <div className="rxn-card">
        <div className="rxn-sec-h">
          <span className="rxn-sec-t">
            <span className="rxn-sec-i">
              <Icon d={I.doc} />
            </span>
            Payslip preview
          </span>
          <ExportButtons onDownloadExcel={onDownloadExcel} onPrintPdf={onPrintPdf} disabled />
        </div>
        <div className="rxn-fail" role="alert">
          <div className="rxn-fail-t">
            <Icon d={I.alert} size={18} />
            This CTC is below the statutory minimum
          </div>
          <div className="rxn-fail-s">
            Fixed pay must be at least <b>{formatInr(f.minReqFixedAnn)}</b> a year for this state and category. It is {formatInr(f.fixedAnnual)} now.
          </div>
          <div className="rxn-hint">Basic for this floor is {formatInr(f.basic)} a month. Raise the Total CTC or lower the Variable CTC. Nothing is adjusted for you.</div>
        </div>
      </div>
    )
  }

  const pay = breakdown.sections.filter((s) => s.tone === 'earn' || s.tone === 'deduct')
  const net = breakdown.sections.filter((s) => s.tone === 'net')
  const rest = breakdown.sections.filter((s) => s.tone === 'employer' || s.tone === 'ctc')

  return (
    <div className="rxn-card">
      <div className="rxn-sec-h">
        <span className="rxn-sec-t">
            <span className="rxn-sec-i">
              <Icon d={I.doc} />
            </span>
            Payslip preview
          </span>
        <div className="rxn-pick">
          <div className="rxn-pick" role="radiogroup" aria-label="Show amounts">
            <button type="button" role="radio" className="rxn-pick-b" aria-checked={period === 'monthly'} onClick={() => setPeriod('monthly')}>
              Monthly
            </button>
            <button type="button" role="radio" className="rxn-pick-b" aria-checked={period === 'annual'} onClick={() => setPeriod('annual')}>
              Annual
            </button>
          </div>
          <ExportButtons onDownloadExcel={onDownloadExcel} onPrintPdf={onPrintPdf} />
        </div>
      </div>

      {breakdown.basicRule === 'minwage' && (
        <div className="rxn-alert info">
          <Icon d={I.info} />
          <div className="rxn-alert-b">
            <span>
              <b>Basic is set by the minimum wage.</b> The floor for this state and category is higher than 50% of fixed pay.
            </span>
          </div>
        </div>
      )}
      {breakdown.esicNearCeiling && (
        <div className="rxn-alert warn">
          <Icon d={I.alert} />
          <div className="rxn-alert-b">
            <span>
              <b>Close to the ESIC ceiling.</b> A small raise in Basic ends ESI cover for this candidate.
            </span>
          </div>
        </div>
      )}

      <div className="rxn-slip">
        <div className="rxn-slip-cols">
          {pay.map((s) => (
            <Ledger key={s.key} section={s} period={period} />
          ))}
        </div>
        {net.map((s) =>
          s.total !== undefined ? (
            <div key={s.key} className="rxn-net">
              <span className="rxn-net-l">
                {s.total.label}
                <span className="rxn-net-s">{period === 'monthly' ? 'per month' : 'per year'}</span>
              </span>
              <span className="rxn-net-v">{formatInr(amountOf(s.total, period))}</span>
            </div>
          ) : null,
        )}
        {rest.length > 0 && (
          <div className="rxn-slip-cols side">
            {rest.map((s) => (
              <Ledger key={s.key} section={s} period={period} />
            ))}
          </div>
        )}
      </div>

      <div className="rxn-hint">In-hand is before TDS. Professional tax and LWF are quoted so the offer is believable; payroll&apos;s own masters decide them at payout.</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Calculator: the save dock                                           */
/* ------------------------------------------------------------------ */

function SaveDock({ calc }: CalcOnlyProps) {
  const emailOff = calc.emailDisabledReason !== undefined && calc.emailDisabledReason !== ''
  const blocked = calc.saveDisabled
  return (
    <div className="rxn-dock">
      <div className="rxn-dock-row">
        <div className="rxn-dock-s" data-blocked={blocked}>
          <span className="rxn-dock-dot" />
          <span className="rxn-row-b">
            <span className="rxn-dock-t">{blocked ? calc.saveLabel : `Ready to save \u00B7 ${formatInr(calc.breakdown.inHandMonthly)} a month in hand, before TDS`}</span>
            <span className="rxn-hint">The candidate gets the break-up and one-time payments only. The link is valid 7 days.</span>
          </span>
        </div>
        <button type="button" className="rxn-btn ok" disabled={calc.saveDisabled} onClick={calc.onSave}>
          <Icon d={I.link} />
          {calc.saveLabel}
        </button>
      </div>
      {calc.savedLink !== null && (
        <div className="rxn-saved">
          <span className="rxn-saved-t">
            <Icon d={I.check} size={14} />
            Link ready
          </span>
          <label className="rxn-field grow">
            <span className="rxn-sr">Salary link</span>
            <input className="rxn-input mono" type="text" readOnly value={calc.savedLink} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <div className="rxn-saved-a">
            <button type="button" className="rxn-btn ghost sm" onClick={calc.onCopyLink}>
              <Icon d={I.copy} size={14} />
              Copy
            </button>
            <button type="button" className="rxn-btn ghost sm" disabled={emailOff} title={emailOff ? calc.emailDisabledReason : undefined} onClick={calc.onEmailLink}>
              <Icon d={I.mail} size={14} />
              Email
            </button>
            <a className="rxn-btn ghost sm" href={calc.savedLink} target="_blank" rel="noopener noreferrer">
              <Icon d={I.external} size={14} />
              Open
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

export default function NegotiationView(props: NegotiationViewProps) {
  const { subTab, onSubTab, counts, search, onSearch, filters, onFilter, candidates, selectedId, onSelect, calc, stipend, onCloseStipend, onVisibleOrder } = props

  // How the list is being looked at. None of this leaves the screen.
  const [quickBy, setQuickBy] = useState<Record<NegSubTab, string>>({ checks: 'all', ctc: 'all' })
  const [sortBy, setSortBy] = useState<Record<NegSubTab, string>>({ checks: 'default', ctc: 'default' })
  const [closed, setClosed] = useState<string[]>([])
  const quick = quickBy[subTab]
  const sort = sortBy[subTab]

  const selected = candidates.find((c) => c.id === selectedId) ?? null
  const hasCalc = subTab === 'ctc' && selected !== null && calc !== undefined && calc !== null
  const hasStipend = subTab === 'ctc' && selected !== null && !hasCalc && stipend !== undefined && stipend !== null
  const split = hasCalc || hasStipend

  const rows = sortRows(
    candidates.filter((c) => matchesQuick(c, quick, subTab)),
    sort,
  )

  // The order on screen: Step 1 goes section by section, Step 2 as sorted.
  const visible = subTab === 'checks' ? LANES.flatMap((l) => rows.filter((c) => laneOf(c.linkState) === l.key)) : rows
  const orderKey = visible.map((c) => c.id).join('|')
  const report = useRef(onVisibleOrder)
  useEffect(() => {
    report.current = onVisibleOrder
  }, [onVisibleOrder])
  useEffect(() => {
    report.current?.(orderKey === '' ? [] : orderKey.split('|'))
  }, [orderKey])

  const at = selected === null ? -1 : candidates.findIndex((c) => c.id === selected.id)
  const prevId = at > 0 ? (candidates[at - 1]?.id ?? null) : null
  const nextId = at >= 0 ? (candidates[at + 1]?.id ?? null) : null
  const back = hasCalc && calc !== undefined && calc !== null ? calc.onCloseCalculator : (onCloseStipend ?? null)
  const nav: CandNav = {
    index: at,
    total: candidates.length,
    onPrev: prevId === null ? null : () => onSelect(prevId),
    onNext: nextId === null ? null : () => onSelect(nextId),
    onBack: back,
  }

  return (
    <div className="rxn">
      <StepCards subTab={subTab} counts={counts} onSubTab={onSubTab} />
      <ListBar
        subTab={subTab}
        listTools={!split}
        candidates={candidates}
        quick={quick}
        onQuick={(key) => setQuickBy({ ...quickBy, [subTab]: key })}
        sort={sort}
        onSort={(key) => setSortBy({ ...sortBy, [subTab]: key })}
        search={search}
        onSearch={onSearch}
        filters={filters}
        onFilter={onFilter}
        shown={rows.length}
        total={counts[subTab]}
      />

      {!split && candidates.length === 0 && counts[subTab] === 0 && (
        <EmptyState
          title={subTab === 'checks' ? 'No documents to collect' : 'Nobody is ready for CTC yet'}
          text={subTab === 'checks' ? 'Shortlisted candidates appear here until their documents are in.' : 'A candidate moves here once their documents are submitted.'}
        />
      )}

      {!split && (candidates.length > 0 || counts[subTab] > 0) && (
        <CandidateList
          rows={rows}
          subTab={subTab}
          quick={quick}
          closed={closed}
          onToggle={(key) => setClosed(closed.includes(key) ? closed.filter((k) => k !== key) : [...closed, key])}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      )}

      {split && selected !== null && (
        <div className="rxn-work">
          <div className="rxn-rail" aria-label="Candidates">
            <div className="rxn-rail-h">
              {subTab === 'ctc' ? 'In negotiation' : 'Candidates'}
              <span className="rxn-count">{candidates.length}</span>
            </div>
            {candidates.map((c) => (
              <RailItem key={c.id} c={c} subTab={subTab} active={c.id === selectedId} onSelect={onSelect} />
            ))}
          </div>

          {hasCalc && calc !== undefined && calc !== null && (
            <div className="rxn-calc">
              <Cockpit candidate={selected} calc={calc} nav={nav} />
              <div className="rxn-panels">
                <RulesPanel calc={calc} />
                <PayslipPanel breakdown={calc.breakdown} onDownloadExcel={calc.onDownloadExcel} onPrintPdf={calc.onPrintPdf} />
              </div>
              <SaveDock calc={calc} />
            </div>
          )}

          {hasStipend && (
            <div className="rxn-calc">
              <div className="rxn-band">
                <BandHead candidate={selected} nav={nav} chips={<span className="rxn-hchip">Stipend, not a CTC structure</span>} actions={null} />
              </div>
              <div className="rxn-card">{stipend}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
