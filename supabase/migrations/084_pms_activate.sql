-- ════════════════════════════════════════════════════════════════════════════
-- 084 — turn PMS on.
--
-- STATE FOUND ON THE LIVE DATABASE, 02-Sep-2026
--   pms_policies         3   (one per company; min 4 KRAs, max 10, weightage 100)
--   pms_periods         12   (Q1–Q4 FY2026-27 per company)
--   pms_rating_scale    15
--   pms_overall_rating 133   (SRS only — its Q2 was opened and the chain snapshotted)
--   pms_kra_master       0   ← the KRA library is empty
--   pms_employee_goals   0   ← nobody has KRAs
--   pms_reviews          0
--   vw_pms_org_readiness: SRS 133 READY, SSM 133 READY, STC 129 READY,
--                         3 EXCLUDED (the MDs — top of chain, correct)
--                         ZERO in FIX_DEPARTMENT / FIX_EMPLOYEE / FIX_OTHER
--
-- So the org side is sound. Three things stop PMS from actually running:
--
--   1. SRS Q2 sits in KRA_SETTING but its KRA window CLOSED on 15-Jul-2026.
--      Today is 02-Sep. Nobody can enter a KRA. Self-rating does not open
--      until 01-Oct, so the cycle is stalled between the two.
--   2. STC and SSM Q2 are still SCHEDULED — never opened, no chain snapshot.
--   3. pms_kra_master is empty, so KRA setting starts from a blank page.
--
-- WHAT THIS FILE DOES ABOUT EACH — change the dates in §1 if you want
-- a different window; everything else follows from them.
-- ════════════════════════════════════════════════════════════════════════════


-- ── §1 · Reopen the KRA window ──────────────────────────────────────────────
-- The window has lapsed, so it has to move; there is no other way to let KRAs
-- be entered now. 21 days from today, ending well before self-rating opens on
-- 01-Oct. Q2 itself still ends 30-Sep, so the period is not extended — only
-- the data-entry window inside it.
UPDATE pms_periods
SET kra_window_from = DATE '2026-09-02',
    kra_window_to   = DATE '2026-09-23'
WHERE period_code = 'Q2-FY202627';


-- ── §2 · Open Q2 for STC and SSM ────────────────────────────────────────────
-- pms_open_period refuses anything that is not SCHEDULED, so SRS (already
-- KRA_SETTING) is skipped by that guard rather than by this query — running
-- it against all three is safe and returns a readable ERROR for SRS.
-- It also refuses to open while any employee has an unresolvable chain;
-- readiness is clean today, so both should return OPENED.
SELECT c.company_code, pms_open_period(p.id) AS result
FROM pms_periods p
JOIN companies c ON c.id = p.company_id
WHERE p.period_code = 'Q2-FY202627'
ORDER BY c.company_code;


-- ── §3 · Seed the KRA library ───────────────────────────────────────────────
-- pms_kra_master holds SUGGESTIONS, not commitments: what a manager sees as a
-- pick-list when setting an employee's KRAs. Each department gets five, whose
-- suggested weightages total 100 — the policy's own total — so a manager who
-- accepts the set as-is passes pms_validate_kras without arithmetic.
--
-- These are starting points written from the department name alone. HR should
-- edit them; that is what the table is for. Nothing here is binding, and an
-- employee's actual goals live in pms_employee_goals.
--
-- Seeded per company, matched on department name, so each company's own
-- department row gets its own copy.

INSERT INTO pms_kra_master
  (company_id, department_id, kra_title, kpi_metric, suggested_target, category, suggested_weightage)
SELECT d.company_id, d.id, k.kra_title, k.kpi_metric, k.suggested_target, k.category, k.wt
FROM departments d
JOIN (VALUES
  -- dept_name,                kra_title,                        kpi_metric,                      target,          category,      wt
  ('Finance & Accounts', 'Monthly close on time',            'Books closed by working day',   'WD+5',          'PROCESS',    25),
  ('Finance & Accounts', 'Statutory filings without default','Filings on or before due date',  '100%',          'COMPLIANCE', 25),
  ('Finance & Accounts', 'Receivable ageing',                'Debtor days',                    'Under 45 days', 'BUSINESS',   20),
  ('Finance & Accounts', 'Audit observations closed',        'Open observations at quarter end','Zero',          'PROCESS',    15),
  ('Finance & Accounts', 'Team capability',                  'Team members cross-trained',     'At least 2',    'PEOPLE',     15),

  ('HR & Admin', 'Positions closed within SLA',      'Offers accepted vs mandate',        '90%',        'BUSINESS',   25),
  ('HR & Admin', 'Payroll accuracy',                 'Payroll errors per cycle',          'Zero',       'PROCESS',    25),
  ('HR & Admin', 'Statutory compliance',             'PF / ESIC / PT filed on time',      '100%',       'COMPLIANCE', 20),
  ('HR & Admin', 'Attrition in regretted category',  'Regretted exits',                   'Under 8%',   'PEOPLE',     15),
  ('HR & Admin', 'Employee training coverage',       'Employees with a completed course', '80%',        'LEARNING',   15),

  ('IT', 'System uptime',                    'Availability of core systems',   '99.5%',      'PROCESS',    25),
  ('IT', 'Ticket resolution within SLA',     'Tickets closed in SLA',          '90%',        'CUSTOMER',   25),
  ('IT', 'Security and access hygiene',      'Access reviews completed',       'Quarterly',  'COMPLIANCE', 20),
  ('IT', 'Project milestones delivered',     'Milestones on schedule',         '85%',        'BUSINESS',   15),
  ('IT', 'Skill certification',              'Certifications completed',       'At least 1', 'LEARNING',   15),

  ('Sales & Marketing', 'Revenue against target',        'Achievement vs plan',          '100%',    'BUSINESS', 30),
  ('Sales & Marketing', 'New customer acquisition',      'New accounts opened',          'Per plan','BUSINESS', 20),
  ('Sales & Marketing', 'Collection against invoicing',  'Collected vs billed',          '95%',     'PROCESS',  20),
  ('Sales & Marketing', 'Customer retention',            'Repeat customers',             '80%',     'CUSTOMER', 15),
  ('Sales & Marketing', 'Team development',              'Team members meeting target',  '75%',     'PEOPLE',   15),

  ('Retail Operations', 'Store sales against target',   'Achievement vs plan',        '100%',     'BUSINESS',   30),
  ('Retail Operations', 'Shrinkage control',            'Stock loss as % of sales',   'Under 1%', 'PROCESS',    20),
  ('Retail Operations', 'Customer satisfaction',        'Store feedback score',       '4.2 / 5',  'CUSTOMER',   20),
  ('Retail Operations', 'Statutory display compliance', 'Store audit score',          '95%',      'COMPLIANCE', 15),
  ('Retail Operations', 'Staff attendance and roster',  'Roster adherence',           '95%',      'PEOPLE',     15),

  ('Customer Service', 'First response time',        'Average first response',       'Under 4 hours','CUSTOMER', 30),
  ('Customer Service', 'Resolution within SLA',      'Tickets closed in SLA',        '90%',          'PROCESS',  25),
  ('Customer Service', 'Customer satisfaction',      'CSAT score',                   '4.3 / 5',      'CUSTOMER', 20),
  ('Customer Service', 'Escalations',                'Escalated cases',              'Under 5%',     'PROCESS',  15),
  ('Customer Service', 'Product knowledge',          'Assessment score',             '85%',          'LEARNING', 10),

  ('Merchandising', 'Assortment availability',   'On-shelf availability',      '95%',      'BUSINESS', 25),
  ('Merchandising', 'Inventory turns',           'Stock turn ratio',           'Per plan', 'BUSINESS', 25),
  ('Merchandising', 'Markdown control',          'Markdown as % of sales',     'Under 5%', 'PROCESS',  20),
  ('Merchandising', 'Planogram compliance',      'Store audit score',          '90%',      'PROCESS',  15),
  ('Merchandising', 'Vendor relationships',      'Vendor reviews completed',   'Quarterly','PEOPLE',   15),

  ('Logistics', 'On-time delivery',            'Deliveries within promise',  '95%',      'CUSTOMER',   30),
  ('Logistics', 'Freight cost per unit',       'Cost per despatched unit',   'Per plan', 'BUSINESS',   25),
  ('Logistics', 'Damage in transit',           'Damaged consignments',       'Under 1%', 'PROCESS',    20),
  ('Logistics', 'Vehicle and permit compliance','Documents valid',           '100%',     'COMPLIANCE', 15),
  ('Logistics', 'Team safety',                 'Reportable incidents',       'Zero',     'PEOPLE',     10),

  ('Maintenance', 'Planned maintenance adherence','PM schedule completed',    '95%',       'PROCESS',    30),
  ('Maintenance', 'Unplanned downtime',          'Downtime hours',            'Per plan',  'BUSINESS',   25),
  ('Maintenance', 'Mean time to repair',         'Average repair time',       'Per plan',  'PROCESS',    20),
  ('Maintenance', 'Safety compliance',           'Safety audit score',        '95%',       'COMPLIANCE', 15),
  ('Maintenance', 'Technician skilling',         'Team trained on equipment', 'At least 2','LEARNING',   10),

  ('Manufacturing', 'Production against plan',   'Output vs schedule',        '95%',      'BUSINESS',   30),
  ('Manufacturing', 'First-pass yield',          'Units passing first time',  '97%',      'PROCESS',    25),
  ('Manufacturing', 'Cost per unit',             'Conversion cost',           'Per plan', 'BUSINESS',   15),
  ('Manufacturing', 'Safety incidents',          'Reportable incidents',      'Zero',     'COMPLIANCE', 15),
  ('Manufacturing', 'Operator skilling',         'Operators multi-skilled',   'At least 3','PEOPLE',    15),

  ('Production', 'Schedule adherence',       'Batches on schedule',      '95%',      'BUSINESS',   30),
  ('Production', 'Rejection rate',           'Rejections as % of output','Under 2%', 'PROCESS',    25),
  ('Production', 'Material yield',           'Yield vs standard',        'Per plan', 'BUSINESS',   15),
  ('Production', 'Housekeeping and safety',  '5S audit score',           '90%',      'COMPLIANCE', 15),
  ('Production', 'Shift team capability',    'Operators cross-trained',  'At least 3','PEOPLE',    15),

  ('Quality Control', 'In-process rejection',      'Rejections detected in-line','Per plan','PROCESS',    30),
  ('Quality Control', 'Customer complaints',       'Quality complaints',         'Under 3', 'CUSTOMER',   25),
  ('Quality Control', 'Calibration compliance',    'Instruments in calibration', '100%',    'COMPLIANCE', 20),
  ('Quality Control', 'CAPA closure',              'CAPAs closed on time',       '90%',     'PROCESS',    15),
  ('Quality Control', 'Inspector competency',      'Inspectors assessed',        'All',     'LEARNING',   10),

  ('Procurement', 'Cost savings against baseline','Savings realised',        'Per plan','BUSINESS',   30),
  ('Procurement', 'On-time material availability','Stock-outs',              'Zero',    'PROCESS',    25),
  ('Procurement', 'Vendor quality',               'Vendor rating',           '4 / 5',   'PROCESS',    20),
  ('Procurement', 'Contract compliance',          'POs against contract',    '100%',    'COMPLIANCE', 15),
  ('Procurement', 'Vendor base development',      'New vendors qualified',   'Per plan','BUSINESS',   10),

  ('Legal & Compliance', 'Statutory registers current',  'Registers up to date',      '100%',   'COMPLIANCE', 30),
  ('Legal & Compliance', 'Licence and renewal tracking', 'Renewals before expiry',    '100%',   'COMPLIANCE', 25),
  ('Legal & Compliance', 'Contract turnaround',          'Contracts reviewed in SLA', '90%',    'PROCESS',    20),
  ('Legal & Compliance', 'Litigation management',        'Hearings attended',         '100%',   'PROCESS',    15),
  ('Legal & Compliance', 'Compliance awareness',         'Departments briefed',       'All',    'LEARNING',   10),

  ('Operations', 'Service delivery against plan','Deliverables on schedule', '95%',      'BUSINESS',   30),
  ('Operations', 'Process adherence',            'Process audit score',      '90%',      'PROCESS',    25),
  ('Operations', 'Cost control',                 'Spend vs budget',          'Within',   'BUSINESS',   20),
  ('Operations', 'Customer escalations',         'Escalations raised',       'Under 5%', 'CUSTOMER',   15),
  ('Operations', 'Team productivity',            'Output per head',          'Per plan', 'PEOPLE',     10)
) AS k(dept_name, kra_title, kpi_metric, suggested_target, category, wt)
  ON k.dept_name = d.dept_name
WHERE d.status = 'Active'
  AND NOT EXISTS (
    SELECT 1 FROM pms_kra_master m
    WHERE m.company_id = d.company_id AND m.department_id = d.id AND m.kra_title = k.kra_title
  );


-- ── §4 · Verify ─────────────────────────────────────────────────────────────
SELECT 'Q2 periods now open' AS check, c.company_code AS detail, p.status AS result
FROM pms_periods p JOIN companies c ON c.id = p.company_id
WHERE p.period_code = 'Q2-FY202627'

UNION ALL
SELECT 'KRA window', 'Q2 all companies',
       (SELECT DISTINCT kra_window_from || ' to ' || kra_window_to
        FROM pms_periods WHERE period_code = 'Q2-FY202627')

UNION ALL
SELECT 'employees enrolled', c.company_code, COUNT(*)::text
FROM pms_overall_rating r
JOIN pms_periods p ON p.id = r.period_id AND p.period_code = 'Q2-FY202627'
JOIN companies c ON c.id = r.company_id
GROUP BY c.company_code

UNION ALL
SELECT 'KRA library seeded', c.company_code, COUNT(*)::text
FROM pms_kra_master m JOIN companies c ON c.id = m.company_id
GROUP BY c.company_code

ORDER BY 1, 2;
