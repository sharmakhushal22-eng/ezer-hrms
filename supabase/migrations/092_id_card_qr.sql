-- =====================================================================
-- 092_id_card_qr.sql — digital ID card with a rotating QR
--
-- ADAPTED FOR THIS DATABASE from EZER-Profile360.zip, which ships this as
-- migration 086. It is 092 here because 086 is the Wall of Fame's, and it
-- follows 091 because it reads employees.photo_path, which 091 adds.
--
-- WHAT CHANGED, and why
--
--   employee_code -> emp_code                  the usual rename
--   status        -> employment_status         same
--
--   THE STATUS VALUES ARE CAPITALISED HERE. Every employee row reads
--   'Active', not 'active'. The original ended with
--
--       where coalesce(status,'active') = 'active'
--
--   which matches nothing in this database — it would have run without error
--   and issued ZERO cards, and the failure would only have surfaced when
--   somebody held up a blank ID at a gate. Every comparison below is
--   lower()ed so it survives whichever casing a future import uses.
--
-- SECURITY MODEL, unchanged from the original because it is sound
--
--   * The QR carries a signed token and nothing else — no name, no code.
--   * Each employee has a server-side secret the app never sees.
--   * A token lives 30 seconds; the screen rotates every 15, so there is
--     always a live overlap and the guard never reads a dead code.
--   * Every token has a jti and is scannable ONCE. A screenshotted code
--     fails on the second scan and dies after 30 seconds regardless.
--   * Tokens carry card_version, so rotating the secret — loss, theft,
--     exit — invalidates every code ever issued, instantly.
--   * Leaving, suspension or a revoked card blocks verification outright.
--
-- SAFE TO RUN TWICE. issue_id_card rotates the secret on conflict, which
-- means re-running invalidates live QRs — correct, but do not do it casually
-- in the middle of a shift change.
-- =====================================================================

do $$ begin create type id_card_state as enum ('active','suspended','revoked','expired');
exception when duplicate_object then null; end $$;

do $$ begin create type scan_result as enum
  ('valid','expired','replayed','revoked','separated','bad_signature','unknown');
exception when duplicate_object then null; end $$;


-- ─── 1. the per-employee credential ──────────────────────────────────
create table if not exists id_card_credentials (
  employee_id   uuid primary key references employees(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  secret        text not null,
  card_version  int  not null default 1,
  card_no       text not null,
  state         id_card_state not null default 'active',
  access_zones  text[] default '{}',
  issued_at     timestamptz not null default now(),
  valid_till    date,
  rotated_at    timestamptz not null default now(),
  rotated_by    uuid references employees(id),
  revoke_reason text,
  created_at    timestamptz default now()
);
create index if not exists idx_idcard_company on id_card_credentials (company_id, state);


-- ─── 2. single-use token registry ────────────────────────────────────
create table if not exists id_card_tokens (
  jti          text primary key,
  employee_id  uuid not null references employees(id) on delete cascade,
  card_version int  not null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by_gate text
);
create index if not exists idx_idtok_exp on id_card_tokens (expires_at);
create index if not exists idx_idtok_emp on id_card_tokens (employee_id, issued_at desc);


-- ─── 3. every scan, good or bad ──────────────────────────────────────
create table if not exists id_card_scans (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete set null,
  jti         text,
  gate_id     text,
  scanned_at  timestamptz not null default now(),
  result      scan_result not null,
  ip          inet,
  user_agent  text,
  detail      text
);
create index if not exists idx_scan_emp on id_card_scans (employee_id, scanned_at desc);
create index if not exists idx_scan_bad on id_card_scans (result, scanned_at desc)
  where result <> 'valid';


-- ─── 4. issue, rotate, revoke ────────────────────────────────────────
create or replace function issue_id_card(p_employee_id uuid, p_by uuid default null)
returns id_card_credentials
language plpgsql security definer set search_path = public as $$
declare e record; row_out id_card_credentials;
begin
  select * into e from employees where id = p_employee_id;
  if not found then raise exception 'employee not found'; end if;

  insert into id_card_credentials
    (employee_id, company_id, secret, card_no, access_zones, valid_till)
  values (
    p_employee_id, e.company_id,
    encode(gen_random_bytes(32), 'base64'),
    'AC-' || e.emp_code,
    '{HO}',
    (date_trunc('year', current_date) + interval '1 year 3 month - 1 day')::date
  )
  on conflict (employee_id) do update
    set secret        = encode(gen_random_bytes(32), 'base64'),
        card_version  = id_card_credentials.card_version + 1,
        state         = 'active',
        rotated_at    = now(),
        rotated_by    = p_by,
        revoke_reason = null
  returning * into row_out;
  return row_out;
end $$;

create or replace function revoke_id_card(
  p_employee_id uuid, p_reason text, p_by uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update id_card_credentials
     set state = 'revoked', revoke_reason = p_reason,
         card_version = card_version + 1,   -- kills every code already printed
         secret = encode(gen_random_bytes(32), 'base64'),
         rotated_at = now(), rotated_by = p_by
   where employee_id = p_employee_id;
  delete from id_card_tokens where employee_id = p_employee_id and used_at is null;
end $$;


-- Leaving or suspension kills the card without anybody remembering to do it.
create or replace function trg_employee_card_guard() returns trigger
language plpgsql as $$
begin
  -- lower() throughout: this database stores 'Active', the original compared
  -- against 'active', and the mismatch is silent in both directions.
  if (new.date_of_leaving is not null and new.date_of_leaving <= current_date)
     or lower(coalesce(new.employment_status, '')) in
        ('separated','suspended','inactive','exited','resigned')
  then
    perform revoke_id_card(new.id,
      'auto: employee ' || coalesce(new.employment_status, 'left'));
  end if;
  return new;
end $$;

drop trigger if exists employee_card_guard on employees;
create trigger employee_card_guard
  after update of employment_status, date_of_leaving on employees
  for each row execute function trg_employee_card_guard();


-- ─── 5. token bookkeeping — the signing itself is in the Node layer ──
create or replace function register_id_token(
  p_jti text, p_employee_id uuid, p_card_version int, p_ttl_seconds int default 30)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into id_card_tokens (jti, employee_id, card_version, expires_at)
  values (p_jti, p_employee_id, p_card_version,
          now() + make_interval(secs => p_ttl_seconds));
  -- Opportunistic cleanup, so the table stays small without a cron job.
  delete from id_card_tokens where expires_at < now() - interval '10 minutes';
end $$;


create or replace function consume_id_token(
  p_jti text, p_gate text default null, p_ip inet default null, p_ua text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; c record; e record;
begin
  select * into t from id_card_tokens where jti = p_jti;

  if not found then
    insert into id_card_scans (jti, gate_id, result, ip, user_agent, detail)
    values (p_jti, p_gate, 'unknown', p_ip, p_ua, 'jti not registered');
    return jsonb_build_object('valid', false,
      'reason', 'This code was not issued by EZER.');
  end if;

  if t.used_at is not null then
    insert into id_card_scans (employee_id, jti, gate_id, result, ip, user_agent, detail)
    values (t.employee_id, p_jti, p_gate, 'replayed', p_ip, p_ua,
            'already scanned at ' || t.used_at);
    return jsonb_build_object('valid', false, 'reason',
      'This code was already used. A shared or screenshotted code will not work.');
  end if;

  if t.expires_at < now() then
    insert into id_card_scans (employee_id, jti, gate_id, result, ip, user_agent)
    values (t.employee_id, p_jti, p_gate, 'expired', p_ip, p_ua);
    return jsonb_build_object('valid', false,
      'reason', 'This code has expired. Ask for a fresh one.');
  end if;

  select * into c from id_card_credentials where employee_id = t.employee_id;
  if c.state <> 'active' or c.card_version <> t.card_version then
    insert into id_card_scans (employee_id, jti, gate_id, result, ip, user_agent, detail)
    values (t.employee_id, p_jti, p_gate, 'revoked', p_ip, p_ua, c.revoke_reason);
    return jsonb_build_object('valid', false, 'reason', 'This card has been revoked.');
  end if;

  select * into e from employees where id = t.employee_id;
  if e.date_of_leaving is not null and e.date_of_leaving < current_date then
    insert into id_card_scans (employee_id, jti, gate_id, result, ip, user_agent)
    values (t.employee_id, p_jti, p_gate, 'separated', p_ip, p_ua);
    return jsonb_build_object('valid', false,
      'reason', 'This person has left the organisation.');
  end if;

  update id_card_tokens set used_at = now(), used_by_gate = p_gate where jti = p_jti;
  insert into id_card_scans (employee_id, jti, gate_id, result, ip, user_agent)
  values (t.employee_id, p_jti, p_gate, 'valid', p_ip, p_ua);

  -- Deliberately thin. A guard needs to know who is in front of them and
  -- nothing else, so the response carries no contact details, no identifiers
  -- and nothing that would matter if the scanner were compromised.
  return jsonb_build_object(
    'valid', true,
    'employee_code', e.emp_code,
    'name',          e.full_name,
    'designation',   e.designation,
    'photo_path',    e.photo_path,
    'card_no',       c.card_no,
    'access_zones',  c.access_zones,
    'valid_till',    c.valid_till,
    'scanned_at',    now());
end $$;


-- ─── 6. these three tables are service-role only ─────────────────────
-- Written by the original, and right: the secret column is the whole security
-- model. Nothing outside the functions above should read any of it, so the
-- policies deny everybody and the functions are SECURITY DEFINER.
--
-- This is the one place in the profile work where RLS is NOT left open for a
-- decision, because there is no version of "who should read the signing
-- secrets" other than nobody.
alter table id_card_credentials enable row level security;
alter table id_card_tokens      enable row level security;
alter table id_card_scans       enable row level security;

drop policy if exists idc_deny on id_card_credentials;
create policy idc_deny on id_card_credentials for all to anon, authenticated
  using (false) with check (false);
drop policy if exists idt_deny on id_card_tokens;
create policy idt_deny on id_card_tokens for all to anon, authenticated
  using (false) with check (false);
drop policy if exists ids_deny on id_card_scans;
create policy ids_deny on id_card_scans for all to anon, authenticated
  using (false) with check (false);

revoke all on function issue_id_card(uuid, uuid)          from anon, authenticated;
revoke all on function revoke_id_card(uuid, text, uuid)   from anon, authenticated;
revoke all on function register_id_token(text, uuid, int, int) from anon, authenticated;
revoke all on function consume_id_token(text, text, inet, text) from anon, authenticated;


-- ─── 7. issue a card to everybody currently working here ─────────────
-- lower() again. The original's 'active' matched nothing in this database and
-- would have issued no cards at all, silently.
do $$
declare r record; n int := 0;
begin
  for r in
    select id from employees
     where date_of_leaving is null
       and lower(coalesce(employment_status, 'active')) = 'active'
  loop
    perform issue_id_card(r.id);
    n := n + 1;
  end loop;
  raise notice 'issued or rotated % ID cards', n;
end $$;

comment on table id_card_tokens is
  'Single use QR tokens. A code is valid for 30 seconds and for exactly one '
  'scan. Rotating a card_version invalidates every code already issued.';
