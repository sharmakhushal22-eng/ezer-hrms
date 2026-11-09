-- 168_te_approver_watch.sql — F2 and F3, the two checks about APPROVERS.
-- SAFE TO RUN TWICE. One new function. No table, no data, no behaviour change
-- to any claim.
-- ----------------------------------------------------------------------------
-- WHY THESE TWO ARE NOT CLAIM CHECKS. Every other check in the catalogue looks
-- at a claim and raises a flag on it. F2 and F3 carry the action 'report' —
-- they look at a person's HISTORY across many claims, and there is nothing
-- useful to say on any one of them. "This claim was approved in four seconds"
-- is not a finding; "this approver has cleared nineteen flagged claims in
-- under a minute each" is.
--
-- So they are a report, and this is the query behind it. Nothing here blocks,
-- warns, caps or reroutes anything.
--
--   F2  an approver who clears FLAGGED claims within seconds. A flag exists to
--       be read. Deciding faster than it can be read is the signal, and it is
--       measured only on claims that actually had one — somebody who approves
--       clean claims quickly is doing their job well.
--
--   F3  one approver taking nearly all of one employee's flagged claims. On
--       its own that is just a reporting line; what makes it worth looking at
--       is the pairing being near-total while the employee's flagged claims
--       could have gone to several people.
--
-- NEITHER IS AN ACCUSATION and the wording avoids pretending otherwise. Both
-- have ordinary explanations — a small team with one approver, a manager who
-- reads the flags on their phone before the claim arrives on their desk. The
-- report says what happened and leaves the question to a person.
--
-- HOW LONG A STEP TOOK. A step becomes that person's business when the step
-- before it was acted on, or when the chain was built if it is the first. That
-- is exactly what v_te_pending_approvals computes as waiting_since, but only
-- for steps that are still pending, so it is computed here for acted ones.
--
-- THRESHOLDS COME FROM te_checks.params, which migration 167 finally sends to
-- the engine and which this reads directly:
--   F2  seconds     under how long counts as "within seconds"   default 60
--       minClaims   flagged decisions before a pattern is named default 3
--   F3  pct         share of one employee's flagged claims      default 80
--       minClaims   that employee's flagged claims before it    default 4
--               counts
-- ============================================================================

create or replace function te_approver_watch(
  p_company uuid,
  p_from    date default null,
  p_to      date default null
)
returns jsonb language plpgsql stable as $$
declare
  v_from   date;
  v_to     date;
  v_f2_sec int;
  v_f2_min int;
  v_f3_pct int;
  v_f3_min int;
  v_f2     jsonb;
  v_f3     jsonb;
  v_on2    boolean;
  v_on3    boolean;
begin
  -- Default to the last 90 days of the company's own calendar.
  v_to   := coalesce(p_to, te_today(p_company));
  v_from := coalesce(p_from, v_to - 90);

  select coalesce((k.params->>'seconds')::int, 60), coalesce((k.params->>'minClaims')::int, 3), k.is_enabled
    into v_f2_sec, v_f2_min, v_on2
    from te_checks k where k.company_id = p_company and k.code = 'F2';
  select coalesce((k.params->>'pct')::int, 80), coalesce((k.params->>'minClaims')::int, 4), k.is_enabled
    into v_f3_pct, v_f3_min, v_on3
    from te_checks k where k.company_id = p_company and k.code = 'F3';

  -- A company with no row for these codes leaves every variable NULL, and
  -- `secs <= NULL` is NULL, which quietly returns nothing at all rather than
  -- the defaults the comment above promises. The coalesce inside the select
  -- only covers a row whose params key is missing, not a missing row.
  v_f2_sec := coalesce(v_f2_sec, 60);
  v_f2_min := coalesce(v_f2_min, 3);
  v_f3_pct := coalesce(v_f3_pct, 80);
  v_f3_min := coalesce(v_f3_min, 4);

  -- Every human decision on a claim that carried at least one flag, with how
  -- long the person had it. 'auto' steps have no acted_by and are excluded by
  -- the join: a rule firing is not an approver to report on.
  --
  -- ONE STATEMENT, NOT TWO. A CTE lives only as long as the statement that
  -- declares it, so computing `timed` once and then selecting F2 and F3 out of
  -- it in two separate `select into` statements does not work — the second one
  -- cannot see it. Both aggregates are therefore built here and assigned
  -- together.
  with decided as (
    select s.id, s.entity_id as claim_id, s.acted_by, s.acted_at, s.stage, s.role_label,
           c.employee_id,
           coalesce(
             (select max(p.acted_at) from te_approval_steps p
               where p.entity_type = 'claim' and p.entity_id = s.entity_id and p.step_no < s.step_no),
             s.created_at) as became_theirs
      from te_approval_steps s
      join te_claims c on c.id = s.entity_id
     where s.company_id = p_company
       and s.entity_type = 'claim'
       and s.status in ('approved', 'sent_back', 'rejected')
       and s.acted_by is not null
       and s.acted_at::date between v_from and v_to
       and exists (select 1 from te_flags f where f.claim_id = c.id and f.is_current)
  ),
  timed as (
    select d.*, greatest(0, extract(epoch from (d.acted_at - d.became_theirs))::int) as secs
      from decided d
  ),
  -- ── F2: cleared flagged claims within seconds ──
  f2 as (
    select jsonb_build_object(
             'who', t.acted_by, 'name', te_emp_name(t.acted_by),
             'flagged', count(*),
             'fast', count(*) filter (where t.secs <= v_f2_sec),
             'fastestSecs', min(t.secs),
             'medianSecs', (percentile_cont(0.5) within group (order by t.secs))::int
           ) as x,
           count(*) filter (where t.secs <= v_f2_sec) as fast_n
      from timed t
     group by t.acted_by
    having count(*) filter (where t.secs <= v_f2_sec) >= v_f2_min
  ),
  -- ── F3: one approver taking nearly all of one employee's flagged claims ──
  -- The denominator is that employee's flagged claims decided by ANYBODY in
  -- the window, so a pairing is a share and not a count: three of three is a
  -- pattern, three of thirty is not.
  pairs as (
    select t.acted_by, t.employee_id,
           count(distinct t.claim_id) as n,
           (select count(distinct t2.claim_id) from timed t2 where t2.employee_id = t.employee_id) as total
      from timed t
     group by t.acted_by, t.employee_id
  ),
  f3 as (
    select jsonb_build_object(
             'who', p.acted_by, 'name', te_emp_name(p.acted_by),
             'employee', p.employee_id, 'employeeName', te_emp_name(p.employee_id),
             'pairs', p.n, 'theirTotal', p.total,
             'pct', round((p.n::numeric / nullif(p.total, 0)) * 100)::int
           ) as x,
           round((p.n::numeric / nullif(p.total, 0)) * 100)::int as pct_n
      from pairs p
     where p.total >= v_f3_min
       and round((p.n::numeric / nullif(p.total, 0)) * 100) >= v_f3_pct
  )
  select coalesce((select jsonb_agg(x order by fast_n desc) from f2), '[]'::jsonb),
         coalesce((select jsonb_agg(x order by pct_n desc) from f3), '[]'::jsonb)
    into v_f2, v_f3;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'f2', jsonb_build_object('on', coalesce(v_on2, false), 'seconds', v_f2_sec, 'minClaims', v_f2_min, 'rows', v_f2),
    'f3', jsonb_build_object('on', coalesce(v_on3, false), 'pct', v_f3_pct, 'minClaims', v_f3_min, 'rows', v_f3));
end;
$$;

comment on function te_approver_watch is
  'F2 and F3: approvers who clear flagged claims within seconds, and approver-to-employee pairings on flagged claims. A report over history, never a flag on a claim.';

notify pgrst, 'reload schema';
