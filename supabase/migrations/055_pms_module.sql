-- =====================================================================
-- EZER HRMS — Migration 055: Performance Management System (PMS)
--
-- Adapted from the supplied EZER-PMS-v2 package (079_pms_module_v2.sql).
-- Developmental PMS only — no increment, variable pay, arrear or TDS.
-- payout_linkage_enabled is locked false by CHECK and cannot be turned on
-- without dropping the constraint in a later migration.
--
-- WHAT WAS CHANGED FROM THE SUPPLIED FILE, AND WHY
--
-- 1. Renumbered 079 -> 055. This repo's last migration is 054.
--
-- 2. Column names remapped to this database. The supplied file was written
--    against a schema where employees carried employee_code, employee_name,
--    date_of_joining and resignation_date. This one has:
--
--        employee_code     ->  emp_code
--        employee_name     ->  full_name
--        date_of_joining   ->  company_doj
--        resignation_date  ->  date_of_resignation
--
--    Left as-is: date_of_leaving, which exists here under that name. The
--    views still EXPOSE employee_code and employee_name via AS aliases, so
--    the contract the spec and the app expect is unchanged — only the reads
--    underneath were corrected. Without this the ten views would fail on
--    first execution.
--
--    Note pms_rating_upload_log.employee_code is PMS's OWN column, matched
--    against a spreadsheet upload, and was deliberately NOT remapped.
--
-- 3. HR ADMIN KRA OVERRIDE — added, not in the supplied spec.
--    HR Admin runs the cycle end to end and needs to correct a KRA set that
--    was raised wrongly, including after it has been locked. Adds four
--    columns to pms_employee_goals, a TERMINATED status, and one function:
--
--        pms_hr_kra_action(employee, period, action, actor, reason, goal)
--            EDIT       correct one KRA in place, even when LOCKED
--            REISSUE    hand the set back to the employee to rebuild
--            TERMINATE  void the set for the period
--
--    A reason of >= 10 characters is required by the function AND by a table
--    CHECK, and every action writes the before/after of the whole set to
--    pms_audit_log. Overriding an approved artifact should never be possible
--    without a record of who did it and why.
--
-- 4. APPROVAL CHAIN. Employee -> RM L1 -> RM L2 -> HOD finalises. HR Admin is
--    not a gate in the chain; it supervises, consolidates and overrides.
--    HOD resolves through employees.hod_id, which is currently unset for all
--    398 employees — the queue will be empty until that data is filled, and
--    the admin screen says so rather than appearing broken.
--
-- NOT RUN BY ME. Nayan owns the database; this is handed over to be applied.
-- =====================================================================
-- CHANGES vs v1
--   - DROPPED  pms_outcomes (increment/variable/arrear/TDS) entirely
--   - DROPPED  pms_rating_scale payout & increment columns
--   - DROPPED  bell curve / normalization / calibration tables
--   - ADDED    pms_policies       (multiple policies per company)
--   - ADDED    pms_periods        (monthly/quarterly/half-yearly/annual)
--   - ADDED    pms_one_to_one     (mandatory discussion log + dual ack)
--   - ADDED    pms_feedback       (appreciation / improvement / benefits)
--   - ADDED    pms_rating_upload_log (manual final-rating override audit)
--   - REBUILT  pms_pip            (RM request -> HR initiate -> employee)
--   - REBUILT  pms_employee_goals (min 4 / max 10 / total 100 enforced)
--   - ADDED    exit & notice-period highlighting via vw_pms_employment_flag
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. POLICIES  (Admin configuration — multiple per company)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_policies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  policy_code           text NOT NULL,
  policy_name           text NOT NULL,

  -- frequency
  frequency             text NOT NULL DEFAULT 'QUARTERLY'
                        CHECK (frequency IN ('MONTHLY','QUARTERLY','HALF_YEARLY','ANNUAL')),
  periods_per_year      int  GENERATED ALWAYS AS (
                          CASE frequency WHEN 'MONTHLY' THEN 12 WHEN 'QUARTERLY' THEN 4
                                         WHEN 'HALF_YEARLY' THEN 2 ELSE 1 END) STORED,

  -- applicability (narrowest match wins: location > grade > department > all)
  applies_department_ids uuid[],
  applies_grades         text[],
  applies_location_ids   uuid[],
  applies_employment_types text[],
  applies_to_all         boolean NOT NULL DEFAULT true,

  -- KRA rules
  min_kra_count         int NOT NULL DEFAULT 4  CHECK (min_kra_count  >= 1),
  max_kra_count         int NOT NULL DEFAULT 10 CHECK (max_kra_count  <= 20),
  total_weightage       int NOT NULL DEFAULT 100,
  min_weightage_per_kra numeric(5,2) NOT NULL DEFAULT 5,
  kra_created_by        text NOT NULL DEFAULT 'EMPLOYEE'
                        CHECK (kra_created_by IN ('EMPLOYEE','MANAGER','BOTH')),

  -- one-to-one rules
  one_to_one_mandatory      boolean NOT NULL DEFAULT true,  -- before weightage lock
  mid_period_checkin        boolean NOT NULL DEFAULT true,
  final_review_one_to_one   boolean NOT NULL DEFAULT true,  -- before result publish

  -- workflow
  approval_chain        text NOT NULL DEFAULT 'SELF_RM1_RM2_HOD'
                        CHECK (approval_chain IN ('SELF_RM1','SELF_RM1_HOD','SELF_RM1_RM2_HOD','SELF_RM1_RM2_HOD_MD')),
  who_can_finalise      text NOT NULL DEFAULT 'RM1_RM2_HOD'
                        CHECK (who_can_finalise IN ('HOD_ONLY','RM2_HOD','RM1_RM2_HOD')),
  self_rating_mandatory boolean NOT NULL DEFAULT true,

  -- rating
  rating_scale_type     text NOT NULL DEFAULT 'FIVE_POINT'
                        CHECK (rating_scale_type IN ('FOUR_POINT_NR','FIVE_POINT','TEN_POINT')),

  -- eligibility
  new_joiner_cutoff_days int NOT NULL DEFAULT 30,   -- DOJ within N days of period end => NR
  include_notice_period  boolean NOT NULL DEFAULT true,
  include_exited         boolean NOT NULL DEFAULT true,   -- read-only after LWD

  -- HARD LOCK: no payout linkage in this release
  payout_linkage_enabled boolean NOT NULL DEFAULT false
                         CHECK (payout_linkage_enabled = false),

  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, policy_code),
  CHECK (max_kra_count >= min_kra_count)
);

-- ---------------------------------------------------------------------
-- 2. PERIODS  (auto-generated from policy frequency)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  policy_id           uuid NOT NULL REFERENCES pms_policies(id) ON DELETE CASCADE,
  financial_year      text NOT NULL,                 -- 2026-27
  period_code         text NOT NULL,                 -- Q3-FY2627 / M07-FY2627 / H1-FY2627
  period_name         text NOT NULL,
  period_no           int  NOT NULL,
  period_start        date NOT NULL,
  period_end          date NOT NULL,

  kra_window_from     date, kra_window_to     date,
  checkin_from        date, checkin_to        date,
  self_rating_from    date, self_rating_to    date,
  rm_review_from      date, rm_review_to      date,
  finalise_from       date, finalise_to       date,
  result_publish_date date,

  status              text NOT NULL DEFAULT 'SCHEDULED'
                      CHECK (status IN ('SCHEDULED','KRA_SETTING','IN_PROGRESS','SELF_RATING',
                                        'RM_REVIEW','FINALISATION','PUBLISHED','CLOSED')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, period_code),
  CHECK (period_end > period_start)
);
CREATE INDEX IF NOT EXISTS idx_pms_periods_status ON pms_periods(company_id, status);

-- ---------------------------------------------------------------------
-- 3. RATING SCALE  (no payout / increment columns)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_rating_scale (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL,
  policy_id            uuid REFERENCES pms_policies(id) ON DELETE CASCADE,
  rating_value         numeric(4,2) NOT NULL,
  rating_code          text NOT NULL,              -- O / EE / ME / NI / U / NR
  rating_label         text NOT NULL,
  score_from           numeric(5,2) NOT NULL,
  score_to             numeric(5,2) NOT NULL,
  min_comment_chars    int NOT NULL DEFAULT 0,
  improvement_feedback_mandatory boolean NOT NULL DEFAULT false,
  allows_pip_request   boolean NOT NULL DEFAULT false,
  colour_hex           text DEFAULT '#7C3AED',
  sort_order           int NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, policy_id, rating_code)
);

-- ---------------------------------------------------------------------
-- 4. KRA LIBRARY (optional suggestions — employee still writes own)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_kra_master (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  department_id     uuid,
  designation       text,
  grade             text,
  kra_title         text NOT NULL,
  kpi_metric        text,
  suggested_target  text,
  category          text DEFAULT 'BUSINESS'
                    CHECK (category IN ('BUSINESS','PROCESS','PEOPLE','CUSTOMER','COMPLIANCE','LEARNING')),
  suggested_weightage numeric(5,2),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 5. EMPLOYEE GOALS / KRAs  (min 4, max 10, total 100)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_employee_goals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  period_id         uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL,
  seq_no            int  NOT NULL,                  -- 1..10
  kra_master_id     uuid REFERENCES pms_kra_master(id),
  kra_title         text NOT NULL,
  kpi_metric        text,
  target_value      text,
  category          text DEFAULT 'BUSINESS'
                    CHECK (category IN ('BUSINESS','PROCESS','PEOPLE','CUSTOMER','COMPLIANCE','LEARNING')),
  weightage         numeric(5,2) NOT NULL DEFAULT 0 CHECK (weightage >= 0 AND weightage <= 100),
  source            text DEFAULT 'MANUAL'
                    CHECK (source IN ('MANUAL','LIBRARY','AI_SUGGESTED','CARRIED_FORWARD')),
  carried_from_period_id uuid REFERENCES pms_periods(id),
  status            text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','PENDING_ONE_TO_ONE','PENDING_RM_APPROVAL',
                                      'LOCKED','SENT_BACK','TERMINATED')),
  sent_back_reason  text,
  locked_at         timestamptz,
  locked_by         uuid,

      -- HR ADMIN OVERRIDE  (added for EZER — not in the supplied spec)
      -- HR Admin owns the running of the cycle and must be able to correct a
      -- KRA set raised wrongly, including after it is LOCKED. Three actions,
      -- each requiring a reason and each written to pms_audit_log:
      --   EDIT       HR changes a KRA in place; before/after captured in audit
      --   REISSUE    the set returns to the employee to rebuild; locks cleared
      --   TERMINATE  the set is voided for the period; no rating flows from it
      -- A NULL hr_action means HR has never touched this row, so an override is
      -- never invisible.
      hr_action         text CHECK (hr_action IN ('EDIT','REISSUE','TERMINATE')),
      hr_action_reason  text,
      hr_action_by      uuid,
      hr_action_at      timestamptz,
      CONSTRAINT pms_goals_hr_reason_required
        CHECK (hr_action IS NULL OR (hr_action_reason IS NOT NULL
                                     AND length(btrim(hr_action_reason)) >= 10)),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, employee_id, seq_no)
);
CREATE INDEX IF NOT EXISTS idx_pms_goals_emp ON pms_employee_goals(employee_id, period_id);

-- ---------------------------------------------------------------------
-- 6. ONE-TO-ONE DISCUSSION LOG  (mandatory, dual acknowledgement)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_one_to_one (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL,
  period_id          uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL,
  manager_id         uuid NOT NULL,
  manager_role       text NOT NULL DEFAULT 'RM_L1'
                     CHECK (manager_role IN ('RM_L1','RM_L2','HOD')),
  discussion_type    text NOT NULL
                     CHECK (discussion_type IN ('KRA_SETTING','MID_PERIOD','FINAL_REVIEW','ADHOC')),
  discussion_date    date NOT NULL,
  mode               text CHECK (mode IN ('IN_PERSON','VIDEO','PHONE')),
  duration_minutes   int,
  discussion_points  text NOT NULL,
  weightage_changes  jsonb,                          -- [{seq_no, old_wt, new_wt, reason}]
  employee_ack       boolean NOT NULL DEFAULT false,
  employee_ack_at    timestamptz,
  manager_ack        boolean NOT NULL DEFAULT false,
  manager_ack_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pms_121 ON pms_one_to_one(period_id, employee_id, discussion_type);

-- ---------------------------------------------------------------------
-- 7. REVIEWS  (one row per rater per KRA)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  period_id         uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL,
  goal_id           uuid NOT NULL REFERENCES pms_employee_goals(id) ON DELETE CASCADE,
  rater_id          uuid NOT NULL,
  rater_role        text NOT NULL
                    CHECK (rater_role IN ('SELF','RM_L1','RM_L2','HOD','MD')),
  achievement_value text,
  rating            numeric(4,2),
  comments          text,
  evidence_url      text,
  submitted         boolean NOT NULL DEFAULT false,
  submitted_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, employee_id, goal_id, rater_role)
);
CREATE INDEX IF NOT EXISTS idx_pms_reviews ON pms_reviews(period_id, employee_id, rater_role);

-- ---------------------------------------------------------------------
-- 8. OVERALL RATING  (no payout fields)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_overall_rating (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  period_id           uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL,
  policy_id           uuid REFERENCES pms_policies(id),
  department_id       uuid,
  grade               text,
  rm_l1_id            uuid, rm_l2_id uuid, hod_id uuid,

  employment_flag     text NOT NULL DEFAULT 'ACTIVE'
                      CHECK (employment_flag IN ('ACTIVE','NOTICE_PERIOD','EXITED','NEW_JOINER')),
  last_working_day    date,
  is_eligible         boolean NOT NULL DEFAULT true,
  ineligible_reason   text,

  kra_count           int,
  total_weightage     numeric(6,2),
  self_score          numeric(5,2),
  rm_l1_score         numeric(5,2),
  rm_l2_score         numeric(5,2),
  hod_score           numeric(5,2),
  final_score         numeric(5,2),
  final_rating        numeric(4,2),
  final_rating_code   text,

  self_vs_final_gap   numeric(5,2) GENERATED ALWAYS AS (self_score - final_score) STORED,

  finalised_by        uuid,
  finalised_by_role   text CHECK (finalised_by_role IN ('RM_L1','RM_L2','HOD','HR_MANAGER','HR_HEAD','ADMIN')),
  finalised_at        timestamptz,
  rating_source       text NOT NULL DEFAULT 'SYSTEM'
                      CHECK (rating_source IN ('SYSTEM','MANUAL_UPLOAD','HR_OVERRIDE')),
  override_reason     text,

  workflow_status     text NOT NULL DEFAULT 'NOT_STARTED'
                      CHECK (workflow_status IN ('NOT_STARTED','KRA_DRAFT','KRA_LOCKED','SELF_DRAFT',
                                                 'SELF_SUBMITTED','RM_L1_DONE','RM_L2_DONE',
                                                 'FINALISED','PUBLISHED','ACKNOWLEDGED')),
  published_at        timestamptz,
  employee_ack        boolean NOT NULL DEFAULT false,
  employee_ack_at     timestamptz,
  is_readonly         boolean NOT NULL DEFAULT false,   -- true once exited & finalised
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_pms_overall_status ON pms_overall_rating(period_id, workflow_status);
CREATE INDEX IF NOT EXISTS idx_pms_overall_flag   ON pms_overall_rating(period_id, employment_flag);

-- ---------------------------------------------------------------------
-- 9. FEEDBACK & RECOGNITION  (appreciation / improvement / benefits)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_feedback (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  period_id             uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL,
  appreciation_remark   text,
  improvement_feedback  text,
  development_plan      text,
  given_by              uuid,
  given_by_role         text,
  visible_to_employee   boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, employee_id)
);

CREATE TABLE IF NOT EXISTS pms_additional_benefits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  period_id      uuid NOT NULL REFERENCES pms_periods(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL,
  benefit_type   text NOT NULL
                 CHECK (benefit_type IN ('CERTIFICATE','SPOT_AWARD','TRAINING_NOMINATION',
                                         'SPECIAL_MENTION','STAR_PERFORMER','OTHER')),
  benefit_note   text,
  attachment_url text,
  -- recognition only: no monetary value, no payroll linkage
  awarded_by     uuid,
  awarded_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 10. PIP  (RM requests -> HR Manager initiates -> employee)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_pip (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL,
  period_id          uuid REFERENCES pms_periods(id),
  employee_id        uuid NOT NULL,

  -- STEP 1: RM raises request
  requested_by       uuid NOT NULL,
  requested_by_role  text NOT NULL DEFAULT 'RM_L1'
                     CHECK (requested_by_role IN ('RM_L1','RM_L2','HOD')),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  trigger_rating     numeric(4,2),
  request_reason     text NOT NULL,
  proposed_start     date NOT NULL,
  proposed_end       date NOT NULL,
  support_proposed   text,
  request_document_url text,

  -- STEP 2: HR Manager reviews
  hr_status          text NOT NULL DEFAULT 'PENDING_HR'
                     CHECK (hr_status IN ('PENDING_HR','INITIATED','REJECTED','SENT_BACK')),
  hr_reviewed_by     uuid,
  hr_reviewed_at     timestamptz,
  hr_note_employee   text,
  hr_note_manager    text,
  rejection_reason   text,

  -- STEP 3: initiated plan
  pip_start_date     date,
  pip_end_date       date,
  review_frequency   text CHECK (review_frequency IN ('FORTNIGHTLY','MONTHLY')),
  initiated_by       uuid,
  initiated_at       timestamptz,

  -- STEP 4: employee acknowledgement
  employee_ack       boolean NOT NULL DEFAULT false,
  employee_ack_at    timestamptz,
  employee_note      text,

  final_outcome      text CHECK (final_outcome IN ('IMPROVED','EXTENDED','SEPARATION_REVIEW','PENDING')),
  outcome_date       date,
  outcome_note       text,
  letter_url         text,
  status             text NOT NULL DEFAULT 'REQUESTED'
                     CHECK (status IN ('REQUESTED','ACTIVE','UNDER_REVIEW','CLOSED','CANCELLED')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pms_pip_areas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id            uuid NOT NULL REFERENCES pms_pip(id) ON DELETE CASCADE,
  seq_no            int NOT NULL,
  improvement_area  text NOT NULL,
  current_state     text,
  target_value      text NOT NULL,
  measure_method    text,
  review_date       date NOT NULL,
  is_retained       boolean NOT NULL DEFAULT true,   -- HR can drop an area at initiate stage
  UNIQUE (pip_id, seq_no)
);

CREATE TABLE IF NOT EXISTS pms_pip_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pip_id        uuid NOT NULL REFERENCES pms_pip(id) ON DELETE CASCADE,
  review_no     int NOT NULL,
  review_date   date NOT NULL,
  reviewed_by   uuid,
  area_status   jsonb,                                -- [{seq_no, status, note}]
  overall_status text CHECK (overall_status IN ('IMPROVED','PARTIAL','NO_CHANGE')),
  review_note   text,
  employee_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pip_id, review_no)
);

-- ---------------------------------------------------------------------
-- 11. MANUAL RATING UPLOAD AUDIT
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_rating_upload_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  period_id        uuid NOT NULL REFERENCES pms_periods(id),
  batch_id         uuid NOT NULL,
  employee_id      uuid,
  employee_code    text,
  system_rating    numeric(4,2),
  uploaded_rating  numeric(4,2),
  override_reason  text,
  validation_status text NOT NULL
                   CHECK (validation_status IN ('OK','ERROR_NOT_FOUND','ERROR_NOT_ELIGIBLE',
                                                'ERROR_REASON_MISSING','ERROR_INVALID_RATING')),
  error_message    text,
  committed        boolean NOT NULL DEFAULT false,
  uploaded_by      uuid NOT NULL,
  uploaded_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 12. AUDIT LOG
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pms_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id   uuid, employee_id uuid,
  table_name  text NOT NULL, record_id uuid, action text NOT NULL,
  old_value   jsonb, new_value jsonb,
  actor_id    uuid, actor_role text,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- HOD RESOLUTION  (added for EZER — not in the supplied spec)
--
-- The HOD finalises, so who that is has to be unambiguous. Order:
--
--   1. employees.hod_id            explicit override — matrix teams and
--                                  dotted-line reporting, where the person's
--                                  HOD is not their department's HOD
--   2. departments.hod_employee_id primary source — the normal case
--   3. BLOCK                       no guess. Not RM L2, not the parent
--                                  department, not "the most senior person in
--                                  the department". A wrong finaliser signs off
--                                  somebody's appraisal, and a silent fallback
--                                  makes that impossible to notice.
--
-- departments.hod_employee_id does not exist in this database yet, so it is
-- added here. NOTE FOR REVIEW: this is the one place migration 055 touches an
-- existing HR table rather than only creating new pms_* tables.
-- ---------------------------------------------------------------------
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS hod_employee_id uuid;

COMMENT ON COLUMN departments.hod_employee_id IS
  'Head of Department. Primary source for the PMS finalise step. Overridden '
  'per-employee by employees.hod_id where reporting is matrix or dotted-line.';

-- Returns the HOD for an employee, or NULL when neither source is set.
-- NULL means BLOCK: the caller must refuse to finalise, not pick somebody.
CREATE OR REPLACE FUNCTION pms_resolve_hod(p_employee_id uuid)
RETURNS TABLE (hod_id uuid, source text)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(e.hod_id, d.hod_employee_id)                        AS hod_id,
    CASE WHEN e.hod_id           IS NOT NULL THEN 'EMPLOYEE_OVERRIDE'
         WHEN d.hod_employee_id  IS NOT NULL THEN 'DEPARTMENT'
         ELSE                                     'UNRESOLVED'
    END                                                          AS source
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  WHERE e.id = p_employee_id;
$$;

-- Which employees cannot reach the finalise step, and why. Drives the warning
-- on the HR Admin screen and the export that goes with it.
CREATE OR REPLACE VIEW vw_pms_hod_resolution AS
SELECT e.id                AS employee_id,
       e.emp_code          AS employee_code,
       e.full_name         AS employee_name,
       e.department_id,
       d.dept_name,
       e.hod_id            AS employee_override,
       d.hod_employee_id   AS department_hod,
       COALESCE(e.hod_id, d.hod_employee_id) AS resolved_hod_id,
       CASE WHEN e.hod_id          IS NOT NULL THEN 'EMPLOYEE_OVERRIDE'
            WHEN d.hod_employee_id IS NOT NULL THEN 'DEPARTMENT'
            ELSE                                    'UNRESOLVED'
       END                 AS resolution_source
FROM employees e
LEFT JOIN departments d ON d.id = e.department_id
WHERE e.date_of_leaving IS NULL OR e.date_of_leaving > CURRENT_DATE;


-- =====================================================================
-- FUNCTIONS
-- =====================================================================

-- Auto-generate periods from a policy
CREATE OR REPLACE FUNCTION pms_generate_periods(p_policy_id uuid, p_fy text, p_fy_start date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  pol pms_policies%ROWTYPE; n int; i int; mo int;
  s date; e date; code text; nm text; cnt int := 0;
BEGIN
  SELECT * INTO pol FROM pms_policies WHERE id = p_policy_id;
  n  := pol.periods_per_year;
  mo := 12 / n;

  FOR i IN 1..n LOOP
    s := p_fy_start + ((i-1) * mo || ' months')::interval;
    e := (s + (mo || ' months')::interval)::date - 1;

    code := CASE pol.frequency
              WHEN 'MONTHLY'     THEN 'M'  || LPAD(i::text,2,'0')
              WHEN 'QUARTERLY'   THEN 'Q'  || i
              WHEN 'HALF_YEARLY' THEN 'H'  || i
              ELSE 'FY' END || '-FY' || REPLACE(p_fy,'-','');
    nm := CASE pol.frequency
              WHEN 'MONTHLY'     THEN TO_CHAR(s,'Mon YYYY')
              WHEN 'QUARTERLY'   THEN 'Q' || i || ' ' || p_fy
              WHEN 'HALF_YEARLY' THEN 'H' || i || ' ' || p_fy
              ELSE 'FY ' || p_fy END;

    INSERT INTO pms_periods (company_id, policy_id, financial_year, period_code, period_name,
                             period_no, period_start, period_end,
                             kra_window_from, kra_window_to,
                             self_rating_from, self_rating_to,
                             rm_review_from, rm_review_to,
                             finalise_from, finalise_to, result_publish_date)
    VALUES (pol.company_id, p_policy_id, p_fy, code, nm, i, s, e,
            s, s + 14,
            e + 1,  e + 10,
            e + 11, e + 20,
            e + 21, e + 28, e + 31)
    ON CONFLICT (policy_id, period_code) DO NOTHING;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END $$;

-- Validate KRA set: min count, max count, total weightage
CREATE OR REPLACE FUNCTION pms_validate_kras(p_employee_id uuid, p_period_id uuid)
RETURNS TABLE (is_valid boolean, kra_count int, total_wt numeric, error_msg text)
LANGUAGE plpgsql AS $$
DECLARE pol pms_policies%ROWTYPE; v_cnt int; v_tot numeric; v_min numeric; v_err text := NULL;
BEGIN
  SELECT p.* INTO pol
  FROM pms_policies p JOIN pms_periods pe ON pe.policy_id = p.id
  WHERE pe.id = p_period_id;

  SELECT COUNT(*), COALESCE(SUM(weightage),0), COALESCE(MIN(weightage),0)
    INTO v_cnt, v_tot, v_min
  FROM pms_employee_goals
  WHERE employee_id = p_employee_id AND period_id = p_period_id
    AND status <> 'SENT_BACK';

  IF v_cnt < pol.min_kra_count THEN
    v_err := format('Minimum %s KRA mandatory (currently %s)', pol.min_kra_count, v_cnt);
  ELSIF v_cnt > pol.max_kra_count THEN
    v_err := format('Maximum %s KRA allowed (currently %s)', pol.max_kra_count, v_cnt);
  ELSIF v_tot <> pol.total_weightage THEN
    v_err := format('Total weightage must be exactly %s (currently %s)', pol.total_weightage, v_tot);
  ELSIF v_min < pol.min_weightage_per_kra THEN
    v_err := format('Each KRA needs at least %s weightage', pol.min_weightage_per_kra);
  END IF;

  RETURN QUERY SELECT (v_err IS NULL), v_cnt, v_tot, v_err;
END $$;

-- Lock KRA weightage — blocks if one-to-one not acknowledged by both sides
CREATE OR REPLACE FUNCTION pms_lock_kras(p_employee_id uuid, p_period_id uuid, p_manager_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE pol pms_policies%ROWTYPE; v_ok boolean; v_err text; v_121 int;
BEGIN
  SELECT p.* INTO pol FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id WHERE pe.id = p_period_id;

  SELECT is_valid, error_msg INTO v_ok, v_err
  FROM pms_validate_kras(p_employee_id, p_period_id);
  IF NOT v_ok THEN RETURN 'BLOCKED: ' || v_err; END IF;

  IF pol.one_to_one_mandatory THEN
    SELECT COUNT(*) INTO v_121 FROM pms_one_to_one
    WHERE employee_id = p_employee_id AND period_id = p_period_id
      AND discussion_type = 'KRA_SETTING'
      AND employee_ack = true AND manager_ack = true;
    IF v_121 = 0 THEN
      RETURN 'BLOCKED: one-to-one discussion required and must be acknowledged by both';
    END IF;
  END IF;

  UPDATE pms_employee_goals
     SET status='LOCKED', locked_at=now(), locked_by=p_manager_id, updated_at=now()
   WHERE employee_id=p_employee_id AND period_id=p_period_id AND status <> 'SENT_BACK';

  UPDATE pms_overall_rating SET workflow_status='KRA_LOCKED', updated_at=now()
   WHERE employee_id=p_employee_id AND period_id=p_period_id;

  RETURN 'LOCKED';
END $$;

-- Weighted score for a given rater role
CREATE OR REPLACE FUNCTION pms_score(p_employee_id uuid, p_period_id uuid, p_role text)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT ROUND(COALESCE(SUM(r.rating * g.weightage) / NULLIF(SUM(g.weightage),0), 0), 2)
  FROM pms_employee_goals g
  JOIN pms_reviews r ON r.goal_id = g.id AND r.rater_role = p_role AND r.submitted = true
  WHERE g.employee_id = p_employee_id AND g.period_id = p_period_id;
$$;

-- Map a score to a rating band
CREATE OR REPLACE FUNCTION pms_rating_from_score(p_policy_id uuid, p_score numeric)
RETURNS TABLE (rating numeric, code text) LANGUAGE sql STABLE AS $$
  SELECT rating_value, rating_code FROM pms_rating_scale
  WHERE policy_id = p_policy_id AND is_active
    AND p_score >= score_from AND p_score <= score_to
  ORDER BY sort_order LIMIT 1;
$$;

-- Finalise: allowed roles come from the policy
CREATE OR REPLACE FUNCTION pms_finalise(p_employee_id uuid, p_period_id uuid,
                                        p_actor_id uuid, p_actor_role text,
                                        p_rating numeric, p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE pol pms_policies%ROWTYPE; v_allowed text[]; v_code text; v_121 int; v_hod uuid; v_hod_src text;
BEGIN
  SELECT p.* INTO pol FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id = p.id WHERE pe.id = p_period_id;

  v_allowed := CASE pol.who_can_finalise
                 WHEN 'HOD_ONLY'    THEN ARRAY['HOD']
                 WHEN 'RM2_HOD'     THEN ARRAY['RM_L2','HOD']
                 ELSE ARRAY['RM_L1','RM_L2','HOD'] END;
  v_allowed := v_allowed || ARRAY['HR_MANAGER','HR_HEAD','ADMIN'];

  IF NOT (p_actor_role = ANY(v_allowed)) THEN
    RETURN 'BLOCKED: role ' || p_actor_role || ' cannot finalise under this policy';
  END IF;

      -- HOD RESOLUTION GATE  (added for EZER)
      --
      -- Two separate things, both needed:
      --   a) an unresolved HOD blocks. No fallback to RM L2, no parent
      --      department, no "senior-most in the team". A wrong finaliser signs
      --      off somebody's appraisal, and a silent guess makes that invisible.
      --   b) whoever presents as HOD must BE the resolved HOD for THIS
      --      employee. Without this the role string is self-asserted and any
      --      HOD could finalise anyone's appraisal.
      --
      -- HR_MANAGER / HR_HEAD / ADMIN are deliberately exempt: HR Admin runs the
      -- cycle and is the escalation path when a department has no HOD mapped.
      -- Their finalise records their own role, so an HR override stays
      -- distinguishable from an HOD sign-off in pms_overall_rating.
      IF p_actor_role = 'HOD' THEN
        SELECT r.hod_id, r.source INTO v_hod, v_hod_src
          FROM pms_resolve_hod(p_employee_id) r;

        IF v_hod IS NULL THEN
          RETURN 'BLOCKED: no HOD resolved for this employee. Set '
              || 'departments.hod_employee_id for their department, or '
              || 'employees.hod_id for a matrix/dotted-line exception.';
        END IF;

        IF v_hod <> p_actor_id THEN
          RETURN 'BLOCKED: you are not the HOD for this employee (resolved via '
              || v_hod_src || ').';
        END IF;
      END IF;

  IF pol.final_review_one_to_one THEN
    SELECT COUNT(*) INTO v_121 FROM pms_one_to_one
    WHERE employee_id=p_employee_id AND period_id=p_period_id
      AND discussion_type='FINAL_REVIEW' AND employee_ack AND manager_ack;
    IF v_121 = 0 THEN RETURN 'BLOCKED: final review one-to-one not logged'; END IF;
  END IF;

  SELECT code INTO v_code FROM pms_rating_from_score(pol.id, p_rating);

  UPDATE pms_overall_rating
     SET final_rating      = p_rating,
         final_rating_code = COALESCE(v_code, final_rating_code),
         finalised_by      = p_actor_id,
         finalised_by_role = p_actor_role,
         finalised_at      = now(),
         override_reason   = p_reason,
         workflow_status   = 'FINALISED',
         is_readonly       = (employment_flag = 'EXITED'),
         updated_at        = now()
   WHERE employee_id = p_employee_id AND period_id = p_period_id;

  RETURN 'FINALISED';
END $$;


-- ---------------------------------------------------------------------
-- HR ADMIN KRA OVERRIDE  (added for EZER — not in the supplied spec)
--
-- HR Admin runs the cycle: chasing KRAs, consolidating ratings, coordinating
-- RM L1/L2, HOD and MD. When a KRA set is raised wrongly they need to correct
-- it, and that has to be possible after LOCK, because that is exactly when the
-- mistake is noticed.
--
-- Three actions, one entry point, so no screen can invent a fourth:
--   EDIT       correct a single KRA in place, even when LOCKED
--   REISSUE    hand the whole set back to the employee to rebuild
--   TERMINATE  void the set for the period; nothing rates from it
--
-- The reason is not optional and not decorative — it is the only record of why
-- an approved artifact was changed, so it is enforced at 10 characters by a
-- CHECK on the table as well as here.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pms_hr_kra_action(
  p_employee_id uuid,
  p_period_id   uuid,
  p_action      text,            -- EDIT | REISSUE | TERMINATE
  p_actor_id    uuid,
  p_reason      text,
  p_goal_id     uuid DEFAULT NULL   -- required for EDIT, ignored otherwise
) RETURNS TABLE (ok boolean, affected int, message text)
LANGUAGE plpgsql AS $$
DECLARE
  v_before jsonb;
  v_count  int := 0;
BEGIN
  IF p_action NOT IN ('EDIT','REISSUE','TERMINATE') THEN
    RETURN QUERY SELECT false, 0, 'Unknown action: ' || coalesce(p_action,'(null)');
    RETURN;
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RETURN QUERY SELECT false, 0,
      'A reason of at least 10 characters is required to override a KRA set.';
    RETURN;
  END IF;

  IF p_action = 'EDIT' AND p_goal_id IS NULL THEN
    RETURN QUERY SELECT false, 0, 'EDIT needs the specific KRA (p_goal_id).';
    RETURN;
  END IF;

  -- capture the whole set before touching it, so the audit row shows what the
  -- employee and their manager had actually agreed
  SELECT jsonb_agg(to_jsonb(g)) INTO v_before
  FROM pms_employee_goals g
  WHERE g.employee_id = p_employee_id AND g.period_id = p_period_id;

  IF v_before IS NULL THEN
    RETURN QUERY SELECT false, 0, 'No KRAs found for that employee and period.';
    RETURN;
  END IF;

  IF p_action = 'REISSUE' THEN
    -- back to the employee: locks cleared, so the normal flow runs again from
    -- the top rather than resuming mid-chain
    UPDATE pms_employee_goals
       SET status = 'SENT_BACK', sent_back_reason = p_reason,
           locked_at = NULL, locked_by = NULL,
           hr_action = 'REISSUE', hr_action_reason = p_reason,
           hr_action_by = p_actor_id, hr_action_at = now(), updated_at = now()
     WHERE employee_id = p_employee_id AND period_id = p_period_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSIF p_action = 'TERMINATE' THEN
    UPDATE pms_employee_goals
       SET status = 'TERMINATED',
           hr_action = 'TERMINATE', hr_action_reason = p_reason,
           hr_action_by = p_actor_id, hr_action_at = now(), updated_at = now()
     WHERE employee_id = p_employee_id AND period_id = p_period_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

  ELSE  -- EDIT: the row itself is changed by the caller; this stamps and logs it
    UPDATE pms_employee_goals
       SET hr_action = 'EDIT', hr_action_reason = p_reason,
           hr_action_by = p_actor_id, hr_action_at = now(), updated_at = now()
     WHERE id = p_goal_id AND employee_id = p_employee_id AND period_id = p_period_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  INSERT INTO pms_audit_log (period_id, employee_id, table_name, record_id,
                             action, old_value, new_value, actor_id, actor_role)
  SELECT p_period_id, p_employee_id, 'pms_employee_goals', p_goal_id,
         'HR_' || p_action, v_before,
         (SELECT jsonb_agg(to_jsonb(g)) FROM pms_employee_goals g
           WHERE g.employee_id = p_employee_id AND g.period_id = p_period_id),
         p_actor_id, 'HR_ADMIN';

  RETURN QUERY SELECT true, v_count,
    CASE p_action
      WHEN 'REISSUE'   THEN 'KRAs returned to the employee to rebuild.'
      WHEN 'TERMINATE' THEN 'KRA set voided for this period.'
      ELSE                  'KRA edited and recorded.'
    END;
END $$;


-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- Block edits once an exited employee's record is read-only
CREATE OR REPLACE FUNCTION pms_block_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_readonly AND NEW.is_readonly THEN
    RAISE EXCEPTION 'Record is read-only (employee exited and rating finalised)';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pms_readonly ON pms_overall_rating;
CREATE TRIGGER trg_pms_readonly BEFORE UPDATE ON pms_overall_rating
FOR EACH ROW EXECUTE FUNCTION pms_block_readonly();

-- Self rating must be submitted before RM can rate
CREATE OR REPLACE FUNCTION pms_check_self_first() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_self int; v_req boolean;
BEGIN
  IF NEW.rater_role = 'SELF' OR NEW.submitted = false THEN RETURN NEW; END IF;

  SELECT p.self_rating_mandatory INTO v_req FROM pms_policies p
    JOIN pms_periods pe ON pe.policy_id=p.id WHERE pe.id = NEW.period_id;
  IF NOT COALESCE(v_req,true) THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_self FROM pms_reviews
   WHERE period_id=NEW.period_id AND employee_id=NEW.employee_id
     AND rater_role='SELF' AND submitted=true;
  IF v_self = 0 THEN
    RAISE EXCEPTION 'Self rating must be submitted before manager rating';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pms_self_first ON pms_reviews;
CREATE TRIGGER trg_pms_self_first BEFORE INSERT OR UPDATE ON pms_reviews
FOR EACH ROW EXECUTE FUNCTION pms_check_self_first();

-- =====================================================================
-- VIEWS
-- =====================================================================

-- Employment flag: drives exit / notice highlighting everywhere
CREATE OR REPLACE VIEW vw_pms_employment_flag AS
SELECT e.id AS employee_id, e.emp_code AS employee_code, e.full_name AS employee_name,
       e.company_doj, e.date_of_leaving, e.date_of_resignation,
       CASE
         WHEN e.date_of_leaving IS NOT NULL AND e.date_of_leaving <= CURRENT_DATE THEN 'EXITED'
         WHEN e.date_of_leaving IS NOT NULL AND e.date_of_leaving  > CURRENT_DATE THEN 'NOTICE_PERIOD'
         WHEN e.date_of_resignation IS NOT NULL                                      THEN 'NOTICE_PERIOD'
         WHEN e.company_doj > CURRENT_DATE - 30                               THEN 'NEW_JOINER'
         ELSE 'ACTIVE'
       END AS employment_flag,
       e.date_of_leaving AS last_working_day,
       CASE WHEN e.date_of_leaving IS NOT NULL
            THEN e.date_of_leaving - CURRENT_DATE END AS days_to_lwd
FROM employees e;

-- Admin fill-status tracker (the main export)
CREATE OR REPLACE VIEW vw_pms_fill_status AS
SELECT o.period_id, pe.period_code, o.company_id,
       e.emp_code AS employee_code, e.full_name AS employee_name, o.department_id, o.grade,
       o.rm_l1_id, o.rm_l2_id, o.hod_id,
       f.employment_flag, f.last_working_day,
       COALESCE(g.kra_count,0)  AS kra_count,
       COALESCE(g.total_wt,0)   AS total_weightage,
       CASE WHEN o121.id IS NOT NULL THEN 'DONE' ELSE 'PENDING' END AS one_to_one_status,
       CASE
         WHEN COALESCE(g.kra_count,0) = 0                       THEN 'NOT_STARTED'
         WHEN o.workflow_status IN ('KRA_DRAFT','SELF_DRAFT')   THEN 'DRAFT_SAVED'
         WHEN o.workflow_status = 'SELF_SUBMITTED'              THEN 'SUBMITTED'
         WHEN o.workflow_status IN ('RM_L1_DONE','RM_L2_DONE')  THEN 'IN_REVIEW'
         WHEN o.workflow_status IN ('FINALISED','PUBLISHED','ACKNOWLEDGED') THEN 'FINALISED'
         ELSE 'NOT_STARTED' END AS fill_status,
       o.workflow_status, o.self_score, o.final_score, o.final_rating, o.final_rating_code,
       o.finalised_by_role, o.finalised_at, o.rating_source, o.updated_at AS last_action_at
FROM pms_overall_rating o
JOIN pms_periods pe ON pe.id = o.period_id
JOIN employees e    ON e.id  = o.employee_id
LEFT JOIN vw_pms_employment_flag f ON f.employee_id = o.employee_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS kra_count, SUM(weightage) AS total_wt
  FROM pms_employee_goals WHERE employee_id=o.employee_id AND period_id=o.period_id
) g ON true
LEFT JOIN LATERAL (
  SELECT id FROM pms_one_to_one
  WHERE employee_id=o.employee_id AND period_id=o.period_id
    AND discussion_type='KRA_SETTING' AND employee_ack AND manager_ack LIMIT 1
) o121 ON true;

-- Employee-wise KRA detail (Report #1 — the main export)
CREATE OR REPLACE VIEW vw_pms_kra_detail AS
SELECT pe.period_code, o.company_id, e.emp_code AS employee_code, e.full_name AS employee_name,
       o.department_id, o.grade, o.rm_l1_id, o.rm_l2_id, o.hod_id,
       g.seq_no, g.kra_title, g.kpi_metric, g.target_value, g.category, g.weightage,
       rs.achievement_value,
       rs.rating  AS self_rating,
       r1.rating  AS rm_l1_rating,
       r2.rating  AS rm_l2_rating,
       rh.rating  AS hod_rating,
       COALESCE(rh.rating, r2.rating, r1.rating) AS final_kra_rating,
       ROUND(COALESCE(rh.rating, r2.rating, r1.rating) * g.weightage / 100, 3) AS weighted_contribution,
       rs.comments AS self_comment,
       COALESCE(rh.comments, r2.comments, r1.comments) AS manager_comment,
       o.final_score, o.final_rating, o.final_rating_code
FROM pms_employee_goals g
JOIN pms_periods pe        ON pe.id = g.period_id
JOIN employees e           ON e.id  = g.employee_id
LEFT JOIN pms_overall_rating o ON o.employee_id=g.employee_id AND o.period_id=g.period_id
LEFT JOIN pms_reviews rs ON rs.goal_id=g.id AND rs.rater_role='SELF'
LEFT JOIN pms_reviews r1 ON r1.goal_id=g.id AND r1.rater_role='RM_L1'
LEFT JOIN pms_reviews r2 ON r2.goal_id=g.id AND r2.rater_role='RM_L2'
LEFT JOIN pms_reviews rh ON rh.goal_id=g.id AND rh.rater_role='HOD';

-- Employee analytics: self vs final gap per KRA
CREATE OR REPLACE VIEW vw_pms_gap_analysis AS
SELECT period_code, employee_code, employee_name, seq_no, kra_title, category, weightage,
       self_rating, final_kra_rating,
       (final_kra_rating - self_rating) AS gap,
       CASE WHEN ABS(COALESCE(final_kra_rating,0) - COALESCE(self_rating,0)) >= 2
            THEN 'MAJOR_GAP'
            WHEN ABS(COALESCE(final_kra_rating,0) - COALESCE(self_rating,0)) = 1
            THEN 'MINOR_GAP' ELSE 'ALIGNED' END AS gap_flag
FROM vw_pms_kra_detail;

-- Category-wise strength (employee / dept analytics)
CREATE OR REPLACE VIEW vw_pms_category_analysis AS
SELECT period_code, company_id, department_id, employee_code, employee_name, category,
       SUM(weightage)                                            AS category_weightage,
       ROUND(SUM(final_kra_rating * weightage)/NULLIF(SUM(weightage),0),2) AS category_score
FROM vw_pms_kra_detail
GROUP BY period_code, company_id, department_id, employee_code, employee_name, category;

-- Period-on-period trend
CREATE OR REPLACE VIEW vw_pms_trend AS
SELECT o.employee_id, e.emp_code AS employee_code, e.full_name AS employee_name, o.department_id,
       pe.financial_year, pe.period_code, pe.period_no, pe.period_start,
       o.self_score, o.final_score, o.final_rating,
       LAG(o.final_score) OVER (PARTITION BY o.employee_id ORDER BY pe.period_start) AS prev_score,
       ROUND(o.final_score - LAG(o.final_score) OVER
             (PARTITION BY o.employee_id ORDER BY pe.period_start), 2) AS delta
FROM pms_overall_rating o
JOIN pms_periods pe ON pe.id = o.period_id
JOIN employees e    ON e.id  = o.employee_id
WHERE o.final_score IS NOT NULL;

-- Exit / notice priority list for RM & HOD
CREATE OR REPLACE VIEW vw_pms_exit_priority AS
SELECT o.period_id, pe.period_code, e.emp_code AS employee_code, e.full_name AS employee_name,
       o.department_id, o.rm_l1_id, o.rm_l2_id, o.hod_id,
       f.employment_flag, f.last_working_day, f.days_to_lwd,
       o.workflow_status,
       CASE WHEN o.workflow_status NOT IN ('FINALISED','PUBLISHED','ACKNOWLEDGED')
              AND f.employment_flag IN ('NOTICE_PERIOD','EXITED')
            THEN true ELSE false END AS action_required
FROM pms_overall_rating o
JOIN pms_periods pe ON pe.id = o.period_id
JOIN employees e    ON e.id  = o.employee_id
JOIN vw_pms_employment_flag f ON f.employee_id = o.employee_id
WHERE f.employment_flag IN ('NOTICE_PERIOD','EXITED');

-- Manager rating behaviour (informational — no forced curve)
CREATE OR REPLACE VIEW vw_pms_manager_behaviour AS
SELECT period_id, rm_l1_id AS manager_id, COUNT(*) AS team_size,
       ROUND(AVG(final_score),2) AS avg_score,
       COUNT(*) FILTER (WHERE final_rating >= 4) AS high_count,
       ROUND(COUNT(*) FILTER (WHERE final_rating >= 4)*100.0/NULLIF(COUNT(*),0),1) AS high_pct,
       ROUND(AVG(self_vs_final_gap),2) AS avg_self_gap,
       CASE WHEN COUNT(*) FILTER (WHERE final_rating >= 4)*100.0/NULLIF(COUNT(*),0) > 60 THEN 'LENIENT'
            WHEN AVG(final_score) < 2.5 THEN 'HARSH' ELSE 'NORMAL' END AS behaviour_flag
FROM pms_overall_rating
WHERE final_rating IS NOT NULL AND is_eligible
GROUP BY period_id, rm_l1_id;

-- Recognition register
CREATE OR REPLACE VIEW vw_pms_recognition AS
SELECT pe.period_code, e.emp_code AS employee_code, e.full_name AS employee_name, b.benefit_type, b.benefit_note,
       b.attachment_url, b.awarded_at,
       f.appreciation_remark, f.improvement_feedback
FROM pms_additional_benefits b
JOIN pms_periods pe ON pe.id = b.period_id
JOIN employees e    ON e.id  = b.employee_id
LEFT JOIN pms_feedback f ON f.employee_id=b.employee_id AND f.period_id=b.period_id;

-- PIP register (full trail)
CREATE OR REPLACE VIEW vw_pms_pip_register AS
SELECT p.id AS pip_id, e.emp_code AS employee_code, e.full_name AS employee_name, p.trigger_rating,
       p.requested_by, p.requested_by_role, p.requested_at, p.request_reason,
       p.hr_status, p.hr_reviewed_by, p.hr_reviewed_at,
       p.pip_start_date, p.pip_end_date, p.review_frequency,
       p.initiated_by, p.initiated_at,
       p.employee_ack, p.employee_ack_at,
       (SELECT COUNT(*) FROM pms_pip_areas   a WHERE a.pip_id=p.id AND a.is_retained) AS area_count,
       (SELECT COUNT(*) FROM pms_pip_reviews r WHERE r.pip_id=p.id)                   AS reviews_done,
       p.final_outcome, p.outcome_date, p.status
FROM pms_pip p JOIN employees e ON e.id = p.employee_id;

-- =====================================================================
-- RLS (EZER standard pattern)
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pms_policies','pms_periods','pms_rating_scale','pms_kra_master','pms_employee_goals',
    'pms_one_to_one','pms_reviews','pms_overall_rating','pms_feedback',
    'pms_additional_benefits','pms_pip','pms_pip_areas','pms_pip_reviews',
    'pms_rating_upload_log','pms_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON %I;', t, t);
    EXECUTE format(
      'CREATE POLICY %I_all ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;

-- =====================================================================
-- SEED — 5-point scale, no payout columns
-- =====================================================================
-- INSERT INTO pms_rating_scale
--  (company_id, policy_id, rating_value, rating_code, rating_label, score_from, score_to,
--   min_comment_chars, improvement_feedback_mandatory, allows_pip_request, colour_hex, sort_order)
-- VALUES
--  ('<co>','<pol>',5,'O' ,'Outstanding'          ,4.51,5.00,200,false,false,'#16A34A',1),
--  ('<co>','<pol>',4,'EE','Exceeds Expectations' ,3.51,4.50,100,false,false,'#7C3AED',2),
--  ('<co>','<pol>',3,'ME','Meets Expectations'   ,2.51,3.50, 50,false,false,'#3C3489',3),
--  ('<co>','<pol>',2,'NI','Needs Improvement'    ,1.51,2.50,200,true ,true ,'#F59E0B',4),
--  ('<co>','<pol>',1,'U' ,'Unsatisfactory'       ,1.00,1.50,200,true ,true ,'#DC2626',5);

-- Generate quarterly periods for FY 2026-27:
-- SELECT pms_generate_periods('<policy_id>', '2026-27', '2026-04-01');

-- =====================================================================
-- END 079 v2
-- =====================================================================
