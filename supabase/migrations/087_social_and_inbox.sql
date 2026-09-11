-- =====================================================================
-- ADAPTED FOR THIS DATABASE — see 082_access_foundation.sql
--
-- The bundle this came from assumes a schema that differs from the live one.
-- Every rename below was verified against the RUNNING database before it was
-- applied, not inferred from the code:
--
--   employee_code    -> emp_code          (employees)
--   date_of_joining  -> company_doj       (employees)
--   reports_to       -> l1_manager_id     (employees)
--   department_name  -> dept_name         (departments)
--   branches         -> locations          there is no branches table here,
--   branch_id           location_id        and employees.branch_id does not
--   branch_name         location_name      exist either
--
-- Nothing else was touched. is_active was left alone throughout: every
-- occurrence in this bundle is on the module's OWN tables (wall_admins,
-- board_screens, shoutout_categories, badge_master), not on companies.
--
-- can() and explain_access() come from 082, which reads the permission model
-- this app already has (ess_accounts / ess_user_roles / role_permissions)
-- rather than introducing a second one.
--
-- NOT APPLIED FROM HERE. Handed to Nayan.
-- =====================================================================

-- ── INBOX RECONCILIATION — READ BEFORE WIRING THE UI ─────────────────
--
-- This app now has THREE things that could each be called an inbox, and the
-- bundle's brief only knew about one of them:
--
--   1. the ESS approvals queue      pre-existing; leave, offers, workflow
--   2. inbox_* from migration 080   colleague-to-colleague messaging
--   3. wall_inbox_events, below     appreciation, comments, replies
--
-- They are NOT merged, and the brief's rule is the reason: the moment a
-- pending approval sits next to a thank-you note, people triage the tab
-- instead of reading it, and the appreciation goes unread. The same argument
-- applies to a work chat thread.
--
-- So the ESS Inbox page carries three tab groups with three separate unread
-- counts, never summed. This file owns only the third, and reads or writes
-- nothing belonging to the other two.
--
-- Note also that 080's messaging is a general channel while this one is
-- deliberately not: send_appreciation() requires a category, allows exactly
-- one thank-back, and cannot open a rolling thread. If those two ever look
-- like duplicates and somebody proposes collapsing them, the limits here are
-- the feature, not an oversight.
-- =====================================================================

-- =====================================================================
-- EZER HRMS · migration 087_social_and_inbox.sql
-- Adds: threaded comments, @mentions, direct appreciation messages,
--       and the unified Inbox event stream
-- Depends: 084, 085, 086
-- =====================================================================
-- WHAT THIS TURNS THE MODULE INTO
--   084–086 built a wall: posts, badges, a feed. This migration adds the
--   social layer around it — people talking on each other's recognition,
--   and appreciating each other privately through the ESS Inbox.
--
--   Recognition now flows through three channels:
--     1. Public shoutout   → company feed, everyone sees it        (086)
--     2. Comment / mention → conversation on someone's recognition (here)
--     3. Direct appreciation → private note into their ESS Inbox   (here)
--
--   All three land in the same Inbox stream, so an employee has one place
--   to see everything a colleague has said to or about them.
--
--   SCOPE OF THIS INBOX — READ THIS BEFORE ADDING AN EVENT TYPE
--   This inbox carries interpersonal recognition and nothing else:
--       appreciation · comments · replies
--   It does NOT carry approvals. Nomination endorsements, publish approvals,
--   leave, offers and every other workflow item stay in the existing ESS
--   approvals queue, which this module never writes to and never reads from.
--   The two are separate tabs on the same page, not one merged list.
--
--   Workflow noise is what kills a recognition inbox. The moment a pending
--   leave approval sits next to a colleague's thank-you note, people start
--   triaging the tab instead of reading it.
--
-- A DELIBERATE LIMIT, PLEASE DO NOT REMOVE IT
--   The direct channel is APPRECIATION ONLY. It is not a chat product.
--   Free-form person-to-person messaging inside an HRMS is a harassment
--   vector and a records-retention problem, and HR ends up owning both.
--
--   So a direct message:
--     - must carry a category (what the appreciation is for)
--     - allows the receiver exactly ONE reply, a thank-back
--     - cannot start an open-ended thread
--     - is throttled like a shoutout
--     - is reportable, retained, and visible to a moderator on report
--
--   If someone asks for general chat, that is a different product with a
--   different risk profile. Say so rather than loosening this.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. CONFIG
-- ---------------------------------------------------------------------
alter table wall_config
  add column if not exists direct_messages_enabled boolean not null default true,
  add column if not exists mentions_enabled        boolean not null default true,
  add column if not exists comment_replies_enabled boolean not null default true,
  add column if not exists dm_daily_limit          int not null default 10 check (dm_daily_limit between 0 and 50),
  add column if not exists dm_requires_category    boolean not null default true,
  add column if not exists dm_allow_share_to_feed  boolean not null default true,
  add column if not exists comment_max_depth       int not null default 1 check (comment_max_depth between 0 and 3);

comment on column wall_config.comment_max_depth is
  'Reply depth on a comment. 1 by default: a comment and its replies, never a tree.';

insert into wall_permissions (code, label, admin_only, min_level) values
  ('wof.message.send',  'Send direct appreciation',        false, null),
  ('wof.comment',       'Comment on a recognition',        false, null),
  ('wof.mention',       'Mention a colleague',             false, null),
  ('wof.inbox.view',    'See own Wall of Fame inbox',      false, null)
on conflict (code) do nothing;


-- ---------------------------------------------------------------------
-- 2. COMMENTS — threading, mentions, reactions
-- ---------------------------------------------------------------------
alter table recognition_comments
  add column if not exists parent_comment_id uuid references recognition_comments(id) on delete cascade,
  add column if not exists mentions uuid[] not null default '{}',
  add column if not exists edited_at timestamptz;

create index if not exists comments_thread on recognition_comments (recognition_id, parent_comment_id, created_at);
create index if not exists comments_mentions on recognition_comments using gin (mentions);

create table if not exists comment_reactions (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references recognition_comments(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  emoji       text not null default 'clap',
  created_at  timestamptz not null default now(),
  unique (comment_id, employee_id, emoji)
);

alter table comment_reactions enable row level security;
drop policy if exists comment_reactions_all on comment_reactions;
create policy comment_reactions_all on comment_reactions
  for all to anon, authenticated using (true) with check (true);


-- ---------------------------------------------------------------------
-- 3. DIRECT APPRECIATION MESSAGES
-- ---------------------------------------------------------------------
create table if not exists wall_messages (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  sender_id             uuid not null references employees(id),
  category_id           uuid references shoutout_categories(id),

  body                  text not null check (length(body) between 15 and 2000),

  -- a message can hang off something that already happened on the wall
  related_recognition_id uuid references recognitions(id) on delete set null,

  -- private by default; the sender may choose to post it publicly instead,
  -- and the receiver may ask for it to be shared
  share_state           text not null default 'private'
                        check (share_state in ('private','share_requested','shared','share_declined')),
  shared_recognition_id uuid references recognitions(id) on delete set null,
  share_requested_at    timestamptz,
  shared_at             timestamptz,

  is_archived           boolean not null default false,
  reported              boolean not null default false,
  created_at            timestamptz not null default now()
);

create table if not exists wall_message_recipients (
  message_id   uuid not null references wall_messages(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,
  read_at      timestamptz,
  thanked_at   timestamptz,
  thank_body   text check (thank_body is null or length(thank_body) <= 500),
  primary key (message_id, employee_id)
);

create index if not exists wall_messages_sender on wall_messages (company_id, sender_id, created_at desc);
create index if not exists wall_msg_recip_unread on wall_message_recipients (employee_id) where read_at is null;

comment on table wall_messages is
  'Private appreciation notes. Appreciation only, one thank-back reply, no open threads. See the header of migration 087.';

alter table wall_messages enable row level security;
alter table wall_message_recipients enable row level security;
drop policy if exists wall_messages_all on wall_messages;
drop policy if exists wall_message_recipients_all on wall_message_recipients;
create policy wall_messages_all on wall_messages
  for all to anon, authenticated using (true) with check (true);
create policy wall_message_recipients_all on wall_message_recipients
  for all to anon, authenticated using (true) with check (true);


-- ---------------------------------------------------------------------
-- 4. INBOX EVENT STREAM
-- ---------------------------------------------------------------------
-- One row per thing that happened TO an employee. The existing ESS Inbox
-- unions this in alongside its approval items — see get_wall_inbox().
create table if not exists wall_inbox_events (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  employee_id  uuid not null references employees(id) on delete cascade,   -- the recipient

  -- Three streams only: appreciation, comments, replies.
  -- No approvals, no workflow, no system chatter. See the header.
  event_type   text not null check (event_type in (
                 -- appreciation
                 'appreciation',      -- a direct appreciation note arrived
                 'recognised',        -- you were named in a shoutout or award
                 'thanked_back',      -- someone you appreciated thanked you
                 'share_request',     -- someone asked to make a private note public
                 -- comments
                 'commented',         -- someone commented on your recognition
                 'mentioned',         -- someone @mentioned you in a comment
                 -- replies
                 'replied'            -- someone replied to your comment
               )),

  actor_id     uuid references employees(id),          -- null for system events
  recognition_id uuid references recognitions(id) on delete cascade,
  comment_id   uuid references recognition_comments(id) on delete cascade,
  message_id   uuid references wall_messages(id) on delete cascade,

  preview      text,                                    -- short line for the list
  is_read      boolean not null default false,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists inbox_unread on wall_inbox_events (employee_id, is_read, created_at desc);
create index if not exists inbox_type on wall_inbox_events (employee_id, event_type, created_at desc);

alter table wall_inbox_events enable row level security;
drop policy if exists wall_inbox_events_all on wall_inbox_events;
create policy wall_inbox_events_all on wall_inbox_events
  for all to anon, authenticated using (true) with check (true);

-- internal fan-out helper
create or replace function wall_notify(
  p_employee uuid, p_type text, p_actor uuid, p_preview text,
  p_recognition uuid default null, p_comment uuid default null, p_message uuid default null
) returns void language plpgsql as $$
declare v_company uuid;
begin
  if p_employee is null or p_employee = p_actor then
    return;                                   -- never notify someone about their own action
  end if;
  select company_id into v_company from employees where id = p_employee;
  if v_company is null then return; end if;

  insert into wall_inbox_events
    (company_id, employee_id, event_type, actor_id, recognition_id, comment_id, message_id, preview)
  values (v_company, p_employee, p_type, p_actor, p_recognition, p_comment, p_message, left(p_preview, 240));
end $$;


-- ---------------------------------------------------------------------
-- 5. COMMENTS API
-- ---------------------------------------------------------------------
create or replace function add_comment(
  p_recognition uuid,
  p_body        text,
  p_parent      uuid default null,
  p_mentions    uuid[] default '{}'
) returns uuid
language plpgsql
as $$
declare
  v_actor uuid := wof_current_employee();
  v_company uuid; v_cfg wall_config%rowtype; r recognitions%rowtype;
  v_id uuid; v_depth int := 0; m uuid; v_name text;
begin
  select company_id into v_company from employees where id = v_actor;
  if not wof_can(v_actor, 'wof.comment', v_company) then
    raise exception 'Commenting is not available to you. %',
      wof_explain_access(v_actor, 'wof.comment', v_company) using errcode = '42501';
  end if;

  select * into v_cfg from wall_config where company_id = v_company;
  select * into r from recognitions where id = p_recognition and is_archived = false;
  if r.id is null then raise exception 'That post is no longer available.'; end if;

  if p_parent is not null then
    if not v_cfg.comment_replies_enabled then
      raise exception 'Replies are switched off for this company.' using errcode = '22023';
    end if;
    select case when parent_comment_id is null then 1 else 2 end into v_depth
      from recognition_comments where id = p_parent;
    if v_depth > v_cfg.comment_max_depth then
      raise exception 'Replies only go one level deep here. Reply to the original comment instead.'
        using errcode = '22023';
    end if;
  end if;

  if not v_cfg.mentions_enabled then
    p_mentions := '{}';
  end if;

  insert into recognition_comments (recognition_id, employee_id, body, parent_comment_id, mentions)
  values (p_recognition, v_actor, trim(p_body), p_parent, coalesce(p_mentions, '{}'))
  returning id into v_id;

  select full_name into v_name from employees where id = v_actor;

  -- everyone named in the post hears about it
  if p_parent is null then
    perform wall_notify(x, 'commented', v_actor,
                        v_name || ' commented on your recognition', p_recognition, v_id, null)
      from unnest(r.receiver_employee_ids) t(x);
  else
    perform wall_notify(c.employee_id, 'replied', v_actor,
                        v_name || ' replied to your comment', p_recognition, v_id, null)
      from recognition_comments c where c.id = p_parent;
  end if;

  -- and anyone mentioned
  foreach m in array coalesce(p_mentions, '{}') loop
    perform wall_notify(m, 'mentioned', v_actor,
                        v_name || ' mentioned you in a comment', p_recognition, v_id, null);
  end loop;

  return v_id;
end $$;


-- ---------------------------------------------------------------------
-- 6. DIRECT APPRECIATION
-- ---------------------------------------------------------------------
create or replace function send_appreciation(
  p_receivers   uuid[],
  p_category    text,
  p_body        text,
  p_related     uuid default null,
  p_also_post   boolean default false,
  p_visibility  text default 'company'
) returns jsonb
language plpgsql
as $$
declare
  v_actor uuid := wof_current_employee();
  v_company uuid; v_branch uuid; v_cfg wall_config%rowtype;
  v_cat shoutout_categories%rowtype;
  v_id uuid; v_today int; v_bad int; v_name text; v_post uuid; r uuid;
begin
  select company_id, location_id, full_name into v_company, v_branch, v_name
    from employees where id = v_actor;

  if not wof_can(v_actor, 'wof.message.send', v_company, v_branch) then
    raise exception 'Direct appreciation is not available to you. %',
      wof_explain_access(v_actor, 'wof.message.send', v_company) using errcode = '42501';
  end if;

  select * into v_cfg from wall_config where company_id = v_company;
  if not v_cfg.direct_messages_enabled then
    raise exception 'Direct appreciation is switched off for this company.' using errcode = '22023';
  end if;

  select * into v_cat from shoutout_categories
   where company_id = v_company and code = p_category and is_active;
  if v_cfg.dm_requires_category and v_cat.id is null then
    raise exception 'Pick what you are appreciating them for.' using errcode = '22023';
  end if;

  if array_length(p_receivers, 1) is null then
    raise exception 'Pick at least one person.' using errcode = '22023';
  end if;
  if v_actor = any(p_receivers) then
    raise exception 'You cannot send appreciation to yourself.' using errcode = '22023';
  end if;
  if array_length(p_receivers, 1) > v_cfg.max_receivers then
    raise exception 'You can appreciate up to % people at once.', v_cfg.max_receivers using errcode = '22023';
  end if;

  select count(*) into v_bad
    from unnest(p_receivers) x(id)
    left join employees e on e.id = x.id and e.company_id = v_company
     and (e.date_of_leaving is null or e.date_of_leaving >= current_date)
   where e.id is null;
  if v_bad > 0 then
    raise exception 'One or more people named are not active employees of this company.' using errcode = '22023';
  end if;

  select count(*) into v_today from wall_messages
   where sender_id = v_actor and created_at::date = current_date;
  if v_today >= v_cfg.dm_daily_limit then
    raise exception 'You have sent all % appreciation notes for today.', v_cfg.dm_daily_limit
      using errcode = '22023';
  end if;

  insert into wall_messages (company_id, sender_id, category_id, body, related_recognition_id)
  values (v_company, v_actor, v_cat.id, trim(p_body), p_related)
  returning id into v_id;

  insert into wall_message_recipients (message_id, employee_id)
  select v_id, x from unnest(p_receivers) t(x);

  -- straight into each recipient's ESS Inbox
  perform wall_notify(x, 'appreciation', v_actor,
                      v_name || ' sent you appreciation', null, null, v_id)
    from unnest(p_receivers) t(x);

  -- optionally the same words also go up on the public feed
  if p_also_post and v_cfg.dm_allow_share_to_feed then
    select create_shoutout(p_receivers, p_category, p_body, '{}', p_visibility) ->> 'id'
      into v_post;
    update wall_messages
       set share_state = 'shared', shared_recognition_id = v_post::uuid, shared_at = now()
     where id = v_id;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'posted_publicly', p_also_post,
    'recognition_id', v_post,
    'messages_left_today', greatest(v_cfg.dm_daily_limit - v_today - 1, 0)
  );
end $$;

-- the one reply a recipient is allowed
create or replace function thank_for_appreciation(p_message uuid, p_body text default null)
returns void language plpgsql as $$
declare v_actor uuid := wof_current_employee(); m wall_messages%rowtype; v_name text; v_done timestamptz;
begin
  select * into m from wall_messages where id = p_message;
  if m.id is null then raise exception 'Message not found.'; end if;

  select thanked_at into v_done from wall_message_recipients
   where message_id = p_message and employee_id = v_actor;
  if not found then
    raise exception 'This message was not sent to you.' using errcode = '42501';
  end if;
  if v_done is not null then
    raise exception 'You have already replied. This channel allows one reply — carry the rest into a conversation.'
      using errcode = '22023';
  end if;

  update wall_message_recipients
     set thanked_at = now(), thank_body = left(p_body, 500), read_at = coalesce(read_at, now())
   where message_id = p_message and employee_id = v_actor;

  select full_name into v_name from employees where id = v_actor;
  perform wall_notify(m.sender_id, 'thanked_back', v_actor,
                      v_name || ' thanked you for your note', null, null, p_message);
end $$;

-- receiver asks for a private note to be made public; sender decides
create or replace function request_share_to_feed(p_message uuid)
returns void language plpgsql as $$
declare v_actor uuid := wof_current_employee(); m wall_messages%rowtype; v_name text;
begin
  select * into m from wall_messages where id = p_message;
  if not exists (select 1 from wall_message_recipients
                  where message_id = p_message and employee_id = v_actor) then
    raise exception 'This message was not sent to you.' using errcode = '42501';
  end if;
  if m.share_state <> 'private' then
    raise exception 'This note has already been dealt with.' using errcode = '22023';
  end if;

  update wall_messages set share_state = 'share_requested', share_requested_at = now()
   where id = p_message;

  select full_name into v_name from employees where id = v_actor;
  perform wall_notify(m.sender_id, 'share_request', v_actor,
                      v_name || ' would like your note shared on the wall', null, null, p_message);
end $$;

-- sender approves, and the note becomes a public shoutout
create or replace function approve_share_to_feed(p_message uuid, p_visibility text default 'company')
returns uuid language plpgsql as $$
declare
  v_actor uuid := wof_current_employee(); m wall_messages%rowtype;
  v_cat text; v_recv uuid[]; v_post uuid;
begin
  select * into m from wall_messages where id = p_message;
  if m.sender_id <> v_actor then
    raise exception 'Only the person who wrote it can share it.' using errcode = '42501';
  end if;

  select code into v_cat from shoutout_categories where id = m.category_id;
  select array_agg(employee_id) into v_recv from wall_message_recipients where message_id = p_message;

  select (create_shoutout(v_recv, v_cat, m.body, '{}', p_visibility) ->> 'id')::uuid into v_post;

  update wall_messages
     set share_state = 'shared', shared_recognition_id = v_post, shared_at = now()
   where id = p_message;

  return v_post;
end $$;


-- ---------------------------------------------------------------------
-- 7. FAN-OUT ON PUBLIC RECOGNITION
-- ---------------------------------------------------------------------
create or replace function notify_on_recognition()
returns trigger language plpgsql as $$
declare v_name text; v_label text; x uuid;
begin
  if NEW.is_archived then return NEW; end if;

  select full_name into v_name from employees where id = NEW.giver_employee_id;
  -- milestones are wall content, not inbox items — see the header
  if NEW.kind = 'milestone' then
    return NEW;
  end if;

  v_label := case NEW.kind
    when 'award' then 'You received an award'
    else coalesce(v_name, 'Someone') || ' recognised you'
  end;

  foreach x in array NEW.receiver_employee_ids loop
    perform wall_notify(x, 'recognised', NEW.giver_employee_id, v_label, NEW.id, null, null);
  end loop;

  return NEW;
end $$;

drop trigger if exists trg_notify_recognition on recognitions;
create trigger trg_notify_recognition after insert on recognitions
  for each row execute function notify_on_recognition();


-- ---------------------------------------------------------------------
-- 8. THE INBOX READER
-- ---------------------------------------------------------------------
-- The existing ESS Inbox unions this with its approval items. Shape is kept
-- deliberately flat so the union is a straight column match.
create or replace function get_wall_inbox(
  p_filter text default 'all',      -- all | unread | appreciation | comments | replies
  p_limit  int  default 30,
  p_before timestamptz default null
) returns table (
  id            uuid,
  event_type    text,
  is_read       boolean,
  created_at    timestamptz,
  actor_id      uuid,
  actor_name    text,
  actor_code    text,
  actor_designation text,
  actor_branch  text,
  preview       text,
  body          text,
  category_label text,
  category_glyph text,
  recognition_id uuid,
  comment_id    uuid,
  message_id    uuid,
  can_thank     boolean,
  can_request_share boolean
)
language plpgsql stable
as $$
declare v_actor uuid := wof_current_employee(); v_company uuid;
begin
  select company_id into v_company from employees where id = v_actor;
  if not wof_can(v_actor, 'wof.inbox.view', v_company) then
    return;
  end if;

  return query
  select
    e.id, e.event_type, e.is_read, e.created_at,
    e.actor_id, a.full_name, a.emp_code, a.designation, ab.location_name,
    e.preview,
    coalesce(m.body, c.body, r.message),
    cat.label, cat.glyph,
    e.recognition_id, e.comment_id, e.message_id,
    (e.event_type = 'appreciation' and mr.thanked_at is null),
    (e.event_type = 'appreciation' and m.share_state = 'private')
  from wall_inbox_events e
  left join employees a  on a.id = e.actor_id
  left join locations  ab on ab.id = a.location_id
  left join wall_messages m on m.id = e.message_id
  left join wall_message_recipients mr
         on mr.message_id = e.message_id and mr.employee_id = v_actor
  left join recognition_comments c on c.id = e.comment_id
  left join recognitions r on r.id = e.recognition_id
  left join shoutout_categories cat on cat.id = coalesce(m.category_id, r.category_id)
  where e.employee_id = v_actor
    and (p_before is null or e.created_at < p_before)
    and (
      p_filter = 'all'
      or (p_filter = 'unread'       and e.is_read = false)
      or (p_filter = 'appreciation' and e.event_type in ('appreciation','recognised','thanked_back','share_request'))
      or (p_filter = 'comments'     and e.event_type in ('commented','mentioned'))
      or (p_filter = 'replies'      and e.event_type = 'replied')
    )
  order by e.created_at desc
  limit least(p_limit, 50);
end $$;

create or replace function get_inbox_counts()
returns jsonb language plpgsql stable as $$
declare v_actor uuid := wof_current_employee();
begin
  return (
    select jsonb_build_object(
      'total_unread',   count(*) filter (where is_read = false),
      'appreciation',   count(*) filter (where is_read = false and event_type in ('appreciation','recognised','thanked_back','share_request')),
      'comments',       count(*) filter (where is_read = false and event_type in ('commented','mentioned')),
      'replies',        count(*) filter (where is_read = false and event_type = 'replied')
    )
    from wall_inbox_events where employee_id = v_actor
  );
end $$;

create or replace function mark_inbox_read(p_ids uuid[] default null)
returns int language plpgsql as $$
declare v_actor uuid := wof_current_employee(); v_n int;
begin
  update wall_inbox_events
     set is_read = true, read_at = now()
   where employee_id = v_actor
     and is_read = false
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;

  -- opening an appreciation note counts as reading it
  update wall_message_recipients mr
     set read_at = coalesce(mr.read_at, now())
    from wall_inbox_events e
   where e.employee_id = v_actor
     and e.message_id = mr.message_id
     and mr.employee_id = v_actor
     and (p_ids is null or e.id = any(p_ids));

  return v_n;
end $$;

commit;

-- =====================================================================
-- INTEGRATION WITH THE EXISTING ESS INBOX
-- =====================================================================
-- The ESS Inbox already exists as the unified approvals surface (renamed
-- from Task Box in the August 2026 navigation pass). Do NOT build a second
-- inbox, and do NOT merge these rows into the approvals list.
--
-- The Inbox page gets one more tab group, sitting BESIDE the approvals
-- queue, never mixed into it:
--
--     Inbox
--     ├── Approvals          existing ESS query, untouched by this module
--     └── Wall of Fame       get_wall_inbox()
--         ├── Appreciation   direct notes, recognition, thank-backs
--         ├── Comments       comments and mentions on your recognition
--         └── Replies        replies to comments you wrote
--
-- 1. The approvals query is unchanged. This module neither reads it nor
--    writes to it, and never will.
--
-- 2. get_wall_inbox() only ever returns the three streams above. There is
--    no filter value that returns an approval, because no approval event
--    is ever written into wall_inbox_events. Nomination endorsements and
--    publish approvals continue to route to the existing approvals queue,
--    exactly as leave and offer approvals do.
--
-- 3. The nav badge shows the two counts separately, not summed:
--       approvals: <existing count>   ·   wall: get_inbox_counts()->>'total_unread'
--    A pending leave request and a colleague's thank-you note are not the
--    same kind of unread and should not share a number.
--
-- 4. Opening any wall item calls mark_inbox_read(array[id]).
--
-- 5. Badge unlocks, service milestones and reaction counts do NOT create
--    inbox events. They belong on the wall and in the notification
--    channels. Keep this inbox to things a colleague said to you.
-- =====================================================================
