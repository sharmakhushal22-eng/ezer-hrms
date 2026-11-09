// src/features/home/Community.tsx — the people cards of Home:
// Celebrations (Wish), NewJoiners (Welcome), RecognitionCard, Announcements.
// Ports of the files of the same names in components/ess/today.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { openLink } from '@/core/links'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { Txt } from '@/ui/primitives'
import { ROUTES } from '@web/today/schema'
import { markAnnouncementRead, sendCelebration, useJoinersFallback, type TodayPayload } from './data'
import { CardHead, EmptyLine, HomeCard, Pav, SmallButton, useGold } from './kit'
import { GStar } from './glyphs'

type Toast = (m: string, kind?: 'success' | 'error') => void

// ── Celebrations — "Birthdays & anniversaries" ───────────────────────────────
const when = (iso: string) => {
  const d = new Date(iso + 'T00:00:00'), diff = Math.round((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5)
  const dm = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : diff < 7 ? `on ${d.toLocaleDateString('en-IN', { weekday: 'long' })}, ${dm}` : `on ${dm}`
}

export function Celebrations({ data, onToast }: { data: TodayPayload; onToast: Toast }) {
  const { C } = useTheme()
  const gold = useGold()
  const [sent, setSent] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  const tints: [string, string][] = [[C.brandTint, C.brand], [gold.bg, gold.fg], [C.positiveTint, C.positive], [C.infoTint, C.info]]
  const list = data.celebrations
  const wish = async (id: string, kind: 'birthday' | 'anniversary') => {
    const key = id + kind
    setBusy(key)
    try {
      await sendCelebration(id, kind === 'birthday' ? 'BIRTHDAY' : 'ANNIVERSARY')
      setSent(s => ({ ...s, [key]: true }))
      onToast('Your wish is on their wall')
      void invalidate('social')
    } catch { onToast('Could not send the wish', 'error') } finally { setBusy(null) }
  }
  return (
    <HomeCard>
      <CardHead title="Birthdays & anniversaries" />
      {list.length === 0 ? <EmptyLine>No birthdays or anniversaries in the next 30 days.</EmptyLine> : (
        <View style={{ gap: 10 }}>
          {list.map((c, i) => {
            const key = c.id + c.kind
            return (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pav initials={c.initials} bg={tints[i % 4][0]} fg={tints[i % 4][1]}>
                  <Txt size={14} color={c.kind === 'birthday' ? undefined : gold.fg} style={{ position: 'absolute', right: c.kind === 'birthday' ? -6 : -4, bottom: c.kind === 'birthday' ? -4 : -6 }}>
                    {c.kind === 'birthday' ? '🎂' : '✦'}
                  </Txt>
                </Pav>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt size={13.5} w={600}>{c.name}</Txt>
                  <Txt size={12} tone="muted">{c.kind === 'birthday' ? `Birthday ${when(c.on)}` : `${c.years} year${c.years! > 1 ? 's' : ''} ${when(c.on)}`}</Txt>
                </View>
                <SmallButton label={sent[key] ? 'Sent' : 'Wish'} done={!!sent[key]} busy={busy === key} onPress={() => wish(c.id, c.kind)} />
              </View>
            )
          })}
        </View>
      )}
    </HomeCard>
  )
}

// ── NewJoiners — hidden when empty ────────────────────────────────────────────
const joined = (iso: string | null) => iso ? `Joined ${new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Recently joined'

export function NewJoiners({ data, onToast }: { data: TodayPayload; onToast: Toast }) {
  const { C } = useTheme()
  const gold = useGold()
  const fb = useJoinersFallback(data.employee.id, !data.new_joiners)
  const [sent, setSent] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  const list = data.new_joiners ?? fb.data ?? []
  if (!list.length) return null
  const tints: [string, string][] = [[C.positiveTint, C.positive], [C.brandTint, C.brand], [C.infoTint, C.info], [gold.bg, gold.fg]]
  const welcome = async (id: string, name: string) => {
    setBusy(id)
    try {
      await sendCelebration(id, 'JOINING')
      setSent(s => ({ ...s, [id]: true }))
      onToast(`You welcomed ${name.split(' ')[0]}`)
      void invalidate('social')
    } catch { onToast('Could not send that', 'error') } finally { setBusy(null) }
  }
  return (
    <HomeCard>
      <CardHead title="New joiners" />
      <View style={{ gap: 10 }}>
        {list.map((j, i) => {
          const done = j.already_congratulated || !!sent[j.id]
          return (
            <View key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pav initials={j.initials} bg={tints[i % 4][0]} fg={tints[i % 4][1]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={13.5} w={600}>{j.name}</Txt>
                <Txt size={12} tone="muted">{[j.designation, j.department].filter(Boolean).join(' · ') || joined(j.joined_on)}</Txt>
              </View>
              <SmallButton label={done ? 'Welcomed' : 'Welcome'} done={done} busy={busy === j.id} onPress={() => welcome(j.id, j.name)} />
            </View>
          )
        })}
      </View>
    </HomeCard>
  )
}

// ── RecognitionCard ───────────────────────────────────────────────────────────
const ago = (iso: string) => { const d = Math.round((Date.now() - new Date(iso).getTime()) / 864e5); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago` }

export function RecognitionCard({ data }: { data: TodayPayload }) {
  const { C } = useTheme()
  const gold = useGold()
  const r = data.recognition
  return (
    <HomeCard>
      <CardHead title="Recognition" more={{ label: 'Wall of Fame', onPress: () => openLink(ROUTES.wall) }} />
      {r ? (
        <View style={{ borderRadius: 15, overflow: 'hidden', borderWidth: 1, borderColor: C.brandEdge }}>
          <LinearGradient colors={[C.brandTint, C.surface]} locations={[0, 0.7]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 13 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: gold.fg, backgroundColor: gold.bg, alignItems: 'center', justifyContent: 'center' }}>
              <GStar size={22} color={gold.fg} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={13.5} w={700}>{r.badge ?? 'Appreciation'} <Txt size={13.5} w={500} tone="muted">· from {r.from}, {ago(r.at)}</Txt></Txt>
              {!!r.message && <Txt size={13} tone="soft" style={{ marginTop: 3, lineHeight: 19 }}>{r.message}</Txt>}
              {!!r.tags?.length && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {r.tags.map(t => (
                    <View key={t} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }}>
                      <Txt size={11} w={600} tone="muted">{t}</Txt>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </LinearGradient>
        </View>
      ) : <EmptyLine>No kudos yet. Appreciation from colleagues will appear here.</EmptyLine>}
      <Pressable onPress={() => openLink(ROUTES.appreciate)} accessibilityRole="button"
        style={({ pressed }) => ({ marginTop: 10, height: 44, borderRadius: 11, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
          borderColor: pressed ? C.brandEdge : C.lineStrong, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
        <Txt size={13} w={600} tone="brand">Appreciate a colleague</Txt>
      </Pressable>
    </HomeCard>
  )
}

// ── Announcements ─────────────────────────────────────────────────────────────
const annWhen = (iso: string) => {
  const d = new Date(iso), diff = Math.round((Date.now() - d.getTime()) / 864e5)
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? d.toLocaleDateString('en-IN', { weekday: 'short' }) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
/** today.css .feat — the pinned banner's own warm gradient and button colours. */
const FEAT = { bg: ['#7C2D12', '#C2410C', '#F59E0B'] as const, btnBg: 'rgba(255,255,255,0.92)', btnFg: '#7C2D12', fg: '#FFFFFF' }

export function Announcements({ data }: { data: TodayPayload }) {
  const { C } = useTheme()
  const a = data.announcements
  const [read, setRead] = React.useState<Record<string, boolean>>({})
  const markRead = (id: string) => { if (read[id]) return; setRead(r => ({ ...r, [id]: true })); void markAnnouncementRead(id) }
  if (!a.pinned && a.items.length === 0) return (
    <HomeCard><CardHead title="Announcements" /><EmptyLine>No announcements right now.</EmptyLine></HomeCard>
  )
  return (
    <HomeCard>
      <CardHead title="Announcements" />
      {a.pinned && (
        <View style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
          <LinearGradient colors={FEAT.bg} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1.3, y: 0.6 }} style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
            <Txt size={11} w={700} color={FEAT.fg} style={{ opacity: 0.85 }}>Pinned</Txt>
            <Txt size={15.5} w={700} color={FEAT.fg} style={{ marginTop: 3 }}>{a.pinned.title}</Txt>
            {!!a.pinned.body && <Txt size={12.5} color={FEAT.fg} style={{ opacity: 0.9, marginTop: 2 }}>{a.pinned.body}</Txt>}
            {!!a.pinned.cta_label && !!a.pinned.cta_route && (
              <Pressable onPress={() => openLink(a.pinned!.cta_route)} accessibilityRole="button"
                style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 10, minHeight: 36, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center', backgroundColor: FEAT.btnBg, opacity: pressed ? 0.85 : 1 })}>
                <Txt size={12.5} w={700} color={FEAT.btnFg}>{a.pinned.cta_label}</Txt>
              </Pressable>
            )}
          </LinearGradient>
        </View>
      )}
      {a.items.map((it, i) => {
        const unread = it.unread && !read[it.id]
        return (
          <Pressable key={it.id} onPress={() => markRead(it.id)} accessibilityRole="button" accessibilityState={{ selected: !unread }}
            style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingTop: i ? 10 : 0, paddingBottom: 10, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
            <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: unread ? C.brand : C.lineStrong }} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={13.5} w={600}>{it.title}</Txt>
              {!!it.body && <Txt size={12} tone="muted" style={{ marginTop: 2 }}>{it.body}</Txt>}
            </View>
            <Txt size={11.5} tone="faint">{annWhen(it.published_at)}</Txt>
          </Pressable>
        )
      })}
    </HomeCard>
  )
}
