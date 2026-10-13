-- 147_te_functions_claims.sql
-- ============================================================================
-- EZER HRMS — TRAVEL & EXPENSE v2  ·  4 of 6: CLAIMS, APPROVALS, FINANCE, MONEY
-- SAFE TO RUN TWICE. Run AFTER 146.
-- ----------------------------------------------------------------------------
-- THE LIFE OF A CLAIM
--
--   te_claim_submit      UNCLAIMED lines -> a claim, IN_APPROVAL (or straight to
--                        Finance when the workflow has no approval level for it)
--   te_claim_decide      each approval level: approve | sendback | reject
--   (last level done)    -> the claim enters verification:
--                             High risk or picked by the audit sample -> ON_HOLD
--                             Low risk, in policy, small               -> auto-verified
--                             otherwise                                -> IN_VERIFICATION
--   te_claim_finance     each finance level: verify | hold | sendback | reject
--   (last level done)    -> the net is worked out against the advance:
--                             net > 0  -> VERIFIED, waits for a payout batch
--                             net <= 0 -> SETTLED, the advance covers it
--   te_payout_create / te_payout_file / te_payout_paid   VERIFIED -> IN_PAYOUT -> SETTLED
--   te_payout_item_failed / te_payout_cancel             back to VERIFIED
--   te_adjustment_add / te_adjustment_close              a correction after payment
--   te_claim_respond     the employee answers a send-back (re-checked by the engine)
--   te_claim_recall      the employee takes it back before anyone has acted
--   te_claim_reopen      Finance reopens a rejected claim
--
-- The amounts, flags and risk score at submit are computed by the rules engine
-- (engine/te-engine.js: assess). These functions store them and own every state
-- change after that.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — NOTIFICATIONS AND THE FINANCE QUEUE (both optional at run time)
-- ============================================================================

-- One row in ess_notifications (Inbox and bell). The code starts with CLAIM,
-- TRAVEL or ADVANCE so lib/inbox/streams.ts files it under Finance.
-- If ess_notifications is not on this database the call does nothing.
create or replace function te_notify(
  p_employee_id uuid, p_code text, p_title text, p_body text,
  p_link text default '/ess?tab=claims', p_priority text default 'NORMAL', p_actor uuid default null
)
returns void language plpgsql as $$
begin
  if p_employee_id is null or to_regclass('public.ess_notifications') is null then
    return;
  end if;
  begin
    insert into ess_notifications (employee_id, category, notification_code, title, body, link, is_read, priority, actor_employee_id)
    values (p_employee_id, p_code, p_code, p_title, p_body, p_link, false, coalesce(p_priority, 'NORMAL'), p_actor);
  exception when others then
    -- a notification must never undo a money decision
    null;
  end;
end;
$$;

-- Tell whoever holds the step that is waiting now.
create or replace function te__notify_waiting(p_entity_type text, p_entity_id uuid, p_title text, p_body text, p_actor uuid default null)
returns void language plpgsql as $$
declare
  st te_approval_steps := te_current_step(p_entity_type, p_entity_id);
  m  uuid;
  v_link text := '/ess?tab=approvals&ref=' || p_entity_id;
begin
  if st.id is null then
    return;
  end if;
  if st.team_code is null then
    perform te_notify(te_effective_approver(st.approver_id), 'CLAIM_WAITING', p_title, p_body, v_link, 'NORMAL', p_actor);
  else
    foreach m in array te_finance_members(st.company_id) loop
      perform te_notify(m, 'CLAIM_WAITING', p_title, p_body, '/dashboard/finance?ref=' || p_entity_id, 'NORMAL', p_actor);
    end loop;
  end if;
end;
$$;

-- The shared Finance queue (migration 053). Module code EXPENSE is registered
-- by 149. If finance_enqueue is missing or the module is off, nothing happens.
create or replace function te__finance_queue(p_claim_id uuid, p_status text, p_actor uuid default null, p_note text default null)
returns void language plpgsql as $$
declare
  c te_claims;
begin
  if to_regprocedure('finance_settle(text, uuid, text, uuid, text)') is null then
    return;
  end if;
  select * into c from te_claims where id = p_claim_id;
  begin
    if p_status = 'PENDING' then
      perform finance_enqueue(c.company_id, 'EXPENSE', 'te_claims', c.id,
                'Expense claim ' || c.claim_no, te_emp_name(c.employee_id) || ' · ' || c.risk_band || ' risk',
                c.employee_id, c.approved_total,
                (select count(*)::int from te_flags f where f.claim_id = c.id and f.is_current and f.status = 'open'),
                null, jsonb_build_object('status', c.status));
    else
      perform finance_settle('EXPENSE', c.id, p_status, p_actor, p_note);
    end if;
  exception when others then
    null;
  end;
end;
$$;


-- ============================================================================
-- SECTION 2 — INSIDE A CLAIM
-- ============================================================================

create or replace function te__claim_log(c te_claims, p_action text, p_summary text, p_actor uuid,
                                         p_visible boolean default true, p_role text default null)
returns void language sql as $$
  select te_log(c.company_id, 'claim', c.id, c.claim_no, p_action, p_actor, p_summary, p_visible, null, null, p_role);
$$;

-- approved total, risk score and band, from the lines and the flags as they are now
create or replace function te__claim_recalc(p_claim_id uuid)
returns void language plpgsql as $$
declare
  v_company uuid;
  v_w       jsonb;
  v_b       jsonb;
  v_score   int;
begin
  select company_id into v_company from te_claims where id = p_claim_id;
  select s.risk_weights, s.risk_bands into v_w, v_b from te_settings s where s.company_id = v_company;
  select coalesce(sum(coalesce((v_w->>f.severity)::int, 0)), 0) into v_score
    from te_flags f where f.claim_id = p_claim_id and f.is_current and f.status <> 'dismissed' and f.severity <> '';
  update te_claims set
      approved_total = coalesce((select sum(coalesce(x.approved_amount, 0)) from te_expenses x
                                  where x.claim_id = p_claim_id and x.paid_by = 'self'), 0),
      risk_score = v_score,
      risk_band = case when v_score >= coalesce((v_b->>'high')::int, 8) then 'High'
                       when v_score >= coalesce((v_b->>'medium')::int, 3) then 'Medium' else 'Low' end
    where id = p_claim_id;
end;
$$;

-- LINE DECISIONS. p_decisions = {"<expense id>": {"amount": 800, "reject": "final|refile", "reason": "…"}}
-- An approver can reduce a line or reject it, each with a reason. An approver
-- cannot raise an amount, with one exception: a line the system capped for a
-- longer route or the daily distance (flags G3, G10) can be raised back up to
-- what was claimed, with a reason, when the detour was genuine.
create or replace function te__apply_decisions(p_claim_id uuid, p_decisions jsonb, p_actor uuid, p_step_id uuid default null)
returns void language plpgsql as $$
declare
  c        te_claims;
  k        text;
  d        jsonb;
  x        te_expenses;
  v_amt    numeric;
  v_reason text;
  v_lift   boolean;
  v_name   text;
begin
  if p_decisions is null or jsonb_typeof(p_decisions) <> 'object' then
    return;
  end if;
  select * into c from te_claims where id = p_claim_id;

  -- 1. check everything before changing anything
  for k, d in select * from jsonb_each(p_decisions) loop
    if d is null or jsonb_typeof(d) <> 'object' then continue; end if;
    select * into x from te_expenses where id = k::uuid and claim_id = p_claim_id;
    if not found then
      perform te_fail('TE_DECISION', 'A line in this decision is not part of the claim.');
    end if;
    v_amt    := nullif(d->>'amount', '')::numeric;
    v_reason := nullif(btrim(coalesce(d->>'reason', '')), '');
    v_lift   := exists (select 1 from te_flags f where f.claim_id = p_claim_id and f.expense_id = x.id and f.is_current and f.check_code in ('G3','G10'));
    if v_amt is not null and v_amt < 0 then
      perform te_fail('TE_DECISION', 'An amount cannot be negative.');
    end if;
    if v_amt is not null and v_amt > coalesce(x.approved_amount, 0) then
      if v_lift and v_amt <= x.claimed_amount then
        if v_reason is null then
          perform te_fail('TE_DECISION', 'Say why you accept the longer route.');
        end if;
      else
        perform te_fail('TE_DECISION', case when v_lift then 'You can raise it up to the amount claimed, ' || te_rs(x.claimed_amount) || '.'
                                            else 'An approver cannot increase an amount.' end);
      end if;
    elsif (nullif(d->>'reject', '') is not null or (v_amt is not null and v_amt < coalesce(x.approved_amount, 0))) and v_reason is null then
      perform te_fail('TE_DECISION', 'Give a reason for every reduced or rejected line.');
    end if;
  end loop;

  -- 2. apply
  for k, d in select * from jsonb_each(p_decisions) loop
    if d is null or jsonb_typeof(d) <> 'object' then continue; end if;
    select * into x from te_expenses where id = k::uuid and claim_id = p_claim_id;
    v_amt    := nullif(d->>'amount', '')::numeric;
    v_reason := nullif(btrim(coalesce(d->>'reason', '')), '');
    v_name   := coalesce(x.merchant, (select t.name from te_categories t where t.company_id = x.company_id and t.code = x.category_code), 'line');

    if nullif(d->>'reject', '') is not null then
      insert into te_line_decisions (claim_id, expense_id, step_id, decided_by, decision, amount_before, amount_after, reason)
      values (p_claim_id, x.id, p_step_id, p_actor, case when d->>'reject' = 'refile' then 'reject_refile' else 'reject_final' end,
              x.approved_amount, 0, coalesce(v_reason, 'Rejected'));
      update te_expenses set approved_amount = 0, decision_reason = coalesce(v_reason, 'Rejected'),
             line_decision = case when d->>'reject' = 'refile' then 'REJECTED_REFILE' else 'REJECTED_FINAL' end
       where id = x.id;
      perform te__claim_log(c, 'LINE_REJECTED', 'Rejected line ' || v_name || ': ' || coalesce(v_reason, 'Rejected'), p_actor);
    elsif v_amt is not null and v_amt > coalesce(x.approved_amount, 0) then
      insert into te_line_decisions (claim_id, expense_id, step_id, decided_by, decision, amount_before, amount_after, reason)
      values (p_claim_id, x.id, p_step_id, p_actor, 'accept_above_cap', x.approved_amount, v_amt, v_reason);
      update te_expenses set approved_amount = v_amt, decision_reason = 'Accepted by approver: ' || v_reason,
             line_decision = case when v_amt < x.claimed_amount then 'PARTLY_APPROVED' end
       where id = x.id;
      perform te__claim_log(c, 'LINE_RAISED', 'Accepted ' || v_name || ' above the cap, ' || te_rs(x.approved_amount) || ' to ' || te_rs(v_amt) || ': ' || v_reason, p_actor);
    elsif v_amt is not null and v_amt < coalesce(x.approved_amount, 0) then
      insert into te_line_decisions (claim_id, expense_id, step_id, decided_by, decision, amount_before, amount_after, reason)
      values (p_claim_id, x.id, p_step_id, p_actor, 'reduce', x.approved_amount, v_amt, v_reason);
      update te_expenses set approved_amount = v_amt, decision_reason = v_reason, line_decision = 'PARTLY_APPROVED' where id = x.id;
      perform te__claim_log(c, 'LINE_REDUCED', 'Reduced ' || v_name || ' from ' || te_rs(x.approved_amount) || ' to ' || te_rs(v_amt) || ': ' || v_reason, p_actor);
    end if;
  end loop;
  perform te__claim_recalc(p_claim_id);
end;
$$;

-- Which lines the employee may edit after a send-back. No list = every self-paid line.
create or replace function te__mark_fix(p_claim_id uuid, p_fix jsonb)
returns text language plpgsql as $$
declare
  v_ids   uuid[];
  v_names text;
begin
  select coalesce(array_agg(x.id), '{}') into v_ids
    from te_expenses x
   where x.claim_id = p_claim_id and x.paid_by = 'self'
     and jsonb_typeof(p_fix) = 'array'
     and x.id::text in (select jsonb_array_elements_text(p_fix));
  update te_expenses set needs_fix = (cardinality(v_ids) = 0 or id = any (v_ids))
   where claim_id = p_claim_id and paid_by = 'self';
  update te_claims set fix_all = (cardinality(v_ids) = 0) where id = p_claim_id;
  if cardinality(v_ids) = 0 then
    return ' Every line can be edited.';
  end if;
  select string_agg(coalesce(x.merchant, x.category_code), ', ') into v_names from te_expenses x where x.id = any (v_ids);
  return ' Lines to fix: ' || v_names || '.';
end;
$$;

-- Mark a claim settled; close its trip when no other claim of the trip is open.
create or replace function te__settle(p_claim_id uuid, p_actor uuid, p_text text)
returns void language plpgsql as $$
declare
  c te_claims;
begin
  update te_claims set status = 'SETTLED', settled_at = now() where id = p_claim_id returning * into c;
  -- a line cut to nothing was not paid
  update te_expenses set status = case when coalesce(approved_amount, 0) > 0 or paid_by = 'company' then 'PAID' else 'REJECTED_FINAL' end
   where claim_id = p_claim_id and status in ('APPROVED','PARTLY_APPROVED');
  perform te__claim_log(c, 'CLAIM_SETTLED', p_text, p_actor);
  perform te__finance_queue(c.id, 'SETTLED', p_actor, p_text);
  if c.trip_id is not null and not exists (
       select 1 from te_claims k where k.trip_id = c.trip_id and k.status not in ('SETTLED','REJECTED','CANCELLED')) then
    update te_trips set status = 'CLOSED' where id = c.trip_id;
  end if;
end;
$$;

-- THE END OF VERIFICATION. Net the approved amount against whatever the
-- employee still holds from the trip advance. The debt lives on the advance,
-- never on the claim.
create or replace function te__finalize(p_claim_id uuid, p_actor uuid)
returns void language plpgsql as $$
declare
  c      te_claims;
  a      te_advances;
  v_out  numeric := 0;
  v_adj  numeric := 0;
  v_net  numeric;
  v_refile uuid[];
begin
  perform te__claim_recalc(p_claim_id);
  select * into c from te_claims where id = p_claim_id;
  if c.trip_id is not null then
    select * into a from te_advances x
     where x.trip_id = c.trip_id and x.employee_id = c.employee_id and x.status in ('PAID','PART_SETTLED','RECOVERY_DUE')
     limit 1 for update;
    v_out := coalesce(a.outstanding_amount, 0);
  end if;
  v_adj := least(c.approved_total, v_out);
  v_net := c.approved_total - v_out;
  update te_claims set advance_adjusted = v_adj, net_amount = v_net, verified_at = now() where id = c.id returning * into c;

  if a.id is not null and v_out > 0 then
    update te_advances set outstanding_amount = v_out - v_adj,
                           status = case when v_out - v_adj = 0 then 'SETTLED' else 'RECOVERY_DUE' end,
                           actioned_by = p_actor
     where id = a.id;
    insert into te_settlements (company_id, advance_id, claim_id, amount, kind, created_by)
    values (c.company_id, a.id, c.id, v_adj, 'net_off', p_actor);
    perform te__claim_log(c, 'ADVANCE_ADJUSTED', te_rs(v_adj) || ' adjusted against advance ' || a.advance_no
      || case when v_out - v_adj > 0 then '. ' || te_rs(v_out - v_adj) || ' stays on the advance for recovery.' else '.' end, null);
  end if;

  -- Each line takes its final status. A line rejected for weak proof goes back
  -- to the employee as a saved line without its file, so a better bill can be
  -- attached and the line filed again.
  select coalesce(array_agg(x.id), '{}') into v_refile from te_expenses x where x.claim_id = c.id and x.line_decision = 'REJECTED_REFILE';
  delete from te_expense_files where expense_id = any (v_refile);
  update te_expenses set status = 'UNCLAIMED', claim_id = null, line_decision = null, needs_fix = false,
         eligible_amount = null, approved_amount = null, period_id = null,
         decision_reason = 'Returned: ' || coalesce(decision_reason, 'attach a clearer bill')
   where id = any (v_refile);
  update te_expenses set status = case
           when line_decision = 'REJECTED_FINAL' then 'REJECTED_FINAL'
           when line_decision = 'PARTLY_APPROVED' or coalesce(approved_amount, 0) < case when paid_by = 'self' then claimed_amount else 0 end then 'PARTLY_APPROVED'
           else 'APPROVED' end
   where claim_id = c.id;

  if v_net > 0 then
    update te_claims set status = 'VERIFIED' where id = c.id;
    perform te__claim_log(c, 'CLAIM_VERIFIED', 'Net payable ' || te_rs(v_net) || '. Waiting for a payout batch.', null);
    perform te__finance_queue(c.id, 'APPROVED', p_actor, 'Verified');
    perform te_notify(c.employee_id, 'CLAIM_VERIFIED', 'Claim ' || c.claim_no || ' verified',
                      te_rs(v_net) || ' will be paid in the next payout.', '/ess?tab=claims&ref=' || c.id);
  else
    perform te__settle(c.id, null, case when v_adj > 0 then 'Nothing to pay. The advance covers this claim.' else 'Nothing to pay. No amount was approved.' end);
    perform te_notify(c.employee_id, 'CLAIM_SETTLED', 'Claim ' || c.claim_no || ' settled',
                      case when v_adj > 0 then 'Your advance covers this claim. Nothing more is payable.' else 'No amount was approved on this claim.' end,
                      '/ess?tab=claims&ref=' || c.id);
  end if;
end;
$$;

-- A CLAIM ENTERS VERIFICATION, after the last approval level or directly.
create or replace function te__enter_verification(p_claim_id uuid)
returns void language plpgsql as $$
declare
  c        te_claims;
  s        te_settings;
  v_serial bigint;
  v_every  int;
  v_sample boolean := false;
  v_inpol  boolean;
begin
  update te_claims set stage = 'finance' where id = p_claim_id;
  perform te__claim_recalc(p_claim_id);
  select * into c from te_claims where id = p_claim_id;
  select * into s from te_settings where company_id = c.company_id;

  -- the random audit sample (check F4): every Nth claim, N = 100 / sample %
  v_serial := coalesce(nullif(substring(c.claim_no from '([0-9]+)$'), '')::bigint, 0);
  v_every  := case when s.sample_pct > 0 then greatest(1, round(100 / s.sample_pct))::int else 0 end;
  if v_every > 0 and coalesce((select k.is_enabled from te_checks k where k.company_id = c.company_id and k.code = 'F4'), true) then
    v_sample := (v_serial % v_every) = 0;
  end if;
  v_inpol := not exists (select 1 from te_flags f where f.claim_id = c.id and f.is_current and f.status <> 'dismissed'
                           and (f.check_code = 'POL' or f.severity in ('medium','high') or f.action = 'justify'));
  update te_claims set sampled = v_sample where id = c.id;

  if c.risk_band = 'High' or v_sample then
    update te_claims set status = 'ON_HOLD' where id = c.id;
    perform te__claim_log(c, 'CLAIM_ON_HOLD', case when c.risk_band = 'High' then 'Risk band is High. Placed on hold for Finance audit.'
                                                  else 'Picked by the random audit sample. Placed on hold.' end, null, false);
    perform te__finance_queue(c.id, 'PENDING');
    perform te__notify_waiting('claim', c.id, 'Claim ' || c.claim_no || ' is on hold for audit', te_emp_name(c.employee_id) || ', ' || te_rs(c.claimed_total));
  elsif c.risk_band = 'Low' and v_inpol and c.claimed_total <= s.fast_track_amount then
    update te_claims set auto_verified = true where id = c.id;
    update te_approval_steps set status = 'auto', acted_at = now()
     where entity_type = 'claim' and entity_id = c.id and stage = 'finance' and status = 'pending';
    perform te__claim_log(c, 'CLAIM_AUTO_VERIFIED', 'Low risk, fully in policy and under ' || te_rs(s.fast_track_amount) || '. Auto-verified.', null);
    perform te__finalize(c.id, null);
  else
    update te_claims set status = 'IN_VERIFICATION' where id = c.id;
    perform te__claim_log(c, 'CLAIM_TO_FINANCE', 'Moved to Finance verification.', null);
    perform te__finance_queue(c.id, 'PENDING');
    perform te__notify_waiting('claim', c.id, 'Claim ' || c.claim_no || ' is waiting for Finance', te_emp_name(c.employee_id) || ', ' || te_rs(c.claimed_total));
  end if;
end;
$$;

create or replace function te__reject_claim(p_claim_id uuid, p_actor uuid, p_comment text, p_role text default null)
returns void language plpgsql as $$
declare
  c te_claims;
  a te_advances;
begin
  select * into c from te_claims where id = p_claim_id;
  update te_approval_steps set status = 'cancelled'
   where entity_type = 'claim' and entity_id = c.id and status = 'pending';
  update te_expenses set status = 'REJECTED_FINAL', approved_amount = 0, decision_reason = 'Claim rejected: ' || p_comment, line_decision = null
   where claim_id = c.id;
  update te_claims set status = 'REJECTED', rejected_from = c.stage, reject_reason = p_comment, approved_total = 0, net_amount = 0
   where id = c.id;
  perform te__claim_log(c, 'CLAIM_REJECTED', 'Rejected: ' || p_comment, p_actor, true, p_role);
  perform te__finance_queue(c.id, 'REJECTED', p_actor, p_comment);
  perform te_notify(c.employee_id, 'CLAIM_REJECTED', 'Claim ' || c.claim_no || ' rejected', p_comment, '/ess?tab=claims&ref=' || c.id, 'HIGH', p_actor);

  if c.trip_id is not null then
    if not exists (select 1 from te_claims k where k.trip_id = c.trip_id and k.id <> c.id
                      and k.status not in ('REJECTED','CANCELLED')) then
      update te_trips set status = case when c.is_post_facto then 'REJECTED' else 'CLOSED' end where id = c.trip_id;
    elsif not exists (select 1 from te_claims k where k.trip_id = c.trip_id and k.id <> c.id
                         and k.status not in ('SETTLED','REJECTED','CANCELLED')) then
      update te_trips set status = 'CLOSED' where id = c.trip_id;
    end if;
    select * into a from te_advances x where x.trip_id = c.trip_id and x.status in ('PAID','PART_SETTLED') and x.outstanding_amount > 0;
    if found then
      update te_advances set status = 'RECOVERY_DUE' where id = a.id;
      perform te__claim_log(c, 'ADVANCE_RECOVERY', 'Advance ' || a.advance_no || ' of ' || te_rs(a.outstanding_amount) || ' is now due for recovery.', null);
    end if;
  end if;
end;
$$;

-- store one round of flags from an engine assessment
create or replace function te__write_flags(p_claim_id uuid, p_flags jsonb, p_round int)
returns void language sql as $$
  update te_flags set is_current = false where claim_id = p_claim_id and is_current;
  insert into te_flags (claim_id, expense_id, check_code, title, evidence, evidence_employee, action, severity, is_blocking, needs_reason, round)
  select p_claim_id, nullif(coalesce(f->>'lineId', f->>'line_id'), '')::uuid, f->>'code', coalesce(f->>'title', f->>'code'),
         f->>'evidence', nullif(f->>'evEmp', ''), f->>'action', coalesce(nullif(f->>'sev', ''), ''),
         coalesce((f->>'block')::boolean, false), coalesce((f->>'needsReason')::boolean, false), p_round
    from jsonb_array_elements(coalesce(p_flags, '[]'::jsonb)) f;
$$;

-- store the engine's per-line result: eligible amount after policy caps
--   p_rows = [{"id","eligible"}]  and, for an own-vehicle line only, {"claimed","pay_km","rate"}:
--   the engine prices the drive again at submit (the rate or the day's other
--   drives may have changed since the line was saved), so the amount of a
--   mileage line is the engine's, never the browser's.
create or replace function te__write_rows(p_claim_id uuid, p_rows jsonb, p_period uuid)
returns void language sql as $$
  -- a company-paid line is never reimbursed; a self-paid line is never eligible for more than was claimed
  update te_expenses x
     set bill_amount     = r.nbill,
         claimed_amount  = r.nclaimed,
         payable_km      = r.nkm,
         rate_applied    = r.nrate,
         eligible_amount = case when x.paid_by = 'self' then least(r.eligible, r.nclaimed) else 0 end,
         approved_amount = case when x.paid_by = 'self' then least(r.eligible, r.nclaimed) else 0 end,
         decision_reason = case when x.paid_by = 'self' and r.eligible < r.nclaimed then 'Capped to policy limit' end,
         line_decision = null, needs_fix = false,
         claim_id = p_claim_id, status = 'IN_CLAIM', period_id = p_period
    from (select k.id,
                 greatest(0, coalesce((e->>'eligible')::numeric, 0)) as eligible,
                 case when k.category_code = 'mileage' and k.paid_by = 'self' and e->>'claimed' is not null
                      then greatest(0, (e->>'claimed')::numeric) else k.claimed_amount end as nclaimed,
                 case when k.category_code = 'mileage' and k.paid_by = 'self' and e->>'claimed' is not null
                      then greatest(0, (e->>'claimed')::numeric) else k.bill_amount end as nbill,
                 case when k.category_code = 'mileage' then coalesce(nullif(e->>'pay_km', '')::numeric, k.payable_km) else k.payable_km end as nkm,
                 case when k.category_code = 'mileage' then coalesce(nullif(e->>'rate', '')::numeric, k.rate_applied) else k.rate_applied end as nrate
            from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) e
            join te_expenses k on k.id = (e->>'id')::uuid) r
   where x.id = r.id
     and (x.claim_id = p_claim_id or (x.claim_id is null and x.status = 'UNCLAIMED'));
$$;


-- ============================================================================
-- SECTION 3 — SUBMIT
-- ============================================================================

-- p = {
--   "employee_id": "<uuid>",
--   "trip_id": "<uuid>" | null,           -- null = other expenses (a GENERAL claim)
--   "line_ids": ["<uuid>", …],            -- company-paid lines of the trip travel with it
--   "note": "…",
--   "declared": true,                     -- "I confirm these are genuine business expenses"
--   "assessment": {                       -- computed by the engine: assess()
--     "eligible": 4180, "score": 3, "band": "Medium", "exception": false,
--     "rows":  [{"id": "<expense id>", "eligible": 820}, …],      -- own vehicle: + "claimed","pay_km","rate"
--     "flags": [{"lineId","code","title","evidence","evEmp","action","sev","block","needsReason"}, …]
--   }
-- }
create or replace function te_claim_submit(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_emp     uuid := nullif(p->>'employee_id', '')::uuid;
  v_trip    uuid := nullif(p->>'trip_id', '')::uuid;
  v_company uuid;
  t         te_trips;
  a         jsonb := coalesce(p->'assessment', '{}'::jsonb);
  v_ids     uuid[];
  v_open    te_legs;
  v_n       int;
  v_claimed numeric;
  v_last    date;
  v_period  uuid;
  v_late    boolean;
  v_seq     int;
  v_notes   text[];
  c         te_claims;
  v_mgr     int;
begin
  if v_emp is distinct from p_actor then
    perform te_fail('TE_FORBIDDEN', 'You can only submit your own claims.');
  end if;
  perform te_assert_active(v_emp);
  select company_id into v_company from employees where id = v_emp;

  select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p->'line_ids', '[]'::jsonb)) x;
  if cardinality(v_ids) = 0 then
    perform te_fail('TE_CLAIM', 'Add at least one expense line.');
  end if;

  if v_trip is not null then
    select * into t from te_trips where id = v_trip for update;
    if not found or t.employee_id <> v_emp then
      perform te_fail('TE_CLAIM', 'That trip is not yours.');
    end if;
    -- A claim needs an approved trip. (A trip recorded after travel is a DRAFT
    -- until its claim is sent: the claim is what gets approved. CLAIMED and
    -- CLOSED allow a supplementary claim for a bill that turned up later.)
    if not (t.status in ('APPROVED','CLAIMED','CLOSED') or (t.status = 'DRAFT' and t.origin = 'POST_FACTO')) then
      perform te_fail('TE_CLAIM', case t.status
        when 'PENDING_APPROVAL' then 'The trip is waiting for approval. Send the claim once it is approved.'
        when 'SENT_BACK' then 'The trip plan was sent back to you. Answer that first.'
        else 'This trip was ' || lower(t.status) || '. Nothing can be claimed on it.' end);
    end if;
    select * into v_open from te_legs l where l.trip_id = v_trip and l.status in ('PLANNED','ACTIVE','PAUSED','ENDED') order by l.leg_no limit 1;
    if found then
      perform te_fail('TE_CLAIM', 'Close every leg first. Leg ' || v_open.leg_no || ' is ' || case v_open.status
        when 'ENDED' then 'waiting for its report.' when 'PLANNED' then 'not recorded: add it without GPS or skip it.' else 'still running.' end);
    end if;
  end if;

  -- lock the lines first: a second submit of the same lines waits here, then finds them taken
  perform 1 from te_expenses x where x.id = any (v_ids) order by x.id for update;
  -- every line is this employee's, saved, not in a claim, and belongs to this trip (or to no trip)
  select count(*) into v_n from te_expenses x
   where x.id = any (v_ids) and x.employee_id = v_emp and x.status = 'UNCLAIMED' and x.claim_id is null
     and x.trip_id is not distinct from v_trip;
  if v_n <> cardinality(v_ids) then
    perform te_fail('TE_CLAIM', 'One of these lines is already in a claim, or does not belong here. Refresh and try again.');
  end if;

  if exists (select 1 from jsonb_array_elements(coalesce(a->'flags', '[]'::jsonb)) f where coalesce((f->>'block')::boolean, false)) then
    perform te_fail('TE_CLAIM', 'Fix the blocked lines first.');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(a->'flags', '[]'::jsonb)) f where coalesce((f->>'needsReason')::boolean, false)) then
    perform te_fail('TE_CLAIM', 'Add a reason where one is asked.');
  end if;
  if not coalesce((p->>'declared')::boolean, false) then
    perform te_fail('TE_CLAIM', 'Accept the declaration to submit.');
  end if;
  -- the engine's result must cover exactly these lines
  if (select count(*) from jsonb_array_elements(coalesce(a->'rows', '[]'::jsonb))) <> cardinality(v_ids)
     or exists (select 1 from jsonb_array_elements(coalesce(a->'rows', '[]'::jsonb)) e where not ((e->>'id')::uuid = any (v_ids))) then
    perform te_fail('TE_CLAIM', 'The claim could not be checked. Try again.');
  end if;

  select max(x.expense_date) into v_last from te_expenses x where x.id = any (v_ids);
  -- this month and the next always exist, whether or not the nightly job has run
  perform travel_ensure_period(v_company, te_today(v_company));
  perform travel_ensure_period(v_company, (date_trunc('month', te_today(v_company)) + interval '1 month')::date);
  select f.period_id, f.is_late into v_period, v_late from te_period_for(v_company, coalesce(t.end_date, v_last)) f;
  -- 0 = the main claim of the trip, 1+ = a supplementary one. A recalled claim does not use up a number.
  select coalesce(max(k.claim_seq) + 1, 0) into v_seq from te_claims k
   where k.trip_id = v_trip and k.employee_id = v_emp and v_trip is not null and k.status <> 'CANCELLED';

  insert into te_claims (company_id, claim_no, employee_id, trip_id, claim_type, claim_seq, period_id, is_late, note,
                         claimed_total, eligible_total, approved_total, risk_score, risk_band, is_exception, is_post_facto,
                         declaration_at, stage, status, submitted_at, first_submitted_at, workflow_version)
  values (v_company, te_next_no(v_company, 'claim'), v_emp, v_trip, case when v_trip is null then 'GENERAL' else 'TRIP' end,
          coalesce(v_seq, 0), v_period, v_late, nullif(btrim(p->>'note'), ''),
          0, coalesce((a->>'eligible')::numeric, 0), coalesce((a->>'eligible')::numeric, 0),
          coalesce((a->>'score')::int, 0), coalesce(nullif(a->>'band', ''), 'Low'),
          coalesce((a->>'exception')::boolean, false), coalesce(t.origin = 'POST_FACTO', false),
          now(), 'manager', 'IN_APPROVAL', now(), now(),
          (select w.version from te_workflows w where w.company_id = v_company and w.code = 'claim'))
  returning * into c;

  perform te__write_rows(c.id, a->'rows', v_period);
  perform te__write_flags(c.id, a->'flags', 1);
  -- the totals come from the lines as they are stored, never from the payload
  select coalesce(sum(case when x.paid_by = 'self' then x.claimed_amount else 0 end), 0) into v_claimed
    from te_expenses x where x.claim_id = c.id;
  update te_claims set claimed_total = v_claimed,
                       eligible_total = coalesce((select sum(x.eligible_amount) from te_expenses x where x.claim_id = c.id), 0)
   where id = c.id;
  perform te__claim_recalc(c.id);
  select * into c from te_claims where id = c.id;

  v_notes := te_build_steps(v_company, 'claim', c.id, v_emp,
               jsonb_build_object('total', v_claimed, 'scope', t.scope, 'postFacto', c.is_post_facto,
                                  'exception', c.is_exception, 'band', c.risk_band),
               case when v_trip is not null then te_trip_co(v_trip) else '{}'::uuid[] end);
  update te_claims set chain_notes = v_notes where id = c.id;
  -- Nobody to verify = nobody to pay it. Better to say so now than to leave the claim waiting for no one.
  if not exists (select 1 from te_approval_steps s where s.entity_type = 'claim' and s.entity_id = c.id and s.stage = 'finance') then
    perform te_fail('TE_NOT_SET_UP', 'Nobody is set up to verify claims. Ask your admin to add a Finance team member or a fallback approver.');
  end if;

  if v_trip is not null then
    update te_trips set status = 'CLAIMED' where id = v_trip;
    perform te_log(v_company, 'trip', t.id, t.trip_no, 'CLAIM_SENT', p_actor,
                   'Claim ' || c.claim_no || ' sent: ' || cardinality(v_ids) || case when cardinality(v_ids) = 1 then ' line, ' else ' lines, ' end || te_rs(v_claimed) || '.');
  end if;
  perform te__claim_log(c, 'CLAIM_SUBMITTED', 'Submitted with declaration. ' || cardinality(v_ids)
                          || case when cardinality(v_ids) = 1 then ' line, ' else ' lines, ' end || te_rs(v_claimed) || ' claimed.', p_actor);

  select count(*) into v_mgr from te_approval_steps s where s.entity_type = 'claim' and s.entity_id = c.id and s.stage = 'manager';
  if v_mgr = 0 then
    perform te__claim_log(c, 'CLAIM_NO_APPROVER', 'No approval level applies in the workflow. Sent to Finance.', null);
    perform te__enter_verification(c.id);
  else
    perform te__notify_waiting('claim', c.id, 'Claim ' || c.claim_no || ' from ' || te_emp_name(v_emp),
                               te_rs(v_claimed) || ' is waiting for your approval.', p_actor);
  end if;

  select * into c from te_claims where id = c.id;
  return jsonb_build_object('claim_id', c.id, 'claim_no', c.claim_no, 'status', c.status, 'stage', c.stage,
                            'risk_band', c.risk_band, 'chain_notes', to_jsonb(c.chain_notes));
end;
$$;


-- ============================================================================
-- SECTION 4 — APPROVAL LEVELS
-- ============================================================================

-- p_action = approve | sendback | reject
-- p_decisions: line decisions (see te__apply_decisions)     p_fix: ["<expense id>", …] for a send-back
create or replace function te_claim_decide(
  p_claim_id uuid, p_actor uuid, p_action text, p_comment text default null,
  p_decisions jsonb default null, p_fix jsonb default null
)
returns jsonb language plpgsql as $$
declare
  c      te_claims;
  st     te_approval_steps;
  v_why  text;
  v_note text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into c from te_claims where id = p_claim_id for update;
  if not found then
    perform te_fail('TE_CLAIM', 'Claim not found.');
  end if;
  if c.status <> 'IN_APPROVAL' then
    perform te_fail('TE_NOT_WAITING', 'This claim is not waiting for you.');
  end if;
  if p_actor = c.employee_id then
    perform te_fail('TE_FORBIDDEN', 'Nobody approves their own claim.');
  end if;
  st := te_current_step('claim', c.id, 'manager');
  v_why := te_step_block_reason(st, p_actor);
  if v_why <> '' then
    perform te_fail('TE_NOT_WAITING', v_why);
  end if;
  if p_action not in ('approve','sendback','reject') then
    perform te_fail('TE_CLAIM', 'Unknown action.');
  end if;
  if p_action <> 'approve' and v_note is null then
    perform te_fail('TE_COMMENT', 'Write a comment so the employee knows why.');
  end if;

  if p_action = 'approve' then
    perform te__apply_decisions(c.id, p_decisions, p_actor, st.id);
    update te_approval_steps set status = 'approved', acted_by = p_actor, acted_at = now(), comment = v_note,
                                 delegated_from = case when p_actor <> st.approver_id then st.approver_id end
     where id = st.id;
    perform te__claim_log(c, 'CLAIM_STEP_APPROVED', 'Approved as ' || st.role_label || coalesce(': ' || v_note, '.'), p_actor, true, st.role_label);
    if (te_current_step('claim', c.id, 'manager')).id is null then
      perform te__enter_verification(c.id);
    else
      perform te__notify_waiting('claim', c.id, 'Claim ' || c.claim_no || ' from ' || te_emp_name(c.employee_id),
                                 te_rs(c.claimed_total) || ' is waiting for your approval.', p_actor);
    end if;

  elsif p_action = 'sendback' then
    v_why := te__mark_fix(c.id, p_fix);
    update te_claims set status = 'SENT_BACK', sent_back_from = 'manager' where id = c.id;
    insert into te_messages (entity_type, entity_id, author_id, body) values ('claim', c.id, p_actor, v_note);
    perform te__claim_log(c, 'CLAIM_SENT_BACK', 'Sent back: ' || v_note || v_why, p_actor, true, st.role_label);
    perform te_notify(c.employee_id, 'CLAIM_SENT_BACK', 'Claim ' || c.claim_no || ' needs your answer', v_note, '/ess?tab=claims&ref=' || c.id, 'HIGH', p_actor);

  else
    update te_approval_steps set status = 'rejected', acted_by = p_actor, acted_at = now(), comment = v_note where id = st.id;
    perform te__reject_claim(c.id, p_actor, v_note, st.role_label);
  end if;

  select * into c from te_claims where id = c.id;
  return jsonb_build_object('claim_id', c.id, 'status', c.status, 'stage', c.stage, 'net_amount', c.net_amount);
end;
$$;


-- ============================================================================
-- SECTION 5 — FINANCE LEVELS
-- ============================================================================

-- p_action = verify | hold | sendback | reject
create or replace function te_claim_finance(
  p_claim_id uuid, p_actor uuid, p_action text, p_comment text default null,
  p_decisions jsonb default null, p_fix jsonb default null
)
returns jsonb language plpgsql as $$
declare
  c      te_claims;
  st     te_approval_steps;
  nx     te_approval_steps;
  v_why  text;
  v_note text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into c from te_claims where id = p_claim_id for update;
  if not found then
    perform te_fail('TE_CLAIM', 'Claim not found.');
  end if;
  if c.status not in ('IN_VERIFICATION','ON_HOLD') then
    perform te_fail('TE_NOT_WAITING', 'This claim is not in verification.');
  end if;
  if p_actor = c.employee_id then
    perform te_fail('TE_FORBIDDEN', 'Nobody can verify their own claim.');
  end if;
  st := te_current_step('claim', c.id, 'finance');
  v_why := te_step_block_reason(st, p_actor);
  if v_why <> '' then
    perform te_fail('TE_NOT_WAITING', v_why);
  end if;
  if p_action not in ('verify','hold','sendback','reject') then
    perform te_fail('TE_CLAIM', 'Unknown action.');
  end if;

  if p_action = 'verify' then
    if c.status = 'ON_HOLD' and v_note is null then
      perform te_fail('TE_COMMENT', 'An audit note is mandatory for a claim on hold.');
    end if;
    perform te__apply_decisions(c.id, p_decisions, p_actor, st.id);
    update te_approval_steps set status = 'approved', acted_by = p_actor, acted_at = now(), comment = v_note,
                                 delegated_from = case when st.approver_id is not null and p_actor <> st.approver_id then st.approver_id end
     where id = st.id;
    perform te__claim_log(c, 'CLAIM_STEP_VERIFIED',
                          case when c.status = 'ON_HOLD' then 'Audit cleared' else 'Verified' end || ' as ' || st.role_label || coalesce(': ' || v_note, '.'),
                          p_actor, true, st.role_label);
    nx := te_current_step('claim', c.id, 'finance');
    if nx.id is not null then
      update te_claims set status = 'IN_VERIFICATION' where id = c.id;
      perform te__claim_log(c, 'CLAIM_NEXT_FINANCE', 'Next: ' || nx.role_label || ', '
                              || case when nx.team_code is not null then 'Finance team' else te_emp_name(nx.approver_id) end || '.', null);
      perform te__notify_waiting('claim', c.id, 'Claim ' || c.claim_no || ' is waiting for you', nx.role_label, p_actor);
    else
      perform te__finalize(c.id, p_actor);
    end if;

  elsif v_note is null then
    perform te_fail('TE_COMMENT', 'Write a comment so the employee knows why.');

  elsif p_action = 'hold' then
    update te_claims set status = 'ON_HOLD' where id = c.id;
    perform te__claim_log(c, 'CLAIM_ON_HOLD', 'Held for audit: ' || v_note, p_actor, false, st.role_label);

  elsif p_action = 'sendback' then
    v_why := te__mark_fix(c.id, p_fix);
    update te_claims set status = 'SENT_BACK', sent_back_from = c.status where id = c.id;
    insert into te_messages (entity_type, entity_id, author_id, body) values ('claim', c.id, p_actor, v_note);
    perform te__claim_log(c, 'CLAIM_SENT_BACK', 'Sent back: ' || v_note || v_why, p_actor, true, st.role_label);
    perform te_notify(c.employee_id, 'CLAIM_SENT_BACK', 'Claim ' || c.claim_no || ' needs your answer', v_note, '/ess?tab=claims&ref=' || c.id, 'HIGH', p_actor);

  else
    update te_approval_steps set status = 'rejected', acted_by = p_actor, acted_at = now(), comment = v_note where id = st.id;
    perform te__reject_claim(c.id, p_actor, v_note, st.role_label);
  end if;

  select * into c from te_claims where id = c.id;
  return jsonb_build_object('claim_id', c.id, 'status', c.status, 'stage', c.stage, 'net_amount', c.net_amount,
                            'advance_adjusted', c.advance_adjusted);
end;
$$;

-- Finance dismisses or confirms a flag, with a reason. The risk score follows.
create or replace function te_flag_resolve(p_flag_id uuid, p_actor uuid, p_status text, p_note text)
returns jsonb language plpgsql as $$
declare
  f te_flags;
  c te_claims;
begin
  select * into f from te_flags where id = p_flag_id for update;
  if not found then
    perform te_fail('TE_FLAG', 'Flag not found.');
  end if;
  select * into c from te_claims where id = f.claim_id for update;
  if p_status not in ('dismissed','confirmed') then
    perform te_fail('TE_FLAG', 'Choose dismiss or confirm.');
  end if;
  if coalesce(btrim(p_note), '') = '' then
    perform te_fail('TE_COMMENT', 'Give a reason.');
  end if;
  if p_actor = c.employee_id or not (p_actor = any (te_finance_members(c.company_id))) then
    perform te_fail('TE_FORBIDDEN', 'Only Finance can dismiss or confirm a flag.');
  end if;
  if c.status not in ('IN_VERIFICATION','ON_HOLD') then
    perform te_fail('TE_NOT_WAITING', 'This claim is not in verification.');
  end if;
  update te_flags set status = p_status, resolve_reason = btrim(p_note), resolved_by = p_actor, resolved_at = now() where id = f.id;
  perform te__claim_recalc(c.id);
  perform te__claim_log(c, 'FLAG_' || upper(p_status), initcap(p_status) || ' flag ' || f.check_code || ': ' || btrim(p_note), p_actor, false);
  return jsonb_build_object('flag_id', f.id, 'status', p_status,
                            'risk_band', (select k.risk_band from te_claims k where k.id = c.id));
end;
$$;


-- ============================================================================
-- SECTION 6 — THE EMPLOYEE'S SIDE AFTER SUBMITTING
-- ============================================================================

-- ANSWER A SEND-BACK. The employee has edited the lines marked to fix; the API
-- ran the engine again (assess) and passes the fresh result as p_assessment.
-- If the total went up, approval starts again from the first approver;
-- otherwise the claim goes back to whoever sent it.
create or replace function te_claim_respond(p_claim_id uuid, p_actor uuid, p_text text, p_assessment jsonb)
returns jsonb language plpgsql as $$
declare
  c         te_claims;
  a         jsonb := coalesce(p_assessment, '{}'::jsonb);
  v_was     numeric;
  v_claimed numeric;
  v_round   int;
  v_mgr     int;
begin
  select * into c from te_claims where id = p_claim_id for update;
  if not found or c.employee_id is distinct from p_actor or c.status <> 'SENT_BACK' then
    perform te_fail('TE_CLAIM', 'Nothing to answer.');
  end if;
  if coalesce(btrim(p_text), '') = '' then
    perform te_fail('TE_COMMENT', 'Write your answer.');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(a->'flags', '[]'::jsonb)) f where coalesce((f->>'block')::boolean, false)) then
    perform te_fail('TE_CLAIM', 'Fix the blocked lines first.');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(a->'flags', '[]'::jsonb)) f where coalesce((f->>'needsReason')::boolean, false)) then
    perform te_fail('TE_CLAIM', 'Add a reason where one is asked.');
  end if;

  v_was := c.claimed_total;
  perform te__write_rows(c.id, a->'rows', c.period_id);
  select coalesce(max(round), 0) + 1 into v_round from te_flags where claim_id = c.id;
  perform te__write_flags(c.id, a->'flags', v_round);
  select coalesce(sum(case when x.paid_by = 'self' then x.claimed_amount else 0 end), 0) into v_claimed
    from te_expenses x where x.claim_id = c.id;
  update te_claims set claimed_total = v_claimed,
                       eligible_total = coalesce((select sum(x.eligible_amount) from te_expenses x where x.claim_id = c.id), 0),
                       is_exception = coalesce((a->>'exception')::boolean, false), fix_all = false
   where id = c.id;
  perform te__claim_recalc(c.id);

  insert into te_messages (entity_type, entity_id, author_id, body) values ('claim', c.id, p_actor, btrim(p_text));
  perform te__claim_log(c, 'CLAIM_ANSWERED', 'Answered and sent again: ' || btrim(p_text), p_actor);

  if v_claimed > v_was then
    -- a higher total can bring in a level that did not apply before (say, the
    -- HOD above ₹30,000), so the chain is worked out again, not just reset
    select * into c from te_claims where id = c.id;
    update te_claims set chain_notes = te_build_steps(c.company_id, 'claim', c.id, c.employee_id,
               jsonb_build_object('total', v_claimed, 'scope', (select t.scope from te_trips t where t.id = c.trip_id),
                                  'postFacto', c.is_post_facto, 'exception', c.is_exception, 'band', c.risk_band),
               case when c.trip_id is not null then te_trip_co(c.trip_id) else '{}'::uuid[] end)
     where id = c.id;
    select count(*) into v_mgr from te_approval_steps s where s.entity_type = 'claim' and s.entity_id = c.id and s.stage = 'manager';
    update te_claims set stage = case when v_mgr > 0 then 'manager' else 'finance' end,
                         status = case when v_mgr > 0 then 'IN_APPROVAL' else 'IN_VERIFICATION' end
     where id = c.id;
    perform te__claim_log(c, 'CLAIM_RESTARTED', 'Total went up from ' || te_rs(v_was) || ' to ' || te_rs(v_claimed)
                            || '. Approval starts again from the first approver.', null);
  else
    update te_claims set status = case when c.sent_back_from = 'manager' then 'IN_APPROVAL' else coalesce(c.sent_back_from, 'IN_VERIFICATION') end
     where id = c.id;
  end if;
  perform te__notify_waiting('claim', c.id, 'Claim ' || c.claim_no || ' was answered', te_emp_name(c.employee_id) || ' replied: ' || left(btrim(p_text), 120), p_actor);

  select * into c from te_claims where id = c.id;
  return jsonb_build_object('claim_id', c.id, 'status', c.status, 'stage', c.stage);
end;
$$;

-- TAKE A CLAIM BACK. Allowed while it is sent back, or before any approver has acted.
create or replace function te_claim_recall(p_claim_id uuid, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  c te_claims;
begin
  select * into c from te_claims where id = p_claim_id for update;
  if not found or c.employee_id is distinct from p_actor then
    perform te_fail('TE_CLAIM', 'Claim not found.');
  end if;
  if not (c.status = 'SENT_BACK'
       or (c.status = 'IN_APPROVAL' and not exists (
             select 1 from te_approval_steps s where s.entity_type = 'claim' and s.entity_id = c.id and s.status = 'approved'))) then
    perform te_fail('TE_CLAIM', 'An approver has already acted.');
  end if;
  update te_expenses set status = 'UNCLAIMED', claim_id = null, needs_fix = false, line_decision = null,
                         eligible_amount = null, approved_amount = null, decision_reason = null, period_id = null
   where claim_id = c.id;
  update te_approval_steps set status = 'cancelled' where entity_type = 'claim' and entity_id = c.id and status = 'pending';
  update te_claims set status = 'CANCELLED' where id = c.id;
  if c.trip_id is not null
     and not exists (select 1 from te_claims k where k.trip_id = c.trip_id and k.id <> c.id
                        and k.status not in ('SETTLED','REJECTED','CANCELLED')) then
    -- back to where the trip was before this claim: closed if an earlier claim
    -- of the trip is already finished, otherwise open for travel again
    update te_trips set status = case
        when exists (select 1 from te_claims k where k.trip_id = c.trip_id and k.id <> c.id and k.status in ('SETTLED','REJECTED')) then 'CLOSED'
        when c.is_post_facto then 'DRAFT' else 'APPROVED' end
     where id = c.trip_id and status = 'CLAIMED';
  end if;
  perform te__claim_log(c, 'CLAIM_RECALLED', 'Recalled by the employee. Lines returned to Unclaimed.', p_actor);
  perform te__finance_queue(c.id, 'CANCELLED', p_actor, 'Recalled');
  return jsonb_build_object('claim_id', c.id, 'status', 'CANCELLED');
end;
$$;

-- REOPEN A REJECTED CLAIM (Finance or an admin, with a reason, until the month
-- is locked). It returns to the stage that rejected it; its lines come back.
create or replace function te_claim_reopen(p_claim_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $$
declare
  c     te_claims;
  v_old boolean := false;
begin
  select * into c from te_claims where id = p_claim_id for update;
  if not found or c.status <> 'REJECTED' then
    perform te_fail('TE_CLAIM', 'Only a rejected claim can be reopened.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Give a reason.');
  end if;
  if p_actor = c.employee_id then
    perform te_fail('TE_FORBIDDEN', 'Nobody reopens their own claim.');
  end if;
  perform te_assert_finance(c.company_id, p_actor);
  -- History copied from the old travel module (optional migration 150) is a
  -- record, not live work: its journeys may have been filed again there.
  if to_regclass('public.te_v1_map') is not null then
    execute 'select exists (select 1 from te_v1_map m where m.te_table = ''te_claims'' and m.te_id = $1)' into v_old using c.id;
    if v_old then
      perform te_fail('TE_CLAIM', 'This claim was copied from the old travel module and cannot be reopened here.');
    end if;
  end if;
  if exists (select 1 from travel_periods p where p.id = c.period_id and p.status = 'LOCKED') then
    perform te_fail('TE_PERIOD_LOCKED', 'The period is locked.');
  end if;
  -- each line comes back as it stood before the rejection: its eligible amount,
  -- or what an approver had already reduced it to
  update te_expenses x
     set status = 'IN_CLAIM',
         approved_amount = least(coalesce(d.amount_after, x.eligible_amount), coalesce(x.eligible_amount, 0), x.claimed_amount),
         decision_reason = d.reason,
         line_decision = case d.decision when 'reduce' then 'PARTLY_APPROVED' when 'reject_final' then 'REJECTED_FINAL' when 'reject_refile' then 'REJECTED_REFILE' end
    from te_expenses y
    left join lateral (select k.* from te_line_decisions k where k.claim_id = c.id and k.expense_id = y.id
                        order by k.created_at desc, k.id desc limit 1) d on true
   where y.id = x.id and x.claim_id = c.id;
  update te_approval_steps set status = 'pending', acted_by = null, acted_at = null, comment = null
   where entity_type = 'claim' and entity_id = c.id and status in ('rejected','cancelled');
  update te_claims set status = case when c.rejected_from = 'finance' then 'IN_VERIFICATION' else 'IN_APPROVAL' end,
                       rejected_from = null, reject_reason = null, net_amount = null
   where id = c.id;
  perform te__claim_recalc(c.id);
  if c.trip_id is not null then
    update te_trips set status = 'CLAIMED' where id = c.trip_id;
  end if;
  perform te__claim_log(c, 'CLAIM_REOPENED', 'Reopened: ' || btrim(p_reason), p_actor);
  if c.rejected_from = 'finance' then
    perform te__finance_queue(c.id, 'PENDING');
  end if;
  return jsonb_build_object('claim_id', c.id, 'status', (select k.status from te_claims k where k.id = c.id));
end;
$$;


-- ============================================================================
-- SECTION 7 — ADVANCES
-- ============================================================================

-- p_action = pay | reject | refund | payroll | carry       p = {"amount","ref"}
--   pay      Finance pays the advance of an approved trip (up to what was asked)
--   refund   the employee returned what was left
--   payroll  what is left is recovered through payroll
--   carry    what is left moves to another approved trip of the same employee
create or replace function te_advance_act(p_advance_id uuid, p_actor uuid, p_action text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$
declare
  a      te_advances;
  t      te_trips;
  nt     te_trips;
  v_amt  numeric := nullif(p->>'amount', '')::numeric;
  v_ref  text := nullif(btrim(coalesce(p->>'ref', '')), '');
  v_days int;
  v_new  uuid;
begin
  select * into a from te_advances where id = p_advance_id for update;
  if not found then
    perform te_fail('TE_ADVANCE', 'Advance not found.');
  end if;
  if p_actor = a.employee_id then
    perform te_fail('TE_FORBIDDEN', 'Nobody handles their own advance.');
  end if;
  -- paying is the stricter right; the rest is Finance bookkeeping
  perform te_assert_finance(a.company_id, p_actor, p_action = 'pay');
  select * into t from te_trips where id = a.trip_id;

  if p_action = 'pay' then
    if a.status not in ('REQUESTED','APPROVED') then
      perform te_fail('TE_ADVANCE', 'Already handled.');
    end if;
    if t.status <> 'APPROVED' then
      perform te_fail('TE_ADVANCE', 'The trip is not approved yet.');
    end if;
    if v_amt is null or v_amt <= 0 or v_amt > a.requested_amount then
      perform te_fail('TE_ADVANCE', 'Enter an amount up to ' || te_rs(a.requested_amount) || '.');
    end if;
    if v_ref is null then
      perform te_fail('TE_ADVANCE', 'Enter the bank reference.');
    end if;
    update te_advances set approved_amount = v_amt, outstanding_amount = v_amt, status = 'PAID', payment_ref = v_ref,
                           paid_on = te_today(a.company_id), actioned_by = p_actor
     where id = a.id;
    perform te_log(a.company_id, 'trip', t.id, t.trip_no, 'ADVANCE_PAID', p_actor, 'Advance ' || te_rs(v_amt) || ' paid. Ref ' || v_ref || '.');
    perform te_log(a.company_id, 'advance', a.id, a.advance_no, 'ADVANCE_PAID', p_actor, 'Paid advance ' || te_rs(v_amt));
    perform te_notify(a.employee_id, 'ADVANCE_PAID', 'Advance paid for ' || t.name, te_rs(v_amt) || ' sent. Ref ' || v_ref || '.', '/ess?tab=claims', 'NORMAL', p_actor);

  elsif p_action = 'reject' then
    if a.status not in ('REQUESTED','APPROVED') then
      perform te_fail('TE_ADVANCE', 'Already handled.');
    end if;
    update te_advances set status = 'REJECTED', actioned_by = p_actor where id = a.id;
    perform te_log(a.company_id, 'advance', a.id, a.advance_no, 'ADVANCE_REJECTED', p_actor, 'Rejected advance');
    perform te_notify(a.employee_id, 'ADVANCE_REJECTED', 'Advance not approved for ' || t.name, coalesce(v_ref, 'Finance did not approve the advance.'), '/ess?tab=claims', 'HIGH', p_actor);

  elsif p_action in ('refund','payroll','carry') then
    if a.status not in ('RECOVERY_DUE','PAID','PART_SETTLED') or a.outstanding_amount <= 0 then
      perform te_fail('TE_ADVANCE', 'Nothing is outstanding.');
    end if;
    if p_action = 'carry' then
      select * into nt from te_trips k
       where k.employee_id = a.employee_id and k.id <> a.trip_id and k.status = 'APPROVED' and te_today(k.company_id) <= k.end_date
         and not exists (select 1 from te_advances x where x.trip_id = k.id and x.status not in ('REJECTED','CANCELLED'))
       order by k.start_date limit 1;
      if not found then
        perform te_fail('TE_ADVANCE', 'Carry forward needs another approved trip without an advance.');
      end if;
      select s.claim_deadline_days into v_days from te_settings s where s.company_id = a.company_id;
      insert into te_advances (company_id, advance_no, trip_id, employee_id, requested_amount, approved_amount, outstanding_amount,
                               status, due_date, source_advance_id, payment_ref, paid_on, actioned_by)
      values (a.company_id, te_next_no(a.company_id, 'advance'), nt.id, a.employee_id, a.outstanding_amount, a.outstanding_amount,
              a.outstanding_amount, 'PAID', nt.end_date + coalesce(v_days, 15), a.id, 'Carried from ' || a.advance_no,
              te_today(a.company_id), p_actor)
      returning id into v_new;
    end if;
    insert into te_settlements (company_id, advance_id, claim_id, amount, kind, target_advance_id, reference, created_by)
    values (a.company_id, a.id, null, a.outstanding_amount,
            case p_action when 'refund' then 'refund' when 'payroll' then 'payroll_recovery' else 'carry_forward' end, v_new, v_ref, p_actor);
    perform te_log(a.company_id, 'advance', a.id, a.advance_no, 'ADVANCE_' || upper(p_action), p_actor,
                   case p_action when 'refund' then 'Recorded refund of ' when 'payroll' then 'Sent to payroll recovery ' else 'Carried forward ' end
                     || te_rs(a.outstanding_amount));
    update te_advances set outstanding_amount = 0, status = 'SETTLED', actioned_by = p_actor where id = a.id;
  else
    perform te_fail('TE_ADVANCE', 'Unknown action.');
  end if;

  select * into a from te_advances where id = a.id;
  return jsonb_build_object('advance_id', a.id, 'status', a.status, 'outstanding_amount', a.outstanding_amount, 'carried_to', v_new);
end;
$$;


-- ============================================================================
-- SECTION 8 — PAYOUT
-- ============================================================================

-- Put verified claims into a batch.  p_route = PAYROLL | OFF_CYCLE.  p_claim_ids null = all that are waiting.
create or replace function te_payout_create(p_company_id uuid, p_actor uuid, p_route text, p_claim_ids uuid[] default null)
returns jsonb language plpgsql as $$
declare
  b       te_payout_batches;
  v_total numeric;
  v_n     int;
  r       record;
begin
  perform te_assert_finance(p_company_id, p_actor, true);
  if p_route not in ('PAYROLL','OFF_CYCLE') then
    perform te_fail('TE_PAYOUT', 'Choose with payroll or off-cycle.');
  end if;
  if p_claim_ids is not null and exists (select 1 from te_claims c where c.id = any (p_claim_ids) and c.employee_id = p_actor) then
    perform te_fail('TE_FORBIDDEN', 'Your own claim is paid by another Finance member.');
  end if;
  -- "all that are waiting" leaves the actor's own claims for a colleague
  -- the rows are locked while they are counted: a second batch created at the same moment waits, then finds none
  select count(*), coalesce(sum(s.net_amount), 0) into v_n, v_total from (
    select c.net_amount from te_claims c
     where c.company_id = p_company_id and c.status = 'VERIFIED' and c.net_amount > 0 and c.employee_id <> p_actor
       and (p_claim_ids is null or c.id = any (p_claim_ids)) for update) s;
  if v_n = 0 then
    perform te_fail('TE_PAYOUT', 'No verified claims are waiting for payout.');
  end if;

  insert into te_payout_batches (company_id, batch_no, route, payout_date, total_amount, created_by)
  values (p_company_id, te_next_no(p_company_id, 'batch'), p_route, te_today(p_company_id), v_total, p_actor)
  returning * into b;

  for r in select c.* from te_claims c
            where c.company_id = p_company_id and c.status = 'VERIFIED' and c.net_amount > 0 and c.employee_id <> p_actor
              and (p_claim_ids is null or c.id = any (p_claim_ids)) for update loop
    insert into te_payout_items (batch_id, claim_id, employee_id, amount) values (b.id, r.id, r.employee_id, r.net_amount);
    update te_claims set status = 'IN_PAYOUT' where id = r.id;
    perform te_log(p_company_id, 'claim', r.id, r.claim_no, 'CLAIM_IN_PAYOUT', p_actor,
                   'Added to payout batch ' || b.batch_no || ' (' || case when p_route = 'PAYROLL' then 'with payroll' else 'off-cycle' end || ').');
  end loop;
  perform te_log(p_company_id, 'batch', b.id, b.batch_no, 'BATCH_CREATED', p_actor, 'Created payout batch, ' || te_rs(v_total));
  return jsonb_build_object('batch_id', b.id, 'batch_no', b.batch_no, 'total_amount', v_total, 'items', v_n);
end;
$$;

-- The rows of the bank file. Reading it marks the batch FILE_GENERATED.
-- bank_account_number is sensitive: call this only from a route that has
-- checked the Finance / Payroll permission.
create or replace function te_payout_file(p_batch_id uuid, p_actor uuid)
returns table (beneficiary_name text, emp_code text, account_number text, ifsc text, amount numeric, narration text)
language plpgsql as $$
declare
  b te_payout_batches;
begin
  select * into b from te_payout_batches where id = p_batch_id for update;
  if not found then
    perform te_fail('TE_PAYOUT', 'Batch not found.');
  end if;
  perform te_assert_finance(b.company_id, p_actor, true);
  if b.status = 'DRAFT' then
    update te_payout_batches set status = 'FILE_GENERATED' where id = b.id;
    perform te_log(b.company_id, 'batch', b.id, b.batch_no, 'BATCH_FILE', p_actor, 'Generated the bank file');
  end if;
  return query
    select coalesce(e.bank_holder_name, e.full_name), e.emp_code, e.bank_account_number, e.ifsc_code, i.amount,
           'EXP REIMB ' || c.claim_no
      from te_payout_items i
      join employees e on e.id = i.employee_id
      join te_claims c on c.id = i.claim_id
     where i.batch_id = b.id
     order by e.emp_code;
end;
$$;

-- The bank (or payroll) confirmed the batch. Every claim in it is settled.
create or replace function te_payout_paid(p_batch_id uuid, p_actor uuid, p_ref text)
returns jsonb language plpgsql as $$
declare
  b te_payout_batches;
  r record;
  v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
begin
  select * into b from te_payout_batches where id = p_batch_id for update;
  if not found then
    perform te_fail('TE_PAYOUT', 'Batch not found.');
  end if;
  perform te_assert_finance(b.company_id, p_actor, true);
  if b.status = 'PAID' then
    perform te_fail('TE_PAYOUT', 'Already paid.');
  end if;
  if b.status = 'CANCELLED' then
    perform te_fail('TE_PAYOUT', 'This batch was cancelled.');
  end if;
  if v_ref is null then
    perform te_fail('TE_PAYOUT', 'Enter the bank or payroll reference.');
  end if;
  if not exists (select 1 from te_payout_items i where i.batch_id = b.id and i.status = 'PENDING') then
    perform te_fail('TE_PAYOUT', 'Nothing in this batch is waiting to be paid. Cancel it instead.');
  end if;
  if exists (select 1 from te_payout_items i where i.batch_id = b.id and i.employee_id = p_actor and i.status = 'PENDING') then
    perform te_fail('TE_FORBIDDEN', 'This batch holds your own claim. Another Finance member marks it paid.');
  end if;
  update te_payout_batches set status = 'PAID', bank_ref = v_ref, paid_by = p_actor, paid_at = now() where id = b.id;
  for r in select i.id as item_id, i.amount, c.* from te_payout_items i join te_claims c on c.id = i.claim_id
            where i.batch_id = b.id and i.status = 'PENDING' loop
    update te_payout_items set status = 'PAID', bank_ref = v_ref where id = r.item_id;
    update te_claims set status = 'PAID', paid_ref = v_ref where id = r.id;
    perform te_log(b.company_id, 'claim', r.id, r.claim_no, 'CLAIM_PAID', p_actor, te_rs(r.amount) || ' paid. Ref ' || v_ref || '.');
    perform te__settle(r.id, null, 'Settled.');
    perform te_notify(r.employee_id, 'CLAIM_PAID', 'Claim ' || r.claim_no || ' paid', te_rs(r.amount) || ' sent. Ref ' || v_ref || '.',
                      '/ess?tab=claims&ref=' || r.id, 'NORMAL', p_actor);
  end loop;
  perform te_log(b.company_id, 'batch', b.id, b.batch_no, 'BATCH_PAID', p_actor, 'Marked batch paid, ref ' || v_ref);
  return jsonb_build_object('batch_id', b.id, 'status', 'PAID');
end;
$$;

-- One transfer in a batch failed. The claim goes back to VERIFIED and waits
-- for the next batch.
create or replace function te_payout_item_failed(p_item_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $$
declare
  i te_payout_items;
  c te_claims;
begin
  select * into i from te_payout_items where id = p_item_id for update;
  if not found or i.status <> 'PENDING' then
    perform te_fail('TE_PAYOUT', 'This payment is not pending.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Say why the transfer failed.');
  end if;
  perform te_assert_finance((select b.company_id from te_payout_batches b where b.id = i.batch_id), p_actor, true);
  update te_payout_items set status = 'FAILED', failure_reason = btrim(p_reason) where id = i.id;
  update te_claims set status = 'VERIFIED' where id = i.claim_id returning * into c;
  update te_payout_batches set total_amount = total_amount - i.amount where id = i.batch_id;
  perform te__claim_log(c, 'PAYOUT_FAILED', 'Transfer failed: ' || btrim(p_reason) || '. Back in the payout queue.', p_actor);
  return jsonb_build_object('item_id', i.id, 'claim_id', c.id, 'status', 'VERIFIED');
end;
$$;


-- Drop a batch that was not paid. Its claims go back to VERIFIED and wait for
-- the next one.
create or replace function te_payout_cancel(p_batch_id uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql as $$
declare
  b te_payout_batches;
  r record;
  n int := 0;
begin
  select * into b from te_payout_batches where id = p_batch_id for update;
  if not found then
    perform te_fail('TE_PAYOUT', 'Batch not found.');
  end if;
  perform te_assert_finance(b.company_id, p_actor, true);
  if b.status not in ('DRAFT','FILE_GENERATED') then
    perform te_fail('TE_PAYOUT', 'Only a batch that is not paid can be cancelled.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Say why the batch is cancelled.');
  end if;
  for r in select c.* from te_payout_items i join te_claims c on c.id = i.claim_id
            where i.batch_id = b.id and i.status = 'PENDING' loop
    update te_claims set status = 'VERIFIED' where id = r.id and status = 'IN_PAYOUT';
    perform te_log(b.company_id, 'claim', r.id, r.claim_no, 'PAYOUT_CANCELLED', p_actor,
                   'Payout batch ' || b.batch_no || ' was cancelled. Back in the payout queue.');
    n := n + 1;
  end loop;
  update te_payout_items set status = 'FAILED', failure_reason = 'Batch cancelled: ' || btrim(p_reason) where batch_id = b.id and status = 'PENDING';
  update te_payout_batches set status = 'CANCELLED', total_amount = 0 where id = b.id;
  perform te_log(b.company_id, 'batch', b.id, b.batch_no, 'BATCH_CANCELLED', p_actor, 'Cancelled the batch: ' || btrim(p_reason));
  return jsonb_build_object('batch_id', b.id, 'status', 'CANCELLED', 'claims_returned', n);
end;
$$;

-- A CORRECTION AFTER A CLAIM IS PAID. The paid claim is never edited: Finance
-- records what is to be recovered from the employee or paid to them, with the
-- reason, and marks it done when the money has moved (a bank reversal, the
-- next payroll, a second transfer).
create or replace function te_adjustment_add(p_claim_id uuid, p_actor uuid, p_direction text, p_amount numeric, p_reason text)
returns jsonb language plpgsql as $$
declare
  c    te_claims;
  v_id uuid;
begin
  select * into c from te_claims where id = p_claim_id;
  if not found or c.status not in ('SETTLED','PAID') then
    perform te_fail('TE_ADJUST', 'Only a paid claim can be corrected this way.');
  end if;
  perform te_assert_finance(c.company_id, p_actor);
  if p_actor = c.employee_id then
    perform te_fail('TE_FORBIDDEN', 'Nobody corrects their own claim.');
  end if;
  if p_direction not in ('recover','pay') or coalesce(p_amount, 0) <= 0 then
    perform te_fail('TE_ADJUST', 'Choose recover or pay, and an amount above zero.');
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    perform te_fail('TE_COMMENT', 'Give a reason.');
  end if;
  insert into te_adjustments (company_id, claim_id, employee_id, direction, amount, reason, created_by)
  values (c.company_id, c.id, c.employee_id, p_direction, p_amount, btrim(p_reason), p_actor)
  returning id into v_id;
  perform te__claim_log(c, 'ADJUSTMENT_ADDED', 'Correction after payment: ' || case p_direction when 'recover' then 'recover ' else 'pay ' end
                          || te_rs(p_amount) || '. ' || btrim(p_reason), p_actor);
  perform te_notify(c.employee_id, 'CLAIM_ADJUSTED', 'Correction on claim ' || c.claim_no,
                    case p_direction when 'recover' then te_rs(p_amount) || ' will be recovered. ' else te_rs(p_amount) || ' more will be paid. ' end || btrim(p_reason),
                    '/ess?tab=claims&ref=' || c.id, 'HIGH', p_actor);
  return jsonb_build_object('adjustment_id', v_id, 'status', 'OPEN');
end;
$$;

-- p_action = done | cancel
create or replace function te_adjustment_close(p_adjustment_id uuid, p_actor uuid, p_action text, p_reference text default null)
returns jsonb language plpgsql as $$
declare
  j te_adjustments;
begin
  select * into j from te_adjustments where id = p_adjustment_id for update;
  if not found or j.status <> 'OPEN' then
    perform te_fail('TE_ADJUST', 'This correction is not open.');
  end if;
  perform te_assert_finance(j.company_id, p_actor, p_action = 'done' and j.direction = 'pay');
  if p_action not in ('done','cancel') then
    perform te_fail('TE_ADJUST', 'Unknown action.');
  end if;
  if p_action = 'done' and coalesce(btrim(p_reference), '') = '' then
    perform te_fail('TE_ADJUST', 'Enter the bank or payroll reference.');
  end if;
  update te_adjustments set status = case p_action when 'done' then 'DONE' else 'CANCELLED' end,
                            reference = nullif(btrim(coalesce(p_reference, '')), '')
   where id = j.id;
  perform te_log(j.company_id, 'claim', j.claim_id, (select c.claim_no from te_claims c where c.id = j.claim_id),
                 'ADJUSTMENT_' || upper(p_action), p_actor,
                 'Correction of ' || te_rs(j.amount) || case p_action when 'done' then ' completed. Ref ' || btrim(p_reference) || '.' else ' cancelled.' end);
  return jsonb_build_object('adjustment_id', j.id, 'status', case p_action when 'done' then 'DONE' else 'CANCELLED' end);
end;
$$;


-- ============================================================================
-- SECTION 9 — EXPENSE MONTHS (travel_periods, shared with v1)
-- ============================================================================

-- p_action = close | reopen | roll | lock      p_month = any date in the month
--   close   no new claims are filed into the month
--   reopen  needs a reason (travel_periods' own trigger wants 10 characters)
--   roll    unfinished claims move to the next open month, marked late
--   lock    final, after payout. Refused while the month has unfinished claims.
create or replace function te_period_act(p_company_id uuid, p_month date, p_actor uuid, p_action text, p_reason text default null)
returns jsonb language plpgsql as $$
declare
  p   travel_periods;
  nx  travel_periods;
  r   record;
  v_n int := 0;
begin
  perform te_assert_finance(p_company_id, p_actor);
  select * into p from travel_periods where company_id = p_company_id and period_month = date_trunc('month', p_month)::date for update;
  if not found then
    perform te_fail('TE_PERIOD', 'That month has not been opened.');
  end if;

  if p_action = 'close' then
    if p.status <> 'OPEN' then
      perform te_fail('TE_PERIOD', 'Only an open period can be closed.');
    end if;
    if (select count(*) from travel_periods k where k.company_id = p_company_id and k.status = 'OPEN') < 2 then
      perform te_fail('TE_PERIOD', 'Keep at least one period open for new claims.');
    end if;
    update travel_periods set status = 'CLOSED', closed_by = p_actor, closed_at = now() where id = p.id;

  elsif p_action = 'reopen' then
    if p.status <> 'CLOSED' then
      perform te_fail('TE_PERIOD', 'Only a closed period can be reopened.');
    end if;
    if length(coalesce(btrim(p_reason), '')) < 10 then
      perform te_fail('TE_PERIOD', 'Reopening needs a reason of at least 10 characters.');
    end if;
    update travel_periods set status = 'OPEN', reopened_by = p_actor, reopened_at = now(), reopen_reason = btrim(p_reason) where id = p.id;

  elsif p_action = 'roll' then
    select * into nx from travel_periods k
     where k.company_id = p_company_id and k.status = 'OPEN' and k.id <> p.id
     order by (k.period_month > p.period_month) desc, k.period_month limit 1;
    if not found then
      perform te_fail('TE_PERIOD', 'No open period to roll into.');
    end if;
    for r in select c.* from te_claims c where c.period_id = p.id and c.status not in ('SETTLED','REJECTED','CANCELLED') loop
      update te_expenses set period_id = nx.id where claim_id = r.id;
      update te_claims set period_id = nx.id, is_late = true where id = r.id;
      perform te_log(p_company_id, 'claim', r.id, r.claim_no, 'CLAIM_ROLLED', p_actor,
                     'Rolled forward to ' || nx.period_label || ' when ' || p.period_label || ' was closed out.');
      v_n := v_n + 1;
    end loop;

  elsif p_action = 'lock' then
    if p.status <> 'CLOSED' then
      perform te_fail('TE_PERIOD', 'Close the period before locking it.');
    end if;
    update travel_periods set status = 'LOCKED', locked_by = p_actor, locked_at = now() where id = p.id;
  else
    perform te_fail('TE_PERIOD', 'Unknown action.');
  end if;

  insert into travel_period_audit (period_id, company_id, action, from_status, to_status, reason, actioned_by, meta)
  values (p.id, p_company_id,
          case p_action when 'close' then 'CLOSED' when 'reopen' then 'REOPENED' when 'lock' then 'LOCKED' else 'WINDOW_CHANGED' end,
          p.status, (select k.status from travel_periods k where k.id = p.id), nullif(btrim(coalesce(p_reason, '')), ''), p_actor,
          case when p_action = 'roll' then jsonb_build_object('rolled_claims', v_n, 'into', nx.period_label) end);
  perform te_log(p_company_id, 'period', p.id, p.period_label, 'PERIOD_' || upper(p_action), p_actor,
                 'Period ' || p.period_label || ': ' || p_action || coalesce(' (' || nullif(btrim(coalesce(p_reason, '')), '') || ')', ''), false);
  return jsonb_build_object('period_id', p.id, 'status', (select k.status from travel_periods k where k.id = p.id), 'rolled', v_n);
end;
$$;


-- ============================================================================
-- SECTION 10 — THE NIGHTLY JOB
-- ============================================================================

-- Call once a day (app/api/cron/te-daily). Safe to call more often.
--   · makes sure this month and next month exist as expense periods
--   · EXPIRES saved lines that crossed the bill-age limit without being claimed
--   · marks advances RECOVERY_DUE after the due date plus the grace days
--   · deletes raw GPS pings older than the retention setting (the leg keeps its
--     summary and its route line)
--   · returns who should be reminded and who should be escalated to, so the
--     route can send those notifications
create or replace function te_daily(p_company_id uuid default null)
returns jsonb language plpgsql as $$
declare
  s        te_settings;
  v_today  date;
  v_exp    int := 0; v_adv int := 0; v_ping int := 0; v_n int;
  v_remind jsonb := '[]'::jsonb;
  r        record;
begin
  for s in select * from te_settings where p_company_id is null or company_id = p_company_id loop
    v_today := te_today(s.company_id);
    perform travel_ensure_period(s.company_id, v_today);
    perform travel_ensure_period(s.company_id, (date_trunc('month', v_today) + interval '1 month')::date);

    update te_expenses set status = 'EXPIRED'
     where company_id = s.company_id and status = 'UNCLAIMED' and paid_by = 'self'
       and expense_date < v_today - s.bill_age_days;
    get diagnostics v_n = row_count; v_exp := v_exp + v_n;

    for r in select a.* from te_advances a
              where a.company_id = s.company_id and a.status in ('PAID','PART_SETTLED') and a.outstanding_amount > 0
                and a.due_date is not null and v_today > a.due_date + s.grace_days loop
      update te_advances set status = 'RECOVERY_DUE' where id = r.id;
      perform te_log(s.company_id, 'advance', r.id, r.advance_no, 'ADVANCE_OVERDUE', null,
                     'Advance of ' || te_rs(r.outstanding_amount) || ' is overdue and due for recovery.');
      perform te_notify(r.employee_id, 'ADVANCE_OVERDUE', 'Advance overdue', te_rs(r.outstanding_amount)
                        || ' from your trip advance is due. File the claim or return the balance.', '/ess?tab=claims', 'HIGH');
      v_adv := v_adv + 1;
    end loop;

    delete from te_leg_pings g using te_legs l
     where g.leg_id = l.id and l.company_id = s.company_id and l.status in ('SUBMITTED','SKIPPED','CANCELLED')
       and l.ended_at < now() - make_interval(days => coalesce((s.gps_rules->>'retentionDays')::int, 180));
    get diagnostics v_n = row_count; v_ping := v_ping + v_n;

    select v_remind || coalesce(jsonb_agg(jsonb_build_object(
             'step_id', q.step_id, 'entity_type', q.entity_type, 'entity_id', q.entity_id, 'ref_no', q.ref_no,
             'approver_id', q.effective_approver_id, 'team_code', q.team_code,
             'days_waiting', (v_today - q.waiting_since::date),
             'escalate', (v_today - q.waiting_since::date) >= s.escalate_days)), '[]'::jsonb)
      into v_remind
      from v_te_pending_approvals q
     where q.company_id = s.company_id and (v_today - q.waiting_since::date) >= s.reminder_days;
  end loop;
  return jsonb_build_object('expired_lines', v_exp, 'advances_overdue', v_adv, 'pings_purged', v_ping, 'reminders', v_remind);
end;
$$;

notify pgrst, 'reload schema';
