-- 161_te_desk_scope.sql — the Finance desk and the Travel desk become things
-- that belong to a company AND a branch, not just a company.
-- SAFE TO RUN TWICE. CHANGES NO BEHAVIOUR ON ITS OWN — nothing reads the new
-- column until 162 wires it in. Apply this one, verify it, then apply that one.
-- ----------------------------------------------------------------------------
-- THE SHAPE OF THE COMPANY. group → companies → branches already exists:
-- groups(1) → companies(3, each with group_id) → locations(10, each with
-- company_id). Employees carry company_id and location_id. The only thing
-- missing was that a desk could not be told which branch it answers for, so
-- every Finance person in a company saw every other branch's money.
--
-- WHO IS ON WHICH DESK
--   finance_team   gains location_id.  NULL = every branch of that company.
--   travel_desk    is new, and is the same shape on purpose. Until now the
--                  Travel Desk tab was reachable by anyone holding the
--                  dashboard "Travel Claims" permission, which in this data
--                  means every HR Manager — eleven of them, none of whom was
--                  asked to book a ticket.
--
-- THE LADDER, and it is the whole policy. te_desk_members() answers "who is
-- responsible for this company and this branch" in three steps, stopping at
-- the first that finds anybody:
--
--   1. THE BRANCH        members at that branch, PLUS members whose
--                        location_id is null, who answer for every branch
--   2. THE COMPANY       anybody on that company's desk, whatever their branch
--   3. THE GROUP         members flagged is_group_scope, in any company that
--                        shares the group
--
-- Step 2 exists so a small branch does not wedge. SSM Ludhiana Factory has two
-- Finance people; the day both are on leave a claim raised there must still
-- reach somebody, and reaching another branch of the same company is better
-- than reaching nobody.
--
-- WHY A LADDER AND NOT A STAMP. The fallback is resolved when somebody READS
-- the queue, not when the chain is built. So the moment an administrator adds
-- a Finance person to Ludhiana, every claim already waiting there becomes that
-- person's without one approval step being rewritten. Freezing the decision at
-- build time would have left a backlog addressed to the wrong branch forever.
--
-- EVERYTHING HERE IS EDITABLE FROM ADMIN. There is no hardcoded employee, no
-- hardcoded branch and no role name in any rule. The seed at the bottom is a
-- starting position, not the configuration.
-- ============================================================================

-- ── 1. a desk row can name a branch ─────────────────────────────────────────

alter table finance_team add column if not exists location_id uuid references locations(id) on delete set null;

comment on column finance_team.location_id is
  'The branch this person answers for. NULL means every branch of the company. See te_desk_members.';

-- Nobody should be on the same desk twice. The plain unique constraint cannot
-- say this, because in Postgres two NULLs never conflict, so one person could
-- hold two "every branch" rows for one company.
create unique index if not exists uq_finance_team_desk
  on finance_team (company_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), employee_id);

-- ── 2. the Travel desk, as its own list ─────────────────────────────────────

create table if not exists travel_desk (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  -- NULL = every branch of that company.
  location_id    uuid references locations(id) on delete set null,
  employee_id    uuid not null references employees(id) on delete cascade,
  role           text not null default 'DESK' check (role in ('DESK','MANAGER')),
  -- Booking a ticket spends company money, so it is its own right, the same
  -- way finance_team separates can_approve from can_disburse.
  can_book       boolean not null default true,
  -- Answers for every company in the group, for a shared desk that serves all
  -- three. One row instead of one per company.
  is_group_scope boolean not null default false,
  is_active      boolean not null default true,
  added_by       uuid references employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists uq_travel_desk_desk
  on travel_desk (company_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), employee_id);
create index if not exists idx_travel_desk_company on travel_desk (company_id) where is_active;

comment on table travel_desk is
  'Who books tickets and chooses hotels, per company and optionally per branch. Edited from Admin → Travel and Expense → Desks.';

alter table travel_desk enable row level security;
drop policy if exists "allow_all_travel_desk" on travel_desk;
create policy "allow_all_travel_desk" on travel_desk
  for all to anon, authenticated using (true) with check (true);

-- ── 3. the branch a step answers to ─────────────────────────────────────────
-- NULL on every existing row, which reads as "any branch" — exactly what those
-- rows have always meant. 162 starts stamping it.

alter table te_approval_steps add column if not exists desk_location_id uuid references locations(id) on delete set null;

comment on column te_approval_steps.desk_location_id is
  'The branch whose desk this team step belongs to: the raiser''s own branch. NULL = any branch, which is what every step written before migration 162 means.';

-- ── 4. THE POLICY, in one function ──────────────────────────────────────────

create or replace function te_desk_members(p_kind text, p_company uuid, p_location uuid default null)
returns uuid[] language plpgsql stable as $$
declare
  v_out   uuid[] := '{}';
  v_group uuid;
begin
  if p_kind not in ('finance', 'travel') then
    perform te_fail('TE_FORBIDDEN', format('There is no %s desk.', p_kind));
  end if;

  -- 1. THE BRANCH. A member with no location_id answers for every branch, so
  --    they belong to this one too and are counted here rather than in step 2.
  if p_location is not null then
    if p_kind = 'finance' then
      select coalesce(array_agg(f.employee_id order by f.created_at, f.employee_id), '{}') into v_out
        from finance_team f
       where f.company_id = p_company
         and (f.location_id = p_location or f.location_id is null)
         and f.is_active and f.can_approve and te_is_employee_active(f.employee_id);
    else
      select coalesce(array_agg(d.employee_id order by d.created_at, d.employee_id), '{}') into v_out
        from travel_desk d
       where d.company_id = p_company
         and (d.location_id = p_location or d.location_id is null)
         and d.is_active and d.can_book and te_is_employee_active(d.employee_id);
    end if;
    if cardinality(v_out) > 0 then
      return v_out;
    end if;
  end if;

  -- 2. THE COMPANY, any branch. Also the answer when no branch was asked for,
  --    which is what te_finance_members(company) has always meant.
  if p_kind = 'finance' then
    select coalesce(array_agg(f.employee_id order by f.created_at, f.employee_id), '{}') into v_out
      from finance_team f
     where f.company_id = p_company
       and f.is_active and f.can_approve and te_is_employee_active(f.employee_id);
  else
    select coalesce(array_agg(d.employee_id order by d.created_at, d.employee_id), '{}') into v_out
      from travel_desk d
     where d.company_id = p_company
       and d.is_active and d.can_book and te_is_employee_active(d.employee_id);
  end if;
  if cardinality(v_out) > 0 then
    return v_out;
  end if;

  -- 3. THE GROUP. A desk that serves every company in the group, for the case
  --    where one company has no desk of its own at all.
  select c.group_id into v_group from companies c where c.id = p_company;
  if v_group is null then
    return v_out;
  end if;
  if p_kind = 'finance' then
    select coalesce(array_agg(f.employee_id order by f.created_at, f.employee_id), '{}') into v_out
      from finance_team f
      join companies c on c.id = f.company_id
     where c.group_id = v_group and f.is_group_scope
       and f.is_active and f.can_approve and te_is_employee_active(f.employee_id);
  else
    select coalesce(array_agg(d.employee_id order by d.created_at, d.employee_id), '{}') into v_out
      from travel_desk d
      join companies c on c.id = d.company_id
     where c.group_id = v_group and d.is_group_scope
       and d.is_active and d.can_book and te_is_employee_active(d.employee_id);
  end if;
  return v_out;
end;
$$;

comment on function te_desk_members is
  'Who answers for this company and branch: the branch first, then the company, then the group. The whole scoping policy lives here.';

-- te_finance_members keeps its name and its exact meaning — anyone on this
-- company's Finance desk — so every existing caller (te_can_view, te_queue,
-- te_trip_detail) is untouched. It is now one line over the ladder above,
-- which is step 2 when no branch is named.
create or replace function te_finance_members(p_company_id uuid)
returns uuid[] language sql stable as $$
  select te_desk_members('finance', p_company_id, null);
$$;

-- Is this person on a desk at all? What the UI asks to decide whether to offer
-- the tab. Deliberately NOT branch-aware: somebody who answers for one branch
-- still gets the tab, and what they see inside it is filtered per request.
create or replace function te_on_desk(p_kind text, p_actor uuid)
returns boolean language sql stable as $$
  select case when p_kind = 'finance' then exists (
           select 1 from finance_team f
            where f.employee_id = p_actor and f.is_active and f.can_approve
              and te_is_employee_active(f.employee_id))
         else exists (
           select 1 from travel_desk d
            where d.employee_id = p_actor and d.is_active and d.can_book
              and te_is_employee_active(d.employee_id))
         end;
$$;

comment on function te_on_desk is
  'Whether this person is on the named desk anywhere. Gates the tab; never decides what is inside it.';

-- ── 5. the starting position ─────────────────────────────────────────────────
-- A seed, not the configuration. Everything below is editable from admin.

-- Every Finance desk row gets the branch its holder actually sits at. Written
-- only where it is still unset, so re-running this never undoes an
-- administrator's choice.
update finance_team f
   set location_id = e.location_id, updated_at = now()
  from employees e
 where e.id = f.employee_id
   and f.location_id is null
   and e.location_id is not null
   and e.company_id = f.company_id;

-- SOMEBODY ON ANOTHER COMPANY'S DESK IS A GROUP ROLE, and this data has
-- exactly one: the "Finance Executive — All Company" of the role master holds
-- three rows, one per company. is_group_scope says that in one place, and the
-- rows keep working as they are. Their location stays null — a person who
-- answers for another company is not answering for one of its branches.
update finance_team f
   set is_group_scope = true, updated_at = now()
  from employees e
 where e.id = f.employee_id
   and e.company_id <> f.company_id
   and not f.is_group_scope;

-- WHO MAY APPROVE. Every Finance & Accounts person on a permanent grade gets
-- it. The sixteen who do not — the interns, contractors and consultants, all
-- of whom carry no grade — are left exactly as somebody already set them:
-- off. Approving a colleague's travel money is a standing authority, and a
-- six-month contract is not the place to hand it out by default. An
-- administrator can switch any of them on from Admin → Travel and Expense →
-- Desks, which is a deliberate act with a name against it.
--
-- NOTHING IS EVER REVOKED HERE. The update only ever sets a flag true. Two
-- people below M1 hold can_disburse today; somebody chose that, and a
-- migration that quietly took it away would be a migration nobody could trust
-- to run twice.
update finance_team f
   set can_approve = true, updated_at = now()
  from employees e
 where e.id = f.employee_id
   and e.grade is not null
   and not f.can_approve;

-- Paying out is the stricter right, so it follows the manager grades.
update finance_team f
   set can_disburse = true, updated_at = now()
  from employees e
 where e.id = f.employee_id
   and e.grade in ('M1', 'M2')
   and not f.can_disburse;

-- The Travel desk starts with the role master's Admin Manager, group scope,
-- because that is the one person the master names for this job. Branch desks
-- are added from admin.
insert into travel_desk (company_id, location_id, employee_id, role, can_book, is_group_scope, is_active)
select e.company_id, null, e.id, 'MANAGER', true, true, true
  from employees e
 where e.emp_code = 'SRS9016'
   and te_is_employee_active(e.id)
on conflict do nothing;
