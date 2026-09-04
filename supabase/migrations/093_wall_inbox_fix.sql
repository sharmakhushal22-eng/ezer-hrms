-- =====================================================================
-- 093_wall_inbox_fix.sql — get_wall_inbox() errors for every caller
--
-- 087 is applied and working apart from this one function. The Wall of Fame
-- inbox tab returns
--
--     42702: column reference "id" is ambiguous
--
-- for everybody, every time. Not a data problem and not a permission problem
-- — the function cannot run at all.
--
-- WHY
--
-- It is declared `returns table (id uuid, …)`, which makes `id` a variable in
-- scope for the whole body. Its first statement is
--
--     select company_id into v_company from employees where id = v_actor;
--
-- and that `id` is unqualified, so Postgres cannot tell the employees column
-- from the OUT parameter. It fails before reaching the permission check, which
-- is why the error is identical for an admin and for a stranger.
--
-- Every other `id` in the function is already table-qualified. This is the
-- one that was missed, and it is the kind of thing that only shows up when
-- the function is actually called — the migration applies perfectly.
--
-- THE FIX is to alias the table. Nothing else in the body changes.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

create or replace function get_wall_inbox(
  p_filter text default 'all',
  p_limit  int  default 30,
  p_before timestamptz default null
) returns table (
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
language plpgsql stable
as $$
declare v_actor uuid := wof_current_employee(); v_company uuid;
begin
  -- ALIASED. `where id = v_actor` was ambiguous against the OUT parameter of
  -- the same name, and took the whole function down before the guard below.
  select me.company_id into v_company
    from employees me where me.id = v_actor;

  if not wof_can(v_actor, 'wof.inbox.view', v_company) then
    return;
  end if;

  return query
  select
    e.id, e.event_type, e.is_read, e.created_at,
    e.actor_id, a.full_name, a.emp_code, a.designation, ab.location_name,
    e.preview,
    coalesce(m.body, c.body, r.message),
    cat.label, cat.glyph,
    e.recognition_id, e.comment_id, e.message_id,
    (e.event_type = 'appreciation' and mr.thanked_at is null),
    (e.event_type = 'appreciation' and m.share_state = 'private')
  from wall_inbox_events e
  left join employees a  on a.id = e.actor_id
  left join locations  ab on ab.id = a.location_id
  left join wall_messages m on m.id = e.message_id
  left join wall_message_recipients mr
         on mr.message_id = e.message_id and mr.employee_id = v_actor
  left join recognition_comments c on c.id = e.comment_id
  left join recognitions r on r.id = e.recognition_id
  left join shoutout_categories cat on cat.id = coalesce(m.category_id, r.category_id)
  where e.employee_id = v_actor
    and (p_before is null or e.created_at < p_before)
    and (
      p_filter = 'all'
      or (p_filter = 'unread'       and e.is_read = false)
      or (p_filter = 'appreciation' and e.event_type in
            ('appreciation','recognised','thanked_back','share_request'))
      or (p_filter = 'comments'     and e.event_type in ('commented','mentioned'))
      or (p_filter = 'replies'      and e.event_type = 'replied')
    )
  order by e.created_at desc
  limit least(p_limit, 50);
end $$;

comment on function get_wall_inbox(text, int, timestamptz) is
  'Fixed in 093: the first statement''s unqualified `id` was ambiguous against '
  'the OUT parameter of the same name, so the function raised 42702 for every '
  'caller before reaching its permission check.';
