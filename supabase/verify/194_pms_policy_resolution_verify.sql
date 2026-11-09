-- 194_pms_policy_resolution_verify.sql — run AFTER 194.
--
-- Sections 1-3 WRITE NOTHING. Section 4 builds overlapping policies inside a
-- transaction and rolls back, because the only way to test an overlap guard
-- is to attempt an overlap.
--
-- Every PASS/FAIL row should read PASS.

-- 1. The pieces exist.
SELECT CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END AS functions_present,
       string_agg(proname, ', ' ORDER BY proname) AS found
  FROM pg_proc
 WHERE proname IN ('pms_policy_tier','pms_tier_name','pms_policy_covers','pms_resolve_policy');

SELECT CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS trigger_present
  FROM pg_trigger WHERE tgname = 'trg_pms_policy_no_overlap' AND NOT tgisinternal;

-- 2. THE PRECEDENCE ORDER, which is the whole rule. location > grade >
--    department > all, and "scoped to nothing" matches nobody.
WITH t(label, got, want) AS (
  VALUES
    ('location beats everything', pms_policy_tier(ARRAY['11111111-1111-1111-1111-111111111111'::uuid],
                                   ARRAY['L2'], ARRAY['22222222-2222-2222-2222-222222222222'::uuid], true), 4),
    ('grade beats department',    pms_policy_tier(NULL, ARRAY['L2'],
                                   ARRAY['22222222-2222-2222-2222-222222222222'::uuid], true), 3),
    ('department beats all',      pms_policy_tier(NULL, NULL,
                                   ARRAY['22222222-2222-2222-2222-222222222222'::uuid], true), 2),
    ('applies_to_all is lowest',  pms_policy_tier(NULL, NULL, NULL, true), 1),
    ('scoped to nothing',         pms_policy_tier(NULL, NULL, NULL, false), 0),
    ('empty arrays are not scope',pms_policy_tier('{}'::uuid[], '{}'::text[], '{}'::uuid[], true), 1)
)
SELECT label, got, want, CASE WHEN got = want THEN 'PASS' ELSE 'FAIL' END AS result
  FROM t ORDER BY (got = want), label;

-- 3. REAL EMPLOYEES, read-only. Every company currently has one catch-all
--    policy, so every employee should resolve to it at the "everybody" tier.
--    A refusal here on live data is a finding, not a test failure.
SELECT COALESCE(r->>'ok', 'null') AS ok,
       COALESCE(r->>'tier', r->>'reason') AS detail,
       count(*) AS employees
  FROM (SELECT pms_resolve_policy(e.id) AS r
          FROM employees e
         WHERE e.company_id IS NOT NULL
         LIMIT 400) q
 GROUP BY 1, 2
 ORDER BY count(*) DESC;

-- 3b. PRE-EXISTING OVERLAP REPORT. 194 deliberately does not retro-validate,
--     so anything already colliding is listed here rather than blocking the
--     migration. Expect no rows.
SELECT a.company_id,
       a.policy_code AS policy_a, b.policy_code AS policy_b,
       pms_tier_name(pms_policy_tier(a.applies_location_ids, a.applies_grades,
                                     a.applies_department_ids, a.applies_to_all)) AS same_tier
  FROM pms_policies a
  JOIN pms_policies b
    ON b.company_id = a.company_id AND b.id > a.id
   AND COALESCE(a.is_active, true) AND COALESCE(b.is_active, true)
   AND pms_policy_tier(a.applies_location_ids, a.applies_grades,
                       a.applies_department_ids, a.applies_to_all)
     = pms_policy_tier(b.applies_location_ids, b.applies_grades,
                       b.applies_department_ids, b.applies_to_all);

-- 4. THE GUARD. Rolled back, so nothing survives.
BEGIN;

DO $$
DECLARE v_co uuid; v_dept uuid; v_a uuid; v_ok text := ''; v_bad text := '';
BEGIN
  SELECT company_id INTO v_co FROM pms_policies LIMIT 1;
  SELECT department_id INTO v_dept FROM employees
   WHERE company_id = v_co AND department_id IS NOT NULL LIMIT 1;

  -- A department-scoped policy saves fine: nothing else is at that tier.
  BEGIN
    INSERT INTO pms_policies (company_id, policy_code, policy_name,
                              applies_department_ids, applies_to_all)
    VALUES (v_co, 'VERIFY194_A', 'Verify A', ARRAY[v_dept], false)
    RETURNING id INTO v_a;
    v_ok := v_ok || 'first-department-policy ';
  EXCEPTION WHEN others THEN v_bad := v_bad || 'first(' || SQLERRM || ') '; END;

  -- A SECOND policy on the SAME department must be refused — rule 14.
  BEGIN
    INSERT INTO pms_policies (company_id, policy_code, policy_name,
                              applies_department_ids, applies_to_all)
    VALUES (v_co, 'VERIFY194_B', 'Verify B', ARRAY[v_dept], false);
    v_bad := v_bad || 'OVERLAP-WAS-ALLOWED ';
  EXCEPTION WHEN others THEN v_ok := v_ok || 'overlap-refused '; END;

  -- A policy on a DIFFERENT department at the same tier is fine.
  BEGIN
    INSERT INTO pms_policies (company_id, policy_code, policy_name,
                              applies_department_ids, applies_to_all)
    VALUES (v_co, 'VERIFY194_C', 'Verify C',
            ARRAY['33333333-3333-3333-3333-333333333333'::uuid], false);
    v_ok := v_ok || 'different-department-allowed ';
  EXCEPTION WHEN others THEN v_bad := v_bad || 'different-dept(' || SQLERRM || ') '; END;

  -- Same department but a disjoint employment type does NOT collide: no one
  -- employee can be both an Employee and a Contractor.
  BEGIN
    UPDATE pms_policies SET applies_employment_types = ARRAY['Employee'] WHERE id = v_a;
    INSERT INTO pms_policies (company_id, policy_code, policy_name,
                              applies_department_ids, applies_to_all,
                              applies_employment_types)
    VALUES (v_co, 'VERIFY194_D', 'Verify D', ARRAY[v_dept], false, ARRAY['Contractor']);
    v_ok := v_ok || 'disjoint-employment-type-allowed ';
  EXCEPTION WHEN others THEN
    v_bad := v_bad || 'disjoint-type(' || SQLERRM || ') '; END;

  -- Deactivating must ALWAYS be possible: it is how an admin resolves a clash.
  BEGIN
    UPDATE pms_policies SET is_active = false WHERE id = v_a;
    v_ok := v_ok || 'deactivate-allowed ';
  EXCEPTION WHEN others THEN v_bad := v_bad || 'deactivate(' || SQLERRM || ') '; END;

  IF v_bad = '' THEN RAISE NOTICE 'PASS  %', v_ok;
  ELSE RAISE NOTICE 'FAIL  %  |  ok so far: %', v_bad, v_ok;
  END IF;
END $$;

-- A tie is reported by the resolver, not silently resolved. Two catch-alls
-- cannot be inserted any more, so this checks the resolver's own branch by
-- reading what it says for a real employee with the fixtures in place.
SELECT 'resolver with fixtures present' AS note,
       pms_resolve_policy((SELECT e.id FROM employees e
                            JOIN pms_policies p ON p.company_id = e.company_id
                           WHERE p.policy_code = 'VERIFY194_C' LIMIT 1)) AS resolved;

ROLLBACK;

-- Nothing survived.
SELECT CASE WHEN count(*) = 0 THEN 'PASS — fixtures rolled back'
            ELSE 'FAIL — ' || count(*) || ' VERIFY194 policy row(s) survived; delete them' END AS cleanup
  FROM pms_policies WHERE policy_code LIKE 'VERIFY194%';
