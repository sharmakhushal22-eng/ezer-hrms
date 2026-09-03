'use client'
// components/wall/ShoutoutComposer.tsx — give a shoutout.
//
// Layout copied from design/EZER-WallOfFame-v7.html: person search, category
// grid, optional value tags, message with a counter, visibility segment, live
// preview. Not redesigned.
//
// EVERY SUB-COMPONENT IS AT MODULE SCOPE, AND THAT IS NOT A STYLE CHOICE.
// Declared inside the parent, React sees a new component type on every render
// and remounts it — which on this screen means the search box and the textarea
// lose focus on every keystroke. This codebase has had that bug once already.
//
// The rules live in lib/wall/shoutout.ts, mirrored from create_shoutout().
// They are mirrored so somebody is told about the fifteen-character minimum
// while typing rather than after pressing send. The database still decides.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  problems, problemFor, remainingToday, messageLength, visibilityNote,
  VISIBILITIES, DEFAULT_RULES, EMPTY_DRAFT,
  type Draft, type WallRules, type Problem,
} from '@/lib/wall/shoutout'
// WHITE ON THE BRAND FILL IS A TRAP THIS CODEBASE ALREADY DOCUMENTED.
//
// tokens.ts says it plainly next to onAccent: the brand blue lightens in dark
// mode and white on it falls to 2.5:1. Measured here at 2.54 on the Send
// button. C.onAccent is the theme-aware ink for an accent fill and is what
// every one of these should have used from the start.
import { C, F, W, S, R } from '@/lib/ui'

export interface Person { id: string; full_name: string; emp_code?: string | null; designation?: string | null }
export interface Category {
  id: string; code: string; label: string; helper_text?: string | null
  glyph?: string | null; requires_value?: boolean | null
}
export interface CompanyValue { id: string; label: string }

// ── module-scope pieces ──────────────────────────────────────────────────

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.1em',
                    textTransform: 'uppercase', color: C.muted }}>{children}</div>
      {hint && <div style={{ fontSize: F.micro, color: C.faint, marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

function Err({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <div role="alert" style={{ fontSize: F.micro, color: C.critical, marginTop: 6, fontWeight: W.semi }}>
      {children}
    </div>
  )
}

function PersonChip({ p, onRemove }: { p: Person; onRemove: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 10px',
                   borderRadius: 999, background: C.brandTint, color: C.brand,
                   fontSize: F.micro, fontWeight: W.semi }}>
      {p.full_name}
      <button type="button" onClick={onRemove} aria-label={`Remove ${p.full_name}`}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit',
                       fontSize: 15, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}>×</button>
    </span>
  )
}

function CategoryChip({ c, on, onPick }: { c: Category; on: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} aria-pressed={on}
      style={{
        textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '10px 12px',
        borderRadius: R.sm, minWidth: 0,
        border: `1px solid ${on ? C.brand : C.line}`,
        background: on ? C.brandTint : C.surface,
        boxShadow: on ? 'none' : '0 1px 2px rgba(16,36,100,.05)',
      }}>
      <div style={{ fontSize: F.small, fontWeight: W.bold, color: on ? C.brand : C.ink }}>
        {c.glyph ? `${c.glyph} ` : ''}{c.label}
      </div>
      {c.helper_text && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3, lineHeight: 1.4 }}>
          {c.helper_text}
        </div>
      )}
    </button>
  )
}

function Segment({ options, value, onPick }: {
  options: readonly string[]; value: string; onPick: (v: string) => void
}) {
  return (
    <div role="group" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, padding: 3,
                               background: C.sunken, borderRadius: R.sm }}>
      {options.map(o => {
        const on = o === value
        return (
          <button key={o} type="button" onClick={() => onPick(o)} aria-pressed={on}
            style={{ cursor: 'pointer', fontFamily: 'inherit', padding: '6px 12px',
                     borderRadius: R.sm, border: 'none', textTransform: 'capitalize',
                     fontSize: F.micro, fontWeight: on ? W.bold : W.semi,
                     background: on ? C.surface : 'transparent',
                     color: on ? C.ink : C.muted,
                     boxShadow: on ? '0 1px 2px rgba(16,36,100,.14)' : 'none' }}>
            {o}
          </button>
        )
      })}
    </div>
  )
}

/** What the card will look like once it lands on the feed. Shown while
 *  writing, because the note is public and people edit differently when they
 *  can see the thing they are actually making. */
function Preview({ draft, people, category }: {
  draft: Draft; people: Person[]; category: Category | null
}) {
  return (
    <div style={{ border: `1px dashed ${C.lineStrong}`, borderRadius: R.sm,
                  padding: `${S.md}px`, background: C.surface }}>
      <div style={{ fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.1em',
                    textTransform: 'uppercase', color: C.faint, marginBottom: 9 }}>
        How it will look
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>You</span>
        <span aria-hidden style={{ color: C.faint }}>→</span>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>
          {people.length ? people.map(p => p.full_name).join(', ') : 'nobody yet'}
        </span>
        {category && (
          <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '2px 8px', borderRadius: 999,
                         background: C.brandTint, color: C.brand }}>
            {category.glyph ? `${category.glyph} ` : ''}{category.label}
          </span>
        )}
      </div>
      <p style={{ margin: '9px 0 0', fontSize: F.small, color: draft.message ? C.inkSoft : C.faint,
                  lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {draft.message || 'Your message will appear here.'}
      </p>
      <div style={{ fontSize: F.micro, color: C.faint, marginTop: 9 }}>
        {visibilityNote(draft.visibility)}
      </div>
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
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Person[]>([])
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
      const c = await supabase.from('shoutout_categories')
        .select('id, code, label, helper_text, glyph, requires_value')
        .eq('is_active', true).order('sort_order').limit(24)
      if (!c.error) setCats((c.data ?? []) as unknown as Category[])
      // recognition_values, not company_values. I had guessed the name, and a
      // guessed relation fails the whole select rather than returning nothing.
      const v = await supabase.from('recognition_values').select('id, label')
        .eq('is_active', true).order('sort_order').limit(24)
      if (!v.error) setValues((v.data ?? []) as unknown as CompanyValue[])
    })()
  }, [])

  // Search by name or code. Anyone who has left is excluded — the database
  // refuses them anyway, and offering a name that cannot be submitted is a
  // dead end dressed up as a choice.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setFound([]); return }
    let alive = true
    const t = setTimeout(async () => {
      const r = await supabase.from('employees')
        .select('id, full_name, emp_code, designation')
        .is('date_of_leaving', null)
        .or(`full_name.ilike.%${q}%,emp_code.ilike.%${q}%`)
        .limit(8)
      if (alive && !r.error) setFound((r.data ?? []) as unknown as Person[])
    }, 220)
    return () => { alive = false; clearTimeout(t) }
  }, [query])

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
    setQuery(''); setFound([])
  }, [])

  const remove = useCallback((id: string) => {
    setPicked(cur => cur.filter(p => p.id !== id))
    setDraft(d => ({ ...d, receiverIds: d.receiverIds.filter(r => r !== id) }))
  }, [])

  async function send() {
    setTried(true); setServerErr(null)
    if (probs.length) return
    setSending(true)
    const r = await supabase.rpc('create_shoutout', {
      p_receivers: draft.receiverIds,
      p_category: draft.categoryCode,
      p_message: draft.message.trim(),
      p_value_ids: draft.valueIds,
      p_visibility: draft.visibility,
    })
    setSending(false)
    if (r.error) {
      // The database's own words. It is the authority, and rephrasing its
      // refusal here would give two different explanations for one rule.
      setServerErr(r.error.message)
      return
    }
    setDraft(EMPTY_DRAFT); setPicked([]); setTried(false)
    onSent?.()
  }

  const show = (f: Parameters<typeof problemFor>[0]) => tried ? problemFor(f, probs) : null

  return (
    <div style={{ display: 'grid', gap: S.lg, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div style={{ display: 'grid', gap: S.md }}>
        {/* who */}
        <div>
          <Label hint={rules.allowGroup ? `Up to ${rules.maxReceivers} people at once` : 'One person at a time'}>
            Who are you recognising
          </Label>
          {picked.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {picked.map(p => <PersonChip key={p.id} p={p} onRemove={() => remove(p.id)} />)}
            </div>
          )}
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or employee code"
            aria-label="Search for a colleague"
            style={{ width: '100%', padding: '10px 12px', borderRadius: R.sm, fontFamily: 'inherit',
                     fontSize: F.small, border: `1px solid ${C.line}`, background: C.surface,
                     color: C.ink, boxSizing: 'border-box' }}
          />
          {found.length > 0 && (
            <div style={{ marginTop: 6, border: `1px solid ${C.line}`, borderRadius: R.sm,
                          background: C.surface, overflow: 'hidden' }}>
              {found.map(p => (
                <button key={p.id} type="button" onClick={() => add(p)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                           padding: '9px 12px', border: 'none', background: 'none',
                           fontFamily: 'inherit', borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{p.full_name}</span>
                  <span style={{ fontSize: F.micro, color: C.muted, marginLeft: 8 }}>
                    {[p.emp_code, p.designation].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          )}
          <Err>{show('receivers')}</Err>
        </div>

        {/* what for */}
        {cats.length > 0 && (
          <div>
            <Label>What is it for</Label>
            <div style={{ display: 'grid', gap: 8,
                          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
              {cats.map(c => (
                <CategoryChip key={c.id} c={c} on={draft.categoryCode === c.code}
                  onPick={() => setDraft(d => ({ ...d, categoryCode: c.code }))} />
              ))}
            </div>
            <Err>{show('category')}</Err>
          </div>
        )}

        {/* values — only when one is actually wanted */}
        {(rules.requireValue || category?.requires_value) && values.length > 0 && (
          <div>
            <Label hint="This category is tied to a company value">Which value</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {values.map(v => {
                const on = draft.valueIds.includes(v.id)
                return (
                  <button key={v.id} type="button" aria-pressed={on}
                    onClick={() => setDraft(d => ({ ...d,
                      valueIds: on ? d.valueIds.filter(x => x !== v.id) : [...d.valueIds, v.id] }))}
                    style={{ cursor: 'pointer', fontFamily: 'inherit', padding: '6px 12px',
                             borderRadius: 999, fontSize: F.micro, fontWeight: W.semi,
                             border: `1px solid ${on ? C.brand : C.line}`,
                             background: on ? C.brandTint : C.surface,
                             color: on ? C.brand : C.inkSoft }}>
                    {v.label}
                  </button>
                )
              })}
            </div>
            <Err>{show('value')}</Err>
          </div>
        )}

        {/* the words */}
        <div>
          <Label>What did they do</Label>
          <textarea
            value={draft.message} onChange={e => setDraft(d => ({ ...d, message: e.target.value }))}
            rows={4} placeholder="Be specific. What happened, and why it mattered."
            aria-label="Your message"
            style={{ width: '100%', padding: '10px 12px', borderRadius: R.sm, fontFamily: 'inherit',
                     fontSize: F.small, lineHeight: 1.6, border: `1px solid ${C.line}`,
                     background: C.surface, color: C.ink, resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 5 }}>
            <span style={{ fontSize: F.micro, color: C.faint }}>
              {/* Counts up to the minimum, then stops nagging. A counter that
                  keeps score forever reads as a limit when it is a floor. */}
              {len < rules.minMessageLength
                ? `${len} of ${rules.minMessageLength} characters`
                : 'Long enough'}
            </span>
            <span style={{ fontSize: F.micro, color: left > 0 ? C.faint : C.critical }}>
              {left > 0 ? `${left} left today` : 'None left today'}
            </span>
          </div>
          <Err>{show('message')}</Err>
        </div>

        {/* how far it travels */}
        <div>
          <Label>Who can see it</Label>
          <Segment options={VISIBILITIES} value={draft.visibility}
                   onPick={v => setDraft(d => ({ ...d, visibility: v }))} />
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 6 }}>
            {visibilityNote(draft.visibility)}
          </div>
        </div>

        <Preview draft={live} people={picked} category={category} />

        <Err>{show('quota')}</Err>
        {serverErr && (
          <div role="alert" style={{ background: C.criticalTint, border: `1px solid ${C.critical}44`,
                        borderRadius: R.sm, padding: `${S.sm}px ${S.md}px`, fontSize: F.small,
                        color: C.ink }}>
            {serverErr}
          </div>
        )}

        <div>
          <button type="button" onClick={send} disabled={sending || left === 0}
            style={{ fontFamily: 'inherit', fontSize: F.small, fontWeight: W.bold,
                     padding: '11px 20px', borderRadius: R.sm, border: 'none',
                     cursor: sending || left === 0 ? 'not-allowed' : 'pointer',
                     background: left === 0 ? C.sunken : C.brand,
                     color: left === 0 ? C.muted : C.onAccent,
                     opacity: sending ? .7 : 1 }}>
            {sending ? 'Sending…' : 'Send it'}
          </button>
          {/* The button stays enabled while the form is incomplete on purpose:
              pressing it is how somebody finds out WHAT is incomplete. A
              disabled button with no explanation is the worst of both. */}
        </div>
      </div>
    </div>
  )
}
