'use client'
// components/te/admin/TeWorkflow.tsx — who approves what. Screens c7-d1.
//
// The most consequential screen in Admin, and the one whose mistakes are
// least visible. A broken chain is not noticed by the person who saved it; it
// is noticed days later by an employee whose claim went nowhere, or to
// somebody who should never have seen it.
//
// So two things carry the weight:
//   · the chain is validated before it can be saved (lib/te/admin-edit.ts,
//     tested) — no empty chain, no level naming nobody, Finance never before
//     an approval level
//   · "Who approves" runs the real resolver against a sample claim
//     (te.admin.workflowPreview), so the admin sees the actual names this
//     chain would produce rather than trusting the shape of the form
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeChainRow, TeWorkflowCondition, TeWorkflowLevel, TripScope } from '@/lib/te/types'
import { chainBlocked, chainProblems, CONDITION_LABEL, isDirty, newLevel, whatChangingAffects, WHO_LABEL } from '@/lib/te/admin-edit'
import { errorText, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const SCOPES: TripScope[] = ['local', 'domestic', 'international']
const BANDS = ['Low', 'Medium', 'High']

export default function TeWorkflow({ onToast }: { onToast: (message: string) => void }) {
  const [code, setCode] = useState<'claim' | 'trip'>('claim')
  const [saved, setSaved] = useState<TeWorkflowLevel[]>([])
  const [levels, setLevels] = useState<TeWorkflowLevel[]>([])
  const [preview, setPreview] = useState<TeChainRow[] | null>(null)
  const [sampleTotal, setSampleTotal] = useState(25000)
  const [sampleScope, setSampleScope] = useState<TripScope>('domestic')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [resetting, setResetting] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.admin.workflow(code)
      .then(r => { if (current) { setSaved(r.levels); setLevels(r.levels); setError('') } })
      .catch(e => { if (current) setError(errorText(e)) })
    return () => { current = false }
  }, [code, tick])

  const problems = chainProblems(levels)
  const blocked = chainBlocked(levels)
  const dirty = isDirty(saved, levels)
  const problemAt = (i: number) => problems.filter(p => p.at === i)

  const setLevel = (i: number, patch: Partial<TeWorkflowLevel>) =>
    setLevels(ls => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)))
  const move = (i: number, by: -1 | 1) =>
    setLevels(ls => {
      const j = i + by
      if (j < 0 || j >= ls.length) return ls
      const next = [...ls]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  async function save() {
    setBusy('save'); setError('')
    try {
      await te.admin.workflowSave(code, levels)
      onToast(`The ${code === 'claim' ? 'claim' : 'trip'} chain was saved.`)
      reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  /** Back to the chain the module ships with. The server returns the restored
   *  levels, but the chain is re-read anyway so saved and edited start equal
   *  again and the screen does not immediately look dirty. */
  async function reset() {
    setBusy('reset'); setError('')
    try {
      await te.admin.workflowReset(code)
      onToast(`The ${code === 'claim' ? 'claim' : 'trip'} chain is back to the default.`)
      setResetting(false); reload()
    } catch (e) { setError(errorText(e)) } finally { setBusy('') }
  }

  /** Run the real resolver, so the admin sees names rather than roles. */
  async function whoApproves() {
    setBusy('preview'); setError('')
    try {
      const r = await te.admin.workflowPreview(code, { employee_id: '', total: sampleTotal, scope: sampleScope }, levels)
      setPreview(r.chain)
    } catch (e) { setError(errorText(e)); setPreview(null) } finally { setBusy('') }
  }

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Approval chains</h1>
          <p>Who signs off a claim, and who signs off a trip before it happens.</p>
        </div>
      </div>

      <div className="seg scopes" role="group" aria-label="Which chain">
        <button type="button" aria-pressed={code === 'claim'} onClick={() => { setCode('claim'); setPreview(null) }}>Claims</button>
        <button type="button" aria-pressed={code === 'trip'} onClick={() => { setCode('trip'); setPreview(null) }}>Trip plans</button>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      {/* A problem with the chain as a whole, rather than with one level. */}
      {problems.filter(p => p.at === -1).map((p, i) => (
        <div key={i} className={p.blocks ? 'flag crit' : 'flag warn'}>
          <TeIcon name="alert" /><div className="tx"><b>{p.text}</b></div>
        </div>
      ))}

      <div className="card pad0">
        <div className="day"><span>Levels, in order</span><span>{levels.length}</span></div>
        {levels.map((l, i) => {
          const mine = problemAt(i)
          const bad = mine.some(p => p.blocks)
          return (
            <div key={i} className={bad ? 'li bad' : 'li'}>
              <span className="ln">{i + 1}</span>
              <div className="grow">
                <div className="form">
                  <label className="fld sm"><span>Called</span>
                    <input value={l.label} onChange={e => setLevel(i, { label: e.target.value })} />
                  </label>
                  <label className="fld sm"><span>Who</span>
                    <select value={l.who} onChange={e => setLevel(i, { who: e.target.value as TeWorkflowLevel['who'] })}>
                      {(Object.keys(WHO_LABEL) as TeWorkflowLevel['who'][]).map(w => (
                        <option key={w} value={w}>{WHO_LABEL[w]}</option>
                      ))}
                    </select>
                  </label>
                  {l.who === 'person' ? (
                    <label className="fld sm"><span>Employee id</span>
                      <input value={l.person} placeholder="The person who signs off" onChange={e => setLevel(i, { person: e.target.value })} />
                    </label>
                  ) : null}
                  <label className="fld sm"><span>Kind</span>
                    <select value={l.kind} onChange={e => setLevel(i, { kind: e.target.value as 'approve' | 'finance' })}>
                      <option value="approve">Approval</option>
                      <option value="finance">Finance check</option>
                    </select>
                  </label>
                </div>

                <div className="row tight">
                  <span className="small muted">Only when:</span>
                  {(Object.keys(CONDITION_LABEL) as TeWorkflowCondition['t'][]).map(t => {
                    const on = l.when.some(c => c.t === t)
                    return (
                      <button
                        key={t}
                        type="button"
                        className="chip plain"
                        aria-pressed={on}
                        title={CONDITION_LABEL[t]}
                        onClick={() => setLevel(i, { when: on ? l.when.filter(c => c.t !== t) : [...l.when, { t }] })}
                      >
                        {CONDITION_LABEL[t]}
                      </button>
                    )
                  })}
                  {!l.when.length ? <span className="small muted">always</span> : null}
                </div>

                {l.when.map((c, ci) => (
                  c.t === 'amount' || c.t === 'scope' || c.t === 'risk' ? (
                    <label key={c.t} className="fld sm">
                      <span>{CONDITION_LABEL[c.t]}</span>
                      {c.t === 'amount' ? (
                        <input type="number" min={0} value={typeof c.v === 'number' ? c.v : ''} onChange={e => setLevel(i, { when: l.when.map((x, n) => (n === ci ? { ...x, v: Number(e.target.value) } : x)) })} />
                      ) : (
                        <select value={String(c.v ?? '')} onChange={e => setLevel(i, { when: l.when.map((x, n) => (n === ci ? { ...x, v: e.target.value } : x)) })}>
                          <option value="">Choose</option>
                          {(c.t === 'scope' ? SCOPES : BANDS).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                    </label>
                  ) : null
                ))}

                {mine.map((p, n) => (
                  <div key={n} className={p.blocks ? 'ferr' : 'ferr warn'}>
                    <TeIcon name="alert" size="sm" />{p.text}
                  </div>
                ))}

                <div className="row tight">
                  <button type="button" className="btn sm" disabled={i === 0} onClick={() => move(i, -1)}><TeIcon name="up" size="sm" />Earlier</button>
                  <button type="button" className="btn sm" disabled={i === levels.length - 1} onClick={() => move(i, 1)}><TeIcon name="down" size="sm" />Later</button>
                  <button type="button" className="btn sm dan" onClick={() => setLevels(ls => ls.filter((_, n) => n !== i))}>Remove</button>
                </div>
              </div>
            </div>
          )
        })}
        <div className="li">
          <div className="row tight">
            <button type="button" className="btn sm" onClick={() => setLevels(ls => [...ls, newLevel('approve')])}><TeIcon name="plus" size="sm" />Add an approval</button>
            <button type="button" className="btn sm" onClick={() => setLevels(ls => [...ls, newLevel('finance')])}><TeIcon name="plus" size="sm" />Add a Finance check</button>
          </div>
        </div>
      </div>

      {/* Names, not roles: the real resolver against a sample. */}
      <div className="card">
        <div className="ch"><h3>Who approves</h3><span className="muted small">this chain, against a sample</span></div>
        <div className="form">
          <label className="fld sm"><span>A claim of (₹)</span>
            <input type="number" min={0} step={1000} value={sampleTotal} onChange={e => setSampleTotal(Number(e.target.value))} />
          </label>
          <label className="fld sm"><span>On a trip that is</span>
            <select value={sampleScope} onChange={e => setSampleScope(e.target.value as TripScope)}>
              {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="btn" disabled={busy === 'preview'} onClick={whoApproves}>
          {busy === 'preview' ? 'Working it out…' : `Show who approves ${rs(sampleTotal)}`}
        </button>
        {preview ? (
          preview.length ? (
            <div className="stack sm">
              {preview.map((s, i) => (
                <div key={i} className="row tight">
                  <span className="ln">{s.step_no}</span>
                  <div className="grow"><b>{s.role_label}</b>{s.note ? <div className="small muted">{s.note}</div> : null}</div>
                  <span className="chip plain">{s.stage}</span>
                </div>
              ))}
            </div>
          ) : <p className="small muted">Nobody. A claim like this would go straight through.</p>
        ) : null}
      </div>

      {dirty ? (
        <div className="card">
          <div className="note"><TeIcon name="info" size="sm" /><span>{whatChangingAffects('workflow')}</span></div>
          {blocked ? <p className="small muted">Fix what is marked in red before this can be saved.</p> : null}
          <div className="row tight">
            <button type="button" className="btn" onClick={() => setLevels(saved)}>Undo the changes</button>
            <button type="button" className="btn pri" disabled={blocked || busy === 'save'} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save the chain'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Back to the chain the module ships with. Screens c7, d1b.
          Offered only when there is nothing unsaved: resetting on top of edits
          would throw away two different things at once and the admin could not
          tell afterwards which had gone. */}
      <div className="card">
        <div className="ch"><h3>Start again</h3></div>
        {dirty ? (
          <p className="small muted">Save or undo your changes first, then the default chain can be restored.</p>
        ) : resetting ? (
          <div className="form">
            <div className="flag crit">
              <TeIcon name="alert" size="sm" />
              <span>
                Every level you have set up for {code === 'claim' ? 'claims' : 'trip plans'} is replaced by the
                default chain. {whatChangingAffects('workflow')}
              </span>
            </div>
            <div className="row tight">
              <button type="button" className="btn" onClick={() => setResetting(false)}>Never mind</button>
              <button type="button" className="btn dan" disabled={busy === 'reset'} onClick={reset}>
                {busy === 'reset' ? 'Restoring…' : 'Restore the default chain'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="small muted">Replace this chain with the one the module ships with.</p>
            <button type="button" className="btn dan" onClick={() => { setResetting(true); setError('') }}>
              Restore the default chain
            </button>
          </>
        )}
      </div>
    </div>
  )
}
