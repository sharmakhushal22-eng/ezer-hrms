'use client'
// components/wall/CommentThread.tsx — comments on a recognition.
//
// v8: RESTYLED ONLY, AND STILL NOT MOUNTED ANYWHERE — exactly as in v7.
// Mounting it under FeedCard would be a new feature, so it is left for a
// deliberate decision. When it is mounted it will already match the rest of
// the module.
//
// ONE LEVEL DEEP, AND THAT IS THE FEATURE. comment_max_depth defaults to 1;
// add_comment() refuses a deeper one and this screen never offers one.
//
// Behaviour unchanged: recognition_comments + comment_reactions read
// directly, add_comment through wallRpc, reactions inserted optimistically.
// Sub-components at module scope.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { wallRpc } from '@/lib/wall/rpc'
import { C, F, W, S } from '@/lib/ui'
import { threadComments, renderBody,
         type CommentRow, type Reaction } from '@/lib/wall/comments'
import { Avatar, Button, FieldError, RAD, inputStyle, shortDate } from '@/components/wall/ui'

// ── module scope ─────────────────────────────────────────────────────────

function Mention({ name }: { name: string }) {
  return (
    <span style={{ padding: '1px 6px', borderRadius: 5, background: C.brandTint,
                   color: C.brand, fontWeight: W.semi }}>@{name}</span>
  )
}

function Body({ text, names }: { text: string; names: Map<string, string> }) {
  return (
    <p style={{ margin: '2px 0 0', fontSize: F.small, color: C.inkSoft, lineHeight: 1.6 }}>
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
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {CHOICES.map(e => {
        const n = emojis[e] ?? 0
        return (
          <button key={e} type="button" onClick={() => onReact(e)} className="wof-tile"
            aria-label={`React with ${e}${n ? `, ${n} so far` : ''}`}
            style={{ cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex',
                     alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999,
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

function One({ c, names, reacts, onReact, onReply, canReply, small }: {
  c: CommentRow; names: Map<string, string>
  reacts: Record<string, number>
  onReact: (id: string, emoji: string) => void
  onReply?: () => void
  canReply: boolean
  small?: boolean
}) {
  const who = names.get(c.employee_id) ?? 'Someone'
  const when = shortDate(c.created_at)
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <Avatar name={who} size={small ? 26 : 32} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ background: C.sunken, borderRadius: RAD.tile, padding: '8px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>{who}</span>
            {when && <span style={{ fontSize: F.micro, color: C.faint }}>{when}</span>}
          </div>
          <Body text={c.body} names={names} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginTop: 5 }}>
          <Reacts emojis={reacts} onReact={e => onReact(c.id, e)} />
          {canReply && onReply && (
            <Button size="sm" variant="ghost" onClick={onReply}>Reply</Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── the thread ───────────────────────────────────────────────────────────

export default function CommentThread({
  recognitionId, names, actorId, repliesEnabled = true, onPosted,
}: {
  recognitionId: string
  /** Whose portal this is. Only needed for a dashboard admin viewing ESS. */
  actorId?: string
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
    const mentioned = [...names.entries()]
      .filter(([, n]) => body.includes('@' + n)).map(([id]) => id)
    const r = await wallRpc('add_comment', {
      p_recognition: recognitionId, p_body: body,
      p_parent: replyTo, p_mentions: mentioned,
    }, actorId)
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
    if (r.error) load()
  }

  const threads = threadComments(rows)

  return (
    <div style={{ display: 'grid', gap: S.md }}>
      {threads.map(t => (
        <div key={t.id} style={{ display: 'grid', gap: S.sm }}>
          <One c={t} names={names} reacts={reacts[t.id] ?? {}} onReact={react}
               canReply={repliesEnabled} onReply={() => setReplyTo(t.id)} />
          {t.replies.length > 0 && (
            <div style={{ marginLeft: 16, paddingLeft: 26, borderLeft: `2px solid ${C.line}`,
                          display: 'grid', gap: S.sm }}>
              {t.replies.map(r => (
                <One key={r.id} c={r} names={names} reacts={reacts[r.id] ?? {}}
                     onReact={react} canReply={false} small />
              ))}
            </div>
          )}
        </div>
      ))}

      {replyTo && (
        <div style={{ fontSize: F.micro, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
          Replying to {names.get(threads.find(t => t.id === replyTo)?.employee_id ?? '') ?? 'a comment'}
          <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>Cancel</Button>
        </div>
      )}

      <div style={{ display: 'flex', gap: S.sm, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input
          value={draft} onChange={e => setDraft(e.target.value)}
          placeholder={replyTo ? 'Write a reply…' : 'Add a comment. Use @ to mention someone.'}
          aria-label={replyTo ? 'Your reply' : 'Your comment'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post() } }}
          style={{ ...inputStyle, flex: '1 1 240px', width: 'auto', minWidth: 0, borderRadius: 999,
                   padding: '9px 16px' }}
        />
        <Button variant="primary" icon="send" onClick={post} busy={busy} disabled={!draft.trim()}>
          {busy ? 'Posting…' : replyTo ? 'Reply' : 'Comment'}
        </Button>
      </div>

      <FieldError>{err}</FieldError>
    </div>
  )
}
