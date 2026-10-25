-- 155_te_co_travellers.sql — the people taken along can see the trip, and claim it.
--
-- WHAT WAS WRONG. A trip is planned with co-travellers: you add them by
-- employee code when you plan it, te_trip_people stores them, te_trip_co reads
-- them back, and the sheet the approver sees counts them in `pax`. The trip
-- screen even says, in so many words, "N people travel. Each claims their own
-- expenses." None of that was true. Four separate reads each said "only the
-- owner", so the people who actually went on the trip were the only ones in
-- the company who could not look at it, while Finance and every approver could:
--
--   te_snapshot       where t.employee_id = p_employee_id   -- not in their list
--   te_can_view       owner, Finance, or an approver        -- cannot open it
--   te_expense_save   'That trip is not yours.'             -- cannot bill it
--   te_claim_submit   'That trip is not yours.'             -- cannot claim it
--
-- All four are relaxed here to "the owner, or somebody on te_trip_people". The
-- fourth matters as much as the first three: without it the bills the third one
-- now allows would be saved and then trapped, because a line tagged with a trip
-- can only ever go into that trip's claim — the standing monthly claim reads
-- `trip_id is null` and will not take it.
--
-- WHAT THIS DOES NOT DO. It does not let them change anything. te_trip_save
-- already refuses everyone but the owner —
--
--   if v_emp is distinct from p_actor then
--     perform te_fail('TE_FORBIDDEN', 'You can only plan your own trips.');
--
-- — and that line is untouched here, so the route, the dates, the journeys, the
-- bookings and the list of people stay the planner's alone to change. Nor do
-- co-travellers inherit the planner's journeys: every te_legs row carries the
-- owner's employee_id, starting and reporting a journey is checked against
-- that, and none of those checks move. This grants reading, spending, and
-- claiming your own spending. Nothing else.
--
-- WHOSE MONEY. Every expense line carries the employee_id of whoever saved it,
-- so a co-traveller's bill lands on a claim of their own and they are paid for
-- their own spending. The database was already built for this: claim_seq is
-- counted per employee, and a trip only becomes CLOSED once no claim against it
-- is still open. Only the trip is shared; the money is not pooled.
--
-- Each function below is reproduced verbatim from the migration that defines
-- it, with only the change described in its own comment, so this file can be
-- diffed against those to prove the scope. It is generated, and regenerating it
-- fails loudly if any of those functions has moved underneath it.

-- ============================================================================
-- te_can_view — reproduced from 148_te_functions_read.sql
-- Change: a co-traveller may open a trip, or their own claim on one, that they were taken on.
-- ============================================================================

create or replace function te_can_view(p_entity_type text, p_entity_id uuid, p_actor uuid)
returns boolean language plpgsql stable as $$
declare
  v_owner   uuid;
  v_company uuid;
begin
  if p_entity_type = 'trip' then
    select t.employee_id, t.company_id into v_owner, v_company from te_trips t where t.id = p_entity_id;
  elsif p_entity_type = 'claim' then
    select c.employee_id, c.company_id into v_owner, v_company from te_claims c where c.id = p_entity_id;
  end if;
  if v_owner is null then
    return false;
  end if;
  if v_owner = p_actor or p_actor = any (te_finance_members(v_company)) then
    return true;
  end if;
  -- SOMEBODY TAKEN ALONG ON THE TRIP MAY OPEN IT. They were added by name and
  -- employee code when it was planned, so it is as much their trip as the
  -- planner's: they travel on it and they spend on it. They still cannot
  -- CHANGE it — te_trip_save refuses anyone but the owner — so this grants
  -- reading, not control.
  if p_entity_type = 'trip' and exists (
       select 1 from te_trip_people tp
        where tp.trip_id = p_entity_id and tp.employee_id = p_actor) then
    return true;
  end if;
  -- and their OWN claim on such a trip. A colleague's claim on the same trip
  -- is deliberately not covered: this tests the claim's employee_id as well as
  -- the trip's people, because what somebody was paid is theirs, not the
  -- trip's.
  if p_entity_type = 'claim' and exists (
       select 1 from te_claims c
        where c.id = p_entity_id and c.employee_id = p_actor
          and exists (select 1 from te_trip_people tp
                       where tp.trip_id = c.trip_id and tp.employee_id = p_actor)) then
    return true;
  end if;
  if exists (select 1 from te_approval_steps s
              where s.entity_type = p_entity_type and s.entity_id = p_entity_id
                and (s.approver_id = p_actor or s.acted_by = p_actor or te_effective_approver(s.approver_id) = p_actor)) then
    return true;
  end if;
  -- the approver of a trip may open the claims of that trip, and the other way round
  if p_entity_type = 'claim' then
    return exists (select 1 from te_claims c join te_approval_steps s on s.entity_type = 'trip' and s.entity_id = c.trip_id
                    where c.id = p_entity_id and (s.approver_id = p_actor or s.acted_by = p_actor));
  end if;
  return exists (select 1 from te_claims c join te_approval_steps s on s.entity_type = 'claim' and s.entity_id = c.id
                  where c.trip_id = p_entity_id and (s.approver_id = p_actor or s.acted_by = p_actor));
end;
$$;

-- ============================================================================
-- te_snapshot — reproduced from 148_te_functions_read.sql
-- Change: a co-traveller the trip appears in their own Travel and Expenses.
-- ============================================================================

create or replace function te_snapshot(p_employee_id uuid, p_opts jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable as $$
declare
  o         jsonb := coalesce(p_opts, '{}'::jsonb);
  v_company uuid;
  v_today   date;
  v_since   date;
  v_leg     uuid := nullif(o->>'leg_id', '')::uuid;
  v_trip_ids uuid[];
  v_trips   jsonb; v_legs jsonb; v_exp jsonb; v_other jsonb; v_claims jsonb;
  v_emp_ids uuid[]; v_emp jsonb; v_codes jsonb;
  v_place_ids uuid[];
  v_routes  jsonb;
  v_ctx     jsonb;
  v_cfg     jsonb;
  v_chain   record;
begin
  select e.company_id into v_company from employees e where e.id = p_employee_id;
  if not found then
    perform te_fail('TE_FORBIDDEN', 'Employee not found.');
  end if;
  v_today := te_today(v_company);
  v_since := v_today - coalesce(nullif(o->>'days', '')::int, 400);
  v_cfg   := te_config(v_company);

  -- ---- trips and legs ---------------------------------------------------------
  -- MY TRIPS, AND THE TRIPS I WAS TAKEN ON. The second half is new: somebody
  -- added to a trip when it was planned could not see it anywhere, because
  -- this read was `t.employee_id = p_employee_id` and nothing else. They were
  -- on the trip, they were going to spend on it, and it was invisible to them.
  select coalesce(array_agg(t.id), '{}') into v_trip_ids
    from te_trips t
   where (t.employee_id = p_employee_id
          or exists (select 1 from te_trip_people tp
                      where tp.trip_id = t.id and tp.employee_id = p_employee_id))
     and (t.end_date >= v_since or t.status in ('DRAFT','PENDING_APPROVAL','SENT_BACK','APPROVED','CLAIMED'));

  select coalesce(jsonb_agg(te_trip_json(t) order by t.created_at desc), '[]'::jsonb) into v_trips
    from te_trips t where t.id = any (v_trip_ids);
  select coalesce(jsonb_agg(te_leg_json(l, l.id = v_leg or (l.status in ('ACTIVE','PAUSED'))) order by l.trip_id, l.leg_no), '[]'::jsonb) into v_legs
    from te_legs l where l.trip_id = any (v_trip_ids);

  -- ---- the employee's own lines and claims --------------------------------------
  select coalesce(jsonb_agg(te_expense_json(x) order by x.expense_date, x.expense_no), '[]'::jsonb) into v_exp
    from te_expenses x
   where x.employee_id = p_employee_id
     and (x.expense_date >= v_since or x.status in ('UNCLAIMED','IN_CLAIM') or x.trip_id = any (v_trip_ids));

  select coalesce(jsonb_agg(te_claim_json(c, true) order by c.created_at desc), '[]'::jsonb) into v_claims
    from te_claims c
   where c.employee_id = p_employee_id
     and (c.created_at >= v_since or c.status not in ('SETTLED','REJECTED','CANCELLED'));

  -- ---- lines of OTHER employees that could be duplicates (checks B1, B2, B3, B5, B6) ----
  with mine as (
    select f.sha256 as sha, f.phash,
           upper(regexp_replace(coalesce(x.bill_no, ''), '[^A-Za-z0-9]', '', 'g')) as bill_no,
           coalesce(x.reference, '') as reference, x.expense_date as d, x.bill_amount as bill
      from te_expenses x
      left join te_expense_files f on f.expense_id = x.id
      left join te_claims c on c.id = x.claim_id
     where x.employee_id = p_employee_id and (x.status = 'UNCLAIMED' or (x.status = 'IN_CLAIM' and c.status = 'SENT_BACK'))
    union all
    select nullif(p->>'sha', ''), nullif(p->>'phash', ''),
           upper(regexp_replace(coalesce(p->>'bill_no', ''), '[^A-Za-z0-9]', '', 'g')),
           upper(coalesce(p->>'reference', '')), nullif(p->>'date', '')::date, nullif(p->>'bill', '')::numeric
      from jsonb_array_elements(case when jsonb_typeof(o->'probe') = 'array' then o->'probe' else '[]'::jsonb end) p
  ),
  hit as (
    select distinct x.id
      from te_expenses x
      left join te_expense_files f on f.expense_id = x.id
      join mine m on (m.sha is not null and f.sha256 = m.sha)
                  or (m.phash is not null and f.phash = m.phash)
                  or (m.bill_no <> '' and upper(regexp_replace(coalesce(x.bill_no, ''), '[^A-Za-z0-9]', '', 'g')) = m.bill_no)
                  or (m.reference <> '' and x.reference = m.reference)
                  or (m.d is not null and m.bill > 0 and x.expense_date = m.d and x.bill_amount = m.bill)
     where x.company_id = v_company and x.employee_id <> p_employee_id
       and x.status not in ('REJECTED_REFILE','EXPIRED','DISCARDED')
     limit 200
  )
  -- Of a colleague's line the engine gets only what the duplicate checks
  -- compare: never the description, the route, the vehicle or the details.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'no', x.expense_no, 'emp', x.employee_id, 'other', true,
           'cat', x.category_code, 'date', x.expense_date, 'merchant', coalesce(x.merchant, ''),
           'gstin', coalesce(x.merchant_gstin, ''), 'billNo', coalesce(x.bill_no, ''),
           'pnr', case when x.category_code in ('air','train','bus') then coalesce(x.reference, '') else '' end,
           'ref', case when x.category_code in ('air','train','bus') then '' else coalesce(x.reference, '') end,
           'bill', x.bill_amount, 'claimed', x.claimed_amount, 'pay', x.paid_by, 'status', x.status,
           'claimId', x.claim_id, 'claimNo', (select c.claim_no from te_claims c where c.id = x.claim_id),
           'file', (select jsonb_strip_nulls(jsonb_build_object('sha', f.sha256, 'phash', f.phash))
                      from te_expense_files f where f.expense_id = x.id order by f.uploaded_at, f.id limit 1))), '[]'::jsonb) into v_other
    from te_expenses x join hit on hit.id = x.id;

  -- ---- people the engine may name ---------------------------------------------------
  select * into v_chain from te_org_chain(p_employee_id);
  select coalesce(jsonb_object_agg(upper(e.emp_code), e.id), '{}'::jsonb) into v_codes
    from employees e
   where e.company_id = v_company
     and upper(e.emp_code) in (
           select upper(q.emp_code_entered) from te_trip_people q where q.trip_id = any (v_trip_ids)
           union
           select upper(c) from jsonb_array_elements_text(case when jsonb_typeof(o->'codes') = 'array' then o->'codes' else '[]'::jsonb end) c);

  select array_agg(distinct i) into v_emp_ids from (
    select p_employee_id as i
    union select v_chain.l1 union select v_chain.l2 union select v_chain.hod union select v_chain.md
    union select (select l1 from te_org_chain(v_chain.l1))
    union select unnest(te_finance_members(v_company))
    union select (v_cfg->>'fallback')::uuid
    union select q.employee_id from te_trip_people q where q.trip_id = any (v_trip_ids)
    -- and whoever PLANNED each of those trips. For my own trips that is me, so
    -- this adds nothing; for a trip I was taken on it is the one name the trips
    -- list has to show — "On Ravi Kumar's trip" — and without it the row would
    -- read "On 's trip", because the owner of somebody else's trip appeared
    -- nowhere else in this union.
    union select t.employee_id from te_trips t where t.id = any (v_trip_ids)
    union select (e.value)::uuid from jsonb_each_text(v_codes) e
    union select (x->>'emp')::uuid from jsonb_array_elements(v_other) x
    union select s.approver_id from te_approval_steps s
           where (s.entity_type = 'trip' and s.entity_id = any (v_trip_ids))
              or (s.entity_type = 'claim' and s.entity_id in (select c.id from te_claims c where c.employee_id = p_employee_id))
    union select nullif(l->>'person', '')::uuid
            from jsonb_array_elements(v_cfg->'flows'->'claim'->'levels' || (v_cfg->'flows'->'trip'->'levels')) l
  ) z where i is not null;
  select coalesce(jsonb_object_agg(i::text, te_emp_json(i)), '{}'::jsonb) into v_emp from unnest(v_emp_ids) i;

  -- ---- road distances for the places in play ----------------------------------------
  select array_agg(distinct i) into v_place_ids from (
    select p.place_id as i from te_trip_points p where p.trip_id = any (v_trip_ids)
    union select l.from_place_id from te_legs l where l.trip_id = any (v_trip_ids)
    union select l.to_place_id from te_legs l where l.trip_id = any (v_trip_ids)
    union select x.from_place_id from te_expenses x where x.employee_id = p_employee_id and x.status in ('UNCLAIMED','IN_CLAIM')
    union select x.to_place_id from te_expenses x where x.employee_id = p_employee_id and x.status in ('UNCLAIMED','IN_CLAIM')
    union select c::uuid from jsonb_array_elements_text(case when jsonb_typeof(o->'places') = 'array' then o->'places' else '[]'::jsonb end) c
  ) z where i is not null;
  select coalesce(jsonb_object_agg(r.from_place_id::text || '|' || r.to_place_id::text, r.km), '{}'::jsonb) into v_routes
    from te_routes r
   where r.from_place_id = any (v_place_ids) and r.to_place_id = any (v_place_ids);

  v_ctx := te_ezer_context(p_employee_id, v_since, v_today + 400);

  return jsonb_build_object(
    'today', v_today, 'me', p_employee_id, 'company', v_company,
    'cfg', v_cfg, 'masters', te_masters(v_company, p_employee_id),
    'emp', v_emp, 'codes', v_codes,
    'leave', jsonb_build_object(p_employee_id::text, v_ctx->'leave'),
    'punch', jsonb_build_object(p_employee_id::text, v_ctx->'punch'),
    'holidays', v_ctx->'holidays',
    'routes', v_routes,
    'vehicles', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', v.id, 'emp', v.employee_id, 'type', v.vehicle_type_code, 'declared', coalesce(v.declared_type_code, ''),
                    'reg', v.reg_no, 'rc', v.rc, 'whose', v.ownership, 'photo', v.rc_file_url is not null,
                    'verified', v.is_verified, 'vby', coalesce(v.verified_via, ''), 'added', v.created_at::date) order by v.created_at), '[]'::jsonb)
                   from te_employee_vehicles v where v.employee_id = p_employee_id and v.is_active),
    'trips', v_trips, 'journeys', v_legs,
    'expenses', v_exp || v_other, 'claims', v_claims,
    'advances', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', a.id, 'no', a.advance_no, 'tripId', a.trip_id, 'emp', a.employee_id, 'requested', a.requested_amount,
                    'approved', a.approved_amount, 'outstanding', a.outstanding_amount, 'status', a.status,
                    'display', te_advance_status(a.id), 'due', a.due_date, 'paidOn', a.paid_on, 'ref', coalesce(a.payment_ref, '')) order by a.created_at desc), '[]'::jsonb)
                   from te_advances a where a.employee_id = p_employee_id),
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', b.id, 'no', b.booking_no, 'tripId', b.trip_id,
                    'tripNo', (select t.trip_no from te_trips t where t.id = b.trip_id),
                    'legId', b.leg_id, 'pointIdx', b.point_seq, 'kind', b.kind,
                    'vendor', b.vendor, 'pnr', b.reference, 'amount', b.amount, 'paidBy', b.paid_by, 'status', b.status,
                    'at', b.booked_at) order by b.booked_at desc), '[]'::jsonb)
                   -- every company-paid booking of the company whose reference one of my lines could repeat (check B7)
                   from te_bookings b
                  where b.trip_id = any (v_trip_ids)
                     or (b.company_id = v_company and b.reference in (
                           select x.reference from te_expenses x where x.employee_id = p_employee_id and x.reference is not null
                           union select upper(p->>'reference') from jsonb_array_elements(case when jsonb_typeof(o->'probe') = 'array' then o->'probe' else '[]'::jsonb end) p))),
    'periods', (select coalesce(jsonb_agg(jsonb_build_object('m', to_char(p.period_month, 'YYYY-MM'), 'status', p.status, 'label', p.period_label)
                                          order by p.period_month), '[]'::jsonb)
                  from travel_periods p where p.company_id = v_company and p.period_month >= (v_since - 62)),
    'batches', '[]'::jsonb, 'settlements', '[]'::jsonb, 'audit', '[]'::jsonb
  );
end;
$$;

-- ============================================================================
-- te_expense_save — reproduced from 146_te_functions_trips.sql
-- Change: a co-traveller they may save a bill against it.
-- ============================================================================

create or replace function te_expense_save(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_id   uuid := nullif(p->>'expense_id', '')::uuid;
  v_emp  uuid := nullif(p->>'employee_id', '')::uuid;
  v_trip uuid := nullif(p->>'trip_id', '')::uuid;
  prev   te_expenses;
  c      te_claims;
  x      te_expenses;
  v_cat  te_categories;
begin
  if v_emp is distinct from p_actor then
    perform te_fail('TE_FORBIDDEN', 'You can only add your own expenses.');
  end if;
  perform te_assert_active(v_emp);

  if v_id is not null then
    select * into prev from te_expenses where id = v_id for update;
    if not found or prev.employee_id <> v_emp then
      perform te_fail('TE_EXPENSE', 'Expense not found.');
    end if;
    if prev.paid_by = 'company' then
      perform te_fail('TE_EXPENSE', 'This was booked and paid by the company. It cannot be changed here.');
    end if;
    if prev.status <> 'UNCLAIMED' then
      select * into c from te_claims where id = prev.claim_id;
      if not (c.status = 'SENT_BACK' and (prev.needs_fix or c.fix_all)) then
        perform te_fail('TE_EXPENSE', 'This line is in a claim and cannot be changed now.');
      end if;
    end if;
    v_trip := prev.trip_id;
  end if;

  -- YOUR OWN TRIP, OR ONE YOU WERE TAKEN ON. A co-traveller spends on the trip
  -- too — their own cab, their own dinner — and the bill belongs to the trip it
  -- was spent on, not to a separate claim of their own. The line still carries
  -- THEIR employee_id, so each person claims and is paid for their own
  -- spending; only the trip is shared.
  if v_trip is not null and not exists (
       select 1 from te_trips t
        where t.id = v_trip
          and (t.employee_id = v_emp
               or exists (select 1 from te_trip_people tp
                           where tp.trip_id = t.id and tp.employee_id = v_emp))) then
    perform te_fail('TE_EXPENSE', 'That trip is not yours and you are not on it.');
  end if;
  if v_trip is not null and exists (select 1 from te_trips t where t.id = v_trip and t.status in ('REJECTED','CANCELLED')) then
    perform te_fail('TE_EXPENSE', 'This trip was cancelled or rejected. Nothing can be added to it.');
  end if;
  select * into v_cat from te_categories k
   where k.company_id = (select company_id from employees where id = v_emp) and k.code = p->>'category_code';
  if found and v_cat.needs_trip and v_trip is null then
    perform te_fail('TE_EXPENSE', v_cat.name || ' belongs to a trip. Add it inside the trip.');
  end if;

  -- the leg a line belongs to is never taken from the browser
  x := te__expense_write(p || jsonb_build_object('trip_id', v_trip, 'paid_by', 'self', 'leg_id', prev.leg_id,
                                                 'booking_id', null), p_actor);
  if v_id is null then
    perform te_log(x.company_id, 'expense', x.id, x.expense_no, 'EXPENSE_SAVED', p_actor, 'Saved expense line');
  else
    perform te_log(x.company_id, 'expense', x.id, x.expense_no, 'EXPENSE_EDITED', p_actor,
                   'Changed expense line' || case when prev.claimed_amount is distinct from x.claimed_amount
                     then ': claimed ' || te_rs(prev.claimed_amount) || ' to ' || te_rs(x.claimed_amount) else '' end, true,
                   jsonb_build_object('bill_amount', prev.bill_amount, 'claimed_amount', prev.claimed_amount, 'expense_date', prev.expense_date, 'merchant', prev.merchant, 'bill_no', prev.bill_no),
                   jsonb_build_object('bill_amount', x.bill_amount, 'claimed_amount', x.claimed_amount, 'expense_date', x.expense_date, 'merchant', x.merchant, 'bill_no', x.bill_no));
    if prev.claim_id is not null then
      perform te_log(x.company_id, 'claim', prev.claim_id, (select k.claim_no from te_claims k where k.id = prev.claim_id), 'LINE_EDITED', p_actor,
                     'Edited line ' || coalesce(x.merchant, x.category_code) || case when prev.claimed_amount is distinct from x.claimed_amount
                       then ': ' || te_rs(prev.claimed_amount) || ' to ' || te_rs(x.claimed_amount) else '' end);
    end if;
  end if;
  return jsonb_build_object('expense_id', x.id, 'expense_no', x.expense_no, 'status', x.status);
end;
$$;

-- ============================================================================
-- te_claim_submit — reproduced from 147_te_functions_claims.sql
-- Change: a co-traveller they may claim their own bills on it.
-- ============================================================================

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
    -- MINE, OR ONE I WAS TAKEN ON. A co-traveller spends on the trip and must
    -- be able to claim it back. Their claim is their own: claim_seq is counted
    -- per employee below, every line is checked to be theirs, and the trip only
    -- CLOSES once no claim against it is still open — so two people on one trip
    -- each get their own main claim and are each paid separately.
    if not found or (t.employee_id <> v_emp and not exists (
         select 1 from te_trip_people tp
          where tp.trip_id = t.id and tp.employee_id = v_emp)) then
      perform te_fail('TE_CLAIM', 'That trip is not yours and you are not on it.');
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
    -- MY OWN UNFINISHED JOURNEYS, not everyone's. Every te_legs row carries the
    -- trip owner's employee_id (both inserts, in te_trip_save and te_leg_add,
    -- use t.employee_id), so for the owner this reads exactly as it did before.
    -- For a co-traveller it finds nothing, which is right: the journeys are the
    -- planner's to record, and holding someone's money back until a colleague
    -- files a GPS report would punish them for having travelled together.
    select * into v_open from te_legs l where l.trip_id = v_trip and l.employee_id = v_emp
       and l.status in ('PLANNED','ACTIVE','PAUSED','ENDED') order by l.leg_no limit 1;
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
