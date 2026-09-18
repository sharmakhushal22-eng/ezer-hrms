'use client';
// components/ess/social/Social.tsx — the Social section of the ESS portal.
//
// Four sub-tabs: Wall of Fame, Birthdays, Work anniversaries, New joiners.
// Wall of Fame moved here from the top level of the portal rail; the other
// three are new.
//
// ── TWO MODES, ONE COMPONENT ────────────────────────────────────────────────
// Given `initial` it renders that and touches no network — that is the design
// harness at /social-preview, which has to work with no login and no database.
// Given `employeeId` it fetches /api/ess/social. The shapes are identical, so
// the preview stays an honest picture of the real thing.
//
// In live mode the Wall tab renders the EXISTING WallOfFame component rather
// than feed cards. It already carries the shoutout composer, the spotlight, the
// leaderboard and the badge cabinet; replacing that with a list of posts would
// be a regression wearing the clothes of a redesign.
//
// ── THE COUNTS ARE NEVER SUMMED ─────────────────────────────────────────────
// Each tab carries its own number and no total is shown anywhere. The portal
// already holds this rule for the Inbox — one badge over appreciation and
// workflow is how appreciation goes unread — and four streams of very
// different weight deserve the same treatment.
//
// ── SCOPE IS THE GROUP ──────────────────────────────────────────────────────
// Every company sharing a groups.id sees the same posts, which is why each
// person carries a company chip: across companies, "who is this?" includes
// which one they are in.
import { useCallback, useEffect, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import type { SocialPayload, SocialPost, SocialTab } from './types';
import PostCard, { Avatar, KindIcon, RemovedBlock, kindStyle, when } from './PostCard';
import WishSheet from './WishSheet';
import WallOfFame from '@/components/ess/WallOfFame';
import { authHeaders } from '@/lib/auth-headers';
import { Cake, Medal, Door, Trophy, Wave, Send, ShieldOff } from './icons';
import './social.css';

const TABS: Array<{
  k: SocialTab; label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  ink: string; ink2: string; tint: string;
}> = [
  { k: 'wall', label: 'Wall of Fame', Icon: Trophy, ink: 'var(--soc-wall)', ink2: 'var(--soc-wall-2)', tint: 'var(--soc-wall-tint)' },
  { k: 'birthdays', label: 'Birthdays', Icon: Cake, ink: 'var(--soc-birthday)', ink2: 'var(--soc-birthday-2)', tint: 'var(--soc-birthday-tint)' },
  { k: 'anniversaries', label: 'Work anniversaries', Icon: Medal, ink: 'var(--soc-anniv)', ink2: 'var(--soc-anniv-2)', tint: 'var(--soc-anniv-tint)' },
  { k: 'joiners', label: 'New joiners', Icon: Door, ink: 'var(--soc-joiner)', ink2: 'var(--soc-joiner-2)', tint: 'var(--soc-joiner-tint)' },
];

/** Which accent the whole section wears, from the open tab. */
const KIND_OF: Record<SocialTab, 'shoutout' | 'birthday' | 'anniversary' | 'joiner'> = {
  wall: 'shoutout', birthdays: 'birthday', anniversaries: 'anniversary', joiners: 'joiner',
};

/** The call to action on a celebration, and what it says once it is done. */
function ActionButton({ post, onOpen }: { post: SocialPost; onOpen: () => void }) {
  const label = { birthday: 'Wish', anniversary: 'Greet', joiner: 'Welcome', shoutout: 'Say something' }[post.kind];
  if (post.acted) return <span className="btn done sm" aria-disabled>Sent</span>;
  return (
    <button type="button" className="btn primary sm" onClick={onOpen}>
      {post.kind === 'joiner' ? <Wave /> : <Send />} {label}
    </button>
  );
}

/** A post plus its composer, since the composer belongs to one post at a time. */
function PostBlock({ post, me, onChange, onReact, onSay }: {
  post: SocialPost; me: SocialPayload['me'];
  onChange: (p: SocialPost) => void;
  onReact: (p: SocialPost, emoji: string) => void;
  onSay: (p: SocialPost, message: string, mediaRef: string | null, isWish: boolean) => void;
}) {
  const [composing, setComposing] = useState(false);
  return (
    <div style={kindStyle(post.kind)}>
      <PostCard
        post={post} me={me} onChange={onChange} onReact={emoji => onReact(post, emoji)}
        onComment={body => onSay(post, body, null, false)}
        action={post.removed ? undefined : <ActionButton post={post} onOpen={() => setComposing(true)} />}
      />
      {composing && (
        <WishSheet
          kind={post.kind}
          name={post.subject.name}
          onCancel={() => setComposing(false)}
          onSend={(message, media) => { setComposing(false); onSay(post, message, media?.ref ?? null, true); }}
        />
      )}
    </div>
  );
}

/** The compact list used for "coming up" — a row, not a full post. */
function UpcomingRow({ post, onSay }: {
  post: SocialPost;
  onSay: (p: SocialPost, message: string, mediaRef: string | null, isWish: boolean) => void;
}) {
  const [composing, setComposing] = useState(false);
  const d = new Date((post.on ?? '') + 'T00:00:00');
  return (
    <div style={kindStyle(post.kind)}>
      <div className="row">
        <div className="dt">
          <b>{d.getDate()}</b>
          <span>{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
        </div>
        <Avatar person={post.subject} mark={<KindIcon kind={post.kind} />} />
        <div className="meta">
          <div className="nm" style={{ fontSize: 13.5, fontWeight: 600 }}>{post.subject.name}</div>
          <div className="rl" style={{ fontSize: 12, color: 'var(--ez-muted)' }}>
            {post.kind === 'anniversary'
              ? `${post.years} year${post.years === 1 ? '' : 's'} ${when(post.on ?? '')}`
              : `Birthday ${when(post.on ?? '')}`}
            {post.subject.company && <> · <span className="co">{post.subject.company}</span></>}
          </div>
        </div>
        {post.acted
          ? <span className="btn done sm" aria-disabled>Sent</span>
          : <button type="button" className="btn sm" onClick={() => setComposing(c => !c)}>
              {post.kind === 'anniversary' ? 'Greet' : 'Wish'}
            </button>}
      </div>
      {composing && (
        <WishSheet
          kind={post.kind} name={post.subject.name}
          onCancel={() => setComposing(false)}
          onSend={(message, media) => { setComposing(false); onSay(post, message, media?.ref ?? null, true); }}
        />
      )}
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return <div className="empty"><b>{title}</b>{hint}</div>;
}

export default function Social({ employeeId, initial }: { employeeId?: string; initial?: SocialPayload }) {
  const [data, setData] = useState<SocialPayload | null>(initial ?? null);
  const [tab, setTab] = useState<SocialTab>('wall');
  const [err, setErr] = useState<string | null>(null);
  /** 503 from the route: migration 118 has not been applied yet. */
  const [pending, setPending] = useState(false);
  const live = !initial;

  const load = useCallback(async () => {
    if (!live || !employeeId) return;
    try {
      const r = await fetch(`/api/ess/social?employee_id=${employeeId}`, { headers: await authHeaders() });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503 || j?.installed === false) { setPending(true); return; }
      if (!r.ok) throw new Error(j?.error || 'Could not load Social');
      setData(j as SocialPayload);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [live, employeeId]);

  // Wrapped rather than calling load() straight from the effect body: this
  // repo's lint counts a synchronous setState in an effect as an error — the
  // same rule TimeAgo tripped — and Today.tsx already fetches through an async
  // IIFE for exactly this reason.
  useEffect(() => { void (async () => { await load(); })(); }, [load]);

  /** One updater for every list, so a change lands wherever the post lives. */
  const update = useCallback((next: SocialPost) => setData(d => {
    if (!d) return d;
    const swap = (list: SocialPost[]) => list.map(p => (p.id === next.id ? next : p));
    return {
      ...d,
      today: swap(d.today),
      upcoming_birthdays: swap(d.upcoming_birthdays),
      week_anniversaries: swap(d.week_anniversaries),
      joiners: swap(d.joiners),
      wall: swap(d.wall),
    };
  }), []);

  const send = useCallback(async (payload: Record<string, unknown>) => {
    const r = await fetch('/api/ess/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That did not save');
    return r.json();
  }, []);

  /**
   * Optimistic, and it rolls back.
   *
   * The house rule for this codebase (AppState.sendMessage is the pattern):
   * show the change at once, put it back if the write fails, and say so —
   * never leave somebody believing they reacted when nothing was stored.
   */
  const react = useCallback(async (post: SocialPost, emoji: string) => {
    if (!data) return;
    const before = post;
    const list = post.reactions.slice();
    const at = list.findIndex(x => x.emoji === emoji);
    if (at < 0) list.push({ emoji, count: 1, mine: true });
    else {
      const x = list[at];
      const next = { ...x, count: x.count + (x.mine ? -1 : 1), mine: !x.mine };
      if (next.count <= 0) list.splice(at, 1); else list[at] = next;
    }
    update({ ...post, reactions: list });
    if (!live) return;
    try {
      await send(post.source === 'wall'
        ? { action: 'react', post_id: post.id, emoji, source: 'wall' }
        : { action: 'react', post_id: post.id, emoji });
    } catch (e) { update(before); setErr((e as Error).message); }
  }, [data, live, send, update]);

  const say = useCallback(async (post: SocialPost, message: string, mediaRef: string | null, isWish: boolean) => {
    if (!data) return;
    const before = post;
    update({
      ...post,
      acted: isWish ? true : post.acted,
      comments: [...post.comments, {
        id: `local-${Date.now()}`, author: data.me, body: message,
        at: new Date().toISOString(), reactions: [], mine: true,
        media: mediaRef ? { kind: 'gif', ref: mediaRef, label: mediaRef } : null,
      }],
    });
    if (!live) return;
    try {
      await send({ action: isWish ? 'wish' : 'comment', post_id: post.id, body: message, media_ref: mediaRef });
      load();
    } catch (e) { update(before); setErr((e as Error).message); }
  }, [data, live, send, update, load]);

  // ── states before the feed ────────────────────────────────────────────────
  if (pending) {
    return (
      <div className="soc" style={kindStyle('shoutout')}>
        <div className="page">
          <div className="card" style={{ marginTop: 18 }}>
            <h2><span className="ic"><Trophy /></span> Social is not switched on yet</h2>
            <div className="hint">
              The screens are built and waiting. The tables they read come from migration
              118, which is written and handed over but not applied to this database yet.
              Nothing here is broken.
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="soc" style={kindStyle('shoutout')}>
        <div className="page">
          {err
            ? <div className="card" style={{ marginTop: 18 }}>
                <h2><span className="ic"><ShieldOff /></span> Could not load Social</h2>
                <div className="hint">{err}</div>
              </div>
            : <div className="card" style={{ marginTop: 18, height: 220, opacity: .5 }} />}
        </div>
      </div>
    );
  }

  const me = data.me;
  const todayBirthdays = data.today.filter(p => p.kind === 'birthday');
  const todayAnnivs = data.today.filter(p => p.kind === 'anniversary');
  const counts: Record<SocialTab, number> = {
    wall: data.wall.length,
    birthdays: todayBirthdays.length + data.upcoming_birthdays.length,
    anniversaries: todayAnnivs.length + data.week_anniversaries.length,
    joiners: data.joiners.length,
  };
  const active = TABS.find(t => t.k === tab)!;
  const activeKind = KIND_OF[tab];

  return (
    <div className="soc" style={kindStyle(activeKind)}>
      <div className="page">
        {/* NO HEADER OF OUR OWN.
            The portal already draws one for every section — TabHeader, the
            .ez-page-head band with the section icon, title, status badge and
            description, the same band all 32 dashboard routes use. This
            component used to render a second, taller, purple one underneath
            it, which is both the "two headers" problem and the reason the
            section read as a different product. The scope line survives as a
            chip beside the tabs, because it is the one fact that explains why
            colleagues from other companies appear here at all. */}
        <div className="scoperow">
          <span className="scope">
            {data.group.name} · {data.group.companies} {data.group.companies === 1 ? 'company' : 'companies'}
          </span>
        </div>

        <nav className="tabs" aria-label="Social sections">
          {TABS.map(t => (
            <button
              key={t.k} type="button" className="tab" data-on={tab === t.k ? '1' : '0'}
              onClick={() => setTab(t.k)} aria-current={tab === t.k}
              style={{
                ['--tab-ink' as string]: t.ink,
                ['--tab-ink-2' as string]: t.ink2,
                ['--tab-tint' as string]: t.tint,
              }}
            >
              <span className="tico"><t.Icon /></span>
              {t.label}
              <span className="n">{counts[t.k]}</span>
            </button>
          ))}
        </nav>

        {/* A takedown notice reaches the author here, where they posted, as
            well as in their notifications. It sits below the tabs and stays
            collapsed: it is addressed to one person, and leading every
            reader's page with a red block was the wrong weight entirely. It
            still never says who removed it. */}
        {data.notices.length > 0 && (
          <div className="notices">
            {data.notices.map(n => (
              <details className="notice" key={n.id}>
                <summary>
                  <span className="ic"><ShieldOff /></span>
                  <span className="nt">A post of yours was removed</span>
                  <span className="nx">{n.excerpt}</span>
                </summary>
                <RemovedBlock remark={n.removed.remark} mine />
              </details>
            ))}
          </div>
        )}

        {err && data && (
          <div className="notices">
            <div className="notice"><div className="removed">
              <span className="ic"><ShieldOff /></span>
              <div><div className="t">That did not save</div><div className="d">{err}</div></div>
            </div></div>
          </div>
        )}

        <div style={kindStyle(activeKind)}>

          {/* ── WALL OF FAME ───────────────────────────────────────────── */}
          {tab === 'wall' && (
            live && employeeId
              // The real thing: composer, spotlight, leaderboard, badges.
              ? <WallOfFame employeeId={employeeId} />
              : (
                <section className="card">
                  <h2><span className="ic"><Trophy /></span> Recently recognised</h2>
                  <div className="hint">
                    Recognition here is thanks, never pay — it changes nothing about anyone’s salary.
                  </div>
                  {data.wall.length
                    ? data.wall.map(p => (
                        <PostBlock key={p.id} post={p} me={me} onChange={update} onReact={react} onSay={say} />
                      ))
                    : <Empty title="Nothing yet" hint="Shoutouts your colleagues give will appear here." />}
                </section>
              )
          )}

          {/* ── BIRTHDAYS ──────────────────────────────────────────────── */}
          {tab === 'birthdays' && (
            <>
              <section className={'card' + (todayBirthdays.length ? ' is-today' : '')}>
                <h2><span className="ic"><Cake /></span> Today</h2>
                <div className="hint">Say something — it takes ten seconds and it is remembered.</div>
                {todayBirthdays.length
                  ? todayBirthdays.map(p => (
                      <PostBlock key={p.id} post={p} me={me} onChange={update} onReact={react} onSay={say} />
                    ))
                  : <Empty title="No birthdays today" hint="The next ones are listed below." />}
              </section>

              <section className="card">
                <h2><span className="ic"><Cake /></span> Coming up</h2>
                <div className="hint">The next few, so nobody is a surprise.</div>
                {data.upcoming_birthdays.length ? (
                  <div className="rows">
                    {data.upcoming_birthdays.map(p => <UpcomingRow key={p.id} post={p} onSay={say} />)}
                  </div>
                ) : <Empty title="None coming up" hint="They will appear here as they come round." />}
              </section>
            </>
          )}

          {/* ── WORK ANNIVERSARIES ─────────────────────────────────────── */}
          {tab === 'anniversaries' && (
            <>
              <section className={'card' + (todayAnnivs.length ? ' is-today' : '')}>
                <h2><span className="ic"><Medal /></span> Today</h2>
                <div className="hint">A year of work is worth a sentence from someone who saw it.</div>
                {todayAnnivs.length
                  ? todayAnnivs.map(p => (
                      <PostBlock key={p.id} post={p} me={me} onChange={update} onReact={react} onSay={say} />
                    ))
                  : <Empty title="No anniversaries today" hint="This week’s are listed below." />}
              </section>

              <section className="card">
                <h2><span className="ic"><Medal /></span> This week</h2>
                <div className="hint">Anniversaries falling in the next seven days.</div>
                {data.week_anniversaries.length ? (
                  <div className="rows">
                    {data.week_anniversaries.map(p => <UpcomingRow key={p.id} post={p} onSay={say} />)}
                  </div>
                ) : <Empty title="None this week" hint="They will appear here as they come round." />}
              </section>
            </>
          )}

          {/* ── NEW JOINERS ────────────────────────────────────────────── */}
          {tab === 'joiners' && (
            <section className="card">
              <h2><span className="ic"><Door /></span> New joiners</h2>
              <div className="hint">
                Everyone who joined recently, across {data.group.name}. Say hello.
              </div>
              {data.joiners.length
                ? data.joiners.map(p => (
                    <div key={p.id} style={{ marginBottom: 14 }}>
                      <PostBlock post={p} me={me} onChange={update} onReact={react} onSay={say} />
                      {/* The intro is the joiner's own words. When they have not
                          written it yet the card says so plainly rather than
                          printing an empty block where a person should be. */}
                      {p.intro ? (
                        <div style={{ paddingLeft: 55, display: 'grid', gap: 9 }}>
                          <p className="body">{p.intro}</p>
                          {p.hobbies && p.hobbies.length > 0 && (
                            <div>
                              <div className="lbl" style={{ marginBottom: 5 }}>Outside work</div>
                              <div className="chiprow">
                                {p.hobbies.map(h => <span key={h} className="chip">{h}</span>)}
                              </div>
                            </div>
                          )}
                          {p.skills && p.skills.length > 0 && (
                            <div>
                              <div className="lbl" style={{ marginBottom: 5 }}>Brings with them</div>
                              <div className="chiprow">
                                {p.skills.map(s => <span key={s} className="chip kind">{s}</span>)}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ paddingLeft: 55 }}>
                          <Empty
                            title="No introduction yet"
                            hint={`${p.subject.name.split(' ')[0]} has not written one. It is theirs to write, not HR's — welcome them anyway.`}
                          />
                        </div>
                      )}
                    </div>
                  ))
                : <Empty title="Nobody new right now" hint="New joiners appear here for their first few weeks." />}
            </section>
          )}
        </div>

        <p style={{ fontSize: 11.5, color: 'var(--ez-faint)', textAlign: 'center', margin: '18px 0 40px' }}>
          Showing {active.label.toLowerCase()} for {data.group.name}.
          Birthdays show the day and month only — never the year.
        </p>
      </div>
    </div>
  );
}
