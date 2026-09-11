-- =====================================================================
-- 105_profile_change_queue.sql
-- The other half of the profile change-request flow
--
-- FOR: Nayan Ahuja. Four functions, one replaced. NO SCHEMA CHANGE —
-- no new table, no new column, no new enum. Nothing here needs an RLS
-- policy decision from you.
--
-- WHY
--
-- 091 built the table, and 104 finally let employees file into it. But
-- nothing has ever read profile_change_requests: no SQL function updates
-- it, and no app code selects from it. The enum carries 'approved',
-- 'rejected' and 'cancelled' and nothing could ever set them. Requests
-- were saving successfully into a table no one could see.
--
-- This adds the decision side:
--
--   profile_change_queue    what a given approver may act on
--   profile_change_mine     what an employee has filed, and where it sits
--   profile_change_decide   approve / reject, and apply on final approval
--   profile_change_cancel   the employee withdraws their own request
--
-- THE STAGE CHAIN, WHICH WAS ALREADY IMPLIED BY 091'S ENUM
--
--   route 'hr'       pending_l1 -> pending_hr -> approved (applied)
--   route 'payroll'  pending_payroll ---------> approved (applied)
--   any stage        -> rejected      (terminal)
--   while pending    -> cancelled     (by the employee only)
--
-- ONE ROUTING CORRECTION, folded in here because it would strand people
--
-- 091 starts every hr-routed request at pending_l1 regardless of whether
-- the employee HAS an L1 manager. Migration 049 recorded l1_manager_id as
-- 0/397 populated and warned that routing through it would park claims.
-- That note is now stale — sampling 60 live profiles today found 59 with
-- an L1 manager. But not all: SRS9021 has none, and under 091 his requests
-- would sit at pending_l1 with nobody able to act, forever. So the raise
-- function now starts at pending_hr when there is no L1 to ask.
--
-- 104's enum cast is carried forward unchanged. Running this does not
-- undo it.
--
-- DEPENDS ON 091, 101, 104. SAFE TO RUN TWICE.
-- =====================================================================


-- ─── Who may act at each stage ──────────────────────────────────────
--
-- Kept as one function so the queue listing and the decision check can
-- never drift apart — the queue shows exactly what decide() will accept.
-- Split them and the UI eventually offers a button that errors.

create or replace function profile_change_can_act(
  p_actor uuid, p_request profile_change_requests
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  is_hr      boolean;
  is_payroll boolean;
  is_super   boolean;
  emp        record;
begin
  if p_actor is null then return false; end if;

  -- Nobody signs off their own paperwork. This holds even for a super
  -- admin: an HR manager changing their own bank account still needs a
  -- second pair of eyes, which is the entire point of the queue.
  if p_actor = p_request.employee_id or p_actor = p_request.requested_by then
    return false;
  end if;

  select id, company_id, l1_manager_id, l2_manager_id
    into emp from employees where id = p_request.employee_id;
  if not found then return false; end if;

  -- Role path: ess_accounts -> ess_user_roles -> ess_roles. NOT
  -- employee_roles (does not exist) and not ess_user_roles.employee_id
  -- (that column is not there either) — 099 documents both mistakes.
  select
    bool_or(r.role_code in ('HR_MANAGER','HR_HEAD','HR_EXECUTIVE','BRANCH_HR',
                            'CHRO','ADMIN_COMPANY','ADMIN_SUPER','ALL_ACCESS')),
    bool_or(r.role_code in ('PAYROLL','PAYROLL_ADMIN','PAYROLL_MANAGER',
                            'ADMIN_SUPER','ALL_ACCESS')),
    bool_or(r.role_code in ('ADMIN_SUPER','ALL_ACCESS'))
    into is_hr, is_payroll, is_super
    from ess_accounts a
    join ess_user_roles ur on ur.ess_account_id = a.id and ur.is_active
    join ess_roles r       on r.id = ur.role_id
   where a.employee_id = p_actor;

  is_hr      := coalesce(is_hr, false);
  is_payroll := coalesce(is_payroll, false);
  is_super   := coalesce(is_super, false);

  -- Company scoping. A group super admin reaches across all three
  -- companies; everybody else acts only inside their own. Written as
  -- IS DISTINCT FROM because a null company_id on either side must not
  -- silently pass — `x <> null` is null, which reads as "not blocked".
  if not is_super then
    if (select company_id from employees where id = p_actor)
       is distinct from emp.company_id then
      return false;
    end if;
  end if;

  return case p_request.status
    -- The line manager decides first. HR may also act here, otherwise a
    -- request behind an absent or departed manager has no way forward.
    when 'pending_l1'      then p_actor in (emp.l1_manager_id, emp.l2_manager_id)
                                or is_hr
    when 'pending_hr'      then is_hr
    when 'pending_payroll' then is_payroll
    else false                     -- approved / rejected / cancelled are final
  end;
end $$;


-- ─── The approver's queue ───────────────────────────────────────────

create or replace function profile_change_queue(p_actor uuid)
returns table (
  id           uuid,
  employee_id  uuid,
  emp_code     text,
  employee     text,
  field_key    text,
  field_label  text,
  old_value    text,
  new_value    text,
  reason       text,
  route_to     text,
  status       text,
  stage_label  text,
  requested_at timestamptz,
  waiting_days int
)
language sql stable security definer set search_path = public as $$
  select
    r.id, r.employee_id, e.emp_code, e.full_name,
    r.field_key, r.field_label, r.old_value, r.new_value, r.reason,
    r.route_to, r.status::text,
    case r.status
      when 'pending_l1'      then 'Waiting on the line manager'
      when 'pending_hr'      then 'Waiting on HR'
      when 'pending_payroll' then 'Waiting on Payroll'
      else initcap(r.status::text)
    end,
    r.created_at,
    greatest(0, (current_date - r.created_at::date))::int
  from profile_change_requests r
  join employees e on e.id = r.employee_id
 where r.status in ('pending_l1','pending_hr','pending_payroll')
   and profile_change_can_act(p_actor, r)
 order by r.created_at;
$$;


-- ─── What the employee themselves filed ─────────────────────────────

create or replace function profile_change_mine(p_employee uuid)
returns table (
  id           uuid,
  field_key    text,
  field_label  text,
  old_value    text,
  new_value    text,
  reason       text,
  status       text,
  stage_label  text,
  remarks      text,
  requested_at timestamptz,
  decided_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    r.id, r.field_key, r.field_label, r.old_value, r.new_value, r.reason,
    r.status::text,
    case r.status
      when 'pending_l1'      then 'With your line manager'
      when 'pending_hr'      then 'With HR'
      when 'pending_payroll' then 'With Payroll'
      when 'approved'        then 'Approved and applied'
      when 'rejected'        then 'Not approved'
      when 'cancelled'       then 'Withdrawn'
    end,
    r.remarks, r.created_at, coalesce(r.approved_at, r.rejected_at)
  from profile_change_requests r
 where r.employee_id = p_employee
 order by r.created_at desc;
$$;


-- ─── Approve or reject ──────────────────────────────────────────────

create or replace function profile_change_decide(
  p_request uuid, p_actor uuid, p_decision text, p_remarks text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  req  profile_change_requests;
  cfg  record;
  col  text;
  typ  text;
  nxt  profile_request_status;
  val  text;
begin
  if p_decision not in ('approve','reject') then
    raise exception 'Decision must be approve or reject, not %', p_decision;
  end if;

  select * into req from profile_change_requests where id = p_request for update;
  if not found then
    raise exception 'No such request';
  end if;
  if req.status not in ('pending_l1','pending_hr','pending_payroll') then
    raise exception 'This request was already %, so it cannot be decided again',
                    req.status;
  end if;
  if not profile_change_can_act(p_actor, req) then
    raise exception 'You are not the approver for this request at its current stage';
  end if;

  if p_decision = 'reject' then
    update profile_change_requests
       set status = 'rejected', rejected_by = p_actor,
           rejected_at = now(), remarks = p_remarks
     where id = p_request;
    return jsonb_build_object('ok', true, 'status', 'rejected', 'applied', false);
  end if;

  -- Approve. An hr-routed request clears the line manager first and only
  -- then reaches HR; payroll has a single stage.
  nxt := case req.status
           when 'pending_l1' then 'pending_hr'::profile_request_status
           else 'approved'::profile_request_status
         end;

  if nxt = 'pending_hr' then
    update profile_change_requests
       set status = nxt, remarks = p_remarks
     where id = p_request;
    return jsonb_build_object('ok', true, 'status', 'pending_hr',
                              'applied', false,
                              'message', 'Cleared. Now with HR.');
  end if;

  -- Final approval: write the value onto the employee record.
  select * into cfg from profile_field_config
   where field_key = req.field_key
     and (company_id = req.company_id or company_id is null)
   order by company_id nulls last limit 1;
  if not found then
    raise exception 'Field % is no longer configured, so there is no column to '
                    'write to. Approving it would silently do nothing.',
                    req.field_key;
  end if;

  -- Bare column name. 091 documents why the qualified form has to be
  -- split off defensively.
  col := split_part(cfg.source_column, '.', greatest(1,
           array_length(string_to_array(cfg.source_column, '.'), 1)));

  -- Resolve the column against the catalogue rather than trusting the
  -- config string. This both catches a typo'd source_column before it
  -- becomes a confusing runtime error, and means the identifier that
  -- reaches the UPDATE is one Postgres itself confirmed exists.
  select format_type(a.atttypid, a.atttypmod) into typ
    from pg_attribute a
   where a.attrelid = 'public.employees'::regclass
     and a.attname = col and a.attnum > 0 and not a.attisdropped;
  if typ is null then
    raise exception 'profile_field_config points % at employees.%, which does '
                    'not exist', req.field_key, col;
  end if;

  -- An emptied field means "clear it", not the empty string — otherwise a
  -- date or boolean column would reject '' and the approval would fail at
  -- the last step.
  val := nullif(btrim(req.new_value), '');

  begin
    execute format('update employees set %I = $1::%s where id = $2', col, typ)
      using val, req.employee_id;
  exception when others then
    raise exception 'Could not apply % to employees.% (%): %',
                    req.field_label, col, typ, sqlerrm;
  end;

  update profile_change_requests
     set status = 'approved', approved_by = p_actor, approved_at = now(),
         applied_at = now(), remarks = p_remarks
   where id = p_request;

  return jsonb_build_object('ok', true, 'status', 'approved', 'applied', true,
                            'column', col);
end $$;


-- ─── The employee withdraws their own request ───────────────────────

create or replace function profile_change_cancel(p_request uuid, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare req profile_change_requests;
begin
  select * into req from profile_change_requests where id = p_request for update;
  if not found then raise exception 'No such request'; end if;

  if p_actor is distinct from req.employee_id
     and p_actor is distinct from req.requested_by then
    raise exception 'Only the person who raised this can withdraw it';
  end if;
  if req.status not in ('pending_l1','pending_hr','pending_payroll') then
    raise exception 'This request was already %, so there is nothing to withdraw',
                    req.status;
  end if;

  update profile_change_requests set status = 'cancelled' where id = p_request;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;


-- ─── Routing correction (carries 104's cast forward) ────────────────

create or replace function raise_profile_change_request(
  p_employee_id uuid, p_requested_by uuid, p_field_key text,
  p_field_label text, p_new_value text, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cfg record; rid uuid; route text; old_val text; comp uuid; col text;
  has_l1 boolean;
begin
  select company_id, l1_manager_id is not null
    into comp, has_l1 from employees where id = p_employee_id;

  select * into cfg from profile_field_config
   where field_key = p_field_key and (company_id = comp or company_id is null)
   order by company_id nulls last limit 1;

  if not found then
    raise exception 'Field % is not configured, so there is nothing to route',
                    p_field_key;
  end if;
  if cfg.edit_state = 'locked' then
    raise exception 'Field % is maintained by HR and cannot be requested',
                    p_field_key;
  end if;

  route := coalesce(cfg.route_to,
           case when p_field_key like 'bank%' or p_field_key = 'ifsc'
                then 'payroll' else 'hr' end);

  col := split_part(cfg.source_column, '.', greatest(1,
           array_length(string_to_array(cfg.source_column, '.'), 1)));

  execute format('select %I::text from employees where id = $1', col)
    into old_val using p_employee_id;

  insert into profile_change_requests
    (company_id, employee_id, field_key, field_label, old_value, new_value,
     reason, route_to, status, requested_by)
  values (comp, p_employee_id, p_field_key, p_field_label, old_val, p_new_value,
          p_reason, route,
          -- The cast is REQUIRED (104): a CASE over string literals is text,
          -- and Postgres will not implicitly widen text into an enum here.
          --
          -- Starting stage: payroll has one. An hr-routed request starts with
          -- the line manager, UNLESS the employee has none — then it would
          -- park at pending_l1 with no possible approver, so it goes straight
          -- to HR instead.
          (case when route = 'payroll' then 'pending_payroll'
                when has_l1            then 'pending_l1'
                else 'pending_hr' end)::profile_request_status,
          p_requested_by)
  returning id into rid;
  return rid;
end $$;


-- ─── Grants ─────────────────────────────────────────────────────────
--
-- Postgres grants EXECUTE to PUBLIC on every new function by default, and
-- revoking from anon alone does NOT remove it — the grant lives on PUBLIC.
-- These are SECURITY DEFINER and take the actor as a parameter, so a
-- browser-reachable role holding them could approve anything as anyone.

revoke all on function profile_change_can_act(uuid, profile_change_requests)
  from public, anon, authenticated;
revoke all on function profile_change_queue(uuid)  from public, anon, authenticated;
revoke all on function profile_change_mine(uuid)   from public, anon, authenticated;
revoke all on function profile_change_decide(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function profile_change_cancel(uuid, uuid) from public, anon, authenticated;
revoke all on function raise_profile_change_request(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;

grant execute on function profile_change_can_act(uuid, profile_change_requests) to service_role;
grant execute on function profile_change_queue(uuid)  to service_role;
grant execute on function profile_change_mine(uuid)   to service_role;
grant execute on function profile_change_decide(uuid, uuid, text, text) to service_role;
grant execute on function profile_change_cancel(uuid, uuid) to service_role;
grant execute on function raise_profile_change_request(uuid, uuid, text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
