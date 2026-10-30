// src/features/inbox/ComposeSheet.tsx — "New message": the directory picker.
//
// components/ess/inbox/ComposeSheet.tsx + the pick handlers in MessagesInbox.tsx.
// The directory endpoint applies the reach policy (inbox_can_message), so this
// sheet never filters or adds people: what the server lists is what can be
// messaged. Desks come back in full and are filtered here by the search text,
// as on the website.
import * as React from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S, SERIF } from '@/ui/theme'
import { Txt, webNoOutline } from '@/ui/primitives'
import { Sheet, useOverlay } from '@/ui/overlays'
import { fetchDirectory, openThread, startConversation } from './data'
import { initials, type ConversationVM, type DirectoryVM, type FolderVM } from './model'
import { alpha, GChevron, GSearch, inkOf } from './glyphs'


function Option({ ink, left, title, sub, onPress }: { ink: string | null; left: React.ReactNode; title: string; sub: string; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, paddingHorizontal: 10, minHeight: 52, borderRadius: 11, backgroundColor: pressed ? alpha(ink || C.brand, 0.09) : 'transparent' })}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={13.5} w={600}>{title}</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 1 }}>{sub}</Txt>
      </View>
      <GChevron size={16} color={C.faint} />
    </Pressable>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return <Txt size={F.tiny} w={700} tone="faint" style={{ marginTop: S.md, marginBottom: 4, marginLeft: 10 }}>{children}</Txt>
}

interface ComposeProps {
  initialQuery?: string
  folders: Record<string, FolderVM>
  conversations: ConversationVM[]
  onClose: () => void
  /** Opened from a thread: the new thread replaces it instead of stacking. */
  replace?: boolean
}

export function ComposeSheet({ visible, ...rest }: ComposeProps & { visible: boolean }) {
  return (
    <Sheet visible={visible} onClose={rest.onClose} title="New message" full
      footer={<Txt size={F.tiny} tone="faint" style={{ paddingVertical: S.sm }}>Only colleagues and desks your company’s reach policy allows are listed. Nothing here will be refused on send.</Txt>}>
      {/* Mounted per opening, so the search starts from the carried-over query. */}
      {visible && <ComposeBody {...rest} />}
    </Sheet>
  )
}

function ComposeBody({ initialQuery = '', folders, conversations, onClose, replace }: ComposeProps) {
  const emp = useEmployeeId()
  const { C, isDark } = useTheme()
  const { notify } = useOverlay()
  const [q, setQ] = React.useState(initialQuery)
  const [dir, setDir] = React.useState<DirectoryVM | null>(null)
  const [busy, setBusy] = React.useState(true)
  const [failed, setFailed] = React.useState<string | null>(null)
  const onQuery = (v: string) => { setQ(v); setBusy(true) }

  // Debounced: 180 ms while typing, at once for an empty box. A stale answer is ignored.
  React.useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      fetchDirectory(emp, q)
        .then(r => { if (alive) { setDir(r); setFailed(null) } })
        .catch((e: Error) => { if (alive) { setDir(null); setFailed(e.message || 'The directory did not load.') } })
        .finally(() => { if (alive) setBusy(false) })
    }, q ? 180 : 0)
    return () => { alive = false; clearTimeout(t) }
  }, [q, emp])

  const needle = q.trim().toLowerCase()
  const desks = (dir?.desks ?? []).filter(d => !needle || `${d.name} ${d.hint} ${d.code}`.toLowerCase().includes(needle))
  const people = dir?.people ?? []
  const unstaffed = desks.filter(d => d.unstaffed)
  const how = replace ? 'replace' : 'push'

  async function pickPerson(id: string) {
    onClose()
    try { const cid = await startConversation(emp, { person: id }); if (cid) openThread(emp, cid, how) }
    catch (e) { notify((e as Error).message || 'Could not start the conversation', 'error') }
  }
  async function pickDesk(code: FolderVM['code']) {
    onClose()
    // Website quirk kept: a DESK thread's folder is its desk code through STREAMS
    // (falling back to HR), so ADMIN never finds its existing thread.
    const existing = conversations.find(c => c.kind === 'DESK' && c.folder === code)
    if (existing) { openThread(emp, existing.id, how); return }
    try { const cid = await startConversation(emp, { desk: code }); if (cid) openThread(emp, cid, how) }
    catch (e) { notify((e as Error).message || 'Could not reach the desk', 'error') }
  }

  const direct = folders.DIRECT
  const directInk = inkOf(direct, isDark, C.brand)

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.md, paddingHorizontal: S.md, backgroundColor: C.surface, minHeight: 46 }}>
        <GSearch size={16} color={C.faint} />
        <TextInput value={q} onChangeText={onQuery} autoFocus selectTextOnFocus placeholder="Search a colleague by name or code…" placeholderTextColor={C.faint}
          autoCorrect={false} autoCapitalize="none" accessibilityLabel="Search a colleague"
          style={[{ flex: 1, fontFamily: FONT[400], fontSize: F.body, color: C.ink, paddingVertical: 10 }, webNoOutline]} />
      </View>

      {desks.length > 0 && (
        <>
          <Section>Departments</Section>
          {desks.map(d => {
            const ink = folders[d.code] ? inkOf(folders[d.code], isDark, C.brand) : null
            return (
              <Option key={d.code} ink={ink} title={d.name} sub={d.hint} onPress={() => void pickDesk(d.code)}
                left={<View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: ink || 'transparent' }} />} />
            )
          })}
        </>
      )}
      {unstaffed.length > 0 && (
        <View style={{ marginTop: S.sm, padding: S.md, borderRadius: R.md, backgroundColor: C.warningTint, borderWidth: 1, borderColor: C.warningEdge }}>
          <Txt size={12.5} tone="soft">
            <Txt size={12.5} w={700}>{unstaffed.map(d => d.name).join(', ')}</Txt> has nobody assigned yet, so a message may sit unanswered. HR can assign people in Admin Setup → Inbox.
          </Txt>
        </View>
      )}
      {people.length > 0 && (
        <>
          <Section>People</Section>
          {people.map(p => (
            <Option key={p.id} ink={directInk} title={p.name} sub={`${p.code} · ${p.designation}`} onPress={() => void pickPerson(p.id)}
              left={
                <View style={{ width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(directInk, 0.14), borderWidth: 1, borderColor: alpha(directInk, 0.22) }}>
                  <Txt size={11.5} w={700} color={directInk}>{initials(p.name)}</Txt>
                </View>
              } />
          ))}
        </>
      )}
      {dir && !busy && !failed && desks.length === 0 && people.length === 0 && (
        <View style={{ paddingVertical: S.xl, paddingHorizontal: S.md, alignItems: 'center' }}>
          <Txt size={20} w={600} center style={{ fontFamily: SERIF }}>{dir.matchedSelf ? 'That is you' : 'No one found'}</Txt>
          <Txt size={F.small} tone="muted" center style={{ marginTop: 4 }}>
            {dir.matchedSelf
              ? `“${q.trim()}” matches your own record, and you cannot message yourself. Search for a colleague instead.`
              : q.trim() ? `Nothing matches “${q.trim()}”. Try a name, an employee code, or a desk.` : 'Try a name, employee code or a desk.'}
            {!dir.matchedSelf && ' Only colleagues your reach policy allows are listed.'}
          </Txt>
        </View>
      )}
      {failed && !busy && (
        <View style={{ paddingVertical: S.xl, paddingHorizontal: S.md, alignItems: 'center' }}>
          <Txt size={20} w={600} center>Could not load the directory</Txt>
          <Txt size={F.small} tone="muted" center style={{ marginTop: 4 }}>{failed} Check your connection and try again. Nothing has been sent.</Txt>
        </View>
      )}
      {!dir && busy && (
        <View style={{ padding: S.xl, alignItems: 'center', gap: S.md }}>
          <ActivityIndicator color={C.brand} />
          <Txt size={F.small} tone="muted">Loading the directory…</Txt>
        </View>
      )}
    </>
  )
}
