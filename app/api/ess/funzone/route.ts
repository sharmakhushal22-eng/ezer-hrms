// app/api/ess/funzone/route.ts
//
//   GET                        -> my invites, with names resolved
//   POST { action: 'search' }  -> find a colleague by name or employee code
//   POST { action: 'send' }    -> create an invite AND notify the recipient
//   POST { action: 'accept' }  -> accept, returning the live session
//   POST { action: 'answer' }  -> decline (recipient) or cancel (sender)
//   POST { action: 'finish' }  -> record a result
//   POST { action: 'share' }   -> share a score
//
// WHY THIS EXISTS
//
// Two separate faults made multiplayer unusable, and this route fixes both.
//
// 1. NOBODY WAS EVER TOLD. Sending an invite was a bare client-side insert
//    into game_invites. Nothing wrote a notification — the recipient only
//    found out if they happened to open Fun Zone → Play Together and reload.
//    lib/funzone/invite.ts even has inviteLine(), written (per its own
//    comment) so "the notification, the inbox row and the Fun Zone card
//    cannot word it three different ways" — and nothing ever called it.
//    accept_game_invite DOES notify the host that their invite was accepted,
//    so the pattern existed; it was just never applied to sending.
//
// 2. NOBODY COULD JOIN. accept_game_invite identifies the player with
//    funzone_current_employee(), which reads a session setting PostgREST
//    cannot establish, so the actor was always null and the call died on
//    game_sessions.guest_employee being NOT NULL. 096 adds the *_as wrappers
//    that carry the actor; this route is what supplies it.
//
// The player is resolved from the session by essRoute and is never read from
// the body — every wrapper takes the actor as an argument, which is exactly
// why they are service-role only.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { essRoute, notify } from '@/lib/ess/session'
import {
  canInvite, canAccept, canCancel, canDecline, inviteLine,
  type Invite, type InviteStatus,
} from '@/lib/funzone/invite'
import { LIVE_GAMES, gameByCode } from '@/lib/funzone/games'

export const dynamic = 'force-dynamic'

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })

/** 090 has not been run. Say so rather than returning a 500 that reads like a
 *  crash. */
const notInstalled = (e: { code?: string } | null) => e?.code === 'PGRST205'

/** The rule functions take Invite; the client also needs the session id once
 *  an invite has been accepted, so the row is Invite plus that one field. */
type InviteRow = Invite & { sessionId: string | null }

/** The invite rows plus the names, in the shape lib/funzone/invite.ts expects.
 *  Shared by GET and by send(), so the rules are applied to the same view of
 *  the world that the caller was shown. */
async function invitesFor(me: string): Promise<{ rows: InviteRow[]; missing: boolean }> {
  const r = await sb.from('game_invites')
    .select('id,game_code,from_employee,to_employee,status,created_at,message,session_id')
    .or(`from_employee.eq.${me},to_employee.eq.${me}`)
    .order('created_at', { ascending: false }).limit(40)
  if (r.error) return { rows: [], missing: notInstalled(r.error) }

  const raw = (r.data ?? []) as Record<string, unknown>[]
  const ids = [...new Set(raw.flatMap(x => [String(x.from_employee), String(x.to_employee)]))]
  const names = new Map<string, string>()
  if (ids.length) {
    const e = await sb.from('employees').select('id, full_name').in('id', ids)
    for (const x of (e.data ?? []) as { id: string; full_name: string }[]) names.set(x.id, x.full_name)
  }
  return {
    missing: false,
    rows: raw.map(x => ({
      id: String(x.id),
      gameCode: String(x.game_code),
      fromId: String(x.from_employee),
      toId: String(x.to_employee),
      fromName: names.get(String(x.from_employee)) ?? null,
      toName: names.get(String(x.to_employee)) ?? null,
      status: String(x.status) as InviteStatus,
      createdAt: String(x.created_at),
      message: x.message === null ? null : String(x.message),
      sessionId: x.session_id === null ? null : String(x.session_id),
    })),
  }
}

export async function GET(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId

  const { rows, missing } = await invitesFor(me)
  if (missing) {
    return NextResponse.json({ installed: false, invites: [],
      reason: 'The Fun Zone multiplayer tables are not in the database yet (migration 090).' })
  }
  return NextResponse.json({ installed: true, invites: rows, me })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await essRoute(req)
  if (error) return error
  const me = ctx.caller.employeeId

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action ?? '')
  const str = (k: string) => typeof body[k] === 'string' && (body[k] as string).trim()
    ? (body[k] as string).trim() : null

  switch (action) {

    // Search, never browse. The picker used to load up to 300 colleagues into
    // a dropdown on open, which hands every employee the company directory
    // whether or not they had anyone in mind. You now have to know who you are
    // looking for: two characters minimum, matched against name or employee
    // code, capped at ten.
    case 'search': {
      const q = str('q')
      if (!q || q.length < 2) return NextResponse.json({ ok: true, people: [] })

      const mine = await sb.from('employees').select('company_id').eq('id', me).maybeSingle()
      const company = (mine.data as { company_id?: string } | null)?.company_id

      // Escape the PostgREST or() metacharacters. A comma or a parenthesis in
      // the search box would otherwise be parsed as more filter terms.
      const safe = q.replace(/[,()*\\]/g, ' ').trim()
      if (!safe) return NextResponse.json({ ok: true, people: [] })

      let sel = sb.from('employees')
        .select('id, full_name, emp_code, designation')
        .neq('id', me)
        .is('date_of_leaving', null)
        .or(`full_name.ilike.*${safe}*,emp_code.ilike.*${safe}*`)
        .order('full_name')
        .limit(10)
      // Fun Zone is per company: you play with the people you work with.
      if (company) sel = sel.eq('company_id', company)

      const r = await sel
      if (r.error) return bad(r.error.message)
      return NextResponse.json({ ok: true, people: (r.data ?? []).map(x => ({
        id: String(x.id), name: String(x.full_name),
        code: x.emp_code === null ? null : String(x.emp_code),
        designation: x.designation === null ? null : String(x.designation),
      })) })
    }

    case 'send': {
      const to = str('to'), game = str('game')
      if (!to || !game) return bad('Who, and which game?')

      // The recipient has to be a real, current colleague. Checked here rather
      // than trusted from the browser, and it also supplies company_id — the
      // invite is filed against the SENDER's company, which is the one whose
      // Fun Zone they are both playing in.
      const [{ data: them }, { data: mine }] = await Promise.all([
        sb.from('employees').select('id, full_name, date_of_leaving').eq('id', to).maybeSingle(),
        sb.from('employees').select('company_id, full_name').eq('id', me).maybeSingle(),
      ])
      if (!them) return bad('No such colleague.')
      const stillHere = !(them as { date_of_leaving?: string | null }).date_of_leaving
        || String((them as { date_of_leaving: string }).date_of_leaving) >= new Date().toISOString().slice(0, 10)

      const { rows, missing } = await invitesFor(me)
      if (missing) return bad('Fun Zone multiplayer is not installed yet (migration 090).', 503)

      // The same rules the button uses, applied again on the server. The
      // client check is a courtesy; this one is the decision.
      const verdict = canInvite(me, to, game, {
        liveGames: LIVE_GAMES.map(g => g.code),
        existing: rows,
        now: new Date().toISOString(),
        toIsActive: stillHere,
      })
      if (!verdict.ok) return bad(verdict.because)

      const ins = await sb.from('game_invites').insert({
        company_id: (mine as { company_id?: string } | null)?.company_id,
        game_code: game, from_employee: me, to_employee: to,
        message: str('message'),
      }).select('id, created_at').single()
      if (ins.error) return bad(ins.error.message)

      // THE PART THAT WAS MISSING. Worded by inviteLine so the notification
      // and the Fun Zone card say the same thing, which is what it was
      // written for.
      const line = inviteLine(
        { id: String(ins.data.id), gameCode: game, fromId: me, toId: to,
          fromName: (mine as { full_name?: string } | null)?.full_name ?? null,
          toName: null, status: 'PENDING',
          createdAt: String(ins.data.created_at), message: null },
        gameByCode(game)?.name ?? 'a game',
      )
      await notify(to, line,
        'It is good for fifteen minutes. Open Fun Zone → Play together to join.',
        '/ess?tab=funzone', 'FUNZONE')

      return NextResponse.json({ ok: true, id: ins.data.id })
    }

    case 'accept': {
      const id = str('id')
      if (!id) return bad('Which invite?')

      // Checked here so the player gets the real reason — expired, already
      // answered, not theirs — instead of the not-null violation the raw
      // function produced when the actor was missing.
      const { rows } = await invitesFor(me)
      const inv = rows.find(i => i.id === id)
      if (!inv) return bad('That invite is not yours.', 403)

      // "This invite was not sent to you" is true and useless on its own,
      // because the interesting question is WHO THE SERVER THINKS YOU ARE.
      // The list is drawn from the session identity now, so reaching this at
      // all means the two disagree — say so, and name both people, rather
      // than leaving somebody staring at an invite with their own name on it.
      if (inv.toId !== me) {
        const { data: who } = await sb.from('employees')
          .select('id, full_name').in('id', [me, inv.toId])
        const nameOf = (id: string) =>
          ((who ?? []) as { id: string; full_name: string }[]).find(e => e.id === id)?.full_name
        return bad(
          `This invite was sent to ${nameOf(inv.toId) ?? 'somebody else'}, `
          + `and you are signed in as ${nameOf(me) ?? 'another employee'}. `
          + `If that is not who you expected, you are looking at a colleague's portal — `
          + `open your own to accept invites addressed to you.`, 403)
      }

      const v = canAccept(inv, me, new Date().toISOString())
      if (!v.ok) return bad(v.because)

      const r = await sb.rpc('accept_game_invite_as', { p_actor: me, p_invite: id })
      if (r.error) {
        if (r.error.code === 'PGRST202') {
          return bad('Fun Zone multiplayer is not fully installed yet (migration 096). '
                   + 'Ask your administrator to run it.', 503)
        }
        return bad(r.error.message)
      }
      return NextResponse.json({ ok: true, session: r.data })
    }

    case 'answer': {
      const id = str('id')
      const status = (str('status') ?? '').toUpperCase()
      if (!id) return bad('Which invite?')
      if (status !== 'DECLINED' && status !== 'CANCELLED') return bad('Decline or cancel?')

      // This used to be a bare client UPDATE with no ownership test at all —
      // anybody could decline anybody's invite. Only the recipient may
      // decline, only the sender may cancel.
      const { rows } = await invitesFor(me)
      const inv = rows.find(i => i.id === id)
      if (!inv) return bad('That invite is not yours.', 403)
      const now = new Date().toISOString()
      const v = status === 'DECLINED' ? canDecline(inv, me, now) : canCancel(inv, me, now)
      if (!v.ok) return bad(v.because)

      const up = await sb.from('game_invites')
        .update({ status, answered_at: now }).eq('id', id)
      if (up.error) return bad(up.error.message)

      // Tell the other side, so a cancelled invite does not sit on their
      // screen looking live until it expires.
      if (status === 'CANCELLED') {
        await notify(inv.toId, 'A game invite was withdrawn',
          `${inv.fromName ?? 'A colleague'} cancelled the invite.`, '/ess?tab=funzone', 'FUNZONE')
      } else {
        await notify(inv.fromId, 'Your game invite was declined',
          `${inv.toName ?? 'They'} cannot play just now.`, '/ess?tab=funzone', 'FUNZONE')
      }
      return NextResponse.json({ ok: true })
    }

    case 'finish': {
      const session = str('session')
      if (!session) return bad('Which game?')
      const r = await sb.rpc('finish_game_as', {
        p_actor: me, p_session: session,
        p_moves: body.moves ?? [], p_claim: body.claim ?? null,
      })
      return r.error ? bad(r.error.message) : NextResponse.json({ ok: true, data: r.data })
    }

    case 'share': {
      const session = str('session')
      if (!session) return bad('Which game?')
      const withWho = Array.isArray(body.with) ? (body.with as string[]) : []
      const r = await sb.rpc('share_game_score_as', {
        p_actor: me, p_session: session, p_with: withWho, p_note: str('note'),
      })
      return r.error ? bad(r.error.message) : NextResponse.json({ ok: true, data: r.data })
    }

    default:
      return bad(`Unknown action '${action}'.`)
  }
}
