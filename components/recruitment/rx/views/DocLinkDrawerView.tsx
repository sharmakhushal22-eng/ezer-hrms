'use client'

/**
 * DocLinkDrawerView — the redesigned look of the Create Link drawer
 * (`CtcDocLink`), all three modes: main, send, status.
 *
 * PRESENTATIONAL ONLY. `CtcDocLink` keeps its state, its fetches to
 * `/api/recruitment/doc-collection` (send, reject, file, zip), the email
 * regex, the audit row and every toast. This file only draws what it is given
 * and calls back.
 *
 * Conventions kept: no Tailwind, no hardcoded colours, stacking only through
 * theme variables, sub-components outside their parent.
 */

import { useEffect, type MouseEvent } from 'react'
import { initialsOf, type CcPerson, type DocDrawerMode, type DocLinkVM, type UploadedDocVM } from '../logic/negotiationView'

/** Optional. Lets the reviewer step to the next candidate without closing the drawer. */
export interface DrawerNav {
  index: number
  total: number
  onPrev: (() => void) | null
  onNext: (() => void) | null
}

export interface DocLinkDrawerViewProps {
  /** Leave out and the previous / next control is not drawn. */
  nav?: DrawerNav | undefined
  mode: DocDrawerMode
  onMode: (mode: DocDrawerMode) => void
  onClose: () => void

  candidateName: string
  candidatePosition: string

  /** `canEditEmail`: admin, raiser, or the assigned hiring manager. */
  canEditEmail: boolean
  /** `candidates.email` as saved. */
  registeredEmail: string
  emailDraft: string
  onEmailDraft: (value: string) => void
  emailDirty: boolean
  savingEmail: boolean
  onSaveEmail: () => void

  link: DocLinkVM | null
  /** No link yet: go to mode `send` with the candidate's email. */
  onCreate: () => void
  /** Link exists: pre-fill email and CC from the link row, go to mode `send`. */
  onResend: () => void

  sendEmail: string
  onSendEmail: (value: string) => void
  /** The container's own validation message, when the address is refused. */
  sendError?: string | undefined
  ccQuery: string
  onCcQuery: (value: string) => void
  ccSuggestions: CcPerson[]
  ccSelected: CcPerson[]
  onAddCc: (person: CcPerson) => void
  onRemoveCc: (id: string) => void
  sending: boolean
  onSend: () => void

  docs: UploadedDocVM[]
  selectedDocIds: string[]
  onToggleDoc: (id: string) => void
  onToggleAllDocs: () => void
  /** Zip of the selection, or of everything when nothing is selected. */
  onDownloadZip: () => void
  onViewDoc: (id: string) => void
  onDownloadDoc: (id: string) => void
  /** The document whose inline reject confirm is open. */
  rejectingId: string | null
  onAskReject: (id: string) => void
  onCancelReject: () => void
  onConfirmReject: () => void
  rejecting: boolean

  /** True while the container's GET is in flight. The header, the step
   *  indicator and the close / previous / next controls all come from props
   *  and are drawn at once; only the body waits. */
  loading?: boolean
}

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
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 8v5M12 16.5v.5M10.3 4.2L2.8 17.5a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  download: 'M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14',
  send: 'M4 12l16-7-6 16-3-7-7-2z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
}

const MODES: { key: DocDrawerMode; label: string }[] = [
  { key: 'main', label: 'Link' },
  { key: 'send', label: 'Send' },
  { key: 'status', label: 'Review' },
]

interface StepsProps {
  mode: DocDrawerMode
}

function Steps({ mode }: StepsProps) {
  const at = MODES.findIndex((m) => m.key === mode)
  return (
    <div className="rxn-dsteps" aria-label="Drawer step">
      {MODES.map((m, i) => (
        <span key={m.key} className="rxn-dstep" data-on={i === at} data-done={i < at}>
          <span className="rxn-dstep-n">{i + 1}</span>
          {m.label}
        </span>
      ))}
    </div>
  )
}

function linkPill(link: DocLinkVM): { tone: string; text: string } {
  if (link.state === 'SUBMITTED') return { tone: 'ok', text: 'Submitted' }
  if (link.state === 'ACTIVE') return { tone: 'info', text: link.hoursLeft === null ? 'Active' : `Active \u00B7 ${link.hoursLeft}h left` }
  return { tone: 'bad', text: 'Expired' }
}

interface TrailProps {
  link: DocLinkVM
}

/** Sent, opened, submitted: where the link has got to. */
function Trail({ link }: TrailProps) {
  const submitted = link.state === 'SUBMITTED'
  const opened = submitted || (link.openedAtLabel !== undefined && link.openedAtLabel !== '')
  const steps: { label: string; done: boolean; when: string }[] = [
    { label: 'Sent', done: true, when: link.sentAtLabel ?? '' },
    { label: 'Opened', done: opened, when: link.openedAtLabel ?? '' },
    { label: 'Submitted', done: submitted, when: submitted ? link.submittedAtLabel : '' },
  ]
  return (
    <div className="rxn-trail">
      {steps.map((s) => (
        <div key={s.label} className="rxn-trail-i" data-done={s.done}>
          <span className="rxn-trail-d">{s.done ? <Icon d={I.check} size={12} /> : null}</span>
          <span className="rxn-trail-t">{s.label}</span>
          {s.when !== '' && <span className="rxn-trail-s">{s.when}</span>}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mode: main                                                          */
/* ------------------------------------------------------------------ */

function MainMode(p: DocLinkDrawerViewProps) {
  const link = p.link
  const differs = link !== null && link.sentTo !== '' && p.registeredEmail !== '' && link.sentTo.toLowerCase() !== p.registeredEmail.toLowerCase()
  return (
    <div className="rxn-dbody">
      <div className="rxn-card flat">
        <div className="rxn-card-h">
          <div className="rxn-card-t">
            <Icon d={I.mail} size={18} />
            Registered email
          </div>
        </div>
        {p.canEditEmail ? (
          <div className="rxn-inline">
            <label className="rxn-field grow">
              <span className="rxn-sr">Registered email</span>
              <input className="rxn-input" type="email" value={p.emailDraft} onChange={(e) => p.onEmailDraft(e.target.value)} />
            </label>
            <button type="button" className="rxn-btn p" disabled={!p.emailDirty || p.savingEmail} onClick={p.onSaveEmail}>
              {p.savingEmail ? 'Saving' : 'Save'}
            </button>
          </div>
        ) : (
          <div className="rxn-block">
            <div className="rxn-readonly">{p.registeredEmail === '' ? 'No email on record' : p.registeredEmail}</div>
            <span className="rxn-hint">Only the assigned hiring manager can correct this.</span>
          </div>
        )}
        {p.canEditEmail && p.emailDirty && (
          <div className="rxn-alert warn">
            <Icon d={I.alert} size={18} />
            <div className="rxn-alert-b">
              <b>Unsaved.</b> Saving updates the candidate everywhere: document link, salary break-up and the offer letter.
              {link !== null && <span> A link already sent stays bound to the old address until you resend it.</span>}
            </div>
          </div>
        )}
        {differs && link !== null && (
          <div className="rxn-alert warn">
            <Icon d={I.alert} size={18} />
            <div className="rxn-alert-b">
              <b>Two different addresses.</b> The link was sent to {link.sentTo}. The candidate&apos;s email is now {p.registeredEmail}. Resend the link to move it to the new address.
            </div>
          </div>
        )}
      </div>

      {link === null ? (
        <div className="rxn-card flat center">
          <div className="rxn-empty-dot brand">
            <Icon d={I.doc} size={18} />
          </div>
          <div className="rxn-empty-t">No document link yet</div>
          <div className="rxn-empty-s">The candidate gets a 48-hour link, verifies by OTP and uploads their documents.</div>
          <button type="button" className="rxn-btn p wide" onClick={p.onCreate}>
            <Icon d={I.send} />
            Create CTC Negotiation Link
          </button>
        </div>
      ) : (
        <div className="rxn-card flat">
          <div className="rxn-card-h">
            <div className="rxn-card-t">
              <Icon d={I.doc} size={18} />
              Document link
            </div>
            <span className={`rxn-chip ${linkPill(link).tone}`}>{linkPill(link).text}</span>
          </div>
          <Trail link={link} />
          <div className="rxn-kvs">
            <div className="rxn-kv">
              <span>Uploaded</span>
              <b>
                {link.docCount} {link.docCount === 1 ? 'document' : 'documents'}
              </b>
            </div>
            <div className="rxn-kv wide">
              <span>Sent to</span>
              <b>{link.sentTo === '' ? '\u2014' : link.sentTo}</b>
            </div>
            {link.cc.length > 0 && (
              <div className="rxn-kv wide">
                <span>CC</span>
                <b>{link.cc.join(', ')}</b>
              </div>
            )}
            <div className="rxn-kv">
              <span>{link.state === 'SUBMITTED' ? 'Submitted' : link.state === 'ACTIVE' ? 'Expires' : 'Expired'}</span>
              <b>{link.state === 'SUBMITTED' ? link.submittedAtLabel : link.expiresAtLabel}</b>
            </div>
          </div>
          <div className="rxn-actions">
            {link.state === 'SUBMITTED' ? (
              <button type="button" className="rxn-btn p grow" onClick={() => p.onMode('status')}>
                <Icon d={I.eye} />
                Review Documents
              </button>
            ) : (
              <button type="button" className="rxn-btn ghost grow" onClick={() => p.onMode('status')}>
                <Icon d={I.clock} />
                Status
              </button>
            )}
            <button type="button" className={link.state === 'SUBMITTED' ? 'rxn-btn ghost' : 'rxn-btn p grow'} onClick={p.onResend}>
              <Icon d={I.send} />
              Resend link
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mode: send                                                          */
/* ------------------------------------------------------------------ */

function SendMode(p: DocLinkDrawerViewProps) {
  const bad = p.sendError !== undefined && p.sendError !== ''
  return (
    <div className="rxn-dbody">
      <div className="rxn-card flat">
        <label className="rxn-field">
          Candidate email
          <input className="rxn-input" type="email" value={p.sendEmail} aria-invalid={bad} onChange={(e) => p.onSendEmail(e.target.value)} />
          <span className="rxn-hint">The link and its verification code go to this address.</span>
        </label>
        {bad && (
          <div className="rxn-line bad" role="alert">
            {p.sendError}
          </div>
        )}

        <label className="rxn-field">
          CC
          <input className="rxn-input" type="search" value={p.ccQuery} placeholder="Search an employee by name or code" onChange={(e) => p.onCcQuery(e.target.value)} />
        </label>
        {p.ccSuggestions.length > 0 && (
          <div className="rxn-suggest">
            {p.ccSuggestions.map((s) => (
              <button key={s.id} type="button" className="rxn-suggest-i" onClick={() => p.onAddCc(s)}>
                <span className="rxn-av sm">{initialsOf(s.name)}</span>
                <span className="rxn-row-b">
                  <span className="rxn-row-n">{s.name}</span>
                  <span className="rxn-row-p">
                    {s.code} · {s.email}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {p.ccSelected.length > 0 && (
          <div className="rxn-chips">
            {p.ccSelected.map((s) => (
              <span key={s.id} className="rxn-chip brand removable">
                {s.name}
                <button type="button" className="rxn-chip-x" aria-label={`Remove ${s.name}`} onClick={() => p.onRemoveCc(s.id)}>
                  <Icon d={I.close} size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rxn-actions">
        <button type="button" className="rxn-btn ghost" onClick={() => p.onMode('main')}>
          <Icon d={I.back} />
          Back
        </button>
        <button type="button" className="rxn-btn p grow" disabled={p.sending} onClick={p.onSend}>
          <Icon d={I.send} />
          {p.sending ? 'Sending' : 'Send link'}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mode: status                                                        */
/* ------------------------------------------------------------------ */

function statusLine(link: DocLinkVM | null): { tone: string; text: string } {
  if (link === null) return { tone: '', text: 'No link has been sent yet.' }
  if (link.state === 'SUBMITTED') return { tone: 'ok', text: `Submitted on ${link.submittedAtLabel}` }
  if (link.state === 'ACTIVE') return { tone: 'info', text: `Link active \u2014 ${link.hoursLeft ?? 0}h left (expires ${link.expiresAtLabel})` }
  return { tone: 'bad', text: 'Link expired' }
}

function StatusMode(p: DocLinkDrawerViewProps) {
  const line = statusLine(p.link)
  const allOn = p.docs.length > 0 && p.selectedDocIds.length === p.docs.length
  const some = p.selectedDocIds.length
  return (
    <div className="rxn-dbody">
      <div className={`rxn-alert ${line.tone === '' ? 'info' : line.tone}`}>
        <Icon d={line.tone === 'bad' ? I.alert : line.tone === 'ok' ? I.check : I.clock} size={18} />
        <div className="rxn-alert-b">
          <b>{line.text}</b>
        </div>
      </div>

      {p.docs.length === 0 ? (
        <div className="rxn-card flat center">
          <div className="rxn-empty-t">Nothing uploaded yet</div>
          <div className="rxn-empty-s">Documents appear here as soon as the candidate uploads them.</div>
        </div>
      ) : (
        <div className="rxn-card flat">
          <div className="rxn-doc-bar">
            <label className="rxn-check">
              <input type="checkbox" checked={allOn} onChange={p.onToggleAllDocs} />
              <span>Select all ({p.docs.length})</span>
            </label>
            <button type="button" className="rxn-btn ghost sm" onClick={p.onDownloadZip}>
              <Icon d={I.download} />
              {some > 0 ? `Download selected (${some})` : 'Download all'}
            </button>
          </div>

          <div className="rxn-docs">
            {p.docs.map((d) => {
              const asking = p.rejectingId === d.id
              return (
                <div key={d.id} className="rxn-docrow" data-asking={asking}>
                  <div className="rxn-docrow-main">
                    <label className="rxn-check">
                      <input type="checkbox" checked={p.selectedDocIds.includes(d.id)} onChange={() => p.onToggleDoc(d.id)} />
                      <span className="rxn-sr">Select {d.label}</span>
                    </label>
                    <span className="rxn-doc-i">
                      <Icon d={I.doc} size={18} />
                    </span>
                    <span className="rxn-row-b">
                      <span className="rxn-row-n">
                        {d.label}
                        {d.mandatory && <span className="rxn-chip sm">Mandatory</span>}
                      </span>
                      <span className="rxn-row-p">
                        {d.fileName} · {d.sizeLabel} · {d.uploadedAtLabel}
                      </span>
                    </span>
                  </div>
                  {!asking && (
                    <div className="rxn-docrow-a">
                      <button type="button" className="rxn-btn ghost sm" onClick={() => p.onViewDoc(d.id)}>
                        <Icon d={I.eye} size={14} />
                        View
                      </button>
                      <button type="button" className="rxn-btn ghost sm icon" aria-label={`Download ${d.label}`} title="Download" onClick={() => p.onDownloadDoc(d.id)}>
                        <Icon d={I.download} size={14} />
                      </button>
                      <button type="button" className="rxn-btn danger sm" onClick={() => p.onAskReject(d.id)}>
                        Reject
                      </button>
                    </div>
                  )}
                  {asking && (
                    <div className="rxn-confirm" role="alertdialog" aria-label={`Reject ${d.label}`}>
                      <div className="rxn-confirm-t">Reject {d.label}?</div>
                      <div className="rxn-confirm-s">
                        The file is deleted and the link reopens for 24 hours, for this document only. The candidate is not told until you resend the link.
                      </div>
                      <div className="rxn-actions">
                        <button type="button" className="rxn-btn ghost sm" disabled={p.rejecting} onClick={p.onCancelReject}>
                          Keep it
                        </button>
                        <button type="button" className="rxn-btn danger solid sm" disabled={p.rejecting} onClick={p.onConfirmReject}>
                          {p.rejecting ? 'Rejecting' : 'Reject document'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="rxn-actions">
        <button type="button" className="rxn-btn ghost" onClick={() => p.onMode('main')}>
          <Icon d={I.back} />
          Back
        </button>
        {p.link !== null && p.link.state !== 'SUBMITTED' && (
          <button type="button" className="rxn-btn p grow" onClick={p.onResend}>
            <Icon d={I.send} />
            Resend link
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The drawer                                                          */
/* ------------------------------------------------------------------ */

export default function DocLinkDrawerView(props: DocLinkDrawerViewProps) {
  const { onClose } = props

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const onScrim = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="rxn rxn-layer drawer" onMouseDown={onScrim}>
      <div className="rxn-drawer" role="dialog" aria-modal="true" aria-label={`Documents for ${props.candidateName}`}>
        <div className="rxn-dhead">
          <div className="rxn-band-who">
            <div className="rxn-av on">{initialsOf(props.candidateName)}</div>
            <div className="rxn-row-b">
              <h2 className="rxn-band-n">{props.candidateName}</h2>
              <div className="rxn-band-m">{props.candidatePosition} · Pre-negotiation documents</div>
            </div>
          </div>
          <div className="rxn-nav">
            {props.nav !== undefined && (
              <span className="rxn-nav-step">
                <button type="button" className="rxn-btn onband sm icon" aria-label="Previous candidate" disabled={props.nav.onPrev === null} onClick={props.nav.onPrev ?? undefined}>
                  <Icon d={I.back} size={14} />
                </button>
                <span className="rxn-nav-n">
                  {props.nav.index + 1} of {props.nav.total}
                </span>
                <button type="button" className="rxn-btn onband sm icon" aria-label="Next candidate" disabled={props.nav.onNext === null} onClick={props.nav.onNext ?? undefined}>
                  <Icon d={I.next} size={14} />
                </button>
              </span>
            )}
            <button type="button" className="rxn-btn onband sm icon" aria-label="Close" onClick={onClose}>
              <Icon d={I.close} size={14} />
            </button>
          </div>
        </div>
        <Steps mode={props.mode} />
        {props.loading === true ? (
          <div className="rxn-dbody">
            <div className="rxn-hint">Loading this candidate's documents.</div>
          </div>
        ) : (
          <>
            {props.mode === 'main' && <MainMode {...props} />}
            {props.mode === 'send' && <SendMode {...props} />}
            {props.mode === 'status' && <StatusMode {...props} />}
          </>
        )}
      </div>
    </div>
  )
}
