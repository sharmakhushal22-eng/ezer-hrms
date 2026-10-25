-- 157_config_templates.sql  (applied 10 Oct 2026 as "134", then "136"; renumbered again on the merge into NayanAhuja, where 136–156 were taken)
--
-- Configuration → letter and email templates, editable without a deploy.
--
-- WHAT THIS STORES. The text of the letters and emails the portal sends: the offer
-- letter and offer email, interview invites, document-collection mails, onboarding
-- links, HR letters. The built-in wording still lives in code
-- (lib/config/registry.ts) and is what everyone gets until somebody edits it here —
-- so applying this migration changes nothing anyone sees.
--
-- TWO LEVELS. A row with company_id NULL is the Global default (Super Admin). A row
-- with a company_id overrides it for that company only. The resolver picks
-- company → global → built-in, using only rows that are active AND have been
-- published at least once (version > 0). A saved draft never reaches a letter.
--
-- HISTORY IS APPEND-ONLY. Every publish / restore / reset writes a row to
-- config_template_versions, which a trigger refuses to update or delete. That table
-- is the audit trail: who changed what, when, and the exact text.
--
-- SERVER ONLY. RLS is on with no policy, so the anon key in the browser can neither
-- read nor write these tables; everything goes through /api/config/* with the
-- service-role key and its own permission check. If the service key is missing the
-- reads come back empty and every workflow falls back to the built-in text.
--
-- Idempotent — safe to run twice. Depends on companies, employees.

create table if not exists config_templates (
  id                    uuid primary key default gen_random_uuid(),
  -- 'offer.email', 'interview.candidate', 'hr_letter:<letter_templates.id>', …
  template_key          text not null,
  -- NULL = Global default; otherwise this company's own version.
  company_id            uuid references companies(id),
  -- What is live. Empty until the first publish.
  subject               text,
  body                  text,
  -- 0 = never published (draft only). Goes up by one on every publish / restore.
  version               int not null default 0,
  -- false after "Reset to default": the row and its history stay, the resolver skips it.
  is_active             boolean not null default true,
  -- Work in progress. Never used by a workflow.
  draft_subject         text,
  draft_body            text,
  draft_updated_at      timestamptz,
  draft_updated_by      uuid references employees(id) on delete set null,
  draft_updated_by_name text,
  published_at          timestamptz,
  published_by          uuid references employees(id) on delete set null,
  published_by_name     text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One Global row per template, one row per (template, company).
create unique index if not exists ux_config_templates_global
  on config_templates(template_key) where company_id is null;
create unique index if not exists ux_config_templates_company
  on config_templates(template_key, company_id) where company_id is not null;

create table if not exists config_template_versions (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references config_templates(id),
  template_key text not null,
  company_id   uuid references companies(id),
  version      int not null,
  action       text not null check (action in ('PUBLISHED', 'RESTORED', 'RESET')),
  subject      text,
  body         text,
  change_note  text,
  actor_id     uuid references employees(id) on delete set null,
  actor_name   text,
  created_at   timestamptz not null default now()
);
create index if not exists ix_config_template_versions_key
  on config_template_versions(template_key, company_id, created_at desc);

-- History is evidence. Nothing edits or deletes it — not the app, not a stray script.
create or replace function config_template_versions_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'config_template_versions is append-only';
end $$;

drop trigger if exists trg_config_template_versions_append_only on config_template_versions;
create trigger trg_config_template_versions_append_only
  before update or delete on config_template_versions
  for each row execute function config_template_versions_append_only();

-- Publish = make the given text live and record it, in ONE transaction, so a live
-- template can never exist without its history row (or the other way round).
create or replace function config_publish_template(
  p_template_key text,
  p_company_id   uuid,
  p_subject      text,
  p_body         text,
  p_change_note  text,
  p_actor_id     uuid,
  p_actor_name   text,
  p_action       text default 'PUBLISHED'
) returns config_templates
language plpgsql as $$
declare
  t config_templates;
begin
  select * into t from config_templates
   where template_key = p_template_key and company_id is not distinct from p_company_id
   for update;
  if not found then
    insert into config_templates(template_key, company_id)
    values (p_template_key, p_company_id)
    returning * into t;
  end if;

  update config_templates set
    subject = p_subject, body = p_body,
    version = t.version + 1, is_active = true,
    draft_subject = null, draft_body = null,
    draft_updated_at = null, draft_updated_by = null, draft_updated_by_name = null,
    published_at = now(), published_by = p_actor_id, published_by_name = p_actor_name,
    updated_at = now()
  where id = t.id
  returning * into t;

  insert into config_template_versions
    (template_id, template_key, company_id, version, action, subject, body, change_note, actor_id, actor_name)
  values
    (t.id, t.template_key, t.company_id, t.version, p_action, p_subject, p_body, p_change_note, p_actor_id, p_actor_name);

  return t;
end $$;

-- Reset = stop using this level's text (a company falls back to Global, Global falls
-- back to the built-in wording). The row and its history are kept.
create or replace function config_reset_template(
  p_template_key text,
  p_company_id   uuid,
  p_change_note  text,
  p_actor_id     uuid,
  p_actor_name   text
) returns config_templates
language plpgsql as $$
declare
  t config_templates;
begin
  select * into t from config_templates
   where template_key = p_template_key and company_id is not distinct from p_company_id
   for update;
  if not found then
    return null;
  end if;

  update config_templates set
    is_active = false,
    draft_subject = null, draft_body = null,
    draft_updated_at = null, draft_updated_by = null, draft_updated_by_name = null,
    updated_at = now()
  where id = t.id
  returning * into t;

  insert into config_template_versions
    (template_id, template_key, company_id, version, action, subject, body, change_note, actor_id, actor_name)
  values
    (t.id, t.template_key, t.company_id, t.version, 'RESET', null, null, p_change_note, p_actor_id, p_actor_name);

  return t;
end $$;

-- Server only: RLS on, no policy for anon/authenticated.
alter table config_templates enable row level security;
alter table config_template_versions enable row level security;

revoke all on function config_publish_template(text, uuid, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function config_reset_template(text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function config_publish_template(text, uuid, text, text, text, uuid, text, text) to service_role;
grant execute on function config_reset_template(text, uuid, text, uuid, text) to service_role;

comment on table config_templates is
  'Configuration: letter/email template text. company_id NULL = Global default. Only active rows with version > 0 are used. Built-in text in lib/config/registry.ts applies when no row exists.';
comment on table config_template_versions is
  'Append-only history and audit trail of every publish / restore / reset of config_templates.';

notify pgrst, 'reload schema';
