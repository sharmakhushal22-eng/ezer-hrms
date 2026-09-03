'use client'
// components/wall/AppreciationComposer.tsx — send a private thank-you.
//
// The shoutout composer with a SEND MODE where the visibility segment goes.
// Same layout otherwise, per the mockup — person search, category grid,
// message, live preview.
//
// THE LIMITS ARE ON THE SCREEN, NOT JUST IN THE DATABASE.
//
// A note is not a chat: the recipient may reply once to say thanks and that
// ends it. That is said before the message box, not discovered afterwards
// when the reply box is missing. Free-form messaging inside an HRMS becomes
// a harassment vector and a records-retention problem, and HR owns both — so
// the constraint is deliberate, and hiding it would make the product feel
// broken rather than considered.
//
// Sub-components at module scope. See the note in ShoutoutComposer.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  directProblems, directProblemFor, notesLeftToday, modeNote, REPLY_RULE,
  DEFAULT_DIRECT, EMPTY_DIRECT,
  type DirectDraft, type DirectRules, type SendMode, type DirectProblem,
} from '@/lib/wall/appreciation'
// WHITE ON THE BRAND FILL IS A TRAP THIS CODEBASE ALREADY DOCUMENTED.
//
// tokens.ts says it plainly next to onAccent: the brand blue lightens in dark
// mode and white on it falls to 2.5:1. Measured here at 2.54 on the Send
// button. C.onAccent is the theme-aware ink for an accent fill and is what
// every one of these should have used from the start.
import { C, F, W, S, R } from '@/lib/ui'

export interface Person { id: string; full_name: string; emp_code?: string | null; designation?: string | null }
export interface Category { id: string; code: string; label: string; glyph?: string | null; helper_text?: string | null }

// ── module scope ─────────────────────────────────────────────────────────

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
  return <div role="alert" style={{ fontSize: F.micro, color: C.critical, marginTop: 6,
                                    fontWeight: W.semi }}>{children}</div>
}

function Chip({ p, onRemove }: { p: Person; onRemove: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                   padding: '4px 6px 4px 10px', borderRadius: 999,
                   background: C.brandTint, color: C.brand, fontSize: F.micro, fontWeight: W.semi }}>
      {p.full_name}
      <button type="button" onClick={onRemove} aria-label={`Remove ${p.full_name}`}
        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit',
                 fontSize: 15, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit' }}>×</button>
    </span>
  )
}

function CatChip({ c, on, onPick }: { c: Category; on: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} aria-pressed={on}
      style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '10px 12px',
               borderRadius: R.sm, minWidth: 0,
               border: `1px solid ${on ? C.brand : C.line}`,
               background: on ? C.brandTint : C.surface }}>
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

/** Where it goes. Two options, never a scope picker — the note always goes
 *  to the person, and the only question is whether anyone else sees it. */
function ModeChoice({ mode, onPick, allowShare }: {
  mode: SendMode; onPick: (m: SendMode) => void; allowShare: boolean
}) {
  const OPTIONS: { k: SendMode; label: string }[] = [
    { k: 'private', label: 'Just to them' },
    { k: 'also_post', label: 'Also post it to the feed' },
  ]
  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {OPTIONS.map(o => {
        const on = o.k === mode
        const off = o.k === 'also_post' && !allowShare
        return (
          <button key={o.k} type="button" onClick={() => !off && onPick(o.k)}
            aria-pressed={on} disabled={off}
            style={{ textAlign: 'left', fontFamily: 'inherit', padding: '10px 12px',
                     borderRadius: R.sm, cursor: off ? 'not-allowed' : 'pointer',
                     border: `1px solid ${on ? C.brand : C.line}`,
                     background: on ? C.brandTint : C.surface, opacity: off ? .55 : 1 }}>
            <div style={{ fontSize: F.small, fontWeight: W.bold, color: on ? C.brand : C.ink }}>
              {o.label}
            </div>
            <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3, lineHeight: 1.45 }}>
              {modeNote(o.k, allowShare)}
            </div>
          </button>
        )
      })}
    </div>
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
  const [draft, setDraft] = useState<DirectDraft>(EMPTY_DIRECT)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Person[]>([])
  const [picked, setPicked] = useState<Person[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [busy, setBusy] = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    (async () => {
      const c = await supabase.from('shoutout_categories')
        .select('id, code, label, glyph, helper_text')
        .eq('is_active', true).order('sort_order').limit(24)
      if (!c.error) setCats((c.data ?? []) as unknown as Category[])
    })()
  }, [])

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

  // nameOf must return a string, not string|undefined — a caller asking
  // for a name deserves a fallback, not a hole in a sentence.
  const ctx = { actorId, sentToday,
                nameOf: (id: string) => picked.find(p => p.id === id)?.full_name ?? 'that person' }
  const probs: DirectProblem[] = directProblems(draft, ctx, rules)
  const left = notesLeftToday(ctx, rules)
  const show = (f: Parameters<typeof directProblemFor>[0]) => tried ? directProblemFor(f, probs) : null

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
    setTried(true); setServerErr(null); setSent(null)
    if (probs.length) return
    setBusy(true)
    const r = await supabase.rpc('send_appreciation', {
      p_receivers: draft.receiverIds,
      p_category: draft.categoryCode,
      p_body: draft.body.trim(),
      p_also_post: draft.mode === 'also_post',
      p_visibility: draft.visibility,
    })
    setBusy(false)
    if (r.error) { setServerErr(r.error.message); return }
    setDraft(EMPTY_DIRECT); setPicked([]); setTried(false)
    setSent('Sent. They will see it in their inbox.')
    onSent?.()
  }

  if (!rules.enabled) {
    return (
      <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.6 }}>
        Direct appreciation is switched off for this company. You can still give a shoutout
        on the wall.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: S.md }}>
      {/* Stated first, because it changes how somebody writes. */}
      <div style={{ background: C.brandTint, border: `1px solid ${C.brandEdge}`,
                    borderRadius: R.sm, padding: `${S.sm}px ${S.md}px`,
                    fontSize: F.micro, color: C.inkSoft, lineHeight: 1.55 }}>
        {REPLY_RULE}
      </div>

      <div>
        <Label hint={`Up to ${rules.maxReceivers} people`}>Who are you thanking</Label>
        {picked.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {picked.map(p => <Chip key={p.id} p={p} onRemove={() => remove(p.id)} />)}
          </div>
        )}
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search by name or employee code" aria-label="Search for a colleague"
          style={{ width: '100%', padding: '10px 12px', borderRadius: R.sm, fontFamily: 'inherit',
                   fontSize: F.small, border: `1px solid ${C.line}`, background: C.surface,
                   color: C.ink, boxSizing: 'border-box' }} />
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

      {cats.length > 0 && (
        <div>
          <Label>What for</Label>
          <div style={{ display: 'grid', gap: 8,
                        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            {cats.map(c => (
              <CatChip key={c.id} c={c} on={draft.categoryCode === c.code}
                onPick={() => setDraft(d => ({ ...d, categoryCode: c.code }))} />
            ))}
          </div>
          <Err>{show('category')}</Err>
        </div>
      )}

      <div>
        <Label hint="However short you like">Your note</Label>
        <textarea value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
          rows={3} placeholder="Thank you for…" aria-label="Your note"
          style={{ width: '100%', padding: '10px 12px', borderRadius: R.sm, fontFamily: 'inherit',
                   fontSize: F.small, lineHeight: 1.6, border: `1px solid ${C.line}`,
                   background: C.surface, color: C.ink, resize: 'vertical', boxSizing: 'border-box' }} />
        <div style={{ fontSize: F.micro, color: left > 0 ? C.faint : C.critical, marginTop: 5,
                      textAlign: 'right' }}>
          {left > 0 ? `${left} note${left === 1 ? '' : 's'} left today` : 'None left today'}
        </div>
        <Err>{show('body')}</Err>
      </div>

      <div>
        <Label>Where it goes</Label>
        <ModeChoice mode={draft.mode} allowShare={rules.allowShareToFeed}
          onPick={m => setDraft(d => ({ ...d, mode: m }))} />
        <Err>{show('mode')}</Err>
      </div>

      <Err>{show('quota')}</Err>
      {serverErr && (
        <div role="alert" style={{ background: C.criticalTint, border: `1px solid ${C.critical}44`,
                      borderRadius: R.sm, padding: `${S.sm}px ${S.md}px`, fontSize: F.small,
                      color: C.ink }}>{serverErr}</div>
      )}
      {sent && (
        <div role="status" style={{ background: C.positiveTint, border: `1px solid ${C.positive}33`,
                      borderRadius: R.sm, padding: `${S.sm}px ${S.md}px`, fontSize: F.small,
                      color: C.ink }}>{sent}</div>
      )}

      <div>
        <button type="button" onClick={send} disabled={busy || left === 0}
          style={{ fontFamily: 'inherit', fontSize: F.small, fontWeight: W.bold,
                   padding: '11px 20px', borderRadius: R.sm, border: 'none',
                   cursor: busy || left === 0 ? 'not-allowed' : 'pointer',
                   background: left === 0 ? C.sunken : C.brand,
                   color: left === 0 ? C.muted : C.onAccent, opacity: busy ? .7 : 1 }}>
          {busy ? 'Sending…' : 'Send it'}
        </button>
      </div>
    </div>
  )
}
