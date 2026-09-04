-- =====================================================================
-- EZER HRMS — 080: the ESS Inbox
--
-- A professional messaging surface inside the ESS portal, sitting below
-- Leave. Three kinds of thing arrive in the same place, because from the
-- employee's side they are all "something waiting for me":
--
--   DIRECT   one colleague to another (or a small group). Private to its
--            participants — nobody else can read it or reply to it.
--   DESK     a thread with a FUNCTION rather than a person: HR, Payroll,
--            IT. Whoever staffs that desk today answers, and the reply
--            reads as coming from the desk. This is what stops "message
--            HR" meaning "know which HR person to message", and it is
--            why a desk is a first-class row rather than a group chat
--            that breaks the day somebody changes team.
--   SYSTEM   the notification streams the bell already produces, grouped
--            by the department that owns them.
--
-- ── ACCESS IS ONE RULE, IN ONE PLACE ────────────────────────────────
-- inbox_participants is the whole access model. You can read a
-- conversation if and only if you have a row in it; you can post if that
-- row has not left_at. There is no second path, no "and also if you are
-- an admin" — an HR person who needs to see a thread is added to it,
-- which is visible to everyone else in the thread rather than silent.
--
-- Desks are the one exception, and a deliberate one: a desk conversation
-- is readable by whoever currently staffs the desk, resolved through
-- inbox_desk_agents at query time rather than frozen into participants.
-- If it were frozen, an agent who left the team would keep access to
-- every thread they ever touched.
--
-- ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────
-- No RLS policies. See the last section — that is a decision for you,
-- not something to copy from a neighbouring table.
-- =====================================================================


-- ── 1. Desks ─────────────────────────────────────────────────────────
-- A desk is a function you can write to. department_id is optional
-- because not every desk maps to a row in departments (an "ESS Support"
-- desk may be two people from different departments), and company_id is
-- optional because a group-wide desk is normal — one payroll team serves
-- all three entities.
CREATE TABLE IF NOT EXISTS inbox_desks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_code      TEXT UNIQUE NOT NULL,
  label          TEXT NOT NULL,
  description    TEXT,
  department_id  UUID REFERENCES departments(id),
  company_id     UUID REFERENCES companies(id),
  -- Colour the ESS inbox tints this desk with. Same shape as the group
  -- brand colours in 079 and guarded the same way.
  accent         TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbox_desks_accent_chk') THEN
    ALTER TABLE inbox_desks ADD CONSTRAINT inbox_desks_accent_chk
      CHECK (accent IS NULL OR accent ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;

-- Who answers a desk. Membership is data, not a role name, so moving
-- somebody off the HR desk is one row and takes effect immediately —
-- including on threads that already exist.
CREATE TABLE IF NOT EXISTS inbox_desk_agents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id      UUID NOT NULL REFERENCES inbox_desks(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  added_by     UUID REFERENCES employees(id),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (desk_id, employee_id)
);


-- ── 2. Conversations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbox_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('DIRECT','DESK','SYSTEM')),
  subject       TEXT,
  company_id    UUID REFERENCES companies(id),
  desk_id       UUID REFERENCES inbox_desks(id),
  -- For SYSTEM threads: which notification stream this is. Matches the
  -- catalogue's grouping, so "Leave", "Payroll", "Performance" each get
  -- their own thread per employee instead of one undifferentiated pile.
  stream_code   TEXT,
  created_by    UUID REFERENCES employees(id),
  -- Denormalised so the conversation LIST does not need a lateral join
  -- to the last message for every row. Maintained by the trigger below,
  -- never written by the app — two writers would drift.
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  last_sender_id       UUID REFERENCES employees(id),
  message_count        INTEGER NOT NULL DEFAULT 0,
  is_closed     BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at     TIMESTAMPTZ,
  closed_by     UUID REFERENCES employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A DESK thread must name its desk; a SYSTEM thread must name its
  -- stream. Without this a mis-typed insert produces a conversation that
  -- renders in no folder and is invisible rather than wrong-looking.
  CONSTRAINT inbox_conv_kind_chk CHECK (
    (kind = 'DESK'   AND desk_id     IS NOT NULL) OR
    (kind = 'SYSTEM' AND stream_code IS NOT NULL) OR
    (kind = 'DIRECT')
  )
);

-- The access table. One row per person who can see the thread.
CREATE TABLE IF NOT EXISTS inbox_participants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES employees(id),
  role             TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER','MEMBER')),
  -- Unread is derived from this rather than stored per message: one row
  -- per person per thread instead of one row per person per message,
  -- which is the difference between thousands of rows and millions.
  last_read_at     TIMESTAMPTZ,
  is_muted         BOOLEAN NOT NULL DEFAULT FALSE,
  is_starred       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Set rather than deleted, so a thread keeps its history of who was in
  -- it when something was said.
  left_at          TIMESTAMPTZ,
  added_by         UUID REFERENCES employees(id),
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, employee_id)
);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
  -- NULL when the system said it. A message always has exactly one of a
  -- sender or a notification_code.
  sender_employee_id  UUID REFERENCES employees(id),
  -- Set when a desk agent answers AS the desk. The individual is still
  -- recorded in sender_employee_id — the employee needs to see "HR", the
  -- audit needs to see who actually typed it.
  sender_desk_id      UUID REFERENCES inbox_desks(id),
  kind                TEXT NOT NULL DEFAULT 'TEXT'
                      CHECK (kind IN ('TEXT','SYSTEM','NOTIFICATION')),
  body                TEXT NOT NULL,
  notification_code   TEXT,
  link                TEXT,
  -- Threading within a conversation: quoting one earlier message.
  reply_to_id         UUID REFERENCES inbox_messages(id) ON DELETE SET NULL,
  edited_at           TIMESTAMPTZ,
  -- Soft delete. The row stays so a reply that quotes it still makes
  -- sense, and so "message deleted" is honest rather than a silent gap.
  deleted_at          TIMESTAMPTZ,
  deleted_by          UUID REFERENCES employees(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inbox_msg_author_chk CHECK (
    sender_employee_id IS NOT NULL OR kind IN ('SYSTEM','NOTIFICATION')
  )
);


-- ── 3. Who may write to whom ─────────────────────────────────────────
-- Reach is configuration, not code, because it is a policy question HR
-- owns and will change. One row, edited from Admin Setup in the HRMS.
--
--   GROUP        anyone active in the group (the starting setting)
--   COMPANY      only within your own company
--   CHAIN_HR     your reporting chain, your reportees, and HR desks
--   NO_COLD_UP   as GROUP, except you cannot open a thread with someone
--                more than one level above you unless they wrote first
CREATE TABLE IF NOT EXISTS inbox_policy (
  id                    INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  reach_mode            TEXT NOT NULL DEFAULT 'GROUP'
                        CHECK (reach_mode IN ('GROUP','COMPANY','CHAIN_HR','NO_COLD_UP')),
  allow_desk_threads    BOOLEAN NOT NULL DEFAULT TRUE,
  allow_group_threads   BOOLEAN NOT NULL DEFAULT TRUE,
  -- A ceiling on participants in one DIRECT thread. Left generous; the
  -- point is that it exists, so a runaway client cannot make a 400-person
  -- thread that notifies the whole company.
  max_direct_members    INTEGER NOT NULL DEFAULT 25 CHECK (max_direct_members BETWEEN 2 AND 200),
  -- Employees may still always reach these desks whatever reach_mode
  -- says. Otherwise CHAIN_HR could leave somebody with no way to contact
  -- payroll about their own salary.
  always_reachable_desks TEXT[] NOT NULL DEFAULT ARRAY['HR','PAYROLL']::TEXT[],
  updated_by            UUID REFERENCES employees(id),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO inbox_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Per-role exceptions to the above. An HR Manager can be given ORG reach
-- while everyone else sits on CHAIN_HR, without a code change.
CREATE TABLE IF NOT EXISTS inbox_reach_overrides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id     UUID NOT NULL REFERENCES ess_roles(id) ON DELETE CASCADE,
  reach_mode  TEXT NOT NULL CHECK (reach_mode IN ('GROUP','COMPANY','CHAIN_HR','NO_COLD_UP')),
  updated_by  UUID REFERENCES employees(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id)
);


-- ── 4. Indexes ───────────────────────────────────────────────────────
-- Every one of these backs a query the inbox runs on each open: my
-- conversations newest-first, the messages in one thread, my unread
-- count, and the desk lookup that decides whether I may read a thread.
CREATE INDEX IF NOT EXISTS idx_inbox_part_emp
  ON inbox_participants (employee_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_part_conv
  ON inbox_participants (conversation_id);
CREATE INDEX IF NOT EXISTS idx_inbox_msg_conv
  ON inbox_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_recent
  ON inbox_conversations (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_desk
  ON inbox_conversations (desk_id) WHERE desk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_conv_stream
  ON inbox_conversations (stream_code) WHERE stream_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_agent_emp
  ON inbox_desk_agents (employee_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_inbox_agent_desk
  ON inbox_desk_agents (desk_id) WHERE is_active;


-- ── 5. Keep the conversation summary true ────────────────────────────
-- A trigger rather than app code, for the same reason 076 uses one:
-- messages will also arrive from the notification dispatcher and from
-- any later integration, and a rule living in one client is a rule the
-- other clients break.
CREATE OR REPLACE FUNCTION inbox_touch_conversation() RETURNS TRIGGER AS $$
BEGIN
  UPDATE inbox_conversations
     SET last_message_at      = NEW.created_at,
         last_message_preview = left(regexp_replace(NEW.body, '\s+', ' ', 'g'), 180),
         last_sender_id       = NEW.sender_employee_id,
         message_count        = message_count + 1
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inbox_touch_conversation ON inbox_messages;
CREATE TRIGGER trg_inbox_touch_conversation
  AFTER INSERT ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION inbox_touch_conversation();


-- ── 6. Unread, without counting anything twice ───────────────────────
-- Counts messages newer than my last_read_at, in threads I am still in,
-- excluding my own messages and muted threads. A NULL last_read_at means
-- "never opened", so everything in the thread counts.
--
-- SYSTEM THREADS ARE EXCLUDED, AND THAT IS THE IMPORTANT PART. The inbox
-- mirrors ess_notifications into per-department threads so they can be
-- read in full and kept as history. The bell already counts those same
-- notifications from ess_notifications. If this function counted them
-- too, one leave approval would show as two things waiting.
--
-- So the split is: the bell counts NOTIFICATIONS, this counts MESSAGES
-- FROM PEOPLE, and the badge is the sum. The per-thread function below
-- does include SYSTEM threads, because the folder badge inside the inbox
-- is a different question — "how much is unread in this folder" — and
-- there it is the only thing counting.
CREATE OR REPLACE FUNCTION inbox_unread_count(p_employee UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(COUNT(m.id), 0)::INTEGER
    FROM inbox_participants p
    JOIN inbox_conversations c ON c.id = p.conversation_id
    JOIN inbox_messages m ON m.conversation_id = p.conversation_id
   WHERE p.employee_id = p_employee
     AND p.left_at IS NULL
     AND NOT p.is_muted
     AND c.kind <> 'SYSTEM'
     AND m.deleted_at IS NULL
     AND (m.sender_employee_id IS DISTINCT FROM p_employee)
     AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at);
$$ LANGUAGE sql STABLE;

-- Per-thread unread, for the badge on each row of the list.
CREATE OR REPLACE FUNCTION inbox_unread_by_conversation(p_employee UUID)
RETURNS TABLE (conversation_id UUID, unread INTEGER) AS $$
  SELECT p.conversation_id,
         COUNT(m.id) FILTER (
           WHERE m.deleted_at IS NULL
             AND m.sender_employee_id IS DISTINCT FROM p_employee
             AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
         )::INTEGER
    FROM inbox_participants p
    LEFT JOIN inbox_messages m ON m.conversation_id = p.conversation_id
   WHERE p.employee_id = p_employee AND p.left_at IS NULL
   GROUP BY p.conversation_id;
$$ LANGUAGE sql STABLE;


-- ── 7. May A write to B? ─────────────────────────────────────────────
-- In SQL rather than only in the route, so that the answer is the same
-- whoever asks. The route calls it before creating a thread; anything
-- added later gets the same rule for free.
CREATE OR REPLACE FUNCTION inbox_can_message(p_from UUID, p_to UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_mode         TEXT;
  v_from_company UUID; v_from_l1 UUID; v_from_l2 UUID;
  v_to_company   UUID; v_to_l1   UUID; v_to_l2   UUID;
  v_depth        INTEGER;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RETURN FALSE; END IF;

  SELECT company_id, l1_manager_id, l2_manager_id
    INTO v_from_company, v_from_l1, v_from_l2
    FROM employees WHERE id = p_from;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT company_id, l1_manager_id, l2_manager_id
    INTO v_to_company, v_to_l1, v_to_l2
    FROM employees WHERE id = p_to;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- The WIDEST role override the sender holds wins. Somebody who is both
  -- an employee and an HR Manager should not lose HR's reach because the
  -- company default is narrower than their role.
  SELECT o.reach_mode INTO v_mode
    FROM ess_accounts a
    JOIN ess_user_roles ur ON ur.ess_account_id = a.id AND ur.is_active
    JOIN inbox_reach_overrides o ON o.role_id = ur.role_id
   WHERE a.employee_id = p_from
   ORDER BY CASE o.reach_mode
              WHEN 'GROUP' THEN 0 WHEN 'NO_COLD_UP' THEN 1
              WHEN 'COMPANY' THEN 2 ELSE 3 END
   LIMIT 1;

  IF v_mode IS NULL THEN
    SELECT reach_mode INTO v_mode FROM inbox_policy WHERE id = 1;
  END IF;
  IF v_mode IS NULL THEN v_mode := 'GROUP'; END IF;

  IF v_mode = 'GROUP' THEN
    RETURN TRUE;

  ELSIF v_mode = 'COMPANY' THEN
    RETURN v_from_company IS NOT DISTINCT FROM v_to_company;

  ELSIF v_mode = 'CHAIN_HR' THEN
    -- Up, down, or a peer under the same manager. HR and Payroll are not
    -- named here: they are reachable as DESKS, through
    -- inbox_policy.always_reachable_desks, which is the route an employee
    -- should be using anyway — it survives the HR person changing.
    RETURN v_from_l1 IS NOT DISTINCT FROM p_to        -- my manager
        OR v_from_l2 IS NOT DISTINCT FROM p_to        -- my skip-level
        OR v_to_l1   IS NOT DISTINCT FROM p_from      -- reports to me
        OR v_to_l2   IS NOT DISTINCT FROM p_from      -- skip-reports to me
        OR (v_from_l1 IS NOT NULL                     -- same manager: a peer
            AND v_from_l1 IS NOT DISTINCT FROM v_to_l1);

  ELSIF v_mode = 'NO_COLD_UP' THEN
    -- Your own manager is always reachable, and so is anyone who is not
    -- above you at all. What is blocked is opening a thread with someone
    -- two or more levels up who has never written to you.
    IF v_from_l1 IS NOT DISTINCT FROM p_to OR v_to_l1 IS NOT DISTINCT FROM p_from THEN
      RETURN TRUE;
    END IF;

    -- Walk up the reporting line rather than trusting l2_manager_id
    -- alone: l2 is one stored hop, and "two or more levels above" can be
    -- five. Bounded at 12 so a cycle in the data cannot hang the insert.
    WITH RECURSIVE chain AS (
      SELECT l1_manager_id AS mgr, 1 AS depth
        FROM employees WHERE id = p_from
      UNION ALL
      SELECT e.l1_manager_id, c.depth + 1
        FROM chain c JOIN employees e ON e.id = c.mgr
       WHERE c.mgr IS NOT NULL AND c.depth < 12
    )
    SELECT MIN(depth) INTO v_depth FROM chain WHERE mgr = p_to;

    IF v_depth IS NULL OR v_depth < 2 THEN
      RETURN TRUE;                      -- not above me, or directly above
    END IF;

    -- Two or more levels up: allowed only once they have spoken first.
    RETURN EXISTS (
      SELECT 1
        FROM inbox_messages m
        JOIN inbox_participants p ON p.conversation_id = m.conversation_id
       WHERE m.sender_employee_id = p_to
         AND p.employee_id = p_from
         AND m.deleted_at IS NULL
    );
  END IF;

  RETURN FALSE;
END $$ LANGUAGE plpgsql STABLE;


-- ── 8. Seed the standard desks ───────────────────────────────────────
-- Codes match the notification catalogue's audiences, so a notification
-- addressed to FINANCE and a message written to the Finance desk land in
-- the same place instead of two lists that look the same.
INSERT INTO inbox_desks (desk_code, label, description, accent, sort_order)
VALUES
  ('HR',        'HR',                'Policy, records, letters, anything people-related', '#7C3AED', 10),
  ('PAYROLL',   'Payroll',           'Salary, payslips, tax, reimbursements',             '#047857', 20),
  ('FINANCE',   'Finance',           'Claims, advances, vendor and expense queries',      '#0E7490', 30),
  ('IT',        'IT Support',        'Access, hardware, software, the ESS portal itself', '#B45309', 40),
  ('ADMIN',     'Admin & Facilities','Office, travel desk, assets',                       '#BE185D', 50)
ON CONFLICT (desk_code) DO NOTHING;


-- =====================================================================
-- STILL YOURS — please decide before this goes anywhere near production
-- =====================================================================
-- 1. RLS. Six new tables, and this is the first feature in the app where
--    the house pattern is actively wrong:
--
--        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)
--
--    inbox_messages holds private conversations between named employees.
--    An allow-all policy means the anon key — which ships in every page
--    load — can read every private message in the company. The app never
--    does this: every read goes through /api/ess/inbox with the service
--    role after checking participation. But the table would still be
--    open to anyone who pointed PostgREST at it.
--
--    My recommendation, for you to accept or replace: deny anon
--    outright on inbox_messages, inbox_participants and
--    inbox_conversations, and let only the service role touch them.
--    Nothing in the app breaks, because nothing in the app reads them
--    from the browser.
--
-- 2. Retention. Nothing here expires. If messages should be purged after
--    N months, that is a policy column and a scheduled job, and it is
--    easier to add before there is history than after.
--
-- 3. Desk staffing. inbox_desk_agents starts EMPTY, so the five seeded
--    desks exist but nobody answers them. The ESS UI says so plainly
--    rather than accepting a message into a void — but the desks are
--    only useful once you add agents (Admin Setup → Inbox).
-- =====================================================================
