-- =====================================================================
-- 096_funzone_actor_wrappers.sql — make Fun Zone multiplayer work
--
-- THE PROBLEM, WHICH IS 094's PROBLEM AGAIN
--
-- All three multiplayer functions in 090 identify the caller with
--
--     funzone_current_employee()   -- current_setting('app.current_employee_id')
--
-- the same setting the wall used, and it cannot be established through
-- PostgREST: set_config lives in pg_catalog and is not exposed, and it is
-- transaction-scoped while PostgREST runs one transaction per request.
--
-- So the actor is null on every call the browser makes, and the whole of
-- multiplayer is broken. Measured against the live database on 4 Sep:
--
--   accept_game_invite  the ownership test `v_inv.to_employee <> v_me` is
--                       NULL when v_me is NULL, so it does NOT fire — the
--                       function carries on and dies further down on
--                       game_sessions.guest_employee being NOT NULL. The
--                       player sees a raw not-null violation, and the reason
--                       they cannot join is never stated.
--   finish_game         same null actor; the result is recorded against
--                       nobody.
--   share_game_score    `v_me not in (host, guest)` is NULL when v_me is
--                       NULL, so the "you were not in this game" guard does
--                       not fire either.
--
-- Both of those guards FAIL OPEN. Nothing is exploitable today — the NOT NULL
-- constraint stops the first and there is nothing to gain from the second —
-- but neither is refusing for the reason it looks like it is refusing, and a
-- later schema change could remove the accident that saves them.
--
-- THE FIX
--
-- Same shape as 094, which is already applied: a thin *_as wrapper per
-- function. A wrapper and its inner call share a transaction, so
-- set_config(..., is_local => true) inside the wrapper reaches the inner call
-- and nothing else. 090's functions are left exactly as applied.
--
-- The actor helper is wof_act_as(uuid) from 094. It is not wall-specific
-- despite the name — it validates that the id belongs to an active employee
-- and sets app.current_employee_id for the transaction, which is precisely
-- what is needed here. A second copy under a funzone name would be the same
-- duplication that made wof_explain_access drift from wof_can (see 095), so
-- there is one implementation and this file depends on it.
--
-- SERVER ONLY. Each wrapper takes the actor as an argument, so they are
-- revoked from anon and authenticated and granted to service_role alone. The
-- app calls them through /api/ess/funzone, which resolves the player from
-- their session. A wrapper reachable from the browser would let anyone accept
-- anyone's invite and post any score.
--
-- The originals are revoked from anon too. They have never worked from the
-- browser — every call returned an error — so nothing that works today stops
-- working, and it closes the two fail-open guards above to outside callers.
--
-- DEPENDS ON 090 and 094. SAFE TO RUN TWICE.
-- =====================================================================

create or replace function accept_game_invite_as(p_actor uuid, p_invite uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return accept_game_invite(p_invite);
end $$;

create or replace function finish_game_as(
  p_actor   uuid,
  p_session uuid,
  p_moves   jsonb default '[]'::jsonb,
  p_claim   jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return finish_game(p_session, p_moves, p_claim);
end $$;

create or replace function share_game_score_as(
  p_actor   uuid,
  p_session uuid,
  p_with    uuid[] default '{}',
  p_note    text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return share_game_score(p_session, p_with, p_note);
end $$;


-- ─── SERVER ONLY ─────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'accept_game_invite_as(uuid,uuid)',
    'finish_game_as(uuid,uuid,jsonb,jsonb)',
    'share_game_score_as(uuid,uuid,uuid[],text)',
    -- the originals: never usable from the browser anyway, and both carry a
    -- guard that fails open on a null actor
    'accept_game_invite(uuid)',
    'finish_game(uuid,jsonb,jsonb)',
    'share_game_score(uuid,uuid[],text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f::regprocedure);
    execute format('grant execute on function %s to service_role', f::regprocedure);
  end loop;
end $$;

comment on function accept_game_invite_as is
  'Accepts an invite as p_actor. Service role only — the actor is taken on '
  'trust, so the trust must come from the server that resolved it.';
