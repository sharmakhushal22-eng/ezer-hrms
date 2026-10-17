'use client'
// components/te/plan/TePlacePicker.tsx — choosing a place. Screens 13, 14.
//
// Three ways in, in the order most people want them: the phone's GPS, a place
// already saved, or the complete address typed out. It takes the whole drawer
// over rather than sitting beside the form, because it is a search with a map.
//
// A TYPED ADDRESS NEEDS A PIN. The prototype geocodes the address and asks the
// person to confirm the result; no geocoding provider is configured here
// (lib/te/providers/geocode.ts says so in its header), so the address reaches
// the server with no position unless one is given. A claim's distance is
// measured to that point, so this is not a refinement — without it nothing can
// be measured to the place at all. If a provider is ever wired in, the pin
// becomes a confirmation step rather than the only source.
import { useCallback, useEffect, useRef, useState } from 'react'
import { te } from '@/lib/te/client'
import type { PlaceInput, Snapshot, Uuid } from '@/lib/te/types'
import { errorText } from '@/lib/te/format'
import TeIcon from '../TeIcon'
import TeSheet from '../TeSheet'
import TePinMap from './TePinMap'
import { reverseGeocodeHere, TePlaceSearch } from './TeGoogleMap'
import type { PinView } from '@/lib/te/trip-map'

/** Where a chosen place is going back to. */
export type PickTarget =
  | { kind: 'point'; index: number; title: string; intl?: boolean; address?: boolean; useGps?: boolean }
  | { kind: 'hub'; index: number; side: 'A' | 'B'; title: string; hub: 'airport' | 'station' }

const SRC_WORD: Record<string, string> = { gps: 'GPS', address: 'Typed address', pin: 'Pin on map', search: 'Map search' }

export default function TePlacePicker({ snap, target, onCancel, onChosen, onPlaceAdded }: {
  snap: Snapshot
  target: PickTarget
  onCancel: () => void
  /** The place id, and the type it carries when it is a company place. */
  onChosen: (placeId: Uuid, pt?: string) => void
  /**
   * A place that did not exist until a moment ago was just created.
   *
   * WHY THE HOST HAS TO BE TOLD. Every screen names a point by looking its id
   * up in snap.masters.places. That snapshot was fetched before this place
   * existed, so the lookup misses and the route line renders "—": the place
   * was saved, the point does carry its id, and it still looks as though
   * nothing happened. This is what made "Use my location" appear not to be
   * used as the start, the end or a stop.
   *
   * The host refetches the snapshot WITHOUT closing itself — the half-built
   * trip lives in its state — exactly as it already does for a new vehicle.
   */
  onPlaceAdded?: () => void
}) {
  const intl = target.kind === 'point' && !!target.intl
  const [q, setQ] = useState(target.kind === 'hub' ? (target.hub === 'airport' ? 'airport' : 'station') : '')
  const [typing, setTyping] = useState(!!(target.kind === 'point' && target.address))
  const [addr, setAddr] = useState<PlaceInput>({ src: 'address', country: intl ? '' : 'India', city: '', line: '', area: '', pin: '', state: '' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  /** A refusal, shown BESIDE THE BUTTON that caused it. `note` is drawn at the
   *  top of the sheet, under "Use my current location" — and the save button
   *  is in the sticky footer, so a person at the address form pressed it and
   *  watched nothing happen while the reason sat off-screen above them. */
  const [fault, setFault] = useState('')
  // The panel opens over the employee's own office, which is the nearest
  // thing to a useful starting view when there is no map behind it.
  const [view, setView] = useState<PinView>(() => {
    const base = snap.masters.places.find(p => p.pt === 'corp' && p.lat) ?? snap.masters.places.find(p => p.lat)
    return { lat: base?.lat ?? 28.4595, lng: base?.lng ?? 77.0266, span: 8 }
  })
  const searchRef = useRef<HTMLInputElement | null>(null)

  const typedAddressAllowed = snap.cfg.track.typedAddress !== false

  /** Fill the address from a position, without saving. Also used when the pin
   *  is dragged, so the address follows the pin rather than going stale. */
  const fillFrom = useCallback((lat: number, lng: number, acc?: number) => {
    setFault('')
    setPin({ lat, lng })
    setView(v => ({ ...v, lat, lng }))
    setTyping(true)
    setBusy(true)
    setNote('Looking up the address…')
    // THE SERVER FIRST, THEN THE BROWSER. The server is the better place for
    // this — its key is not in the page source and the Geocoding quota stays
    // off a public key — but it answers found:false whenever its own Google
    // project cannot geocode, and today that project has no billing enabled.
    // The browser key's project is billed, which the map tiles prove, so the
    // fallback works now and enabling billing later silently moves the work
    // back to the server with no code change.
    const fill = (r: { name?: string; address?: string; city?: string; pin?: string; country?: string }) => {
      setAddr(a => ({
        ...a,
        src: 'gps',
        // Only fill what is empty: somebody who has already typed their
        // building name should not have it overwritten by a street number.
        line: a.line?.trim() ? a.line : (r.name ?? ''),
        area: a.area?.trim() ? a.area : '',
        city: a.city?.trim() ? a.city : (r.city ?? ''),
        pin: a.pin?.trim() ? a.pin : (r.pin ?? ''),
        country: a.country?.trim() ? a.country : (r.country ?? 'India'),
      }))
      setNote(`${r.address || r.name || 'Found'}${acc ? ` · accurate to about ${Math.round(acc)} m` : ''}. Drag the pin if it is not the right spot.`)
    }

    te.placeLookup(lat, lng)
      .then(async r => {
        if (r.found) { setBusy(false); fill(r); return }
        const here = await reverseGeocodeHere(lat, lng)
        setBusy(false)
        if (here) { fill(here); return }
        // Neither path could answer. The pin is still the useful half — the
        // distance is measured to it — so it is kept and the person types the
        // address. Never a guessed one.
        setNote(`Pinned at ${lat.toFixed(5)}, ${lng.toFixed(5)}. Type the address for this spot.`)
      })
      .catch(async e => {
        const here = await reverseGeocodeHere(lat, lng).catch(() => null)
        setBusy(false)
        if (here) { fill(here); return }
        setNote(errorText(e))
      })
  }, [])

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) { setNote('This device cannot read its location.'); return }
    setBusy(true); setNote('Reading your location…')
    navigator.geolocation.getCurrentPosition(
      // IT USED TO SAVE AND CLOSE HERE. The address was resolved on the server
      // on the way in, so the person never saw what was found, could not fix a
      // pin that landed on the next building, and the button's own subtitle
      // promised something invisible. Now the position fills the form in front
      // of them and they confirm it.
      pos => fillFrom(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
      e => { setBusy(false); setNote(e.code === e.PERMISSION_DENIED ? 'Location is switched off for this site. Pick a place or type the address.' : 'Could not read your location. Pick a place or type the address.') },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }, [fillFrom])

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

  /** A place the map found, rather than one typed from memory. The pin IS the
   *  position, so the parts of a postal address that exist to locate it —
   *  the area, and a PIN that has to match the state — are not demanded. The
   *  server applies the same distinction: te-service only insists on those for
   *  src 'address'. */
  const fromMap = addr.src === 'gps' || addr.src === 'search'

  /** What is still missing, or '' when the place can be saved.
   *
   *  A PLACE THE MAP FOUND NEEDS ONLY THE PIN. This used to demand the
   *  building, the city, the area and a six-digit PIN for every place —
   *  including one just pinned by GPS, where the position IS the answer and
   *  the postal parts only exist to locate it. The server has never asked for
   *  them on a GPS place: te-service's src === 'gps' branch requires lat and
   *  lng and nothing else, and fills the name from the reverse lookup.
   *
   *  So the form was stricter than the rules, and the result was the bug this
   *  fixes: "Use my location" found the place, and pressing "Use this address"
   *  silently refused because Google had not returned a locality. */
  const missingFor = (): string => {
    if (!pin) return 'Tap the exact spot on the map before you use this address.'
    if (intl && !addr.country) return 'Choose the country.'
    if (fromMap) return ''
    if (!addr.line?.trim()) return 'Enter the building and street.'
    if (!addr.area?.trim()) return 'Enter the area or locality.'
    if (!addr.city?.trim()) return 'Enter the city.'
    if (!intl && !/^\d{6}$/.test(addr.pin ?? '')) return 'Enter the 6-digit PIN code.'
    return ''
  }

  async function saveTyped() {
    const missing = missingFor()
    if (missing) { setFault(missing); return }
    setFault('')
    setBusy(true); setNote('')
    try {
      // The source is the truth about where this came from, and the server
      // keeps it: a place pinned by GPS is audited as a GPS place, which is
      // exactly what somebody checking a claim later needs to know.
      const r = await te.placeAdd({
        ...addr,
        src: fromMap ? 'gps' : 'address',
        label: fromMap ? (addr.line || '').trim() || undefined : undefined,
        lat: pin!.lat,
        lng: pin!.lng,
      })
      // The order matters: make the snapshot stale-check run first, so by the
      // time the route line re-renders with this id it can find the place.
      if (!r.matched) onPlaceAdded?.()
      onChosen(r.place_id)
    } catch (e) {
      setFault(errorText(e)); setBusy(false)
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
            <>
              {fault ? <span className="ferr"><TeIcon name="warn" size="sm" />{fault}</span> : null}
              <button type="button" className="btn pri" disabled={busy} onClick={saveTyped}>
                <TeIcon name="pin" size="sm" />
                {busy ? 'Saving…' : fromMap ? 'Use this place' : 'Use this address'}
              </button>
            </>
          ) : null}
        </>
      }
    >
      {/* FIND IT BY NAME, which is the cheapest way in for everybody: no
          postal address typed from memory, no pin dropped and hoped over.
          A suggestion carries Google's own coordinates for that building plus
          the address, city and PIN, so the form fills itself and the pin is
          exact. Renders nothing when the Places API is not enabled on the key,
          leaving the two routes below untouched. */}
      <TePlaceSearch
        label={intl ? 'Find a place by name, in any country' : 'Find a place by name'}
        onFound={p => {
          setPin({ lat: p.lat, lng: p.lng })
          setView(v => ({ ...v, lat: p.lat, lng: p.lng }))
          setTyping(true)
          setAddr(a => ({
            ...a,
            src: 'search',
            line: p.name || a.line,
            city: p.city || a.city,
            pin: p.pin || a.pin,
            country: p.country || a.country,
          }))
          setNote(`${p.address || p.name}. Drag the pin if it is not the right spot.`)
        }}
      />

      <button type="button" className="act pri" disabled={busy} onClick={locate}>
        <span className="ico-b"><TeIcon name="target" /></span>
        <span>
          <b>Use my current location</b>
          <small>Reads this phone’s GPS, shows it on the map and fills the address</small>
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
          <h4>{fromMap ? 'The place the map found' : 'Or enter the complete address'}</h4>
          {fromMap ? (
            <div className="flag ok">
              <TeIcon name="target" />
              <div className="tx">
                <b>Filled from your location</b>
                <p>
                  Check the name and the city, and drag the pin if it is not the right spot.
                  The area and PIN are not needed — the pin is the position, and the distance
                  on your claim is measured to it.
                </p>
              </div>
            </div>
          ) : null}
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
                <input value={addr.area ?? ''} placeholder={fromMap ? 'Optional' : 'Sector, colony or landmark'} onChange={e => setAddr(a => ({ ...a, area: e.target.value }))} />
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
              <div className="full">
                {/* Dragging the pin re-reads the address, so the two can never
                    disagree about where this place is. */}
                <TePinMap pin={pin} view={view} onPin={p => fillFrom(p.lat, p.lng)} onView={setView} />
              </div>
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
