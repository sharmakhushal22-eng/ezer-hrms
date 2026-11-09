-- 167_te_check_params.sql — a check's thresholds reach the engine.
-- SAFE TO RUN TWICE. One key added to te_config's output. No table, no data.
-- ----------------------------------------------------------------------------
-- te_checks.params has existed since migration 144 and has been editable from
-- Admin → Checks all along: lib/te/admin.ts whitelists it on te_checks, so the
-- API accepts it and writes it. te_config never sent it to the rules engine, so
-- editing a threshold changed precisely nothing — a setting that looks like a
-- setting and is not one.
--
-- It matters now because the four spend-pattern checks built alongside this
-- read their thresholds from it:
--
--   D3  bandPct   how close to the receipt threshold counts as "just under"
--       minLines  how many such lines make a pattern
--   D5  times     how many multiples of the peer median is "far above"
--       minPeers  how many peers before the comparison means anything
--   D6  minLines  bills from one merchant before sequence is worth testing
--       minRun    how long a consecutive run must be
--   D7  pct       share of claim VALUE with no bill behind it
--       minLines  lines before the share means anything
--
-- Every one falls back to a sensible default when its key is absent, which is
-- the case for every row today — params is '{}' on all 165. So this changes no
-- behaviour by itself. What it changes is that an administrator can now tune a
-- threshold without a deploy, which is the whole point of the column.
--
-- te_config is taken verbatim from migration 145, its only definition.
-- ============================================================================

create or replace function te_config(p_company_id uuid)
returns jsonb language plpgsql stable as $$
declare
  s te_settings;
begin
  select * into s from te_settings where company_id = p_company_id;
  if not found then
    perform te_fail('TE_NOT_SET_UP', 'Travel and Expenses is not set up for this company. Run te_seed_company().');
  end if;

  return s.extra || jsonb_build_object(
    'billAgeDays', s.bill_age_days, 'claimDeadlineDays', s.claim_deadline_days, 'noticeDays', s.notice_days,
    'receiptAbove', s.receipt_above, 'noBillPerDay', s.no_bill_per_day,
    'advanceMaxPct', s.advance_max_pct, 'graceDays', s.grace_days,
    'mileageTol', s.mileage_tolerance_pct, 'estimateTol', s.estimate_tolerance_pct,
    'postFacto', s.post_facto, 'postFactoPerQuarter', s.post_facto_per_quarter,
    'autoApprove', s.auto_approve_on_timeout, 'fastTrack', s.fast_track_amount, 'samplePct', s.sample_pct,
    'reminderDays', s.reminder_days, 'escalateDays', s.escalate_days,
    'fallback', s.fallback_approver_id,
    'intlAir', s.intl_air_estimate, 'domAir', s.dom_air_estimate,
    'clientPerHead', s.client_per_head, 'miscPerClaim', s.misc_per_claim, 'commPerClaim', s.comm_per_claim,
    'defaultGrade', s.default_grade, 'version', s.version
  ) || jsonb_build_object(
    'track', s.gps_rules, 'vehx', s.vehicle_rules, 'fuelPrice', s.fuel_prices,
    'basis', s.limit_basis, 'breach', s.breach_actions, 'weights', s.risk_weights, 'bands', s.risk_bands,
    'zoneA', to_jsonb(s.zone_a_countries),
    'flows', jsonb_build_object(
      'claim', jsonb_build_object('levels', te_levels_json(p_company_id, 'claim')),
      'trip',  jsonb_build_object('levels', te_levels_json(p_company_id, 'trip'))),
    'teams', jsonb_build_object('finance', to_jsonb(te_finance_members(p_company_id))),
    'grades', (select coalesce(jsonb_agg(g.grade order by g.sort_order, g.grade), '[]'::jsonb)
                 from te_grade_policies g where g.company_id = p_company_id),
    'airClass', (select coalesce(jsonb_object_agg(g.grade, g.air_class), '{}'::jsonb)
                   from te_grade_policies g where g.company_id = p_company_id),
    'trainClass', (select coalesce(jsonb_object_agg(g.grade, g.train_class), '{}'::jsonb)
                     from te_grade_policies g where g.company_id = p_company_id),
    'limits', (select coalesce(jsonb_object_agg(x.grade, x.tiers), '{}'::jsonb)
                 from (select l.grade,
                              jsonb_object_agg(l.tier, jsonb_build_object(
                                'hotel', l.hotel_per_night, 'meals', l.meals_per_day, 'conv', l.conveyance_per_day)) as tiers
                         from te_grade_limits l where l.company_id = p_company_id group by l.grade) x),
    'vehicles', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', v.code, 'name', v.name, 'eg', v.example, 'method', v.method, 'rate', v.rate_per_km,
                    'fuel', v.fuel, 'kmpl', v.km_per_unit, 'wear', v.wear_per_km, 'on', v.is_active)
                    order by v.sort_order, v.code), '[]'::jsonb)
                   from te_vehicle_types v where v.company_id = p_company_id),
    'modes', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                    'id', m.code, 'name', m.name, 'icon', m.icon, 'basis', m.basis,
                    'scopes', to_jsonb(array_remove(array[
                       case when m.scope_local then 'local' end,
                       case when m.scope_domestic then 'domestic' end,
                       case when m.scope_international then 'international' end], null)),
                    'gps', m.gps, 'stops', m.stops_allowed, 'ceil', m.fare_ceiling_per_km,
                    'minFare', m.min_fare, 'estKm', m.est_per_km, 'estMin', m.est_min,
                    'cat', m.category_code, 'on', m.is_active))
                    order by m.sort_order, m.code), '[]'::jsonb)
                from te_modes m where m.company_id = p_company_id),
    'ptypes', (select coalesce(jsonb_agg(jsonb_build_object('id', p.code, 'name', p.name, 'on', p.is_active)
                    order by p.sort_order, p.code), '[]'::jsonb)
                 from te_place_types p where p.company_id = p_company_id),
    'stopReasons', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', r.code, 'name', r.name, 'biz', r.is_business, 'dwell', r.typical_minutes, 'on', r.is_active)
                    order by r.sort_order, r.code), '[]'::jsonb)
                      from te_stop_reasons r where r.company_id = p_company_id),
    'checks', (select coalesce(jsonb_agg(jsonb_build_object(
                    'c', k.code, 'layer', k.layer, 't', k.title, 'a', k.action, 's', k.severity,
                    'on', k.is_enabled, 'live', k.is_live,
                    -- The thresholds a check reads. Already editable from
                    -- Admin -> Checks (lib/te/admin.ts whitelists params on
                    -- te_checks) and, until now, never sent to the engine — so
                    -- editing one changed nothing. The D-layer checks read
                    -- theirs through chk(code).params, falling back to their
                    -- defaults when a key is absent, which every row is today.
                    'params', coalesce(k.params, '{}'::jsonb))
                    order by k.sort_order, k.code), '[]'::jsonb)
                 from te_checks k where k.company_id = p_company_id),
    -- every category, switched off ones too ("on": false): an old line still needs its name
    'cats', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.code, 'name', c.name, 'icon', c.icon, 'needsTrip', c.needs_trip,
                    'proof', c.proof, 'group', c.grp, 'on', c.is_active)
                    order by c.sort_order, c.code), '[]'::jsonb)
               from te_categories c where c.company_id = p_company_id)
  );
end;
$$;
notify pgrst, 'reload schema';
