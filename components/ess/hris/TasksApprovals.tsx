'use client'
/**
 * Tasks & Approvals — redesigned.
 *
 * NOTHING ABOUT THE CONTRACT MOVES. The list is still GET /api/ess/approvals,
 * the actions still POST the same body, the chain is still fetched on demand
 * with ?resignation_id=, and the action sets come from the server — this file
 * renders `item.actions`, it does not decide them.
 *
 * `mine` is the line that matters: stamped to you means you may act, anything
 * surfaced by scope is oversight and its card says which scope put it there.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChainRow, PendingItem } from './types'
import { Ic, type IconKey } from './icons'
import { CountUp, fmtDateTime, riseStyle, useToast } from './ui'

type Filter = 'MINE' | 'ALL' | 'LEAVE' | 'TRAVEL' | 'RESIGNATION'

const CHIPS: [Filter, string][] = [
  ['MINE', 'Waiting on me'], ['ALL', 'Everything'],
  ['LEAVE', 'Leave'], ['TRAVEL', 'Travel'], ['RESIGNATION', 'Resignation'],
]
const KIND: Record<PendingItem['kind'], [IconKey, string]> = {
  LEAVE: ['clock', 'Leave'], TRAVEL: ['plane', 'Travel'], RESIGNATION: ['door', 'Resignation'],
}
/** Same four as the live screen — an action that collects input before it fires. */
const needsInput = (a: string) => ['Accept with my date', 'Request retention', 'Set final LWD', 'Decline'].includes(a)

interface Props {
  employeeId: string
  api: (path: string, init?: RequestInit) => Promise<any>
  /** Send the user to another portal tab — travel claims are actioned there. */
  go: (k: string) => void
  onCount: (waitingOnMe: number) => void
}

export function TasksApprovals({ employeeId, api, go, onCount }: Props) {
  const [items, setItems] = useState<PendingItem[] | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('MINE')
  const counted = useRef(false)
  const animated = useRef(false)
  const toast = useToast()

  const load = useCallback(() => api('/api/ess/approvals')
    .then(d => { setItems(d.items || []); setErr('') })
    .catch(e => setErr(e.message)), [api])
  useEffect(() => { void load() }, [load])

  const mine = useMemo(() => (items || []).filter(i => i.mine).length, [items])
  useEffect(() => { if (items) onCount(mine) }, [items, mine, onCount])

  if (err) return <div className="hx-note d">{err}</div>
  if (!items) return <div style={{ fontSize: 12.5, color: 'var(--ez-faint)' }}>Loading…</div>

  const shown = items.filter(i => filter === 'ALL' ? true : filter === 'MINE' ? i.mine : i.kind === filter)
  const kpis: { k: string; v: number; tone?: string }[] = [
    { k: 'Waiting on you', v: mine, tone: mine ? 'warn' : 'ok' },
    { k: 'In your scope', v: items.length - mine },
    { k: 'Resignations', v: items.filter(i => i.kind === 'RESIGNATION').length },
    { k: 'Leave & travel', v: items.filter(i => i.kind !== 'RESIGNATION').length },
  ]
  const runCount = !counted.current; counted.current = true
  const animate = !animated.current; animated.current = true

  return (
    <>
      <div className="hx-kpis">
        {kpis.map(k => (
          <div className={`hx-kpi${k.tone === 'warn' ? ' warn' : ''}`} key={k.k}>
            <div className="k">{k.k}</div>
            <div className={`v ${k.tone || ''}`}><CountUp value={k.v} run={runCount} /></div>
            <span className="spark" />
          </div>
        ))}
      </div>

      <div className="hx-card pad">
        <div className="hx-sec">
          <h2>Approvals</h2><span className="grow" />
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CHIPS.map(([k, l]) => (
              <button key={k} className="hx-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </span>
        </div>

        <div className="hx-appr">
          {shown.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--ez-muted)', padding: '6px 0' }}>
              Nothing here — {filter === 'MINE' ? 'nothing is waiting on you.' : 'nothing in this view.'}
            </div>
          ) : shown.map((it, i) => (
            <PendingCard key={`${it.kind}:${it.id}`} item={it} api={api} go={go} animate={animate} i={i}
              onDone={m => { toast(m); void load() }} />
          ))}
        </div>

        <div className="hx-foot">
          Items stamped to you can be actioned here. Items in your wider scope (HOD department, HR / Finance role)
          are shown for oversight; the person they are stamped to acts on them. Travel claims are actioned from the
          Travel Claims screen.
        </div>
      </div>
    </>
  )
}

function PendingCard({ item, api, go, animate, i, onDone }: {
  item: PendingItem; api: Props['api']; go: (k: string) => void
  animate: boolean; i: number; onDone: (msg: string) => void
}) {
  const [ask, setAsk] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [lwd, setLwd] = useState('')
  const [regret, setRegret] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [chain, setChain] = useState<ChainRow[] | null>(null)

  async function fire(a: string) {
    setErr('')
    // Travel claims are actioned on their own screen, never here.
    if (a === 'Open claim') { go(item.link || 'claims'); return }
    if (a === 'View') return
    if (a === 'View full chain') {
      if (chain) { setChain(null); return }
      try { const r = await api(`/api/ess/approvals?resignation_id=${item.id}`); setChain(r.chain || []) }
      catch (e) { setErr((e as Error).message) }
      return
    }
    if (needsInput(a) && ask !== a) { setAsk(a); return }
    if (a === 'Set final LWD' && !lwd) { setErr('Pick the final last working day'); return }
    setBusy(true)
    try {
      await api('/api/ess/approvals', {
        method: 'POST',
        body: JSON.stringify({ kind: item.kind, id: item.id, action: a, note: note || null, lwd: lwd || null, regrettable: regret }),
      })
      onDone(`${a} — done`)
    } catch (e) { setErr((e as Error)?.message || String(e)) } finally { setBusy(false) }
  }

  const [icon, label] = KIND[item.kind]
  const noteLabel = ask === 'Request retention' ? 'What you plan to discuss'
    : ask === 'Decline' ? 'Reason (shown to the employee)' : 'Note (optional)'

  return (
    <div className={`hx-pcard ${item.mine ? 'mine' : 'scope'}${animate ? ' hx-rise' : ''}${busy ? ' busy' : ''}`}
      style={animate ? riseStyle(i) : undefined}>
      <div className="top">
        <div>
          <div className="who">{item.who}</div>
          <div className="what"><span className="hx-kind"><Ic k={icon} />{label}</span>{item.what}</div>
        </div>
        <span className={`hx-pill ${item.mine ? 'warn' : 'mut'}`}>
          {item.mine ? item.stage : `${item.stage} · ${item.surfaced_via}`}
        </span>
      </div>
      {item.meta && <div className="meta">{item.meta}</div>}

      <div className="hx-actions">
        {item.actions.map((a, idx) => {
          const primary = idx === 0 && item.mine && a !== 'View'
          const danger = /decline|retention/i.test(a)
          return (
            <button key={a} disabled={busy} onClick={() => void fire(a)}
              className={primary ? 'hx-btn sm' : danger ? 'hx-btn d sm' : 'hx-btn o sm'}>{a}</button>
          )
        })}
      </div>

      {ask && (
        <div className="hx-form">
          {(ask === 'Accept with my date' || ask === 'Set final LWD') && (
            <div>
              <label className="hx-label">{ask === 'Set final LWD' ? 'Final last working day' : 'Proposed last working day'}</label>
              <input type="date" className="hx-input" value={lwd} onChange={e => setLwd(e.target.value)} />
            </div>
          )}
          {ask === 'Set final LWD' && (
            <div>
              <label className="hx-label">Regrettable exit?</label>
              <div className="hx-toggle">
                <button className={`hx-btn ${regret === true ? '' : 'o'} sm`} onClick={() => setRegret(true)}>Yes — regrettable</button>
                <button className={`hx-btn ${regret === false ? '' : 'o'} sm`} onClick={() => setRegret(false)}>No</button>
              </div>
            </div>
          )}
          <div>
            <label className="hx-label">{noteLabel}</label>
            <textarea className="hx-area" style={{ minHeight: 60 }} value={note} onChange={e => setNote(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="hx-btn sm" disabled={busy} onClick={() => void fire(ask)}>Confirm — {ask}</button>
            <button className="hx-btn o sm" onClick={() => { setAsk(null); setNote(''); setLwd('') }}>Cancel</button>
          </div>
        </div>
      )}

      {item.tone && !ask && (
        <div className={`hx-note ${item.tone}`} style={{ marginTop: 10 }}>
          {item.tone === 'w' ? 'Time-sensitive.' : 'Needs a conversation, not just a click.'}
        </div>
      )}
      {err && <div className="hx-note d" style={{ marginTop: 8 }}>{err}</div>}

      {chain && (
        <div className="hx-chain">
          <div className="hx-sec" style={{ marginBottom: 8 }}><h2 style={{ fontSize: 12 }}>Full chain</h2></div>
          {chain.length === 0 && <div style={{ fontSize: 12, color: 'var(--ez-faint)' }}>No stage entries yet.</div>}
          {chain.map((c, idx) => (
            <div className="r" key={idx}>
              <b>{c.stage}</b> · {c.action.toLowerCase().replace(/_/g, ' ')}
              {c.approver?.full_name ? ` · ${c.approver.full_name}` : ''}
              {c.proposed_lwd ? ` · LWD ${c.proposed_lwd}` : ''}
              <span className="tm">{fmtDateTime(c.actioned_at)}</span>
              {c.note && <div className="nt">“{c.note}”</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
