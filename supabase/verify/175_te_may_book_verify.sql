-- 175_te_may_book_verify.sql — proves "May book" now means what it says.
--
-- NOT A MIGRATION. Run it in the SQL editor whenever you want the proof again.
-- APPLY 175 FIRST.
--
-- WRITES NOTHING THAT SURVIVES. It puts two people on a real travel desk —
-- one with can_book, one without — asks the three functions about each, checks
-- every answer, and then raises an exception on purpose. The exception aborts
-- the block, so both desk rows disappear. The report survives because a
-- PL/pgSQL variable is not transactional; that is the whole trick.
--
-- IT FINISHES WITH AN ERROR IN RED. That is the success case. Read the message.
--
-- WHAT IS BEING PROVED, and why each half matters:
--
--   te_on_desk        must be TRUE for both. Membership is membership: the
--                     person without can_book still gets the desk, which is
--                     the whole point of the change. Before 175 they were
--                     FALSE and lost the tab, the work list and stay
--                     decisions along with it.
--   te_desk_members   must return BOTH. This is what te_can_view and
--                     te_stay_decide read, so if it excluded the non-booking
--                     member they would see the tab and be refused every
--                     record inside it.
--   te_may_book       must be TRUE for the one with can_book, FALSE for the
--                     one without, and TRUE for somebody on no desk at all —
--                     an administrator books on their dashboard role as
--                     before, and this function must never refuse them.
--
--   FINANCE IS UNTOUCHED, and that is asserted too: te_on_desk('finance', …)
--   for a finance_team row with can_approve = false must still be FALSE. If
--   this ever flips, the finance half was changed by accident.
-- ============================================================================

do $$
declare
  v_co      uuid;
  v_loc     uuid;
  v_able    uuid;        -- on the desk, may book
  v_not     uuid;        -- on the desk, may NOT book
  v_off     uuid;        -- on no desk at all
  v_members uuid[];
  r         text := E'\n';
  fails     int  := 0;
begin
  -- A company that uses the module, and three distinct active employees of it.
  select s.company_id into v_co from te_settings s
    join companies c on c.id = s.company_id order by c.company_name limit 1;
  if v_co is null then
    raise exception 'No company has Travel and Expense set up. Nothing to verify.';
  end if;

  select array_agg(id) into v_members from (
    select e.id from employees e
     where e.company_id = v_co and te_is_employee_active(e.id)
       and not exists (select 1 from travel_desk d where d.employee_id = e.id)
       and not exists (select 1 from finance_team f where f.employee_id = e.id)
     order by e.emp_code limit 3) q;
  if coalesce(cardinality(v_members), 0) < 3 then
    raise exception 'Need three active employees of this company who are on no desk. Found %.', coalesce(cardinality(v_members), 0);
  end if;
  v_able := v_members[1]; v_not := v_members[2]; v_off := v_members[3];
  select e.location_id into v_loc from employees e where e.id = v_able;

  insert into travel_desk (company_id, location_id, employee_id, role, can_book, is_group_scope, is_active)
  values (v_co, v_loc, v_able, 'MANAGER', true,  false, true),
         (v_co, v_loc, v_not,  'DESK',    false, false, true);

  -- ── membership: both, regardless of can_book ─────────────────────────────
  if te_on_desk('travel', v_able) then r := r || E'  ok   te_on_desk(may book)        = true\n';
  else r := r || E'  FAIL te_on_desk(may book) should be true\n'; fails := fails + 1; end if;

  if te_on_desk('travel', v_not) then r := r || E'  ok   te_on_desk(may NOT book)    = true   <- the fix\n';
  else r := r || E'  FAIL te_on_desk(may NOT book) should be true: can_book must not gate membership\n'; fails := fails + 1; end if;

  if not te_on_desk('travel', v_off) then r := r || E'  ok   te_on_desk(no desk row)    = false\n';
  else r := r || E'  FAIL te_on_desk(no desk row) should be false\n'; fails := fails + 1; end if;

  -- ── who answers: both must be returned ───────────────────────────────────
  v_members := te_desk_members('travel', v_co, v_loc);
  if v_able = any (v_members) then r := r || E'  ok   te_desk_members includes the booker\n';
  else r := r || E'  FAIL te_desk_members must include the booker\n'; fails := fails + 1; end if;

  if v_not = any (v_members) then r := r || E'  ok   te_desk_members includes the non-booker   <- the fix\n';
  else r := r || E'  FAIL te_desk_members must include the non-booker, or they see the tab and nothing in it\n'; fails := fails + 1; end if;

  -- ── the right itself ─────────────────────────────────────────────────────
  if te_may_book(v_able) then r := r || E'  ok   te_may_book(may book)      = true\n';
  else r := r || E'  FAIL te_may_book(may book) should be true\n'; fails := fails + 1; end if;

  if not te_may_book(v_not) then r := r || E'  ok   te_may_book(may NOT book)  = false  <- the right bites\n';
  else r := r || E'  FAIL te_may_book(may NOT book) should be false\n'; fails := fails + 1; end if;

  if te_may_book(v_off) then r := r || E'  ok   te_may_book(no desk row)    = true   (role decides, as before)\n';
  else r := r || E'  FAIL te_may_book must never refuse somebody who is on no travel desk\n'; fails := fails + 1; end if;

  -- ── finance must be exactly as it was ────────────────────────────────────
  insert into finance_team (company_id, location_id, employee_id, can_approve, can_disburse, is_group_scope, is_active)
  values (v_co, v_loc, v_off, false, false, false, true);
  if not te_on_desk('finance', v_off) then r := r || E'  ok   finance untouched: can_approve = false still means off the desk\n';
  else r := r || E'  FAIL finance was widened by accident: can_approve = false must keep somebody off it\n'; fails := fails + 1; end if;

  raise exception E'175 VERIFY — % check(s) failed%', fails, r ||
    E'\n  (This error is expected: it rolls the fixture back. Nothing was kept.)';
end $$;
