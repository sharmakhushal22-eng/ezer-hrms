-- 158_config_branch_scope.sql (was 137 on the feature branch)
--
-- Configuration templates per BRANCH, below the company.
--
-- A company can have several branches (locations), and a branch may need its own
-- wording — a different address paragraph, a local signatory, a state-specific clause.
-- A template can now exist at three levels, and every workflow uses the most specific
-- one that is published:
--
--     branch (location_id)  →  company (company_id)  →  Global  →  built-in text in code
--
-- A branch row carries BOTH its company_id and its location_id, so a company's editors
-- (lib/config/access.ts) can see and edit their own branches and nothing else.
--
-- Additive: existing rows and history are untouched (location_id is NULL for them,
-- which is exactly what they are — Global or company level).
--
-- Idempotent. Depends on 157_config_templates.sql (applied earlier as "134" / "136"), locations.

alter table config_templates         add column if not exists location_id uuid references locations(id);
alter table config_template_versions add column if not exists location_id uuid references locations(id);

-- A branch row always names its company.
alter table config_templates drop constraint if exists config_templates_branch_has_company;
alter table config_templates add constraint config_templates_branch_has_company
  check (location_id is null or company_id is not null);

-- One row per level: Global, (template, company), (template, branch).
drop index if exists ux_config_templates_global;
drop index if exists ux_config_templates_company;
drop index if exists ux_config_templates_branch;
create unique index ux_config_templates_global
  on config_templates(template_key) where company_id is null and location_id is null;
create unique index ux_config_templates_company
  on config_templates(template_key, company_id) where company_id is not null and location_id is null;
create unique index ux_config_templates_branch
  on config_templates(template_key, location_id) where location_id is not null;

-- Publish / reset gain the branch. The old two-level signatures are replaced.
drop function if exists config_publish_template(text, uuid, text, text, text, uuid, text, text);
drop function if exists config_reset_template(text, uuid, text, uuid, text);

create or replace function config_publish_template(
  p_template_key text,
  p_company_id   uuid,
  p_location_id  uuid,
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
   where template_key = p_template_key
     and company_id  is not distinct from p_company_id
     and location_id is not distinct from p_location_id
   for update;
  if not found then
    insert into config_templates(template_key, company_id, location_id)
    values (p_template_key, p_company_id, p_location_id)
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
    (template_id, template_key, company_id, location_id, version, action, subject, body, change_note, actor_id, actor_name)
  values
    (t.id, t.template_key, t.company_id, t.location_id, t.version, p_action, p_subject, p_body, p_change_note, p_actor_id, p_actor_name);

  return t;
end $$;

create or replace function config_reset_template(
  p_template_key text,
  p_company_id   uuid,
  p_location_id  uuid,
  p_change_note  text,
  p_actor_id     uuid,
  p_actor_name   text
) returns config_templates
language plpgsql as $$
declare
  t config_templates;
begin
  select * into t from config_templates
   where template_key = p_template_key
     and company_id  is not distinct from p_company_id
     and location_id is not distinct from p_location_id
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
    (template_id, template_key, company_id, location_id, version, action, subject, body, change_note, actor_id, actor_name)
  values
    (t.id, t.template_key, t.company_id, t.location_id, t.version, 'RESET', null, null, p_change_note, p_actor_id, p_actor_name);

  return t;
end $$;

revoke all on function config_publish_template(text, uuid, uuid, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function config_reset_template(text, uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function config_publish_template(text, uuid, uuid, text, text, text, uuid, text, text) to service_role;
grant execute on function config_reset_template(text, uuid, uuid, text, uuid, text) to service_role;

create index if not exists ix_config_template_versions_location
  on config_template_versions(location_id, created_at desc) where location_id is not null;

notify pgrst, 'reload schema';
