-- 176_te_drafts.sql — unfinished work that survives closing the tab.
-- SAFE TO RUN TWICE. Adds one table and three functions; touches nothing else.
-- ----------------------------------------------------------------------------
-- WHY A NEW TABLE AND NOT te_trips. There is no work-in-progress state in this
-- module today. A trip is planned in one sitting and te_trip_save refuses an
-- incomplete one by design — name, scope, pattern, both dates and purpose are
-- all required before anything is written. Those guards are the floor under
-- every trip in the system and must not be relaxed so that a half-filled form
-- can be stored: an invalid row in te_trips is an invalid row for approval,
-- for the desk, for claims and for every report.
--
-- te_trips.status = 'DRAFT' is also already taken. It means "a past trip has
-- been recorded and is waiting to be claimed" (te_trip_save leaves POST_FACTO
-- trips there deliberately), which is a complete trip, not an unfinished one.
-- Reusing it would collapse two different things into one word.
--
-- So an unfinished form is kept as what it is: a private scratchpad belonging
-- to one person, holding the client's own form object verbatim. Nothing in SQL
-- reads inside `body`. The moment the work is finished it goes through the
-- normal validated path and the draft is deleted.
--
-- WHAT IS DELIBERATELY NOT HERE:
--   no approval, no company-wide visibility, no reporting. A draft is nobody
--   else's business until it is submitted. te_draft_* all filter on the actor
--   and the routes never accept an employee id from the caller.
--
--   no file bytes. An attachment is uploaded by /api/te/upload first and the
--   draft stores the storage path it returns, the same string a real expense
--   line stores. A draft is small and stays small.
--
-- NO ROW LEVEL SECURITY, which is this module's convention and not an
-- oversight: none of the ~30 te_ tables has RLS. They are reached only by the
-- service-role client behind an authenticated route. The repo guide's
-- "allow_all to anon, authenticated" pattern belongs to the older anon-key
-- tables, and applying it here would do the opposite of what it sounds like —
-- it would publish everybody's unfinished drafts to the public anon key.
-- ============================================================================

create table if not exists te_drafts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,

  -- What is being drafted. 'trip' covers all three scopes and both origins
  -- (planned ahead and already travelled); 'expense' is a single expense line;
  -- 'claim' is a set of lines being gathered into one claim.
  kind        text not null check (kind in ('trip', 'expense', 'claim')),

  -- For the Drafts list, so somebody can tell two half-planned trips apart
  -- without opening them. Written by the client from whatever the form knows
  -- so far, and allowed to be empty: a draft abandoned on its first screen has
  -- nothing to call itself yet and the list says so.
  title       text,
  -- 'local' | 'domestic' | 'international' for a trip, the category code for
  -- an expense. Free text on purpose: it is a label for the list, not a key.
  scope       text,
  -- Which step of the wizard they had reached, so Resume reopens there.
  step        int  not null default 0 check (step >= 0 and step < 100),

  -- The form, exactly as the client holds it. Opaque to SQL.
  body        jsonb not null default '{}'::jsonb,
  -- 64 KB is far more than any of these forms produces (a planned trip with
  -- stops and preferences is a few KB) and still small enough that a runaway
  -- client cannot fill the table. Checked here because this column is the one
  -- thing a caller controls freely.
  constraint te_drafts_body_small check (pg_column_size(body) <= 65536),

  -- Set when the draft is an edit of a trip that already exists, so resuming
  -- edits that trip rather than creating a second one. Cascades: if the trip
  -- goes, an edit of it is meaningless.
  trip_id     uuid references te_trips(id) on delete cascade,
  -- Same, for a draft expense line attached to a trip.
  claim_id    uuid references te_claims(id) on delete cascade,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The Drafts list: one person's own, newest work first.
create index if not exists te_drafts_mine on te_drafts (employee_id, kind, updated_at desc);

comment on table te_drafts is
  'Unfinished trip plans and expense forms, private to one employee. Opaque body; deleted when the real record is saved.';

-- ── save ─────────────────────────────────────────────────────────────────────
-- Creates or updates. Validates almost nothing, which is the entire point: a
-- draft is allowed to be as incomplete as the person left it. What it DOES
-- enforce is ownership — a draft may only ever be written by the person it
-- belongs to, so an id from somebody else's account is "not found" rather than
-- a row somebody else can overwrite.
create or replace function te_draft_save(p jsonb, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  d        te_drafts;
  v_id     uuid := nullif(p->>'id', '')::uuid;
  v_kind   text := coalesce(nullif(btrim(p->>'kind'), ''), '');
  v_co     uuid;
begin
  perform te_assert_active(p_actor);
  if v_kind not in ('trip', 'expense', 'claim') then
    perform te_fail('TE_DRAFT', 'A draft must be of a trip, an expense or a claim.');
  end if;
  select e.company_id into v_co from employees e where e.id = p_actor;
  if v_co is null then
    perform te_fail('TE_DRAFT', 'You have no company on your employee record.');
  end if;

  if v_id is not null then
    -- Ownership is the condition, not a check afterwards: somebody else's id
    -- simply does not match and falls through to a fresh insert below, so one
    -- account can never write into another's draft.
    update te_drafts
       set title      = nullif(btrim(p->>'title'), ''),
           scope      = nullif(btrim(p->>'scope'), ''),
           step       = coalesce((p->>'step')::int, 0),
           body       = coalesce(p->'body', '{}'::jsonb),
           trip_id    = nullif(p->>'trip_id', '')::uuid,
           claim_id   = nullif(p->>'claim_id', '')::uuid,
           updated_at = now()
     where id = v_id and employee_id = p_actor and kind = v_kind
    returning * into d;
    if found then
      return jsonb_build_object('draft_id', d.id, 'updated_at', d.updated_at);
    end if;
  end if;

  insert into te_drafts (company_id, employee_id, kind, title, scope, step, body, trip_id, claim_id)
  values (v_co, p_actor, v_kind,
          nullif(btrim(p->>'title'), ''), nullif(btrim(p->>'scope'), ''),
          coalesce((p->>'step')::int, 0), coalesce(p->'body', '{}'::jsonb),
          nullif(p->>'trip_id', '')::uuid, nullif(p->>'claim_id', '')::uuid)
  returning * into d;
  return jsonb_build_object('draft_id', d.id, 'updated_at', d.updated_at);
end;
$$;

comment on function te_draft_save is
  'Create or update one of the actor''s own drafts. Deliberately validates almost nothing except ownership and kind.';

-- ── list ─────────────────────────────────────────────────────────────────────
-- The Drafts list. Returns the body too: these are small, there are few of
-- them, and resuming without a second round trip is the point of the feature.
create or replace function te_draft_list(p_actor uuid, p_kind text default null)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'kind', d.kind, 'title', d.title, 'scope', d.scope,
           'step', d.step, 'body', d.body,
           'trip_id', d.trip_id, 'claim_id', d.claim_id,
           'created_at', d.created_at, 'updated_at', d.updated_at)
         order by d.updated_at desc), '[]'::jsonb)
    from te_drafts d
   where d.employee_id = p_actor
     and (p_kind is null or d.kind = p_kind);
$$;

comment on function te_draft_list is
  'The actor''s own unfinished drafts, newest first. Never returns anybody else''s.';

-- ── discard ──────────────────────────────────────────────────────────────────
-- Also how a draft is cleared once the real trip or expense has been saved.
-- Silent about an id that is already gone: finishing a form and discarding the
-- draft twice is not an error worth showing anybody.
create or replace function te_draft_delete(p_draft_id uuid, p_actor uuid)
returns jsonb language plpgsql as $$
declare
  v_gone int;
begin
  delete from te_drafts where id = p_draft_id and employee_id = p_actor;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('deleted', v_gone > 0);
end;
$$;

comment on function te_draft_delete is
  'Discard one of the actor''s own drafts. Quiet when it has already gone.';

notify pgrst, 'reload schema';
