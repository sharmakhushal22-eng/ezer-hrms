'use client'
// components/te/plan/TePlanTrip.tsx — step 1 of the planner: what the trip is
// and who is going. Screens 10, 11, 20, 21.
//
// The only thing this screen works out for itself is whether a typed employee
// code is somebody: that is a lookup in the snapshot, not a rule. Whether the
// roster is acceptable is the server's answer, and arrives as an issue on `pax`.
import type { Snapshot, TripIssue, TripPreview, TripScope } from '@/lib/te/types'
import { errorFor, MAX_NAME, MAX_PEOPLE, PURPOSES, type PlannerDraft } from '@/lib/te/trip-draft'
import { needsExplanation, whyLabel, whyProblem } from '@/lib/te/other-reason'
import TeIcon from '../TeIcon'
import TeContactFields, { type ContactValue } from '../TeContactFields'

const KIND: Record<string, { name: string; tag: string; desc: string }> = {
  local: { name: 'Local trip', tag: 'Any travel except flight', desc: 'In the city or nearby, back the same day' },
  domestic: { name: 'Domestic trip', tag: 'Flight or any travel', desc: 'Another city in India, or a night away' },
  international: { name: 'International trip', tag: 'Any country', desc: 'Any country, city and address' },
}

const NAME_HINT: Record<string, string> = {
  local: 'Like Manesar plant audit',
  domestic: 'Like Mumbai client review',
  international: 'Like Dubai distributor summit',
}

export default function TePlanTrip({ snap, draft, issues, offersHub, edit, setScope, preview }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  /** Whether this kind of trip can use a flight or a train at all, from the
   *  company's own mode configuration. Decides whether that question is asked. */
  offersHub: boolean
  edit: (patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => void
  /** Changing the kind moves the dates with it, so the planner owns it. */
  setScope: (s: TripScope) => void
  /** Carries who the co-traveller codes resolved to; see lookup below. */
  preview: TripPreview | null
}) {
  const k = KIND[draft.scope]
  const tried = draft.tried
  const err = (key: string) => errorFor(issues, key, tried)

  /** Is this employee code somebody?
   *
   *  The preview first. GET /api/te/me asks the snapshot to resolve no codes
   *  at all, so snap.codes is empty for anybody not already on one of your
   *  trips — and the field told everyone "Not found in EZER" about colleagues
   *  who were found. The preview resolves exactly the codes in this draft,
   *  because the server needs them to work out who may approve it. */
  const lookup = (code: string) => {
    const up = code.trim().toUpperCase()
    const said = preview?.people?.find(q => (q.code || '').trim().toUpperCase() === up)
    if (said) return said.id ? { name: said.name, grade: said.grade } : null
    const id = snap.codes[up]
    return id ? snap.emp[id] ?? null : null
  }

  const setPerson = (i: number, patch: { id?: string; name?: string }) => edit(d => {
    const people = [...d.people]
    const was = people[i] ?? { id: '', name: '' }
    const now = { ...was, ...patch }
    // Typing a code fills the name in, but never over a name you typed yourself.
    if (patch.id !== undefined) {
      const found = lookup(patch.id)
      if (found && (!now.name || was.autoName)) { now.name = found.name; now.autoName = true }
    }
    if (patch.name !== undefined) now.autoName = false
    people[i] = now
    return { ...d, people }
  })

  const setPax = (delta: 1 | -1) => edit(d => ({ ...d, pax: d.pax + delta }))

  return (
    <>
      <div className="sec namefirst">
        <label className="fld full tn">
          <span>Trip name</span>
          <input
            value={draft.name}
            maxLength={MAX_NAME}
            autoComplete="off"
            placeholder={NAME_HINT[draft.scope]}
            onChange={e => edit({ name: e.target.value, nameTouched: !!e.target.value.trim() })}
          />
        </label>
        <small className="muted">{draft.nameTouched ? 'Your own name for the trip.' : 'Filled in from where you go. Type to change it.'}</small>
        {err('name') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('name')}</div> : null}
      </div>

      {/* Coming from the entry flow the kind is already chosen, so it is shown
          rather than asked again. Editing a saved trip, it can be changed —
          which is the whole point of screen 68c. */}
      <div className="sec">
        {draft.lockScope ? (
          <div className={`kindrow k-${draft.scope}`}>
            <span className="ki"><TeIcon name={draft.scope} /></span>
            <div className="grow">
              <b>{k.name}{draft.origin === 'POST_FACTO' ? ', already travelled' : ''}</b>
              <small>{k.tag} · {k.desc}</small>
            </div>
          </div>
        ) : (
          <>
            <h4>What kind of trip</h4>
            <div className="scopes3">
              {(['local', 'domestic', 'international'] as const).map(s => (
                <button key={s} type="button" className="scopec" aria-pressed={draft.scope === s} onClick={() => setScope(s)}>
                  <span className="ico-b"><TeIcon name={s} /></span>
                  <b>{KIND[s].name.replace(' trip', '')}</b>
                  <small>{KIND[s].desc}</small>
                  <small className="muted">{KIND[s].tag}</small>
                </button>
              ))}
            </div>
          </>
        )}
        {err('scope') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('scope')}</div> : null}
      </div>

      <div className="sec">
        <h4>Why</h4>
        <div className="opts">
          {PURPOSES.map(p => (
            <button key={p} type="button" className="opt" aria-pressed={draft.purpose === p} onClick={() => edit({ purpose: p })}>{p}</button>
          ))}
        </div>
        {err('purpose') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('purpose')}</div> : null}

        {/* INSTANTLY, the moment Other is picked. "Other" on its own tells the
            approver nothing, and it is exactly the trip whose reason is not on
            the list that most needs explaining. The box used to not exist at
            all here. */}
        {needsExplanation(draft.purpose) ? (
          <div className="form">
            <label className="fld full">
              <span>{whyLabel('purpose').label}</span>
              <textarea
                autoFocus
                value={draft.purposeNote}
                placeholder="Supplier arbitration hearing in Indore"
                onChange={e => edit({ purposeNote: e.target.value })}
              />
              <small>{whyLabel('purpose').hint}</small>
            </label>
            {draft.tried && whyProblem(draft.purpose, draft.purposeNote)
              ? <div className="ferr"><TeIcon name="warn" size="sm" />{whyProblem(draft.purpose, draft.purposeNote)}</div>
              : null}
          </div>
        ) : null}

        <div className="form">
          <label className="fld full">
            <span>Client or project</span>
            <input value={draft.project} placeholder="Optional" onChange={e => edit({ project: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="sec">
        <div className="ppl">
          <div className="ppl-head">
            <span className="ico-b"><TeIcon name="people" /></span>
            <div className="grow">
              <b>Who is travelling</b>
              <small>Count yourself too. Each person claims their own expenses.</small>
            </div>
            <div className="stepper" role="group" aria-label="People travelling">
              <button type="button" disabled={draft.pax <= 1} aria-label="One less" onClick={() => setPax(-1)}><TeIcon name="minus" size="sm" /></button>
              <span><b className="num">{draft.pax}</b><small>{draft.pax === 1 ? 'person' : 'people'}</small></span>
              <button type="button" disabled={draft.pax >= MAX_PEOPLE} aria-label="One more" onClick={() => setPax(1)}><TeIcon name="plus" size="sm" /></button>
            </div>
          </div>

          <div className="ppl-rows">
            <div className="ppl-row me">
              <span className="ppl-n">1</span>
              <div className="grow">
                <b>{snap.emp[snap.me]?.name}</b> <span className="small muted mono">{snap.emp[snap.me]?.code}</span>
              </div>
              <span className="chip plain t-brand">You</span>
            </div>
            {draft.people.map((p, i) => {
              const code = (p.id || '').trim().toUpperCase()
              const found = code ? lookup(code) : null
              const isMe = code && code === snap.emp[snap.me]?.code
              return (
                <div key={i} className="ppl-row">
                  <span className="ppl-n">{i + 2}</span>
                  <label className="fld sm pid">
                    <span>Employee ID</span>
                    <input value={p.id} autoCapitalize="characters" autoComplete="off" placeholder="SRS0533" onChange={e => setPerson(i, { id: e.target.value })} />
                  </label>
                  <label className="fld sm pnm">
                    <span>Name</span>
                    <input value={p.name} autoComplete="off" placeholder="Full name" onChange={e => setPerson(i, { name: e.target.value })} />
                  </label>
                  <button type="button" className="iconbtn sm" aria-label={`Remove person ${i + 2}`} onClick={() => edit(d => ({ ...d, people: d.people.filter((_, j) => j !== i), pax: Math.max(1, d.pax - 1) }))}>
                    <TeIcon name="close" size="sm" />
                  </button>
                  <div className="ppl-st">
                    {!code ? null
                      : isMe ? <span className="pst bad">That is you. You are already counted.</span>
                        : found ? <span className="pst ok"><TeIcon name="check" size="sm" />{found.name} · {found.grade} · found in EZER</span>
                          : <span className="pst warn">Not found in EZER. Your approver will check.</span>}
                  </div>
                </div>
              )
            })}
          </div>

          <button type="button" className="addp" disabled={draft.pax >= MAX_PEOPLE} onClick={() => setPax(1)}>
            <TeIcon name="plus" size="sm" />Add a person
          </button>
        </div>
        {err('pax') ? <div className="ferr"><TeIcon name="warn" size="sm" />{err('pax')}</div> : null}
      </div>

      {/* HOW THE DESK REACHES THEM, asked here rather than looked up. Every
          kind of trip asks, local included: a desk ringing somebody about a cab
          at six in the morning needs a number as much as one chasing an
          airline. Prefilled from the signed-in employee's own EZER record,
          editable, and never written back — see TeContactFields. */}
      <TeContactFields
        value={draft}
        prefilled={snap.contact ? { mobile: snap.contact.mobile, altMobile: snap.contact.altMobile, email: snap.contact.email } : undefined}
        onChange={patch => edit(patch as Partial<PlannerDraft>)}
        error={(k: keyof ContactValue) => err(k)}
      />

      {/* TWO QUESTIONS THAT DECIDE WHAT THE REST OF THE FORM ASKS.
          Both used to be answered later — the stay on step 4, the flight by
          picking it on step 3 — which meant everybody walked through screens
          that did not apply to them. Asked here, a same-day drive never sees
          the Stay step and never sees a flight offered. */}
      <div className="sec">
        <div className="askqs">
          <div className={`askq${draft.stayWanted === undefined && tried ? ' bad' : ''}`}>
            <div className="qh">
              <span className="ico-b"><TeIcon name="home" /></span>
              <div className="grow">
                <b>{draft.origin === 'POST_FACTO' ? 'Did you stay overnight, or spend on food?' : 'Do you need a hotel or a food allowance?'}</b>
                {/* What yes actually opens differs by route: on a past trip the
                    Stay step has no hotels to name, because there is nothing
                    left for the desk to book. Promising "the hotels you would
                    accept" there describes a screen that no longer appears. */}
                <small>{draft.origin === 'POST_FACTO'
                  ? 'Say no for a trip out and back the same day. Saying yes lets you claim the hotel and food bills against this trip.'
                  : 'Say no for a trip out and back the same day. Saying yes adds a step for the hotels you would accept.'}</small>
              </div>
            </div>
            <div className="seg" role="group" aria-label="Hotel or food allowance">
              <button type="button" aria-pressed={draft.stayWanted === true}
                onClick={() => edit({ stayWanted: true })}>Yes</button>
              <button type="button" aria-pressed={draft.stayWanted === false}
                // Saying no clears what was named: the hotels belong to the
                // question, and leaving them behind would send a plan asking
                // for a stay it has just said it does not need.
                onClick={() => edit({ stayWanted: false, foodWanted: false })}>No</button>
            </div>
            {draft.stayWanted === undefined && tried
              ? <div className="ferr"><TeIcon name="warn" size="sm" />Say whether you need a hotel or a food allowance.</div>
              : null}
          </div>

          {/* Asked only when this kind of trip can actually use one. The
              company decides that per mode and per kind of trip in Admin →
              Modes, so a local trip with flight and train switched off is
              never asked — and if an administrator switches flight on for
              local, the question appears there too. */}
          {offersHub ? (
            <div className={`askq${draft.flightOrTrain === undefined && tried ? ' bad' : ''}`}>
              <div className="qh">
                <span className="ico-b"><TeIcon name="plane" /></span>
                <div className="grow">
                  <b>Is a flight or a train part of this trip?</b>
                  <small>Saying no leaves them out of how you travel, so you are not offered a ticket you are not taking.</small>
                </div>
              </div>
              <div className="seg" role="group" aria-label="Flight or train">
                <button type="button" aria-pressed={draft.flightOrTrain === true}
                  onClick={() => edit({ flightOrTrain: true })}>Yes</button>
                <button type="button" aria-pressed={draft.flightOrTrain === false}
                  onClick={() => edit({ flightOrTrain: false })}>No</button>
              </div>
              {draft.flightOrTrain === undefined && tried
                ? <div className="ferr"><TeIcon name="warn" size="sm" />Say whether a flight or a train is part of this trip.</div>
                : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
