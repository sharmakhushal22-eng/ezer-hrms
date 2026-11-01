-- =====================================================================
-- 207_lms_engine.sql — EZER Learn: the set-based work. Needs 206. Safe to run twice.
--
-- The rules a person experiences (what unlocks, what counts as complete, what a quiz
-- scores) live in lib/lms/core.ts, where they are pure and unit-tested. These functions
-- are the work that has to happen across thousands of rows at once: matching an audience,
-- enrolling it, sweeping for new matches, cloning a version, aggregating a dashboard.
--
-- A serverless function cannot loop over 2,000 employees inside a request, and a partial
-- run would leave half a company assigned. One statement in one transaction does neither.
--
-- Every function is SECURITY INVOKER and callable by service_role only (section at the
-- end). PostgREST exposes public functions as RPC, and PUBLIC holds EXECUTE by default, so
-- without that REVOKE the anon key could enrol people.
-- =====================================================================

-- The last moment of a calendar day in India. Due dates are days to the people who set them.
CREATE OR REPLACE FUNCTION lms_day_end(p_day DATE) RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((p_day + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 second'
$$;

CREATE OR REPLACE FUNCTION lms_today() RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Everybody beneath a manager, following L1 downward.
CREATE OR REPLACE FUNCTION lms_reports_of(p_manager UUID) RETURNS SETOF UUID
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE t(id, depth) AS (
    SELECT e.id, 1 FROM employees e WHERE e.l1_manager_id = p_manager
    UNION
    SELECT e.id, t.depth + 1 FROM employees e JOIN t ON e.l1_manager_id = t.id WHERE t.depth < 12
  )
  SELECT DISTINCT id FROM t WHERE id <> p_manager
$$;

-- Does one employee match one target row?
CREATE OR REPLACE FUNCTION lms_target_hit(e employees, p_kind TEXT, p_value TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(CASE p_kind
    WHEN 'COMPANY'             THEN true
    WHEN 'EMPLOYEE'            THEN e.id::text = p_value
    WHEN 'DEPARTMENT'          THEN e.department_id::text = p_value
    WHEN 'LOCATION'            THEN e.location_id::text = p_value
    WHEN 'DESIGNATION'         THEN lower(trim(e.designation)) = lower(trim(p_value))
    WHEN 'TEAM'                THEN lower(trim(e.team_name)) = lower(trim(p_value))
    WHEN 'GRADE'               THEN lower(trim(e.grade)) = lower(trim(p_value))
    WHEN 'EMPLOYMENT_TYPE'     THEN lower(trim(e.employment_type)) = lower(trim(p_value))
    WHEN 'EMPLOYEE_CATEGORY'   THEN lower(trim(e.employee_category)) = lower(trim(p_value))
    WHEN 'CONFIRMATION_STATUS' THEN lower(trim(e.confirmation_status)) = lower(trim(p_value))
    WHEN 'MANAGER'             THEN e.id IN (SELECT lms_reports_of(p_value::uuid))
    ELSE false
  END, false)
$$;

-- The audience, from target rows held as JSON so the assign form can preview a count
-- before anything is saved. Same kind ORs, different kinds AND, EMPLOYEE rows always add,
-- exclude rows always remove (206, lms_assignment_targets).
CREATE OR REPLACE FUNCTION lms_match_employees(p_company UUID, p_targets JSONB, p_joined_since DATE DEFAULT NULL)
RETURNS SETOF UUID LANGUAGE sql STABLE AS $$
  WITH t AS (
    SELECT x.kind, COALESCE(x.value, '') AS value, COALESCE(x.exclude, false) AS exclude
      FROM jsonb_to_recordset(COALESCE(p_targets, '[]'::jsonb)) AS x(kind TEXT, value TEXT, exclude BOOLEAN)
  ),
  grp AS (SELECT DISTINCT kind FROM t WHERE NOT exclude AND kind <> 'EMPLOYEE')
  SELECT e.id
    FROM employees e
   WHERE e.company_id = p_company
     AND e.employment_status = 'Active'
     AND e.is_test IS NOT TRUE
     AND (p_joined_since IS NULL OR COALESCE(e.company_doj, e.group_doj) >= p_joined_since)
     AND (
       EXISTS (SELECT 1 FROM t WHERE t.kind = 'EMPLOYEE' AND NOT t.exclude AND t.value = e.id::text)
       OR (
         EXISTS (SELECT 1 FROM grp)
         AND NOT EXISTS (
           SELECT 1 FROM grp g
            WHERE NOT EXISTS (
              SELECT 1 FROM t
               WHERE t.kind = g.kind AND NOT t.exclude AND lms_target_hit(e, t.kind, t.value)
            )
         )
       )
     )
     AND NOT EXISTS (SELECT 1 FROM t WHERE t.exclude AND lms_target_hit(e, t.kind, t.value))
$$;

-- Pre-joining candidates have no employee row, so only what is known about them can be
-- matched: everyone, department or designation.
CREATE OR REPLACE FUNCTION lms_match_candidates(p_company UUID, p_targets JSONB, p_learner UUID DEFAULT NULL)
RETURNS SETOF UUID LANGUAGE sql STABLE AS $$
  WITH t AS (
    SELECT x.kind, COALESCE(x.value, '') AS value, COALESCE(x.exclude, false) AS exclude
      FROM jsonb_to_recordset(COALESCE(p_targets, '[]'::jsonb)) AS x(kind TEXT, value TEXT, exclude BOOLEAN)
  )
  SELECT l.id
    FROM lms_learners l
   WHERE l.company_id = p_company AND l.kind = 'CANDIDATE' AND l.status = 'ACTIVE'
     AND (p_learner IS NULL OR l.id = p_learner)
     AND EXISTS (
       SELECT 1 FROM t WHERE NOT t.exclude AND (
         t.kind = 'COMPANY'
         OR (t.kind = 'DEPARTMENT' AND l.department_id::text = t.value)
         OR (t.kind = 'DESIGNATION' AND lower(trim(l.designation)) = lower(trim(t.value)))
       )
     )
$$;

-- A learner row for each employee, refreshed from the master each time so a due date
-- worked out from the joining date reads the current one.
CREATE OR REPLACE FUNCTION lms_ensure_learners(p_company UUID, p_employees UUID[]) RETURNS VOID
LANGUAGE sql AS $$
  INSERT INTO lms_learners (company_id, kind, employee_id, full_name, email, designation, department_id, date_of_joining)
  SELECT e.company_id, 'EMPLOYEE', e.id, e.full_name,
         COALESCE(NULLIF(e.office_email, ''), NULLIF(e.personal_email, '')),
         e.designation, e.department_id, COALESCE(e.company_doj, e.group_doj)
    FROM employees e
   WHERE e.company_id = p_company AND e.id = ANY(p_employees)
  ON CONFLICT (company_id, employee_id) DO UPDATE SET
    full_name = EXCLUDED.full_name, email = EXCLUDED.email, designation = EXCLUDED.designation,
    department_id = EXCLUDED.department_id, date_of_joining = EXCLUDED.date_of_joining
$$;

CREATE OR REPLACE FUNCTION lms_due_at(a lms_assignments, p_due_days INTEGER, p_joining DATE) RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE AS $$
  SELECT CASE a.due_mode
    WHEN 'FIXED'        THEN CASE WHEN a.due_date IS NOT NULL THEN lms_day_end(a.due_date) END
    WHEN 'AFTER_ASSIGN' THEN CASE WHEN p_due_days IS NOT NULL THEN lms_day_end(lms_today() + p_due_days) END
    WHEN 'AFTER_JOIN'   THEN CASE WHEN p_due_days IS NOT NULL THEN lms_day_end(COALESCE(p_joining, lms_today()) + p_due_days) END
    WHEN 'BEFORE_JOIN'  THEN CASE WHEN p_due_days IS NOT NULL THEN lms_day_end(COALESCE(p_joining - p_due_days, lms_today() + p_due_days)) END
    ELSE NULL
  END
$$;

-- Enrol a set of learners in one course under one assignment. The heart of the module.
--
-- Skipped, in order:
--   · a live enrolment on this course already exists (the unique index would refuse it)
--   · this assignment already enrolled them once. Without this, a DYNAMIC retake would
--     re-enrol someone every night as soon as they finished, and a person HR removed
--     would come straight back
--   · a valid completion, a failure awaiting HR, or a waiver exists, unless the assignment
--     is a deliberate retake (include_completed)
CREATE OR REPLACE FUNCTION lms_enrol_course(a lms_assignments, p_course UUID, p_due_days INTEGER, p_learners UUID[], p_path UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_new    INTEGER := 0;
  v_upgrad INTEGER := 0;
  v_title  TEXT;
  v_ver    UUID;
BEGIN
  SELECT c.title, c.published_version_id INTO v_title, v_ver
    FROM lms_courses c
   WHERE c.id = p_course AND c.company_id = a.company_id AND c.status = 'PUBLISHED';
  IF v_ver IS NULL THEN RETURN 0; END IF;

  -- Somebody waiting on approval has just been told to do it: the request is moot.
  UPDATE lms_enrollments e
     SET status = 'NOT_STARTED', assignment_id = a.id, mandatory = a.mandatory, priority = a.priority,
         source = 'ASSIGNED', assigned_by_id = a.created_by_id, assigned_by_name = a.created_by_name,
         due_at = lms_due_at(a, p_due_days, l.date_of_joining)
    FROM lms_learners l
   WHERE l.id = e.learner_id AND e.status = 'PENDING_APPROVAL' AND e.course_id = p_course AND e.learner_id = ANY(p_learners);
  GET DIAGNOSTICS v_upgrad = ROW_COUNT;

  WITH ins AS (
    INSERT INTO lms_enrollments (
      company_id, learner_id, course_id, version_id, assignment_id, path_enrollment_id, source,
      mandatory, priority, due_at, cycle_no, assigned_by_id, assigned_by_name)
    SELECT a.company_id, l.id, p_course, v_ver, a.id,
           CASE WHEN p_path IS NOT NULL THEN (
             SELECT pe.id FROM lms_path_enrollments pe
              WHERE pe.learner_id = l.id AND pe.path_id = p_path AND pe.status IN ('NOT_STARTED','IN_PROGRESS') LIMIT 1
           ) END,
           CASE WHEN a.source = 'MANAGER' THEN 'MANAGER'
                WHEN a.source = 'IMPORT'  THEN 'IMPORT'
                WHEN a.include_completed AND EXISTS (SELECT 1 FROM lms_enrollments p WHERE p.learner_id = l.id AND p.course_id = p_course) THEN 'RETAKE'
                ELSE 'ASSIGNED' END,
           a.mandatory, a.priority, lms_due_at(a, p_due_days, l.date_of_joining),
           COALESCE((SELECT max(p.cycle_no) FROM lms_enrollments p WHERE p.learner_id = l.id AND p.course_id = p_course), 0) + 1,
           a.created_by_id, a.created_by_name
      FROM lms_learners l
     WHERE l.id = ANY(p_learners) AND l.company_id = a.company_id AND l.status = 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM lms_enrollments e
          WHERE e.learner_id = l.id AND e.course_id = p_course
            AND (
              e.status IN ('PENDING_APPROVAL','NOT_STARTED','IN_PROGRESS')
              OR e.assignment_id = a.id
              OR (NOT a.include_completed AND e.status IN ('COMPLETED','FAILED','WAIVED')
                  AND (e.expires_at IS NULL OR e.expires_at > now()))
            )
       )
    ON CONFLICT DO NOTHING
    RETURNING id, learner_id, due_at
  ),
  bell AS (
    INSERT INTO ess_notifications (employee_id, category, title, body, link, is_read, notification_code, priority)
    SELECT l.employee_id, 'LMS_ASSIGNED',
           CASE WHEN a.mandatory THEN 'Mandatory training assigned' ELSE 'New learning assigned' END,
           v_title || CASE WHEN i.due_at IS NOT NULL
                           THEN ' · due ' || to_char(i.due_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')
                           ELSE '' END,
           '/ess/learning', false, 'LMS_ASSIGNED', CASE WHEN a.mandatory THEN 'HIGH' ELSE 'NORMAL' END
      FROM ins i JOIN lms_learners l ON l.id = i.learner_id
     WHERE l.employee_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM ins;

  RETURN v_new + v_upgrad;
END $$;

-- Every item of an assignment, for a set of learners. A path enrols the learner in each of
-- its courses straight away and locks them in order on the way out (lib/lms/core.ts), so
-- nothing has to fire when a course finishes, and a report sees the whole programme.
CREATE OR REPLACE FUNCTION lms_enrol_learners(p_assignment UUID, p_learners UUID[]) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  a      lms_assignments;
  it     lms_assignment_items;
  pi     lms_path_items;
  v_days INTEGER;
  v_new  INTEGER := 0;
BEGIN
  SELECT * INTO a FROM lms_assignments WHERE id = p_assignment;
  IF a.id IS NULL OR a.status <> 'ACTIVE' THEN RETURN 0; END IF;

  FOR it IN SELECT * FROM lms_assignment_items WHERE assignment_id = p_assignment ORDER BY position LOOP
    v_days := COALESCE(it.due_days, a.due_days);
    IF it.course_id IS NOT NULL THEN
      v_new := v_new + lms_enrol_course(a, it.course_id, v_days, p_learners);
    ELSE
      INSERT INTO lms_path_enrollments (company_id, learner_id, path_id, assignment_id, mandatory, due_at)
      SELECT a.company_id, l.id, it.path_id, a.id, a.mandatory, lms_due_at(a, v_days, l.date_of_joining)
        FROM lms_learners l
        JOIN lms_paths p ON p.id = it.path_id AND p.status = 'PUBLISHED'
       WHERE l.id = ANY(p_learners) AND l.company_id = a.company_id AND l.status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM lms_path_enrollments pe
            WHERE pe.learner_id = l.id AND pe.path_id = it.path_id
              AND (pe.status IN ('NOT_STARTED','IN_PROGRESS') OR pe.assignment_id = a.id
                   OR (NOT a.include_completed AND pe.status IN ('COMPLETED','WAIVED')))
         )
      ON CONFLICT DO NOTHING;
      FOR pi IN SELECT * FROM lms_path_items WHERE path_id = it.path_id ORDER BY position LOOP
        v_new := v_new + lms_enrol_course(a, pi.course_id, v_days, p_learners, it.path_id);
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_new;
END $$;

-- Apply one assignment. p_employee narrows it to one person (the new-joiner hook).
CREATE OR REPLACE FUNCTION lms_apply_assignment(p_assignment UUID, p_employee UUID DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  a          lms_assignments;
  v_targets  JSONB;
  v_since    DATE;
  v_emps     UUID[];
  v_learners UUID[];
  v_new      INTEGER;
BEGIN
  SELECT * INTO a FROM lms_assignments WHERE id = p_assignment;
  IF a.id IS NULL THEN RAISE EXCEPTION 'LMS: assignment % not found', p_assignment; END IF;
  IF a.status <> 'ACTIVE' THEN RETURN jsonb_build_object('matched', 0, 'enrolled', 0, 'status', a.status); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', t.kind, 'value', t.value, 'exclude', t.exclude)), '[]'::jsonb)
    INTO v_targets FROM lms_assignment_targets t WHERE t.assignment_id = p_assignment;

  IF a.trigger_type = 'PREBOARD' THEN
    SELECT array_agg(x) INTO v_learners FROM lms_match_candidates(a.company_id, v_targets) AS x;
  ELSE
    v_since := CASE WHEN a.trigger_type = 'ON_JOIN' THEN lms_today() - a.join_window_days END;
    SELECT array_agg(x) INTO v_emps FROM lms_match_employees(a.company_id, v_targets, v_since) AS x
     WHERE p_employee IS NULL OR x = p_employee;
    IF v_emps IS NOT NULL THEN
      PERFORM lms_ensure_learners(a.company_id, v_emps);
      SELECT array_agg(l.id) INTO v_learners FROM lms_learners l
       WHERE l.company_id = a.company_id AND l.employee_id = ANY(v_emps);
    END IF;
  END IF;

  IF v_learners IS NULL THEN
    UPDATE lms_assignments SET last_applied_at = now() WHERE id = p_assignment;
    RETURN jsonb_build_object('matched', 0, 'enrolled', 0);
  END IF;

  v_new := lms_enrol_learners(p_assignment, v_learners);
  UPDATE lms_assignments
     SET last_applied_at = now(), enrolled_count = enrolled_count + v_new
   WHERE id = p_assignment;
  RETURN jsonb_build_object('matched', cardinality(v_learners), 'enrolled', v_new);
END $$;

-- The new-joiner hook: every ON_JOIN template of the company that matches this employee.
CREATE OR REPLACE FUNCTION lms_on_join(p_employee UUID) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_company UUID;
  a         lms_assignments;
  v_new     INTEGER := 0;
BEGIN
  SELECT company_id INTO v_company FROM employees WHERE id = p_employee;
  IF v_company IS NULL THEN RETURN 0; END IF;
  FOR a IN SELECT * FROM lms_assignments
            WHERE company_id = v_company AND status = 'ACTIVE' AND trigger_type IN ('ON_JOIN','DYNAMIC') LOOP
    v_new := v_new + COALESCE((lms_apply_assignment(a.id, p_employee)->>'enrolled')::int, 0);
  END LOOP;
  RETURN v_new;
END $$;

-- A candidate joins. Their learner row becomes the employee's, so every enrolment and
-- result simply stays where it is. If the employee already has a learner row of their
-- own (HR assigned something first), the candidate's records move onto it.
CREATE OR REPLACE FUNCTION lms_convert_candidate(p_learner UUID, p_employee UUID) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  l         lms_learners;
  e         employees;
  v_existing UUID;
BEGIN
  SELECT * INTO l FROM lms_learners WHERE id = p_learner;
  SELECT * INTO e FROM employees WHERE id = p_employee;
  IF l.id IS NULL OR e.id IS NULL THEN RETURN jsonb_build_object('converted', false, 'why', 'not found'); END IF;
  IF l.kind = 'EMPLOYEE' THEN RETURN jsonb_build_object('converted', false, 'why', 'already an employee'); END IF;
  IF l.company_id <> e.company_id THEN RETURN jsonb_build_object('converted', false, 'why', 'different company'); END IF;

  SELECT id INTO v_existing FROM lms_learners
   WHERE company_id = e.company_id AND employee_id = p_employee AND id <> p_learner;

  IF v_existing IS NOT NULL THEN
    -- Drop what would collide with a live enrolment the employee already holds.
    DELETE FROM lms_enrollments c
     WHERE c.learner_id = p_learner AND c.status IN ('PENDING_APPROVAL','NOT_STARTED')
       AND EXISTS (SELECT 1 FROM lms_enrollments x WHERE x.learner_id = v_existing AND x.course_id = c.course_id
                     AND x.status IN ('PENDING_APPROVAL','NOT_STARTED','IN_PROGRESS'));
    UPDATE lms_enrollments c SET status = 'CANCELLED', decision_note = 'Superseded when the candidate joined'
     WHERE c.learner_id = p_learner AND c.status = 'IN_PROGRESS'
       AND EXISTS (SELECT 1 FROM lms_enrollments x WHERE x.learner_id = v_existing AND x.course_id = c.course_id
                     AND x.status IN ('PENDING_APPROVAL','NOT_STARTED','IN_PROGRESS'));
    UPDATE lms_enrollments      SET learner_id = v_existing WHERE learner_id = p_learner;
    UPDATE lms_path_enrollments SET learner_id = v_existing WHERE learner_id = p_learner;
    UPDATE lms_certificates     SET learner_id = v_existing WHERE learner_id = p_learner;
    UPDATE lms_learners SET status = 'REVOKED', converted_at = now(), employee_id = NULL WHERE id = p_learner;
    UPDATE lms_candidate_access SET revoked_at = now(), session_version = session_version + 1 WHERE learner_id = p_learner;
    UPDATE lms_learners SET onboarding_candidate_id = COALESCE(onboarding_candidate_id, l.onboarding_candidate_id),
                            recruit_candidate_id = COALESCE(recruit_candidate_id, l.recruit_candidate_id),
                            converted_at = now()
     WHERE id = v_existing;
    RETURN jsonb_build_object('converted', true, 'learner_id', v_existing, 'merged', true);
  END IF;

  UPDATE lms_learners
     SET kind = 'EMPLOYEE', employee_id = p_employee, converted_at = now(), full_name = e.full_name,
         email = COALESCE(NULLIF(e.office_email, ''), NULLIF(e.personal_email, ''), email),
         designation = e.designation, department_id = e.department_id,
         date_of_joining = COALESCE(e.company_doj, e.group_doj, date_of_joining)
   WHERE id = p_learner;
  -- The pre-joining link stops working the moment they have a real login.
  UPDATE lms_candidate_access SET revoked_at = now(), session_version = session_version + 1 WHERE learner_id = p_learner;
  RETURN jsonb_build_object('converted', true, 'learner_id', p_learner, 'merged', false);
END $$;

-- Deep copy of a version into a course: the same course (a new draft) or another
-- company's (group sharing). Each copy remembers its source, which is what lets progress
-- follow a learner from one version to the next. Across companies the file is shared and
-- only its metadata row is duplicated, because the composite keys require a row per tenant.
CREATE OR REPLACE FUNCTION lms_clone_version(p_source UUID, p_course UUID) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  s         lms_course_versions;
  v_company UUID;
  v_no      INTEGER;
  v_new     UUID;
  v_id      UUID;
  m_map     JSONB := '{}';
  q_map     JSONB := '{}';
  a_map     JSONB := '{}';
  r         RECORD;
BEGIN
  SELECT * INTO s FROM lms_course_versions WHERE id = p_source;
  IF s.id IS NULL THEN RAISE EXCEPTION 'LMS: version % not found', p_source; END IF;
  SELECT company_id INTO v_company FROM lms_courses WHERE id = p_course;
  IF v_company IS NULL THEN RAISE EXCEPTION 'LMS: course % not found', p_course; END IF;
  SELECT COALESCE(max(version_no), 0) + 1 INTO v_no FROM lms_course_versions WHERE course_id = p_course;

  INSERT INTO lms_course_versions (company_id, course_id, version_no, order_mode, completion_mode, completion_pct,
                                   require_all_quizzes, require_final, min_overall_pct)
  VALUES (v_company, p_course, v_no, s.order_mode, s.completion_mode, s.completion_pct,
          s.require_all_quizzes, s.require_final, s.min_overall_pct)
  RETURNING id INTO v_new;

  IF v_company <> s.company_id THEN
    FOR r IN
      SELECT DISTINCT a.* FROM lms_assets a
       WHERE a.id IN (SELECT asset_id FROM lms_lessons WHERE version_id = p_source AND asset_id IS NOT NULL
                      UNION
                      SELECT res.asset_id FROM lms_lesson_resources res
                        JOIN lms_lessons ls ON ls.id = res.lesson_id
                       WHERE ls.version_id = p_source AND res.asset_id IS NOT NULL)
    LOOP
      INSERT INTO lms_assets (company_id, kind, provider, storage_path, external_ref, poster_path, original_name,
                              mime_type, size_bytes, duration_s, status)
      VALUES (v_company, r.kind, r.provider, r.storage_path, r.external_ref, r.poster_path, r.original_name,
              r.mime_type, r.size_bytes, r.duration_s, r.status)
      RETURNING id INTO v_id;
      a_map := a_map || jsonb_build_object(r.id::text, v_id);
    END LOOP;
  END IF;

  FOR r IN SELECT * FROM lms_modules WHERE version_id = p_source ORDER BY position LOOP
    INSERT INTO lms_modules (company_id, version_id, title, summary, position, unlock_after_days, source_module_id)
    VALUES (v_company, v_new, r.title, r.summary, r.position, r.unlock_after_days, r.id)
    RETURNING id INTO v_id;
    m_map := m_map || jsonb_build_object(r.id::text, v_id);
  END LOOP;

  FOR r IN SELECT * FROM lms_quizzes WHERE version_id = p_source LOOP
    INSERT INTO lms_quizzes (company_id, version_id, title, instructions, pass_pct, max_attempts, cooldown_minutes,
                             time_limit_minutes, shuffle_questions, shuffle_options, draw_count, show_answers,
                             on_exhausted, source_quiz_id)
    VALUES (v_company, v_new, r.title, r.instructions, r.pass_pct, r.max_attempts, r.cooldown_minutes,
            r.time_limit_minutes, r.shuffle_questions, r.shuffle_options, r.draw_count, r.show_answers,
            r.on_exhausted, r.id)
    RETURNING id INTO v_id;
    q_map := q_map || jsonb_build_object(r.id::text, v_id);
    INSERT INTO lms_questions (company_id, quiz_id, kind, prompt, explanation, marks, position, options, accepted, partial_credit)
    SELECT v_company, v_id, kind, prompt, explanation, marks, position, options, accepted, partial_credit
      FROM lms_questions WHERE quiz_id = r.id;
  END LOOP;

  FOR r IN SELECT * FROM lms_lessons WHERE version_id = p_source ORDER BY position LOOP
    INSERT INTO lms_lessons (company_id, version_id, module_id, title, summary, kind, position, is_required, is_final,
                             is_preview, est_minutes, asset_id, external_url, body, media_pct, allow_skip_ahead,
                             min_seconds, require_ack, ack_text, quiz_id, quiz_required, source_lesson_id)
    VALUES (v_company, v_new, (m_map->>r.module_id::text)::uuid, r.title, r.summary, r.kind, r.position, r.is_required,
            r.is_final, r.is_preview, r.est_minutes, COALESCE((a_map->>r.asset_id::text)::uuid, r.asset_id),
            r.external_url, r.body, r.media_pct, r.allow_skip_ahead, r.min_seconds, r.require_ack, r.ack_text,
            (q_map->>r.quiz_id::text)::uuid, r.quiz_required, r.id)
    RETURNING id INTO v_id;
    INSERT INTO lms_lesson_resources (company_id, lesson_id, title, asset_id, url, position)
    SELECT v_company, v_id, res.title, COALESCE((a_map->>res.asset_id::text)::uuid, res.asset_id), res.url, res.position
      FROM lms_lesson_resources res WHERE res.lesson_id = r.id;
  END LOOP;

  RETURN v_new;
END $$;

-- Make a version the live one, atomically. Learners who have not started lose nothing by
-- moving, so they move. In-progress learners stay on what they began and completers keep
-- their record; HR can pull in-progress learners across with lms_move_in_progress.
CREATE OR REPLACE FUNCTION lms_publish_version(p_version UUID, p_by TEXT) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v      lms_course_versions;
  v_moved INTEGER;
BEGIN
  SELECT * INTO v FROM lms_course_versions WHERE id = p_version;
  IF v.id IS NULL THEN RAISE EXCEPTION 'LMS: version % not found', p_version; END IF;
  IF v.status NOT IN ('DRAFT','IN_REVIEW') THEN RAISE EXCEPTION 'LMS: version % is already %', p_version, v.status; END IF;

  UPDATE lms_course_versions SET status = 'SUPERSEDED' WHERE course_id = v.course_id AND status = 'PUBLISHED';
  UPDATE lms_course_versions SET status = 'PUBLISHED', published_at = now(), published_by_name = p_by WHERE id = p_version;
  UPDATE lms_courses SET status = 'PUBLISHED', published_version_id = p_version, publish_at = NULL, archived_at = NULL
   WHERE id = v.course_id;
  UPDATE lms_enrollments SET version_id = p_version
   WHERE course_id = v.course_id AND status IN ('PENDING_APPROVAL','NOT_STARTED') AND version_id <> p_version;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END $$;

-- Pull in-progress learners onto the live version, carrying their lesson progress across
-- through source_lesson_id (followed through however many versions they are behind).
-- Progress on a lesson the new version dropped goes with it; quiz attempts stay as history.
CREATE OR REPLACE FUNCTION lms_move_in_progress(p_course UUID) RETURNS SETOF UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_live UUID;
BEGIN
  SELECT published_version_id INTO v_live FROM lms_courses WHERE id = p_course;
  IF v_live IS NULL THEN RETURN; END IF;

  CREATE TEMP TABLE IF NOT EXISTS lms_tmp_map (old_id UUID, new_id UUID) ON COMMIT DROP;
  TRUNCATE lms_tmp_map;
  WITH RECURSIVE anc AS (
    SELECT l.id AS new_id, l.source_lesson_id AS old_id
      FROM lms_lessons l WHERE l.version_id = v_live AND l.source_lesson_id IS NOT NULL
    UNION
    SELECT a.new_id, l.source_lesson_id
      FROM anc a JOIN lms_lessons l ON l.id = a.old_id WHERE l.source_lesson_id IS NOT NULL
  )
  INSERT INTO lms_tmp_map SELECT old_id, new_id FROM anc;

  CREATE TEMP TABLE IF NOT EXISTS lms_tmp_moved (id UUID) ON COMMIT DROP;
  TRUNCATE lms_tmp_moved;
  WITH upd AS (
    UPDATE lms_enrollments SET version_id = v_live, last_lesson_id = NULL
     WHERE course_id = p_course AND status = 'IN_PROGRESS' AND version_id <> v_live
    RETURNING id
  )
  INSERT INTO lms_tmp_moved SELECT id FROM upd;

  UPDATE lms_lesson_progress p SET lesson_id = m.new_id
    FROM lms_tmp_map m
   WHERE p.lesson_id = m.old_id AND p.enrollment_id IN (SELECT id FROM lms_tmp_moved);
  DELETE FROM lms_lesson_progress p
   WHERE p.enrollment_id IN (SELECT id FROM lms_tmp_moved)
     AND p.lesson_id NOT IN (SELECT id FROM lms_lessons WHERE version_id = v_live);

  RETURN QUERY SELECT id FROM lms_tmp_moved;
END $$;

-- The nightly pass. Each step is isolated so one bad assignment cannot stop the rest.
CREATE OR REPLACE FUNCTION lms_daily_sweep() RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  a          lms_assignments;
  v_applied  INTEGER := 0;
  v_enrolled INTEGER := 0;
  v_errors   JSONB := '[]';
  v_renewed  INTEGER;
  v_lapsed   INTEGER;
  v_left     INTEGER;
  v_retired  INTEGER;
  v_published INTEGER := 0;
  v          RECORD;
BEGIN
  -- Scheduled publishing.
  FOR v IN
    SELECT cv.id, c.created_by_name
      FROM lms_courses c
      JOIN lms_course_versions cv ON cv.course_id = c.id AND cv.status IN ('DRAFT','IN_REVIEW')
     WHERE c.publish_at IS NOT NULL AND c.publish_at <= now() AND c.status <> 'ARCHIVED'
       -- A scheduled publish must have passed the same checks as a manual one; the
       -- publish route sets publish_at only after they pass.
       AND EXISTS (SELECT 1 FROM lms_lessons l WHERE l.version_id = cv.id)
  LOOP
    BEGIN
      PERFORM lms_publish_version(v.id, 'Scheduled publish');
      v_published := v_published + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('version', v.id, 'error', SQLERRM);
    END;
  END LOOP;

  -- Course expiry.
  UPDATE lms_courses SET status = 'ARCHIVED', archived_at = now()
   WHERE retire_at IS NOT NULL AND retire_at <= now() AND status = 'PUBLISHED';
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  -- Scheduled assignments fall due.
  UPDATE lms_assignments SET status = 'ACTIVE' WHERE status = 'SCHEDULED' AND start_at <= now();

  -- Anything that keeps applying, plus ONCE assignments whose moment has just arrived.
  FOR a IN
    SELECT * FROM lms_assignments
     WHERE status = 'ACTIVE' AND (trigger_type <> 'ONCE' OR last_applied_at IS NULL)
  LOOP
    BEGIN
      v_enrolled := v_enrolled + COALESCE((lms_apply_assignment(a.id)->>'enrolled')::int, 0);
      v_applied := v_applied + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('assignment', a.id, 'error', SQLERRM);
    END;
  END LOOP;

  -- Renewal: a new cycle opens renew_before_days ahead of the expiry, due on the expiry.
  WITH due AS (
    SELECT e.*, c.published_version_id
      FROM lms_enrollments e
      JOIN lms_courses c ON c.id = e.course_id AND c.status = 'PUBLISHED'
      JOIN lms_learners l ON l.id = e.learner_id AND l.status = 'ACTIVE'
      LEFT JOIN employees emp ON emp.id = l.employee_id
     WHERE e.status IN ('COMPLETED','EXPIRED') AND e.expires_at IS NOT NULL
       AND e.expires_at <= now() + make_interval(days => c.renew_before_days)
       AND (l.employee_id IS NULL OR emp.employment_status = 'Active')
       AND NOT EXISTS (SELECT 1 FROM lms_enrollments n
                        WHERE n.learner_id = e.learner_id AND n.course_id = e.course_id AND n.cycle_no > e.cycle_no)
  ),
  ins AS (
    INSERT INTO lms_enrollments (company_id, learner_id, course_id, version_id, assignment_id, source, mandatory,
                                 priority, due_at, cycle_no, renewal_of, assigned_by_name)
    SELECT company_id, learner_id, course_id, published_version_id, assignment_id, 'RENEWAL', mandatory,
           priority, expires_at, cycle_no + 1, id, 'Recertification'
      FROM due
    ON CONFLICT DO NOTHING
    RETURNING id, learner_id, due_at, course_id
  ),
  bell AS (
    INSERT INTO ess_notifications (employee_id, category, title, body, link, is_read, notification_code, priority)
    SELECT l.employee_id, 'LMS_RENEWAL', 'Recertification due',
           c.title || CASE WHEN i.due_at IS NOT NULL
                           THEN ' · due ' || to_char(i.due_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') ELSE '' END,
           '/ess/learning', false, 'LMS_RENEWAL', 'HIGH'
      FROM ins i JOIN lms_learners l ON l.id = i.learner_id JOIN lms_courses c ON c.id = i.course_id
     WHERE l.employee_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_renewed FROM ins;

  -- A completion past its validity no longer counts.
  UPDATE lms_enrollments SET status = 'EXPIRED' WHERE status = 'COMPLETED' AND expires_at <= now();
  GET DIAGNOSTICS v_lapsed = ROW_COUNT;

  -- Leavers: their open training is no longer anybody's job, and must not sit in a report
  -- as overdue for ever. The history stays.
  UPDATE lms_enrollments e SET status = 'CANCELLED', decision_note = 'Employee left the company'
    FROM lms_learners l JOIN employees emp ON emp.id = l.employee_id
   WHERE l.id = e.learner_id AND emp.employment_status <> 'Active'
     AND e.status IN ('PENDING_APPROVAL','NOT_STARTED','IN_PROGRESS');
  GET DIAGNOSTICS v_left = ROW_COUNT;

  RETURN jsonb_build_object('assignments_applied', v_applied, 'enrolled', v_enrolled, 'published', v_published,
                            'retired', v_retired, 'renewed', v_renewed, 'lapsed', v_lapsed, 'leavers_closed', v_left,
                            'errors', v_errors);
END $$;

-- One row per enrolment with everything a report filters or prints. Filters that are NULL
-- do not apply. CANCELLED and REJECTED are left out unless asked for by status.
CREATE OR REPLACE FUNCTION lms_report_rows(
  p_companies  UUID[],
  p_location   UUID    DEFAULT NULL,
  p_department UUID    DEFAULT NULL,
  p_course     UUID    DEFAULT NULL,
  p_employees  UUID[]  DEFAULT NULL,
  p_status     TEXT    DEFAULT NULL,
  p_mandatory  BOOLEAN DEFAULT NULL,
  p_from       TIMESTAMPTZ DEFAULT NULL,
  p_to         TIMESTAMPTZ DEFAULT NULL,
  p_search     TEXT    DEFAULT NULL
) RETURNS TABLE (
  enrollment_id UUID, company_id UUID, company_code TEXT, learner_id UUID, learner_kind TEXT, employee_id UUID,
  emp_code TEXT, full_name TEXT, department_id UUID, dept_name TEXT, location_id UUID, location_name TEXT,
  designation TEXT, manager_id UUID, manager_name TEXT, course_id UUID, course_code TEXT, course_title TEXT,
  category TEXT, is_compliance BOOLEAN, version_no INTEGER, status TEXT, display_status TEXT, mandatory BOOLEAN,
  source TEXT, cycle_no INTEGER, enrolled_at TIMESTAMPTZ, due_at TIMESTAMPTZ, started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, progress_pct NUMERIC, score_pct NUMERIC, is_overdue BOOLEAN,
  assigned_by TEXT
) LANGUAGE sql STABLE AS $$
  SELECT * FROM (
    SELECT e.id, e.company_id, co.company_code, l.id, l.kind, l.employee_id,
           emp.emp_code, COALESCE(emp.full_name, l.full_name),
           COALESCE(emp.department_id, l.department_id), d.dept_name, emp.location_id, loc.location_name,
           COALESCE(emp.designation, l.designation), emp.l1_manager_id, mgr.full_name,
           c.id, c.code, c.title, cat.name, c.is_compliance, v.version_no, e.status,
           CASE WHEN e.status IN ('NOT_STARTED','IN_PROGRESS') AND e.due_at < now() THEN 'OVERDUE' ELSE e.status END,
           e.mandatory, e.source, e.cycle_no, e.enrolled_at, e.due_at, e.started_at, e.completed_at, e.expires_at,
           e.progress_pct, e.score_pct,
           (e.status IN ('NOT_STARTED','IN_PROGRESS') AND e.due_at < now()),
           e.assigned_by_name
      FROM lms_enrollments e
      JOIN lms_learners l ON l.id = e.learner_id
      JOIN lms_courses c ON c.id = e.course_id
      JOIN lms_course_versions v ON v.id = e.version_id
      JOIN companies co ON co.id = e.company_id
      LEFT JOIN lms_categories cat ON cat.id = c.category_id
      LEFT JOIN employees emp ON emp.id = l.employee_id
      LEFT JOIN employees mgr ON mgr.id = emp.l1_manager_id
      LEFT JOIN departments d ON d.id = COALESCE(emp.department_id, l.department_id)
      LEFT JOIN locations loc ON loc.id = emp.location_id
     WHERE e.company_id = ANY(p_companies)
       AND (p_location IS NULL OR emp.location_id = p_location)
       AND (p_department IS NULL OR COALESCE(emp.department_id, l.department_id) = p_department)
       AND (p_course IS NULL OR e.course_id = p_course)
       AND (p_employees IS NULL OR l.employee_id = ANY(p_employees))
       AND (p_mandatory IS NULL OR e.mandatory = p_mandatory)
       AND (p_from IS NULL OR e.enrolled_at >= p_from)
       AND (p_to IS NULL OR e.enrolled_at < p_to)
       AND (p_search IS NULL OR COALESCE(emp.full_name, l.full_name) ILIKE '%' || p_search || '%'
            OR emp.emp_code ILIKE '%' || p_search || '%' OR c.title ILIKE '%' || p_search || '%')
       AND (p_status IS NOT NULL OR e.status NOT IN ('CANCELLED','REJECTED'))
  ) r (enrollment_id, company_id, company_code, learner_id, learner_kind, employee_id, emp_code, full_name, department_id,
       dept_name, location_id, location_name, designation, manager_id, manager_name, course_id, course_code,
       course_title, category, is_compliance, version_no, status, display_status, mandatory, source, cycle_no,
       enrolled_at, due_at, started_at, completed_at, expires_at, progress_pct, score_pct, is_overdue, assigned_by)
   WHERE p_status IS NULL OR r.display_status = p_status OR r.status = p_status
   ORDER BY r.is_overdue DESC, r.due_at NULLS LAST, r.full_name, r.course_title
$$;

-- The dashboard, as one value. An aggregate rather than rows, because PostgREST caps a
-- row result at 1,000 and a company's enrolments will pass that in its first month.
CREATE OR REPLACE FUNCTION lms_overview(p_companies UUID[], p_location UUID DEFAULT NULL, p_employees UUID[] DEFAULT NULL)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  WITH r AS (SELECT * FROM lms_report_rows(p_companies, p_location, NULL, NULL, p_employees)),
  counted AS (SELECT * FROM r WHERE status NOT IN ('PENDING_APPROVAL','WAIVED'))
  SELECT jsonb_build_object(
    'courses', (SELECT jsonb_build_object(
        'total', count(*),
        'published', count(*) FILTER (WHERE status = 'PUBLISHED'),
        'draft', count(*) FILTER (WHERE status = 'DRAFT'),
        'archived', count(*) FILTER (WHERE status = 'ARCHIVED'),
        'in_review', (SELECT count(*) FROM lms_course_versions v WHERE v.company_id = ANY(p_companies) AND v.status = 'IN_REVIEW'))
      FROM lms_courses WHERE company_id = ANY(p_companies)),
    'paths', (SELECT count(*) FROM lms_paths WHERE company_id = ANY(p_companies) AND status = 'PUBLISHED'),
    'assignments', (SELECT count(*) FROM lms_assignments WHERE company_id = ANY(p_companies) AND status = 'ACTIVE'),
    'learners', (SELECT count(DISTINCT learner_id) FROM counted),
    'enrollments', (SELECT jsonb_build_object(
        'total', count(*),
        'completed', count(*) FILTER (WHERE status IN ('COMPLETED','EXPIRED')),
        'in_progress', count(*) FILTER (WHERE status = 'IN_PROGRESS'),
        'not_started', count(*) FILTER (WHERE status = 'NOT_STARTED'),
        'overdue', count(*) FILTER (WHERE is_overdue),
        'failed', count(*) FILTER (WHERE status = 'FAILED'),
        'pending_approval', (SELECT count(*) FROM r WHERE status = 'PENDING_APPROVAL'))
      FROM counted),
    'compliance', (SELECT jsonb_build_object(
        'assigned', count(*),
        'completed', count(*) FILTER (WHERE status = 'COMPLETED'),
        'overdue', count(*) FILTER (WHERE is_overdue))
      FROM counted WHERE mandatory),
    'by_department', COALESCE((SELECT jsonb_agg(x ORDER BY x.total DESC) FROM (
        SELECT COALESCE(dept_name, 'Not set') AS name, count(*) AS total,
               count(*) FILTER (WHERE status IN ('COMPLETED','EXPIRED')) AS completed,
               count(*) FILTER (WHERE is_overdue) AS overdue
          FROM counted GROUP BY 1 ORDER BY 2 DESC LIMIT 25) x), '[]'::jsonb),
    'by_course', COALESCE((SELECT jsonb_agg(x ORDER BY x.total DESC) FROM (
        SELECT course_id, course_title AS name, count(*) AS total,
               count(*) FILTER (WHERE status IN ('COMPLETED','EXPIRED')) AS completed,
               count(*) FILTER (WHERE is_overdue) AS overdue,
               count(*) FILTER (WHERE status = 'FAILED') AS failed,
               round(avg(score_pct), 1) AS avg_score,
               (SELECT round(avg(f.rating), 1) FROM lms_feedback f WHERE f.course_id = counted.course_id) AS rating
          FROM counted GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25) x), '[]'::jsonb),
    'completions_by_month', COALESCE((SELECT jsonb_agg(x ORDER BY x.month) FROM (
        SELECT to_char(completed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month, count(*) AS completed
          FROM counted WHERE completed_at >= now() - interval '6 months' GROUP BY 1) x), '[]'::jsonb)
  )
$$;

-- Who failed which assessment, and how often: the assessment analytics a report and a
-- quiz author both want. p_quiz narrows it to one quiz; question_stats is per question.
CREATE OR REPLACE FUNCTION lms_quiz_stats(p_companies UUID[], p_course UUID DEFAULT NULL) RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.pass_rate NULLS LAST), '[]'::jsonb) FROM (
    SELECT q.id AS quiz_id, q.title, c.id AS course_id, c.title AS course_title, q.pass_pct,
           count(*) AS attempts, count(DISTINCT a.enrollment_id) AS learners,
           round(avg(a.pct), 1) AS avg_pct,
           round(100.0 * count(*) FILTER (WHERE a.passed) / NULLIF(count(*), 0), 1) AS pass_rate
      FROM lms_quiz_attempts a
      JOIN lms_quizzes q ON q.id = a.quiz_id
      JOIN lms_course_versions v ON v.id = q.version_id
      JOIN lms_courses c ON c.id = v.course_id
     WHERE a.company_id = ANY(p_companies) AND a.status <> 'IN_PROGRESS'
       AND (p_course IS NULL OR c.id = p_course)
     GROUP BY q.id, q.title, c.id, c.title, q.pass_pct
  ) x
$$;

-- ── Nobody but the server may call any of this ──────────────────────────────
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'lms\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;
