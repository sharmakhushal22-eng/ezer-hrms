-- =====================================================================
-- 108_wall_tv_board_payload_volatile.sql
-- The TV board has never rendered. One word.
--
-- FOR: Nayan Ahuja. One function replaced, plus two error codes corrected.
-- NO SCHEMA CHANGE. SAFE TO RUN TWICE.
--
-- THE SYMPTOM
--
--     select get_board_payload('<a real pair code>');
--     ERROR:  UPDATE is not allowed in a non-volatile function
--
-- An invalid code answers correctly ("screen not found or inactive"). A VALID
-- one throws. So the board has never worked for a paired screen — this went
-- unnoticed because until today no screen had ever been paired.
--
-- THE CAUSE — 084, not 106 or 107
--
-- 084:891 declares the function `stable`, and 084:931 does
--
--     update board_screens set last_seen_at = now() where id = s.id;
--
-- which is a heartbeat, so the Screens panel can show when a TV last called
-- home. Postgres refuses any write inside a non-volatile function, and the
-- refusal happens at execution, so nothing complained at install time.
--
-- The comment above it reads "so it is read-only" — that was the intent, and
-- the last_seen_at write is the line that quietly broke it. This keeps the
-- heartbeat and drops `stable`; volatile is the default and the honest
-- description of a function that writes.
--
-- The body below is 084's, byte for byte, with that one word changed.
--
-- ALSO IN HERE: two error codes.
--
-- 106's permission failures raise with the default P0001, and the wall route
-- maps only 42501 to a 403 — so a colleague refused the Screens panel got a
-- 400 with the right sentence in it. The refusal always worked; only the
-- status was wrong. Corrected so a denial reads as a denial.
--
-- DEPENDS ON 084, 106, 107.
-- =====================================================================

create or replace function get_board_payload(p_pair_code text)
returns jsonb language plpgsql volatile as $$
declare s board_screens%rowtype; v_cfg wall_config%rowtype; v_out jsonb;
begin
  select * into s from board_screens where pair_code = p_pair_code and is_active;
  if s.id is null then
    return jsonb_build_object('error','screen not found or inactive');
  end if;

  select * into v_cfg from wall_config where company_id = s.company_id;
  if not v_cfg.module_enabled or not v_cfg.board_enabled then
    return jsonb_build_object('error','board disabled for this company');
  end if;

  select jsonb_build_object(
    'screen', jsonb_build_object('name', s.screen_name, 'rotate_seconds', s.rotate_seconds,
                                 'language', s.language, 'slide_types', s.slide_types),
    'company', (select jsonb_build_object('name', c.company_name) from companies c where c.id = s.company_id),
    'slides', coalesce((
      select jsonb_agg(x order by x.published_at desc)
      from (
        select r.id, r.published_at, r.message as citation, r.message_hi as citation_hi,
               a.name as award, a.badge_code, r.cycle_label,
               e.full_name, e.emp_code, e.designation,
               d.dept_name, b.location_name, e.company_doj, e.photo_url,
               eb.tier as badge_tier, eb.earned_count as badge_count
          from recognitions r
          join recognition_awards a on a.id = r.award_id and a.show_on_board
          join employees e on e.id = any(r.receiver_employee_ids)
          left join departments d on d.id = e.department_id
          left join locations b on b.id = e.location_id
          left join employee_badges eb on eb.employee_id = e.id and eb.badge_code = a.badge_code
         where r.company_id = s.company_id
           and r.is_archived = false
           and (s.scope = 'company' or e.location_id = s.location_id)
           and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
         order by r.published_at desc
         limit s.max_slides
      ) x), '[]'::jsonb)
  ) into v_out;

  update board_screens set last_seen_at = now() where id = s.id;
  return v_out;
end $$;

-- ─── The two permission raises, with the code the route expects ──────
--
-- Only the errcode changes. Both functions are otherwise 107's.

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
                    'to pair a screen. Ask a Wall Owner to grant it.'
      using errcode = '42501';
  end if;

  if exists (select 1 from board_screens
              where location_id = p_location and is_active) then
    raise exception 'A screen is already paired at that location. Retire it '
                    'first, or rotate its pair code instead of adding a second.';
  end if;

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
                    'to see the screens.'
      using errcode = '42501';
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

revoke all on function pair_board_screen_as(uuid, uuid, uuid, text, int, text, text, int)
  from public, anon, authenticated;
revoke all on function list_board_screens_as(uuid, uuid) from public, anon, authenticated;
grant execute on function pair_board_screen_as(uuid, uuid, uuid, text, int, text, text, int) to service_role;
grant execute on function list_board_screens_as(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
