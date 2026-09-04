-- =====================================================================
-- pair-gurugram-screen.sql — put a wall board on a TV at Gurugram
--
-- Run in the Supabase SQL editor. A DATA change; no schema change.
--
-- WHICH GURUGRAM
--
-- There are two, in different companies, and they are not interchangeable:
--
--   fdf31b50…  Gurugram Corp Office  SRS-LOC-001  Sharma Retail Solutions
--   4d291420…  Gurugram Branch       SSM-LOC-004  Sharma Sons Manufacturing
--
-- This pairs the FIRST — Sharma Retail Solutions — because that is the
-- company Manoj Kumar Sharma belongs to and he is the intended operator.
-- Note his employees.location_id is NULL, so this was chosen from his
-- company, not from his own location record. If the screen is meant for the
-- Manufacturing office instead, swap v_location and v_company for the second
-- pair above; the rest of the script is unchanged.
--
-- WHY THE PAIR CODE IS RANDOM AND NOT WRITTEN HERE
--
-- get_board_payload(p_pair_code) is callable by anyone — it is what an
-- unauthenticated TV browser calls, so the pair code is the ONLY thing
-- protecting the board's contents. A readable code like 'SRS-GGN-01' would be
-- guessable in a few tries, and guessing it shows you the company's
-- recognition wall.
--
-- So the code is generated here, URL-safe, and printed by the script. Copy it
-- from the output. Do not commit it anywhere.
--
-- ROTATING IT LATER: update board_screens.pair_code and set
-- pair_code_set_at = now(). The old URL stops working immediately, which is
-- what you want when a screen is decommissioned or the code leaks.
--
-- WHO IT RUNS AS
--
-- board_screens carries trg_guard_screens -> enforce_wall_admin
-- ('wof.board.manage'), which reads the actor from app.current_employee_id.
-- That cannot be set over the API, so this runs as Kiran Reddy, who holds
-- wall_owner and therefore board.manage. Manoj cannot run it until
-- grant-manoj-board-operator.sql has been applied — verified today:
-- Kiran true, Manoj false.
--
-- SAFE TO RUN TWICE — it stops if a screen already exists at this location.
-- =====================================================================

do $$
declare
  v_company  uuid := 'c3eb1b50-24b5-49e0-9e60-a5a87702aab4';  -- Sharma Retail Solutions
  v_location uuid := 'fdf31b50-2e52-41d5-99cf-dfb9adede317';  -- Gurugram Corp Office
  v_actor    uuid := '358c74fb-e720-4c7d-973e-2dd2159bcc9e';  -- Kiran Reddy, wall_owner
  v_code     text;
  v_id       uuid;
begin
  if exists (select 1 from board_screens
              where location_id = v_location and is_active) then
    raise notice 'A screen is already paired at Gurugram Corp Office — nothing to do.';
    return;
  end if;

  -- URL-safe, 16 characters of real entropy. base64 uses + and / which do not
  -- survive a URL path, so both are replaced, and the = padding trimmed.
  v_code := rtrim(replace(replace(encode(gen_random_bytes(12), 'base64'),
                                  '+', '-'), '/', '_'), '=');

  -- Transaction-scoped, so the guard sees somebody entitled to add a screen
  -- and the audit trail records a person rather than nobody.
  perform set_config('app.current_employee_id', v_actor::text, true);

  insert into board_screens
    (company_id, location_id, screen_name, pair_code,
     rotate_seconds, language, scope, max_slides, created_by)
  values
    (v_company, v_location, 'Gurugram Corp Office · Reception', v_code,
     10,          -- a slide every 10 seconds; long enough to read a name
     'en',
     'branch',    -- this screen shows Gurugram's people, not the whole group
     12,
     v_actor)
  returning id into v_id;

  raise notice '────────────────────────────────────────────────';
  raise notice 'Screen paired.  id = %', v_id;
  raise notice 'PAIR CODE: %', v_code;
  raise notice 'Open on the TV:  <your app url>/board/%', v_code;
  raise notice 'Treat that URL as a password — anyone with it sees the board.';
  raise notice '────────────────────────────────────────────────';
end $$;

-- Read it back, with the code, so it can be copied without re-running.
select s.screen_name, l.location_name, s.pair_code, s.rotate_seconds,
       s.scope, s.is_active, s.created_at
  from board_screens s
  join locations l on l.id = s.location_id
 order by s.created_at;
