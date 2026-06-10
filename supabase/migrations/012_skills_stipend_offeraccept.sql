-- ============================================================
-- 012_skills_stipend_offeraccept.sql
-- #2 skills database · #4 stipend fields · #5 offer-accept + HR email
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================

-- ── #2: skills database (searchable, custom-add) ────────────────
create table if not exists public.skills (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  created_at timestamptz default now()
);
alter table public.skills enable row level security;
drop policy if exists skills_anon_all on public.skills;
create policy skills_anon_all on public.skills for all to anon, authenticated using (true) with check (true);

insert into public.skills (name) values
 ('Python'),('Java'),('JavaScript'),('TypeScript'),('React'),('Node.js'),('Angular'),('Vue.js'),
 ('SQL'),('PostgreSQL'),('MySQL'),('MongoDB'),('Redis'),('AWS'),('Azure'),('GCP'),('Docker'),
 ('Kubernetes'),('C'),('C++'),('C#'),('Go'),('Rust'),('PHP'),('Ruby'),('Swift'),('Kotlin'),
 ('HTML'),('CSS'),('Tailwind CSS'),('Django'),('Flask'),('Spring Boot'),('.NET'),('Express.js'),
 ('GraphQL'),('REST API'),('Git'),('Linux'),('CI/CD'),('Jenkins'),('Terraform'),('Machine Learning'),
 ('Deep Learning'),('Data Analysis'),('Data Science'),('Pandas'),('NumPy'),('TensorFlow'),('PyTorch'),
 ('Power BI'),('Tableau'),('Excel'),('Advanced Excel'),('SAP'),('SAP APO'),('Salesforce'),
 ('Communication'),('Leadership'),('Team Management'),('Project Management'),('Agile'),('Scrum'),
 ('Sales'),('FMCG Sales'),('B2B Sales'),('Distributor Management'),('Channel Sales'),('Modern Trade'),
 ('Secondary Sales'),('Marketing'),('Digital Marketing'),('SEO'),('Content Writing'),
 ('Supply Chain'),('Demand Planning'),('Logistics'),('Procurement'),('Inventory Management'),
 ('Forecast Accuracy'),('Accounting'),('Finance'),('Taxation'),('Auditing'),
 ('Recruitment'),('HR Operations'),('Payroll'),('Customer Service'),('Operations Management')
on conflict (name) do nothing;

-- ── #4: stipend fields on ctc_negotiations (interns / contract / etc.) ──
alter table public.ctc_negotiations
  add column if not exists is_stipend      boolean default false,
  add column if not exists stipend_monthly bigint,
  add column if not exists tds_applicable  boolean default false,
  add column if not exists tds_pct         numeric(5,2);

-- ── #5: offer acceptance tracking + HR email on candidates ──────
alter table public.candidates
  add column if not exists hr_email            text,
  add column if not exists offer_accepted      boolean default false,
  add column if not exists offer_sent_at       timestamptz,
  add column if not exists offer_reminder_sent boolean default false;
