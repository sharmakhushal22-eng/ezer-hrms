'use client'
// components/te/vehicle/TeLimitsAndRates.tsx — screen 76, "My limits and rates".
//
// What this employee may spend, and on what rate their own vehicle is paid.
// Every number is cfg: the policy an admin published, read straight out of the
// snapshot. Nothing here is worked out, and nothing here can be changed from
// this screen — it answers "what am I allowed?" before a trip, so the answer
// does not arrive as a refusal afterwards.
import { useState } from 'react'
import type { Snapshot } from '@/lib/te/types'
import { ratePerKm, rcMarks, vehicleSubtitle, WHOSE_LABEL } from '@/lib/te/vehicle'
import { rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeVehicleAdd from './TeVehicleAdd'

/** The city groups a limit is set per. The labels are the policy's own. */
const TIERS: { id: string; name: string }[] = [
  { id: 'metro', name: 'Metro' },
  { id: 'tier1', name: 'Tier 1' },
  { id: 'rest', name: 'Rest of India' },
  { id: 'intlA', name: 'International, group A' },
  { id: 'intlB', name: 'International, group B' },
]

export default function TeLimitsAndRates({ snap, onChanged }: {
  snap: Snapshot
  onChanged: (message: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const me = snap.emp[snap.me]
  const grade = me?.grade || snap.cfg.defaultGrade
  const limits = snap.cfg.limits[grade] ?? {}
  const types = snap.cfg.vehicles.filter(v => v.on)
  const mine = snap.vehicles.filter(v => v.emp === snap.me)

  // The cities in each group, so "Tier 1" is not an unexplained label.
  const citiesIn = (tier: string) => Object.entries(snap.masters.cities)
    .filter(([, v]) => v[0] === tier).map(([city]) => city)

  const rates = types.map(t => ratePerKm(t, snap.cfg.fuelPrice)).filter(r => r > 0)

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>My limits and rates</h1>
          <p>These limits apply to you as grade {grade}. They come from the policy your company has published.</p>
        </div>
      </div>

      <div className="card pad0">
        <div className="tw">
          <table className="tbl">
            <thead>
              <tr>
                <th>City group</th><th>Cities</th>
                <th className="r">Hotel a night</th><th className="r">Food a day</th><th className="r">Local conveyance a day</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.filter(t => limits[t.id]).map(t => {
                const cities = citiesIn(t.id)
                return (
                  <tr key={t.id}>
                    <td className="b">{t.name}</td>
                    <td className="small muted">
                      {t.id === 'intlA' ? `${snap.cfg.zoneA.slice(0, 7).join(', ')}${snap.cfg.zoneA.length > 7 ? ` and ${snap.cfg.zoneA.length - 7} more countries` : ''}`
                        : t.id === 'intlB' ? 'Every other country'
                          : cities.length ? cities.join(', ') : '—'}
                    </td>
                    <td className="r">{rs(limits[t.id].hotel)}</td>
                    <td className="r">{rs(limits[t.id].meals)}</td>
                    <td className="r">{rs(limits[t.id].conv)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="g3">
        <div className="tile">
          <div className="l">Travel class</div>
          <div className="v">{snap.cfg.airClass[grade] ?? '—'} · {snap.cfg.trainClass[grade] ?? '—'}</div>
          <div className="s">Flight and train</div>
        </div>
        <div className="tile">
          <div className="l">Own vehicle</div>
          <div className="v">{rates.length ? `${rs(Math.min(...rates))} to ${rs(Math.max(...rates))} a km` : 'Not offered'}</div>
          <div className="s">By vehicle type, on the GPS distance</div>
        </div>
        <div className="tile">
          <div className="l">Advance</div>
          <div className="v">Up to {snap.cfg.advanceMaxPct}%</div>
          <div className="s">of the self-paid estimate</div>
        </div>
      </div>

      <div className="card" id="my-vehicles">
        <div className="ch">
          <h3>My vehicles</h3>
          <button type="button" className={adding ? 'btn sm' : 'btn sm pri'} onClick={() => setAdding(v => !v)}>
            <TeIcon name={adding ? 'close' : 'plus'} size="sm" />{adding ? 'Close' : 'Add a vehicle'}
          </button>
        </div>
        <p className="small muted">
          Every vehicle you drive for work is added by its number. Its RC sets the type and the rate a km,
          so a hatchback is not paid as an SUV.
        </p>

        {adding ? (
          <TeVehicleAdd
            snap={snap}
            first={!mine.length}
            onClose={() => setAdding(false)}
            onAdded={(_id, message) => { setAdding(false); onChanged(message) }}
          />
        ) : null}

        <div className="stack sm">
          {mine.length ? mine.map(v => (
            <div key={v.id} className="vrow">
              <span className="ico-b sm"><TeIcon name={v.type === 'bike' ? 'bike' : 'car'} size="sm" /></span>
              <div className="grow">
                <div className="row tight wrap">
                  <b className="mono">{v.reg}</b>
                  {v.verified
                    ? <span className="chip plain t-pos"><TeIcon name="verify" size="sm" />{v.vby === 'hr' ? 'RC checked by HR' : 'RC checked'}</span>
                    : <span className="chip plain t-warn">HR to check the RC</span>}
                  {v.whose && v.whose !== 'self' ? <span className="chip plain">{WHOSE_LABEL[v.whose] ?? v.whose}</span> : null}
                </div>
                <div className="small muted">{vehicleSubtitle(v, snap.cfg.vehicles, snap.cfg.fuelPrice)}</div>
                {v.rc ? (
                  <div className="vvalid">
                    {rcMarks(v.rc, snap.today).map(m => (
                      <span key={m.label} className={`vok ${m.tone === 'mute' ? 'mute' : m.tone}`}>
                        {m.tone === 'mute' ? null : <TeIcon name={m.tone === 'bad' ? 'alert' : 'check'} size="sm" />}
                        {m.text}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )) : (
            <div className="empty"><b>No vehicle yet</b>Add one to claim travel by your own vehicle.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="ch"><h3>Rules that apply to every claim</h3></div>
        <div className="g2">
          <Rule icon="clock" title={`Bills older than ${snap.cfg.billAgeDays} days are not accepted`} note="Counted from the bill date." />
          <Rule icon="cal" title={`Submit within ${snap.cfg.claimDeadlineDays} days of return`} note="After that, a reason is asked." />
          <Rule icon="receipt" title={`A bill is needed above ${rs(snap.cfg.receiptAbove)}`} note="Hotel, air, train and client bills always need one." />
          <Rule icon="pin" title={`No-bill local conveyance up to ${rs(snap.cfg.noBillPerDay)} a day`} note="Auto and metro rides without a receipt." />
          <Rule icon="people" title={`Client entertainment up to ${rs(snap.cfg.clientPerHead)} a head`} note="Name the client and the number of people." />
          <Rule icon="receipt" title="Caps on each claim" note={`Miscellaneous ${rs(snap.cfg.miscPerClaim)}, courier and communication ${rs(snap.cfg.commPerClaim)}.`} />
        </div>
      </div>
    </div>
  )
}

/** One policy rule. Outside the parent so it is not remade on every render. */
function Rule({ icon, title, note }: { icon: string; title: string; note: string }) {
  return (
    <div className="flag info">
      <TeIcon name={icon} />
      <div className="tx"><b>{title}</b><p>{note}</p></div>
    </div>
  )
}
