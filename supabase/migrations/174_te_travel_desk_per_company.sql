-- 174_te_travel_desk_per_company.sql — every company gets a travel desk.
-- SAFE TO RUN TWICE. Inserts only what is missing; changes no existing row.
-- ----------------------------------------------------------------------------
-- WHY. Migration 161 seeded ONE travel desk member — Vikram Bose, HR & Admin
-- at Sharma Retail — flagged is_group_scope to serve all three companies. Two
-- of the three companies therefore had no travel desk at all, and nothing
-- could be booked for them: an approved Sharma Trading trip with two flight
-- legs waiting for the desk showed up in nobody's work list.
--
-- The rule is the company's own: "the travel desk of the same company and
-- branch is responsible for managing it". So each company staffs its own.
--
-- WHO. The same shape migration 161 used for the finance desk, applied to the
-- department the travel desk is actually drawn from:
--
--   on the desk   every active HR & Admin employee with a real grade
--   may book      M1 and M2 only
--
-- CONTRACTORS, INTERNS AND CONSULTANTS ARE LEFT OFF, exactly as they were left
-- off the finance desk. They are the rows with no grade (the CTR, INT and CON
-- codes), somebody deliberately left them ungraded, and booking a ticket
-- spends company money.
--
-- EACH ROW CARRIES ITS OWN BRANCH, so that when the desk's work list is
-- finally filtered by the raiser's branch — v_te_to_book does not carry it
-- yet — the data is already right and nothing has to be backfilled.
--
-- VIKRAM'S GROUP-SCOPE ROW IS LEFT ALONE. It stays as the exception it was
-- meant to be: one person who answers for the whole group.
-- ============================================================================

do $$
declare
  r       record;
  v_added int := 0;
begin
  for r in
    select e.id          as employee_id,
           e.company_id,
           e.location_id,
           e.grade
      from employees e
      join departments d on d.id = e.department_id and d.company_id = e.company_id
     where d.dept_code = 'HR'
       -- A real grade. The ungraded rows are the contractors, interns and
       -- consultants, and they are not put on a desk that spends money.
       and e.grade is not null and btrim(e.grade) <> ''
       and te_is_employee_active(e.id)
       -- Only companies that actually use the module.
       and exists (select 1 from te_settings s where s.company_id = e.company_id)
  loop
    if not exists (
      select 1 from travel_desk t
       where t.company_id = r.company_id and t.employee_id = r.employee_id
    ) then
      insert into travel_desk (company_id, location_id, employee_id, role, can_book, is_group_scope, is_active)
      values (r.company_id, r.location_id, r.employee_id,
              case when r.grade in ('M1','M2') then 'MANAGER' else 'DESK' end,
              -- Booking spends money, so it is its own right: managers only,
              -- the same split finance_team makes between approving a claim
              -- and paying one.
              r.grade in ('M1','M2'),
              false, true);
      v_added := v_added + 1;
    end if;
  end loop;

  raise notice 'travel desk: % members added', v_added;
end $$;

notify pgrst, 'reload schema';
