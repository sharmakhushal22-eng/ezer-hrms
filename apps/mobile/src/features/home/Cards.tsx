// src/features/home/Cards.tsx — the work cards of Home:
// PendingList, QuickActions, Journey (left column on the website) and
// TeamToday, HolidayCard (top of the right column). Ports of the files of the
// same names in components/ess/today. Every link goes through openLink(), which
// resolves the website's 'tab:<k>' / '?tab=<k>' / '/path' targets to app screens.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { openLink } from '@/core/links'
import { useTheme } from '@/ui/ThemeProvider'
import { Txt } from '@/ui/primitives'
import { fmtDateCompact, tenure } from '@web/today/format'
import { ROUTES } from '@web/today/schema'
import type { Pending, Prefs, TodayPayload } from './data'
import { CardHead, EmptyLine, HomeCard, MoreLink, Pav, useGold, useMounted, useTween } from './kit'
import { GCalendar, GClock, GDoc, GDownload, GInbox, GLayers, GMenu, GShield, GUsers, type GlyphProps } from './glyphs'

// ── PendingList — "Pending on you" ────────────────────────────────────────────
type Glyph = (p: GlyphProps) => React.ReactElement
function pendingIcon(C: ReturnType<typeof useTheme>['C'], it: Pending): { I: Glyph; bg: string; fg: string } {
  if (it.kind === 'approval') return { I: GInbox, bg: C.brandTint, fg: C.brand }
  if (it.type === 'investment_declaration' || it.type === 'investment_proof') return { I: GDoc, bg: C.warningTint, fg: C.warning }
  return { I: GShield, bg: C.infoTint, fg: C.info } // policy_ack, and the fallback for unknown types
}

/** Days from now until `d` (read at render, like the website's card). */
const daysUntil = (d: Date) => (d.getTime() - Date.now()) / 864e5

function PendingRow({ it, prefs }: { it: Pending; prefs: Prefs }) {
  const { C } = useTheme()
  const m = pendingIcon(C, it)
  const due = it.due_on ? new Date(it.due_on) : null
  const soon = due ? daysUntil(due) <= 21 : false
  const dueLabel = due ? `Due ${fmtDateCompact(it.due_on!, prefs.date_format === 'long' ? 'short' : prefs.date_format).replace(/^\w{3}, /, '')}` : 'No deadline'
  return (
    <View style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 13, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line }}>
      <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: m.bg, alignItems: 'center', justifyContent: 'center' }}>
        <m.I size={18} color={m.fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={13.5} w={600}>{it.title}</Txt>
        {!!it.description && <Txt size={12} tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>{it.description}</Txt>}
        {/* The website hides this button at ≤520px, leaving phone rows with no action.
            The app keeps it, under the text, so every row can be acted on. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, backgroundColor: due && soon ? C.warningTint : C.infoTint }}>
            <Txt size={11.5} w={600} color={due && soon ? C.warning : C.info}>{dueLabel}</Txt>
          </View>
          <Pressable onPress={() => openLink(it.cta_route)} accessibilityRole="button" hitSlop={6}
            style={({ pressed }) => ({ marginLeft: 'auto', minHeight: 34, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center', backgroundColor: pressed ? C.brandDeep : C.brand })}>
            <Txt size={12.5} w={600} color={C.onAccent}>{it.cta_label}</Txt>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

export function PendingList({ data, prefs }: { data: TodayPayload; prefs: Prefs }) {
  const items = data.pending
  return (
    <HomeCard>
      <CardHead title="Pending on you" count={items.length} more={{ label: 'Inbox', onPress: () => openLink(ROUTES.inbox) }} />
      {items.length === 0 ? <EmptyLine>Nothing waiting on you right now.</EmptyLine> : (
        <View style={{ gap: 8 }}>{items.map(it => <PendingRow key={`${it.kind}:${it.id}`} it={it} prefs={prefs} />)}</View>
      )}
    </HomeCard>
  )
}

// ── QuickActions ──────────────────────────────────────────────────────────────
export function QuickActions() {
  const { C } = useTheme()
  const gold = useGold()
  const ACTIONS: { label: string; I: Glyph; to: string; c?: [string, string] }[] = [
    { label: 'Apply leave', I: GCalendar, to: ROUTES.applyLeave },
    { label: 'Payslip', I: GDownload, to: ROUTES.payslip, c: [C.positiveTint, C.positive] },
    { label: 'Regularise', I: GClock, to: ROUTES.regularise, c: [C.warningTint, C.warning] },
    { label: 'Raise ticket', I: GMenu, to: ROUTES.ticket, c: [C.infoTint, C.info] },
    { label: 'My team', I: GUsers, to: ROUTES.team },
    { label: 'Form 16', I: GLayers, to: ROUTES.form16, c: [gold.bg, gold.fg] },
  ]
  return (
    <HomeCard>
      <CardHead title="Quick actions" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {ACTIONS.map(a => {
          const [bg, fg] = a.c || [C.brandTint, C.brand]
          return (
            <Pressable key={a.label} onPress={() => openLink(a.to)} accessibilityRole="button"
              style={({ pressed }) => ({ width: '31%', flexGrow: 1, borderRadius: 14, borderWidth: 1, borderColor: pressed ? (a.c ? fg : C.brandEdge) : C.line, backgroundColor: C.surface,
                paddingTop: 14, paddingBottom: 12, paddingHorizontal: 6, alignItems: 'center', gap: 9, transform: [{ translateY: pressed ? 1 : 0 }] })}>
              <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                <a.I size={20} color={fg} />
              </View>
              <Txt size={12} w={600} center numberOfLines={1}>{a.label}</Txt>
            </Pressable>
          )
        })}
      </View>
    </HomeCard>
  )
}

// ── Journey — "My journey at the company" ─────────────────────────────────────
const STOPS = [0, 1, 3, 5], POS = [12.5, 37.5, 62.5, 87.5]

export function Journey({ data, prefs }: { data: TodayPayload; prefs: Prefs }) {
  const { C } = useTheme()
  const gold = useGold()
  const ready = useMounted(250)
  const [trackW, setTrackW] = React.useState(0)
  const [youW, setYouW] = React.useState(0)
  // Journey.tsx (3cb2a47): a joiner whose record has no joining date yet gets the card
  // without the track — Home must never crash on a blank date.
  const e = data.employee
  const dojIso = e.date_of_joining && !Number.isNaN(new Date(e.date_of_joining).getTime()) ? e.date_of_joining : null
  const t = dojIso ? tenure(dojIso) : { years: 0, months: 0, totalMonths: 0 }
  const yrs = t.totalMonths / 12
  let pos = POS[3]
  for (let i = 0; i < 3; i++) if (yrs <= STOPS[i + 1]) { pos = POS[i] + ((yrs - STOPS[i]) / (STOPS[i + 1] - STOPS[i])) * (POS[i + 1] - POS[i]); break }
  const at = useTween(ready ? pos : POS[0], 1600, 500, POS[0])
  const fill = useTween(ready ? pos : 0, 1600, 500)
  const doj = dojIso ? new Date(dojIso) : new Date()
  const yearOf = (n: number) => new Date(doj.getFullYear() + n, doj.getMonth(), doj.getDate())
  const toGo = (n: number) => { const m = Math.max(0, n * 12 - t.totalMonths); return m === 0 ? 'Reached' : m < 12 ? `${m} months to go` : `${Math.floor(m / 12)} yr ${m % 12} mo to go` }
  const you = t.years > 0 ? `You, ${t.years} yr${t.years > 1 ? 's' : ''}${t.months ? ` ${t.months} mo` : ''}` : `You, ${t.months} mo`
  // Keep the "you" bubble inside the card at either end of the track.
  const youLeft = trackW ? Math.max(0, Math.min(trackW - youW, (at / 100) * trackW - youW / 2)) : 0

  return (
    <HomeCard>
      <CardHead title="My journey at the company" />
      {dojIso ? (
        <>
        <View onLayout={ev => setTrackW(ev.nativeEvent.layout.width)} style={{ height: 6, borderRadius: 99, backgroundColor: C.sunken, marginTop: 34, marginBottom: 16 }}>
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill}%`, borderRadius: 99, backgroundColor: C.brand }} />
          <View onLayout={ev => setYouW(ev.nativeEvent.layout.width)}
            style={{ position: 'absolute', top: -30, left: youLeft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, opacity: trackW && youW ? 1 : 0 }}>
            <Txt size={11} w={700} tone="brand" numberOfLines={1}>{you}</Txt>
          </View>
          {STOPS.map((s, i) => {
            const done = yrs >= s, isGold = s === 5
            return (
              <View key={s} style={{ position: 'absolute', top: -6, left: `${POS[i]}%`, marginLeft: -9, width: 18, height: 18, borderRadius: 9, borderWidth: 3,
                borderColor: isGold ? gold.fg : done ? C.brand : C.lineStrong, backgroundColor: isGold ? gold.bg : done ? C.brand : C.surface, alignItems: 'center', justifyContent: 'center' }}>
                {done && !isGold && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' }} />}
              </View>
            )
          })}
        </View>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ flex: 1, paddingHorizontal: 2, alignItems: 'center' }}>
            <Txt size={10.5} w={700} center>Joined</Txt>
            <Txt size={10.5} w={600} tone="muted" center>{fmtDateCompact(dojIso, prefs.date_format)}</Txt>
          </View>
          {[1, 3, 5].map(n => (
            <View key={n} style={{ flex: 1, paddingHorizontal: 2, alignItems: 'center' }}>
              <Txt size={10.5} w={700} center>{n} year{n > 1 ? 's' : ''}</Txt>
              <Txt size={10.5} w={600} tone="muted" center>{yrs >= n ? yearOf(n).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : toGo(n)}</Txt>
            </View>
          ))}
        </View>
        </>
      ) : (
        <View style={{ paddingVertical: 6 }}>
          <Txt size={10.5} w={700}>Joined</Txt>
          <Txt size={10.5} w={600} tone="muted">Joining date not on record yet. HR can set it on your employee record.</Txt>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {([['Designation', e.designation], ['Reports to', e.reports_to], ['Department', e.department]] as const).map(([k, v]) => (
          <View key={k} style={{ flex: 1, minWidth: 0, backgroundColor: C.sunken, borderRadius: 11, paddingVertical: 9, paddingHorizontal: 10 }}>
            <Txt size={12} tone="muted">{k}</Txt>
            <Txt size={13} w={600} style={{ marginTop: 2 }}>{v ?? '-'}</Txt>
          </View>
        ))}
      </View>
    </HomeCard>
  )
}

// ── TeamToday — hidden when the team is empty ─────────────────────────────────
export function TeamToday({ data }: { data: TodayPayload }) {
  const { C } = useTheme()
  const gold = useGold()
  const t = data.team
  if (!t || t.total === 0) return null
  const tints: [string, string][] = [[C.brandTint, C.brand], [C.positiveTint, C.positive], [C.infoTint, C.info], [gold.bg, gold.fg], [C.warningTint, C.warning]]
  const dot = { in: C.positive, wfh: C.info, leave: C.warning, out: C.lineStrong } as const
  const shown = t.members.slice(0, 5), extra = t.total - shown.length
  const legend = (color: string, n: number, label: string) => (
    <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Txt size={12} tone="muted"><Txt size={12} w={700}>{n}</Txt> {label}</Txt>
    </View>
  )
  return (
    <HomeCard>
      <CardHead title="Team today" more={{ label: 'Team', onPress: () => openLink(ROUTES.team) }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flexDirection: 'row' }}>
          {shown.map((m, i) => (
            <View key={m.id} accessible accessibilityLabel={`${m.name} · ${m.status}`} style={{ marginLeft: i ? -10 : 0 }}>
              <Pav initials={m.initials} bg={tints[i % 5][0]} fg={tints[i % 5][1]} size={38} border={C.surface}>
                <View style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: C.surface, backgroundColor: dot[m.status] }} />
              </Pav>
            </View>
          ))}
          {extra > 0 && <View style={{ marginLeft: -10 }}><Pav initials={`+${extra}`} bg={C.sunken} fg={C.muted} size={38} border={C.surface} /></View>}
        </View>
        <Txt size={12.5} tone="muted" style={{ flex: 1 }}><Txt size={14} w={700}>{t.in} of {t.total}</Txt> in office</Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 6, marginTop: 12 }}>
        {legend(C.positive, t.in, 'in office')}
        {legend(C.info, t.wfh, 'working from home')}
        {legend(C.warning, t.leave, 'on leave')}
        {t.out > 0 && legend(C.lineStrong, t.out, 'not in yet')}
      </View>
    </HomeCard>
  )
}

// ── HolidayCard — hidden when there is no next holiday ────────────────────────
export function HolidayCard({ data }: { data: TodayPayload }) {
  const { C } = useTheme()
  const h = data.next_holiday
  if (!h) return null
  const d = new Date(h.date + 'T00:00:00')
  return (
    <HomeCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 58, height: 62, borderRadius: 13, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={25} w={700} color={C.onAccent} style={{ lineHeight: 28 }}>{String(d.getDate()).padStart(2, '0')}</Txt>
          <Txt size={10.5} w={700} color={C.onAccent} upper style={{ opacity: 0.85 }}>{d.toLocaleDateString('en-IN', { month: 'short' })}</Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={14} w={600}>{h.name}</Txt>
          <Txt size={12} tone="muted" style={{ marginTop: 2 }}>
            {d.toLocaleDateString('en-IN', { weekday: 'long' })}, {h.days_away === 0 ? 'today' : h.days_away === 1 ? 'tomorrow' : `in ${h.days_away} days`}{h.long_weekend ? ' · long weekend' : ''}
          </Txt>
        </View>
        {/* Website quirk kept: "Calendar" opens Company (ROUTES.calendar = tab:company), not the Leave tab's holidays. */}
        <MoreLink label="Calendar" onPress={() => openLink(ROUTES.calendar)} />
      </View>
    </HomeCard>
  )
}
