'use client'
// components/te/finance/TeAdvanceDesk.tsx — the advance desk. Screen a2.
//
// Company money sitting with employees. The desk's job is to get it out when
// it is due and back when it is not, so the list leads with what is
// outstanding and which actions each row actually allows.
//
// Which actions those are is lib/te/finance-desk.ts, which is tested: a
// refund offered on an advance that never went out is the commonest shape of
// bug here, and the most confusing to the person who clicks it.
import { useCallback, useEffect, useState } from 'react'
import { te } from '@/lib/te/client'
import { advanceActions, type AdvanceAction } from '@/lib/te/finance-desk'
import { errorText, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

type Row = Record<string, unknown>
const str = (r: Row, k: string) => (typeof r[k] === 'string' ? r[k] as string : '')
const num = (r: Row, k: string) => (typeof r[k] === 'number' ? r[k] as number : 0)

export default function TeAdvanceDesk({ onToast }: { onToast: (message: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [acting, setActing] = useState<{ id: string; action: AdvanceAction } | null>(null)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    let current = true
    te.finance.advances()
      .then(p => { if (current) { setRows(p.rows ?? []); setError('') } })
      .catch(e => { if (current) { setRows([]); setError(errorText(e)) } })
    return () => { current = false }
  }, [tick])

  const list = rows ?? []
  const outstanding = list.reduce((a, r) => a + num(r, 'outstanding_amount'), 0)

  async function run(id: string, action: AdvanceAction) {
    setBusy(true)
    try {
      await te.finance.advanceAct(id, action, {
        ...(amount ? { amount: Number(amount) } : {}),
        ...(reference ? { ref: reference } : {}),
      })
      onToast('Done.')
      setActing(null); setAmount(''); setReference(''); reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Advance desk</h1>
          <p>Money paid before a trip. It is set against that trip&rsquo;s claim; anything left over comes back.</p>
        </div>
      </div>

      <div className="g3">
        <div className="tile"><div className="l">Out with employees</div><div className="v num">{rs(outstanding)}</div><div className="s">across {list.filter(r => num(r, 'outstanding_amount') > 0).length} advances</div></div>
        <div className="tile"><div className="l">Waiting to pay</div><div className="v num">{list.filter(r => ['REQUESTED', 'APPROVED'].includes(str(r, 'status'))).length}</div><div className="s">approved, not yet released</div></div>
        <div className="tile"><div className="l">Overdue</div><div className="v num">{list.filter(r => num(r, 'outstanding_amount') > 0 && str(r, 'due_date') && str(r, 'due_date') < new Date().toISOString().slice(0, 10)).length}</div><div className="s">past their settle date</div></div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="card pad0">
        <div className="day"><span>Every advance</span><span>{list.length}</span></div>
        {rows === null ? <div className="empty"><b>Loading…</b></div> : null}
        {rows !== null && !list.length ? <div className="empty"><b>Nothing here</b>Advances appear when an employee asks for one on a trip plan.</div> : null}
        {list.map(r => {
          const id = str(r, 'id')
          const status = str(r, 'status')
          const out = num(r, 'outstanding_amount')
          const actions = advanceActions(status, out)
          const open = acting?.id === id ? acting : null
          const offer = open ? actions.find(a => a.action === open.action) : null
          return (
            <div key={id} className="li">
              <span className="ico"><TeIcon name="advances" /></span>
              <div className="grow">
                <div className="b">{str(r, 'employee_name') || str(r, 'advance_no')}</div>
                <div className="small muted">
                  <span className="mono">{str(r, 'advance_no')}</span>
                  {str(r, 'trip_name') ? ` · ${str(r, 'trip_name')}` : ''}
                  {str(r, 'due_date') ? ` · due ${str(r, 'due_date')}` : ''}
                </div>
                {actions.length ? (
                  <div className="row tight">
                    {actions.map(a => (
                      <button
                        key={a.action}
                        type="button"
                        className={a.grave ? 'btn sm dan' : 'btn sm'}
                        aria-pressed={open?.action === a.action}
                        onClick={() => { setActing(open?.action === a.action ? null : { id, action: a.action }); setAmount(''); setReference('') }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                ) : <span className="small muted">Nothing to do</span>}

                {offer ? (
                  <div className="form">
                    <p className="small muted">{offer.effect}</p>
                    {offer.amount ? (
                      <label className="fld sm"><span>Amount (₹)</span>
                        <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder={String(out || num(r, 'requested_amount'))} />
                      </label>
                    ) : null}
                    {offer.reference ? (
                      <label className="fld sm"><span>Reference</span>
                        <input value={reference} onChange={e => setReference(e.target.value)} placeholder="UTR or voucher" />
                      </label>
                    ) : null}
                    <button type="button" className={offer.grave ? 'btn dan' : 'btn pri'} disabled={busy} onClick={() => run(id, offer.action)}>
                      {busy ? 'Working…' : offer.label}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="amt">
                <b>{rs(out)}</b><span className="small muted">outstanding</span>
                <div><span className="chip plain">{status.replace(/_/g, ' ').toLowerCase()}</span></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
