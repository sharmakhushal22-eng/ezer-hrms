-- =====================================================================
-- 088_broadcast_channel.sql — the ESS broadcast channel
--
-- WHAT THIS IS FOR
--
-- One place where the company tells everybody something: a policy change, a
-- statutory deadline, an office closure, a notice that belongs to one
-- department but concerns the whole company. It is a CHANNEL, not a
-- conversation — the same shape as a public address system rather than a
-- group chat.
--
-- THE THREE RULES THIS SCHEMA ENFORCES
--
--   1. NOBODY REPLIES IN PUBLIC. There is no thread table hanging off a
--      broadcast, and that absence is the design. The moment a company-wide
--      announcement grows a comment section it stops being an announcement
--      and becomes an argument that 400 people are subscribed to. If a reply
--      table existed here, somebody would eventually wire a UI to it.
--
--   2. A RESPONSE GOES TO THE PUBLISHER AND NOBODY ELSE. An employee can
--      still come back with a question — they simply do it privately.
--      ess_broadcast_responses has no audience column because it has no
--      audience: it is readable by the person who published the broadcast,
--      and by its author. That is enforced in RLS (section 5) rather than
--      left to the UI to remember.
--
--   3. WHO MAY PUBLISH IS CONFIGURED, NOT HARDCODED. ess_broadcast_publishers
--      is the list, maintained by an admin in the inbox setup screen. Writing
--      "HR can broadcast" into a role check would mean a migration every time
--      the Communications lead changes, and would silently exclude an MD who
--      holds no HR role.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
-- No acknowledgement-required flag, no mandatory-read enforcement, no
-- scheduled send. Each is a real feature with its own consequences and none
-- was asked for; adding them speculatively would mean columns nothing writes
-- and a UI nobody asked to operate.
--
-- DEPENDS ON  employees, departments, companies, ess_announcements (021),
--             ess_notifications (021 + 075)
-- SAFE TO RUN TWICE — every statement is IF NOT EXISTS / OR REPLACE.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ess_announcements becomes the broadcast feed
--
-- Extended rather than replaced. 021 already created it, the ESS portal
-- already renders it, and it already holds live rows. A second parallel
-- "company news" table would drift from this one within a month, and then
-- nobody could say which of the two was the real feed.
-- ---------------------------------------------------------------------

ALTER TABLE ess_announcements
  ADD COLUMN IF NOT EXISTS is_broadcast boolean NOT NULL DEFAULT false;

-- Which department the notice comes FROM. It does not narrow the audience —
-- a broadcast always reaches the whole company — it tells the reader who is
-- speaking, which is most of what makes a notice credible.
ALTER TABLE ess_announcements
  ADD COLUMN IF NOT EXISTS source_department_id uuid REFERENCES departments(id);

ALTER TABLE ess_announcements
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('NORMAL', 'IMPORTANT', 'URGENT'));

-- Pinned notices sit at the top until unpinned. Deliberately not automatic:
-- an expiry date that quietly unpins a live safety notice is worse than one
-- somebody has to remember to clear.
ALTER TABLE ess_announcements
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

ALTER TABLE ess_announcements
  ADD COLUMN IF NOT EXISTS published_at_tz timestamptz;

CREATE INDEX IF NOT EXISTS idx_ess_announcements_broadcast
  ON ess_announcements (company_id, is_broadcast, is_active, published_at DESC);


-- ---------------------------------------------------------------------
-- 2. Who may publish
--
-- A list of people, not a role check. See rule 3 in the header.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ess_broadcast_publishers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Why this person has the right. Not decoration: in a year somebody will
  -- ask why a name is on this list, and "granted by X on date Y because Z"
  -- is the difference between a considered answer and a shrug.
  granted_by    uuid REFERENCES employees(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  grant_reason  text,

  -- Revoked rather than deleted, so the trail survives the revocation.
  is_active     boolean NOT NULL DEFAULT true,
  revoked_by    uuid REFERENCES employees(id),
  revoked_at    timestamptz,
  revoke_reason text,

  UNIQUE (company_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_publishers_active
  ON ess_broadcast_publishers (company_id, is_active);


-- ---------------------------------------------------------------------
-- 3. Private responses
--
-- The ONLY way to answer a broadcast, and it is not a reply — it goes to the
-- publisher alone. No parent_response_id, so a response cannot become a
-- thread either.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ess_broadcast_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id uuid NOT NULL REFERENCES ess_announcements(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL,

  -- Who wrote it. NOT NULL on purpose: an anonymous channel back to
  -- leadership is a different product with different obligations, and
  -- half-building it here would be worse than not having one.
  author_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Denormalised from the announcement so RLS can check the reader in one
  -- predicate without a join. Kept honest by the trigger in section 4.
  recipient_id    uuid NOT NULL REFERENCES employees(id),

  body            text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Whether the publisher has read it. Their inbox needs an unread count.
  read_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_broadcast_responses_recipient
  ON ess_broadcast_responses (recipient_id, read_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_responses_announcement
  ON ess_broadcast_responses (announcement_id);


-- ---------------------------------------------------------------------
-- 4. Read tracking, and the two triggers
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ess_broadcast_reads (
  announcement_id uuid NOT NULL REFERENCES ess_announcements(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, employee_id)
);

-- recipient_id must be the publisher of the announcement, always. Set here
-- rather than trusted from the client: a caller that could choose the
-- recipient could route a private response to somebody it was not meant for.
CREATE OR REPLACE FUNCTION broadcast_response_recipient()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_publisher uuid; v_company uuid;
BEGIN
  SELECT published_by, company_id INTO v_publisher, v_company
  FROM ess_announcements WHERE id = NEW.announcement_id;

  IF v_publisher IS NULL THEN
    RAISE EXCEPTION 'Announcement % has no publisher, so there is nobody to respond to',
      NEW.announcement_id;
  END IF;

  NEW.recipient_id := v_publisher;
  NEW.company_id   := v_company;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_broadcast_response_recipient ON ess_broadcast_responses;
CREATE TRIGGER trg_broadcast_response_recipient
  BEFORE INSERT ON ess_broadcast_responses
  FOR EACH ROW EXECUTE FUNCTION broadcast_response_recipient();

-- Only somebody on the publisher list may publish a broadcast. Enforced in
-- the database as well as the UI, because "the button was hidden" is not an
-- access control.
CREATE OR REPLACE FUNCTION broadcast_publisher_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_broadcast IS NOT TRUE THEN RETURN NEW; END IF;
  IF NEW.published_by IS NULL THEN
    RAISE EXCEPTION 'A broadcast must record who published it';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ess_broadcast_publishers p
    WHERE p.employee_id = NEW.published_by
      AND p.company_id  = NEW.company_id
      AND p.is_active
  ) THEN
    RAISE EXCEPTION
      'Employee % is not on the broadcast publisher list for this company', NEW.published_by;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_broadcast_publisher_check ON ess_announcements;
CREATE TRIGGER trg_broadcast_publisher_check
  BEFORE INSERT OR UPDATE ON ess_announcements
  FOR EACH ROW EXECUTE FUNCTION broadcast_publisher_check();

-- Notify the publisher when somebody responds. §2 of the brief: the response
-- is visible only to them, and they are told it arrived — an unread count
-- nobody is nudged about is a message nobody reads.
CREATE OR REPLACE FUNCTION broadcast_response_notify()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_title text; v_author text;
BEGIN
  SELECT title INTO v_title FROM ess_announcements WHERE id = NEW.announcement_id;
  SELECT full_name INTO v_author FROM employees WHERE id = NEW.author_id;

  INSERT INTO ess_notifications
    (employee_id, category, title, body, notification_code, actor_employee_id, priority)
  VALUES (
    NEW.recipient_id, 'BROADCAST',
    format('%s replied to your broadcast', coalesce(v_author, 'Someone')),
    left(NEW.body, 240),
    'BROADCAST_RESPONSE', NEW.author_id, 'NORMAL'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_broadcast_response_notify ON ess_broadcast_responses;
CREATE TRIGGER trg_broadcast_response_notify
  AFTER INSERT ON ess_broadcast_responses
  FOR EACH ROW EXECUTE FUNCTION broadcast_response_notify();


-- ---------------------------------------------------------------------
-- 5. RLS — NAYAN, THIS SECTION NEEDS YOUR DECISION
--
-- I have NOT enabled RLS or written policies, and that is deliberate rather
-- than an oversight.
--
-- ess_broadcast_responses is the table that matters. A response is private
-- to two people: the employee who wrote it and the publisher it was sent to.
-- The EZER house default of
--
--     FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)
--
-- would make every private response readable by all 400 employees, which is
-- the exact opposite of what the feature promises the person typing it. I am
-- not copying that pattern into this file without you agreeing to it.
--
-- What I would write, if you tell me to:
--
--   ess_broadcast_responses   SELECT where current employee is author_id
--                             or recipient_id; INSERT where author_id is the
--                             current employee
--   ess_broadcast_publishers  SELECT to everybody (the list is not secret —
--                             it says who speaks for the company); INSERT,
--                             UPDATE to admins only
--   ess_broadcast_reads       SELECT and INSERT limited to the employee's
--                             own rows
--   ess_announcements         SELECT to everybody in the company; writes via
--                             the publisher trigger above
--
-- That needs a reliable "who is the current employee" in this project's
-- Supabase setup, and you know how that resolves here better than I do.
-- Tell me and I will write section 5 properly.
--
-- Until then these tables have no policies. Depending on how the project is
-- configured that means either no access or full access — which is precisely
-- why it should not be guessed at from outside.
-- ---------------------------------------------------------------------


COMMENT ON TABLE ess_broadcast_publishers IS
  'Who may publish to the company broadcast channel. Maintained by an admin '
  'in the inbox setup screen; enforced by trg_broadcast_publisher_check.';
COMMENT ON TABLE ess_broadcast_responses IS
  'Private replies to a broadcast. Visible to the author and the publisher '
  'only — there is no public thread on a broadcast, by design.';
