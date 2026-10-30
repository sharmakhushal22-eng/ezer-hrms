// src/features/expenses/trip/TripPlan.tsx — "The plan, as they filled it in"
// (components/te/trip/TeTripPlan.tsx): every place, time, stop, note and link the
// traveller entered, and per journey the mode, who books it, which airport or
// station (theirs, else the company's for that city) and the preferred time.
import * as React from 'react'
import { Linking, Pressable, View } from 'react-native'
import { hubForCity } from '@web/te/commute'
import type { TeMasters, TePlaceBrief, TeTrip, TeTripPoint, TeTripSegment } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { FileLink } from '../ui/FilePick'
import { TeIcon } from '../ui/TeIcon'
import { Chip, TeCard } from '../ui/kit'
import { CardHead } from './parts'

/** 'HH:MM' as a clock reads; '' for a time nobody recorded. */
function clock(t?: string): string {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return ''
  const [h, m] = t.split(':')
  const hour = Number(h)
  if (!Number.isFinite(hour)) return ''
  const am = hour < 12 ? 'am' : 'pm'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${m.slice(0, 2)}${am}`
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDate(d?: string): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  const dt = new Date(`${d}T00:00:00Z`)
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`
}
const stamp = (d?: string, t?: string): string => [shortDate(d), clock(t)].filter(Boolean).join(', ')

const MILE: Record<string, string> = {
  cab: 'by cab', own: 'in their own vehicle', company: 'in a company vehicle',
  public: 'by public transport', bike: 'by bike', none: 'nothing to claim',
}

const saidAboutPoint = (p: TeTripPoint) => !!(p.prefNote || p.prefUrl)
const saidAboutSeg = (s: TeTripSegment) => !!(s.prefTime || s.prefUrl || s.prefNote)

function AskRow({ icon, children }: { icon: string; children: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 4, backgroundColor: C.infoTint, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 }}>
      <View style={{ paddingTop: 1 }}><TeIcon name={icon} size="sm" color={C.info} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  )
}

export function TripPlan({ trip, places, masters, claimId }: {
  trip: TeTrip
  places: Record<string, TePlaceBrief>
  masters?: TeMasters
  claimId?: string
}) {
  const { C } = useTheme()
  const points: TeTripPoint[] = trip.points ?? []
  const segs: TeTripSegment[] = trip.segs ?? []
  if (!points.length) return null

  const name = (id?: string | null): string => (id && places[id]?.s) || ''
  const city = (id?: string | null) => (id ? places[id] : undefined)
  function hubOf(chosen: string | undefined, at: string | undefined, mode: string): { label: string; chosen: boolean } | null {
    const kind = mode === 'flight' ? 'air' : mode === 'train' ? 'rail' : null
    if (!kind) return null
    if (chosen) return { label: name(chosen) || 'a place that has since gone', chosen: true }
    if (!masters) return null
    const auto = hubForCity(city(at), kind, masters)
    return auto ? { label: name(auto), chosen: false } : null
  }
  const anyPreference = points.some(saidAboutPoint) || segs.some(saidAboutSeg)

  return (
    <TeCard>
      <CardHead
        title={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}><TeIcon name="route" size="sm" color={C.ink} /><Txt size={F.lead} w={700} style={{ flexShrink: 1 }}>The plan, as they filled it in</Txt></View>}
        right={<Txt size={F.tiny} tone="muted">{anyPreference ? 'Times and notes are what they asked for' : 'Nothing was asked of the desk'}</Txt>} />
      <View>
        {points.map((p, i) => {
          const seg = segs[i]
          const arrive = stamp(p.arrive, p.arriveAt)
          const leave = stamp(p.leave, p.leaveAt)
          const hubA = seg ? hubOf(seg.xfer?.hubA, p.place, seg.mode) : null
          const hubB = seg ? hubOf(seg.xfer?.hubB, points[i + 1]?.place, seg.mode) : null
          const next = points[i + 1]
          return (
            <View key={`${p.place}-${i}`}>
              <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', paddingVertical: 6 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: p.stop ? C.sunken : C.brandTint }}>
                  <Txt size={11} w={700} color={p.stop ? C.muted : C.brand}>{String(i + 1)}</Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <Txt size={F.small} w={700}>{name(p.place) || 'A place that has since been removed'}</Txt>
                    {p.stop ? <Chip plain label="Stop on the way" /> : null}
                    {p.ret ? <Chip plain label="Back to the start" /> : null}
                  </View>
                  {p.what ? <Txt size={F.tiny}>{p.what}</Txt> : null}
                  {arrive || leave ? (
                    <Txt size={F.tiny} tone="muted">
                      {[arrive ? `Arrives ${arrive}` : '', leave ? `Leaves ${leave}` : ''].filter(Boolean).join(' · ')}
                    </Txt>
                  ) : null}
                  {saidAboutPoint(p) ? (
                    <AskRow icon="info">
                      {p.prefNote ? <Txt size={F.tiny} tone="soft">{p.prefNote}</Txt> : null}
                      {p.prefUrl ? <FileLink path={p.prefUrl} claimId={claimId} name="What they linked" small /> : null}
                    </AskRow>
                  ) : null}
                </View>
              </View>
              {seg && next ? (
                <View style={{ flexDirection: 'row', gap: S.sm, paddingBottom: 6 }}>
                  <View style={{ width: 22, alignItems: 'center' }}><View style={{ width: 2, flex: 1, backgroundColor: C.line }} /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt size={F.tiny}>
                      <Txt size={F.tiny} w={700}>{seg.mode}</Txt>
                      {` to ${name(next.place) || 'the next place'} · ${seg.bookedBy === 'desk' ? 'the Travel Desk books it' : 'they book it themselves'}`}
                    </Txt>
                    {hubA || hubB ? (
                      <Txt size={F.tiny} tone="muted">
                        {hubA ? `From ${hubA.label}${hubA.chosen ? ' (their choice)' : ''}` : ''}
                        {hubA && hubB ? ' → ' : ''}
                        {hubB ? `${hubB.label}${hubB.chosen ? ' (their choice)' : ''}` : ''}
                      </Txt>
                    ) : null}
                    {seg.xfer?.first || seg.xfer?.last ? (
                      <Txt size={F.tiny} tone="muted">
                        {seg.xfer.first ? `To the ${seg.mode === 'flight' ? 'airport' : 'station'} ${MILE[seg.xfer.first] ?? seg.xfer.first}` : ''}
                        {seg.xfer.first && seg.xfer.last ? ' · ' : ''}
                        {seg.xfer.last ? `Onward ${MILE[seg.xfer.last] ?? seg.xfer.last}` : ''}
                      </Txt>
                    ) : null}
                    {saidAboutSeg(seg) ? (
                      <AskRow icon="clock">
                        <Txt size={F.tiny} tone="soft">
                          <Txt size={F.tiny} w={700}>Asked for:</Txt>
                          {seg.prefTime ? ` around ${clock(seg.prefTime) || seg.prefTime}` : ''}
                          {seg.prefNote ? `${seg.prefTime ? '. ' : ' '}${seg.prefNote}` : ''}
                        </Txt>
                        {seg.prefUrl ? (
                          <Pressable accessibilityRole="link" hitSlop={6} onPress={() => void Linking.openURL(seg.prefUrl!)} style={{ minHeight: 28, justifyContent: 'center' }}>
                            <Txt size={F.tiny} w={600} color={C.brand}>the option they found</Txt>
                          </Pressable>
                        ) : null}
                      </AskRow>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          )
        })}
      </View>
    </TeCard>
  )
}
