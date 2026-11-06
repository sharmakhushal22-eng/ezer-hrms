// src/features/social/wall/composers/ShoutoutComposer.tsx — the phone's copy
// of components/wall/ShoutoutComposer.tsx ("Give a shoutout").
//
// Same reads (employees.company_id → shoutout_categories + recognition_values,
// both per company), same writes (create_shoutout, then set_recognition_marks
// for the badge and tags, through wallRpc), same rules from
// lib/wall/shoutout.ts shown only after the first press. The send button stays
// enabled while the form is incomplete — pressing it is how somebody finds out
// what is missing.
//
// Phone layout: the web's Split(steps | sticky rail) is one column — the
// numbered steps, then the preview, then the send box.
import * as React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { MAX_TAGS, badgeByRef, tagByRef } from '@web/wall/catalogue'
import {
  problems, problemFor, remainingToday, messageLength, visibilityNote,
  VISIBILITIES, DEFAULT_RULES, EMPTY_DRAFT,
  type Draft, type WallRules, type Problem,
} from '@web/wall/shoutout'
import { supabase } from '@/core/supabase'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT } from '@/ui/theme'
import { Txt, webNoOutline } from '@/ui/primitives'
import { wallRpc } from '../rpc'
import {
  Avatar, AvatarStack, CategoryGrid, FieldError, Icon, Pill, RAD, Step, WButton, WNotice,
  WSegmented, useInputStyle, type IconName,
} from '../ui'
import PersonPicker, { type Person } from './PersonPicker'
import RecognitionPicker from './RecognitionPicker'

export type { Person }
export interface Category {
  id: string; code: string; label: string; helper_text?: string | null
  glyph?: string | null; requires_value?: boolean | null
}
export interface CompanyValue { id: string; label: string }

const VIS_ICON: Record<string, IconName> = { company: 'globe', branch: 'users', department: 'users', team: 'users' }
type Visibility = typeof VISIBILITIES[number]

// ── module-scope pieces ──────────────────────────────────────────────────

function ValueChips({ values, picked, onToggle }: { values: CompanyValue[]; picked: string[]; onToggle: (id: string) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {values.map(v => {
        const on = picked.includes(v.id)
        return (
          <Pressable key={v.id} onPress={() => onToggle(v.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingVertical: 6, paddingHorizontal: 13, borderRadius: RAD.pill, borderWidth: 1.5, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandTint : C.surface }}>
            {on && <Icon name="check" size={12} stroke={2.6} color={C.brand} />}
            <Txt size={F.micro} w={600} color={on ? C.brand : C.inkSoft}>{v.label}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

function MessageMeter({ len, min }: { len: number; min: number }) {
  const { C } = useTheme()
  const pct = Math.min(100, Math.round((len / Math.max(1, min)) * 100))
  const done = len >= min
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 54, height: 4, borderRadius: 4, backgroundColor: C.sunken, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: done ? C.positive : C.brand }} />
      </View>
      {/* Counts up to the minimum, then stops nagging. */}
      <Txt size={F.micro} w={600} color={done ? C.positive : C.faint}>
        {done ? 'Long enough' : `${len} of ${min} characters`}
      </Txt>
    </View>
  )
}

function VisLine({ visibility, color }: { visibility: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name={VIS_ICON[visibility] ?? 'globe'} size={13} color={color} />
      <Txt size={F.micro} color={color} style={{ flex: 1 }}>{visibilityNote(visibility)}</Txt>
    </View>
  )
}

/** What the card will look like on the feed — the same anatomy as FeedCard. */
function Preview({ draft, people, category }: { draft: Draft; people: Person[]; category: Category | null }) {
  const { C } = useTheme()
  const badge = draft.badgeRef ? badgeByRef(draft.badgeRef) : null
  const tags = (draft.tagRefs ?? []).map(r => tagByRef(r)?.name).filter(Boolean)
  const names = people.map(p => p.full_name)
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: RAD.tile, backgroundColor: C.surface, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: C.sunken, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Icon name="eye" size={14} color={C.muted} />
        <Txt size={F.micro} w={600} tone="muted">How it will look on the wall</Txt>
      </View>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Avatar name="You" size={34} />
          <Txt size={F.small} style={{ flex: 1, minWidth: 0, lineHeight: 18 }}>
            <Txt size={F.small} w={700}>You</Txt>
            <Txt size={F.small} tone="muted"> recognised </Txt>
            <Txt size={F.small} w={700} color={names.length ? C.ink : C.faint}>{names.length ? names.join(', ') : 'nobody yet'}</Txt>
          </Txt>
          {names.length > 1 && <AvatarStack names={names} size={24} />}
        </View>
        {(category || badge) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {category && <Pill>{category.glyph ? `${category.glyph} ` : ''}{category.label}</Pill>}
            {badge && <Pill tone="neutral">{badge.glyph} {badge.name}</Pill>}
          </View>
        )}
        <View style={{ borderLeftWidth: 3, borderLeftColor: C.brandEdge, paddingLeft: 12 }}>
          <Txt size={F.small} color={draft.message ? C.inkSoft : C.faint} style={{ lineHeight: 21 }}>
            {draft.message || 'Your message will appear here.'}
          </Txt>
        </View>
        {tags.length > 0 && <Txt size={F.micro} tone="muted">{tags.join(' · ')}</Txt>}
        <VisLine visibility={draft.visibility} color={C.faint} />
      </View>
    </View>
  )
}

function QuotaDots({ left, total }: { left: number; total: number }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <Txt size={F.micro} w={600} color={left > 0 ? C.muted : C.critical}>
        {left > 0 ? `${left} left today` : 'None left today'}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i < left ? C.brand : C.line }} />
        ))}
      </View>
    </View>
  )
}

function MessageBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { C } = useTheme()
  const base = useInputStyle()
  const [focus, setFocus] = React.useState(false)
  return (
    <TextInput nativeID="wof-shout-message" value={value} onChangeText={onChange}
      multiline numberOfLines={5} textAlignVertical="top"
      placeholder="e.g. Stayed back on Friday to rebuild the dispatch sheet, so the morning shift started on time."
      placeholderTextColor={C.faint} accessibilityLabel="Your message"
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={[base, { minHeight: 120, lineHeight: 21, fontFamily: FONT[400] }, focus && { borderColor: C.brand }, webNoOutline]} />
  )
}

// ── the composer ─────────────────────────────────────────────────────────

export default function ShoutoutComposer({
  actorId, rules = DEFAULT_RULES, sentToday = 0, recentlyRecognised = [], onSent,
}: {
  actorId: string
  rules?: WallRules
  sentToday?: number
  recentlyRecognised?: string[]
  onSent?: () => void
}) {
  const { C } = useTheme()
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [picked, setPicked] = React.useState<Person[]>([])
  const [cats, setCats] = React.useState<Category[]>([])
  const [values, setValues] = React.useState<CompanyValue[]>([])
  const [sending, setSending] = React.useState(false)
  const [serverErr, setServerErr] = React.useState<string | null>(null)
  // Only show what is wrong once somebody has tried.
  const [tried, setTried] = React.useState(false)

  React.useEffect(() => {
    if (!actorId) return
    (async () => {
      // The company first: BOTH lists below are per-company.
      const me = await supabase.from('employees')
        .select('company_id').eq('id', actorId).maybeSingle()
      const companyId = (me.data as { company_id?: string } | null)?.company_id ?? null

      let cq = supabase.from('shoutout_categories')
        .select('id, code, label, helper_text, glyph, requires_value')
        .eq('is_active', true).order('sort_order').limit(24)
      cq = companyId ? cq.eq('company_id', companyId) : cq.limit(0)
      const c = await cq
      if (!c.error) setCats((c.data ?? []) as unknown as Category[])

      let vq = supabase.from('recognition_values').select('id, label')
        .eq('is_active', true).order('sort_order').limit(24)
      vq = companyId ? vq.eq('company_id', companyId) : vq.limit(0)
      const v = await vq
      if (!v.error) setValues((v.data ?? []) as unknown as CompanyValue[])
    })()
  }, [actorId])

  const category = React.useMemo(
    () => cats.find(c => c.code === draft.categoryCode) ?? null, [cats, draft.categoryCode])

  const live: Draft = { ...draft, categoryRequiresValue: Boolean(category?.requires_value) }
  const ctx = { actorId, sentToday, recentlyRecognised,
                nameOf: (id: string) => picked.find(p => p.id === id)?.full_name ?? 'that person' }
  const probs: Problem[] = problems(live, ctx, rules)
  const left = remainingToday(ctx, rules)
  const len = messageLength(draft.message)

  const add = React.useCallback((p: Person) => {
    setPicked(cur => cur.some(x => x.id === p.id) ? cur : [...cur, p])
    setDraft(d => d.receiverIds.includes(p.id) ? d : { ...d, receiverIds: [...d.receiverIds, p.id] })
  }, [])

  const remove = React.useCallback((id: string) => {
    setPicked(cur => cur.filter(p => p.id !== id))
    setDraft(d => ({ ...d, receiverIds: d.receiverIds.filter(r => r !== id) }))
  }, [])

  async function send() {
    setTried(true); setServerErr(null)
    if (probs.length) return
    setSending(true)
    const r = await wallRpc('create_shoutout', {
      p_receivers: draft.receiverIds,
      p_category: draft.categoryCode,
      p_message: draft.message.trim(),
      p_value_ids: draft.valueIds,
      p_visibility: draft.visibility,
    }, actorId)
    // The badge and tags go on afterwards, through their own function. A
    // failure here loses the marks, not the shoutout.
    if (!r.error && (draft.badgeRef || (draft.tagRefs ?? []).length)) {
      const id = (r.data as { id?: string } | null)?.id
      if (id) {
        const m = await wallRpc('set_recognition_marks', {
          p_recognition: id,
          p_badge_ref: draft.badgeRef ?? null,
          p_tag_refs: draft.tagRefs ?? [],
        }, actorId)
        if (m.error) setServerErr(`Posted, but the badge did not attach: ${m.error.message}`)
      }
    }
    setSending(false)
    if (r.error) {
      // The database's own words — it is the authority.
      setServerErr(r.error.message)
      return
    }
    setDraft(EMPTY_DRAFT); setPicked([]); setTried(false)
    onSent?.()
  }

  const show = (f: Parameters<typeof problemFor>[0]) => tried ? problemFor(f, probs) : null
  const needsValue = (rules.requireValue || category?.requires_value) && values.length > 0
  // Dynamic numbering: a hidden step does not consume a number. Computed,
  // not `++n` in JSX as on the web — the React Compiler memoises JSX
  // segments, and a counter mutated during render numbers them wrongly.
  const nCat = 2
  const nValue = nCat + (cats.length > 0 ? 1 : 0)
  const nMarks = nValue + (needsValue ? 1 : 0)

  return (
    <View style={{ gap: 12 }}>
      <View>
        <Step n={1} title="Who are you recognising"
          hint={rules.allowGroup ? `Up to ${rules.maxReceivers} people at once` : 'One person at a time'}
          error={show('receivers')} done={picked.length > 0}>
          <PersonPicker picked={picked} onAdd={add} onRemove={remove} inputId="wof-shout-people" />
        </Step>

        {cats.length > 0 && (
          <Step n={nCat} title="What is it for" error={show('category')} done={!!category}>
            <CategoryGrid cats={cats} value={draft.categoryCode}
              onPick={code => setDraft(d => ({ ...d, categoryCode: code }))} />
          </Step>
        )}

        {needsValue && (
          <Step n={nValue} title="Which company value" hint="This category is tied to a company value"
            error={show('value')} done={draft.valueIds.length > 0}>
            <ValueChips values={values} picked={draft.valueIds}
              onToggle={id => setDraft(d => ({ ...d,
                valueIds: d.valueIds.includes(id) ? d.valueIds.filter(x => x !== id) : [...d.valueIds, id] }))} />
          </Step>
        )}

        {/* Optional on purpose: a badge on every thank-you would spend the badges. */}
        <Step n={nMarks} title="Badge and tags" hint={`Optional · one badge, up to ${MAX_TAGS} tags`}
          done={!!draft.badgeRef || (draft.tagRefs ?? []).length > 0}>
          <RecognitionPicker
            value={{ badgeRef: draft.badgeRef ?? null, tagRefs: draft.tagRefs ?? [] }}
            onChange={sel => setDraft(d => ({ ...d, badgeRef: sel.badgeRef, tagRefs: sel.tagRefs }))} />
        </Step>

        <Step n={nMarks + 1} title="What did they do" hint="Be specific. What happened, and why it mattered."
          error={show('message')} done={len >= rules.minMessageLength}>
          <MessageBox value={draft.message} onChange={v => setDraft(d => ({ ...d, message: v }))} />
          <View style={{ marginTop: 8 }}>
            <MessageMeter len={len} min={rules.minMessageLength} />
          </View>
        </Step>

        <Step n={nMarks + 2} title="Who can see it" done>
          <WSegmented label="Who can see it" options={VISIBILITIES} value={draft.visibility as Visibility}
            onPick={v => setDraft(d => ({ ...d, visibility: v }))} />
          <View style={{ marginTop: 8 }}>
            <VisLine visibility={draft.visibility} color={C.muted} />
          </View>
        </Step>
      </View>

      <Preview draft={live} people={picked} category={category} />

      <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: RAD.tile, padding: 14, gap: 12, backgroundColor: C.surface }}>
        <QuotaDots left={left} total={rules.dailyLimit} />
        <FieldError>{show('quota')}</FieldError>
        {serverErr && <WNotice tone="critical">{serverErr}</WNotice>}
        {/* Enabled while incomplete on purpose — pressing it is how somebody
            finds out WHAT is incomplete. */}
        <WButton variant="primary" size="lg" icon="send" full onPress={send}
          busy={sending} disabled={left === 0}>
          {sending ? 'Posting…' : 'Post shoutout'}
        </WButton>
        <Txt size={F.micro} tone="faint" center style={{ lineHeight: 16 }}>Recognition is thanks, never pay.</Txt>
      </View>
    </View>
  )
}
