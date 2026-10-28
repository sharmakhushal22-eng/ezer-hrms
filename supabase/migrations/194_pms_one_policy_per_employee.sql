-- 194_pms_one_policy_per_employee.sql — rule 14, which was half-built.
-- SAFE TO RUN TWICE. Adds four functions and one trigger. No schema change,
-- no data change, and it does NOT retro-validate existing rows — see the
-- note on that below.
-- ----------------------------------------------------------------------------
-- ── WHAT WAS MISSING ───────────────────────────────────────────────────────
--
-- §6.2: "Overlap rule: ek employee sirf ek active policy me. Narrowest match
-- wins — location > grade > department > all."
-- §11 rule 14: "Employee in exactly one active policy · Policy overlap
-- resolution".
--
-- pms_policies has carried applies_location_ids, applies_grades,
-- applies_department_ids, applies_employment_types and applies_to_all since
-- 066. The admin route lets all five be EDITED. Nothing has ever READ them.
-- No function resolves a policy for an employee, so in practice everybody
-- gets whatever policy their period happens to hang off, and rule 14 is a
-- sentence in a document rather than a rule.
--
-- It has not bitten yet only because every company has exactly one policy —
-- measured: three policies, three companies, all applies_to_all. The first
-- time somebody adds a Sales Monthly policy, employees would silently sit in
-- two.
--
-- ── NARROWEST WINS, AND A TIE IS A MISCONFIGURATION ────────────────────────
--
-- The spec gives a precedence order but not a tie-break, because at the same
-- specificity there is no right answer: two department-scoped policies that
-- both name an employee's department are a contradiction in the
-- configuration, not a preference to be resolved. Picking the older or the
-- newer one silently would mean an admin creating a policy could move people
-- onto a different cycle without anyone seeing it happen.
--
-- So pms_resolve_policy REFUSES on a tie and says which policies collided.
-- Rule 14 becomes a guarantee that way rather than a preference.
--
-- And the overlap is prevented at the source: trg_pms_policy_no_overlap
-- refuses to save a policy whose scope already collides with another ACTIVE
-- policy in the same company at the same specificity.
--
-- ── WHY IT DOES NOT RETRO-VALIDATE ─────────────────────────────────────────
--
-- The trigger fires on INSERT and UPDATE only, so applying this migration
-- cannot fail on data that is already in the table, however that data looks.
-- A migration that refuses to apply because of pre-existing rows leaves
-- somebody with a half-migrated database and no way forward. The verify
-- script REPORTS any existing overlap instead, so it is visible and fixable
-- without blocking anything.
--
-- EMPLOYMENT TYPE IS A FILTER, NOT A TIER. The spec's precedence list does
-- not include it, so it does not make a policy "narrower". It is used only to
-- rule overlap OUT: two same-tier policies aimed at disjoint employment types
-- (Employee vs Contractor) do not collide, because no one employee can match
-- both.

-- ── how specific is this policy? ───────────────────────────────────────────
/** The precedence tier, highest first: LOCATION > GRADE > DEPARTMENT > ALL.
 *  Returned as a sortable int so "narrowest wins" is an ORDER BY. */
CREATE OR REPLACE FUNCTION pms_policy_tier(
  p_location_ids uuid[], p_grades text[], p_department_ids uuid[], p_to_all boolean)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(array_length(p_location_ids, 1), 0)   > 0 THEN 4
    WHEN COALESCE(array_length(p_grades, 1), 0)         > 0 THEN 3
    WHEN COALESCE(array_length(p_department_ids, 1), 0) > 0 THEN 2
    WHEN COALESCE(p_to_all, false)                          THEN 1
    ELSE 0   -- scoped to nothing at all; matches nobody
  END;
$$;

CREATE OR REPLACE FUNCTION pms_tier_name(p_tier int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tier WHEN 4 THEN 'location' WHEN 3 THEN 'grade'
                     WHEN 2 THEN 'department' WHEN 1 THEN 'everybody'
                     ELSE 'nobody' END;
$$;

-- ── does this policy cover this employee? ──────────────────────────────────
/**
 * Matching is by the policy's OWN tier only.
 *
 * A location-scoped policy is tested on location and nothing else: if it also
 * listed grades, requiring both would make it narrower than "location" in a
 * way the precedence order has no room for. The tier decides which column
 * answers; employment type then filters the result.
 */
CREATE OR REPLACE FUNCTION pms_policy_covers(
  p_policy_id uuid, p_employee_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE p pms_policies%ROWTYPE; e record; v_tier int;
BEGIN
  SELECT * INTO p FROM pms_policies WHERE id = p_policy_id;
  IF NOT FOUND OR NOT COALESCE(p.is_active, true) THEN RETURN false; END IF;

  SELECT company_id, department_id, location_id, grade, employment_type
    INTO e FROM employees WHERE id = p_employee_id;
  -- Two statements, not `NOT FOUND OR e.company_id ...`: plpgsql does not
  -- promise to short-circuit OR, and reading a field of an unassigned record
  -- raises "record e is not assigned yet" rather than returning false.
  IF NOT FOUND THEN RETURN false; END IF;
  IF e.company_id IS DISTINCT FROM p.company_id THEN RETURN false; END IF;

  -- Employment type narrows nothing but can exclude. An unset list means
  -- "any", so only a populated list that omits this employee's type excludes.
  IF COALESCE(array_length(p.applies_employment_types, 1), 0) > 0
     AND NOT EXISTS (SELECT 1 FROM unnest(p.applies_employment_types) t
                      WHERE btrim(upper(t)) = btrim(upper(COALESCE(e.employment_type, '')))) THEN
    RETURN false;
  END IF;

  v_tier := pms_policy_tier(p.applies_location_ids, p.applies_grades,
                            p.applies_department_ids, p.applies_to_all);
  RETURN CASE v_tier
    WHEN 4 THEN e.location_id = ANY(p.applies_location_ids)
    WHEN 3 THEN EXISTS (SELECT 1 FROM unnest(p.applies_grades) g
                         WHERE btrim(upper(g)) = btrim(upper(COALESCE(e.grade, ''))))
    WHEN 2 THEN e.department_id = ANY(p.applies_department_ids)
    WHEN 1 THEN true
    ELSE false
  END;
END $$;

-- ── the resolution ────────────────────────────────────────────────────────
/**
 * The ONE active policy for this employee, or a refusal that says why.
 *
 * Returns jsonb so a caller gets the reason as well as the answer:
 *   { ok: true,  policy_id, tier }
 *   { ok: false, reason, policy_ids? }
 *
 * Three ways it says no, and they need different fixes:
 *   nothing matches  — the employee is outside every policy's scope
 *   a tie            — two policies at the same specificity; a config error
 *   no policies      — nothing active for the company at all
 */
CREATE OR REPLACE FUNCTION pms_resolve_policy(p_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_co uuid; v_best int; v_n int; v_ids uuid[];
BEGIN
  SELECT company_id INTO v_co FROM employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'No such employee.');
  END IF;

  -- One pass, grouped by tier, narrowest first. No temp table: this function
  -- is STABLE and a temp table is a write, which is a contradiction waiting
  -- to fail in a read-only transaction.
  SELECT m.tier, count(*), array_agg(m.id)
    INTO v_best, v_n, v_ids
    FROM (SELECT p.id,
                 pms_policy_tier(p.applies_location_ids, p.applies_grades,
                                 p.applies_department_ids, p.applies_to_all) AS tier
            FROM pms_policies p
           WHERE p.company_id = v_co
             AND COALESCE(p.is_active, true)
             AND pms_policy_covers(p.id, p_employee_id)) m
   GROUP BY m.tier
   ORDER BY m.tier DESC
   LIMIT 1;

  IF v_best IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason',
      'No active policy covers this employee. Check the policy scopes, or '
      || 'give one policy "applies to everybody".');
  END IF;

  -- RULE 14. A tie is a contradiction in the configuration, not something to
  -- resolve by picking one — see the header.
  IF v_n > 1 THEN
    RETURN jsonb_build_object('ok', false, 'policy_ids', to_jsonb(v_ids),
      'reason', v_n || ' active policies match this employee at the same '
             || pms_tier_name(v_best) || ' level, so there is no single '
             || 'policy for them. Narrow one of the scopes or deactivate one.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'policy_id', v_ids[1],
                            'tier', pms_tier_name(v_best));
END $$;

-- ── and prevent the overlap being created in the first place ───────────────
CREATE OR REPLACE FUNCTION pms_policy_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_tier int; v_other record; v_clash text := '';
BEGIN
  -- An inactive policy constrains nothing; deactivating is how an admin
  -- resolves a clash, so it must never be blocked.
  IF NOT COALESCE(NEW.is_active, true) THEN RETURN NEW; END IF;

  v_tier := pms_policy_tier(NEW.applies_location_ids, NEW.applies_grades,
                            NEW.applies_department_ids, NEW.applies_to_all);

  FOR v_other IN
    SELECT p.id, p.policy_code, p.applies_location_ids, p.applies_grades,
           p.applies_department_ids, p.applies_to_all, p.applies_employment_types
      FROM pms_policies p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND COALESCE(p.is_active, true)
       AND pms_policy_tier(p.applies_location_ids, p.applies_grades,
                           p.applies_department_ids, p.applies_to_all) = v_tier
  LOOP
    -- Disjoint employment types cannot collide: no employee is both.
    IF COALESCE(array_length(NEW.applies_employment_types, 1), 0) > 0
       AND COALESCE(array_length(v_other.applies_employment_types, 1), 0) > 0
       AND NOT EXISTS (SELECT 1 FROM unnest(NEW.applies_employment_types) a
                       JOIN unnest(v_other.applies_employment_types) b
                         ON btrim(upper(a)) = btrim(upper(b))) THEN
      CONTINUE;
    END IF;

    IF CASE v_tier
         WHEN 4 THEN NEW.applies_location_ids && v_other.applies_location_ids
         WHEN 3 THEN EXISTS (SELECT 1 FROM unnest(NEW.applies_grades) a
                             JOIN unnest(v_other.applies_grades) b
                               ON btrim(upper(a)) = btrim(upper(b)))
         WHEN 2 THEN NEW.applies_department_ids && v_other.applies_department_ids
         WHEN 1 THEN true   -- two catch-alls in one company
         ELSE false
       END THEN
      v_clash := v_clash || v_other.policy_code || ' ';
    END IF;
  END LOOP;

  IF v_clash <> '' THEN
    RAISE EXCEPTION
      'This policy would overlap % at the % level, and an employee can only '
      'be in one active policy (rule 14). Narrow one scope, or deactivate the '
      'other policy first.', btrim(v_clash), pms_tier_name(v_tier);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pms_policy_no_overlap ON pms_policies;
CREATE TRIGGER trg_pms_policy_no_overlap
BEFORE INSERT OR UPDATE ON pms_policies
FOR EACH ROW EXECUTE FUNCTION pms_policy_no_overlap();

NOTIFY pgrst, 'reload schema';
