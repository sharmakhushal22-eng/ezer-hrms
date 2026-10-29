-- 203_pms_publish_scope.sql — publishing is one company at a time, unless a
-- company says otherwise.
-- SAFE TO RUN TWICE. Adds one column with a default. No data change, no
-- constraint altered, nothing dropped, no UPDATE.
-- ----------------------------------------------------------------------------
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- 202 moved the post-finalisation controls to HR, and the loader behind them
-- was then widened so an HR Head over three companies could see all of them —
-- the Ratings Summary was reaching 129 of 395 enrolments because the period
-- query took a single period.
--
-- Publishing came along for the ride, and it should not have. Requested:
-- "publish should be specific to person and company, where the employee is
-- of. but it can be editable from admin configuration".
--
-- That is the right instinct and the asymmetry is real. READING across
-- companies is a report; RELEASING a result across companies is an
-- irreversible act on somebody's record, taken from a list where three
-- organisations' employees sit side by side under names that repeat. Every
-- company here is seeded with a policy called "Standard Quarterly" and two
-- of the three have an employee coded *9030 — Shreya Singh SRS9030 and Anil
-- Verma STC9030. A mis-click on a combined list publishes the wrong person's
-- appraisal, and 201 exists because a second publish already damaged one
-- record.
--
-- So: the summary still spans, the publish workspace does not.
--
-- ── WHY A COLUMN AND NOT A HARDCODED RULE ──────────────────────────────────
--
-- "but it can be editable from admin configuration" — so it is configuration,
-- the same standing instruction that produced 196, 202 and the carry-forward
-- switch: default to the asked-for behaviour, let an admin change it.
--
-- DEFAULT 'COMPANY', which is the restriction, not the permission. A company
-- has to opt IN to appearing in a cross-company publish list. Defaults that
-- widen reach are the wrong way round for an irreversible action.
--
-- ── HOW IT RESOLVES, since this is per policy and the question is per view ──
--
-- Each company's own policy decides whether ITS employees may be published
-- from a combined list. The screen therefore offers "All companies" listing
-- only the companies that opted in; a company left at 'COMPANY' is reachable
-- only by selecting it explicitly.
--
-- Honouring each company individually rather than demanding unanimity: a
-- group where two companies are relaxed and one is strict should not lose the
-- combined view entirely, and the strict one should not be quietly dragged
-- into it. Both readings were available and this is the one that respects
-- what each company actually set.
--
-- ── WHAT THIS DOES NOT TOUCH ───────────────────────────────────────────────
--
-- Not who may publish — 202's post_final_owner and §2's matrix still decide
-- that. Not whether a given result MAY be published: 200's
-- trg_pms_publish_needs_signoff still requires the final-review one-to-one to
-- be acknowledged by both parties, and 201 still refuses to walk an
-- acknowledged result backwards. This narrows the LIST somebody acts from.
--
-- Deliberately not enforced by a trigger. A database guard here would have to
-- know which screen a write came from, which is not a property of the write —
-- and the act being narrowed is already guarded three ways. This is the shape
-- of the queue, and the queue is a screen.

ALTER TABLE pms_policies
  ADD COLUMN IF NOT EXISTS publish_scope text NOT NULL DEFAULT 'COMPANY'
    CHECK (publish_scope IN ('COMPANY', 'ALL'));

COMMENT ON COLUMN pms_policies.publish_scope IS
  'Whether this company''s employees may be published from a cross-company '
  'list. COMPANY (default): only when their company is explicitly selected. '
  'ALL: they appear in the combined view too. Does not affect who may publish '
  'or whether a particular result is publishable.';

NOTIFY pgrst, 'reload schema';
