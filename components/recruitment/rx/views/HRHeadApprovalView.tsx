'use client'

/**
 * HRHeadApprovalView — the redesigned "MRF & Offer Approvals" screen (tab key
 * `hrhead`).
 *
 * PRESENTATIONAL ONLY. This file reads nothing and writes nothing: no Supabase,
 * no fetch, no route. `HRHeadApprovalDashboard` keeps its own loaders
 * (`loadMrfs`, the offer loader, the `/api/recruitment/offer-approval` GET) and
 * its own writes (`approveMrf`, `processApproval`) and passes them in as props.
 *
 * The Approve button is disabled until somebody is named, but that is a
 * convenience. The hand-off rule is still enforced in the writes themselves.
 *
 * Conventions kept: no Tailwind, no hardcoded colours, no raw stacking values, every
 * sub-component defined outside its parent, JSX comments above elements only.
 * All styling is `rxa-*` classes from `recruitment.approvals.css`.
 */

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  DEFAULT_PACK,
  budgetPosition,
  canApproveMrf,
  canApproveOffer,
  effectiveManager,
  formatDate,
  formatInr,
  formatLakh,
  formatPct,
  initialsOf,
  plural,
  toneOf,
  waitingDays,
  waitingLabel,
  type ApprovalSection,
  type ChainStepVM,
  type MrfApprovalVM,
  type OfferApprovalVM,
  type PackDoc,
  type PersonOption,
} from '../logic/approvals'

/** Return `false` when the write was refused; anything else counts as done. */
export type ActionResult = boolean | void | Promise<boolean | void>

export interface HRHeadApprovalViewProps {
  viewerName: string
  /** The viewer's employee id. Only used to label their own chain step. */
  viewerId?: string | null
  mrfs: MrfApprovalVM[]
  offers: OfferApprovalVM[]
  /** Keyed by company id. Exactly the `recruiters` map the GET returns. */
  recruitersByCompany: Record<string, PersonOption[]>
  /** Keyed by company id. Exactly the `managers` map the GET returns. */
  managersByCompany: Record<string, PersonOption[]>
  loading?: boolean
  /** The existing Rehire section, rendered unchanged inside the new frame. */
  rehire?: ReactNode
  rehireCount?: number
  initialSection?: ApprovalSection
  packDocs?: PackDoc[]
  onApproveMrf: (mrf: MrfApprovalVM, assigneeIds: string[]) => ActionResult
  /** Omit to hide the button. */
  onRejectMrf?: (mrf: MrfApprovalVM, comment: string) => ActionResult
  /** Omit to hide the button. A note is always required. */
  onReviseMrf?: (mrf: MrfApprovalVM, note: string) => ActionResult
  onApproveOffer: (offer: OfferApprovalVM, hrManagerId: string) => ActionResult
  /** Omit to hide the button. */
  onRejectOffer?: (offer: OfferApprovalVM, comment: string) => ActionResult
  /** Omit to hide the approval pack block. */
  onOpenPackDoc?: (offer: OfferApprovalVM, doc: PackDoc) => void
}

type Tone = 'ok' | 'warn' | 'bad'
type NoteMode = 'revise' | 'reject' | null

interface DoneEntry {
  id: string
  title: string
  sub: string
  status: 'Approved' | 'Sent back' | 'Rejected'
  tone: Tone
}

interface ToastState {
  text: string
  tone: Tone
}

interface Fact {
  k: string
  v: string
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function IconChevron() {
  return (
    <svg className="rxa-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg className="rxa-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function IconLock() {
  return (
    <svg className="rxa-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  )
}

function IconDoc() {
  return (
    <svg className="rxa-ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

interface HeroProps {
  waiting: number
  mrfCount: number
  offerCount: number
  cleared: number
  total: number
  viewerName: string
}

function Hero({ waiting, mrfCount, offerCount, cleared, total, viewerName }: HeroProps) {
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0
  return (
    <div className="rxa-hero">
      <div className="rxa-hero-main">
        <h1 className="rxa-hero-k">MRF &amp; Offer Approvals</h1>
        <div className="rxa-hero-t">
          {waiting === 0 ? 'All clear for now' : `${plural(waiting, 'approval', 'approvals')} waiting on you`}
        </div>
        <div className="rxa-hero-s">
          {plural(mrfCount, 'MRF', 'MRFs')} and {plural(offerCount, 'offer', 'offers')}. Choose who takes it forward, then approve.
        </div>
      </div>
      <div className="rxa-hero-side">
        <div className="rxa-hero-row">
          <span>
            {cleared} of {total} cleared this session
          </span>
          <span className="rxa-hero-who">{viewerName}</span>
        </div>
        <div className="rxa-prog" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Cleared this session">
          <div className="rxa-prog-f" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

interface SectionTabsProps {
  section: ApprovalSection
  counts: Record<ApprovalSection, number>
  onPick: (s: ApprovalSection) => void
}

const SECTION_LABELS: { key: ApprovalSection; label: string }[] = [
  { key: 'mrf', label: 'MRF approvals' },
  { key: 'offer', label: 'Offer approvals' },
  { key: 'rehire', label: 'Rehire' },
]

function SectionTabs({ section, counts, onPick }: SectionTabsProps) {
  return (
    <div className="rxa-seg">
      {SECTION_LABELS.map((t) => (
        <button key={t.key} type="button" className="rxa-seg-b" aria-pressed={section === t.key} onClick={() => onPick(t.key)}>
          {t.label}
          <span className="rxa-count" data-zero={counts[t.key] === 0}>
            {counts[t.key]}
          </span>
        </button>
      ))}
    </div>
  )
}

interface ToastBarProps {
  toast: ToastState
  onClose: () => void
}

function ToastBar({ toast, onClose }: ToastBarProps) {
  return (
    <div className={`rxa-toast ${toast.tone}`} role="status">
      <span>{toast.text}</span>
      <button type="button" className="rxa-btn link" onClick={onClose}>
        Dismiss
      </button>
    </div>
  )
}

interface EmptyStateProps {
  title: string
  text: string
}

function EmptyState({ title, text }: EmptyStateProps) {
  return (
    <div className="rxa-empty">
      <div className="rxa-empty-dot">
        <IconCheck />
      </div>
      <div className="rxa-empty-t">{title}</div>
      <div className="rxa-empty-s">{text}</div>
    </div>
  )
}

interface QueueRowProps {
  title: string
  line: string
  companyId: string
  companyCode: string
  days: number | null
  active: boolean
  onPick: () => void
}

function QueueRow({ title, line, companyId, companyCode, days, active, onPick }: QueueRowProps) {
  return (
    <button type="button" className="rxa-row" aria-pressed={active} onClick={onPick}>
      <span className="rxa-co" data-tone={toneOf(companyId)}>
        {companyCode}
      </span>
      <span className="rxa-row-body">
        <span className="rxa-row-t">{title}</span>
        <span className="rxa-row-l">{line}</span>
        <span className="rxa-row-a" data-late={days !== null && days >= 2} suppressHydrationWarning>
          {waitingLabel(days)}
        </span>
      </span>
      <IconChevron />
    </button>
  )
}

interface FactGridProps {
  items: Fact[]
  small?: boolean
}

function FactGrid({ items, small = false }: FactGridProps) {
  return (
    <div className="rxa-facts">
      {items.map((f) => (
        <div key={f.k} className="rxa-fact">
          <div className="rxa-fact-k">{f.k}</div>
          <div className={small ? 'rxa-fact-v sm' : 'rxa-fact-v'}>{f.v}</div>
        </div>
      ))}
    </div>
  )
}

function roleLabel(role: string): string {
  if (role === 'HR_HEAD') return 'HR Head'
  return role.replace(/_/g, ' ')
}

function stepState(step: ChainStepVM): { cls: string; label: string; when: string } {
  switch (step.status) {
    case 'APPROVED':
      return { cls: 'ok', label: 'Approved', when: formatDate(step.actedAt, true) }
    case 'PENDING':
      return { cls: 'now', label: 'Pending', when: 'Waiting for a decision' }
    case 'REJECTED':
      return { cls: 'bad', label: 'Rejected', when: formatDate(step.actedAt, true) }
    case 'REVISION':
      return { cls: 'warn', label: 'Sent back', when: formatDate(step.actedAt, true) }
    default:
      return { cls: '', label: 'Not their turn yet', when: '' }
  }
}

interface ChainStepsProps {
  steps: ChainStepVM[]
  viewerId: string | null
}

function ChainSteps({ steps, viewerId }: ChainStepsProps) {
  if (steps.length === 0) return null
  return (
    <div className="rxa-block">
      <div className="rxa-sub">Approvals so far</div>
      <div className="rxa-chain">
        {steps.map((s) => {
          const st = stepState(s)
          const mine = s.status === 'PENDING' && viewerId !== null && s.approverId === viewerId
          return (
            <div key={s.order} className={`rxa-step ${st.cls}`}>
              <div className="rxa-step-dot">{s.status === 'APPROVED' ? <IconCheck /> : s.order}</div>
              <div className="rxa-step-body">
                <div className="rxa-step-n">{mine ? `${s.approverName} (you)` : s.approverName}</div>
                <div className="rxa-step-r">
                  {roleLabel(s.role)}, {mine ? 'your turn' : st.label.toLowerCase()}
                </div>
                {st.when !== '' && (
                  <div className="rxa-step-w" suppressHydrationWarning>
                    {st.when}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface PersonGridProps {
  people: PersonOption[]
  selectedIds: string[]
  onToggle: (id: string) => void
  emptyText: string
}

function PersonGrid({ people, selectedIds, onToggle, emptyText }: PersonGridProps) {
  if (people.length === 0) return <div className="rxa-hint">{emptyText}</div>
  return (
    <div className="rxa-people">
      {people.map((p) => {
        const on = selectedIds.includes(p.id)
        return (
          <button key={p.id} type="button" className="rxa-person" aria-pressed={on} onClick={() => onToggle(p.id)}>
            <span className="rxa-av" data-tone={toneOf(p.id)}>
              {initialsOf(p.name)}
            </span>
            <span className="rxa-person-body">
              <span className="rxa-person-n">{p.name}</span>
              <span className="rxa-person-c">{p.code}</span>
            </span>
            <span className="rxa-tick">{on ? <IconCheck /> : null}</span>
          </button>
        )
      })}
    </div>
  )
}

interface HandOffProps {
  done: boolean
  title: string
  note: string
  children: ReactNode
}

function HandOff({ done, title, note, children }: HandOffProps) {
  return (
    <div className={done ? 'rxa-hand ok' : 'rxa-hand'}>
      <div className="rxa-hand-h">
        <div className="rxa-hand-n">{done ? <IconCheck /> : 1}</div>
        <div className="rxa-hand-body">
          <div className="rxa-hand-t">{title}</div>
          <div className="rxa-hand-s">{note}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

function urgencyTone(urgency: string): string {
  const u = urgency.toLowerCase()
  if (u === 'high' || u === 'urgent' || u === 'critical') return 'bad'
  if (u === 'medium') return 'warn'
  return ''
}

/* ------------------------------------------------------------------ */
/* The two review panels                                               */
/* ------------------------------------------------------------------ */

interface MrfPanelProps {
  mrf: MrfApprovalVM
  viewerId: string | null
  more: boolean
  onToggleMore: () => void
  recruiters: PersonOption[]
  selectedIds: string[]
  onToggle: (id: string) => void
  pq: string
  onPq: (e: ChangeEvent<HTMLInputElement>) => void
}

function MrfPanel({ mrf, viewerId, more, onToggleMore, recruiters, selectedIds, onToggle, pq, onPq }: MrfPanelProps) {
  const who = mrf.raiserCode !== '' ? `${mrf.raiserName} (${mrf.raiserCode})` : mrf.raiserName
  const needle = pq.trim().toLowerCase()
  const shown = needle === '' ? recruiters : recruiters.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(needle))
  const facts: Fact[] = [
    { k: 'Openings', v: String(mrf.openings) },
    { k: 'Budget per year', v: `${formatLakh(mrf.budgetMin)} to ${formatLakh(mrf.budgetMax)}` },
    { k: 'Experience', v: mrf.experience },
    { k: 'Grade', v: mrf.grade },
  ]
  const extra: Fact[] = [
    { k: 'Department', v: mrf.department },
    { k: 'Employment type', v: mrf.employmentType },
    { k: 'Work mode', v: mrf.workMode },
  ]
  return (
    <div className="rxa-card">
      <div className="rxa-head">
        <div className="rxa-head-body">
          <h2 className="rxa-h2">{mrf.designation}</h2>
          <div className="rxa-meta">
            {mrf.mrfNumber} · {mrf.mrfType} · {mrf.companyName}
          </div>
        </div>
        <span className={`rxa-badge ${urgencyTone(mrf.urgency)}`}>{mrf.urgency} urgency</span>
      </div>

      <p className="rxa-sum">
        {who} needs {plural(mrf.openings, 'person', 'people')} as {mrf.designation} in {mrf.department}, {mrf.location}.
      </p>

      <FactGrid items={facts} />

      {more && (
        <div className="rxa-block">
          <FactGrid items={extra} small />
          {mrf.skills.length > 0 && (
            <div className="rxa-block">
              <div className="rxa-sub">Must-have skills</div>
              <div className="rxa-skills">
                {mrf.skills.map((s) => (
                  <span key={s} className="rxa-skill">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <button type="button" className="rxa-btn ghost start" aria-expanded={more} onClick={onToggleMore}>
        {more ? 'Hide details' : 'Show all details'}
      </button>

      <ChainSteps steps={mrf.chain} viewerId={viewerId} />

      <HandOff
        done={canApproveMrf(selectedIds)}
        title="Choose who will run this hiring"
        note={`Hiring Managers / Recruiters of ${mrf.companyName}. Tap to select, you can pick more than one.`}
      >
        <label className="rxa-field">
          Search by name or employee code
          <input className="rxa-input" type="search" value={pq} onChange={onPq} placeholder="Name or employee code" />
        </label>
        <PersonGrid
          people={shown}
          selectedIds={selectedIds}
          onToggle={onToggle}
          emptyText={recruiters.length === 0 ? 'No Hiring Manager / Recruiter is set up for this company yet.' : 'Nobody matches that search.'}
        />
      </HandOff>
    </div>
  )
}

interface OfferPanelProps {
  offer: OfferApprovalVM
  more: boolean
  onToggleMore: () => void
  reveal: boolean
  onToggleReveal: () => void
  managers: PersonOption[]
  chosen: string | null
  onChoose: (id: string) => void
  packDocs: PackDoc[]
  onOpenDoc?: ((doc: PackDoc) => void) | undefined
}

const MASK = '\u2022\u2022\u2022\u2022\u2022\u2022'

function yesNo(v: boolean | null): string {
  if (v === null) return '\u2014'
  return v ? 'Yes' : 'No'
}

function OfferPanel({ offer, more, onToggleMore, reveal, onToggleReveal, managers, chosen, onChoose, packDocs, onOpenDoc }: OfferPanelProps) {
  const budget = budgetPosition(offer.offeredCtc, offer.budgetMin, offer.budgetMax)
  const only = managers.length === 1
  const money: Fact[] = [
    { k: 'Fixed per year', v: formatInr(offer.offeredFixed) },
    { k: 'Variable per year', v: formatInr(offer.offeredVariable) },
    { k: 'Monthly in-hand', v: formatInr(offer.monthlyInhand) },
  ]
  const extra: Fact[] = [
    { k: 'Monthly gross', v: formatInr(offer.monthlyGross) },
    { k: 'Variable share', v: formatPct(offer.offeredVariablePct) },
    { k: 'Days to join', v: offer.daysToJoin === null ? '\u2014' : plural(offer.daysToJoin, 'day', 'days') },
    { k: 'Notice period', v: offer.noticePeriodDays === null ? '\u2014' : plural(offer.noticePeriodDays, 'day', 'days') },
    { k: 'Notice buyout', v: yesNo(offer.noticeBuyout) },
    { k: 'Documents', v: offer.documentsCount === null ? '\u2014' : `${offer.documentsCount} submitted` },
    { k: 'BGV status', v: offer.bgvStatus ?? '\u2014' },
  ]
  const prev: Fact[] = [
    { k: 'Company', v: reveal ? offer.prevCompanyName ?? '\u2014' : MASK },
    { k: 'Total CTC', v: reveal ? formatInr(offer.prevTotalCtc) : MASK },
    { k: 'Fixed CTC', v: reveal ? formatInr(offer.prevFixedCtc) : MASK },
  ]
  return (
    <div className="rxa-card">
      <div className="rxa-head">
        <div className="rxa-head-who">
          <div className="rxa-av lg" data-tone={0}>
            {initialsOf(offer.candidateName)}
          </div>
          <div className="rxa-head-body">
            <h2 className="rxa-h2">{offer.candidateName}</h2>
            <div className="rxa-meta">
              {offer.designation} · {offer.companyName} · {offer.mrfNumber}
            </div>
          </div>
        </div>
        <span className="rxa-badge ok">Candidate accepted the break-up</span>
      </div>

      <p className="rxa-sum" suppressHydrationWarning>
        {offer.candidateName} accepted {formatInr(offer.offeredCtc)} a year
        {offer.hikePct !== null ? `, ${formatPct(offer.hikePct)} above the previous CTC` : ''}. Proposed joining date is{' '}
        {formatDate(offer.proposedDoj)}. Raised by {offer.recruiterName}.
      </p>

      <div className="rxa-money">
        <div className="rxa-ctc">
          <div className="rxa-ctc-k">Offered annual CTC</div>
          <div className="rxa-ctc-v">{formatInr(offer.offeredCtc)}</div>
          {offer.hikePct !== null && <div className="rxa-ctc-s">{formatPct(offer.hikePct)} hike over previous CTC</div>}
        </div>
        <FactGrid items={money} />
      </div>

      {budget.state !== 'unknown' && (
        <div className="rxa-block">
          <div className="rxa-budget-h">
            <div className="rxa-sub">Where it sits in the MRF&apos;s approved budget</div>
            <div className={budget.state === 'inside' ? 'rxa-budget-s ok' : 'rxa-budget-s bad'}>
              {budget.state === 'inside' ? 'Inside range' : budget.state === 'below' ? 'Below range' : 'Above range'}
            </div>
          </div>
          <div className="rxa-budget-track">
            <div className="rxa-budget-fill" style={{ width: `${budget.pct}%` }} />
            <div className="rxa-budget-pin" style={{ left: `${budget.pct}%` }} />
          </div>
          <div className="rxa-budget-ends">
            <span>Min {formatLakh(offer.budgetMin)}</span>
            <span>Max {formatLakh(offer.budgetMax)}</span>
          </div>
        </div>
      )}

      <div className="rxa-prev">
        <div className="rxa-prev-h">
          <div className="rxa-prev-t">
            <IconLock />
            Previous employer, confidential
          </div>
          <button type="button" className="rxa-btn ghost" aria-pressed={reveal} onClick={onToggleReveal}>
            {reveal ? 'Hide figures' : 'Show figures'}
          </button>
        </div>
        <div className="rxa-prev-grid">
          {prev.map((f) => (
            <div key={f.k}>
              <div className="rxa-fact-k">{f.k}</div>
              <div className="rxa-fact-v sm">{f.v}</div>
            </div>
          ))}
        </div>
      </div>

      {onOpenDoc !== undefined && (
        <div className="rxa-block">
          <div className="rxa-sub">Approval pack</div>
          <div className="rxa-pack">
            {packDocs.map((d) => (
              <button key={d.key} type="button" className="rxa-doc" onClick={() => onOpenDoc(d)}>
                <span className="rxa-doc-i">
                  <IconDoc />
                </span>
                <span className="rxa-person-body">
                  <span className="rxa-person-n">{d.label}</span>
                  <span className="rxa-person-c">{d.note}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {more && <FactGrid items={extra} small />}
      <button type="button" className="rxa-btn ghost start" aria-expanded={more} onClick={onToggleMore}>
        {more ? 'Hide details' : 'Show all details'}
      </button>

      <HandOff
        done={canApproveOffer(chosen)}
        title="Choose the HR Manager who will issue the letter"
        note={
          only
            ? `Only one HR Manager in ${offer.companyName}, selected for you. Tap to change.`
            : `HR Managers of ${offer.companyName}. Tap one to select.`
        }
      >
        <PersonGrid
          people={managers}
          selectedIds={chosen === null ? [] : [chosen]}
          onToggle={onChoose}
          emptyText="No HR Manager is set up for this company yet."
        />
      </HandOff>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Note panel and action bar                                           */
/* ------------------------------------------------------------------ */

interface NotePanelProps {
  mode: 'revise' | 'reject'
  note: string
  busy: boolean
  onNote: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onConfirm: () => void
  onCancel: () => void
}

function NotePanel({ mode, note, busy, onNote, onConfirm, onCancel }: NotePanelProps) {
  const revise = mode === 'revise'
  const blocked = busy || (revise && note.trim().length === 0)
  return (
    <div className={revise ? 'rxa-note revise' : 'rxa-note reject'}>
      <label className="rxa-note-l">
        {revise ? 'What should the raiser change?' : 'Why are you rejecting this?'}
        <textarea
          className="rxa-input area"
          rows={3}
          value={note}
          onChange={onNote}
          placeholder={revise ? 'A note is needed to send it back' : 'Optional comment for the record'}
        />
      </label>
      <div className="rxa-note-a">
        <button type="button" className={revise ? 'rxa-btn p' : 'rxa-btn danger solid'} disabled={blocked} onClick={onConfirm}>
          {revise ? 'Send back to raiser' : 'Confirm rejection'}
        </button>
        <button type="button" className="rxa-btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <span className="rxa-hint">{revise ? 'The approval chain restarts when they resubmit.' : 'This closes the request as rejected.'}</span>
      </div>
    </div>
  )
}

interface ActionBarProps {
  ready: boolean
  busy: boolean
  hint: string
  approveLabel: string
  onApprove: () => void
  onReject?: (() => void) | undefined
  onRevise?: (() => void) | undefined
}

function ActionBar({ ready, busy, hint, approveLabel, onApprove, onReject, onRevise }: ActionBarProps) {
  return (
    <div className="rxa-bar">
      <div className="rxa-bar-s" data-ready={ready}>
        <span className="rxa-bar-dot" />
        <span>{hint}</span>
      </div>
      <div className="rxa-bar-a">
        {onReject !== undefined && (
          <button type="button" className="rxa-btn danger" disabled={busy} onClick={onReject}>
            Reject
          </button>
        )}
        {onRevise !== undefined && (
          <button type="button" className="rxa-btn ghost" disabled={busy} onClick={onRevise}>
            Send back
          </button>
        )}
        <button type="button" className="rxa-btn ok" disabled={!ready || busy} onClick={onApprove}>
          {busy ? 'Saving' : approveLabel}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

export default function HRHeadApprovalView(props: HRHeadApprovalViewProps) {
  const {
    viewerName,
    viewerId = null,
    mrfs,
    offers,
    recruitersByCompany,
    managersByCompany,
    loading = false,
    rehire,
    rehireCount = 0,
    initialSection = 'mrf',
    packDocs = DEFAULT_PACK,
    onApproveMrf,
    onRejectMrf,
    onReviseMrf,
    onApproveOffer,
    onRejectOffer,
    onOpenPackDoc,
  } = props

  const [section, setSection] = useState<ApprovalSection>(initialSection)
  const [q, setQ] = useState('')
  const [company, setCompany] = useState('ALL')
  const [selMrf, setSelMrf] = useState<string | null>(null)
  const [selOffer, setSelOffer] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, string[]>>({})
  const [mgr, setMgr] = useState<Record<string, string | null>>({})
  const [pq, setPq] = useState('')
  const [more, setMore] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [mode, setMode] = useState<NoteMode>(null)
  const [note, setNote] = useState('')
  const [done, setDone] = useState<DoneEntry[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [toast, setToast] = useState<ToastState | null>(null)
  const [busy, setBusy] = useState(false)

  // A decided item is hidden at once so the next one opens without waiting for
  // the reload. When fresh lists arrive they are the truth again.
  useEffect(() => {
    setHidden((h) => (h.length > 0 ? [] : h))
  }, [mrfs, offers])

  const openMrfs = useMemo(() => mrfs.filter((m) => !hidden.includes(m.id)), [mrfs, hidden])
  const openOffers = useMemo(() => offers.filter((o) => !hidden.includes(o.id)), [offers, hidden])

  const companies = useMemo(() => {
    const seen = new Map<string, string>()
    openMrfs.forEach((m) => seen.set(m.companyId, m.companyCode))
    openOffers.forEach((o) => seen.set(o.companyId, o.companyCode))
    return Array.from(seen, ([id, code]) => ({ id, code })).sort((a, b) => a.code.localeCompare(b.code))
  }, [openMrfs, openOffers])

  const needle = q.trim().toLowerCase()
  const inCompany = (id: string) => company === 'ALL' || company === id
  const listMrfs = openMrfs.filter(
    (m) => inCompany(m.companyId) && (needle === '' || `${m.mrfNumber} ${m.designation} ${m.raiserName}`.toLowerCase().includes(needle)),
  )
  const listOffers = openOffers.filter(
    (o) =>
      inCompany(o.companyId) &&
      (needle === '' || `${o.candidateName} ${o.designation} ${o.mrfNumber} ${o.recruiterName}`.toLowerCase().includes(needle)),
  )

  const curMrf = listMrfs.find((m) => m.id === selMrf) ?? listMrfs[0] ?? null
  const curOffer = listOffers.find((o) => o.id === selOffer) ?? listOffers[0] ?? null

  const recruiters = curMrf ? recruitersByCompany[curMrf.companyId] ?? [] : []
  const managers = curOffer ? managersByCompany[curOffer.companyId] ?? [] : []
  // Only ids still offered for THIS requisition's company are ever sent.
  const mrfPicked = curMrf ? (picks[curMrf.id] ?? []).filter((id) => recruiters.some((p) => p.id === id)) : []
  const explicitMgr = curOffer && Object.prototype.hasOwnProperty.call(mgr, curOffer.id) ? mgr[curOffer.id] : undefined
  const chosenRaw = effectiveManager(explicitMgr, managers)
  const chosenMgr = chosenRaw !== null && managers.some((p) => p.id === chosenRaw) ? chosenRaw : null

  const resetPanel = () => {
    setMode(null)
    setNote('')
    setPq('')
    setReveal(false)
    setMore(false)
  }

  const pickSection = (s: ApprovalSection) => {
    setSection(s)
    setToast(null)
    resetPanel()
  }

  const run = async (action: () => ActionResult, entry: DoneEntry, text: string) => {
    if (busy) return
    setBusy(true)
    try {
      const result = await action()
      if (result === false) return
      setDone((d) => [entry, ...d])
      setHidden((h) => [...h, entry.id])
      setToast({ text, tone: entry.tone })
      resetPanel()
    } catch {
      setToast({ text: 'That did not go through. Please try again.', tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  const isMrf = section === 'mrf'
  const list = isMrf ? listMrfs : listOffers
  const curId = isMrf ? curMrf?.id ?? null : curOffer?.id ?? null
  const idx = curId === null ? -1 : list.findIndex((x) => x.id === curId)
  const prevId = idx > 0 ? (list[idx - 1]?.id ?? null) : null
  const nextId = idx >= 0 ? (list[idx + 1]?.id ?? null) : null
  const select = (id: string | null) => {
    if (id === null) return
    if (isMrf) setSelMrf(id)
    else setSelOffer(id)
    resetPanel()
  }

  const namesOf = (ids: string[], pool: PersonOption[]) =>
    pool
      .filter((p) => ids.includes(p.id))
      .map((p) => p.name)
      .join(', ')

  const ready = isMrf ? canApproveMrf(mrfPicked) : canApproveOffer(chosenMgr)
  const who = isMrf ? namesOf(mrfPicked, recruiters) : namesOf(chosenMgr === null ? [] : [chosenMgr], managers)
  const hint = ready
    ? `Ready. ${who} will be notified.`
    : isMrf
      ? 'First choose who will run this hiring.'
      : 'First choose the HR Manager.'

  const approve = () => {
    if (isMrf) {
      if (!curMrf || !canApproveMrf(mrfPicked)) return
      void run(
        () => onApproveMrf(curMrf, mrfPicked),
        { id: curMrf.id, title: curMrf.designation, sub: curMrf.mrfNumber, status: 'Approved', tone: 'ok' },
        `${curMrf.designation} (${curMrf.mrfNumber}) approved and assigned to ${who}.`,
      )
      return
    }
    if (!curOffer || chosenMgr === null) return
    void run(
      () => onApproveOffer(curOffer, chosenMgr),
      { id: curOffer.id, title: curOffer.candidateName, sub: `Offer, ${curOffer.designation}`, status: 'Approved', tone: 'ok' },
      `Offer for ${curOffer.candidateName} approved. ${who} will issue the letter.`,
    )
  }

  const confirmNote = () => {
    const text = note.trim()
    if (mode === 'revise') {
      if (!curMrf || !onReviseMrf || text === '') return
      void run(
        () => onReviseMrf(curMrf, text),
        { id: curMrf.id, title: curMrf.designation, sub: curMrf.mrfNumber, status: 'Sent back', tone: 'warn' },
        `${curMrf.designation} (${curMrf.mrfNumber}) sent back to the raiser.`,
      )
      return
    }
    if (mode !== 'reject') return
    if (isMrf) {
      if (!curMrf || !onRejectMrf) return
      void run(
        () => onRejectMrf(curMrf, text),
        { id: curMrf.id, title: curMrf.designation, sub: curMrf.mrfNumber, status: 'Rejected', tone: 'bad' },
        `${curMrf.designation} (${curMrf.mrfNumber}) rejected.`,
      )
      return
    }
    if (!curOffer || !onRejectOffer) return
    void run(
      () => onRejectOffer(curOffer, text),
      { id: curOffer.id, title: curOffer.candidateName, sub: `Offer, ${curOffer.designation}`, status: 'Rejected', tone: 'bad' },
      `Offer for ${curOffer.candidateName} rejected.`,
    )
  }

  const toggleRecruiter = (id: string) => {
    if (!curMrf) return
    const mine = picks[curMrf.id] ?? []
    setPicks({ ...picks, [curMrf.id]: mine.includes(id) ? mine.filter((v) => v !== id) : [...mine, id] })
  }

  const chooseManager = (id: string) => {
    if (!curOffer) return
    setMgr({ ...mgr, [curOffer.id]: chosenMgr === id ? null : id })
  }

  const waiting = openMrfs.length + openOffers.length + rehireCount
  const total = waiting + done.length
  const counts: Record<ApprovalSection, number> = { mrf: openMrfs.length, offer: openOffers.length, rehire: rehireCount }
  const hasCur = isMrf ? curMrf !== null : curOffer !== null
  const canReject = isMrf ? onRejectMrf !== undefined : onRejectOffer !== undefined
  const canRevise = isMrf && onReviseMrf !== undefined
  const filtered = needle !== '' || company !== 'ALL'

  return (
    <div className="rxa">
      <Hero
        waiting={waiting}
        mrfCount={openMrfs.length}
        offerCount={openOffers.length}
        cleared={done.length}
        total={total}
        viewerName={viewerName}
      />

      <SectionTabs section={section} counts={counts} onPick={pickSection} />

      {toast !== null && <ToastBar toast={toast} onClose={() => setToast(null)} />}

      {section === 'rehire' && (rehire ?? <EmptyState title="No rehire requests waiting" text="New requests will appear here." />)}

      {section !== 'rehire' && (
        <div className="rxa-work">
          <div className="rxa-queue">
            <label className="rxa-field">
              Find a request
              <input
                className="rxa-input"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Role, candidate or MRF number"
              />
            </label>

            {companies.length > 1 && (
              <div className="rxa-pills">
                <button type="button" className="rxa-pill" aria-pressed={company === 'ALL'} onClick={() => setCompany('ALL')}>
                  All companies
                </button>
                {companies.map((c) => (
                  <button key={c.id} type="button" className="rxa-pill" aria-pressed={company === c.id} onClick={() => setCompany(c.id)}>
                    {c.code}
                  </button>
                ))}
              </div>
            )}

            {list.length === 0 && (
              <div className="rxa-hint box">
                {loading ? 'Loading approvals.' : filtered ? 'Nothing matches. Clear the search or pick another company.' : 'Nothing is waiting here.'}
              </div>
            )}

            {isMrf &&
              listMrfs.map((m) => (
                <QueueRow
                  key={m.id}
                  title={m.designation}
                  line={`${plural(m.openings, 'opening', 'openings')} · ${m.location}`}
                  companyId={m.companyId}
                  companyCode={m.companyCode}
                  days={waitingDays(m.waitingSince)}
                  active={curMrf?.id === m.id}
                  onPick={() => select(m.id)}
                />
              ))}

            {!isMrf &&
              listOffers.map((o) => (
                <QueueRow
                  key={o.id}
                  title={o.candidateName}
                  line={`${o.designation} · ${formatLakh(o.offeredCtc)}`}
                  companyId={o.companyId}
                  companyCode={o.companyCode}
                  days={waitingDays(o.waitingSince)}
                  active={curOffer?.id === o.id}
                  onPick={() => select(o.id)}
                />
              ))}

            {done.length > 0 && (
              <div className="rxa-done">
                <div className="rxa-sub">Done this session</div>
                {done.map((d) => (
                  <div key={`${d.id}-${d.status}`} className="rxa-done-i">
                    <span className="rxa-person-body">
                      <span className="rxa-done-t">{d.title}</span>
                      <span className="rxa-person-c">{d.sub}</span>
                    </span>
                    <span className={`rxa-tag ${d.tone}`}>{d.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rxa-detail">
            {!hasCur && !loading && <EmptyState title="You are all caught up" text="Nothing in this section is waiting on you." />}

            {hasCur && (
              <div className="rxa-nav">
                <div className="rxa-nav-t">
                  Request {idx + 1} of {list.length}
                </div>
                <div className="rxa-nav-a">
                  <button type="button" className="rxa-btn ghost" disabled={prevId === null} onClick={() => select(prevId)}>
                    Previous
                  </button>
                  <button type="button" className="rxa-btn ghost" disabled={nextId === null} onClick={() => select(nextId)}>
                    Next
                  </button>
                </div>
              </div>
            )}

            {isMrf && curMrf !== null && (
              <MrfPanel
                mrf={curMrf}
                viewerId={viewerId}
                more={more}
                onToggleMore={() => setMore(!more)}
                recruiters={recruiters}
                selectedIds={mrfPicked}
                onToggle={toggleRecruiter}
                pq={pq}
                onPq={(e) => setPq(e.target.value)}
              />
            )}

            {!isMrf && curOffer !== null && (
              <OfferPanel
                offer={curOffer}
                more={more}
                onToggleMore={() => setMore(!more)}
                reveal={reveal}
                onToggleReveal={() => setReveal(!reveal)}
                managers={managers}
                chosen={chosenMgr}
                onChoose={chooseManager}
                packDocs={packDocs}
                onOpenDoc={onOpenPackDoc ? (d) => onOpenPackDoc(curOffer, d) : undefined}
              />
            )}

            {hasCur && mode !== null && (
              <NotePanel
                mode={mode}
                note={note}
                busy={busy}
                onNote={(e) => setNote(e.target.value)}
                onConfirm={confirmNote}
                onCancel={() => {
                  setMode(null)
                  setNote('')
                }}
              />
            )}

            {hasCur && (
              <ActionBar
                ready={ready}
                busy={busy}
                hint={hint}
                approveLabel={isMrf ? 'Approve & assign' : 'Approve & hand off'}
                onApprove={approve}
                onReject={
                  canReject
                    ? () => {
                        setMode('reject')
                        setNote('')
                      }
                    : undefined
                }
                onRevise={
                  canRevise
                    ? () => {
                        setMode('revise')
                        setNote('')
                      }
                    : undefined
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
