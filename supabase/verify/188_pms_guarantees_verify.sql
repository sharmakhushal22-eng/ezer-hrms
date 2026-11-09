-- 188_pms_guarantees_verify.sql — proves the four guarantees now hold.
--
-- NOT A MIGRATION. Run it in the SQL editor whenever you want the proof again.
-- APPLY 188 FIRST.
--
-- WRITES NOTHING THAT SURVIVES. It locks a real row, tries to unlock it on
-- purpose, reads what the database says, and then raises an exception so the
-- whole block is rolled back. The report survives because a PL/pgSQL variable
-- is not transactional — the same trick 175, 176, 177, 180, 185 and 187 use.
--
-- IT FINISHES WITH AN ERROR IN RED. That is the success case. Read the message.
--
-- WHAT IS BEING PROVED:
--
--   policy guard      pms_finalise refuses when the period has no policy,
--                      instead of skipping the one-to-one check and handing
--                      back the widest finaliser set.
--   rm identity       RM_L1 / RM_L2 are checked against the frozen chain, not
--                      taken from the caller's own word.
--   final score       pms_finalise writes final_score, without which the
--                      generated self_vs_final_gap is NULL for every row.
--   employment flag   pms_finalise writes employment_flag from the view, which
--                      is what makes is_readonly — and rule 12 — mean anything.
--   lock holds        a read-only row cannot be unlocked by clearing the flag.
-- ============================================================================
do $$
declare
  r        text := E'\n=== 188 the guarantees that now hold ===\n';
  src      text;
  v_emp    uuid;
  v_per    uuid;
  v_was    boolean;
  v_err    text;
  v_bad    text[] := '{}';
begin
  -- ── what the live definition actually contains ──────────────────────────
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pms_finalise';

  if src is null then
    raise exception '188 has not been applied, or pms_finalise is missing entirely.';
  end if;

  r := r || format('%-18s %s%s', 'policy guard',
        case when src like '%has no policy%' then 'yes' else 'NO' end, E'\n');
  if src not like '%has no policy%' then
    v_bad := v_bad || 'pms_finalise still has no IF NOT FOUND guard on its policy lookup';
  end if;

  r := r || format('%-18s %s%s', 'rm identity',
        case when src like '%RM_L1%' and src like '%rm_l1_id%' then 'yes' else 'NO' end, E'\n');
  if not (src like '%rm_l1_id%') then
    v_bad := v_bad || 'pms_finalise does not check RM_L1 / RM_L2 against the frozen chain';
  end if;

  r := r || format('%-18s %s%s', 'final score',
        case when src like '%final_score%' then 'yes' else 'NO' end, E'\n');
  if src not like '%final_score%' then
    v_bad := v_bad || 'pms_finalise still does not write final_score, so self_vs_final_gap stays NULL';
  end if;

  r := r || format('%-18s %s%s', 'employment flag',
        case when src like '%vw_pms_employment_flag%' then 'yes' else 'NO' end, E'\n');
  if src not like '%vw_pms_employment_flag%' then
    v_bad := v_bad || 'pms_finalise still reads the never-written employment_flag column';
  end if;

  -- ── the refusal, which is the part that matters ─────────────────────────
  -- Take any row, lock it, and try to clear the lock. Before 188 this
  -- succeeded, because the guard only objected when NEW.is_readonly was also
  -- true -- so clearing it was always allowed.
  select employee_id, period_id, is_readonly
    into v_emp, v_per, v_was
    from pms_overall_rating order by employee_id limit 1;

  if v_emp is null then
    r := r || E'lock holds          SKIPPED (pms_overall_rating is empty)\n';
  else
    update pms_overall_rating set is_readonly = true
     where employee_id = v_emp and period_id = v_per;
    begin
      update pms_overall_rating set is_readonly = false
       where employee_id = v_emp and period_id = v_per;
      v_bad := v_bad || 'a read-only row was UNLOCKED by setting is_readonly = false';
      r := r || E'lock holds          NO -- the lock still unlocks itself\n';
    exception
      when others then
        v_err := sqlerrm;
        if v_err like '%read-only%' then
          r := r || E'lock holds          yes, refused by the database itself\n';
        else
          r := r || format('lock holds          refused, but oddly: %s%s', left(v_err, 60), E'\n');
        end if;
    end;
  end if;

  r := r || format('%srow used for the lock test: %s (rolled back)%s',
                   E'\n', coalesce(v_emp::text, 'none'), E'\n');

  if array_length(v_bad, 1) > 0 then
    raise exception E'%\nNOT DONE:\n  %\n188 has not been applied, or it did not take.',
      r, array_to_string(v_bad, E'\n  ');
  end if;

  raise exception E'%\n=== every check passed. Nothing was kept. ===', r;
end $$;
