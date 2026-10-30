// src/features/expenses/vehicle/VehicleAdd.tsx — add a vehicle by its number
// (components/te/vehicle/TeVehicleAdd.tsx). Used in "My limits and rates" and
// inline in the planner's own-vehicle journey.
//
// What vehicle it is → its number → what the RC says. The RC is the authority:
// it sets the type, and the type sets the rate a km. Four answers come back
// from the lookup: found (the RC card), not found / check off (attach a photo,
// HR checks it), or a bad format (refused before Vahan is asked).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { PickedFile } from '@/core/api'
import type { RcChecked, Snapshot, Uuid } from '@web/te/types'
import {
  isRegValid, normaliseReg, ownerNote, ratePerKm, rcMarks, saveGate, showReg,
  REG_FORMAT_MESSAGE, WHOSE_LABEL, type RcMark,
} from '@web/te/vehicle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { errorText, rs, te, type VehicleLookup } from '../api'
import { TeIcon } from '../ui/TeIcon'
import { Chip, Flag, KvRow, Opt } from '../ui/kit'
import { FilePickButton } from '../ui/FilePick'
import { MONO } from '../tones'
import { Ferr, Group, IconOpt } from '../plan/parts'

const vehIcon = (type: string) => (type === 'bike' ? 'bike' : 'car')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The RC prints a full date (TeVehicleAdd longDate): '7 Dec 2026'. */
function longDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`
}

/** .vvalid > span.vok.<ok|bad|mute> — the RC / insurance / PUC marks. */
export function RcMarks({ marks }: { marks: RcMark[] }) {
  const { C } = useTheme()
  if (!marks.length) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
      {marks.map(m => {
        const fg = m.tone === 'ok' ? C.positive : m.tone === 'bad' ? C.critical : C.muted
        return (
          <View key={m.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {m.tone !== 'mute' && <TeIcon name={m.tone === 'bad' ? 'alert' : 'check'} px={13} color={fg} />}
            <Txt size={F.tiny} w={600} color={fg}>{m.text}</Txt>
          </View>
        )
      })}
    </View>
  )
}

function WhoseRow({ options, whose, onPick, owner, note }: { options: string[]; whose: string; onPick: (k: string) => void; owner?: string; note: string }) {
  return (
    <Group label="Whose vehicle is it?">
      <View accessibilityLabel="Whose vehicle" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(k => <Opt key={k} label={WHOSE_LABEL[k]} on={whose === k} onPress={() => onPick(k)} />)}
      </View>
      <Txt size={F.tiny} w={owner === 'self' ? 600 : 400} tone={owner === 'self' ? 'critical' : 'muted'} style={{ marginTop: 6 }}>{note}</Txt>
    </Group>
  )
}

export function VehicleAdd({ snap, first, onAdded, onClose }: {
  snap: Snapshot
  /** No vehicle yet: changes the heading. */
  first?: boolean
  onAdded: (vehicleId: Uuid, message: string) => void
  onClose?: () => void
}) {
  const { C } = useTheme()
  const [type, setType] = React.useState('')
  const [reg, setReg] = React.useState('')
  const [found, setFound] = React.useState<VehicleLookup | null>(null)
  const [whose, setWhose] = React.useState('')
  const [photo, setPhoto] = React.useState<{ name: string; url: string } | null>(null)
  const [busy, setBusy] = React.useState<'' | 'check' | 'save' | 'photo'>('')
  const [error, setError] = React.useState('')

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

  async function attach(picked: PickedFile) {
    setBusy('photo'); setError('')
    try {
      const stored = await te.upload(picked, 'RC')
      // VehicleInput.rc_file_url takes the storage path, not a signed URL.
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
      onAdded(r.vehicle_id, r.is_verified
        ? `Added ${showReg(reg)}. RC checked: paid as ${typeName(r.vehicle_type_code)}.`
        : `Added ${showReg(reg)}. HR will check the RC.`)
    } catch (e) {
      setError(errorText(e)); setBusy('')
    }
  }

  const pickWhose = (k: string) => { setWhose(k); setError('') }

  return (
    <View style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.brandEdge, backgroundColor: C.surface, padding: S.md, gap: S.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandTint }}>
          <TeIcon name="verify" size="sm" color={C.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.body} w={700}>{first ? 'Add the vehicle you drive' : 'Add a vehicle'}</Txt>
          <Txt size={F.tiny} tone="muted">Your own, a family member’s or another. EZER reads its RC (registration certificate) to confirm what it is, and pays by that.</Txt>
        </View>
        {onClose && (
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={6}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.sunken : 'transparent' })}>
            <TeIcon name="close" size="sm" color={C.muted} />
          </Pressable>
        )}
      </View>

      <Group label="1. What vehicle is it?">
        <View accessibilityLabel="Vehicle type" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {types.map(t => <IconOpt key={t.id} icon={vehIcon(t.id)} label={t.name} on={type === t.id} onPress={() => { setType(t.id); setError('') }} />)}
        </View>
      </Group>

      <Input label="2. Vehicle number, as on the RC" value={reg} onChangeText={editReg}
        autoCapitalize="characters" autoComplete="off" autoCorrect={false} spellCheck={false} maxLength={16}
        placeholder="HR26 DK 4821 or 22 BH 1234 AA" inputStyle={{ fontFamily: MONO }} style={{ marginBottom: S.sm }} />
      <Button title={busy === 'check' ? 'Checking…' : 'Check RC'} disabled={busy === 'check'} onPress={() => void check()} full
        icon={<TeIcon name="verify" size="sm" color={C.onAccent} />} />

      {unknown && (
        <View style={{ gap: S.sm, marginTop: S.sm }}>
          <Flag tone="warn" icon="alert" title={checkOff ? 'The RC check is switched off' : `Vahan could not find ${showReg(reg)}`}>
            {`${checkOff ? 'Attach' : 'Check the number once more. If it is right, attach'} a photo of the RC, front and back. HR checks it and confirms the type before the vehicle is paid.`}
          </Flag>
          <WhoseRow options={['self', 'family', 'other']} whose={whose} onPick={pickWhose} owner={String(rules.owner ?? '')} note={ownerNote(rules)} />
          <FilePickButton sheetTitle="Attach the RC photo" loading={busy === 'photo'} disabled={busy === 'photo'}
            title={busy === 'photo' ? 'Attaching…' : photo ? `${photo.name} attached · choose another to replace` : 'Attach the RC photo'}
            onPicked={f => attach(f)} />
          <Ferr icon="alert">{error}</Ferr>
          <Button title={busy === 'save' ? 'Adding…' : 'Add and send to HR'} disabled={busy === 'save'} onPress={() => void save()} full />
        </View>
      )}

      {rc && found && 'rc' in found && (
        <View style={{ gap: S.sm, marginTop: S.sm }}>
          <View style={{ borderRadius: R.md, borderWidth: 1, borderColor: gate.blocking ? C.criticalEdge : C.line, backgroundColor: gate.blocking ? C.criticalTint : C.sunken, padding: S.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }}>
                <TeIcon name={vehIcon(rc.type)} color={C.inkSoft} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={F.body} w={700}>{rc.maker} {rc.model}</Txt>
                <Txt size={F.tiny} tone="muted">{`${rc.cls} · ${rc.body} · ${rc.fuel} · registered ${longDate(rc.regd)}`}</Txt>
              </View>
            </View>
            <Chip label="Found on Vahan" tone="t-pos" icon="check" style={{ marginTop: 6 }} />

            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: S.sm }}>
              <TeIcon name={type === rc.type ? 'check' : 'alert'} size="sm" color={type === rc.type ? C.positive : C.warning} />
              <Txt size={F.tiny} style={{ flex: 1 }}>
                {type === rc.type
                  ? `Matches: you said ${typeName(type)}, the RC says ${rc.body.toLowerCase()}.`
                  : <>{`You said ${typeName(type)}. The RC says ${rc.body.toLowerCase()}${rc.type === 'bike' ? ', a two-wheeler' : ''}. You are paid as `}<Txt size={F.tiny} w={700}>{found.typeName}</Txt>.</>}
              </Txt>
            </View>

            <KvRow label="Owner on the RC" value={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Txt size={F.small} w={600}>{found.ownerMasked}</Txt>
                {found.match === 'match' ? <Chip label="Your name" tone="t-pos" plain />
                  : found.match === 'partial' ? <Chip label="Same surname" tone="t-warn" plain />
                    : <Chip label="Another name" tone="t-warn" plain />}
              </View>
            } />
            <KvRow label="Paid as" last value={<Txt size={F.small}><Txt size={F.small} w={700}>{found.typeName}</Txt>{` · ${rs(rate(rc.type))} a km`}</Txt>} />
            <RcMarks marks={marks} />
          </View>

          {gate.message ? <Ferr icon="alert" warn={!gate.blocking}>{gate.message}</Ferr> : null}
          {found.match === 'match' ? null : <WhoseRow options={['family', 'other']} whose={whose} onPick={pickWhose} owner={String(rules.owner ?? '')} note={ownerNote(rules)} />}
          <Ferr icon="alert">{error}</Ferr>
          <Button title={busy === 'save' ? 'Adding…' : 'Add and use this vehicle'} disabled={!gate.canSave || busy === 'save'} onPress={() => void save()} full
            icon={<TeIcon name="check" size="sm" color={C.onAccent} />} />
        </View>
      )}

      {!found && error ? <Ferr icon="alert">{error}</Ferr> : null}
    </View>
  )
}

