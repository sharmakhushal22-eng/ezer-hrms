-- =====================================================================
-- 089_recognition_catalogue.sql — the badge and tag catalogue
--
-- Thirty badges and forty-four tags across eleven categories, from
-- HRMS_Employee_Applause_Recognition_Master.docx, so HR, managers and
-- recruiters pick from a list somebody signed off rather than typing a
-- different phrase for the same thing every time.
--
-- WHY THIS IS ONE COMPANY-INDEPENDENT TABLE
--
-- badge_master, which 084 creates, is per-company and models EARNED badges:
-- tiers, unlock rules, service years. This catalogue is a different thing —
-- a fixed vocabulary that a person CHOOSES when appreciating somebody, and
-- it is identical for every company because the words mean the same thing
-- everywhere. Making it per-company would mean seventy-four rows times three
-- companies, three chances to drift, and a "Best Performer" that means one
-- thing in one company and another elsewhere.
--
-- 084's earned badges are untouched and still work as they did.
--
-- BADGE VERSUS TAG, because the distinction is the design:
--
--   A BADGE is an award. One per recognition, and it accumulates on the
--   employee's record.
--   A TAG is a description. Several at once, attached to the recognition
--   rather than the person, so the reason stays searchable later.
--
-- Five names appear in both lists — Team Player, Problem Solver, Culture
-- Champion, Decision Maker, Positive Energy. That is from the source
-- document and it is deliberate: as a tag it describes this week's work, as
-- a badge it is an award for having done it consistently.
--
-- THE SEED RUNS ITSELF. Unlike 085, which defines a function somebody has to
-- remember to call, the insert below executes when the migration does. A
-- catalogue that arrives empty looks identical to one that failed to
-- install, and the difference costs somebody an afternoon.
--
-- DEPENDS ON  recognitions (084)
-- SAFE TO RUN TWICE — upserts by ref, so re-running also picks up wording
-- changes rather than duplicating rows.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The catalogue
-- ---------------------------------------------------------------------

create table if not exists recognition_catalogue (
  id           uuid primary key default gen_random_uuid(),

  -- The reference from the source document, B001-B030 / T001-T044. Kept as
  -- the natural key so a row here traces back to the sheet HR approved, and
  -- so re-running this file updates rather than duplicates.
  ref          text not null unique,

  kind         text not null check (kind in ('BADGE', 'TAG')),
  name         text not null,
  category     text not null,
  glyph        text not null default '★',
  description  text not null,

  is_active    boolean not null default true,
  sort_order   int not null default 0,

  created_at   timestamptz not null default now(),
  created_by   uuid references employees(id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references employees(id)
);

-- A name may repeat ACROSS kinds but not within one: two badges both called
-- "Team Player" would be a data-entry slip, while a badge and a tag sharing
-- the name is the intended design.
create unique index if not exists uq_recognition_catalogue_kind_name
  on recognition_catalogue (kind, lower(name));

create index if not exists idx_recognition_catalogue_pick
  on recognition_catalogue (kind, is_active, sort_order);


-- ---------------------------------------------------------------------
-- 2. Attaching them to a recognition
--
-- Mirrors how value_ids already works on recognitions: an array on the row
-- rather than a join table, because the wall reads whole posts and never
-- queries "every recognition carrying this tag" from the feed path.
-- ---------------------------------------------------------------------

alter table recognitions
  add column if not exists badge_ref text references recognition_catalogue(ref);

alter table recognitions
  add column if not exists tag_refs text[] not null default '{}';

-- At most five tags. Past that they stop narrowing anything and the
-- recognition reads as a word cloud. Mirrored in lib/wall/catalogue.ts so
-- the composer says so while somebody is still picking.
alter table recognitions
  drop constraint if exists recognitions_tag_refs_len;
alter table recognitions
  add constraint recognitions_tag_refs_len
  check (coalesce(array_length(tag_refs, 1), 0) <= 5);

create index if not exists idx_recognitions_badge_ref
  on recognitions (company_id, badge_ref) where badge_ref is not null;


-- ---------------------------------------------------------------------
-- 3. The rows
-- ---------------------------------------------------------------------

-- >>> GENERATED FROM lib/wall/catalogue.ts — DO NOT EDIT BY HAND <<<
-- 30 badges and 44 tags, from
-- HRMS_Employee_Applause_Recognition_Master.docx.
insert into recognition_catalogue (ref, kind, name, category, glyph, description, sort_order)
values
    ('B001', 'BADGE', 'Best Performer', 'Performance', '🏆', 'Outstanding overall performance', 10),
    ('B002', 'BADGE', 'Star Performer', 'Performance', '⭐', 'Consistently strong performance', 20),
    ('B003', 'BADGE', 'High Achiever', 'Performance', '📈', 'Exceeded goals or targets', 30),
    ('B004', 'BADGE', 'Innovation Champion', 'Innovation', '💡', 'Introduced a useful new idea or solution', 40),
    ('B005', 'BADGE', 'Out-of-the-Box Thinker', 'Innovation', '💡', 'Demonstrated creative thinking', 50),
    ('B006', 'BADGE', 'Team Player', 'Collaboration', '🤝', 'Excellent teamwork and collaboration', 60),
    ('B007', 'BADGE', 'Leadership Excellence', 'Leadership', '🧭', 'Demonstrated strong leadership', 70),
    ('B008', 'BADGE', 'Goal Crusher', 'Performance', '🥇', 'Consistently achieved or exceeded targets', 80),
    ('B009', 'BADGE', 'Going the Extra Mile', 'Behavior', '🏃', 'Went beyond normal responsibilities', 90),
    ('B010', 'BADGE', 'Speed & Efficiency', 'Performance', '⚡', 'Delivered work quickly and efficiently', 100),
    ('B011', 'BADGE', 'Excellence Award', 'Performance', '🎖️', 'Exceptional quality of work', 110),
    ('B012', 'BADGE', 'Rising Star', 'Growth', '🌟', 'Rapid growth and strong potential', 120),
    ('B013', 'BADGE', 'Problem Solver', 'Innovation', '💡', 'Successfully solved complex problems', 130),
    ('B014', 'BADGE', 'Growth Champion', 'Growth', '🌱', 'Significant improvement or development', 140),
    ('B015', 'BADGE', 'Customer Champion', 'Customer', '💙', 'Exceptional customer focus', 150),
    ('B016', 'BADGE', 'Collaboration Champion', 'Collaboration', '🤝', 'Excellent cross-functional collaboration', 160),
    ('B017', 'BADGE', 'Quality Champion', 'Performance', '✨', 'Consistently high-quality output', 170),
    ('B018', 'BADGE', 'Reliability Award', 'Behavior', '🛡️', 'Highly dependable and reliable', 180),
    ('B019', 'BADGE', 'Ownership Champion', 'Behavior', '🔑', 'Takes complete ownership of work', 190),
    ('B020', 'BADGE', 'Learning Champion', 'Growth', '📚', 'Proactively learns and applies new skills', 200),
    ('B021', 'BADGE', 'Tech Champion', 'Technology', '⚙️', 'Strong technical contribution', 210),
    ('B022', 'BADGE', 'Data Champion', 'Technology', '📊', 'Excellent data-driven contribution', 220),
    ('B023', 'BADGE', 'Communication Star', 'Communication', '🗣️', 'Exceptional communication', 230),
    ('B024', 'BADGE', 'Decision Maker', 'Leadership', '🧭', 'Strong judgment and decision-making', 240),
    ('B025', 'BADGE', 'Culture Champion', 'Culture', '🎉', 'Strongly demonstrates company values', 250),
    ('B026', 'BADGE', 'Positive Energy', 'Culture', '🎉', 'Creates a positive work environment', 260),
    ('B027', 'BADGE', 'Execution Champion', 'Performance', '🎯', 'Excellent execution and delivery', 270),
    ('B028', 'BADGE', 'Key Contributor', 'Performance', '🎯', 'Made a critical contribution', 280),
    ('B029', 'BADGE', 'Project Hero', 'Project', '🚩', 'Played a major role in project success', 290),
    ('B030', 'BADGE', 'Celebration Champion', 'Culture', '🎉', 'Contributes to team engagement', 300),
    ('T001', 'TAG', 'High Performer', 'Performance', '🎯', 'Consistently delivers strong results', 10),
    ('T002', 'TAG', 'Consistent', 'Performance', '🎯', 'Maintains dependable performance', 20),
    ('T003', 'TAG', 'Target Achiever', 'Performance', '🎯', 'Achieves assigned targets', 30),
    ('T004', 'TAG', 'Result Oriented', 'Performance', '🎯', 'Focuses on measurable outcomes', 40),
    ('T005', 'TAG', 'Quality Focused', 'Performance', '🎯', 'Pays strong attention to quality', 50),
    ('T006', 'TAG', 'Efficient', 'Performance', '🎯', 'Uses time and resources effectively', 60),
    ('T007', 'TAG', 'Reliable', 'Behavior', '🪴', 'Can be depended upon', 70),
    ('T008', 'TAG', 'Fast Learner', 'Growth', '🌱', 'Learns new concepts quickly', 80),
    ('T009', 'TAG', 'Ownership', 'Behavior', '🪴', 'Takes responsibility end-to-end', 90),
    ('T010', 'TAG', 'Accountability', 'Behavior', '🪴', 'Owns commitments and outcomes', 100),
    ('T011', 'TAG', 'Proactive', 'Behavior', '🪴', 'Takes initiative without waiting for instructions', 110),
    ('T012', 'TAG', 'Dependable', 'Behavior', '🪴', 'Consistently dependable', 120),
    ('T013', 'TAG', 'Positive Attitude', 'Culture', '🎉', 'Maintains a constructive attitude', 130),
    ('T014', 'TAG', 'Disciplined', 'Behavior', '🪴', 'Demonstrates strong work discipline', 140),
    ('T015', 'TAG', 'Adaptable', 'Behavior', '🪴', 'Adapts effectively to change', 150),
    ('T016', 'TAG', 'Resilient', 'Behavior', '🪴', 'Handles challenges and setbacks effectively', 160),
    ('T017', 'TAG', 'Innovative', 'Innovation', '💡', 'Brings new ideas and approaches', 170),
    ('T018', 'TAG', 'Creative Thinker', 'Innovation', '💡', 'Uses creative approaches to problems', 180),
    ('T019', 'TAG', 'Out of the Box', 'Innovation', '💡', 'Thinks beyond conventional solutions', 190),
    ('T020', 'TAG', 'Idea Generator', 'Innovation', '💡', 'Frequently contributes useful ideas', 200),
    ('T021', 'TAG', 'Problem Solver', 'Innovation', '💡', 'Solves issues effectively', 210),
    ('T022', 'TAG', 'Process Improver', 'Innovation', '💡', 'Improves processes or workflows', 220),
    ('T023', 'TAG', 'Tech Savvy', 'Technology', '⚙️', 'Strong technology orientation', 230),
    ('T024', 'TAG', 'Team Player', 'Collaboration', '🤝', 'Works effectively with others', 240),
    ('T025', 'TAG', 'Collaborative', 'Collaboration', '🤝', 'Works well across teams', 250),
    ('T026', 'TAG', 'Supportive', 'Collaboration', '🤝', 'Actively supports colleagues', 260),
    ('T027', 'TAG', 'Cross Functional', 'Collaboration', '🤝', 'Works effectively across functions', 270),
    ('T028', 'TAG', 'Knowledge Sharer', 'Collaboration', '🤝', 'Shares knowledge with others', 280),
    ('T029', 'TAG', 'Mentor', 'Leadership', '🧑‍🏫', 'Supports and develops colleagues', 290),
    ('T030', 'TAG', 'Great Communicator', 'Communication', '🗣️', 'Communicates clearly and effectively', 300),
    ('T031', 'TAG', 'Leadership', 'Leadership', '🧭', 'Demonstrates leadership qualities', 310),
    ('T032', 'TAG', 'Influencer', 'Leadership', '🧭', 'Positively influences others', 320),
    ('T033', 'TAG', 'Decision Maker', 'Leadership', '🧭', 'Makes sound decisions', 330),
    ('T034', 'TAG', 'Strategic Thinker', 'Leadership', '🧭', 'Thinks strategically', 340),
    ('T035', 'TAG', 'People Leader', 'Leadership', '🧭', 'Supports and guides people effectively', 350),
    ('T036', 'TAG', 'Change Maker', 'Leadership', '🧭', 'Drives positive change', 360),
    ('T037', 'TAG', 'Role Model', 'Leadership', '🪞', 'Sets a strong example for others', 370),
    ('T038', 'TAG', 'Culture Champion', 'Culture', '🎉', 'Promotes company culture and values', 380),
    ('T039', 'TAG', 'Value Driven', 'Culture', '🎉', 'Demonstrates organizational values', 390),
    ('T040', 'TAG', 'Positive Energy', 'Culture', '🎉', 'Creates positive team energy', 400),
    ('T041', 'TAG', 'Helpful', 'Culture', '🎉', 'Consistently helps colleagues', 410),
    ('T042', 'TAG', 'Inclusive', 'Culture', '🎉', 'Promotes an inclusive environment', 420),
    ('T043', 'TAG', 'Employee First', 'Culture', '🎉', 'Prioritizes employee/team experience', 430),
    ('T044', 'TAG', 'Team Spirit', 'Culture', '🎉', 'Strengthens team morale', 440)
on conflict (ref) do update set
  name        = excluded.name,
  category    = excluded.category,
  glyph       = excluded.glyph,
  description = excluded.description,
  sort_order  = excluded.sort_order;
-- >>> END GENERATED <<<


-- ---------------------------------------------------------------------
-- 4. Keeping the two lists honest
--
-- badge_ref must point at a BADGE and every tag_ref at a TAG. The foreign key
-- above only proves the ref exists, not that it is the right kind — without
-- this a badge could be filed as a tag and the feed would render it in the
-- wrong place with no error anywhere.
-- ---------------------------------------------------------------------

create or replace function recognition_refs_check()
returns trigger language plpgsql as $$
declare bad text;
begin
  if new.badge_ref is not null and not exists (
       select 1 from recognition_catalogue
       where ref = new.badge_ref and kind = 'BADGE' and is_active) then
    raise exception '% is not an active badge', new.badge_ref;
  end if;

  select r into bad from unnest(new.tag_refs) as r
  where not exists (select 1 from recognition_catalogue
                    where ref = r and kind = 'TAG' and is_active)
  limit 1;
  if bad is not null then
    raise exception '% is not an active tag', bad;
  end if;

  if (select count(distinct t) from unnest(new.tag_refs) t)
     <> coalesce(array_length(new.tag_refs, 1), 0) then
    raise exception 'the same tag has been given twice';
  end if;
  return new;
end $$;

drop trigger if exists trg_recognition_refs on recognitions;
create trigger trg_recognition_refs
  before insert or update of badge_ref, tag_refs on recognitions
  for each row execute function recognition_refs_check();


-- ---------------------------------------------------------------------
-- 4b. Attaching a badge and tags to a recognition that already exists
--
-- WHY THIS IS ITS OWN FUNCTION RATHER THAN TWO MORE ARGUMENTS ON
-- create_shoutout()
--
-- Postgres treats a different argument list as a different function, so
-- adding two parameters there means either an overload that makes every
-- existing five-argument call ambiguous, or dropping and recreating the
-- whole eighty-line body here — a copy that would drift from 086 the first
-- time somebody fixed a rule in one and not the other.
--
-- So the composer calls create_shoutout() unchanged, then this. 086 stays
-- the single authority on what a shoutout is allowed to be; this only
-- attaches the marks.
--
-- AND WHY NOT LET THE CLIENT UPDATE THE ROW DIRECTLY: it could then set a
-- badge on somebody else's recognition. The check below is the point of the
-- function, not the update.
create or replace function set_recognition_marks(
  p_recognition uuid,
  p_badge_ref   text default null,
  p_tag_refs    text[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := wof_current_employee();
  v_rec   recognitions%rowtype;
begin
  select * into v_rec from recognitions where id = p_recognition;
  if not found then
    raise exception 'That recognition no longer exists';
  end if;

  -- Only the person who gave it. Not the receiver — being praised does not
  -- entitle you to choose which badge you were praised with.
  if v_rec.giver_employee_id is distinct from v_actor then
    raise exception 'Only the person who gave this recognition can set its badge';
  end if;

  if v_rec.is_archived then
    raise exception 'This recognition has been archived';
  end if;

  update recognitions
     set badge_ref = p_badge_ref,
         tag_refs  = coalesce(p_tag_refs, '{}')
   where id = p_recognition;
  -- trg_recognition_refs validates the refs and the count on the way through.

  return jsonb_build_object('id', p_recognition,
                            'badge_ref', p_badge_ref,
                            'tags', coalesce(array_length(p_tag_refs, 1), 0));
end $$;


-- ---------------------------------------------------------------------
-- 5. RLS — NAYAN
--
-- recognition_catalogue is a reference list, not employee data: names,
-- categories and descriptions that every employee needs in order to pick
-- one. SELECT to everybody is correct here, and writes should be limited to
-- wall admins.
--
-- I have not written the policies because I do not know how "is a wall
-- admin" resolves in this project's Supabase setup, and 084's wall_admins
-- table is not applied yet either. Tell me and I will write them. This is
-- the least sensitive of the tables I have handed over — a leaked badge name
-- is a badge name — but it should still be a decision.
-- ---------------------------------------------------------------------

comment on table recognition_catalogue is
  'Badge and tag vocabulary from the Employee Applause Recognition Master. '
  'Company-independent: the words mean the same thing everywhere. Generated '
  'from lib/wall/catalogue.ts by scripts/gen-catalogue.py.';
