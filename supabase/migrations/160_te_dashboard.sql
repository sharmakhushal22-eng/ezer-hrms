-- 160_te_dashboard.sql — "what came to me, what I did with it, and how my team is doing".
-- SAFE TO RUN TWICE.
-- ----------------------------------------------------------------------------
-- WHAT THIS IS FOR. Every employee gets a Reports and Dashboard tab in Travel
-- and Expenses. Three different people read it and each needs a different
-- thing from it:
--
--   anybody      where my own trips and claims have reached, and who is
--                sitting on them
--   an approver  how many decisions came to me this month, how many I made,
--                for whom, and to where
--   an RM or HOD the same for my team, READ ONLY — tracking, not authority
--
-- ONE FUNCTION, NOT THREE ROUTES. te_dashboard returns all three keys in one
-- read. They are drawn on one screen and they share the date window, so three
-- round trips would only give three chances for the numbers to disagree.
--
-- WHY te_queue WAS NOT ENOUGH. te_queue answers "what is waiting on me now".
-- A scorecard is the opposite question — what is no longer waiting, because I
-- dealt with it — so it reads te_approval_steps directly, where acted_at and
-- acted_by record what actually happened.
--
-- "CAME TO ME" MEANS WHAT te_queue MEANS BY IT, and that is wider than
-- approver_id. A step belongs to the named approver, OR to their live
-- delegate while the delegation lasts, OR — for a finance team step, which
-- has no approver_id at all — to anyone on the company's Finance team. Match
-- on approver_id alone and a delegate covering somebody's leave sees an empty
-- scorecard beside a full queue, and every Finance person scores zero forever.
-- The predicate below is te_queue's, minus the per-step four-eyes test, which
-- answers "may you take this step" rather than "was this yours".
--
-- WHAT A MANAGER DOES NOT SEE. The team list carries what was asked for and
-- how far it got: claimed, approved, status, where and when. It does NOT carry
-- net_amount, advance_adjusted or anything about the payout. What somebody was
-- finally paid, after their own advance was settled against it, is between them
-- and Finance; a manager tracking a trip does not need it and should not have
-- it by default.
--
-- THE WINDOW IS INCLUSIVE at both ends and applies to the ACTION date for the
-- scorecard (when I decided) and the RAISED date for the team list (when they
-- asked). Those are the dates each question is actually about.
-- ============================================================================

-- Who reports to me, by the same two sources te_org_chain reads: the columns
-- on employees, and an explicit relationship row that overrides them.
create or replace function te_my_people(p_actor uuid)
returns setof uuid language sql stable as $$
  select e.id from employees e
   where e.id <> p_actor
     and (e.l1_manager_id = p_actor or e.l2_manager_id = p_actor or e.hod_id = p_actor)
  union
  select r.employee_id from employee_relationships r
   where r.manager_employee_id = p_actor and r.valid_to is null and r.employee_id <> p_actor;
$$;

comment on function te_my_people is
  'Employees who report to this person, directly or as HOD. Used for read-only team tracking, never for authority.';

create or replace function te_dashboard(p_actor uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable as $$
declare
  v_company uuid;
  v_from    date;
  v_to      date;
  v_mine    jsonb;
  v_score   jsonb;
  v_acted   jsonb;
  v_team    jsonb;
  v_people  uuid[];
  v_fin     uuid[];
begin
  select company_id into v_company from employees where id = p_actor;
  if v_company is null then
    perform te_fail('TE_FORBIDDEN', 'No employee record for this user.');
  end if;

  -- Default to the month the company is in, not the server's month.
  v_from := coalesce(p_from, date_trunc('month', te_today(v_company))::date);
  v_to   := coalesce(p_to,   (date_trunc('month', te_today(v_company)) + interval '1 month - 1 day')::date);

  -- Read once, not once per step: a finance team step names no approver, so
  -- membership is the only thing that makes it this person's.
  v_fin := te_finance_members(v_company);

  -- ── mine: my own trips and claims, and where they have reached ──────────
  select jsonb_build_object(
    'trips', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'no', t.trip_no, 'name', t.name, 'scope', t.scope,
                'status', t.status, 'display', te_trip_status(t.id),
                'start', t.start_date, 'end', t.end_date, 'to', coalesce(t.to_label, ''),
                'estimate', t.estimate_total,
                'withWhom', (select te_emp_name(s.approver_id) from te_approval_steps s
                              where s.entity_type = 'trip' and s.entity_id = t.id and s.status = 'pending'
                              order by s.step_no limit 1))
                order by t.created_at desc), '[]'::jsonb)
               from te_trips t
              where t.employee_id = p_actor and t.status not in ('CANCELLED')),
    'claims', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'no', c.claim_no, 'status', c.status, 'stage', c.stage,
                'claimed', c.claimed_total, 'approved', c.approved_total, 'net', c.net_amount,
                'submitted', c.submitted_at,
                'withWhom', (select te_emp_name(s.approver_id) from te_approval_steps s
                              where s.entity_type = 'claim' and s.entity_id = c.id and s.status = 'pending'
                              order by s.step_no limit 1))
                order by c.created_at desc), '[]'::jsonb)
               from te_claims c
              where c.employee_id = p_actor and c.status <> 'CANCELLED')
  ) into v_mine;

  -- ── scorecard: decisions that came to me, and what I did ────────────────
  -- Counted on the step, not the trip: one trip can need two approvals and
  -- both of them were work somebody did.
  -- EVERY DECIDED COUNT ALSO REQUIRES acted_by = p_actor, and that is not
  -- redundant with the WHERE below. A finance TEAM step belongs to everybody
  -- on the team, so without this a person would be credited with every claim
  -- their colleagues verified. The WHERE says "this was ours"; acted_by says
  -- "and I am the one who did it".
  --
  -- An automatic step therefore counts in none of them, which is correct:
  -- acted_by is null on an 'auto' row because no person decided it. It is a
  -- rule firing, not work somebody did, and crediting it to whoever happened
  -- to be named on the step would inflate the only number on this screen that
  -- anyone would ever be judged by.
  select jsonb_build_object(
    'cameToMe', count(*) filter (where (s.acted_by = p_actor and s.acted_at::date between v_from and v_to)
                                    or s.status = 'pending'),
    'approved', count(*) filter (where s.status = 'approved' and s.acted_by = p_actor and s.acted_at::date between v_from and v_to),
    'rejected', count(*) filter (where s.status = 'rejected' and s.acted_by = p_actor and s.acted_at::date between v_from and v_to),
    'sentBack', count(*) filter (where s.status = 'sent_back' and s.acted_by = p_actor and s.acted_at::date between v_from and v_to),
    'waiting',  count(*) filter (where s.status = 'pending')
  ) into v_score
    from te_approval_steps s
    left join te_trips  t on s.entity_type = 'trip'  and t.id = s.entity_id
    left join te_claims c on s.entity_type = 'claim' and c.id = s.entity_id
   where s.company_id = v_company
     -- Your own request is never a decision you made, even in the odd case
     -- where the chain named you on it. te_queue excludes it the same way.
     and coalesce(t.employee_id, c.employee_id) <> p_actor
     and (s.approver_id = p_actor
          or s.acted_by = p_actor
          or te_effective_approver(s.approver_id) = p_actor
          or (s.team_code is not null and p_actor = any (v_fin)));

  -- ── what I acted on, for whom and to where ──────────────────────────────
  select coalesce(jsonb_agg(x order by x->>'actedAt' desc), '[]'::jsonb) into v_acted from (
    select jsonb_build_object(
      'kind', s.entity_type, 'id', s.entity_id, 'status', s.status,
      'role', s.role_label, 'stage', s.stage,
      'actedAt', s.acted_at, 'comment', coalesce(s.comment, ''),
      'who', te_emp_name(coalesce(t.employee_id, c.employee_id)),
      'whoId', coalesce(t.employee_id, c.employee_id),
      'no', coalesce(t.trip_no, c.claim_no),
      'what', coalesce(t.name, 'Claim ' || c.claim_no),
      'where', coalesce(t.to_label, ''),
      'amount', coalesce(t.estimate_total, c.claimed_total, 0)
    ) as x
      from te_approval_steps s
      left join te_trips  t on s.entity_type = 'trip'  and t.id = s.entity_id
      left join te_claims c on s.entity_type = 'claim' and c.id = s.entity_id
     where s.company_id = v_company
       and s.acted_by = p_actor
       and coalesce(t.employee_id, c.employee_id) <> p_actor
       and s.acted_at::date between v_from and v_to
     limit 200
  ) q;

  -- ── my team, read only ──────────────────────────────────────────────────
  select coalesce(array_agg(id), '{}') into v_people from te_my_people(p_actor) id;

  if cardinality(v_people) = 0 then
    v_team := jsonb_build_object('people', 0, 'trips', '[]'::jsonb, 'claims', '[]'::jsonb);
  else
    select jsonb_build_object(
      'people', cardinality(v_people),
      'trips', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', t.id, 'no', t.trip_no, 'name', t.name, 'scope', t.scope,
                  'who', te_emp_name(t.employee_id), 'whoId', t.employee_id,
                  'status', t.status, 'display', te_trip_status(t.id),
                  'start', t.start_date, 'end', t.end_date, 'to', coalesce(t.to_label, ''),
                  'estimate', t.estimate_total,
                  'withWhom', (select te_emp_name(s.approver_id) from te_approval_steps s
                                where s.entity_type = 'trip' and s.entity_id = t.id and s.status = 'pending'
                                order by s.step_no limit 1))
                  order by t.start_date desc nulls last), '[]'::jsonb)
                 from te_trips t
                where t.employee_id = any (v_people)
                  and t.status <> 'CANCELLED'
                  and coalesce(t.start_date, t.created_at::date) between v_from and v_to),
      -- NO net_amount AND NO PAYOUT. What a colleague was finally paid, after
      -- their own advance was settled against it, is theirs and Finance's.
      'claims', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', c.id, 'no', c.claim_no,
                  'who', te_emp_name(c.employee_id), 'whoId', c.employee_id,
                  'status', c.status, 'stage', c.stage,
                  'claimed', c.claimed_total, 'approved', c.approved_total,
                  'submitted', c.submitted_at,
                  'withWhom', (select te_emp_name(s.approver_id) from te_approval_steps s
                                where s.entity_type = 'claim' and s.entity_id = c.id and s.status = 'pending'
                                order by s.step_no limit 1))
                  order by c.submitted_at desc nulls last), '[]'::jsonb)
                 from te_claims c
                where c.employee_id = any (v_people)
                  and c.status <> 'CANCELLED'
                  and coalesce(c.submitted_at::date, c.created_at::date) between v_from and v_to)
    ) into v_team;
  end if;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'me', p_actor,
    'mine', v_mine,
    'score', v_score,
    'acted', v_acted,
    'team', v_team);
end;
$$;

comment on function te_dashboard is
  'The Reports and Dashboard tab: my own requests, my approval scorecard for a date window, what I acted on, and my team read-only. Never grants authority — every action still re-checks the chain.';
