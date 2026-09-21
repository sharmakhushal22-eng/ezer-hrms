-- ════════════════════════════════════════════════════════════════════
-- 129_calendar_activation.sql — multi-year holiday calendars, one active
--                               per company per date range
--
-- SUPERSEDES the resolve_holidays() defined in 128. Run 128 first anyway:
-- its other two changes (weekly_off_config.department_id, the BRANCH_HR
-- screen grants) are not repeated here. Running 128 then 129 is correct and
-- harmless — 129 simply replaces the function 128 created.
--
-- WHAT THIS IS FOR
--
-- HR needs to build FY 2027-28 while FY 2026-27 is still in force, then
-- switch over. Today that is impossible in a safe way:
--
--   * company_calendar_map.company_id is UNIQUE — a company can follow
--     exactly ONE calendar, ever. Pointing it at next year's calendar
--     instantly destroys this year's holidays for every past date.
--   * "reaching ESS" depends on TWO things lining up — the calendar's
--     status being PUBLISHED, and the company being mapped to it. Either
--     one wrong produces zero holidays and no error. That is precisely how
--     FY 2026-27 sat DRAFT for months without anybody noticing.
--   * Nothing records who published a calendar, or when.
--
-- THE MODEL
--
-- A calendar owns a date range. A company may have MANY calendars active
-- at once, provided their ranges do not overlap. A date resolves against
-- whichever active calendar covers it — so August 2026 keeps its holidays
-- forever, and activating FY 2027-28 takes nothing away.
--
-- "Only one active" therefore becomes the narrower, correct rule:
--   NO TWO ACTIVE CALENDARS FOR ONE COMPANY MAY OVERLAP IN TIME.
--
-- Idempotent. HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. The activation record ─────────────────────────────────────────
-- One row per (company, calendar) activation. deactivated_at IS NULL means
-- currently active. Rows are never deleted — this is the audit trail.
CREATE TABLE IF NOT EXISTS company_calendar_activation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  calendar_id     UUID NOT NULL REFERENCES holiday_calendar(id) ON DELETE CASCADE,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by    TEXT,
  deactivated_at  TIMESTAMPTZ,
  deactivated_by  TEXT,
  note            TEXT
);

-- A calendar can be activated for a company only once at a time. It may be
-- re-activated later, which is why this is partial rather than a plain unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cal_activation_live
  ON company_calendar_activation(company_id, calendar_id)
  WHERE deactivated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cal_activation_company
  ON company_calendar_activation(company_id) WHERE deactivated_at IS NULL;

ALTER TABLE company_calendar_activation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_company_calendar_activation" ON company_calendar_activation;
CREATE POLICY "allow_all_company_calendar_activation" ON company_calendar_activation
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);


-- ── 2. The overlap guard ─────────────────────────────────────────────
-- Enforced by trigger rather than an EXCLUDE constraint: the dates live on
-- holiday_calendar, not on this table, and this repo has no btree_gist
-- precedent. A trigger needs no extension and gives a readable error.
CREATE OR REPLACE FUNCTION trg_calendar_activation_no_overlap() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_from DATE; v_to DATE; v_type TEXT; v_name TEXT;
  v_clash TEXT;
BEGIN
  IF NEW.deactivated_at IS NOT NULL THEN RETURN NEW; END IF;   -- history, not a claim

  SELECT from_date, to_date, calendar_type, name
    INTO v_from, v_to, v_type, v_name
    FROM holiday_calendar WHERE id = NEW.calendar_id;

  IF v_type IS DISTINCT FROM 'HOLIDAY' THEN
    RAISE EXCEPTION 'Only a HOLIDAY calendar can be activated; "%" is %.', v_name, v_type;
  END IF;

  -- An unbounded calendar would overlap everything forever, and the UI
  -- already defaults both dates. Require them.
  IF v_from IS NULL OR v_to IS NULL THEN
    RAISE EXCEPTION 'Calendar "%" has no from/to date, so its period is undefined. Set both before activating.', v_name;
  END IF;
  IF v_from > v_to THEN
    RAISE EXCEPTION 'Calendar "%" ends before it starts.', v_name;
  END IF;

  SELECT c.name INTO v_clash
    FROM company_calendar_activation a
    JOIN holiday_calendar c ON c.id = a.calendar_id
   WHERE a.company_id = NEW.company_id
     AND a.deactivated_at IS NULL
     AND a.id IS DISTINCT FROM NEW.id
     AND c.from_date IS NOT NULL AND c.to_date IS NOT NULL
     AND daterange(c.from_date, c.to_date, '[]') && daterange(v_from, v_to, '[]')
   LIMIT 1;

  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION
      'This company already follows "%" over dates that overlap "%". Deactivate it first — two calendars cannot both govern the same day.',
      v_clash, v_name;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS calendar_activation_no_overlap ON company_calendar_activation;
CREATE TRIGGER calendar_activation_no_overlap
  BEFORE INSERT OR UPDATE ON company_calendar_activation
  FOR EACH ROW EXECUTE FUNCTION trg_calendar_activation_no_overlap();


-- ── 3. Activate / deactivate ─────────────────────────────────────────
-- ONE action. Publishes the calendar AND links the company AND records who.
-- The two-switch problem disappears: there is no way to half-do this.
CREATE OR REPLACE FUNCTION activate_calendar(
  p_company_id UUID, p_calendar_id UUID, p_actor TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS TABLE(activation_id UUID, replaced TEXT) LANGUAGE plpgsql AS $$
DECLARE
  v_from DATE; v_to DATE; v_replaced TEXT; v_id UUID;
BEGIN
  SELECT from_date, to_date INTO v_from, v_to
    FROM holiday_calendar WHERE id = p_calendar_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No such calendar.'; END IF;

  -- Stand down anything this company follows over the SAME dates. Calendars
  -- for other years are untouched — that is the whole point.
  UPDATE company_calendar_activation a
     SET deactivated_at = now(), deactivated_by = p_actor
    FROM holiday_calendar c
   WHERE a.company_id = p_company_id
     AND a.deactivated_at IS NULL
     AND c.id = a.calendar_id
     AND c.from_date IS NOT NULL AND c.to_date IS NOT NULL
     AND v_from IS NOT NULL AND v_to IS NOT NULL
     AND daterange(c.from_date, c.to_date, '[]') && daterange(v_from, v_to, '[]');

  SELECT string_agg(c.name, ', ') INTO v_replaced
    FROM company_calendar_activation a
    JOIN holiday_calendar c ON c.id = a.calendar_id
   WHERE a.company_id = p_company_id AND a.deactivated_by IS NOT DISTINCT FROM p_actor
     AND a.deactivated_at > now() - interval '1 second';

  -- Publishing is half of activation, not a separate chore.
  UPDATE holiday_calendar SET status = 'PUBLISHED' WHERE id = p_calendar_id;

  INSERT INTO company_calendar_activation (company_id, calendar_id, activated_by, note)
  VALUES (p_company_id, p_calendar_id, p_actor, p_note)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_replaced;
END $$;

CREATE OR REPLACE FUNCTION deactivate_calendar(
  p_company_id UUID, p_calendar_id UUID, p_actor TEXT DEFAULT NULL
) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_n INT;
BEGIN
  UPDATE company_calendar_activation
     SET deactivated_at = now(), deactivated_by = p_actor
   WHERE company_id = p_company_id AND calendar_id = p_calendar_id
     AND deactivated_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;


-- ── 4. Backfill from the old single mapping ──────────────────────────
-- Whatever each company follows today becomes its first activation record,
-- so nothing changes behaviour on the day this runs.
INSERT INTO company_calendar_activation (company_id, calendar_id, activated_by, note)
SELECT m.company_id, m.holiday_calendar_id, 'migration 129',
       'Backfilled from company_calendar_map'
  FROM company_calendar_map m
  JOIN holiday_calendar c ON c.id = m.holiday_calendar_id AND c.calendar_type = 'HOLIDAY'
 WHERE m.holiday_calendar_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM company_calendar_activation a
      WHERE a.company_id = m.company_id AND a.calendar_id = m.holiday_calendar_id
        AND a.deactivated_at IS NULL);

-- company_calendar_map is NOT dropped. leave_calendar_id still lives there
-- and nothing has replaced it. Only the holiday side moves to activations.


-- ── 5. resolve_holidays — by date, across every active calendar ──────
-- Replaces 128's version. Differences from 128:
--   * joins company_calendar_activation (many) instead of
--     company_calendar_map (exactly one)
--   * therefore returns holidays from EVERY active calendar, each bounded
--     by its own from/to range, so past years keep resolving
-- Unchanged from 128: PUBLISHED filter, calendar_type, applicability scope,
-- and DISTINCT ON so a branch-specific entry beats a company-wide one.
CREATE OR REPLACE FUNCTION resolve_holidays(p_employee_id UUID)
RETURNS TABLE(holiday_date DATE, description TEXT, holiday_type TEXT, is_optional BOOLEAN) AS $$
  SELECT DISTINCT ON (he.holiday_date)
         he.holiday_date, he.description, he.holiday_type, he.is_optional
  FROM employees e
  JOIN company_calendar_activation a ON a.company_id = e.company_id
                                    AND a.deactivated_at IS NULL
  JOIN holiday_calendar hc      ON hc.id = a.calendar_id
                               AND hc.status = 'PUBLISHED'
                               AND hc.calendar_type = 'HOLIDAY'
  JOIN holiday_entries he       ON he.calendar_id = hc.id
                               AND he.holiday_date BETWEEN hc.from_date AND hc.to_date
  JOIN holiday_applicability ha ON ha.holiday_id = he.id
                               AND ha.company_id = e.company_id
                               AND (ha.branch_id IS NULL OR ha.branch_id = e.location_id)
  WHERE e.id = p_employee_id
  ORDER BY he.holiday_date,
           (ha.branch_id IS NOT NULL) DESC,   -- branch-specific beats company-wide
           he.created_at DESC;                -- newest entry breaks a true tie
$$ LANGUAGE sql STABLE;


-- ── 6. What each company follows right now, for the Calendars tab ────
CREATE OR REPLACE VIEW company_active_calendars AS
  SELECT a.company_id, co.company_code, co.company_name,
         a.calendar_id, c.name AS calendar_name, c.status,
         c.from_date, c.to_date,
         a.activated_at, a.activated_by,
         (c.status = 'PUBLISHED')                         AS reaches_ess,
         (CURRENT_DATE BETWEEN c.from_date AND c.to_date) AS covers_today
    FROM company_calendar_activation a
    JOIN holiday_calendar c ON c.id = a.calendar_id
    JOIN companies co       ON co.id = a.company_id
   WHERE a.deactivated_at IS NULL;

notify pgrst, 'reload schema';
