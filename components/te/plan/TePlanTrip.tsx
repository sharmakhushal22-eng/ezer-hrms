'use client'
// components/te/plan/TePlanTrip.tsx — step 1 of the planner: what the trip is
// and who is going. Screens 10, 11, 20, 21.
//
// The only thing this screen works out for itself is whether a typed employee
// code is somebody: that is a lookup in the snapshot, not a rule. Whether the
// roster is acceptable is the server's answer, and arrives as an issue on `pax`.
import type { Snapshot, TripIssue, TripScope } from '@/lib/te/types'
import { errorFor, MAX_NAME, MAX_PEOPLE, PURPOSES, type PlannerDraft } from '@/lib/te/trip-draft'
import { needsExplanation, whyLabel, whyProblem } from '@/lib/te/other-reason'
import TeIcon from '../TeIcon'

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

export default function TePlanTrip({ snap, draft, issues, edit, setScope }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  edit: (patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => void
  /** Changing the kind moves the dates with it, so the planner owns it. */
  setScope: (s: TripScope) => void
}) {
  const k = KIND[draft.scope]
  const tried = draft.tried
  const err = (key: string) => errorFor(issues, key, tried)

  /** Is this employee code somebody? Read from the snapshot the server sent. */
  const lookup = (code: string) => {
    const id = snap.codes[code.trim().toUpperCase()]
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
    </>
  )
}
