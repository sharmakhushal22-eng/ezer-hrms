'use client'
// components/te/vehicle/TeVehicleAdd.tsx — add a vehicle by its number.
// Screens 27, 70, 71, 72, 73, 74, 75.
//
// Three steps in one panel: what kind of vehicle it is, its number, then what
// the RC says. The RC is the authority — it sets the type, and the type sets
// the rate a km, so a hatchback declared as an SUV is paid as a hatchback and
// the screen says so rather than quietly paying less.
//
// Four answers come back from the lookup and each has its own screen:
//   found         the RC card, the type comparison, the owner, the validity
//   not found     Vahan does not know it: attach a photo, HR checks it
//   off           the company does not check RCs: same photo path
//   bad format    refused before Vahan is asked, so a typo costs nothing
import { useState } from 'react'
import { te, type VehicleLookup } from '@/lib/te/client'
import type { RcChecked, Snapshot, Uuid } from '@/lib/te/types'
import {
  isRegValid, normaliseReg, ownerNote, ratePerKm, rcMarks, saveGate, showReg,
  REG_FORMAT_MESSAGE, WHOSE_LABEL,
} from '@/lib/te/vehicle'
import { errorText, rs } from '@/lib/te/format'
import TeIcon from '../TeIcon'

const vehIcon = (type: string) => (type === 'bike' ? 'bike' : 'car')

export default function TeVehicleAdd({ snap, first, onAdded, onClose }: {
  snap: Snapshot
  /** true when the person has no vehicle yet, which changes the heading. */
  first?: boolean
  onAdded: (vehicleId: Uuid, message: string) => void
  onClose?: () => void
}) {
  const [type, setType] = useState('')
  const [reg, setReg] = useState('')
  const [found, setFound] = useState<VehicleLookup | null>(null)
  const [whose, setWhose] = useState('')
  const [photo, setPhoto] = useState<{ name: string; url: string } | null>(null)
  const [busy, setBusy] = useState<'' | 'check' | 'save' | 'photo'>('')
  const [error, setError] = useState('')

  const types = snap.cfg.vehicles.filter(v => v.on)
  const rules = snap.cfg.vehx
  const rc: RcChecked | null = found && 'rc' in found ? found.rc : null
  const unknown = !!found && ('notFound' in found || 'off' in found)
  const checkOff = !!found && 'off' in found
  const gate = saveGate({ rc, rules, today: snap.today })
  const marks = rcMarks(rc, snap.today)
  const typeName = (id: string) => types.find(t => t.id === id)?.name ?? 'Vehicle'
  const rate = (id: string) => ratePerKm(types.find(t => t.id === id), snap.cfg.fuelPrice)

  /** Anything typed into the number invalidates the answer we had. */
  const editReg = (v: string) => { setReg(v); setFound(null); setWhose(''); setPhoto(null); setError('') }

  async function check() {
    if (!type) { setError('First say what vehicle it is.'); return }
    if (!isRegValid(reg)) { setError(REG_FORMAT_MESSAGE); return }
    setBusy('check'); setError(''); setFound(null); setWhose(''); setPhoto(null)
    try {
      const r = await te.vehicleLookup(normaliseReg(reg))
      setFound(r)
      if ('rc' in r) setReg(showReg(r.rc.no))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  async function attach(picked: File | undefined) {
    if (!picked) return
    setBusy('photo'); setError('')
    try {
      const stored = await te.upload(picked, 'RC')
      // VehicleInput.rc_file_url takes the storage path, not a signed URL —
      // the type says so on TeUploadedFile.kind.
      setPhoto({ name: stored.file_name, url: stored.storage_path })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  async function save() {
    setBusy('save'); setError('')
    try {
      const r = await te.vehicleAdd({
        reg: normaliseReg(reg),
        type,
        whose: (whose || 'self') as 'self' | 'family' | 'other',
        ...(photo ? { rc_file_url: photo.url } : {}),
      })
      // The server is the one that says what it is paid as, so the message
      // quotes its answer rather than what was typed.
      onAdded(r.vehicle_id, r.is_verified
        ? `Added ${showReg(reg)}. RC checked: paid as ${typeName(r.vehicle_type_code)}.`
        : `Added ${showReg(reg)}. HR will check the RC.`)
    } catch (e) {
      setError(errorText(e)); setBusy('')
    }
  }

  const whoseRow = (options: string[]) => (
    <div className="fld">
      <span>Whose vehicle is it?</span>
      <div className="opts sm" role="group" aria-label="Whose vehicle">
        {options.map(k => (
          <button key={k} type="button" className="opt" aria-pressed={whose === k} onClick={() => { setWhose(k); setError('') }}>
            {WHOSE_LABEL[k]}
          </button>
        ))}
      </div>
      <small className={rules.owner === 'self' ? 'pst bad' : 'muted'}>{ownerNote(rules)}</small>
    </div>
  )

  return (
    <div className="vform">
      <div className="vform-h">
        <span className="ico-b sm"><TeIcon name="verify" size="sm" /></span>
        <div className="grow">
          <b>{first ? 'Add the vehicle you drive' : 'Add a vehicle'}</b>
          <small>Your own, a family member’s or another. EZER reads its RC (registration certificate) to confirm what it is, and pays by that.</small>
        </div>
        {onClose ? <button type="button" className="iconbtn sm" aria-label="Close" onClick={onClose}><TeIcon name="close" size="sm" /></button> : null}
      </div>

      <div className="fld">
        <span>1. What vehicle is it?</span>
        <div className="opts sm" role="group" aria-label="Vehicle type">
          {types.map(t => (
            <button key={t.id} type="button" className="opt" aria-pressed={type === t.id} onClick={() => { setType(t.id); setError('') }}>
              <TeIcon name={vehIcon(t.id)} size="sm" />{t.name}
            </button>
          ))}
        </div>
      </div>

      <div className="vnum">
        <label className="fld">
          <span>2. Vehicle number, as on the RC</span>
          <input
            className="mono"
            value={reg}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            placeholder="HR26 DK 4821 or 22 BH 1234 AA"
            onChange={e => editReg(e.target.value)}
          />
        </label>
        <button type="button" className="btn pri" disabled={busy === 'check'} onClick={check}>
          <TeIcon name="verify" size="sm" />{busy === 'check' ? 'Checking…' : 'Check RC'}
        </button>
      </div>

      {/* Vahan did not know it, or the company does not check: a photo instead. */}
      {unknown ? (
        <>
          <div className="flag warn">
            <TeIcon name="alert" />
            <div className="tx">
              <b>{checkOff ? 'The RC check is switched off' : `Vahan could not find ${showReg(reg)}`}</b>
              <p>{checkOff ? 'Attach' : 'Check the number once more. If it is right, attach'} a photo of the RC, front and back. HR checks it and confirms the type before the vehicle is paid.</p>
            </div>
          </div>
          {whoseRow(['self', 'family', 'other'])}
          <label className={photo ? 'vphoto on' : 'vphoto'}>
            <TeIcon name={photo ? 'check' : 'file'} size="sm" />
            {busy === 'photo' ? 'Attaching…' : photo ? `${photo.name} attached · choose another to replace` : 'Attach the RC photo'}
            <input type="file" accept="image/*,application/pdf" hidden onChange={e => attach(e.target.files?.[0])} />
          </label>
          {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}
          <div className="rfoot">
            <span className="grow" />
            <button type="button" className="btn pri" disabled={busy === 'save'} onClick={save}>
              {busy === 'save' ? 'Adding…' : 'Add and send to HR'}
            </button>
          </div>
        </>
      ) : null}

      {/* Found on Vahan: what it is, whether it matches, and who owns it. */}
      {rc && found && 'rc' in found ? (
        <>
          <div className={gate.blocking ? 'rccard bad' : 'rccard'}>
            <div className="row tight">
              <span className="ico-b"><TeIcon name={vehIcon(rc.type)} /></span>
              <div className="grow">
                <b>{rc.maker} {rc.model}</b>
                <div className="small muted">{rc.cls} · {rc.body} · {rc.fuel} · registered {longDate(rc.regd)}</div>
              </div>
              <span className="chip plain t-pos"><TeIcon name="check" size="sm" />Found on Vahan</span>
            </div>

            <div className={type === rc.type ? 'vcheck ok' : 'vcheck bad'}>
              <TeIcon name={type === rc.type ? 'check' : 'alert'} size="sm" />
              <span>
                {type === rc.type
                  ? `Matches: you said ${typeName(type)}, the RC says ${rc.body.toLowerCase()}.`
                  : <>You said {typeName(type)}. The RC says {rc.body.toLowerCase()}{rc.type === 'bike' ? ', a two-wheeler' : ''}. You are paid as <b>{found.typeName}</b>.</>}
              </span>
            </div>

            <dl className="kv sm">
              <dt>Owner on the RC</dt>
              <dd>
                {found.ownerMasked}{' '}
                {found.match === 'match' ? <span className="chip plain t-pos">Your name</span>
                  : found.match === 'partial' ? <span className="chip plain t-warn">Same surname</span>
                    : <span className="chip plain t-warn">Another name</span>}
              </dd>
              <dt>Paid as</dt>
              <dd><b>{found.typeName}</b> · {rs(rate(rc.type))} a km</dd>
            </dl>

            {marks.length ? (
              <div className="vvalid">
                {marks.map(m => (
                  <span key={m.label} className={`vok ${m.tone === 'mute' ? 'mute' : m.tone}`}>
                    {m.tone === 'mute' ? null : <TeIcon name={m.tone === 'bad' ? 'alert' : 'check'} size="sm" />}
                    {m.text}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {gate.message ? <div className={gate.blocking ? 'ferr' : 'ferr warn'}><TeIcon name="alert" size="sm" />{gate.message}</div> : null}
          {found.match === 'match' ? null : whoseRow(['family', 'other'])}
          {error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}
          <div className="rfoot">
            <span className="grow" />
            <button type="button" className="btn pri" disabled={!gate.canSave || busy === 'save'} onClick={save}>
              <TeIcon name="check" size="sm" />{busy === 'save' ? 'Adding…' : 'Add and use this vehicle'}
            </button>
          </div>
        </>
      ) : null}

      {!found && error ? <div className="ferr"><TeIcon name="alert" size="sm" />{error}</div> : null}
    </div>
  )
}

/** The RC prints a full date; everything else in the module drops the year. */
function longDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`
}
