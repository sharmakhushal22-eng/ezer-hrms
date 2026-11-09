'use client'
// components/te/admin/TeDesks.tsx — who answers for which company and branch.
// The admin screen behind both staff tabs.
//
// WHAT AN ADMINISTRATOR IS HERE TO DO, in the order they do it:
//   1. see which branches are covered, and which are only covered by fallback
//   2. put somebody on a branch that is not covered by its own people
//   3. change what one person may do — approve, pay out, up to how much
//   4. take somebody off, and be told what that leaves behind BEFORE saving
//
// THE COVERAGE PANEL IS THE POINT OF THE SCREEN. A list of desk members
// answers "who is on the desk". It does not answer "is Ludhiana Factory
// covered", which is the question that actually matters and the one a list of
// fifty-seven names hides. The panel runs the same branch → company → group
// ladder the database runs and says, per branch, which step answers.
//
// THE LADDER SHOWN HERE IS A MIRROR, NOT THE RULE. lib/te/desks.ts says so in
// its own header: te_desk_members in SQL decides who may really act. If the
// two ever disagree, this screen is wrong and the database is right.
//
// NOBODY IS DELETED. Taking somebody off a desk switches them off, so the
// question "who could approve this, back in March" stays answerable. The row
// is still there and switching them back on reuses it.
import { useEffect, useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeDesksPayload, Uuid } from '@/lib/te/types'
import {
  coverage, coverageNote, DESK_NAME, deskRowProblem, isFallback, removalWarning, scopeLabel,
  type DeskKind, type DeskMember,
} from '@/lib/te/desks'
import { errorText, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

/** The database row shape, kept as the draft so a save is a straight write. */
interface Draft extends DeskMember {
  role: string
  key: string
}

export default function TeDesks({ onToast }: { onToast: (message: string) => void }) {
  const [data, setData] = useState<TeDesksPayload | null>(null)
  const [kind, setKind] = useState<DeskKind>('finance')
  const [draft, setDraft] = useState<Draft[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    te.admin.desks()
      .then(d => { if (live) { setData(d); setError('') } })
      .catch(e => { if (live) { setData(null); setError(errorText(e)) } })
    return () => { live = false }
  }, [tick])

  // The draft is derived from the payload and the chosen desk. Rebuilt by a
  // key change rather than by an effect that calls setState, which is the one
  // lint rule every screen in this module is held to.
  const fresh = useMemo<Draft[]>(() => {
    if (!data) return []
    const rows = kind === 'finance'
      ? data.finance.map(r => ({
        id: r.id, companyId: r.company_id, locationId: r.location_id, employeeId: r.employee_id,
        active: r.is_active, able: r.can_approve, groupScope: r.is_group_scope,
        limit: r.approval_limit, disburse: r.can_disburse, role: r.role, key: r.id,
      }))
      : data.travel.map(r => ({
        id: r.id, companyId: r.company_id, locationId: r.location_id, employeeId: r.employee_id,
        active: r.is_active, able: r.can_book, groupScope: r.is_group_scope,
        limit: null, disburse: false, role: r.role, key: r.id,
      }))
    return rows
  }, [data, kind])

  const rows = draft ?? fresh
  const dirty = draft !== null
  const spec = DESK_NAME[kind]
  const locs = data?.locations ?? []
  const company = data?.company_id ?? ''
  const groupCos = data?.group_companies ?? []

  const nameOf = (id: Uuid) => {
    const p = data?.people.find(x => x.id === id) ?? data?.pool.find(x => x.id === id)
    return p ? `${p.full_name} · ${p.emp_code}` : id.slice(0, 8)
  }
  const branchName = (id: Uuid | null) => (id ? (locs.find(l => l.id === id)?.location_name ?? 'Unknown branch') : null)
  const edit = (key: string, patch: Partial<Draft>) =>
    setDraft(d => (d ?? fresh).map(r => (r.key === key ? { ...r, ...patch } : r)))

  const problems = rows.map(r => deskRowProblem(r, kind)).filter(Boolean)

  async function save() {
    setBusy(true); setError('')
    try {
      const payload = rows.map(r => ({
        location_id: r.locationId,
        employee_id: r.employeeId,
        role: r.role,
        is_group_scope: r.groupScope,
        is_active: r.active,
        ...(kind === 'finance'
          ? { can_approve: r.able, can_disburse: !!r.disburse, approval_limit: r.limit ?? null }
          : { can_book: r.able }),
      }))
      const res = await te.admin.desksSave(kind, payload)
      onToast(`${spec.label}: ${res.saved} ${res.saved === 1 ? 'person' : 'people'} saved.`)
      setDraft(null)
      setTick(n => n + 1)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  function add(employeeId: Uuid) {
    const p = data?.pool.find(x => x.id === employeeId)
    const next: Draft = {
      // A new seat defaults to the person's own branch, which is almost always
      // what is wanted and is the whole reason this screen knows their branch.
      companyId: company, locationId: p?.location_id ?? null, employeeId,
      active: true, able: true, groupScope: false,
      limit: null, disburse: false,
      role: kind === 'finance' ? 'EXECUTIVE' : 'DESK',
      key: `new:${employeeId}:${p?.location_id ?? 'all'}`,
    }
    if ((draft ?? fresh).some(r => r.employeeId === employeeId && (r.locationId ?? null) === (next.locationId ?? null))) {
      setError(`${p?.full_name ?? 'That person'} is already on this desk for that branch.`)
      return
    }
    setDraft(d => [...(d ?? fresh), next])
    setAdding(false); setSearch(''); setError('')
  }

  const pool = useMemo(() => {
    const q = search.trim().toLowerCase()
    const on = new Set(rows.filter(r => r.active).map(r => r.employeeId))
    return (data?.pool ?? [])
      .filter(p => !on.has(p.id))
      .filter(p => !q || p.full_name.toLowerCase().includes(q) || p.emp_code.toLowerCase().includes(q))
      .slice(0, 40)
  }, [data, rows, search])

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Desks</h1>
          <p>
            Who answers for each company and branch. A request raised at a branch goes to that
            branch&rsquo;s desk; if nobody is there it widens to the company, then to the group.
          </p>
        </div>
      </div>

      <div className="seg scopes" role="group" aria-label="Desk">
        {(['finance', 'travel'] as DeskKind[]).map(k => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => { setKind(k); setDraft(null); setError('') }}
          >
            <TeIcon name={k === 'finance' ? 'claims' : 'plane'} size="sm" />{DESK_NAME[k].label}
          </button>
        ))}
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}
      {!data && !error ? <div className="empty"><b>Loading</b>Reading the desks, the branches and the people.</div> : null}

      {data?.travel_table_missing && kind === 'travel' ? (
        <div className="flag warn">
          <TeIcon name="alert" />
          <div className="tx">
            <b>The Travel desk table is not there yet</b>
            <p>Migration 161 creates it. Apply it and this half of the screen starts working; the Finance desk is unaffected.</p>
          </div>
        </div>
      ) : null}

      {data ? (
        <>
          {/* ── is every branch covered? ── */}
          <div className="card pad0">
            <div className="day">
              <span>Branch cover</span>
              <span>{locs.length} {locs.length === 1 ? 'branch' : 'branches'}</span>
            </div>
            {!locs.length ? (
              <div className="empty"><b>This company has no branches</b>Everybody on the desk answers for the whole company.</div>
            ) : null}
            {locs.map(l => {
              const c = coverage(rows, company, l.id, groupCos)
              const tone = c.via === 'nobody' ? 'chip t-crit' : isFallback(c) ? 'chip t-warn' : 'chip t-pos'
              return (
                <div key={l.id} className="li">
                  <span className="ico-b sm"><TeIcon name="pin" size="sm" /></span>
                  <div className="grow">
                    <div className="b">{l.location_name}</div>
                    <div className="small muted">{coverageNote(c, l.location_name)}</div>
                  </div>
                  <span className={tone}>{c.via === 'nobody' ? 'nobody' : c.via}</span>
                </div>
              )
            })}
          </div>

          {/* ── the people ── */}
          <div className="card pad0">
            <div className="day">
              <span>{spec.label}</span>
              <span>{rows.filter(r => r.active && r.able).length} able of {rows.length}</span>
            </div>

            {!rows.length ? (
              <div className="empty">
                <b>Nobody is on this desk</b>
                Add somebody below. Until then every request falls through to the group, or to nobody.
              </div>
            ) : null}

            {rows.map(r => {
              const other = r.companyId !== company
              const problem = deskRowProblem(r, kind)
              const warn = r.active ? removalWarning(rows, r, company, locs.map(l => ({ id: l.id, name: l.location_name })), groupCos) : ''
              return (
                <div key={r.key} className="li">
                  <span className="ico-b sm"><TeIcon name="people" size="sm" /></span>
                  <div className="grow">
                    <div className="b">
                      {nameOf(r.employeeId)}
                      {other ? <span className="chip plain"> another company</span> : null}
                    </div>
                    <div className="small muted">{scopeLabel(r, branchName(r.locationId))}</div>

                    {other ? (
                      // Their row belongs to the company that owns them. Showing
                      // it read-only is honest; editing it here would write to
                      // another company's configuration from this screen.
                      <p className="small muted">
                        Answers for this company through group scope. Change it from {' '}
                        {data.company?.company_code ?? 'their own company'}&rsquo;s own Desks screen.
                      </p>
                    ) : (
                      <div className="form">
                        <label className="fld sm">
                          <span>Answers for</span>
                          <select
                            value={r.groupScope ? 'group' : (r.locationId ?? 'all')}
                            onChange={e => {
                              const v = e.target.value
                              edit(r.key, v === 'group'
                                ? { groupScope: true, locationId: null }
                                : { groupScope: false, locationId: v === 'all' ? null : v })
                            }}
                          >
                            <option value="all">Every branch of this company</option>
                            {locs.map(l => <option key={l.id} value={l.id}>{l.location_name}</option>)}
                            <option value="group">Every company in the group</option>
                          </select>
                        </label>

                        <label className="check small">
                          <input type="checkbox" checked={r.able} onChange={e => edit(r.key, { able: e.target.checked })} />
                          <span>{kind === 'finance' ? 'May approve' : 'May book'}</span>
                        </label>

                        {kind === 'finance' ? (
                          <>
                            <label className="check small">
                              <input type="checkbox" checked={!!r.disburse} onChange={e => edit(r.key, { disburse: e.target.checked })} />
                              <span>May pay out</span>
                            </label>
                            <label className="fld sm">
                              <span>Approval limit (₹)</span>
                              <input
                                type="number"
                                min={1}
                                step={5000}
                                value={r.limit ?? ''}
                                placeholder="No ceiling"
                                onChange={e => edit(r.key, { limit: e.target.value === '' ? null : Number(e.target.value) })}
                              />
                              <small>
                                {r.limit == null
                                  ? 'Anything, however large.'
                                  : `Above ${rs(r.limit)} a more senior member verifies instead.`}
                              </small>
                            </label>
                          </>
                        ) : null}

                        <label className="check small">
                          <input type="checkbox" checked={r.active} onChange={e => edit(r.key, { active: e.target.checked })} />
                          <span>On the desk</span>
                        </label>
                      </div>
                    )}

                    {problem ? <div className="ferr"><TeIcon name="warn" size="sm" />{problem}</div> : null}
                    {warn ? <div className="ferr warn"><TeIcon name="alert" size="sm" />{warn}</div> : null}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── add somebody ── */}
          <div className="card">
            {!adding ? (
              <button type="button" className="btn" onClick={() => { setAdding(true); setError('') }}>
                <TeIcon name="plus" size="sm" />Add somebody to the {spec.label.toLowerCase()}
              </button>
            ) : (
              <>
                <label className="fld">
                  <span>Who</span>
                  <input
                    value={search}
                    placeholder="Name or employee code"
                    onChange={e => setSearch(e.target.value)}
                  />
                  <small>This company&rsquo;s employees. A new seat defaults to their own branch.</small>
                </label>
                <div className="card pad0">
                  {!pool.length ? <div className="empty"><b>Nobody matches</b>Everybody matching is already on this desk.</div> : null}
                  {pool.map(p => (
                    <button key={p.id} type="button" className="li click" onClick={() => add(p.id)}>
                      <span className="grow">
                        <span className="b">{p.full_name} <span className="mono small">{p.emp_code}</span></span>
                        <span className="small muted">
                          {branchName(p.location_id) ?? 'No branch on record'}
                          {p.grade ? ` · ${p.grade}` : ''}
                          {p.department_id ? ` · ${data.departments.find(d => d.id === p.department_id)?.dept_name ?? ''}` : ''}
                        </span>
                      </span>
                      <TeIcon name="plus" size="sm" />
                    </button>
                  ))}
                </div>
                <button type="button" className="btn" onClick={() => { setAdding(false); setSearch('') }}>Close</button>
              </>
            )}
          </div>

          <div className="row tight">
            <button type="button" className="btn pri" disabled={!dirty || busy || problems.length > 0} onClick={save}>
              {busy ? 'Saving…' : 'Save the desk'}
            </button>
            {dirty ? <button type="button" className="btn" onClick={() => { setDraft(null); setError('') }}>Undo my changes</button> : null}
            {problems.length ? <span className="small muted">{problems.length} to fix first.</span> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
