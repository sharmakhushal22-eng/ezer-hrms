-- =====================================================================
-- 094_wall_actor_wrappers.sql — give the wall functions a caller
--
-- THE PROBLEM
--
-- Twenty functions across 084, 086, 087 and 089 identify the caller with
--
--     v_actor uuid := wof_current_employee();
--
-- which reads the session setting app.current_employee_id. That setting can
-- never be established through PostgREST:
--
--   * set_config() lives in pg_catalog and is not exposed over the API, so
--     the client cannot call it — lib/wall/access.ts tries, and gets
--     "Could not find the function public.set_config".
--   * It is transaction-scoped anyway, and PostgREST runs ONE TRANSACTION PER
--     REQUEST. Even if it were exposed, setting it in one request and reading
--     it in the next could not work.
--
-- So wof_current_employee() returns null for every call the app makes. The
-- gate fails CLOSED — wof_can(null, …) is false for every permission,
-- including wof.admin.grant — so this is a functionality gap and not a
-- security hole. But shoutouts, comments, appreciation and the whole wall
-- inbox are inert.
--
-- THE FIX, AND WHY IT IS A WRAPPER RATHER THAN A NEW PARAMETER
--
-- A wrapper and the function it calls run in the SAME transaction, so
-- set_config(..., is_local => true) inside the wrapper is visible to the
-- inner call and to nothing else. One statement, no duplicated logic, and
-- 084/086/087/089 are left exactly as applied.
--
-- Adding p_actor to the originals instead would mean DROP and CREATE for each
-- — Postgres cannot change a signature in place — which means copying several
-- hundred lines of body into this file, where they would drift from the
-- originals the first time somebody fixed a rule in one and not the other.
--
-- THESE ARE SERVER-ONLY, AND THAT IS THE WHOLE SECURITY MODEL
--
-- Every wrapper takes the actor as an argument, so anyone who can call one
-- can act as anybody. That is safe only because they are revoked from anon
-- and authenticated at the bottom of this file and granted to service_role
-- alone.
--
-- The wall components currently call Supabase DIRECTLY FROM THE BROWSER with
-- the anon key. They must move behind API routes that resolve the caller with
-- essRoute() and hold the service key, exactly as the ESS inbox already does.
-- Granting these to anon would be worse than the bug they fix: today an
-- unidentified caller is refused, and with an open wrapper any employee could
-- post as any other.
--
-- DEPENDS ON 084, 086, 087, 089. Run after 093.
-- SAFE TO RUN TWICE.
-- =====================================================================


-- ─── the one line that does the work ─────────────────────────────────
-- Kept as its own function so every wrapper below states the same intent,
-- and so the validity check lives in one place rather than thirteen.
create or replace function wof_act_as(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  if p_actor is null then
    raise exception 'An actor is required. The caller must resolve the '
                    'employee before calling a wall function.';
  end if;

  select true into v_ok from employees
   where id = p_actor and (date_of_leaving is null or date_of_leaving >= current_date);
  if not found then
    -- A stale or invented id must not become a valid actor. Somebody who has
    -- left keeps their history and loses their voice.
    raise exception 'Employee % is not an active employee', p_actor;
  end if;

  -- is_local => true. Transaction scoped, so it applies to the inner call in
  -- this same transaction and to nothing afterwards. A connection-scoped
  -- setting would leak between requests on a pooled connection, which on a
  -- shared pool means acting as whoever used the connection last.
  perform set_config('app.current_employee_id', p_actor::text, true);
end $$;


-- ─── reads ───────────────────────────────────────────────────────────

-- NOT declared stable, and it cannot be: it calls wof_act_as(), which calls
-- set_config(), and Postgres refuses a volatile call inside a stable function.
-- The inner get_wall_inbox() stays stable; only this shell is volatile.
--
-- The columns are spelled out rather than `returns setof record` — PostgREST
-- has no way to name the columns of an anonymous record, so a record-returning
-- function is uncallable over the API.
create or replace function get_wall_inbox_as(
  p_actor  uuid,
  p_filter text default 'all',
  p_limit  int  default 30,
  p_before timestamptz default null)
returns table (
  id            uuid,
  event_type    text,
  is_read       boolean,
  created_at    timestamptz,
  actor_id      uuid,
  actor_name    text,
  actor_code    text,
  actor_designation text,
  actor_branch  text,
  preview       text,
  body          text,
  category_label text,
  category_glyph text,
  recognition_id uuid,
  comment_id    uuid,
  message_id    uuid,
  can_thank     boolean,
  can_request_share boolean
)
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return query select * from get_wall_inbox(p_filter, p_limit, p_before);
end $$;

create or replace function get_inbox_counts_as(p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return get_inbox_counts();
end $$;

create or replace function get_company_feed_as(
  p_actor    uuid,
  p_scope    text default 'company',
  p_category text default null,
  p_kind     text default null,
  p_limit    int  default 20,
  p_before   timestamptz default null)
returns setof v_company_feed
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return query select * from get_company_feed(p_scope, p_category, p_kind, p_limit, p_before);
end $$;

create or replace function get_feed_stats_as(p_actor uuid, p_company uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return get_feed_stats(p_company);
end $$;


-- ─── writes ──────────────────────────────────────────────────────────

create or replace function create_shoutout_as(
  p_actor      uuid,
  p_receivers  uuid[],
  p_category   text,
  p_message    text,
  p_value_ids  uuid[] default '{}',
  p_visibility text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  -- 086's five-argument version, which is the one the composer calls. 084
  -- also defines a four-argument create_shoutout; naming every parameter
  -- keeps this call off the older overload.
  return create_shoutout(
    p_receivers  => p_receivers,
    p_category   => p_category,
    p_message    => p_message,
    p_value_ids  => p_value_ids,
    p_visibility => p_visibility);
end $$;

create or replace function add_comment_as(
  p_actor       uuid,
  p_recognition uuid,
  p_body        text,
  p_parent      uuid default null,
  p_mentions    uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return add_comment(p_recognition, p_body, p_parent, p_mentions);
end $$;

create or replace function send_appreciation_as(
  p_actor      uuid,
  p_receivers  uuid[],
  p_category   text,
  p_body       text,
  p_related    uuid default null,
  p_also_post  boolean default false,
  p_visibility text default 'company')
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return send_appreciation(p_receivers, p_category, p_body, p_related,
                           p_also_post, p_visibility);
end $$;

create or replace function thank_for_appreciation_as(
  p_actor uuid, p_message uuid, p_body text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  perform thank_for_appreciation(p_message, p_body);
end $$;

create or replace function thank_back_as(p_actor uuid, p_recognition uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  perform thank_back(p_recognition);
end $$;

create or replace function mark_inbox_read_as(p_actor uuid, p_ids uuid[] default null)
returns int
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return mark_inbox_read(p_ids);
end $$;

create or replace function request_share_to_feed_as(p_actor uuid, p_message uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  perform request_share_to_feed(p_message);
end $$;

create or replace function approve_share_to_feed_as(
  p_actor uuid, p_message uuid, p_visibility text default 'company')
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return approve_share_to_feed(p_message, p_visibility);
end $$;

create or replace function set_recognition_marks_as(
  p_actor       uuid,
  p_recognition uuid,
  p_badge_ref   text default null,
  p_tag_refs    text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return set_recognition_marks(p_recognition, p_badge_ref, p_tag_refs);
end $$;


-- ─── SERVER ONLY ─────────────────────────────────────────────────────
-- The point of the whole file. Each of these accepts the actor as an
-- argument, so exposing one to the browser would let any employee act as any
-- other. They are callable by the service role and by nobody else.
-- Named explicitly rather than matched with `like '%_as'`: a pattern would
-- also strip privileges from any unrelated function whose name happens to end
-- in _as, and would silently skip a wrapper renamed later. This list fails
-- loudly if a name is wrong.
do $$
declare f text;
begin
  foreach f in array array[
    'get_wall_inbox_as(uuid,text,int,timestamptz)',
    'get_inbox_counts_as(uuid)',
    'get_company_feed_as(uuid,text,text,text,int,timestamptz)',
    'get_feed_stats_as(uuid,uuid)',
    'create_shoutout_as(uuid,uuid[],text,text,uuid[],text)',
    'add_comment_as(uuid,uuid,text,uuid,uuid[])',
    'send_appreciation_as(uuid,uuid[],text,text,uuid,boolean,text)',
    'thank_for_appreciation_as(uuid,uuid,text)',
    'thank_back_as(uuid,uuid)',
    'mark_inbox_read_as(uuid,uuid[])',
    'request_share_to_feed_as(uuid,uuid)',
    'approve_share_to_feed_as(uuid,uuid,text)',
    'set_recognition_marks_as(uuid,uuid,text,text[])'
  ]
  loop
    -- regprocedure raises if the function is not there, so a typo above or a
    -- half-applied file stops the migration rather than leaving something open.
    execute format('revoke all on function %s from public, anon, authenticated', f::regprocedure);
    execute format('grant execute on function %s to service_role', f::regprocedure);
  end loop;
end $$;

revoke all on function wof_act_as(uuid) from public, anon, authenticated;
grant execute on function wof_act_as(uuid) to service_role;

comment on function wof_act_as(uuid) is
  'Sets app.current_employee_id for the CURRENT TRANSACTION so the wall '
  'functions can identify their caller. Service role only — it takes the '
  'actor on trust, so the trust must come from the server that resolved it.';
