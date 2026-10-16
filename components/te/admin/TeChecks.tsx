'use client'
// components/te/admin/TeChecks.tsx — the checks run against every claim.
// Screen c6.
//
// Each check can block a line, ask the employee for a reason, or just tell
// the approver. Switching one off does not make the problem go away — it
// makes it invisible, which is a decision worth taking deliberately. The
// screen counts what is off and says so.
import { useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeCheck, TeConfig } from '@/lib/te/types'
import { changedRows, isDirty, whatChangingAffects } from '@/lib/te/admin-edit'
import { errorText } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const ACTIONS: { id: string; label: string; note: string }[] = [
  { id: 'block', label: 'Block', note: 'The line cannot be claimed until it is fixed.' },
  { id: 'reason', label: 'Ask why', note: 'The employee must explain before submitting.' },
  { id: 'flag', label: 'Tell the approver', note: 'Shown on the claim; nothing is stopped.' },
]

/* The parent remounts this on a fresh config (key={configKey}), so the local
 * draft starts from the new truth without an effect syncing it. */
export default function TeChecks({ cfg, onSaved, onToast }: {
  cfg: TeConfig
  onSaved: () => void
  onToast: (message: string) => void
}) {
  const [checks, setChecks] = useState<TeCheck[]>(cfg.checks ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const dirty = useMemo(() => isDirty(cfg.checks, checks), [cfg.checks, checks])
  const off = checks.filter(c => !c.on).length
  const byLayer = useMemo(() => {
    const m = new Map<string, TeCheck[]>()
    for (const c of checks) m.set(c.layer, [...(m.get(c.layer) ?? []), c])
    return [...m.entries()]
  }, [checks])

  const set = (code: string, patch: Partial<TeCheck>) =>
    setChecks(cs => cs.map(c => (c.c === code ? { ...c, ...patch } : c)))

  async function save() {
    setBusy(true); setError('')
    try {
      const rows = changedRows(cfg.checks ?? [], checks)
      const r = await te.admin.mastersSave('te_checks', rows as unknown as Record<string, unknown>[])
      onToast(`${r.updated + r.inserted} check${r.updated + r.inserted === 1 ? '' : 's'} saved.`)
      onSaved()
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
          <h1>Checks</h1>
          <p>What is tested on every claim, and what happens when a test fails.</p>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      {off ? (
        <div className="flag warn">
          <TeIcon name="alert" />
          <div className="tx">
            <b>{off} check{off === 1 ? ' is' : 's are'} switched off</b>
            <p>Switching a check off does not make the problem go away; it stops anybody being told about it.</p>
          </div>
        </div>
      ) : null}

      {byLayer.map(([layer, list]) => (
        <div key={layer} className="card pad0">
          <div className="day"><span>{layer}</span><span>{list.filter(c => c.on).length} of {list.length} on</span></div>
          {list.map(c => (
            <div key={c.c} className="li">
              <span className="ico"><TeIcon name={c.a === 'block' ? 'alert' : 'info'} /></span>
              <div className="grow">
                <div className="b"><span className="code">{c.c}</span> {c.t}</div>
                <div className="row tight">
                  {ACTIONS.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      className="chip plain"
                      aria-pressed={c.a === a.id}
                      title={a.note}
                      disabled={!c.on}
                      onClick={() => set(c.c, { a: a.id as TeCheck['a'] })}
                    >
                      {a.label}
                    </button>
                  ))}
                  {c.live ? <span className="chip plain t-brand">Checked as they type</span> : null}
                </div>
                <div className="small muted">{ACTIONS.find(a => a.id === c.a)?.note}</div>
              </div>
              <label className="check small">
                <input type="checkbox" checked={c.on} onChange={e => set(c.c, { on: e.target.checked })} />
                <span>{c.on ? 'On' : 'Off'}</span>
              </label>
            </div>
          ))}
        </div>
      ))}

      {dirty ? (
        <div className="card">
          <div className="note"><TeIcon name="info" size="sm" /><span>{whatChangingAffects('checks')}</span></div>
          <div className="row tight">
            <button type="button" className="btn" onClick={() => setChecks(cfg.checks ?? [])}>Undo the changes</button>
            <button type="button" className="btn pri" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : `Save ${changedRows(cfg.checks ?? [], checks).length} change${changedRows(cfg.checks ?? [], checks).length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
