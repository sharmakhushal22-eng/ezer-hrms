// src/features/social/wall/composers/AppreciationComposer.tsx — the phone's
// copy of components/wall/AppreciationComposer.tsx ("Send a private note").
//
// Same read (employees.company_id → shoutout_categories, per company), same
// write (send_appreciation through wallRpc — p_related is never sent), same
// rules from lib/wall/appreciation.ts shown after the first press. Still NOT a
// chat: the reply rule is stated before the message box. No client-side
// minimum length — the server's own refusal text is shown verbatim.
import * as React from 'react'
import { TextInput, View } from 'react-native'
import {
  directProblems, directProblemFor, notesLeftToday, modeNote, REPLY_RULE,
  DEFAULT_DIRECT, EMPTY_DIRECT,
  type DirectDraft, type DirectRules, type SendMode, type DirectProblem,
} from '@web/wall/appreciation'
import { supabase } from '@/core/supabase'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT } from '@/ui/theme'
import { Txt, webNoOutline } from '@/ui/primitives'
import { wallRpc } from '../rpc'
import { CategoryGrid, ChoiceTile, FieldError, Icon, RAD, Step, WButton, WEmpty, WNotice } from '../ui'
import PersonPicker, { type Person } from './PersonPicker'

export type { Person }
export interface Category { id: string; code: string; label: string; glyph?: string | null; helper_text?: string | null }

const MODE_OPTIONS: { k: SendMode; label: string; glyph: string }[] = [
  { k: 'private', label: 'Just to them', glyph: '✉️' },
  { k: 'also_post', label: 'Also post it to the feed', glyph: '📣' },
]

/** Ruled paper: one line every 28px, as the web's repeating gradient. */
const RULE = 28

// ── module scope ─────────────────────────────────────────────────────────

/** Where it goes. Two options, never a scope picker. One tile per row. */
function ModeChoice({ mode, onPick, allowShare }: { mode: SendMode; onPick: (m: SendMode) => void; allowShare: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      {MODE_OPTIONS.map(o => (
        <ChoiceTile key={o.k} on={o.k === mode} onPick={() => onPick(o.k)}
          disabled={o.k === 'also_post' && !allowShare}
          glyph={o.glyph} title={o.label} text={modeNote(o.k, allowShare)} />
      ))}
    </View>
  )
}

function Letter({ value, onChange, left }: { value: string; onChange: (v: string) => void; left: number }) {
  const { C } = useTheme()
  const [h, setH] = React.useState(116)
  const lines = Math.max(0, Math.floor((h - 14) / RULE))
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: RAD.tile, backgroundColor: C.surface, overflow: 'hidden' }}>
      <View onLayout={e => setH(e.nativeEvent.layout.height)}>
        {/* ruled paper, drawn with the sunken token so it themes */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
          {Array.from({ length: lines }, (_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: 14 + RULE * (i + 1) - 1, height: 1, backgroundColor: C.sunken }} />
          ))}
        </View>
        <TextInput nativeID="wof-note-body" value={value} onChangeText={onChange}
          multiline numberOfLines={4} textAlignVertical="top"
          placeholder="Thank you for…" placeholderTextColor={C.faint} accessibilityLabel="Your note"
          style={[{ minHeight: 116, paddingTop: 14, paddingBottom: 14, paddingHorizontal: 16, fontFamily: FONT[400], fontSize: F.body, lineHeight: RULE, color: C.ink, backgroundColor: 'transparent' }, webNoOutline]} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.sunken }}>
        <Txt size={F.micro} tone="faint" style={{ flexShrink: 1 }}>However short you like</Txt>
        <Txt size={F.micro} w={600} color={left > 0 ? C.muted : C.critical}>
          {left > 0 ? `${left} note${left === 1 ? '' : 's'} left today` : 'None left today'}
        </Txt>
      </View>
    </View>
  )
}

// ── the composer ─────────────────────────────────────────────────────────

export default function AppreciationComposer({
  actorId, rules = DEFAULT_DIRECT, sentToday = 0, onSent,
}: {
  actorId: string
  rules?: DirectRules
  sentToday?: number
  onSent?: () => void
}) {
  const { C } = useTheme()
  const [draft, setDraft] = React.useState<DirectDraft>(EMPTY_DIRECT)
  const [picked, setPicked] = React.useState<Person[]>([])
  const [cats, setCats] = React.useState<Category[]>([])
  const [busy, setBusy] = React.useState(false)
  const [serverErr, setServerErr] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState<string | null>(null)
  const [tried, setTried] = React.useState(false)

  React.useEffect(() => {
    if (!actorId) return
    (async () => {
      // Per company: eight categories × three companies is twenty-four rows.
      const me = await supabase.from('employees')
        .select('company_id').eq('id', actorId).maybeSingle()
      const companyId = (me.data as { company_id?: string } | null)?.company_id ?? null

      let cq = supabase.from('shoutout_categories')
        .select('id, code, label, glyph, helper_text')
        .eq('is_active', true).order('sort_order').limit(24)
      cq = companyId ? cq.eq('company_id', companyId) : cq.limit(0)
      const c = await cq
      if (!c.error) setCats((c.data ?? []) as unknown as Category[])
    })()
  }, [actorId])

  const ctx = { actorId, sentToday,
                nameOf: (id: string) => picked.find(p => p.id === id)?.full_name ?? 'that person' }
  const probs: DirectProblem[] = directProblems(draft, ctx, rules)
  const left = notesLeftToday(ctx, rules)
  const show = (f: Parameters<typeof directProblemFor>[0]) => tried ? directProblemFor(f, probs) : null

  const add = React.useCallback((p: Person) => {
    setPicked(cur => cur.some(x => x.id === p.id) ? cur : [...cur, p])
    setDraft(d => d.receiverIds.includes(p.id) ? d : { ...d, receiverIds: [...d.receiverIds, p.id] })
  }, [])

  const remove = React.useCallback((id: string) => {
    setPicked(cur => cur.filter(p => p.id !== id))
    setDraft(d => ({ ...d, receiverIds: d.receiverIds.filter(r => r !== id) }))
  }, [])

  async function send() {
    setTried(true); setServerErr(null); setSent(null)
    if (probs.length) return
    setBusy(true)
    const r = await wallRpc('send_appreciation', {
      p_receivers: draft.receiverIds,
      p_category: draft.categoryCode,
      p_body: draft.body.trim(),
      p_also_post: draft.mode === 'also_post',
      p_visibility: draft.visibility,
    }, actorId)
    setBusy(false)
    if (r.error) { setServerErr(r.error.message); return }
    setDraft(EMPTY_DIRECT); setPicked([]); setTried(false)
    setSent('Sent. They will see it in their inbox.')
    onSent?.()
  }

  if (!rules.enabled) {
    return (
      <WEmpty icon="mail" title="Private notes are switched off">
        Direct appreciation is switched off for this company. You can still give a shoutout on the wall.
      </WEmpty>
    )
  }

  // Computed rather than `++n` in JSX (the React Compiler memoises JSX).
  const nNote = cats.length > 0 ? 3 : 2
  return (
    <View style={{ gap: 12 }}>
      {/* Stated first, because it changes how somebody writes. */}
      <WNotice tone="info" title="A note, not a chat">{REPLY_RULE}</WNotice>

      <View>
        <Step n={1} title="Who are you thanking" hint={`Up to ${rules.maxReceivers} people`}
          error={show('receivers')} done={picked.length > 0}>
          <PersonPicker picked={picked} onAdd={add} onRemove={remove} inputId="wof-note-people" />
        </Step>

        {cats.length > 0 && (
          <Step n={2} title="What for" error={show('category')} done={!!draft.categoryCode}>
            <CategoryGrid cats={cats} value={draft.categoryCode}
              onPick={code => setDraft(d => ({ ...d, categoryCode: code }))} />
          </Step>
        )}

        <Step n={nNote} title="Your note" error={show('body')} done={draft.body.trim().length > 0}>
          <Letter value={draft.body} left={left} onChange={v => setDraft(d => ({ ...d, body: v }))} />
        </Step>

        <Step n={nNote + 1} title="Where it goes" error={show('mode')} done>
          <ModeChoice mode={draft.mode} allowShare={rules.allowShareToFeed}
            onPick={m => setDraft(d => ({ ...d, mode: m }))} />
        </Step>
      </View>

      <FieldError>{show('quota')}</FieldError>
      {serverErr && <WNotice tone="critical">{serverErr}</WNotice>}
      {sent && <WNotice tone="positive">{sent}</WNotice>}

      <View style={{ paddingLeft: 40, gap: 10 }}>
        <WButton variant="primary" size="lg" icon="send" full onPress={send}
          busy={busy} disabled={left === 0}>
          {busy ? 'Sending…' : 'Send note'}
        </WButton>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Icon name="lock" size={13} color={C.faint} />
          <Txt size={F.micro} tone="faint">
            {draft.mode === 'private' ? 'Only they will see it' : 'They get it, and it goes on the feed'}
          </Txt>
        </View>
      </View>
    </View>
  )
}
