'use client'
// components/te/admin/TeAudit.tsx — who did what. Screen d4.
//
// The audit log answers one question well: what happened to this claim, or
// what has this person been doing. Both are filters, so the screen leads with
// them rather than with an undifferentiated firehose nobody reads.
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import type { AuditRow } from '@/lib/te/client'
import { errorText, when } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const PAGE = 50

export default function TeAudit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(() => {
    let current = true
    te.admin.audit({
      limit: PAGE, offset,
      ...(entity ? { entity_type: entity } : {}),
      ...(action ? { action } : {}),
    })
      .then(p => { if (current) { setRows(p.rows ?? []); setTotal(p.total ?? 0); setError('') } })
      .catch(e => { if (current) { setRows([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [offset, entity, action])

  useEffect(load, [load])

  const list = rows ?? []

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Audit log</h1>
          <p>Every decision and change, with who made it and when.</p>
        </div>
      </div>

      <div className="card">
        <div className="form">
          <label className="fld sm"><span>About</span>
            <select value={entity} onChange={e => { setEntity(e.target.value); setOffset(0) }}>
              <option value="">Everything</option>
              <option value="claim">Claims</option>
              <option value="trip">Trips</option>
              <option value="leg">Journeys</option>
              <option value="expense">Expense lines</option>
              <option value="advance">Advances</option>
              <option value="vehicle">Vehicles</option>
              <option value="settings">Settings</option>
            </select>
          </label>
          <label className="fld sm"><span>Action contains</span>
            <input value={action} onChange={e => { setAction(e.target.value); setOffset(0) }} placeholder="approve, verify, lock…" />
          </label>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="card pad0">
        <div className="day"><span>Entries</span><span>{total}</span></div>
        {rows === null ? <div className="empty"><b>Loading…</b></div> : null}
        {rows !== null && !list.length ? <div className="empty"><b>Nothing matches</b>Try a wider filter.</div> : null}
        {list.map(r => (
          <div key={r.id} className="li">
            <span className="ico"><TeIcon name="clock" /></span>
            <div className="grow">
              {/* The summary is written for a person to read; the action code
                  is for searching. Both are shown, in that order. */}
              <div className="b">{r.summary || r.action}</div>
              <div className="small muted">
                {r.actor_role || 'System'}
                {r.entity_type ? ` · ${r.entity_type}` : ''}
                {r.entity_ref ? ` ${r.entity_ref}` : ''}
                {` · ${r.action}`}
              </div>
            </div>
            <span className="small muted">{when(r.at)}</span>
          </div>
        ))}
      </div>

      {total > PAGE ? (
        <div className="row tight">
          <button type="button" className="btn sm" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))}>Newer</button>
          <span className="small muted grow">{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <button type="button" className="btn sm" disabled={offset + PAGE >= total} onClick={() => setOffset(o => o + PAGE)}>Older</button>
        </div>
      ) : null}
    </div>
  )
}
