'use client'
// components/wall/CommentThread.tsx — comments on a recognition.
//
// ONE LEVEL DEEP, AND THAT IS THE FEATURE.
//
// wall_config.comment_max_depth defaults to 1: a comment and its replies,
// never a tree. add_comment() refuses a deeper one, and this screen refuses
// to OFFER one — a reply box under a reply would be an invitation the
// database declines, which is a worse experience than not offering it.
//
// This is also the ONLY threaded surface in the module. The direct
// appreciation channel deliberately has no thread at all: one note, one
// thank-back, no rolling conversation. If these two ever look like
// duplicates, the difference is the point, not an oversight.
//
// Sub-components at module scope — see the note in ShoutoutComposer.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
// WHITE ON THE BRAND FILL IS A TRAP THIS CODEBASE ALREADY DOCUMENTED.
//
// tokens.ts says it plainly next to onAccent: the brand blue lightens in dark
// mode and white on it falls to 2.5:1. Measured here at 2.54 on the Send
// button. C.onAccent is the theme-aware ink for an accent fill and is what
// every one of these should have used from the start.
import { C, F, W, S, R } from '@/lib/ui'
import { threadComments, renderBody,
         type CommentRow, type Reaction, type Threaded } from '@/lib/wall/comments'

// ── module scope ─────────────────────────────────────────────────────────

function Mention({ name }: { name: string }) {
  return (
    <span style={{ padding: '1px 6px', borderRadius: 5, background: C.brandTint,
                   color: C.brand, fontWeight: W.semi }}>@{name}</span>
  )
}

function Body({ text, names }: { text: string; names: Map<string, string> }) {
  return (
    <p style={{ margin: 0, fontSize: F.small, color: C.inkSoft, lineHeight: 1.6 }}>
      {renderBody(text, names).map((piece, i) =>
        typeof piece === 'string'
          ? <span key={i}>{piece}</span>
          : <Mention key={i} name={piece.at} />)}
    </p>
  )
}

function Reacts({ emojis, onReact }: { emojis: Record<string, number>; onReact: (e: string) => void }) {
  const CHOICES = ['👏', '🙌', '❤️']
  return (
    <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
      {CHOICES.map(e => {
        const n = emojis[e] ?? 0
        return (
          <button key={e} type="button" onClick={() => onReact(e)}
            aria-label={`React with ${e}${n ? `, ${n} so far` : ''}`}
            style={{ cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex',
                     alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999,
                     fontSize: F.micro, lineHeight: 1.6,
                     border: `1px solid ${n ? C.brandEdge : C.line}`,
                     background: n ? C.brandTint : C.surface,
                     color: n ? C.brand : C.muted }}>
            <span aria-hidden>{e}</span>{n > 0 && <span>{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

function One({ c, names, reacts, onReact, onReply, canReply }: {
  c: CommentRow; names: Map<string, string>
  reacts: Record<string, number>
  onReact: (id: string, emoji: string) => void
  onReply?: () => void
  canReply: boolean
}) {
  const who = names.get(c.employee_id) ?? 'Someone'
  const when = c.created_at
    ? new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : ''
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>{who}</span>
        {when && <span style={{ fontSize: F.micro, color: C.faint }}>{when}</span>}
      </div>
      <Body text={c.body} names={names} />
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        <Reacts emojis={reacts} onReact={e => onReact(c.id, e)} />
        {canReply && onReply && (
          <button type="button" onClick={onReply}
            style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                     fontSize: F.micro, fontWeight: W.semi, color: C.brand, padding: '3px 0',
                     marginTop: 6 }}>
            Reply
          </button>
        )}
      </div>
    </div>
  )
}

// ── the thread ───────────────────────────────────────────────────────────

export default function CommentThread({
  recognitionId, names, repliesEnabled = true, onPosted,
}: {
  recognitionId: string
  /** employee id -> display name, supplied by the feed that already loaded them. */
  names: Map<string, string>
  repliesEnabled?: boolean
  onPosted?: () => void
}) {
  const [rows, setRows] = useState<CommentRow[]>([])
  const [reacts, setReacts] = useState<Record<string, Record<string, number>>>({})
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const c = await supabase.from('recognition_comments')
      .select('id, body, employee_id, parent_comment_id, mentions, created_at, is_hidden')
      .eq('recognition_id', recognitionId).order('created_at').limit(200)
    if (!c.error) setRows((c.data ?? []) as unknown as CommentRow[])

    const ids = ((c.data ?? []) as unknown as CommentRow[]).map(r => r.id)
    if (ids.length) {
      const r = await supabase.from('comment_reactions')
        .select('comment_id, emoji').in('comment_id', ids).limit(1000)
      if (!r.error) {
        const tally: Record<string, Record<string, number>> = {}
        for (const x of (r.data ?? []) as unknown as Reaction[]) {
          tally[x.comment_id] ??= {}
          tally[x.comment_id][x.emoji] = (tally[x.comment_id][x.emoji] ?? 0) + 1
        }
        setReacts(tally)
      }
    }
  }, [recognitionId])

  useEffect(() => { load() }, [load])

  async function post() {
    const body = draft.trim()
    if (!body) return
    setBusy(true); setErr(null)
    // Mentions are resolved from the names the caller already has, so a typo
    // becomes plain text rather than a broken chip pointing at nobody.
    const mentioned = [...names.entries()]
      .filter(([, n]) => body.includes('@' + n)).map(([id]) => id)
    const r = await supabase.rpc('add_comment', {
      p_recognition: recognitionId, p_body: body,
      p_parent: replyTo, p_mentions: mentioned,
    })
    setBusy(false)
    if (r.error) { setErr(r.error.message); return }
    setDraft(''); setReplyTo(null); load(); onPosted?.()
  }

  async function react(commentId: string, emoji: string) {
    // Optimistic: a reaction that waits for a round trip feels broken.
    setReacts(cur => ({ ...cur,
      [commentId]: { ...cur[commentId], [emoji]: (cur[commentId]?.[emoji] ?? 0) + 1 } }))
    const r = await supabase.from('comment_reactions')
      .insert({ comment_id: commentId, emoji })
    if (r.error) load()   // put it back the way the database sees it
  }

  const threads = threadComments(rows)

  return (
    <div style={{ display: 'grid', gap: S.md }}>
      {threads.map(t => (
        <div key={t.id} style={{ display: 'grid', gap: S.sm }}>
          <One c={t} names={names} reacts={reacts[t.id] ?? {}} onReact={react}
               canReply={repliesEnabled} onReply={() => setReplyTo(t.id)} />
          {t.replies.length > 0 && (
            // One level of indentation, and only one. The rail makes the
            // nesting readable without a second tier ever being possible.
            <div style={{ paddingLeft: S.md, borderLeft: `2px solid ${C.line}`,
                          display: 'grid', gap: S.sm }}>
              {t.replies.map(r => (
                <One key={r.id} c={r} names={names} reacts={reacts[r.id] ?? {}}
                     onReact={react} canReply={false} />
              ))}
            </div>
          )}
        </div>
      ))}

      {replyTo && (
        <div style={{ fontSize: F.micro, color: C.muted }}>
          Replying to {names.get(threads.find(t => t.id === replyTo)?.employee_id ?? '') ?? 'a comment'}
          {' · '}
          <button type="button" onClick={() => setReplyTo(null)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.brand,
                     fontFamily: 'inherit', fontSize: F.micro, fontWeight: W.semi, padding: 0 }}>
            cancel
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: S.sm, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input
          value={draft} onChange={e => setDraft(e.target.value)}
          placeholder={replyTo ? 'Write a reply…' : 'Add a comment. Use @ to mention someone.'}
          aria-label={replyTo ? 'Your reply' : 'Your comment'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post() } }}
          style={{ flex: '1 1 240px', minWidth: 0, padding: '9px 12px', borderRadius: R.sm,
                   fontFamily: 'inherit', fontSize: F.small, border: `1px solid ${C.line}`,
                   background: C.surface, color: C.ink, boxSizing: 'border-box' }}
        />
        <button type="button" onClick={post} disabled={busy || !draft.trim()}
          style={{ fontFamily: 'inherit', fontSize: F.small, fontWeight: W.bold,
                   padding: '9px 16px', borderRadius: R.sm, border: 'none',
                   cursor: busy || !draft.trim() ? 'not-allowed' : 'pointer',
                   background: draft.trim() ? C.brand : C.sunken,
                   color: draft.trim() ? C.onAccent : C.muted }}>
          {busy ? 'Posting…' : replyTo ? 'Reply' : 'Comment'}
        </button>
      </div>

      {err && (
        <div role="alert" style={{ fontSize: F.micro, color: C.critical, fontWeight: W.semi }}>
          {err}
        </div>
      )}
    </div>
  )
}
