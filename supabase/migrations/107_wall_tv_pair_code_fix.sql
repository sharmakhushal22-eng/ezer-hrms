-- =====================================================================
-- 107_wall_tv_pair_code_fix.sql
-- 106's pair code generator cannot run. Two functions replaced.
--
-- FOR: Nayan Ahuja. No schema change. SAFE TO RUN TWICE.
--
-- THE SYMPTOM
--
--     select pair_board_screen_as(…);
--     ERROR:  function gen_random_bytes(integer) does not exist
--
-- Granting board_operator through 106 worked on the first try. Pairing a
-- screen failed on this, which is my error in 106.
--
-- THE CAUSE
--
-- gen_random_bytes comes from pgcrypto, and on Supabase pgcrypto is installed
-- into the `extensions` schema rather than `public`. 106's functions are
-- declared `set search_path = public` — correct, and deliberately so: a
-- SECURITY DEFINER function with a loose search_path is how a caller gets to
-- decide which table you actually wrote to. But it also means pgcrypto is not
-- on the path, so the call cannot resolve.
--
-- Note gen_random_uuid() is NOT affected: it has been core Postgres since 13,
-- which is why board_screens' own id default has always worked.
--
-- THE FIX
--
-- Build the code from gen_random_uuid() instead of reaching for pgcrypto. No
-- extension, no schema qualification, nothing to get wrong on a database where
-- the extension lives somewhere else:
--
--     replace(gen_random_uuid()::text, '-', '')   -> 32 hex chars
--
-- That is 122 bits of randomness where the old line gave 96, and it is
-- URL-safe by construction rather than by stripping base64 padding. The codes
-- read differently from the one the docs/fix script would have produced —
-- hex rather than mixed case — which is cosmetic.
--
-- docs/fix/pair-gurugram-screen.sql has the same line. It may well work there,
-- because the SQL editor connects as a role whose search_path usually does
-- include extensions — but it is the same latent bug and is corrected too.
--
-- DEPENDS ON 106.
-- =====================================================================

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

  if not wof_can(p_actor, 'wof.board.manage', p_company, null) then
    raise exception 'You need Wall Administrator level board_operator or above '
                    'to pair a screen. Ask a Wall Owner to grant it.';
  end if;

  if exists (select 1 from board_screens
              where location_id = p_location and is_active) then
    raise exception 'A screen is already paired at that location. Retire it '
                    'first, or rotate its pair code instead of adding a second.';
  end if;

  -- gen_random_uuid() is core Postgres; gen_random_bytes() was pgcrypto and is
  -- not on this function's search_path. See the header.
  v_code := replace(gen_random_uuid()::text, '-', '');

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

  v_code := replace(gen_random_uuid()::text, '-', '');

  update board_screens
     set pair_code = v_code, pair_code_set_at = now()
   where id = p_screen;

  return jsonb_build_object('id', p_screen, 'pair_code', v_code,
    'note', 'The previous URL stopped working. Re-enter this on the TV.');
end $$;

-- 106 already granted these to service_role and revoked them from
-- public/anon/authenticated. CREATE OR REPLACE keeps the existing grants, so
-- there is nothing to re-issue — but re-stated here so a reader does not have
-- to go and check.
revoke all on function pair_board_screen_as(uuid, uuid, uuid, text, int, text, text, int)
  from public, anon, authenticated;
revoke all on function rotate_screen_pair_code_as(uuid, uuid) from public, anon, authenticated;
grant execute on function pair_board_screen_as(uuid, uuid, uuid, text, int, text, text, int) to service_role;
grant execute on function rotate_screen_pair_code_as(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
