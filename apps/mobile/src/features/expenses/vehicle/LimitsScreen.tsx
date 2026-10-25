// src/features/expenses/vehicle/LimitsScreen.tsx — "My limits and rates"
// (components/te/vehicle/TeLimitsAndRates.tsx), the view /expenses/limits.
//
// What this employee may spend and the rate their own vehicle is paid. Every
// number is the published policy (snap.cfg); nothing is worked out here and
// nothing can be changed except adding a vehicle. The website's limits table
// becomes one card per city group on the phone (same columns, as rows).
//
// TeHome's contract: onChanged(msg) → notify(msg); reloadTe().
import * as React from 'react'
import { View } from 'react-native'
import type { Snapshot } from '@web/te/types'
import { ratePerKm, rcMarks, vehicleSubtitle, WHOSE_LABEL } from '@web/te/vehicle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { rs } from '../api'
import { reloadTe } from '../data'
import { TeIcon } from '../ui/TeIcon'
import { Chip, Flag, KvRow, TeCard } from '../ui/kit'
import { SnapScreen } from '../ui/TeScreen'
import { MONO } from '../tones'
import { RcMarks, VehicleAdd } from './VehicleAdd'

const TIERS: { id: string; name: string }[] = [
  { id: 'metro', name: 'Metro' },
  { id: 'tier1', name: 'Tier 1' },
  { id: 'rest', name: 'Rest of India' },
  { id: 'intlA', name: 'International, group A' },
  { id: 'intlB', name: 'International, group B' },
]

function Tile({ l, v, s }: { l: string; v: string; s: string }) {
  return (
    <TeCard style={{ flexGrow: 1, flexBasis: 150, marginBottom: 0 }}>
      <Txt size={F.micro} w={700} tone="muted" upper>{l}</Txt>
      <Txt size={F.lead} w={700} style={{ marginTop: 4 }}>{v}</Txt>
      <Txt size={F.tiny} tone="muted">{s}</Txt>
    </TeCard>
  )
}

function Rule({ icon, title, note }: { icon: string; title: string; note: string }) {
  return <Flag tone="info" icon={icon} title={title}>{note}</Flag>
}

function VehicleRow({ v, snap, last }: { v: Snapshot['vehicles'][number]; snap: Snapshot; last: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: S.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line }}>
      <View style={{ width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sunken }}>
        <TeIcon name={v.type === 'bike' ? 'bike' : 'car'} size="sm" color={C.inkSoft} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Txt size={F.small} w={700} style={{ fontFamily: MONO }}>{v.reg}</Txt>
          {v.verified
            ? <Chip label={v.vby === 'hr' ? 'RC checked by HR' : 'RC checked'} tone="t-pos" icon="verify" />
            : <Chip label="HR to check the RC" tone="t-warn" plain />}
          {v.whose && v.whose !== 'self' ? <Chip label={WHOSE_LABEL[v.whose] ?? v.whose} plain /> : null}
        </View>
        <Txt size={F.tiny} tone="muted">{vehicleSubtitle(v, snap.cfg.vehicles, snap.cfg.fuelPrice)}</Txt>
        {v.rc ? <RcMarks marks={rcMarks(v.rc, snap.today)} /> : null}
      </View>
    </View>
  )
}

function Limits({ snap, onChanged }: { snap: Snapshot; onChanged: (message: string) => void }) {
  const { C } = useTheme()
  const [adding, setAdding] = React.useState(false)
  const me = snap.emp[snap.me]
  const grade = me?.grade || snap.cfg.defaultGrade
  const limits = snap.cfg.limits[grade] ?? {}
  const types = snap.cfg.vehicles.filter(v => v.on)
  const mine = snap.vehicles.filter(v => v.emp === snap.me)
  const citiesIn = (tier: string) => Object.entries(snap.masters.cities).filter(([, v]) => v[0] === tier).map(([city]) => city)
  const rates = types.map(t => ratePerKm(t, snap.cfg.fuelPrice)).filter(r => r > 0)
  const zoneA = snap.cfg.zoneA

  return (
    <View>
      <Txt size={F.small} tone="muted" style={{ marginBottom: S.lg }}>{`These limits apply to you as grade ${grade}. They come from the policy your company has published.`}</Txt>

      <View style={{ gap: S.sm, marginBottom: S.md }}>
        {TIERS.filter(t => limits[t.id]).map(t => {
          const cities = citiesIn(t.id)
          const cityText = t.id === 'intlA' ? `${zoneA.slice(0, 7).join(', ')}${zoneA.length > 7 ? ` and ${zoneA.length - 7} more countries` : ''}`
            : t.id === 'intlB' ? 'Every other country'
              : cities.length ? cities.join(', ') : '—'
          return (
            <View key={t.id} style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: S.lg, paddingVertical: S.md }}>
              <Txt size={F.body} w={700}>{t.name}</Txt>
              <Txt size={F.tiny} tone="muted" style={{ marginBottom: 4 }}>{cityText}</Txt>
              <KvRow label="Hotel a night" value={rs(limits[t.id].hotel)} />
              <KvRow label="Food a day" value={rs(limits[t.id].meals)} />
              <KvRow label="Local conveyance a day" value={rs(limits[t.id].conv)} last />
            </View>
          )
        })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginBottom: S.md }}>
        <Tile l="Travel class" v={`${snap.cfg.airClass[grade] ?? '—'} · ${snap.cfg.trainClass[grade] ?? '—'}`} s="Flight and train" />
        <Tile l="Own vehicle" v={rates.length ? `${rs(Math.min(...rates))} to ${rs(Math.max(...rates))} a km` : 'Not offered'} s="By vehicle type, on the GPS distance" />
        <Tile l="Advance" v={`Up to ${snap.cfg.advanceMaxPct}%`} s="of the self-paid estimate" />
      </View>

      <TeCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, marginBottom: S.sm }}>
          <Txt size={F.lead} w={700}>My vehicles</Txt>
          <Button size="sm" variant={adding ? 'outline' : 'primary'} title={adding ? 'Close' : 'Add a vehicle'} onPress={() => setAdding(v => !v)}
            icon={<TeIcon name={adding ? 'close' : 'plus'} size="sm" color={adding ? C.brandDeep : C.onAccent} />} />
        </View>
        <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.sm }}>
          Every vehicle you drive for work is added by its number. Its RC sets the type and the rate a km, so a hatchback is not paid as an SUV.
        </Txt>
        {adding && (
          <View style={{ marginBottom: S.sm }}>
            <VehicleAdd snap={snap} first={!mine.length} onClose={() => setAdding(false)}
              onAdded={(_id, message) => { setAdding(false); onChanged(message) }} />
          </View>
        )}
        {mine.length ? mine.map((v, i) => <VehicleRow key={v.id} v={v} snap={snap} last={i === mine.length - 1} />) : (
          <View style={{ paddingVertical: S.lg, alignItems: 'center', gap: 4 }}>
            <Txt size={F.body} w={700} center>No vehicle yet</Txt>
            <Txt size={F.small} tone="muted" center>Add one to claim travel by your own vehicle.</Txt>
          </View>
        )}
      </TeCard>

      <TeCard>
        <Txt size={F.lead} w={700} style={{ marginBottom: S.sm }}>Rules that apply to every claim</Txt>
        <View style={{ gap: S.sm }}>
          <Rule icon="clock" title={`Bills older than ${snap.cfg.billAgeDays} days are not accepted`} note="Counted from the bill date." />
          <Rule icon="cal" title={`Submit within ${snap.cfg.claimDeadlineDays} days of return`} note="After that, a reason is asked." />
          <Rule icon="receipt" title={`A bill is needed above ${rs(snap.cfg.receiptAbove)}`} note="Hotel, air, train and client bills always need one." />
          <Rule icon="pin" title={`No-bill local conveyance up to ${rs(snap.cfg.noBillPerDay)} a day`} note="Auto and metro rides without a receipt." />
          <Rule icon="people" title={`Client entertainment up to ${rs(snap.cfg.clientPerHead)} a head`} note="Name the client and the number of people." />
          <Rule icon="receipt" title="Caps on each claim" note={`Miscellaneous ${rs(snap.cfg.miscPerClaim)}, courier and communication ${rs(snap.cfg.commPerClaim)}.`} />
        </View>
      </TeCard>
    </View>
  )
}

export default function LimitsScreen() {
  const { notify } = useOverlay()
  const onChanged = React.useCallback((message: string) => { notify(message); void reloadTe() }, [notify])
  return (
    <SnapScreen title="My limits and rates" tab="limits">
      {snap => <Limits snap={snap} onChanged={onChanged} />}
    </SnapScreen>
  )
}
