-- ════════════════════════════════════════════════════════════════════
-- 036_shift_attendance.sql — EZER HRMS · Shift Config + Attendance Punch
-- Shift master (auto-code trigger) + attendance_punches (raw, multi-source)
-- + attendance_records (processed: first IN, last OUT) + processor + ess_punch().
--
-- NOTE: spec called this "032" but 032_employee_master_gaps.sql exists → 036.
-- FIX vs spec: ess_punch() now reads locations.geofence_radius_m (not max_employees),
--   and that column is added BEFORE the function so it always resolves.
-- Additive & idempotent. HOW TO RUN: Supabase → SQL Editor → paste → Run.
-- ════════════════════════════════════════════════════════════════════

-- ── geofence radius on locations (used by ess_punch — add first) ─────
ALTER TABLE locations ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER DEFAULT 100;

-- ── 1. SHIFT MASTER ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_master (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_code            TEXT NOT NULL,              -- auto-generated: e.g. GEN-SSM-001
  shift_type            TEXT NOT NULL DEFAULT 'GENERAL',
  company_id            UUID NOT NULL,
  in_time               TIME NOT NULL,
  late_allowed_till     TIME NOT NULL,
  max_late_punch        TIME,
  lunch_start           TIME,
  lunch_duration_mins   INTEGER DEFAULT 30,
  out_time              TIME NOT NULL,
  max_out_punch         TIME,
  overtime_applicable   BOOLEAN DEFAULT FALSE,
  effective_from        DATE NOT NULL DEFAULT CURRENT_DATE,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (shift_code, company_id)
);

-- ── Shift code auto-generation: {PREFIX}-{COMPANY3}-{SEQ} ────────────
CREATE OR REPLACE FUNCTION generate_shift_code(p_company_id UUID, p_shift_type TEXT)
RETURNS TEXT AS $$
DECLARE v_company_code TEXT; v_prefix TEXT; v_seq INTEGER;
BEGIN
  SELECT UPPER(LEFT(COALESCE(short_name, company_code, 'EZR'), 3)) INTO v_company_code
    FROM companies WHERE id = p_company_id;
  v_company_code := COALESCE(v_company_code, 'EZR');
  v_prefix := CASE p_shift_type
    WHEN 'GENERAL' THEN 'GEN' WHEN 'MORNING' THEN 'MRN' WHEN 'AFTERNOON' THEN 'AFT'
    WHEN 'NIGHT' THEN 'NGT' WHEN 'SPLIT' THEN 'SPL' WHEN 'ROTATING' THEN 'ROT' ELSE 'SFT' END;
  SELECT COALESCE(MAX(CAST(SPLIT_PART(shift_code, '-', 3) AS INTEGER)), 0) + 1 INTO v_seq
    FROM shift_master
   WHERE company_id = p_company_id AND shift_code LIKE v_prefix || '-' || v_company_code || '-%';
  RETURN v_prefix || '-' || v_company_code || '-' || LPAD(v_seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_shift_code() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.shift_code IS NULL OR NEW.shift_code = '' THEN
    NEW.shift_code := generate_shift_code(NEW.company_id, NEW.shift_type);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS set_shift_code ON shift_master;
CREATE TRIGGER set_shift_code BEFORE INSERT ON shift_master FOR EACH ROW EXECUTE FUNCTION trg_shift_code();

-- ── 2. SHIFT ROTATION CONFIG ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_rotation_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL, rotation_name TEXT, rotation_cycle_days INTEGER DEFAULT 7,
  shift_order TEXT[], next_rotation_date DATE, review_roles TEXT[],
  is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now()
);

-- ── 3. EMPLOYEE SHIFT ASSIGNMENT ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_shift_assignment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL,
  shift_id UUID NOT NULL REFERENCES shift_master(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_till DATE,
  overtime_applicable BOOLEAN,
  rotation_config_id UUID REFERENCES shift_rotation_config(id),
  assigned_by TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_esa_employee ON employee_shift_assignment(employee_id, effective_from DESC);

-- ── 4. ATTENDANCE PUNCHES (raw log — all sources) ────────────────────
CREATE TABLE IF NOT EXISTS attendance_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL,
  punch_time TIMESTAMPTZ NOT NULL,
  punch_date DATE NOT NULL,   -- IST calendar date, populated by the set_punch_date trigger below
  punch_type TEXT NOT NULL DEFAULT 'IN',
  source TEXT NOT NULL DEFAULT 'ESS_APP',
  device_id TEXT, latitude NUMERIC(10,7), longitude NUMERIC(10,7),
  geofence_status TEXT DEFAULT 'UNKNOWN', geofence_radius_m INTEGER, branch_id UUID,
  is_processed BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_punch_emp_date ON attendance_punches(employee_id, punch_date);
CREATE INDEX IF NOT EXISTS idx_punch_unprocessed ON attendance_punches(is_processed, punch_date) WHERE NOT is_processed;

-- Populate punch_date (IST calendar date) via trigger — sidesteps the immutability
-- requirement that GENERATED columns impose on timestamptz→date conversion.
CREATE OR REPLACE FUNCTION trg_punch_date() RETURNS TRIGGER AS $$
BEGIN
  NEW.punch_date := (NEW.punch_time AT TIME ZONE INTERVAL '+05:30')::DATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS set_punch_date ON attendance_punches;
CREATE TRIGGER set_punch_date BEFORE INSERT ON attendance_punches FOR EACH ROW EXECUTE FUNCTION trg_punch_date();

-- ── 5. ATTENDANCE RECORDS (processed — one row per employee per day) ──
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  shift_id UUID REFERENCES shift_master(id),
  work_in TIMESTAMPTZ, work_out TIMESTAMPTZ,
  total_minutes INTEGER, late_minutes INTEGER DEFAULT 0,
  status TEXT DEFAULT 'PRESENT',
  lop_applicable BOOLEAN DEFAULT FALSE, overtime_minutes INTEGER DEFAULT 0,
  punch_count INTEGER DEFAULT 0, source TEXT, remark TEXT,
  processed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (employee_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS idx_atten_emp_date ON attendance_records(employee_id, attendance_date DESC);

-- ── 6. BIOMETRIC IMPORT LOG ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS biometric_import_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID, machine_id TEXT, file_name TEXT,
  period_from DATE, period_till DATE, total_rows INTEGER,
  inserted INTEGER DEFAULT 0, duplicates INTEGER DEFAULT 0, errors INTEGER DEFAULT 0,
  error_details JSONB, imported_by TEXT, imported_at TIMESTAMPTZ DEFAULT now()
);

-- ── 7. CORE PROCESSOR: first IN, last OUT (idempotent UPSERT) ─────────
CREATE OR REPLACE FUNCTION process_daily_attendance(p_employee_id UUID, p_date DATE)
RETURNS TEXT AS $$
DECLARE
  v_first_in TIMESTAMPTZ; v_last_out TIMESTAMPTZ; v_punch_count INTEGER;
  v_shift RECORD; v_late_mins INTEGER := 0; v_total_mins INTEGER := 0;
  v_ot_mins INTEGER := 0; v_lop BOOLEAN := FALSE; v_status TEXT := 'PRESENT'; v_source TEXT := 'ESS_APP';
BEGIN
  SELECT MIN(punch_time) FILTER (WHERE punch_type = 'IN'),
         MAX(punch_time) FILTER (WHERE punch_type = 'OUT'),
         COUNT(*), MODE() WITHIN GROUP (ORDER BY source)
    INTO v_first_in, v_last_out, v_punch_count, v_source
    FROM attendance_punches WHERE employee_id = p_employee_id AND punch_date = p_date;
  IF v_punch_count = 0 THEN RETURN 'NO_PUNCHES'; END IF;

  SELECT sm.* INTO v_shift
    FROM employee_shift_assignment esa JOIN shift_master sm ON sm.id = esa.shift_id
   WHERE esa.employee_id = p_employee_id AND esa.effective_from <= p_date
     AND (esa.effective_till IS NULL OR esa.effective_till >= p_date) AND esa.is_active
   ORDER BY esa.effective_from DESC LIMIT 1;

  -- Compare punch (timestamptz) as IST wall-clock against the shift's local times.
  IF v_shift IS NOT NULL AND v_first_in IS NOT NULL THEN
    v_late_mins := GREATEST(0, EXTRACT(EPOCH FROM ((v_first_in AT TIME ZONE INTERVAL '+05:30') - (p_date + v_shift.in_time))) / 60)::INTEGER;
    IF v_shift.max_late_punch IS NOT NULL AND (v_first_in AT TIME ZONE INTERVAL '+05:30') > (p_date + v_shift.max_late_punch) THEN
      v_status := 'HALF_DAY'; v_lop := TRUE;
    END IF;
  END IF;

  IF v_first_in IS NOT NULL AND v_last_out IS NOT NULL THEN
    v_total_mins := GREATEST(0, EXTRACT(EPOCH FROM (v_last_out - v_first_in)) / 60 - COALESCE(v_shift.lunch_duration_mins, 0))::INTEGER;
    IF v_shift IS NOT NULL AND v_shift.overtime_applicable AND v_shift.max_out_punch IS NOT NULL
       AND (v_last_out AT TIME ZONE INTERVAL '+05:30') > (p_date + v_shift.max_out_punch) THEN
      v_ot_mins := (EXTRACT(EPOCH FROM ((v_last_out AT TIME ZONE INTERVAL '+05:30') - (p_date + v_shift.max_out_punch))) / 60)::INTEGER;
    END IF;
  END IF;

  INSERT INTO attendance_records
    (employee_id, attendance_date, shift_id, work_in, work_out, total_minutes, late_minutes,
     status, lop_applicable, overtime_minutes, punch_count, source, processed_at)
  VALUES
    (p_employee_id, p_date, CASE WHEN v_shift IS NOT NULL THEN v_shift.id ELSE NULL END,
     v_first_in, v_last_out, v_total_mins, v_late_mins, v_status, v_lop, v_ot_mins, v_punch_count, v_source, now())
  ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
    work_in = EXCLUDED.work_in, work_out = EXCLUDED.work_out, total_minutes = EXCLUDED.total_minutes,
    late_minutes = EXCLUDED.late_minutes, status = EXCLUDED.status, lop_applicable = EXCLUDED.lop_applicable,
    overtime_minutes = EXCLUDED.overtime_minutes, punch_count = EXCLUDED.punch_count,
    source = EXCLUDED.source, processed_at = now();

  UPDATE attendance_punches SET is_processed = TRUE WHERE employee_id = p_employee_id AND punch_date = p_date;
  RETURN 'OK:' || v_punch_count || '_PUNCHES';
END;
$$ LANGUAGE plpgsql;

-- ── 8. ESS PUNCH (geofence check + raw insert + process) ─────────────
CREATE OR REPLACE FUNCTION ess_punch(
  p_employee_id UUID, p_punch_type TEXT, p_latitude NUMERIC, p_longitude NUMERIC, p_branch_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_punch_id UUID := gen_random_uuid(); v_now TIMESTAMPTZ := now();
  v_geofence TEXT := 'UNKNOWN'; v_radius INTEGER; v_branch_lat NUMERIC; v_branch_lng NUMERIC; v_dist NUMERIC;
BEGIN
  -- FIX: use geofence_radius_m (not max_employees)
  SELECT latitude, longitude, geofence_radius_m INTO v_branch_lat, v_branch_lng, v_radius
    FROM locations WHERE id = p_branch_id;
  IF v_branch_lat IS NOT NULL AND p_latitude IS NOT NULL AND v_radius IS NOT NULL THEN
    v_dist := SQRT(POWER((p_latitude - v_branch_lat) * 111320, 2) +
                   POWER((p_longitude - v_branch_lng) * 111320 * COS(RADIANS(v_branch_lat)), 2));
    v_geofence := CASE WHEN v_dist <= v_radius THEN 'INSIDE' ELSE 'OUTSIDE' END;
  END IF;
  INSERT INTO attendance_punches
    (id, employee_id, punch_time, punch_type, source, latitude, longitude, geofence_status, geofence_radius_m, branch_id)
  VALUES
    (v_punch_id, p_employee_id, v_now, p_punch_type, 'ESS_APP', p_latitude, p_longitude, v_geofence, v_radius, p_branch_id);
  PERFORM process_daily_attendance(p_employee_id, (v_now AT TIME ZONE INTERVAL '+05:30')::DATE);
  RETURN jsonb_build_object('punch_id', v_punch_id, 'punch_time', v_now, 'punch_type', p_punch_type, 'geofence', v_geofence, 'processed', TRUE);
END;
$$ LANGUAGE plpgsql;

-- ── 9. RLS (project standard permissive) ─────────────────────────────
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY[
  'shift_master','shift_rotation_config','employee_shift_assignment',
  'attendance_punches','attendance_records','biometric_import_log']) LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS "allow_all_%s" ON %I', t, t);
  EXECUTE format('CREATE POLICY "allow_all_%s" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t, t);
END LOOP; END $$;

notify pgrst, 'reload schema';
