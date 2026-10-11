'use client'
// components/te/plan/TePlacePicker.tsx — choosing a place. Screens 13, 14.
//
// Three ways in, in the order most people want them: the phone's GPS, a place
// already saved, or the complete address typed out. It takes the whole drawer
// over rather than sitting beside the form, because it is a search with a map.
//
// A typed address is saved in TWO presses. The first geocodes it and shows the
// pin; the second confirms it. That is deliberate — a claim's distance is
// measured to this point, so an address dropped on the wrong side of a city is
// a money error, and the person is asked to look at the pin before committing.
import { useCallback, useEffect, useRef, useState } from 'react'
import { te } from '@/lib/te/client'
import type { PlaceInput, Snapshot, Uuid } from '@/lib/te/types'
import { errorText } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeSheet from '../TeSheet'

/** Where a chosen place is going back to. */
export type PickTarget =
  | { kind: 'point'; index: number; title: string; intl?: boolean; address?: boolean; useGps?: boolean }
  | { kind: 'hub'; index: number; side: 'A' | 'B'; title: string; hub: 'airport' | 'station' }

const SRC_WORD: Record<string, string> = { gps: 'GPS', address: 'Typed address', pin: 'Pin on map', search: 'Map search' }

export default function TePlacePicker({ snap, target, onCancel, onChosen }: {
  snap: Snapshot
  target: PickTarget
  onCancel: () => void
  /** The place id, and the type it carries when it is a company place. */
  onChosen: (placeId: Uuid, pt?: string) => void
}) {
  const intl = target.kind === 'point' && !!target.intl
  const [q, setQ] = useState(target.kind === 'hub' ? (target.hub === 'airport' ? 'airport' : 'station') : '')
  const [typing, setTyping] = useState(!!(target.kind === 'point' && target.address))
  const [addr, setAddr] = useState<PlaceInput>({ src: 'address', country: intl ? '' : 'India', city: '', line: '', area: '', pin: '', state: '' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  const typedAddressAllowed = snap.cfg.track.typedAddress !== false

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) { setNote('This device cannot read its location.'); return }
    setBusy(true); setNote('Reading your location…')
    navigator.geolocation.getCurrentPosition(
      pos => {
        te.placeAdd({ src: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy })
          .then(r => onChosen(r.place_id))
          .catch(e => { setNote(errorText(e)); setBusy(false) })
      },
      e => { setBusy(false); setNote(e.code === e.PERMISSION_DENIED ? 'Location is switched off for this site. Pick a place or type the address.' : 'Could not read your location. Pick a place or type the address.') },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }, [onChosen])

  // "Use my current location" opened this picker, so ask straight away rather
  // than making the person press it a second time. Called from a timer, not
  // from the effect body: locate() sets state, and doing that synchronously in
  // an effect cascades a second render before the first has painted.
  const wantGps = target.kind === 'point' && !!target.useGps
  useEffect(() => {
    if (!wantGps) return
    const t = setTimeout(locate, 0)
    return () => clearTimeout(t)
  }, [wantGps, locate])

  async function saveTyped() {
    // Said in the order a person fills the form, so the first thing missing is
    // the first thing mentioned.
    const missing = intl && !addr.country ? 'Choose the country.'
      : !addr.line?.trim() ? 'Enter the building and street.'
        : !addr.area?.trim() ? 'Enter the area or locality.'
          : !addr.city?.trim() ? 'Enter the city.'
            : !intl && !/^\d{6}$/.test(addr.pin ?? '') ? 'Enter the 6-digit PIN code.'
              : ''
    if (missing) { setNote(missing); return }
    setBusy(true); setNote('')
    try {
      const r = await te.placeAdd(addr)
      onChosen(r.place_id)
    } catch (e) {
      setNote(errorText(e)); setBusy(false)
    }
  }

  const needle = q.trim().toLowerCase()
  const matches = snap.masters.places
    .filter(p => !needle || `${p.s} ${p.name} ${p.addr} ${p.city ?? ''} ${p.pin}`.toLowerCase().includes(needle))
    .slice(0, needle ? 8 : 9)
  const mine = matches.filter(p => p.src !== 'saved')
  const company = matches.filter(p => p.src === 'saved')

  return (
    <TeSheet
      wide
      title={target.title}
      lead="Use the phone’s GPS, pick a place, or enter the complete address."
      back={onCancel}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>Back</button>
          {typing ? (
            <button type="button" className="btn pri" disabled={busy} onClick={saveTyped}>
              <TeIcon name="pin" size="sm" />{busy ? 'Saving…' : 'Use this address'}
            </button>
          ) : null}
        </>
      }
    >
      <button type="button" className="act pri" disabled={busy} onClick={locate}>
        <span className="ico-b"><TeIcon name="target" /></span>
        <span>
          <b>Use my current location</b>
          <small>Reads this phone’s GPS and fills the address from the map</small>
        </span>
      </button>

      {note ? <div className="note"><TeIcon name="info" size="sm" /><span>{note}</span></div> : null}

      <div className="sec">
        <h4>Search or pick a place</h4>
        <input
          ref={searchRef}
          className="inp"
          value={q}
          autoComplete="off"
          placeholder={intl ? 'Search a place, an area or a city, in any country' : 'Search a place, an area or a PIN code'}
          onChange={e => setQ(e.target.value)}
        />
        <div className="stack sm">
          {mine.length ? <div className="pkh">Your places</div> : null}
          {mine.map(p => (
            <button key={p.id} type="button" className="act flat" onClick={() => onChosen(p.id, p.pt ?? undefined)}>
              <span className="ico-b sm"><TeIcon name={p.pt === 'home' ? 'home' : p.src === 'gps' ? 'target' : 'pin'} size="sm" /></span>
              <span><b>{p.s}</b><small>{p.addr || p.name}</small></span>
              {SRC_WORD[p.src] ? <span className="chip plain">{SRC_WORD[p.src]}</span> : null}
            </button>
          ))}
          {company.length ? <div className="pkh">Company places</div> : null}
          {company.map(p => (
            <button key={p.id} type="button" className="act flat" onClick={() => onChosen(p.id, p.pt ?? undefined)}>
              <span className="ico-b sm"><TeIcon name={p.pt === 'home' ? 'home' : 'pin'} size="sm" /></span>
              <span><b>{p.s}</b><small>{p.addr || p.name}</small></span>
              <span className="chip plain t-brand">{p.pt === 'home' ? 'Your home' : 'Company place'}</span>
            </button>
          ))}
          {!matches.length ? (
            <div className="empty">
              {typedAddressAllowed
                ? 'No place matches. Enter the complete address below.'
                : 'No place matches. Use your current location or ask the admin to add this place.'}
            </div>
          ) : null}
        </div>
      </div>

      {typedAddressAllowed ? (
        <div className="sec">
          <h4>Or enter the complete address</h4>
          {!typing ? (
            <button type="button" className="btn" onClick={() => setTyping(true)}><TeIcon name="pin" size="sm" />Enter the address</button>
          ) : (
            <div className="form">
              <label className="fld full">
                <span>Name of the place</span>
                <input value={addr.label ?? ''} placeholder="Company, shop or person. Optional" onChange={e => setAddr(a => ({ ...a, label: e.target.value }))} />
              </label>
              <label className="fld full">
                <span>Building and street</span>
                <input value={addr.line ?? ''} placeholder="Flat or office number, building, street" onChange={e => setAddr(a => ({ ...a, line: e.target.value }))} />
              </label>
              <label className="fld">
                <span>Area or locality</span>
                <input value={addr.area ?? ''} placeholder="Sector, colony or landmark" onChange={e => setAddr(a => ({ ...a, area: e.target.value }))} />
              </label>
              {intl ? (
                <label className="fld">
                  <span>Country</span>
                  <input value={addr.country ?? ''} placeholder="Country" onChange={e => setAddr(a => ({ ...a, country: e.target.value }))} />
                </label>
              ) : null}
              <label className="fld">
                <span>City</span>
                <input value={addr.city ?? ''} onChange={e => setAddr(a => ({ ...a, city: e.target.value }))} />
              </label>
              <label className="fld">
                <span>{intl ? 'Postal code' : 'PIN code'}</span>
                <input
                  value={addr.pin ?? ''}
                  inputMode={intl ? 'text' : 'numeric'}
                  maxLength={intl ? 12 : 6}
                  placeholder={intl ? 'If the country uses one' : ''}
                  onChange={e => setAddr(a => ({ ...a, pin: e.target.value }))}
                />
              </label>
            </div>
          )}
        </div>
      ) : (
        <div className="note">
          <TeIcon name="shield" size="sm" />
          <span>Your company accepts only GPS and saved places as start and end points.</span>
        </div>
      )}
    </TeSheet>
  )
}
