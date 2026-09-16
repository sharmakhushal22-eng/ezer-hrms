'use client'
// components/wall/ShoutoutComposer.tsx — give a shoutout.
//
// v8 REDESIGN. The form is now a numbered, five-step column — Who, What for,
// (Which value), Badge and tags, Message, Who sees it — with the live preview
// and the send button in a rail beside it that stays in view while you write.
// On a narrow screen the rail drops beneath the steps.
//
// NOTHING ABOUT WHAT IT DOES HAS CHANGED:
//   - same reads: employees.company_id → shoutout_categories and
//     recognition_values, both filtered by that company
//   - same writes: create_shoutout, then set_recognition_marks for the
//     badge and tags, through wallRpc
//   - same rules from lib/wall/shoutout.ts, shown only after the first try
//   - the send button stays enabled while the form is incomplete, because
//     pressing it is how somebody finds out what is missing
//
// Sub-components at module scope. The person search moved to PersonPicker.tsx.

import { useEffect, useMemo, useState, useCallback } from 'react'
import RecognitionPicker from '@/components/wall/RecognitionPicker'
import PersonPicker, { type Person } from '@/components/wall/PersonPicker'
import { MAX_TAGS, badgeByRef, tagByRef } from '@/lib/wall/catalogue'
import { supabase } from '@/lib/supabase'
import { wallRpc } from '@/lib/wall/rpc'
import {
  problems, problemFor, remainingToday, messageLength, visibilityNote,
  VISIBILITIES, DEFAULT_RULES, EMPTY_DRAFT,
  type Draft, type WallRules, type Problem,
} from '@/lib/wall/shoutout'
import { C, F, W, S } from '@/lib/ui'
import {
  Avatar, AvatarStack, Button, CategoryGrid, FieldError, Icon, Notice, Pill, RAD,
  Segmented, Split, Step, inputStyle,
} from '@/components/wall/ui'

export type { Person }
export interface Category {
  id: string; code: string; label: string; helper_text?: string | null
  glyph?: string | null; requires_value?: boolean | null
}
export interface CompanyValue { id: string; label: string }

const VIS_ICON = { company: 'globe', branch: 'users', department: 'users', team: 'users' } as const

// ── module-scope pieces ──────────────────────────────────────────────────

function ValueChips({ values, picked, onToggle }: {
  values: CompanyValue[]; picked: string[]; onToggle: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {values.map(v => {
        const on = picked.includes(v.id)
        return (
          <button key={v.id} type="button" aria-pressed={on} onClick={() => onToggle(v.id)}
            className="wof-tile"
            style={{ cursor: 'pointer', fontFamily: 'inherit', padding: '6px 13px',
                     borderRadius: RAD.pill, fontSize: F.micro, fontWeight: W.semi,
                     display: 'inline-flex', alignItems: 'center', gap: 6,
                     border: `1.5px solid ${on ? C.brand : C.line}`,
                     background: on ? C.brandTint : C.surface,
                     color: on ? C.brand : C.inkSoft }}>
            {on && <Icon name="check" size={12} stroke={2.6} />}
            {v.label}
          </button>
        )
      })}
    </div>
  )
}

function MessageMeter({ len, min }: { len: number; min: number }) {
  const pct = Math.min(100, Math.round((len / Math.max(1, min)) * 100))
  const done = len >= min
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span aria-hidden="true" style={{ width: 54, height: 4, borderRadius: 4, background: C.sunken,
                                        overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`,
                       background: done ? C.positive : C.brand, transition: 'width .2s' }} />
      </span>
      {/* Counts up to the minimum, then stops nagging. A counter that keeps
          score forever reads as a limit when it is a floor. */}
      <span style={{ fontSize: F.micro, color: done ? C.positive : C.faint, fontWeight: W.semi }}>
        {done ? 'Long enough' : `${len} of ${min} characters`}
      </span>
    </div>
  )
}

/** What the card will look like on the feed — the same anatomy as FeedCard,
 *  so what you see here is what lands. */
function Preview({ draft, people, category }: {
  draft: Draft; people: Person[]; category: Category | null
}) {
  const badge = draft.badgeRef ? badgeByRef(draft.badgeRef) : null
  const tags = (draft.tagRefs ?? []).map(r => tagByRef(r)?.name).filter(Boolean)
  const names = people.map(p => p.full_name)
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: RAD.tile, background: C.surface,
                  overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                    background: C.sunken, borderBottom: `1px solid ${C.line}`,
                    fontSize: F.micro, fontWeight: W.semi, color: C.muted }}>
        <Icon name="eye" size={14} /> How it will look on the wall
      </div>
      <div style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name="You" size={34} />
          <div style={{ minWidth: 0, flex: 1, fontSize: F.small, color: C.ink, lineHeight: 1.4 }}>
            <strong>You</strong>
            <span style={{ color: C.muted }}> recognised </span>
            <strong style={{ color: names.length ? C.ink : C.faint }}>
              {names.length ? names.join(', ') : 'nobody yet'}
            </strong>
          </div>
          {names.length > 1 && <AvatarStack names={names} size={24} />}
        </div>
        {(category || badge) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {category && <Pill>{category.glyph ? `${category.glyph} ` : ''}{category.label}</Pill>}
            {badge && <Pill tone="neutral">{badge.glyph} {badge.name}</Pill>}
          </div>
        )}
        <p style={{ margin: 0, fontSize: F.small, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                    color: draft.message ? C.inkSoft : C.faint,
                    borderLeft: `3px solid ${C.brandEdge}`, paddingLeft: 12 }}>
          {draft.message || 'Your message will appear here.'}
        </p>
        {tags.length > 0 && (
          <div style={{ fontSize: F.micro, color: C.muted }}>{tags.join(' · ')}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: F.micro, color: C.faint }}>
          <Icon name={VIS_ICON[draft.visibility as keyof typeof VIS_ICON] ?? 'globe'} size={13} />
          {visibilityNote(draft.visibility)}
        </div>
      </div>
    </div>
  )
}

function QuotaDots({ left, total }: { left: number; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ fontSize: F.micro, color: left > 0 ? C.muted : C.critical, fontWeight: W.semi }}>
        {left > 0 ? `${left} left today` : 'None left today'}
      </span>
      <span aria-hidden="true" style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} style={{ width: 8, height: 8, borderRadius: '50%',
                                 background: i < left ? C.brand : C.line }} />
        ))}
      </span>
    </div>
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
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [picked, setPicked] = useState<Person[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [values, setValues] = useState<CompanyValue[]>([])
  const [sending, setSending] = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)
  // Only show what is wrong once somebody has tried, or every field shouts
  // at them before they have typed a character.
  const [tried, setTried] = useState(false)

  useEffect(() => {
    (async () => {
      // The company first: BOTH lists below are per-company, and reading
      // either without it returns every company's copy.
      const me = await supabase.from('employees')
        .select('company_id').eq('id', actorId).maybeSingle()
      const companyId = (me.data as { company_id?: string } | null)?.company_id ?? null

      let cq = supabase.from('shoutout_categories')
        .select('id, code, label, helper_text, glyph, requires_value')
        .eq('is_active', true).order('sort_order').limit(24)
      cq = companyId ? cq.eq('company_id', companyId) : cq.limit(0)
      const c = await cq
      if (!c.error) setCats((c.data ?? []) as unknown as Category[])

      // recognition_values, filtered by company — one row per value PER
      // company, so an unfiltered read shows every value three times.
      let vq = supabase.from('recognition_values').select('id, label')
        .eq('is_active', true).order('sort_order').limit(24)
      vq = companyId ? vq.eq('company_id', companyId) : vq.limit(0)
      const v = await vq
      if (!v.error) setValues((v.data ?? []) as unknown as CompanyValue[])
    })()
  }, [actorId])

  const category = useMemo(
    () => cats.find(c => c.code === draft.categoryCode) ?? null, [cats, draft.categoryCode])

  const live: Draft = { ...draft, categoryRequiresValue: Boolean(category?.requires_value) }
  const ctx = { actorId, sentToday, recentlyRecognised,
                nameOf: (id: string) => picked.find(p => p.id === id)?.full_name ?? 'that person' }
  const probs: Problem[] = problems(live, ctx, rules)
  const left = remainingToday(ctx, rules)
  const len = messageLength(draft.message)

  const add = useCallback((p: Person) => {
    setPicked(cur => cur.some(x => x.id === p.id) ? cur : [...cur, p])
    setDraft(d => d.receiverIds.includes(p.id) ? d : { ...d, receiverIds: [...d.receiverIds, p.id] })
  }, [])

  const remove = useCallback((id: string) => {
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
    // The badge and tags go on afterwards, through their own function.
    // A failure here loses the marks, not the shoutout, so it is reported
    // without discarding the post.
    if (!r.error && (draft.badgeRef || (draft.tagRefs ?? []).length)) {
      const id = (r.data as { id?: string } | null)?.id
      if (id) {
        const m = await wallRpc('set_recognition_marks', {
          p_recognition: id,
          p_badge_ref: draft.badgeRef ?? null,
          p_tag_refs: draft.tagRefs ?? [],
        }, actorId)
        if (m.error) setServerErr(`Posted, but the badge did not attach — ${m.error.message}`)
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
  let n = 0

  const steps = (
    <div>
      <Step n={++n} title="Who are you recognising"
        hint={rules.allowGroup ? `Up to ${rules.maxReceivers} people at once` : 'One person at a time'}
        error={show('receivers')} done={picked.length > 0}>
        <PersonPicker picked={picked} onAdd={add} onRemove={remove} inputId="wof-shout-people" />
      </Step>

      {cats.length > 0 && (
        <Step n={++n} title="What is it for" error={show('category')} done={!!category}>
          <CategoryGrid cats={cats} value={draft.categoryCode}
            onPick={code => setDraft(d => ({ ...d, categoryCode: code }))} />
        </Step>
      )}

      {needsValue && (
        <Step n={++n} title="Which company value" hint="This category is tied to a company value"
          error={show('value')} done={draft.valueIds.length > 0}>
          <ValueChips values={values} picked={draft.valueIds}
            onToggle={id => setDraft(d => ({ ...d,
              valueIds: d.valueIds.includes(id) ? d.valueIds.filter(x => x !== id) : [...d.valueIds, id] }))} />
        </Step>
      )}

      {/* Optional on purpose: forcing a badge onto every thank-you would
          spend the badges on "thanks for covering my shift". */}
      <Step n={++n} title="Badge and tags" hint={`Optional · one badge, up to ${MAX_TAGS} tags`}
        done={!!draft.badgeRef || (draft.tagRefs ?? []).length > 0}>
        <RecognitionPicker
          value={{ badgeRef: draft.badgeRef ?? null, tagRefs: draft.tagRefs ?? [] }}
          onChange={sel => setDraft(d => ({ ...d, badgeRef: sel.badgeRef, tagRefs: sel.tagRefs }))} />
      </Step>

      <Step n={++n} title="What did they do" hint="Be specific. What happened, and why it mattered."
        error={show('message')} done={len >= rules.minMessageLength}>
        <textarea
          id="wof-shout-message"
          value={draft.message} onChange={e => setDraft(d => ({ ...d, message: e.target.value }))}
          rows={5} placeholder="e.g. Stayed back on Friday to rebuild the dispatch sheet, so the morning shift started on time."
          aria-label="Your message"
          style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.65, minHeight: 120 }}
        />
        <div style={{ marginTop: 8 }}>
          <MessageMeter len={len} min={rules.minMessageLength} />
        </div>
      </Step>

      <Step n={++n} title="Who can see it" done>
        <Segmented label="Who can see it" options={VISIBILITIES} value={draft.visibility as typeof VISIBILITIES[number]}
          onPick={v => setDraft(d => ({ ...d, visibility: v }))} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: F.micro,
                      color: C.muted, marginTop: 8 }}>
          <Icon name={VIS_ICON[draft.visibility as keyof typeof VIS_ICON] ?? 'globe'} size={13} />
          {visibilityNote(draft.visibility)}
        </div>
      </Step>
    </div>
  )

  const rail = (
    <div style={{ display: 'grid', gap: S.md }}>
      <Preview draft={live} people={picked} category={category} />

      <div style={{ border: `1px solid ${C.line}`, borderRadius: RAD.tile, padding: 14,
                    display: 'grid', gap: 12, background: C.surface }}>
        <QuotaDots left={left} total={rules.dailyLimit} />
        <FieldError>{show('quota')}</FieldError>
        {serverErr && <Notice tone="critical" role="alert">{serverErr}</Notice>}
        {/* Enabled while incomplete on purpose — pressing it is how somebody
            finds out WHAT is incomplete. */}
        <Button variant="primary" size="lg" icon="send" full onClick={send}
          busy={sending} disabled={left === 0}>
          {sending ? 'Posting…' : 'Post shoutout'}
        </Button>
        <div style={{ fontSize: F.micro, color: C.faint, lineHeight: 1.5, textAlign: 'center' }}>
          Recognition is thanks, never pay.
        </div>
      </div>
    </div>
  )

  return <Split main={steps} rail={rail} mainMin={440} railMin={280} stickyRail />
}
