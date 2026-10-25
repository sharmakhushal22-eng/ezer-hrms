// src/features/funzone/live/PlayTogether.tsx — invite a colleague, answer an
// invite, and play live. Port of components/funzone/PlayTogether.tsx (spec 08
// §5.10). The hub wraps it in Stage(icon 🤝, "Play together", left body).
//
// Every rule is lib/funzone/invite.ts (imported unchanged, the same functions
// the server runs). Every call goes through /api/ess/funzone (./client), never
// to the Fun Zone tables directly.
//
// Web behaviour reproduced on purpose (spec §5.10.4, §5.18 point 10a): only the
// RECIPIENT enters a live game. An accepted invite you sent shows "accepted"
// with no Join button — the GET payload has no seed, and adding a host-join is
// a product decision.
import * as React from 'react'
import { AppState, Pressable, TextInput, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S, R, FONT } from '@/ui/theme'
import { Txt, PickerField, webNoOutline } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import type { Palette } from '@/ui/theme'
import { LIVE_GAMES, gameByCode } from '@web/funzone/games'
import {
  canInvite, canAccept, canDecline, canCancel, effectiveStatus, minutesLeft, inboxOrder,
  STATUS_LABEL, inviteLine, INVITE_TTL_MINUTES, type Invite,
} from '@web/funzone/invite'
import { listInvites, funzone, setFunzoneOwner } from './client'
import LiveTicTacToe from './LiveTicTacToe'
import LiveMemoryMatch from './LiveMemoryMatch'
import LiveTrivia from './LiveTrivia'

const nowIso = () => new Date().toISOString()
const GAME_OPTIONS = LIVE_GAMES.map(g => ({ value: g.code as string, label: g.name }))

interface Colleague { id: string; name: string; code?: string | null }
interface LiveGame { sessionId: string; hostId: string; opponent: string; gameCode: string; seed: number }

// ── module-level pieces ────────────────────────────────────────────────────

function WarnCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warning, borderRadius: R.lg, paddingVertical: 16, paddingHorizontal: 18 }}>
      <Txt size={F.body} w={700}>{title}</Txt>
      <Txt size={F.small} tone="muted" style={{ marginTop: 8, lineHeight: 22 }}>{children}</Txt>
    </View>
  )
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <View style={{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, paddingVertical: 16, paddingHorizontal: 18 }}>
      <Txt size={F.body} w={700}>{title}</Txt>
      <Txt size={F.micro} tone="muted" style={{ marginTop: 3, marginBottom: 12 }}>{sub}</Txt>
      {children}
    </View>
  )
}

/** The web's `lbl`: micro, bold, inkSoft, uppercase, .05em. */
function Lbl({ children }: { children: string }) {
  const { C } = useTheme()
  return <Txt size={F.micro} w={700} color={C.inkSoft} style={{ textTransform: 'uppercase', letterSpacing: F.micro * 0.05, marginBottom: 5 }}>{children}</Txt>
}

function fieldBox(C: Palette) {
  return { minHeight: 46, borderRadius: R.sm + 1, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, paddingHorizontal: S.md } as const
}

function SmallBtn({ title, onPress, disabled, go }: { title: string; onPress: () => void; disabled?: boolean; go?: boolean }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} hitSlop={4}
      style={({ pressed }) => ({
        minHeight: 40, justifyContent: 'center', paddingVertical: 7, paddingHorizontal: go ? 14 : 12, borderRadius: R.sm,
        borderWidth: go ? 0 : 1, borderColor: C.line, backgroundColor: go ? C.brand : pressed ? C.sunken : C.surface,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}>
      <Txt size={F.tiny} w={go ? 700 : 600} color={go ? C.onAccent : C.muted}>{title}</Txt>
    </Pressable>
  )
}

function InviteItem({ inv, me, now, busy, onAccept, onAnswer }: {
  inv: Invite; me: string; now: string; busy: boolean
  onAccept: (inv: Invite) => void; onAnswer: (inv: Invite, status: 'DECLINED' | 'CANCELLED') => void
}) {
  const { C } = useTheme()
  const st = effectiveStatus(inv, now)
  // Which side of the invite I am on — judged against the SESSION identity.
  const mine = inv.fromId === me
  const g = gameByCode(inv.gameCode)
  const waiting = st === 'PENDING'
  const forMe = waiting && !mine
  return (
    <View style={{ borderWidth: 1, borderColor: forMe ? C.brand : C.line, backgroundColor: forMe ? C.brandTint : C.surface, borderRadius: R.sm, paddingVertical: 10, paddingHorizontal: 13, gap: 10 }}>
      <View>
        <Txt size={F.small} w={600}>
          {mine ? `You invited ${inv.toName ?? 'a colleague'} to ${g?.name ?? inv.gameCode}` : inviteLine(inv, g?.name ?? inv.gameCode)}
        </Txt>
        <Txt size={F.micro} tone="muted" style={{ marginTop: 2 }}>
          {waiting ? `${STATUS_LABEL[st]} · ${minutesLeft(inv, now)} min left` : STATUS_LABEL[st]}
          {inv.message ? ` · “${inv.message}”` : ''}
        </Txt>
      </View>
      {forMe && (
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <SmallBtn go title="Play" onPress={() => onAccept(inv)} disabled={busy || !canAccept(inv, me, now).ok} />
          <SmallBtn title="No thanks" onPress={() => onAnswer(inv, 'DECLINED')} disabled={busy || !canDecline(inv, me, now).ok} />
        </View>
      )}
      {waiting && mine && (
        <View style={{ flexDirection: 'row' }}>
          <SmallBtn title="Withdraw" onPress={() => onAnswer(inv, 'CANCELLED')} disabled={busy || !canCancel(inv, me, now).ok} />
        </View>
      )}
    </View>
  )
}

function SearchResults({ term, searching, people, onPick }: {
  term: string; searching: boolean; people: Colleague[]; onPick: (p: Colleague) => void
}) {
  const { C } = useTheme()
  return (
    <View style={{ marginTop: S.sm, borderWidth: 1, borderColor: C.line, borderRadius: R.md, overflow: 'hidden' }}>
      {searching && <Txt size={F.micro} tone="muted" style={{ paddingVertical: 8, paddingHorizontal: 10 }}>Searching…</Txt>}
      {!searching && !people.length && (
        <Txt size={F.micro} tone="muted" style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
          Nobody matches “{term}”. Try a different spelling, or their employee code.
        </Txt>
      )}
      {!searching && people.map(pp => (
        <Pressable key={pp.id} onPress={() => onPick(pp)} accessibilityRole="button"
          style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
          <Txt size={F.micro}>
            <Txt size={F.micro} w={700}>{pp.name}</Txt>
            {pp.code ? <Txt size={F.micro} tone="muted"> · {pp.code}</Txt> : null}
          </Txt>
        </Pressable>
      ))}
    </View>
  )
}

// ── the screen ─────────────────────────────────────────────────────────────

export default function PlayTogether({ meId }: { meId: string }) {
  const { C } = useTheme()
  const [invites, setInvites] = React.useState<Invite[]>([])
  /** The last search answer, and the term it answers (searching = the term has no answer yet). */
  const [found, setFound] = React.useState<{ term: string; people: Colleague[] }>({ term: '', people: [] })
  const [query, setQuery] = React.useState('')
  /** Who the SERVER says I am — the identity for every rule (session wins over portal owner). */
  const [serverMe, setServerMe] = React.useState<string | null>(null)
  const [serverName, setServerName] = React.useState<string | null>(null)
  /** Held separately from the results, which are cleared on pick. */
  const [chosen, setChosen] = React.useState<Colleague | null>(null)
  const [ready, setReady] = React.useState<boolean | null>(null)
  const [loadErr, setLoadErr] = React.useState<{ auth: boolean; msg: string } | null>(null)
  const [game, setGame] = React.useState<string>(LIVE_GAMES[0].code)
  const [picker, setPicker] = React.useState(false)
  const [who, setWho] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [live, setLive] = React.useState<LiveGame | null>(null)
  const [, tick] = React.useState(0)

  const meRef = React.useRef(meId)
  React.useLayoutEffect(() => { meRef.current = meId })
  const load = React.useCallback(async () => {
    // No employee yet = the session is still being restored; a call now would
    // go out without a token and the 401 would sign the person out.
    if (!meRef.current) return
    setFunzoneOwner(meRef.current)
    const r = await listInvites()
    if (r.error) {
      // Most often an expired session — say the true thing.
      setLoadErr({ auth: r.error.status === 401, msg: r.error.message })
      setReady(null)
      return
    }
    setLoadErr(null)
    setReady(r.data?.installed !== false)
    setInvites(r.data?.invites ?? [])
    const sm = r.data?.me
    if (sm) {
      setServerMe(sm)
      const rows = r.data?.invites ?? []
      setServerName(rows.find(i => i.fromId === sm)?.fromName ?? rows.find(i => i.toId === sm)?.toName ?? null)
    }
  }, [])

  // On mount, then every 15 s (re-render the countdowns AND refetch). Paused
  // while the app is in the background; back in the foreground it reloads.
  React.useEffect(() => {
    const first = setTimeout(() => { void load() }, 0)
    let t: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!t) t = setInterval(() => { tick(n => n + 1); load() }, 15_000) }
    const stop = () => { if (t) { clearInterval(t); t = null } }
    if (AppState.currentState !== 'background') start()
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') { if (!t) { tick(n => n + 1); load() } start() }
      else if (s === 'background') stop()
    })
    return () => { clearTimeout(first); stop(); sub.remove() }
  }, [load, meId])

  // Search, never browse: ≥ 2 characters, debounced 250 ms, at most ten back.
  React.useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return
    const t = setTimeout(async () => {
      const r = await funzone<{ people: Colleague[] }>('search', { q: term })
      setFound({ term, people: r.error ? [] : (r.data?.people ?? []) })
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const who_me = serverMe ?? meId

  if (live) {
    const onExit = () => { setLive(null); load() }
    if (live.gameCode === 'mem') {
      return <LiveMemoryMatch sessionId={live.sessionId} seed={live.seed} meId={who_me} hostId={live.hostId} opponentName={live.opponent} onExit={onExit} />
    }
    if (live.gameCode === 'quiz') {
      return <LiveTrivia sessionId={live.sessionId} seed={live.seed} meId={who_me} hostId={live.hostId} opponentName={live.opponent} onExit={onExit} />
    }
    return <LiveTicTacToe sessionId={live.sessionId} meId={who_me} hostId={live.hostId} opponentName={live.opponent} onExit={onExit} />
  }

  if (loadErr) {
    return (
      <WarnCard title={loadErr.auth ? 'Please sign in again' : 'Could not load Fun Zone'}>
        {loadErr.auth ? 'Your session has expired. Sign out and back in, then reopen Fun Zone.' : loadErr.msg}
      </WarnCard>
    )
  }

  if (ready === false) {
    return (
      <WarnCard title="Playing together is not switched on yet">
        The games all work on their own. Inviting somebody needs{' '}
        <Txt size={F.small} style={{ backgroundColor: C.sunken, borderRadius: 6, fontFamily: FONT[500] }}> 090_funzone_multiplayer.sql </Txt>
        , which is handed to Nayan rather than run from here.
      </WarnCard>
    )
  }

  const now = nowIso()
  const verdict = canInvite(who_me, who, game, { liveGames: LIVE_GAMES.map(g => g.code), existing: invites, now })
  const canSend = !!who && verdict.ok
  const clearPicker = () => { setWho(''); setChosen(null); setQuery(''); setFound({ term: '', people: [] }) }

  const send = async () => {
    setBusy(true); setErr(null)
    const r = await funzone('send', { to: who, game, message: note.trim() || null })
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    clearPicker(); setNote(''); load()
  }

  const accept = async (inv: Invite) => {
    setBusy(true); setErr(null)
    const r = await funzone<{ session?: { session_id?: string; seed?: number; game_code?: string } }>('accept', { id: inv.id })
    setBusy(false)
    if (r.error) { setErr(r.error.message); load(); return }
    const d = r.data?.session
    if (d?.session_id) {
      setLive({ sessionId: d.session_id, hostId: inv.fromId, opponent: inv.fromName ?? 'your opponent',
                gameCode: d.game_code ?? inv.gameCode, seed: d.seed ?? 1 })
    }
    load()
  }

  const answer = async (inv: Invite, status: 'DECLINED' | 'CANCELLED') => {
    setBusy(true); setErr(null)
    const r = await funzone('answer', { id: inv.id, status })
    setBusy(false)
    if (r.error) setErr(r.error.message)
    load()
  }

  const term = query.trim()
  const searching = term.length >= 2 && found.term !== term
  const people = found.term === term ? found.people : []

  return (
    <View style={{ gap: S.md }}>
      {!!serverMe && serverMe !== meId && (
        <View style={{ borderWidth: 1, borderColor: C.critical, borderRadius: R.sm, paddingVertical: 11, paddingHorizontal: 13, backgroundColor: C.criticalTint }}>
          <Txt size={F.small}>
            <Txt size={F.small} w={700}>This is not your Fun Zone.</Txt>
            {` You are signed in as ${serverName ?? 'a different employee'}, but you are looking at somebody else’s portal. The invites below are yours, not theirs, so anything you send or accept here happens as you. Open your own portal, or sign in again in this tab.`}
          </Txt>
        </View>
      )}

      <Section title="Ask somebody to play"
        sub={`They get it in their inbox. Invites last ${INVITE_TTL_MINUTES} minutes. It is an offer to play now, not an appointment.`}>
        <View style={{ gap: S.sm }}>
          <View>
            <Lbl>Game</Lbl>
            <PickerField value={gameByCode(game)?.name ?? game} onPress={() => setPicker(true)} style={{ marginBottom: 0 }} />
          </View>
          <View>
            <Lbl>Who</Lbl>
            {who ? (
              <View style={[fieldBox(C), { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }]}>
                <Txt size={F.small} numberOfLines={1} style={{ flex: 1 }}>
                  {chosen ? `${chosen.name}${chosen.code ? ` (${chosen.code})` : ''}` : ''}
                </Txt>
                <Pressable onPress={clearPicker} accessibilityRole="button" hitSlop={10} style={{ minHeight: 36, justifyContent: 'center' }}>
                  <Txt size={F.micro} tone="muted">change</Txt>
                </Pressable>
              </View>
            ) : (
              <TextInput value={query} onChangeText={setQuery} placeholder="Name or employee code" placeholderTextColor={C.faint}
                accessibilityLabel="Search for a colleague by name or employee code" autoCorrect={false} autoCapitalize="none"
                style={[fieldBox(C), { fontFamily: FONT[400], fontSize: F.small, color: C.ink }, webNoOutline]} />
            )}
          </View>
          <View>
            <Lbl>Say something (optional)</Lbl>
            <TextInput value={note} onChangeText={setNote} placeholder="Best of three?" placeholderTextColor={C.faint}
              style={[fieldBox(C), { fontFamily: FONT[400], fontSize: F.small, color: C.ink }, webNoOutline]} />
          </View>
        </View>

        {!!who && !verdict.ok && <Txt size={F.micro} color={C.warning} style={{ marginTop: 8 }}>{verdict.because}</Txt>}
        {!!err && <Txt size={F.micro} color={C.critical} style={{ marginTop: 8 }}>{err}</Txt>}

        {!who && term.length >= 2 && (
          <SearchResults term={term} searching={searching} people={people}
            onPick={pp => { setWho(pp.id); setChosen(pp); setFound({ term: '', people: [] }) }} />
        )}

        <Pressable onPress={send} disabled={!canSend || busy} accessibilityRole="button" accessibilityState={{ disabled: !canSend || busy }}
          style={({ pressed }) => ({
            marginTop: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 18,
            borderRadius: R.sm, backgroundColor: canSend ? C.brand : C.sunken, opacity: pressed && canSend ? 0.85 : 1,
          })}>
          <Txt size={F.small} w={700} color={canSend ? C.onAccent : C.faint}>{busy ? 'Sending…' : 'Send the invite'}</Txt>
        </Pressable>
      </Section>

      <Section title="Invites" sub="Waiting on you first.">
        {invites.length === 0 ? (
          <Txt size={F.small} tone="muted" style={{ lineHeight: 22 }}>Nothing yet. Send one above, and it appears in their inbox straight away.</Txt>
        ) : (
          <View style={{ gap: 8 }}>
            {inboxOrder(invites, who_me, now).map(inv => (
              <InviteItem key={inv.id} inv={inv} me={who_me} now={now} busy={busy} onAccept={accept} onAnswer={answer} />
            ))}
          </View>
        )}
      </Section>

      <SelectSheet visible={picker} onClose={() => setPicker(false)} title="Game" options={GAME_OPTIONS}
        value={game} onPick={v => setGame(v)} searchable={false} />
    </View>
  )
}
