// lib/wall/comments.ts — threading and mention parsing, without the JSX.
//
// Pure, so it can be tested directly. It lives apart from CommentThread.tsx
// for the same reason cycle.ts lives apart from its stepper: a .tsx file
// cannot be loaded by node --test, and logic that decides what a reader sees
// should not need a browser to prove it works.
//
// THE DEPTH RULE IS HERE. comment_max_depth defaults to 1 — a comment and
// its replies, never a tree — and add_comment() refuses anything deeper.

export interface CommentRow {
  id: string
  body: string
  employee_id: string
  parent_comment_id: string | null
  mentions: string[] | null
  created_at: string | null
  is_hidden?: boolean | null
}

export interface Reaction { comment_id: string; emoji: string; employee_id: string }

/** A comment plus the replies that hang off it. Exactly two levels. */
export interface Threaded extends CommentRow { replies: CommentRow[] }

/**
 * Flatten the table into the only shape the UI is allowed to render.
 *
 * Anything claiming a parent that is not itself a top-level comment is
 * attached to its grandparent rather than dropped. The database prevents
 * depth 3, but a row that predates the constraint — or arrives through some
 * future path — must still be readable. Silently hiding a comment somebody
 * wrote is worse than showing it a level up.
 */
export function threadComments(rows: CommentRow[]): Threaded[] {
  const visible = rows.filter(r => !r.is_hidden)
  const tops = visible.filter(r => !r.parent_comment_id)
  const topIds = new Set(tops.map(t => t.id))
  const byId = new Map(visible.map(r => [r.id, r]))

  const rootOf = (r: CommentRow): string | null => {
    let cur: CommentRow | undefined = r
    // Walk up at most a few links; a cycle in the data must not hang the UI.
    for (let i = 0; i < 8 && cur?.parent_comment_id; i++) {
      if (topIds.has(cur.parent_comment_id)) return cur.parent_comment_id
      cur = byId.get(cur.parent_comment_id)
    }
    return cur && topIds.has(cur.id) ? cur.id : null
  }

  const out: Threaded[] = tops.map(t => ({ ...t, replies: [] }))
  const slot = new Map(out.map(t => [t.id, t]))
  for (const r of visible) {
    if (!r.parent_comment_id) continue
    const root = rootOf(r)
    if (root) slot.get(root)?.replies.push(r)
  }
  const byTime = (a: CommentRow, b: CommentRow) =>
    (a.created_at ?? '').localeCompare(b.created_at ?? '')
  out.sort(byTime)
  for (const t of out) t.replies.sort(byTime)
  return out
}

/** Split a body into text and @mention chips, using the ids the row carries.
 *  Names are resolved by the caller — this never invents one. */
export function renderBody(body: string, names: Map<string, string>): (string | { at: string })[] {
  if (!names.size) return [body]
  // Longest first, so "Priya Nair" wins over "Priya".
  const wanted = [...names.values()].sort((a, b) => b.length - a.length)
  const re = new RegExp('@(' + wanted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g')
  const out: (string | { at: string })[] = []
  let last = 0
  for (const m of body.matchAll(re)) {
    if (m.index! > last) out.push(body.slice(last, m.index))
    out.push({ at: m[1] })
    last = m.index! + m[0].length
  }
  if (last < body.length) out.push(body.slice(last))
  return out.length ? out : [body]
}
