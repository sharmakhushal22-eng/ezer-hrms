// src/features/expenses/plan/PlacePicker.tsx — choosing a place
// (components/te/plan/TePlacePicker.tsx). Used by the planner (route points and
// airport / station hubs), Start now and Add a journey.
//
// Three ways in, as on the website: the phone's GPS, a place already in the
// snapshot, or the complete address typed out with a pin on the schematic map.
// It takes the whole sheet over while open (the caller renders it instead of
// its own sheet, so the caller's draft is kept). Android back = Back here, as
// Escape is on the website's drawer.
//
// GPS: expo-location (gps.ts), 12 s timeout, the website's sentences.
// FIXED HERE (spec Part 3 "Known gap"): a place created in the picker (GPS or a
// typed address) is not in snap.masters.places until the snapshot is read
// again, so the caller's row showed its placeholder. The picker now calls
// reloadTe() after a successful te.placeAdd, before handing the id back.
import * as React from 'react'
import { BackHandler, Pressable, TextInput, View } from 'react-native'
import type { PlaceInput, Snapshot, Uuid } from '@web/te/types'
import type { PinView } from '@web/te/trip-map'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Button, Input, Txt, webNoOutline } from '@/ui/primitives'
import { errorText, te } from '../api'
import { reloadTe } from '../data'
import { TeIcon } from '../ui/TeIcon'
import { Chip, H4, Note } from '../ui/kit'
import { TeSheet } from '../ui/TeSheet'
import { GpsError, readPosition } from './gps'
import { PinMap } from './PinMap'

/** Where a chosen place is going back to. */
export type PickTarget =
  | { kind: 'point'; index: number; title: string; intl?: boolean; address?: boolean; useGps?: boolean }
  | { kind: 'hub'; index: number; side: 'A' | 'B'; title: string; hub: 'airport' | 'station' }

const SRC_WORD: Record<string, string> = { gps: 'GPS', address: 'Typed address', pin: 'Pin on map', search: 'Map search' }

function PlaceRow({ icon, title, sub, chip, onPress }: { icon: string; title: string; sub: string; chip: React.ReactNode; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12, paddingVertical: 10, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.brandTint : C.surface })}>
      <View style={{ width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sunken }}>
        <TeIcon name={icon} size="sm" color={C.inkSoft} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700} numberOfLines={1}>{title}</Txt>
        {!!sub && <Txt size={F.micro} tone="muted" numberOfLines={2}>{sub}</Txt>}
      </View>
      {chip}
    </Pressable>
  )
}

function PickHead({ children }: { children: string }) {
  return <Txt size={F.micro} w={700} tone="muted" upper style={{ marginTop: 4 }}>{children}</Txt>
}

export function PlacePicker({ snap, target, onCancel, onChosen }: {
  snap: Snapshot
  target: PickTarget
  onCancel: () => void
  /** The place id, and the type it carries when it is a place from the list. */
  onChosen: (placeId: Uuid, pt?: string) => void
}) {
  const { C } = useTheme()
  const intl = target.kind === 'point' && !!target.intl
  const [q, setQ] = React.useState(target.kind === 'hub' ? (target.hub === 'airport' ? 'airport' : 'station') : '')
  const [typing, setTyping] = React.useState(!!(target.kind === 'point' && target.address))
  const [addr, setAddr] = React.useState<PlaceInput>({ src: 'address', country: intl ? '' : 'India', city: '', line: '', area: '', pin: '', state: '' })
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [pin, setPin] = React.useState<{ lat: number; lng: number } | null>(null)
  const [view, setView] = React.useState<PinView>(() => {
    const base = snap.masters.places.find(p => p.pt === 'corp' && p.lat) ?? snap.masters.places.find(p => p.lat)
    return { lat: base?.lat ?? 28.4595, lng: base?.lng ?? 77.0266, span: 8 }
  })
  const typedAddressAllowed = snap.cfg.track.typedAddress !== false

  // Android back closes the picker, not the whole sheet underneath it.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onCancel(); return true })
    return () => sub.remove()
  }, [onCancel])

  const chosenRef = React.useRef(onChosen)
  React.useEffect(() => { chosenRef.current = onChosen })
  /** A new place exists on the server: read the snapshot again so it has a name here. */
  const hand = React.useCallback(async (placeId: Uuid) => {
    // Wait for the fresh snapshot (capped) so the caller's row shows the new name at once.
    await Promise.race([reloadTe().catch(() => undefined), new Promise(r => setTimeout(r, 5000))])
    chosenRef.current(placeId)
  }, [])

  const alive = React.useRef(true)
  React.useEffect(() => () => { alive.current = false }, [])

  const locate = React.useCallback(async () => {
    setBusy(true); setNote('Reading your location…')
    let pos
    try {
      pos = await readPosition(12000)
    } catch (e) {
      if (!alive.current) return
      setBusy(false)
      const kind = e instanceof GpsError ? e.kind : 'failed'
      setNote(kind === 'nodevice' ? 'This device cannot read its location.'
        : kind === 'denied' ? 'Location is switched off for this site. Pick a place or type the address.'
          : 'Could not read your location. Pick a place or type the address.')
      return
    }
    try {
      const r = await te.placeAdd({ src: 'gps', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy ?? undefined })
      if (alive.current) await hand(r.place_id)
    } catch (e) {
      if (!alive.current) return
      setNote(errorText(e)); setBusy(false)
    }
  }, [hand])

  // "Use my current location" opened the picker: ask straight away.
  const wantGps = target.kind === 'point' && !!target.useGps
  React.useEffect(() => {
    if (!wantGps) return
    const t = setTimeout(() => void locate(), 0)
    return () => clearTimeout(t)
  }, [wantGps, locate])

  async function saveTyped() {
    const missing = intl && !addr.country ? 'Choose the country.'
      : !addr.line?.trim() ? 'Enter the building and street.'
        : !addr.area?.trim() ? 'Enter the area or locality.'
          : !addr.city?.trim() ? 'Enter the city.'
            : !intl && !/^\d{6}$/.test(addr.pin ?? '') ? 'Enter the 6-digit PIN code.'
              : !pin ? 'Tap the exact spot on the map before you use this address.'
                : ''
    if (missing) { setNote(missing); return }
    setBusy(true); setNote('')
    try {
      const r = await te.placeAdd({ ...addr, src: 'address', lat: pin!.lat, lng: pin!.lng })
      await hand(r.place_id)
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
  const set = (k: keyof PlaceInput) => (v: string) => setAddr(a => ({ ...a, [k]: v }))

  return (
    <TeSheet title={target.title} lead="Use the phone’s GPS, pick a place, or enter the complete address."
      back={onCancel} onClose={onCancel}
      footer={
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <Button title="Back" variant="outline" onPress={onCancel} style={{ flex: 1 }} />
          {typing && (
            <Button title={busy ? 'Saving…' : 'Use this address'} disabled={busy} onPress={() => void saveTyped()} style={{ flex: 1.4 }}
              icon={<TeIcon name="pin" size="sm" color={C.onAccent} />} />
          )}
        </View>
      }>
      <Pressable disabled={busy} onPress={() => void locate()} accessibilityRole="button" accessibilityState={{ disabled: busy }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: C.brand, backgroundColor: C.brandTint, opacity: busy ? 0.6 : pressed ? 0.85 : 1 })}>
        <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brand }}>
          <TeIcon name="target" color={C.onAccent} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt size={F.body} w={700}>Use my current location</Txt>
          <Txt size={F.tiny} tone="soft">Reads this phone’s GPS and fills the address from the map</Txt>
        </View>
      </Pressable>

      {!!note && <Note style={{ marginTop: S.md }}>{note}</Note>}

      <H4>Search or pick a place</H4>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm + 1, paddingHorizontal: S.md, marginBottom: S.sm, backgroundColor: C.surface }}>
        <TextInput value={q} onChangeText={setQ} autoComplete="off" autoCorrect={false}
          placeholder={intl ? 'Search a place, an area or a city, in any country' : 'Search a place, an area or a PIN code'}
          placeholderTextColor={C.faint}
          style={[{ flex: 1, height: 46, fontFamily: FONT[400], fontSize: F.body, color: C.ink }, webNoOutline]} />
      </View>
      <View style={{ gap: S.sm }}>
        {mine.length > 0 && <PickHead>Your places</PickHead>}
        {mine.map(p => (
          <PlaceRow key={p.id} icon={p.pt === 'home' ? 'home' : p.src === 'gps' ? 'target' : 'pin'} title={p.s} sub={p.addr || p.name}
            chip={SRC_WORD[p.src] ? <Chip label={SRC_WORD[p.src]} plain /> : null}
            onPress={() => onChosen(p.id, p.pt ?? undefined)} />
        ))}
        {company.length > 0 && <PickHead>Company places</PickHead>}
        {company.map(p => (
          <PlaceRow key={p.id} icon={p.pt === 'home' ? 'home' : 'pin'} title={p.s} sub={p.addr || p.name}
            chip={<Chip label={p.pt === 'home' ? 'Your home' : 'Company place'} tone="t-brand" plain />}
            onPress={() => onChosen(p.id, p.pt ?? undefined)} />
        ))}
        {!matches.length && (
          <Txt size={F.small} tone="muted" center style={{ paddingVertical: S.lg }}>
            {typedAddressAllowed
              ? 'No place matches. Enter the complete address below.'
              : 'No place matches. Use your current location or ask the admin to add this place.'}
          </Txt>
        )}
      </View>

      {typedAddressAllowed ? (
        <View>
          <H4>Or enter the complete address</H4>
          {!typing ? (
            <Button title="Enter the address" variant="outline" onPress={() => setTyping(true)} style={{ alignSelf: 'flex-start' }}
              icon={<TeIcon name="pin" size="sm" color={C.brandDeep} />} />
          ) : (
            <View>
              <Input label="Name of the place" value={addr.label ?? ''} placeholder="Company, shop or person. Optional" onChangeText={set('label')} />
              <Input label="Building and street" value={addr.line ?? ''} placeholder="Flat or office number, building, street" onChangeText={set('line')} />
              <Input label="Area or locality" value={addr.area ?? ''} placeholder="Sector, colony or landmark" onChangeText={set('area')} />
              {intl && <Input label="Country" value={addr.country ?? ''} placeholder="Country" onChangeText={set('country')} />}
              <Input label="City" value={addr.city ?? ''} onChangeText={set('city')} />
              <Input label={intl ? 'Postal code' : 'PIN code'} value={addr.pin ?? ''} onChangeText={set('pin')}
                keyboardType={intl ? 'default' : 'number-pad'} maxLength={intl ? 12 : 6}
                placeholder={intl ? 'If the country uses one' : ''} />
              <PinMap pin={pin} view={view} onPin={setPin} onView={setView} />
            </View>
          )}
        </View>
      ) : (
        <Note icon="shield" style={{ marginTop: S.lg }}>Your company accepts only GPS and saved places as start and end points.</Note>
      )}
    </TeSheet>
  )
}
