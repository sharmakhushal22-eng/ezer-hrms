-- 195_pms_readonly_generated_verify.sql — run AFTER 195.
-- Builds a fixture and rolls it back, so it is safe on live data.
--
-- The case that matters is a locked row whose GENERATED column has a value,
-- which needs both self_score and final_score populated. 193's own verify
-- already does that, and would have caught this; the point of this file is to
-- pin the generated-column behaviour explicitly so nobody "simplifies" the
-- catalogue lookup back into a hardcoded name.

BEGIN;

-- 1. The table really does have a generated column, or the test is vacuous.
SELECT CASE WHEN count(*) >= 1 THEN 'PASS' ELSE 'FAIL — nothing generated here' END
         AS has_generated_column,
       string_agg(column_name, ', ') AS columns
  FROM information_schema.columns
 WHERE table_name = 'pms_overall_rating' AND is_generated = 'ALWAYS';

DO $$
DECLARE v_id uuid; v_emp uuid; v_per uuid; v_co uuid; v_gap numeric;
        v_ok text := ''; v_bad text := '';
BEGIN
  SELECT pe.id, pe.company_id INTO v_per, v_co
    FROM pms_periods pe ORDER BY pe.period_start DESC LIMIT 1;
  SELECT e.id INTO v_emp FROM employees e
   WHERE e.company_id = v_co
     AND NOT EXISTS (SELECT 1 FROM pms_overall_rating o
                      WHERE o.employee_id = e.id AND o.period_id = v_per)
   ORDER BY e.emp_code LIMIT 1;
  IF v_emp IS NULL THEN
    RAISE NOTICE 'SKIP  no unenrolled employee in that company';
    RETURN;
  END IF;

  -- BOTH scores, so self_vs_final_gap is non-null. This is the whole point:
  -- with either one missing the generated column is NULL on both sides and
  -- the bug hides.
  INSERT INTO pms_overall_rating (company_id, period_id, employee_id,
                                  workflow_status, final_rating,
                                  self_score, final_score, is_readonly)
  VALUES (v_co, v_per, v_emp, 'FINALISED', 3, 3.5, 3.2, true)
  RETURNING id, self_vs_final_gap INTO v_id, v_gap;

  IF v_gap IS NULL THEN
    RAISE NOTICE 'FAIL  fixture gap is NULL — the test would pass vacuously';
    RETURN;
  END IF;
  RAISE NOTICE 'NOTE  fixture self_vs_final_gap = % (non-null, as required)', v_gap;

  -- 2. Delivery must be allowed DESPITE the generated column.
  BEGIN
    UPDATE pms_overall_rating
       SET workflow_status = 'PUBLISHED', published_at = now() WHERE id = v_id;
    v_ok := v_ok || 'publish ';
  EXCEPTION WHEN others THEN v_bad := v_bad || 'publish(' || SQLERRM || ') '; END;

  BEGIN
    UPDATE pms_overall_rating
       SET workflow_status = 'ACKNOWLEDGED', employee_ack = true,
           employee_ack_at = now() WHERE id = v_id;
    v_ok := v_ok || 'acknowledge ';
  EXCEPTION WHEN others THEN v_bad := v_bad || 'acknowledge(' || SQLERRM || ') '; END;

  -- 3. And the rating is still frozen — 195 must not have opened anything.
  BEGIN
    UPDATE pms_overall_rating SET final_rating = 5 WHERE id = v_id;
    v_bad := v_bad || 'RATING-WAS-EDITABLE ';
  EXCEPTION WHEN others THEN v_ok := v_ok || 'rating-still-frozen '; END;

  -- 4. Changing a score would change the generated column too; it must still
  --    be refused, on the score rather than on the generated column.
  BEGIN
    UPDATE pms_overall_rating SET self_score = 1 WHERE id = v_id;
    v_bad := v_bad || 'SCORE-WAS-EDITABLE ';
  EXCEPTION WHEN others THEN v_ok := v_ok || 'score-still-frozen '; END;

  IF v_bad = '' THEN RAISE NOTICE 'PASS  %', v_ok;
  ELSE RAISE NOTICE 'FAIL  %  |  ok so far: %', v_bad, v_ok;
  END IF;
END $$;

ROLLBACK;

SELECT CASE WHEN count(*) = 0 THEN 'PASS — fixture rolled back'
            ELSE 'FAIL — ' || count(*) || ' fixture row(s) survived; delete them' END AS cleanup
  FROM pms_overall_rating WHERE self_score = 3.5 AND final_score = 3.2 AND final_rating = 3;
