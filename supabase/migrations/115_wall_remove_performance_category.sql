-- =============================================================================
-- 115_wall_remove_performance_category.sql
--
-- Takes "📈 Performance — Hit a number, cleared a backlog, delivered ahead of
-- plan." out of the Wall of Fame shoutout categories.
--
-- DEACTIVATED, NOT DELETED, AND THAT IS THE WHOLE DESIGN OF THIS FILE.
--
-- Two rows already point at it — one recognition and one wall_message — through
-- foreign keys declared with no ON DELETE clause. So a delete does not quietly
-- tidy up: it is refused outright, and forcing it through would mean nulling
-- the category off appreciation somebody has already been given. A thank-you
-- that loses what it was for is worse than a category nobody can pick any more.
--
-- Both composers read `.eq('is_active', true)`, so flipping the flag removes it
-- from the picker on the next load while the two existing posts keep their
-- label, their glyph and their points.
--
-- Written for Nayan to apply. Nothing here is run from the app.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. RETIRE THE EXISTING ROWS
--
-- One per company: shoutout_categories is seeded per tenant, so there are as
-- many "performance" rows as there are companies. All of them go.
--
-- The table carries an enforce_wall_admin('wof.configure') trigger, and the
-- set_config below is REQUIRED, not defensive. With no session actor the guard
-- raises 42501 unless app.service_context is exactly 'true' (084
-- §enforce_wall_admin) — so without it this migration aborts rather than
-- silently doing nothing. is_local = true keeps it scoped to this transaction.
-- ---------------------------------------------------------------------
select set_config('app.service_context', 'true', true);

update shoutout_categories
   set is_active = false
 where code = 'performance'
   and is_active;

-- ---------------------------------------------------------------------
-- 2. STOP SEEDING IT FOR NEW COMPANIES
--
-- Without this the category returns the moment the next company is onboarded,
-- because seed_shoutout_categories() still lists it. Same function as 086 with
-- the performance row dropped and sort_order closed up, so the remaining seven
-- stay 1..7 rather than leaving a hole at 1.
--
-- `on conflict do nothing` is kept: the function is idempotent and is called
-- again for companies that already have their categories.
-- ---------------------------------------------------------------------
create or replace function seed_shoutout_categories(p_company uuid)
returns int
language plpgsql
as $$
declare v_n int := 0;
begin
  perform set_config('app.service_context', 'true', true);

  insert into shoutout_categories
    (company_id, code, label, helper_text, glyph, colour_token, points, sort_order)
  values
    (p_company,'helping_hand','Helping hand',
     'Covered a shift, unblocked someone, stayed back to help.','🤝','green',10,1),

    (p_company,'above_beyond','Above and beyond',
     'Went past what the job asked for.','🚀','violet',15,2),

    (p_company,'customer_save','Customer save',
     'Turned an unhappy customer around.','🛟','cyan',15,3),

    (p_company,'safety_catch','Safety catch',
     'Spotted a hazard or stopped an unsafe job.','🦺','rose',20,4),

    (p_company,'learning','Learning and sharing',
     'Taught someone, wrote it down, ran a session.','📚','gold',10,5),

    (p_company,'team_spirit','Team spirit',
     'Made the team better to work in.','🎈','slate',10,6),

    (p_company,'thank_you','Just a thank you',
     'No big reason needed.','🙏','slate',5,7)
  on conflict (company_id, code) do nothing;

  get diagnostics v_n = row_count;
  perform set_config('app.service_context', 'false', true);
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 3. CLOSE THE GAP FOR COMPANIES THAT ALREADY HAVE THEM
--
-- The seven live categories were seeded at 2..8. Left alone the picker still
-- reads correctly — sort_order only has to be increasing — but the numbers no
-- longer match the function above, which is the kind of drift that makes the
-- next person doubt which one is authoritative.
-- ---------------------------------------------------------------------
update shoutout_categories c
   set sort_order = v.ord
  from (values
         ('helping_hand',1), ('above_beyond',2), ('customer_save',3),
         ('safety_catch',4), ('learning',5), ('team_spirit',6), ('thank_you',7)
       ) as v(code, ord)
 where c.code = v.code
   and c.is_active
   and c.sort_order is distinct from v.ord;

select set_config('app.service_context', 'false', true);

commit;

-- =============================================================================
-- VERIFY
--
--   -- nobody can pick it any more, in any company
--   select company_id, is_active from shoutout_categories where code = 'performance';
--     -> is_active false on every row
--
--   -- what the composers will now list
--   select code, label, sort_order from shoutout_categories
--    where company_id = '<a company>' and is_active order by sort_order;
--     -> seven rows, 1..7, no performance
--
--   -- the appreciation already given under it is untouched
--   select count(*) from recognitions r
--     join shoutout_categories c on c.id = r.category_id
--    where c.code = 'performance';
--     -> 1, still labelled Performance
-- =============================================================================
