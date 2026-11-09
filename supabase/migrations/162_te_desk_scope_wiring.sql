-- 162_te_desk_scope_wiring.sql — make the branch actually mean something.
-- SAFE TO RUN TWICE. APPLY 161 FIRST: this reads te_desk_members and
-- te_approval_steps.desk_location_id, both of which 161 creates.
-- ----------------------------------------------------------------------------
-- WHAT CHANGES. Four objects, and in each one the change is the same idea:
-- where the code used to ask "who is on this COMPANY's Finance desk", it now
-- asks "who is on the desk for this company AND the branch this request was
-- raised at", through te_desk_members and its branch → company → group ladder.
--
--   te_build_steps          stamps the raiser's branch onto a team step
--   v_te_pending_approvals  carries that branch out to readers
--   te_queue                a team step reaches that branch's desk only
--   te_step_block_reason    and the same desk is the one allowed to take it
--
-- WHY THIS IS SAFE FOR EVERY ROW THAT ALREADY EXISTS, which is the only part
-- of this file worth checking twice. desk_location_id is NULL on every step
-- written before now, and te_desk_members('finance', c, NULL) skips its branch
-- step entirely and returns step 2 — anybody on that company's desk — which is
-- precisely what te_finance_members(c) has always returned. So every claim and
-- trip presently waiting behaves exactly as it did before this migration ran.
-- The new scoping applies to steps built from here on.
--
-- ONE REAL FIX RIDES ALONG. 161 lets one person hold both an "every branch"
-- row and a row at a single branch. The approval-limit lookup in
-- te_step_block_reason did `select ... into v_limit` with no ordering, which
-- with two matching rows takes whichever the planner happens to return first —
-- so somebody's limit could silently change between two reads. It now takes
-- the most permissive row deliberately: unlimited first, then the largest.
--
-- te_queue IS DROPPED AND RECREATED rather than replaced, because its return
-- type IS the view's row type and the view gains a column in this file.
-- ============================================================================

drop function if exists te_queue(uuid);

-- ── the view carries the branch ─────────────────────────────────────────────
create or replace view v_te_pending_approvals as
with cur as (
  select distinct on (s.entity_type, s.entity_id) s.*
    from te_approval_steps s
   where s.status = 'pending'
   order by s.entity_type, s.entity_id, s.step_no
)
select cur.id as step_id, cur.company_id, cur.entity_type, cur.entity_id, cur.step_no, cur.stage,
       cur.role_label, cur.approver_id, te_effective_approver(cur.approver_id) as effective_approver_id,
       cur.team_code, cur.due_at,
       coalesce((select max(p.acted_at) from te_approval_steps p
                  where p.entity_type = cur.entity_type and p.entity_id = cur.entity_id and p.step_no < cur.step_no),
                cur.created_at) as waiting_since,
       c.claim_no as ref_no, c.employee_id, e.emp_code, e.full_name as employee_name,
       c.claimed_total as amount, c.status as entity_status, c.risk_band,
       (select count(*) from te_flags f where f.claim_id = c.id and f.is_current and f.status = 'open') as flag_count,
       t.name as trip_name, t.scope, cur.desk_location_id
  from cur
  join te_claims c on cur.entity_type = 'claim' and c.id = cur.entity_id
                  and ((cur.stage = 'manager' and c.status = 'IN_APPROVAL')
                    or (cur.stage = 'finance' and c.status in ('IN_VERIFICATION','ON_HOLD')))
  join employees e on e.id = c.employee_id
  left join te_trips t on t.id = c.trip_id
union all
select cur.id, cur.company_id, cur.entity_type, cur.entity_id, cur.step_no, cur.stage,
       cur.role_label, cur.approver_id, te_effective_approver(cur.approver_id),
       cur.team_code, cur.due_at,
       coalesce((select max(p.acted_at) from te_approval_steps p
                  where p.entity_type = cur.entity_type and p.entity_id = cur.entity_id and p.step_no < cur.step_no),
                cur.created_at),
       t.trip_no, t.employee_id, e.emp_code, e.full_name,
       t.estimate_total, t.status, null::text, 0::bigint, t.name, t.scope, cur.desk_location_id
  from cur
  join te_trips t on cur.entity_type = 'trip' and t.id = cur.entity_id and t.status = 'PENDING_APPROVAL'
                 -- a plan whose start date passed while it waited can no longer be approved
                 and te_trip_status(t.id) <> 'EXPIRED'
  join employees e on e.id = t.employee_id;
-- ── the step is stamped with the branch it was raised at ────────────────────
create or replace function te_build_steps(
  p_company_id  uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_employee_id uuid,
  p_ctx         jsonb,
  p_co          uuid[] default '{}'
)
returns text[] language plpgsql as $$
declare
  v_notes text[] := '{}';
  v_days  int;
  v_loc   uuid;
  r       record;
begin
  select s.escalate_days into v_days from te_settings s where s.company_id = p_company_id;
  -- The branch the request was raised at. A team step is answered by that
  -- branch's desk; a step named to one person is not a desk's business, so it
  -- carries no branch at all.
  select e.location_id into v_loc from employees e where e.id = p_employee_id;
  delete from te_approval_steps where entity_type = p_entity_type and entity_id = p_entity_id;
  for r in select * from te_resolve_chain(p_company_id, p_employee_id, p_entity_type, p_ctx, p_co) loop
    insert into te_approval_steps (company_id, entity_type, entity_id, step_no, stage, level_id, role_label, approver_id, team_code,
                                   desk_location_id, due_at)
    values (p_company_id, p_entity_type, p_entity_id, r.step_no, r.stage, r.level_id, r.role_label, r.approver_id, r.team_code,
            case when r.team_code is not null then v_loc else null end,
            now() + make_interval(days => coalesce(v_days, 5)));
    if r.note is not null then
      v_notes := v_notes || r.note;
    end if;
  end loop;
  return v_notes;
end;
$$;
-- ── only that branch's desk may take it ─────────────────────────────────────
create or replace function te_step_block_reason(p_step te_approval_steps, p_actor uuid)
returns text language plpgsql stable as $$
declare
  v_owner uuid;
  v_later record;
  v_limit numeric;
  v_amt   numeric;
begin
  if p_step.id is null then
    return 'Nothing is waiting here.';
  end if;
  if p_step.team_code is null then
    v_owner := te_effective_approver(p_step.approver_id);
    if p_actor is distinct from p_step.approver_id and p_actor is distinct from v_owner then
      return 'This is waiting for ' || te_emp_name(p_step.approver_id) || ' (' || p_step.role_label || ').';
    end if;
  elsif not (p_actor = any (te_desk_members('finance', p_step.company_id, p_step.desk_location_id))) then
    return 'This is waiting for the Finance team'
           || case when p_step.desk_location_id is null then ''
                   else ' at ' || coalesce((select l.location_name from locations l where l.id = p_step.desk_location_id), 'another branch') end
           || ' (' || p_step.role_label || ').';
  end if;

  if p_step.stage = 'finance' then
    if exists (select 1 from te_approval_steps s
                where s.entity_type = p_step.entity_type and s.entity_id = p_step.entity_id
                  and s.stage = 'finance' and s.step_no < p_step.step_no and s.acted_by = p_actor) then
      return 'You verified an earlier finance level of this claim. Another person verifies this one.';
    end if;
    if p_step.team_code is not null and p_step.entity_type = 'claim' then
      select f.approval_limit into v_limit from finance_team f
       where f.company_id = p_step.company_id and f.employee_id = p_actor and f.is_active
       -- One person can hold an "every branch" row AND a branch row. Take the
       -- most permissive rather than whichever the planner returns first:
       -- an unlimited row (null) wins, then the largest limit.
       order by (f.approval_limit is null) desc, f.approval_limit desc
       limit 1;
      select c.approved_total into v_amt from te_claims c where c.id = p_step.entity_id;
      if v_limit is not null and coalesce(v_amt, 0) > v_limit
         and exists (select 1 from finance_team f
                      where f.employee_id = any (te_desk_members('finance', p_step.company_id, p_step.desk_location_id))
                        and f.company_id = p_step.company_id and f.is_active and f.can_approve and f.employee_id <> p_actor
                        and (f.approval_limit is null or f.approval_limit >= coalesce(v_amt, 0))
                        and te_is_employee_active(f.employee_id)
                        and f.employee_id <> (select c.employee_id from te_claims c where c.id = p_step.entity_id)) then
        return 'This claim is above your approval limit of ' || te_rs(v_limit) || '. A senior Finance member verifies it.';
      end if;
    end if;
    -- whoever approved the claim as a manager does not also verify it, as long
    -- as somebody else in the team can
    if p_step.team_code is not null and p_step.entity_type = 'claim'
       and exists (select 1 from te_approval_steps s
                    where s.entity_type = 'claim' and s.entity_id = p_step.entity_id and s.stage = 'manager' and s.acted_by = p_actor)
       and exists (select 1 from unnest(te_desk_members('finance', p_step.company_id, p_step.desk_location_id)) m
                    where m <> p_actor and m <> (select c.employee_id from te_claims c where c.id = p_step.entity_id)) then
      return 'You approved this claim as a manager. Another Finance team member verifies it.';
    end if;
    if p_step.team_code is not null then
      select s.role_label into v_later from te_approval_steps s
       where s.entity_type = p_step.entity_type and s.entity_id = p_step.entity_id
         and s.stage = 'finance' and s.step_no > p_step.step_no and s.status = 'pending'
         and s.team_code is null and s.approver_id = p_actor
       order by s.step_no limit 1;
      if found then
        return 'You are the ' || v_later.role_label || ' on this claim. Another Finance team member verifies first.';
      end if;
    end if;
  end if;
  return '';
end;
$$;
-- ── and only that branch's desk sees it waiting ─────────────────────────────
create or replace function te_queue(p_actor uuid)
returns setof v_te_pending_approvals language sql stable as $$
  select q.*
    from v_te_pending_approvals q
   where q.employee_id <> p_actor
     and (q.approver_id = p_actor or q.effective_approver_id = p_actor
          -- A team step is the business of the desk at the branch it was
          -- raised at. desk_location_id is null on every step written before
          -- migration 162, and te_desk_members with a null branch is exactly
          -- te_finance_members, so those rows behave as they always did.
          or (q.team_code is not null and p_actor = any (te_desk_members('finance', q.company_id, q.desk_location_id))))
     and te_step_block_reason((select s from te_approval_steps s where s.id = q.step_id), p_actor) = ''
   order by q.waiting_since;
$$;
notify pgrst, 'reload schema';
