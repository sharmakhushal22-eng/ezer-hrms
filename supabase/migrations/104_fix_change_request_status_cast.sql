-- =====================================================================
-- 104_fix_change_request_status_cast.sql
-- raise_profile_change_request dies on its own INSERT
--
-- FOR: Nayan Ahuja. One function replaced. No schema change.
--
-- THE SYMPTOM
--
--     select raise_profile_change_request(...);
--     ERROR:  column "status" is of type profile_request_status
--             but expression is of type text                       [42804]
--     HINT:   You will need to rewrite or cast the expression.
--
-- Every profile change request fails. Not at the routing lookup — 101 fixed
-- that — but one statement later, on the INSERT itself.
--
-- THE CAUSE, WHICH IS MINE
--
-- The status column is the enum profile_request_status. The value comes from
--
--     case when route = 'payroll' then 'pending_payroll'
--          else 'pending_l1' end
--
-- and a CASE over string literals is TEXT. Postgres will happily cast an
-- unadorned literal into an enum, but not the result of an expression, so it
-- refuses rather than guessing. One ::profile_request_status fixes it.
--
-- WHY IT WAS NOT CAUGHT UNTIL NOW
--
-- profile_field_config was empty until 101, so the function raised "Field %
-- is not configured" and returned BEFORE it ever reached this line. Fixing
-- the seeding is what let execution get far enough to hit it. Two bugs in a
-- row on the same code path, the second hidden behind the first.
--
-- Everything else in the function is 091's, byte for byte.
--
-- DEPENDS ON 091 and 101. SAFE TO RUN TWICE.
-- =====================================================================

create or replace function raise_profile_change_request(
  p_employee_id uuid, p_requested_by uuid, p_field_key text,
  p_field_label text, p_new_value text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare cfg record; rid uuid; route text; old_val text; comp uuid; col text;
begin
  select company_id into comp from employees where id = p_employee_id;

  select * into cfg from profile_field_config
   where field_key = p_field_key and (company_id = comp or company_id is null)
   order by company_id nulls last limit 1;

  if not found then
    raise exception 'Field % is not configured, so there is nothing to route', p_field_key;
  end if;
  if cfg.edit_state = 'locked' then
    raise exception 'Field % is maintained by HR and cannot be requested', p_field_key;
  end if;

  route := coalesce(cfg.route_to,
           case when p_field_key like 'bank%' or p_field_key = 'ifsc'
                then 'payroll' else 'hr' end);

  -- The column name only. The module stored 'employees.full_name' here and
  -- then did format('select %I …'), which quotes the whole string as ONE
  -- identifier — "employees.full_name" — and finds no such column, so every
  -- request failed while looking correct. Split defensively in case an older
  -- row still holds the qualified form.
  col := split_part(cfg.source_column, '.', greatest(1,
           array_length(string_to_array(cfg.source_column, '.'), 1)));

  begin
    execute format('select %I::text from employees where id = $1', col)
      into old_val using p_employee_id;
  exception when undefined_column then
    old_val := null;   -- a config row pointing at a column that is not there
  end;                 -- must not stop somebody raising the request

  insert into profile_change_requests
    (company_id, employee_id, field_key, field_label, old_value, new_value,
     reason, route_to, status, requested_by)
  values (comp, p_employee_id, p_field_key, p_field_label, old_val, p_new_value,
          p_reason, route,
          -- Cast REQUIRED. A CASE over string literals is text, and Postgres
          -- will not implicitly widen text into an enum in an INSERT column
          -- list: 42804, "column status is of type profile_request_status but
          -- expression is of type text". Without this the function reaches its
          -- very last statement and dies there, so the whole change-request
          -- flow fails at the point it would have succeeded.
          (case when route = 'payroll' then 'pending_payroll'
                else 'pending_l1' end)::profile_request_status,
          p_requested_by)
  returning id into rid;
  return rid;
end $$;
