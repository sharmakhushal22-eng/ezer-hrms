-- ════════════════════════════════════════════════════════════════════════════
-- 101 — board screens become writable (the Screens tab's "Add"/manage path)
--
-- board_screens carries a BEFORE trigger enforce_wall_admin('wof.board.manage')
-- that reads the session actor. PostgREST cannot set that actor, so the app's
-- Screens tab is read-only. These wrappers follow the exact 094/096 pattern:
-- each sets the actor for its own transaction via wof_act_as(), then does the
-- write, so the guard sees a real administrator. They take the actor as an
-- ARGUMENT and are service-role only — the server route (app/api/ess/wall)
-- resolves who is asking from the session and never trusts a client-supplied id.
--
-- pgcrypto (gen_random_bytes) is schema-qualified to `extensions` — it is not on
-- the default search_path here. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── create + pair a screen ──────────────────────────────────────────────────
create or replace function create_board_screen_as(
  p_actor    uuid,
  p_location uuid,
  p_name     text,
  p_rotate   int  default 8,
  p_scope    text default 'branch'
) returns board_screens
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_code text; v_row board_screens;
begin
  perform wof_act_as(p_actor);
  select company_id into v_company from locations where id = p_location;
  if v_company is null then raise exception 'Unknown location %', p_location; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'A screen name is required'; end if;

  -- a short, unique, human-typeable pair code
  loop
    v_code := upper(regexp_replace(encode(extensions.gen_random_bytes(6), 'base64'), '[^A-Za-z0-9]', '', 'g'));
    v_code := substr(v_code, 1, 6);
    exit when length(v_code) = 6 and not exists (select 1 from board_screens where pair_code = v_code);
  end loop;

  insert into board_screens (company_id, location_id, screen_name, pair_code, rotate_seconds, scope, created_by)
  values (v_company, p_location, btrim(p_name), v_code,
          greatest(5, least(120, coalesce(p_rotate, 8))),
          coalesce(p_scope, 'branch'), p_actor)
  returning * into v_row;
  return v_row;
end $$;

-- ── activate / deactivate ─────────────────────────────────────────────────────
create or replace function set_board_screen_active_as(p_actor uuid, p_screen uuid, p_active boolean)
returns board_screens
language plpgsql security definer set search_path = public as $$
declare v_row board_screens;
begin
  perform wof_act_as(p_actor);
  update board_screens set is_active = coalesce(p_active, true) where id = p_screen returning * into v_row;
  if v_row.id is null then raise exception 'No screen %', p_screen; end if;
  return v_row;
end $$;

-- ── rotate the pair code (invalidates the old one) ────────────────────────────
create or replace function rotate_board_pair_code_as(p_actor uuid, p_screen uuid)
returns board_screens
language plpgsql security definer set search_path = public as $$
declare v_code text; v_row board_screens;
begin
  perform wof_act_as(p_actor);
  loop
    v_code := substr(upper(regexp_replace(encode(extensions.gen_random_bytes(6), 'base64'), '[^A-Za-z0-9]', '', 'g')), 1, 6);
    exit when length(v_code) = 6 and not exists (select 1 from board_screens where pair_code = v_code);
  end loop;
  update board_screens set pair_code = v_code, pair_code_set_at = now() where id = p_screen returning * into v_row;
  if v_row.id is null then raise exception 'No screen %', p_screen; end if;
  return v_row;
end $$;

-- ── remove a screen ───────────────────────────────────────────────────────────
create or replace function delete_board_screen_as(p_actor uuid, p_screen uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform wof_act_as(p_actor);
  delete from board_screens where id = p_screen;
  return found;
end $$;

-- Service role only — the actor is an argument, so the browser must never reach these.
do $$
declare f text;
begin
  foreach f in array array[
    'create_board_screen_as(uuid,uuid,text,int,text)',
    'set_board_screen_active_as(uuid,uuid,boolean)',
    'rotate_board_pair_code_as(uuid,uuid)',
    'delete_board_screen_as(uuid,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

select 'board screen wrappers ready' as result;
