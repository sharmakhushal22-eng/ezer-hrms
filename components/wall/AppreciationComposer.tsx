'use client'
// components/wall/AppreciationComposer.tsx — send a private thank-you.
//
// v8 REDESIGN. Laid out like a letter rather than a form: the reply rule is
// stated first, then To, What for, the note itself on a paper-like surface,
// and Where it goes as two cards. Same numbered steps as the shoutout so the
// two composers feel like one family.
//
// NOTHING ABOUT WHAT IT DOES HAS CHANGED:
//   - same reads: employees.company_id → shoutout_categories (per company)
//   - same write: send_appreciation through wallRpc
//   - same rules from lib/wall/appreciation.ts, shown after the first try
//   - still NOT a chat: the recipient may reply once, and that is said
//     before the message box rather than discovered afterwards
//
// Sub-components at module scope. Person search lives in PersonPicker.tsx.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { wallRpc } from '@/lib/wall/rpc'
import PersonPicker, { type Person } from '@/components/wall/PersonPicker'
import {
  directProblems, directProblemFor, notesLeftToday, modeNote, REPLY_RULE,
  DEFAULT_DIRECT, EMPTY_DIRECT,
  type DirectDraft, type DirectRules, type SendMode, type DirectProblem,
} from '@/lib/wall/appreciation'
import { C, F, W, S } from '@/lib/ui'
import {
  Button, CategoryGrid, ChoiceTile, Empty, FieldError, Icon, Notice, RAD, Step,
} from '@/components/wall/ui'

export type { Person }
export interface Category { id: string; code: string; label: string; glyph?: string | null; helper_text?: string | null }

// ── module scope ─────────────────────────────────────────────────────────

/** Where it goes. Two options, never a scope picker — the note always goes
 *  to the person, and the only question is whether anyone else sees it. */
function ModeChoice({ mode, onPick, allowShare }: {
  mode: SendMode; onPick: (m: SendMode) => void; allowShare: boolean
}) {
  const OPTIONS: { k: SendMode; label: string; glyph: string }[] = [
    { k: 'private', label: 'Just to them', glyph: '✉️' },
    { k: 'also_post', label: 'Also post it to the feed', glyph: '📣' },
  ]
  return (
    <div style={{ display: 'grid', gap: 8,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
      {OPTIONS.map(o => (
        <ChoiceTile key={o.k} on={o.k === mode} onPick={() => onPick(o.k)}
          disabled={o.k === 'also_post' && !allowShare}
          glyph={o.glyph} title={o.label} text={modeNote(o.k, allowShare)} />
      ))}
    </div>
  )
}

function Letter({ value, onChange, left }: { value: string; onChange: (v: string) => void; left: number }) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: RAD.tile, background: C.surface,
                  overflow: 'hidden', boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
      <textarea id="wof-note-body" value={value} onChange={e => onChange(e.target.value)}
        rows={4} placeholder="Thank you for…" aria-label="Your note"
        style={{ width: '100%', boxSizing: 'border-box', border: 'none', resize: 'vertical',
                 padding: '14px 16px', fontFamily: 'inherit', fontSize: F.body, lineHeight: 1.75,
                 color: C.ink, minHeight: 116,
                 // ruled paper, drawn with the line token so it themes
                 background: `repeating-linear-gradient(${C.surface}, ${C.surface} 27px, ${C.sunken} 28px)`,
                 backgroundPosition: '0 13px', backgroundAttachment: 'local' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                    padding: '8px 14px', borderTop: `1px solid ${C.line}`, background: C.sunken }}>
        <span style={{ fontSize: F.micro, color: C.faint }}>However short you like</span>
        <span style={{ fontSize: F.micro, fontWeight: W.semi, color: left > 0 ? C.muted : C.critical }}>
          {left > 0 ? `${left} note${left === 1 ? '' : 's'} left today` : 'None left today'}
        </span>
      </div>
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
  const [picked, setPicked] = useState<Person[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [busy, setBusy] = useState(false)
  const [serverErr, setServerErr] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  useEffect(() => {
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

  const add = useCallback((p: Person) => {
    setPicked(cur => cur.some(x => x.id === p.id) ? cur : [...cur, p])
    setDraft(d => d.receiverIds.includes(p.id) ? d : { ...d, receiverIds: [...d.receiverIds, p.id] })
  }, [])

  const remove = useCallback((id: string) => {
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
      <Empty icon="mail" title="Private notes are switched off">
        Direct appreciation is switched off for this company. You can still give a shoutout
        on the wall.
      </Empty>
    )
  }

  let n = 0
  return (
    <div style={{ display: 'grid', gap: S.md, maxWidth: 760 }}>
      {/* Stated first, because it changes how somebody writes. */}
      <Notice tone="info" title="A note, not a chat">{REPLY_RULE}</Notice>

      <div>
        <Step n={++n} title="Who are you thanking" hint={`Up to ${rules.maxReceivers} people`}
          error={show('receivers')} done={picked.length > 0}>
          <PersonPicker picked={picked} onAdd={add} onRemove={remove} inputId="wof-note-people" />
        </Step>

        {cats.length > 0 && (
          <Step n={++n} title="What for" error={show('category')} done={!!draft.categoryCode}>
            <CategoryGrid cats={cats} value={draft.categoryCode}
              onPick={code => setDraft(d => ({ ...d, categoryCode: code }))} />
          </Step>
        )}

        <Step n={++n} title="Your note" error={show('body')} done={draft.body.trim().length > 0}>
          <Letter value={draft.body} left={left}
            onChange={v => setDraft(d => ({ ...d, body: v }))} />
        </Step>

        <Step n={++n} title="Where it goes" error={show('mode')} done>
          <ModeChoice mode={draft.mode} allowShare={rules.allowShareToFeed}
            onPick={m => setDraft(d => ({ ...d, mode: m }))} />
        </Step>
      </div>

      <FieldError>{show('quota')}</FieldError>
      {serverErr && <Notice tone="critical" role="alert">{serverErr}</Notice>}
      {sent && <Notice tone="positive" role="status">{sent}</Notice>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    paddingLeft: 40 }}>
        <Button variant="primary" size="lg" icon="send" onClick={send}
          busy={busy} disabled={left === 0}>
          {busy ? 'Sending…' : 'Send note'}
        </Button>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.micro, color: C.faint }}>
          <Icon name="lock" size={13} />
          {draft.mode === 'private' ? 'Only they will see it' : 'They get it, and it goes on the feed'}
        </span>
      </div>
    </div>
  )
}
