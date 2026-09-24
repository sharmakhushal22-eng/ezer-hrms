-- 131_id_card_downloads.sql
--
-- Two things, both for "HR downloads an employee's ID card from the Employee
-- section": somewhere to record that it happened, and somewhere to say which
-- branch a Branch HR was actually put in charge of.
--
-- WHY A LOG AT ALL. The card carries a personal emergency contact — somebody's
-- spouse's mobile number — plus a photograph and a blood group. That is not the
-- same as exporting a headcount. A download is therefore recorded the way a
-- gate scan already is (id_card_scans, migration 092): who did it, whose card,
-- when, in what form, and from where. The table is the point of the feature as
-- much as the button is.
--
-- Idempotent: create-if-not-exists and add-column-if-not-exists throughout, so
-- running it twice changes nothing.
--
-- Depends on: 092_id_card_qr.sql (id_card_credentials), 021_ess.sql
--             (ess_user_roles), and the employees/locations tables.

-- ─── 1. the download log ─────────────────────────────────────────────
--
-- Shaped after id_card_scans deliberately: same id/subject/timestamp/ip/
-- user_agent/detail spine, so the two read alike when somebody is
-- reconstructing what happened to a card.
--
-- actor_role_codes is denormalised on purpose. Roles get reassigned, and a log
-- saying "Kiran downloaded 40 cards" is far less useful six months later than
-- one saying "Kiran, holding BRANCH_HR, downloaded 40 cards" — the whole reason
-- to keep the row is to answer whether the access was legitimate AT THE TIME.
create table if not exists id_card_downloads (
  id                 uuid primary key default gen_random_uuid(),
  downloaded_at      timestamptz not null default now(),

  -- who pulled it. Nullable because the legacy shared dashboard login has no
  -- employee row at all; actor_label still records what we know.
  actor_employee_id  uuid references employees(id) on delete set null,
  actor_label        text,
  actor_role_codes   text[],

  -- whose card. emp_code is copied because an employee row can be deleted and
  -- the trail must survive that — on delete set null would otherwise erase the
  -- only identifying thing in the row.
  subject_employee_id uuid references employees(id) on delete set null,
  subject_emp_code    text,

  format             text not null default 'pdf',   -- 'pdf' | 'png'
  sides              text not null default 'both',  -- 'both' | 'front' | 'back'
  -- How many cards this one action produced. 1 for a row download, N for a
  -- bulk PDF, so a burst is one honest row per subject rather than a number
  -- nobody can reconcile against the subjects.
  batch_size         int  not null default 1,
  source             text not null default 'admin', -- 'admin' | 'ess'

  ip                 inet,
  user_agent         text,
  detail             text
);

comment on table id_card_downloads is
  'Every ID card download. The card carries a personal emergency contact, so who took a copy is worth keeping.';

-- "show me everything that ever happened to this person's card"
create index if not exists idx_idcard_dl_subject
  on id_card_downloads (subject_employee_id, downloaded_at desc);

-- "show me everything this HR user pulled" — the question an audit actually asks
create index if not exists idx_idcard_dl_actor
  on id_card_downloads (actor_employee_id, downloaded_at desc);

-- the plain reverse-chronological log view
create index if not exists idx_idcard_dl_recent
  on id_card_downloads (downloaded_at desc);


-- ─── 2. which branch a Branch HR was put in charge of ────────────────
--
-- ess_roles.scope already says 'BRANCH' for BRANCH_HR, but that names the KIND
-- of scope, not the branch. Until now there was nowhere to record which one, so
-- the only available answer was "wherever that HR person themselves sits".
--
-- That is a real limitation rather than a theoretical one: it makes it
-- impossible to put a Gurugram-based HR person in charge of Pune. This column
-- is the missing half. NULL keeps the old behaviour — fall back to the role
-- holder's own employees.location_id — so nothing changes until somebody sets
-- it, and the feature works before this migration is applied as well as after.
alter table ess_user_roles
  add column if not exists location_id uuid references locations(id) on delete set null;

comment on column ess_user_roles.location_id is
  'For BRANCH-scoped roles: the location this assignment covers. NULL means fall back to the role holder''s own employees.location_id.';

create index if not exists idx_eur_location
  on ess_user_roles (location_id) where location_id is not null;


-- ─── 3. RLS ──────────────────────────────────────────────────────────
--
-- Deny-all to anon and authenticated, exactly as 092 does for the card tables.
-- The browser must never read this directly: the log says who looked at whose
-- personal data, which makes it personal data itself. Every read and write goes
-- through a route holding the service-role key, which bypasses RLS — so these
-- policies are the floor under a bug, not the gate itself.
alter table id_card_downloads enable row level security;

drop policy if exists idcdl_deny on id_card_downloads;
create policy idcdl_deny on id_card_downloads for all to anon, authenticated
  using (false) with check (false);


-- ─── 4. verify ───────────────────────────────────────────────────────
-- Expect: the table with 0 rows, and location_id present on ess_user_roles.
select count(*) as download_rows from id_card_downloads;

select column_name, data_type
  from information_schema.columns
 where table_name = 'ess_user_roles' and column_name = 'location_id';
