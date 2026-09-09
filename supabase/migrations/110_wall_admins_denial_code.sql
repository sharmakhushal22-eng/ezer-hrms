-- =====================================================================
-- 110_wall_admins_denial_code.sql
-- A denial that reads as a bad request. One word.
--
-- FOR: Nayan Ahuja. One function replaced. NO SCHEMA CHANGE.
-- SAFE TO RUN TWICE.
--
-- THE SYMPTOM
--
--   POST /api/ess/wall  { action: 'list_wall_admins' }   as a board_operator
--   -> 400  "You need Wall Administrator rights to see who else holds them."
--
-- The sentence is right and the refusal is right. The status is not: 400 says
-- the caller sent something malformed, when in fact they asked a perfectly
-- well-formed question and were told no. A client cannot tell "fix your
-- request" from "you may not do this", which is the distinction a screen needs
-- to decide between showing an error and showing a locked panel with a reason.
--
-- THE CAUSE
--
-- app/api/ess/wall/route.ts maps SQLSTATE 42501 to 403 and everything else to
-- 400. 106 raised this particular exception without `using errcode`, so it
-- carried plpgsql's default P0001 and fell into the 400 bucket. 108 corrected
-- exactly this for pair_board_screen_as and list_board_screens_as; this one
-- was missed, and only turned up when the regression asked every action on the
-- route what it answers.
--
-- Nothing else about the function changes. The body below is 106's.
--
-- DEPENDS ON 106.
-- =====================================================================

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
    raise exception 'You need Wall Administrator rights to see who else holds them.'
      using errcode = '42501';
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

notify pgrst, 'reload schema';
