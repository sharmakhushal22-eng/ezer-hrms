// src/features/leave/HolidaysPanel.tsx — "Upcoming holidays", grouped by month.
// Source: components/ess/LeaveSection.tsx (Holidays section + .ezlv-hol CSS).
import * as React from 'react'
import { View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import type { Palette } from '@/ui/theme'
import { F, R, S } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { PanelHead } from './ApplyPanel'
import { MoreButton } from './RequestsPanel'
import { fromIso, MONTHS, PEEK, shortMonth, type Holiday } from './logic'

/** .ezlv-hol-meta em.t-<type> — national info, festival/regional brand, optional warning. */
function typeColours(C: Palette, kind: string) {
  if (kind === 'national') return { bg: C.infoTint, fg: C.info }
  if (kind === 'festival' || kind === 'regional') return { bg: C.brandTint, fg: C.brandDeep }
  if (kind === 'optional') return { bg: C.warningTint, fg: C.warning }
  return { bg: C.sunken, fg: C.muted }
}

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: R.pill, backgroundColor: bg }}>
      <Txt size={10} w={700} color={fg}>{label}</Txt>
    </View>
  )
}

function HolidayRow({ h, head, today, first }: { h: Holiday; head: string | null; today: string; first: boolean }) {
  const { C } = useTheme()
  const d = fromIso(h.holiday_date)
  const away = Math.round((d.getTime() - fromIso(today).getTime()) / 86400000)
  const kind = String(h.holiday_type || '').toLowerCase()
  const tc = typeColours(C, kind)
  return (
    <View>
      {head && <Txt size={F.micro} w={700} tone="muted" upper style={{ marginTop: first ? 0 : S.md, marginBottom: 4 }}>{head}</Txt>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 9, borderTopWidth: head || first ? 0 : 1, borderTopColor: C.line }}>
        <View style={{ width: 40, paddingTop: 4, paddingBottom: 5, alignItems: 'center', borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm, backgroundColor: C.sunken }}>
          <Txt size={F.lead} w={700} style={{ lineHeight: 17 }}>{d.getDate()}</Txt>
          <Txt size={9} w={600} tone="faint" upper>{shortMonth(d)}</Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={500}>{h.description}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            {!!h.holiday_type && <Chip label={h.holiday_type} bg={tc.bg} fg={tc.fg} />}
            {!!h.is_optional && <Chip label="Optional" bg={C.warningTint} fg={C.warning} />}
          </View>
        </View>
        <Txt size={F.tiny} w={600} tone="faint">{away === 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away}d`}</Txt>
      </View>
    </View>
  )
}

export function HolidaysPanel({ upcoming, today, noHolidays }: { upcoming: Holiday[]; today: string; noHolidays: boolean }) {
  const [all, setAll] = React.useState(false)
  const shown = all ? upcoming : upcoming.slice(0, PEEK)
  let lastMonth = ''
  return (
    <Card style={{ marginBottom: S.md }}>
      <PanelHead title="Upcoming holidays" meta={upcoming.length ? `${upcoming.length} ahead` : undefined} />
      {!upcoming.length ? (
        <View style={{ paddingVertical: S.lg }}>
          {noHolidays ? (
            <Txt size={F.small} tone="muted" center>
              <Txt size={F.small} w={600} tone="soft">No holiday calendar published yet.</Txt>{'\n'}Once HR publishes it, your company’s holidays appear here and stop counting against your leave.
            </Txt>
          ) : (
            <Txt size={F.small} tone="muted" center>
              <Txt size={F.small} w={600} tone="soft">Nothing left this year.</Txt>{'\n'}The next calendar will appear here when HR publishes it.
            </Txt>
          )}
        </View>
      ) : (
        <>
          {shown.map((h, i) => {
            const d = fromIso(h.holiday_date)
            const mon = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
            const head = mon !== lastMonth ? (lastMonth = mon) : null
            return <HolidayRow key={`${h.holiday_date}-${i}`} h={h} head={head} today={today} first={i === 0} />
          })}
          {upcoming.length > PEEK && (
            <MoreButton open={all} label={`Show all ${upcoming.length} holidays`} onPress={() => setAll(v => !v)} />
          )}
        </>
      )}
    </Card>
  )
}
