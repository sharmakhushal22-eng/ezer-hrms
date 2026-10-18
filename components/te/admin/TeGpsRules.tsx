'use client'
// components/te/admin/TeGpsRules.tsx — trip and GPS rules. Screen c3.
//
// The numbers that decide when a recorded journey is believed. Each one is a
// trade: a tighter accuracy limit throws away more fixes and leaves more
// gaps; a shorter gap threshold flags more journeys that were only a phone in
// a pocket. So each says what it does rather than just carrying a label.
import { useMemo, useState } from 'react'
import { te } from '@/lib/te/client'
import type { TeConfig } from '@/lib/te/types'
import { isDirty, whatChangingAffects } from '@/lib/te/admin-edit'
import { errorText } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const RULES: { k: string; label: string; unit: string; note: string }[] = [
  { k: 'pingSec', label: 'Send a position every', unit: 'seconds', note: 'More often costs battery and data; less often loses detail when the signal drops.' },
  { k: 'minAccuracy', label: 'Ignore a fix worse than', unit: 'metres', note: 'A fix guessed from wifi can be a kilometre out and makes a journey look like it teleported.' },
  { k: 'gapMin', label: 'Call it a gap after', unit: 'minutes of silence', note: 'A phone browser stops reading location when the screen locks, so a short threshold flags ordinary pocketed phones.' },
  { k: 'maxSpeed', label: 'Call it an impossible jump above', unit: 'km/h', note: 'Two fixes further apart than this speed allows cannot both be right.' },
  { k: 'startRadius', label: 'Started away from the place if beyond', unit: 'metres', note: 'How far from where the journey should begin counts as somewhere else.' },
  { k: 'endRadius', label: 'Ended away from the place if beyond', unit: 'metres', note: 'The same, at the other end.' },
  { k: 'localMaxKm', label: 'A local trip reaches at most', unit: 'km', note: 'Beyond this the trip has to be planned as domestic.' },
  { k: 'preApproveKm', label: 'A local trip needs no approval up to', unit: 'km', note: 'Short local travel goes ahead without anybody signing it off.' },
  { k: 'pastDays', label: 'A past trip can be recorded within', unit: 'days', note: 'After this, travel that was not tracked can no longer be added.' },
]

/** The kinds of trip the lead time can cover. `word` is how the summary line
 *  reads it back, which is not the same as the heading on a checkbox. */
const SCOPES: { id: string; label: string; word: string }[] = [
  { id: 'local', label: 'Local', word: 'local' },
  { id: 'domestic', label: 'Domestic', word: 'domestic' },
  { id: 'international', label: 'International', word: 'international' },
]

const TOGGLES: { k: string; label: string; note: string }[] = [
  { k: 'manualAllowed', label: 'Allow local journeys without GPS', note: 'Off means a local trip is only ever paid on a recorded journey.' },
  { k: 'gpsRequired', label: 'Require GPS on a journey', note: 'Off lets a journey be filed with no recording at all.' },
  { k: 'intlTrack', label: 'Track continuously abroad', note: 'Off uses check-ins at each end instead, which uses less data roaming.' },
]

/* The parent remounts this on a fresh config (key={configKey}), so the local
 * draft starts from the new truth without an effect syncing it. */
export default function TeGpsRules({ cfg, onSaved, onToast }: {
  cfg: TeConfig
  onSaved: () => void
  onToast: (message: string) => void
}) {
  const [track, setTrack] = useState<Record<string, unknown>>(cfg.track ?? {})
  // The lead time's number lives in its own te_settings column rather than in
  // gps_rules, so it is held separately and sent in the same PATCH.
  const [noticeDays, setNoticeDays] = useState<number>(cfg.noticeDays ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const dirty = useMemo(
    () => isDirty(cfg.track, track) || noticeDays !== (cfg.noticeDays ?? 0),
    [cfg.track, track, noticeDays, cfg.noticeDays],
  )
  const numOf = (k: string) => (typeof track[k] === 'number' ? track[k] as number : 0)
  const boolOf = (k: string) => track[k] !== false
  const scopesOn: string[] = Array.isArray(track.noticeScopes)
    ? track.noticeScopes as string[]
    : ['domestic', 'international']
  const blocks = track.noticeAction !== 'warn'
  const toggleScope = (id: string) => setTrack(t => {
    const now = Array.isArray(t.noticeScopes) ? t.noticeScopes as string[] : ['domestic', 'international']
    return { ...t, noticeScopes: now.includes(id) ? now.filter(x => x !== id) : [...now, id] }
  })

  async function save() {
    setBusy(true); setError('')
    try {
      await te.admin.settingsSave({ gps_rules: track, notice_days: noticeDays })
      onToast('Trip rules saved.')
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
          <h1>Trip and GPS rules</h1>
          <p>When a recorded journey is believed, and how far a local trip can go.</p>
        </div>
      </div>

      {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}

      <div className="card pad0">
        <div className="day"><span>Numbers</span><span>{RULES.length}</span></div>
        {RULES.map(r => (
          <div key={r.k} className="li">
            <div className="grow">
              <div className="b">{r.label}</div>
              <div className="small muted">{r.note}</div>
            </div>
            <div className="amt">
              <input type="number" min={0} value={numOf(r.k)} onChange={e => setTrack(t => ({ ...t, [r.k]: Number(e.target.value) }))} />
              <span className="small muted">{r.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── the booking lead time ──
          Its own card because it is the one rule here that refuses a plan
          outright, and because the three controls only make sense read
          together: how long, for which trips, and what happens. */}
      <div className="card pad0">
        <div className="day"><span>Notice before travel</span><span>{noticeDays ? `${noticeDays} ${noticeDays === 1 ? 'day' : 'days'}` : 'Off'}</span></div>

        <div className="li">
          <div className="grow">
            <div className="b">Plan a trip at least</div>
            <div className="small muted">
              A plan is not a ticket. The Travel Desk has to find a fare and Finance has to release the money,
              and a seat asked for the same week is dearer when it can be had at all. Zero switches the rule off.
            </div>
          </div>
          <div className="amt">
            <input type="number" min={0} max={60} value={noticeDays} onChange={e => setNoticeDays(Math.max(0, Number(e.target.value) || 0))} />
            <span className="small muted">days before leaving</span>
          </div>
        </div>

        <div className="li">
          <div className="grow">
            <div className="b">Which trips it applies to</div>
            <div className="small muted">
              Local travel is normally left out: nothing is booked for it. Tick it only if your desk books local
              cabs in advance too.
            </div>
          </div>
          <div className="row tight">
            {SCOPES.map(s => (
              <label key={s.id} className="check small">
                <input type="checkbox" checked={scopesOn.includes(s.id)} onChange={() => toggleScope(s.id)} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="li">
          <div className="grow">
            <div className="b">Too little notice</div>
            <div className="small muted">
              {blocks
                ? 'The plan cannot be sent, and the employee is told the earliest date that works.'
                : 'The plan goes through and the approver is told the notice was short.'}
            </div>
          </div>
          <div className="seg sm" role="group" aria-label="What happens with too little notice">
            <button type="button" aria-pressed={blocks} onClick={() => setTrack(t => ({ ...t, noticeAction: 'block' }))}>Refuse the plan</button>
            <button type="button" aria-pressed={!blocks} onClick={() => setTrack(t => ({ ...t, noticeAction: 'warn' }))}>Only tell the approver</button>
          </div>
        </div>

        {noticeDays > 0 && scopesOn.length ? (
          <div className="li">
            <span className="small muted">
              As set: a {scopesOn.map(s => SCOPES.find(x => x.id === s)?.word ?? s).join(' or ')} trip
              {' '}{blocks ? 'cannot be planned' : 'is flagged if planned'} within {noticeDays}{' '}
              {noticeDays === 1 ? 'day' : 'days'} of leaving.
            </span>
          </div>
        ) : null}
      </div>

      <div className="card pad0">
        <div className="day"><span>Switches</span><span>{TOGGLES.length}</span></div>
        {TOGGLES.map(t => (
          <div key={t.k} className="li">
            <div className="grow">
              <div className="b">{t.label}</div>
              <div className="small muted">{t.note}</div>
            </div>
            <label className="check small">
              <input type="checkbox" checked={boolOf(t.k)} onChange={e => setTrack(s => ({ ...s, [t.k]: e.target.checked }))} />
              <span>{boolOf(t.k) ? 'On' : 'Off'}</span>
            </label>
          </div>
        ))}
      </div>

      {dirty ? (
        <div className="card">
          <div className="note"><TeIcon name="info" size="sm" /><span>{whatChangingAffects('gps')}</span></div>
          <div className="row tight">
            <button type="button" className="btn" onClick={() => setTrack(cfg.track ?? {})}>Undo the changes</button>
            <button type="button" className="btn pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save the rules'}</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
