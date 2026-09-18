'use client';
// components/ess/social/PostCard.tsx — one post, whatever kind it is.
//
// Reactions and comments belong to THIS component and nowhere else. The brief
// asks for both on every post in every sub-section, and the only way that stays
// true a year from now is if there is exactly one implementation of each.
//
// EVERY SUB-COMPONENT IS AT MODULE SCOPE. Declared inside the parent they are
// new function identities on every render, React unmounts and remounts them,
// and any focused <textarea> loses focus on each keystroke. This codebase has
// had that bug and fixed it; the comment box and the wish composer below are
// exactly where it would come back.
//
// No browser storage anywhere in this module, matching the Wall.
import { useState, useSyncExternalStore } from 'react';
import type { Reaction, SocialComment, SocialPerson, SocialPost, SocialKind } from './types';
import { REACTIONS } from './mock';
import { Bubble, AddReaction, ShieldOff, Cake, Medal, Door, Trophy } from './icons';

// ── shared helpers ─────────────────────────────────────────────────────────

/**
 * Per-kind ink and tint, as CSS variables the stylesheet reads.
 *
 * Returned as a style object rather than a class so one card can be tinted
 * without a rule per kind — and so a kind added later needs no CSS at all.
 */
export function kindStyle(kind: SocialKind): React.CSSProperties {
  // Three values, not two: every gradient in the stylesheet runs ink -> ink-2,
  // and a missing second stop makes the card edge, the primary button and the
  // page wash resolve to nothing at all.
  const v = {
    birthday: ['var(--soc-birthday)', 'var(--soc-birthday-2)', 'var(--soc-birthday-tint)'],
    anniversary: ['var(--soc-anniv)', 'var(--soc-anniv-2)', 'var(--soc-anniv-tint)'],
    joiner: ['var(--soc-joiner)', 'var(--soc-joiner-2)', 'var(--soc-joiner-tint)'],
    shoutout: ['var(--soc-wall)', 'var(--soc-wall-2)', 'var(--soc-wall-tint)'],
  }[kind];
  return {
    ['--kind-ink' as string]: v[0],
    ['--kind-2' as string]: v[1],
    ['--kind-tint' as string]: v[2],
  };
}

export const KindIcon = ({ kind }: { kind: SocialKind }) => {
  const I = { birthday: Cake, anniversary: Medal, joiner: Door, shoutout: Trophy }[kind];
  return <I />;
};

/**
 * Avatar colour derived from the name, so one person keeps one colour on every
 * screen. Same hash and the same theme-aware mix as lib/ui's Avatar — copied
 * deliberately rather than imported, because that one is a 20x20 table cell and
 * this is a 44px social avatar with a badge hanging off it.
 */
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function Avatar({ person, size, mark }: {
  person: SocialPerson; size?: 'lg'; mark?: React.ReactNode;
}) {
  const h = hue(person.name);
  return (
    <div
      className={'av' + (size === 'lg' ? ' lg' : '')}
      style={{
        background: `color-mix(in srgb, hsl(${h} 58% 93%) var(--ez-avatar-tint-mix, 100%), var(--ez-surface))`,
        color: `hsl(${h} var(--ez-avatar-sat, 62%) var(--ez-avatar-light, 28%))`,
      }}
    >
      {person.initials}
      {mark && <span className="mark" style={{ color: 'var(--kind-ink)' }}>{mark}</span>}
    </div>
  );
}

/** "just now", "2h ago", "3 Oct" — the Inbox's scale, not a full timestamp. */
export function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 7 * 24 * 60) return `${Math.round(mins / 1440)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** A subscribe that never fires: the value below can only change once, at hydration. */
const NEVER = () => () => {};

/**
 * Relative time, rendered only once the client owns the DOM.
 *
 * TWO REAL BUGS THIS FIXES, AND THE FIRST ATTEMPT MISSED BOTH.
 *
 * 1. HYDRATION. The obvious reading is that `ago()` reads the clock during
 *    render. The actual cause is a step earlier: mock.ts builds its timestamps
 *    from Date.now() *when the module is evaluated*, and the server and the
 *    browser evaluate it at different moments — so the ISO strings themselves
 *    differ across the boundary, not merely the "5h ago" derived from them.
 *    Stabilising the visible text was not enough; React went on reporting the
 *    mismatch on the `title` attribute, which was still formatting a date.
 *    Nothing clock-derived is rendered on the server now, so there is nothing
 *    left to disagree about.
 *
 * 2. LINT, AND A WASTED RENDER. Detecting mount with useEffect + setState is an
 *    error under this repo's react-hooks/set-state-in-effect rule, and it does
 *    cause the cascading second render the rule warns about.
 *    useSyncExternalStore reports the same fact with no effect and no state:
 *    the server snapshot is false, the client snapshot is true.
 *
 * The cost is that the time appears one frame late. That is the right trade for
 * the real portal too, where posts are minutes old and the two sides disagree
 * most often.
 */
export function TimeAgo({ iso, className, style }: {
  iso: string; className?: string; style?: React.CSSProperties;
}) {
  const hydrated = useSyncExternalStore(NEVER, () => true, () => false);
  return (
    <span
      className={className}
      style={style}
      title={hydrated ? new Date(iso).toLocaleString('en-IN') : undefined}
      suppressHydrationWarning
    >
      {hydrated ? ago(iso) : ''}
    </span>
  );
}

/**
 * "today", "tomorrow", "on Friday, 3 Oct".
 *
 * Day and month only — never the year, so no age is shown or inferable. That is
 * the decision behind the whole birthday sub-section.
 */
export function when(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const diff = Math.round((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5);
  const dm = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return `on ${d.toLocaleDateString('en-IN', { weekday: 'long' })}, ${dm}`;
  return `on ${dm}`;
}

/** Toggle one emoji in a reaction list. Pure, so it is the same on both sides. */
export function toggle(list: Reaction[], emoji: string): Reaction[] {
  const at = list.findIndex(r => r.emoji === emoji);
  if (at < 0) return [...list, { emoji, count: 1, mine: true }];
  const r = list[at];
  const next = { ...r, count: r.count + (r.mine ? -1 : 1), mine: !r.mine };
  // A reaction nobody holds is removed rather than left showing a zero.
  if (next.count <= 0) return list.filter((_, i) => i !== at);
  return list.map((x, i) => (i === at ? next : x));
}

// ── removed ────────────────────────────────────────────────────────────────

/**
 * What a reader sees where a removed post or comment was.
 *
 * It names the reason and quotes HR's remark, and carries NOTHING about who
 * removed it — no name, no role, no initials. That is a deliberate product
 * decision: a policy takedown should not become a personal matter between two
 * colleagues. The acting user is recorded server-side for audit and simply
 * never leaves the server.
 */
export function RemovedBlock({ remark, mine }: { remark: string; mine?: boolean }) {
  return (
    <div className="removed">
      <span className="ic"><ShieldOff /></span>
      <div style={{ minWidth: 0 }}>
        <div className="t">Removed by the authorities</div>
        <div className="d">
          {mine
            ? 'This was removed for violating company policy. You can post again, within the policy.'
            : 'This was removed for violating company policy.'}
        </div>
        <div className="q">“{remark}”</div>
      </div>
    </div>
  );
}

// ── reactions ──────────────────────────────────────────────────────────────

function ReactionBar({ list, onToggle, compact }: {
  list: Reaction[]; onToggle: (emoji: string) => void; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={compact ? 'mini' : 'bar'}>
      {list.map(r => (
        <button
          key={r.emoji} type="button" className="rx" data-mine={r.mine ? '1' : '0'}
          onClick={() => onToggle(r.emoji)}
          aria-pressed={r.mine}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
        >
          <span aria-hidden>{r.emoji}</span><span className="n">{r.count}</span>
        </button>
      ))}
      <span className="rxwrap">
        <button
          type="button" className="rx add" onClick={() => setOpen(o => !o)}
          aria-expanded={open} aria-label="Add a reaction"
        >
          <AddReaction />
        </button>
        {open && (
          <div className="pick" role="menu">
            {REACTIONS.map(e => (
              <button key={e} type="button" role="menuitem" aria-label={e}
                onClick={() => { onToggle(e); setOpen(false); }}>{e}</button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

// ── comments ───────────────────────────────────────────────────────────────

function CommentRow({ c, onReact }: { c: SocialComment; onReact: (emoji: string) => void }) {
  return (
    <div className="cm">
      <Avatar person={c.author} />
      <div className="bub">
        <div className="cmhead">
          <span className="nm">{c.author.name}</span>
          {c.author.company && <span className="co">{c.author.company}</span>}
          <TimeAgo iso={c.at} className="when" style={{ marginLeft: 'auto' }} />
        </div>
        {c.removed
          ? <div style={{ marginTop: 7 }}><RemovedBlock remark={c.removed.remark} mine={c.mine} /></div>
          : (
            <>
              <div className="tx">{c.body}</div>
              <ReactionBar list={c.reactions} onToggle={onReact} compact />
            </>
          )}
      </div>
    </div>
  );
}

function CommentComposer({ me, onSend }: { me: SocialPerson; onSend: (body: string) => void }) {
  const [text, setText] = useState('');
  const send = () => {
    const body = text.trim();
    if (!body) return;
    onSend(body);
    setText('');
  };
  return (
    <div className="write">
      <Avatar person={me} />
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Write a comment…"
        rows={1}
        // Enter sends, Shift+Enter breaks the line — the convention every
        // messaging surface in this product already uses.
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <button type="button" className="btn primary" onClick={send} disabled={!text.trim()}>
        Post
      </button>
    </div>
  );
}

// ── the post ───────────────────────────────────────────────────────────────

export default function PostCard({ post, me, onChange, action, onReact, onComment }: {
  post: SocialPost;
  me: SocialPerson;
  onChange: (next: SocialPost) => void;
  /** The kind-specific call to action — Wish, Greet, Welcome. */
  action?: React.ReactNode;
  /**
   * Given, the parent owns the write — it updates optimistically and posts to
   * /api/ess/social, rolling back if that fails. Absent, the card just edits
   * its own copy, which is what the offline design harness needs. One card,
   * both modes, and no branch on "are we live?" inside the JSX.
   */
  onReact?: (emoji: string) => void;
  onComment?: (body: string) => void;
}) {
  const [showThread, setShowThread] = useState(post.comments.length > 0);

  const react = (emoji: string) => {
    if (onReact) { onReact(emoji); return; }
    onChange({ ...post, reactions: toggle(post.reactions, emoji) });
  };
  // Comment reactions stay local for now: the route has a react_comment action,
  // but the ids here are the parent's to resolve and wiring it through without
  // that plumbing would silently drop every tap.
  const reactComment = (id: string, emoji: string) => onChange({
    ...post,
    comments: post.comments.map(c => (c.id === id ? { ...c, reactions: toggle(c.reactions, emoji) } : c)),
  });
  const addComment = (body: string) => {
    if (onComment) { onComment(body); return; }
    onChange({
      ...post,
      comments: [...post.comments, {
        id: `local-${Date.now()}`, author: me, body, at: new Date().toISOString(),
        reactions: [], mine: true,
      }],
    });
  };

  // A removed post keeps its identity line — the reader already saw it in the
  // feed, and blanking the whole card reads as a bug rather than a takedown.
  const headline = post.kind === 'shoutout' && post.author
    ? <><b>{post.author.name}</b> recognised <b>{post.subject.name}</b></>
    : <b>{post.subject.name}</b>;

  return (
    <article className="post" style={kindStyle(post.kind)}>
      <div className="who">
        <Avatar person={post.subject} mark={<KindIcon kind={post.kind} />} />
        <div className="meta">
          <div className="nm">{headline}</div>
          <div className="rl">
            {[post.subject.designation, post.subject.department].filter(Boolean).join(' · ') || '—'}
            {post.subject.company && <> <span className="co">{post.subject.company}</span></>}
          </div>
        </div>
        <TimeAgo iso={post.at} className="when" />
      </div>

      {post.removed ? (
        <RemovedBlock remark={post.removed.remark} mine={post.mine} />
      ) : (
        <>
          {post.category && (
            <div className="chiprow">
              <span className="chip kind">{post.category.glyph} {post.category.label}</span>
            </div>
          )}
          {post.body && <p className="body">{post.body}</p>}
          {post.media && (
            <div className="media" role="img" aria-label={post.media.label}>
              {{ confetti: '🎊', cake: '🎂', balloons: '🎈', clap: '👏', popper: '🎉', highfive: '🙌' }[post.media.ref] ?? '🎉'}
            </div>
          )}

          <div className="bar">
            <ReactionBar list={post.reactions} onToggle={react} />
            <button type="button" className="btn sm quiet" onClick={() => setShowThread(s => !s)}>
              <Bubble /> {post.comments.length || ''} {post.comments.length === 1 ? 'comment' : 'comments'}
            </button>
            {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
          </div>

          {showThread && (
            <>
              {post.comments.length > 0 && (
                <div className="thread">
                  {post.comments.map(c => (
                    <CommentRow key={c.id} c={c} onReact={e => reactComment(c.id, e)} />
                  ))}
                </div>
              )}
              <CommentComposer me={me} onSend={addComment} />
            </>
          )}
        </>
      )}
    </article>
  );
}
