-- =====================================================================
-- 106_wall_of_fame_tv.sql — "Wall of Fame TV"
-- Make screen pairing and admin grants reachable from the app
--
-- FOR: Nayan Ahuja. Seven new functions, no schema change — no new table,
-- no new column, no new enum. Nothing here needs an RLS decision.
--
-- WHY THIS EXISTS
--
-- Two Wall of Fame jobs can only be done by hand in the SQL editor today:
-- pairing a TV, and granting somebody Wall Administrator rights. Both fail
-- over the API for the same reason 094 documented:
--
--     select grant_wall_admin('…','board_operator','…');
--     ERROR:  Only a Wall Owner can grant Wall Administrator rights.  [42501]
--
--     insert into board_screens (…);
--     ERROR:  Wall of Fame: no acting employee in session.
--             Set app.current_employee_id.                            [42501]
--
-- Both read the actor from app.current_employee_id. set_config lives in
-- pg_catalog, which PostgREST does not expose, and it is transaction-scoped
-- while PostgREST runs one transaction per request — so the setting never
-- survives to the call that needs it. A SERVICE ROLE KEY DOES NOT HELP: it
-- changes which database role connects, not app.current_employee_id.
--
-- 094 solved this for the thirteen everyday wall functions by wrapping each
-- one so the set_config and the call happen in the SAME transaction. It did
-- not cover these two, because at the time nothing needed them. Now the
-- Gurugram TV does.
--
-- WHAT CHANGES FOR YOU
--
-- After this runs, pairing a screen and granting board_operator stop being
-- SQL-editor errands. docs/fix/pair-gurugram-screen.sql and
-- docs/fix/grant-manoj-board-operator.sql still work if you prefer them —
-- this adds a second route, it does not remove the first.
--
-- IT ALSO CLOSES A HOLE. grant_wall_admin and revoke_wall_admin are currently
-- executable by anon. Their own actor check is what stops abuse, so this is
-- not exploitable as it stands — but it is one bug away from being so, and
-- Postgres grants EXECUTE to PUBLIC by default, which is why they were never
-- locked. Revoking from anon alone does NOT remove that; the grant lives on
-- PUBLIC. See the bottom of this file.
--
-- DEPENDS ON 084 and 094. SAFE TO RUN TWICE.
-- =====================================================================


-- ─── Screens ────────────────────────────────────────────────────────

-- One physical TV. Returns the id AND the pair code, because the code is the
-- only thing that gets typed into the TV and it is never recoverable from the
-- UI later by design — rotate it if it is lost.
create or replace function pair_board_screen_as(
  p_actor        uuid,
  p_company      uuid,
  p_location     uuid,
  p_screen_name  text,
  p_rotate_secs  int  default 10,
  p_language     text default 'en',
  p_scope        text default 'branch',
  p_max_slides   int  default 12)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid;
begin
  perform wof_act_as(p_actor);

  -- Checked here as well as by the table's trigger, so the caller gets a
  -- sentence rather than a constraint violation.
  if not wof_can(p_actor, 'wof.board.manage', p_company, null) then
    raise exception 'You need Wall Administrator level board_operator or above '
                    'to pair a screen. Ask a Wall Owner to grant it.';
  end if;

  if exists (select 1 from board_screens
              where location_id = p_location and is_active) then
    raise exception 'A screen is already paired at that location. Retire it '
                    'first, or rotate its pair code instead of adding a second.';
  end if;

  -- base64url of 12 random bytes: ~72 bits, unguessable, and safe in a URL
  -- without escaping. This IS the security boundary for /board/<code>.
  v_code := rtrim(replace(replace(encode(gen_random_bytes(12), 'base64'),
                                  '+', '-'), '/', '_'), '=');

  insert into board_screens
    (company_id, location_id, screen_name, pair_code,
     rotate_seconds, language, scope, max_slides, created_by)
  values
    (p_company, p_location, p_screen_name, v_code,
     p_rotate_secs, p_language, p_scope, p_max_slides, p_actor)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'pair_code', v_code,
    'note', 'Treat the pair code as a password — anyone holding it can watch '
         || 'the board.');
end $$;


-- Rotate the code. This is the "the TV was moved / the code leaked" button;
-- the old URL stops working the moment this returns.
create or replace function rotate_screen_pair_code_as(
  p_actor uuid, p_screen uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text; v_company uuid;
begin
  perform wof_act_as(p_actor);

  select company_id into v_company from board_screens where id = p_screen;
  if not found then raise exception 'No such screen'; end if;

  if not wof_can(p_actor, 'wof.board.manage', v_company, null) then
    raise exception 'You need Wall Administrator level board_operator or above '
                    'to rotate a pair code.';
  end if;

  v_code := rtrim(replace(replace(encode(gen_random_bytes(12), 'base64'),
                                  '+', '-'), '/', '_'), '=');

  update board_screens
     set pair_code = v_code, pair_code_set_at = now()
   where id = p_screen;

  return jsonb_build_object('id', p_screen, 'pair_code', v_code,
    'note', 'The previous URL stopped working. Re-enter this on the TV.');
end $$;


-- Retire or bring back a screen. Deliberately not a delete: the row carries
-- who paired it and when it was last seen, which is the only record that a
-- TV in a reception area was ever showing staff names.
create or replace function set_screen_active_as(
  p_actor uuid, p_screen uuid, p_active boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  perform wof_act_as(p_actor);

  select company_id into v_company from board_screens where id = p_screen;
  if not found then raise exception 'No such screen'; end if;

  if not wof_can(p_actor, 'wof.board.manage', v_company, null) then
    raise exception 'You need Wall Administrator level board_operator or above '
                    'to retire or restore a screen.';
  end if;

  update board_screens set is_active = p_active where id = p_screen;
  return jsonb_build_object('id', p_screen, 'is_active', p_active);
end $$;


-- The Screens panel. The pair code is NOT returned: a screen list is a
-- reasonable thing to show, handing out every board URL is not. Rotate to
-- get a fresh code if one is genuinely needed.
create or replace function list_board_screens_as(
  p_actor uuid, p_company uuid default null)
returns table (
  id             uuid,
  screen_name    text,
  location_name  text,
  scope          text,
  rotate_seconds int,
  language       text,
  max_slides     int,
  is_active      boolean,
  paired_on      timestamptz,
  code_set_at    timestamptz,
  last_seen_at   timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);

  if not wof_can(p_actor, 'wof.board.manage', p_company, null) then
    raise exception 'You need Wall Administrator level board_operator or above '
                    'to see the screens.';
  end if;

  return query
    select s.id, s.screen_name, l.location_name, s.scope, s.rotate_seconds,
           s.language, s.max_slides, s.is_active, s.created_at,
           s.pair_code_set_at, s.last_seen_at
      from board_screens s
      join locations l on l.id = s.location_id
     where (p_company is null or s.company_id = p_company)
     order by l.location_name, s.screen_name;
end $$;


-- ─── Administrators ─────────────────────────────────────────────────

-- 084's grant_wall_admin already refuses a caller who is not a Wall Owner and
-- refuses self-granting. This only supplies the actor it could not see.
create or replace function grant_wall_admin_as(
  p_actor        uuid,
  p_employee     uuid,
  p_level        text,
  p_reason       text,
  p_branch       uuid default null,
  p_valid_until  date default null)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  return grant_wall_admin(
           p_employee    => p_employee,
           p_level       => p_level,
           p_reason      => p_reason,
           p_branch      => p_branch,
           p_valid_until => p_valid_until);
end $$;


create or replace function revoke_wall_admin_as(
  p_actor uuid, p_grant_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  perform revoke_wall_admin(p_grant_id => p_grant_id, p_reason => p_reason);
end $$;


-- What the Administrators panel already shows, but reachable with an actor so
-- it can stop being a read-only list nobody can act on.
create or replace function list_wall_admins_as(
  p_actor uuid, p_company uuid default null)
returns table (
  grant_id     uuid,
  employee_id  uuid,
  emp_code     text,
  full_name    text,
  admin_level  text,
  granted_at   timestamptz,
  grant_reason text,
  valid_until  date)
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);

  if not wof_can(p_actor, 'wof.admin.grant', p_company, null)
     and not wof_can(p_actor, 'wof.configure', p_company, null) then
    raise exception 'You need Wall Administrator rights to see who else holds them.';
  end if;

  return query
    select a.id, e.id, e.emp_code, e.full_name, a.admin_level,
           a.granted_at, a.grant_reason, a.valid_until
      from wall_admins a
      join employees e on e.id = a.employee_id
     where a.revoked_at is null
       and (p_company is null or a.company_id = p_company)
     order by a.granted_at;
end $$;


-- ─── Grants ─────────────────────────────────────────────────────────
--
-- Every function above is SECURITY DEFINER and takes the actor as a
-- parameter. A browser-reachable role holding them could pair a screen or
-- grant wall rights AS ANYBODY, so they go to service_role only and the app
-- resolves the employee from a signed session before calling.
--
-- Postgres grants EXECUTE to PUBLIC on every new function by default, and
-- revoking from anon alone does NOT remove it — the grant lives on PUBLIC.
-- That is why each line below names public first.

revoke all on function pair_board_screen_as(uuid, uuid, uuid, text, int, text, text, int)
  from public, anon, authenticated;
revoke all on function rotate_screen_pair_code_as(uuid, uuid) from public, anon, authenticated;
revoke all on function set_screen_active_as(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function list_board_screens_as(uuid, uuid) from public, anon, authenticated;
revoke all on function grant_wall_admin_as(uuid, uuid, text, text, uuid, date)
  from public, anon, authenticated;
revoke all on function revoke_wall_admin_as(uuid, uuid, text) from public, anon, authenticated;
revoke all on function list_wall_admins_as(uuid, uuid) from public, anon, authenticated;

grant execute on function pair_board_screen_as(uuid, uuid, uuid, text, int, text, text, int) to service_role;
grant execute on function rotate_screen_pair_code_as(uuid, uuid) to service_role;
grant execute on function set_screen_active_as(uuid, uuid, boolean) to service_role;
grant execute on function list_board_screens_as(uuid, uuid) to service_role;
grant execute on function grant_wall_admin_as(uuid, uuid, text, text, uuid, date) to service_role;
grant execute on function revoke_wall_admin_as(uuid, uuid, text) to service_role;
grant execute on function list_wall_admins_as(uuid, uuid) to service_role;

-- The two underlying functions, which anon can currently execute. Their own
-- actor check is what has been protecting them; this makes that a second line
-- of defence rather than the only one. The SQL-editor scripts are unaffected —
-- those run as a superuser role, which these revokes do not touch.
revoke all on function grant_wall_admin(uuid, text, text, uuid, date)
  from public, anon, authenticated;
revoke all on function revoke_wall_admin(uuid, text) from public, anon, authenticated;
grant execute on function grant_wall_admin(uuid, text, text, uuid, date) to service_role;
grant execute on function revoke_wall_admin(uuid, text) to service_role;

-- wof_can is deliberately NOT revoked. components/wall/AdminConsole.tsx calls
-- it from the browser with the anon key to decide what to unlock, and taking
-- it away would lock the console for everybody.

notify pgrst, 'reload schema';
