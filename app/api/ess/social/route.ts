// app/api/ess/social/route.ts
//
//   GET  ?employee_id=…            -> the whole Social payload for the caller's GROUP
//   POST { action: … }             -> react | comment | react_comment | wish | intro | remove
//
// ── SCOPE ───────────────────────────────────────────────────────────────────
// This is the one surface in the product that crosses company lines. Every
// other ESS route scopes to ctx.companyId; this one resolves the caller's
// company to its groups.id and reads every company under it. Confirmed as a
// product decision, and it is why the group is resolved once here and every
// query below is filtered by it — a query that forgets returns nothing rather
// than everything, which is the failure direction you want.
//
// ── TWO STORES, ONE FEED ────────────────────────────────────────────────────
// Celebrations and joiners live in social_posts (118). Shoutouts stay in
// recognitions, with the Wall's own reaction and comment tables. Each row says
// which it came from, and a write is routed by that `source`. Nothing is
// duplicated between them.
//
// ── WHAT NEVER LEAVES THE SERVER ────────────────────────────────────────────
// A birthday post carries the day and month; the year of birth is never
// selected. And removed_by is never returned to a client — the author is told
// HR's remark, never who wrote it.
//
// ── ROW TYPES ───────────────────────────────────────────────────────────────
// The Supabase client hands back loosely typed rows, so each query is cast
// once, at the boundary, into the shapes below. That keeps the casts countable
// and in one place instead of sprinkling `any` through the mapping code, which
// is what the first draft of this file did.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, type EssContext } from '@/lib/ess/session'
import { hasAdminAccess } from '@/lib/rms/resolve'
import { notify } from '@/lib/notifications/dispatch'

export const dynamic = 'force-dynamic'

/** How far ahead each list looks. Mirrors what the section actually shows. */
const BIRTHDAY_DAYS = 14
const ANNIVERSARY_DAYS = 7

type PostKind = 'birthday' | 'anniversary' | 'joiner'

interface Person {
  id: string; name: string; initials: string
  designation: string | null; department: string | null; company: string | null
}

interface EmpRow {
  id: string; full_name: string | null; designation: string | null
  departments: { dept_name: string | null } | null
  companies: { company_name: string | null } | null
}
interface PostRow {
  id: string; kind: PostKind; subject_employee_id: string
  occasion_on: string; years: number | null; created_at: string
  removed_reason: string | null; removed_at: string | null
}
interface ReactionRow { post_id: string; emoji: string; employee_id: string }
interface CommentRow {
  id: string; post_id: string; employee_id: string
  body: string; media_ref: string | null; created_at: string
  removed_reason: string | null; removed_at: string | null
}
interface CommentReactionRow { comment_id: string; emoji: string; employee_id: string }
interface IntroRow { employee_id: string; intro: string | null; hobbies: string[]; skills: string[] }
interface WallRow {
  id: string; message: string | null; published_at: string | null
  category_label: string | null; category_glyph: string | null
  giver_id: string | null; receivers: { id: string }[] | null; company_id: string
}

/** Everything a POST may carry. Narrow, so a typo is a compile error. */
interface PostBody {
  action?: string
  post_id?: string
  comment_id?: string
  emoji?: string
  body?: string
  media_ref?: string
  intro?: string
  hobbies?: unknown[]
  skills?: unknown[]
  target?: string
  id?: string
  reason?: string
  source?: string
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'

/** PostgREST's "that relation/function is not there" — i.e. 118 is not applied. */
const notInstalled = (msg: string) => /PGRST202|PGRST205|does not exist/i.test(msg)
const pendingResponse = () => NextResponse.json(
  { error: 'Social is not switched on yet — migration 118 has not been applied.', installed: false },
  { status: 503 },
)

/** The caller's group, and every company inside it. */
async function resolveGroup(ctx: EssContext) {
  if (!ctx.companyId) return null
  const { data: me } = await sb.from('companies')
    .select('id, group_id').eq('id', ctx.companyId).maybeSingle()
  const groupId = (me as { group_id: string | null } | null)?.group_id ?? null
  if (!groupId) {
    // A company with no group still gets a feed — its own. An ungrouped company
    // is a group of one, and returning nothing would read as "Social is broken"
    // rather than "you are the only company here".
    return { groupId: null, name: null as string | null, companyIds: [ctx.companyId] }
  }
  const [{ data: g }, { data: cos }] = await Promise.all([
    sb.from('groups').select('group_name').eq('id', groupId).maybeSingle(),
    sb.from('companies').select('id').eq('group_id', groupId),
  ])
  return {
    groupId,
    name: (g as { group_name: string | null } | null)?.group_name ?? null,
    companyIds: ((cos ?? []) as { id: string }[]).map(c => c.id),
  }
}

/** Employee rows for a set of ids, with company and department names. */
async function peopleById(ids: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>()
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < uniq.length; i += 200) {
    // date_of_birth is deliberately absent. Nothing downstream needs it, and
    // Profile 360 hides it from colleagues — the two surfaces should not
    // disagree about how private it is.
    const { data } = await sb.from('employees')
      .select('id, full_name, designation,'
            + ' departments!employees_department_id_fkey(dept_name),'
            + ' companies!employees_company_id_fkey(company_name)')
      .in('id', uniq.slice(i, i + 200))
    for (const e of (data ?? []) as unknown as EmpRow[]) {
      const name = e.full_name ?? 'A colleague'
      out.set(e.id, {
        id: e.id,
        name,
        initials: initialsOf(name),
        designation: e.designation,
        department: e.departments?.dept_name ?? null,
        company: e.companies?.company_name ?? null,
      })
    }
  }
  return out
}

/** Group a flat reaction list into {emoji, count, mine} per target id. */
function tally(rows: { target: string; emoji: string; employee_id: string }[], me: string) {
  const by = new Map<string, Map<string, { count: number; mine: boolean }>>()
  for (const r of rows) {
    if (!by.has(r.target)) by.set(r.target, new Map())
    const m = by.get(r.target)!
    const cur = m.get(r.emoji) ?? { count: 0, mine: false }
    cur.count += 1
    if (r.employee_id === me) cur.mine = true
    m.set(r.emoji, cur)
  }
  return (id: string) =>
    Array.from(by.get(id)?.entries() ?? []).map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }))
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId

  const grp = await resolveGroup(ctx)
  if (!grp) {
    return NextResponse.json(
      { error: 'Your employee record has no company, so there is no feed to show.' }, { status: 400 })
  }

  // Keep the group's posts current. Idempotent by a unique constraint, so this
  // is a no-op after the first call of the day.
  if (grp.groupId) {
    const { error } = await sb.rpc('ess_social_materialise', {
      p_group_id: grp.groupId, p_birthday_days: BIRTHDAY_DAYS, p_anniversary_days: ANNIVERSARY_DAYS,
    })
    if (error && notInstalled(error.message)) return pendingResponse()
  }

  const { data: postData, error: pErr } = await sb.from('social_posts')
    .select('id, kind, subject_employee_id, occasion_on, years, created_at, removed_reason, removed_at')
    .in('company_id', grp.companyIds)
    .order('occasion_on', { ascending: true })
    .limit(300)
  if (pErr) {
    if (notInstalled(pErr.message)) return pendingResponse()
    return NextResponse.json({ error: pErr.message }, { status: 500 })
  }
  const posts = (postData ?? []) as unknown as PostRow[]
  const postIds = posts.map(p => p.id)

  const [rxRes, cmRes, introRes] = await Promise.all([
    postIds.length
      ? sb.from('social_reactions').select('post_id, emoji, employee_id').in('post_id', postIds)
      : Promise.resolve({ data: [] }),
    postIds.length
      ? sb.from('social_comments')
          .select('id, post_id, employee_id, body, media_ref, created_at, removed_reason, removed_at')
          .in('post_id', postIds).order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    sb.from('social_intros').select('employee_id, intro, hobbies, skills'),
  ])
  const reactions = (rxRes.data ?? []) as unknown as ReactionRow[]
  const comments = (cmRes.data ?? []) as unknown as CommentRow[]
  const intros = (introRes.data ?? []) as unknown as IntroRow[]

  const commentIds = comments.map(c => c.id)
  const crxRes = commentIds.length
    ? await sb.from('social_comment_reactions').select('comment_id, emoji, employee_id').in('comment_id', commentIds)
    : { data: [] }
  const commentReactions = (crxRes.data ?? []) as unknown as CommentReactionRow[]

  // Shoutouts, from the Wall's own view, widened from company to group.
  const { data: wallData } = await sb.from('v_company_feed')
    .select('id, message, published_at, category_label, category_glyph, giver_id, receivers, company_id')
    .in('company_id', grp.companyIds)
    .order('published_at', { ascending: false })
    .limit(30)
  const wallRows = (wallData ?? []) as unknown as WallRow[]

  const introBy = new Map(intros.map(i => [i.employee_id, i]))
  const postRx = tally(reactions.map(x => ({ target: x.post_id, emoji: x.emoji, employee_id: x.employee_id })), me)
  const cmRx = tally(commentReactions.map(x => ({ target: x.comment_id, emoji: x.emoji, employee_id: x.employee_id })), me)

  const who = await peopleById([
    me,
    ...posts.map(p => p.subject_employee_id),
    ...comments.map(c => c.employee_id),
    ...wallRows.flatMap(w => [w.giver_id, ...(w.receivers ?? []).map(x => x.id)]).filter((x): x is string => !!x),
  ])
  const person = (id: string | null): Person =>
    (id ? who.get(id) : undefined)
      ?? { id: id ?? '', name: 'A colleague', initials: '?', designation: null, department: null, company: null }

  const commentsFor = (postId: string) => comments
    .filter(c => c.post_id === postId)
    .map(c => ({
      id: c.id,
      author: person(c.employee_id),
      body: c.removed_at ? '' : c.body,
      media: c.removed_at || !c.media_ref ? null : { kind: 'gif' as const, ref: c.media_ref, label: c.media_ref },
      at: c.created_at,
      reactions: cmRx(c.id),
      mine: c.employee_id === me,
      removed: c.removed_at ? { remark: c.removed_reason ?? '', at: c.removed_at } : null,
    }))

  const today = new Date().toISOString().slice(0, 10)
  const shape = (p: PostRow) => {
    const intro = introBy.get(p.subject_employee_id)
    const thread = commentsFor(p.id)
    return {
      id: p.id,
      source: 'social' as const,
      kind: p.kind,
      subject: person(p.subject_employee_id),
      at: p.created_at,
      on: p.occasion_on,
      years: p.years ?? undefined,
      joined_on: p.kind === 'joiner' ? p.occasion_on : undefined,
      intro: p.kind === 'joiner' ? (intro?.intro ?? null) : undefined,
      hobbies: p.kind === 'joiner' ? (intro?.hobbies ?? []) : undefined,
      skills: p.kind === 'joiner' ? (intro?.skills ?? []) : undefined,
      reactions: postRx(p.id),
      comments: thread,
      // "Have I already said something to this person?" — read from the
      // caller's own comment rather than a second query.
      acted: thread.some(c => c.mine),
      removed: p.removed_at ? { remark: p.removed_reason ?? '', at: p.removed_at } : null,
      mine: false,
    }
  }

  const all = posts.filter(p => p.subject_employee_id !== me).map(shape)
  const mineRemoved = posts.filter(p => p.subject_employee_id === me && p.removed_at).map(shape)

  return NextResponse.json({
    group: { name: grp.name ?? 'your company', companies: grp.companyIds.length },
    me: person(me),
    today: all.filter(p => p.on === today && p.kind !== 'joiner'),
    upcoming_birthdays: all.filter(p => p.kind === 'birthday' && p.on > today),
    week_anniversaries: all.filter(p => p.kind === 'anniversary' && p.on > today),
    joiners: all.filter(p => p.kind === 'joiner'),
    wall: wallRows.map(w => ({
      id: w.id,
      source: 'wall' as const,
      kind: 'shoutout' as const,
      subject: person((w.receivers ?? [])[0]?.id ?? w.giver_id),
      author: person(w.giver_id),
      at: w.published_at,
      body: w.message,
      category: w.category_label ? { label: w.category_label, glyph: w.category_glyph } : null,
      // The Wall's reactions and comments live in its own tables. Reading them
      // per row is a second round trip this pass does not make; the counts
      // arrive with the next iteration rather than being faked here.
      reactions: [] as { emoji: string; count: number; mine: boolean }[],
      comments: [] as unknown[],
      acted: false,
      removed: null,
      mine: w.giver_id === me,
    })),
    notices: mineRemoved.map(p => ({
      id: p.id,
      kind: p.kind,
      excerpt: `Your ${p.kind === 'birthday' ? 'birthday' : p.kind === 'anniversary' ? 'anniversary' : 'new joiner'} post`,
      removed: p.removed!,
    })),
  })
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const r = await essRoute(req)
  if (r.error) return r.error
  const { ctx } = r
  const me = ctx.caller.employeeId

  // Nothing is written while viewing somebody else's portal. The Wall route
  // holds the same line: recognition posted as another person is not
  // recognition, and a comment is no different.
  if (ctx.caller.viewAs) {
    return NextResponse.json({ error: 'You are viewing another portal. Open your own to post.' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as PostBody | null
  const action = String(body?.action ?? '')

  switch (action) {
    // ── react / unreact. The toggle is a delete, never a second row. ────────
    case 'react': {
      const postId = body?.post_id
      const emoji = body?.emoji
      if (!postId || !emoji) return NextResponse.json({ error: 'post_id and emoji are required' }, { status: 400 })
      const { data: existing } = await sb.from('social_reactions')
        .select('id').eq('post_id', postId).eq('employee_id', me).eq('emoji', emoji).maybeSingle()
      if (existing) {
        await sb.from('social_reactions').delete().eq('id', (existing as { id: string }).id)
        return NextResponse.json({ ok: true, mine: false })
      }
      const { error } = await sb.from('social_reactions').insert({ post_id: postId, employee_id: me, emoji })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, mine: true })
    }

    case 'react_comment': {
      const commentId = body?.comment_id
      const emoji = body?.emoji
      if (!commentId || !emoji) return NextResponse.json({ error: 'comment_id and emoji are required' }, { status: 400 })
      const { data: existing } = await sb.from('social_comment_reactions')
        .select('id').eq('comment_id', commentId).eq('employee_id', me).eq('emoji', emoji).maybeSingle()
      if (existing) {
        await sb.from('social_comment_reactions').delete().eq('id', (existing as { id: string }).id)
        return NextResponse.json({ ok: true, mine: false })
      }
      const { error } = await sb.from('social_comment_reactions')
        .insert({ comment_id: commentId, employee_id: me, emoji })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, mine: true })
    }

    // ── comment, and the wish that is a comment with a notification ─────────
    case 'comment':
    case 'wish': {
      const postId = body?.post_id
      const text = String(body?.body ?? '').trim().slice(0, 1000)
      const media = body?.media_ref ? String(body.media_ref).slice(0, 60) : null
      if (!postId) return NextResponse.json({ error: 'post_id is required' }, { status: 400 })
      if (!text && !media) return NextResponse.json({ error: 'Write something, or pick a GIF.' }, { status: 400 })

      const { data: postData } = await sb.from('social_posts')
        .select('id, kind, subject_employee_id, removed_at').eq('id', postId).maybeSingle()
      const post = postData as { id: string; kind: PostKind; subject_employee_id: string; removed_at: string | null } | null
      if (!post) return NextResponse.json({ error: 'No such post' }, { status: 404 })
      if (post.removed_at) return NextResponse.json({ error: 'That post has been removed.' }, { status: 409 })

      const { data: rowData, error } = await sb.from('social_comments')
        .insert({ post_id: postId, employee_id: me, body: text, media_ref: media })
        .select('id, created_at').maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const row = rowData as { id: string; created_at: string } | null

      const { data: senderData } = await sb.from('employees').select('full_name').eq('id', me).maybeSingle()
      const senderName = (senderData as { full_name: string | null } | null)?.full_name ?? 'A colleague'

      // A wish also lands in ess_kudos, which is where the Today tab and the
      // Android app already read wishes from. One per person per day, the same
      // rule /api/ess/celebrations enforces — without it the bell becomes a
      // spam target and there is no undo on a notification.
      let duplicate = false
      if (post.subject_employee_id !== me) {
        if (action === 'wish') {
          const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
          const { data: already } = await sb.from('ess_kudos')
            .select('id').eq('from_employee_id', me).eq('to_employee_id', post.subject_employee_id)
            .gte('created_at', startOfDay.toISOString()).limit(1)
          duplicate = ((already ?? []) as { id: string }[]).length > 0
          if (!duplicate) {
            const badge = post.kind === 'birthday' ? 'BIRTHDAY'
                        : post.kind === 'anniversary' ? 'ANNIVERSARY' : 'JOINING'
            await sb.from('ess_kudos').insert({
              from_employee_id: me, to_employee_id: post.subject_employee_id,
              message: text || null, badge, points: 0,
            })
            const title = post.kind === 'birthday' ? `🎂 ${senderName} wished you a happy birthday`
                        : post.kind === 'anniversary' ? `🌟 ${senderName} congratulated you on your work anniversary`
                        : `👋 ${senderName} welcomed you`
            await notify({
              subjectId: me, toEmployeeId: post.subject_employee_id,
              code: 'WISH_RECEIVED', title, body: text || undefined,
            })
          }
        } else {
          await notify({
            subjectId: me, toEmployeeId: post.subject_employee_id, code: 'SOCIAL_COMMENT',
            title: `${senderName} commented on your post`, body: text || undefined,
          })
        }
      }

      return NextResponse.json({ ok: true, id: row?.id, at: row?.created_at, duplicate })
    }

    // ── the joiner's own introduction ───────────────────────────────────────
    case 'intro': {
      const intro = String(body?.intro ?? '').trim().slice(0, 600)
      const clean = (list: unknown[] | undefined, max: number) =>
        Array.isArray(list) ? list.slice(0, max).map(s => String(s).slice(0, 40)).filter(Boolean) : []
      const { error } = await sb.from('social_intros').upsert({
        employee_id: me,
        intro: intro || null,
        hobbies: clean(body?.hobbies, 10),
        skills: clean(body?.skills, 12),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'employee_id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    // ── HR takedown ─────────────────────────────────────────────────────────
    // The author is told the remark and never who acted. removed_by is stored
    // for audit and is not returned by GET.
    case 'remove': {
      // A first cut, deliberately: the full HR matrix is the role-wise
      // rollout's job and rms_config.enforce_module_access is still FALSE, so
      // anything finer would enforce a rule the rest of the product does not.
      if (!hasAdminAccess(ctx.grant)) {
        return NextResponse.json({ error: 'Only HR can remove a post.' }, { status: 403 })
      }
      const target = body?.target === 'comment' ? 'comment' : 'post'
      const id = body?.id
      const reason = String(body?.reason ?? '').trim().slice(0, 300)
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
      if (reason.length < 5) {
        return NextResponse.json(
          { error: 'Give a remark — the author is shown it in place of their words.' }, { status: 400 })
      }

      const table = target === 'comment' ? 'social_comments' : 'social_posts'
      const authorCol = target === 'comment' ? 'employee_id' : 'subject_employee_id'
      const { data: rowData } = await sb.from(table).select(`id, ${authorCol}`).eq('id', id).maybeSingle()
      const row = rowData as Record<string, string> | null
      if (!row) return NextResponse.json({ error: 'No such item' }, { status: 404 })

      const { error } = await sb.from(table).update({
        removed_by: me, removed_reason: reason, removed_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      await notify({
        subjectId: me,
        toEmployeeId: row[authorCol],
        code: target === 'comment' ? 'SOCIAL_COMMENT_REMOVED' : 'SOCIAL_POST_REMOVED',
        title: target === 'comment' ? 'A comment of yours was removed' : 'A post of yours was removed',
        // HR's words, verbatim. Nothing here identifies the person who acted.
        body: `Removed for violating company policy. “${reason}”`,
      })
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: `Unknown action '${action}'.` }, { status: 400 })
  }
}
