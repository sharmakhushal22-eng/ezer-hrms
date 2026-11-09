-- 202_pms_post_final_controls_owner.sql — who owns the appraisal AFTER the
-- rating is settled.
-- SAFE TO RUN TWICE. Adds one column with a default. No data change, no
-- constraint altered, nothing dropped, no UPDATE.
-- ----------------------------------------------------------------------------
-- ── THE DECISION ───────────────────────────────────────────────────────────
--
-- Requested: once the HOD finalises, the reports and final ratings move to
-- HR, and every step after the final rating — publishing the result, awarding
-- recognition, writing the feedback the employee reads — is run by HR from
-- their own PMS module. The HOD's part ends at the rating.
--
-- THIS DIVERGES FROM THE DOCX, and the divergence is the point of the column.
-- Stage 6 reads:
--
--   "Stage 6: Final Review One-to-One & Finalisation (RM / HOD): The
--    designated finaliser conducts a comprehensive wrap-up 1-on-1 with the
--    employee. The finaliser submits: (a) Final Rating, (b) Appreciation
--    Remark, (c) Improvement Feedback (mandatory if score <= 2), and
--    (d) Recognition Awards."
--
-- The spec gives all four to the finaliser. The instruction moves (b), (c)
-- and (d) to HR and leaves (a) with the finaliser. Both are defensible — the
-- HOD held the conversation, but HR owns consistency of recognition across
-- departments — so this is configuration rather than a rewrite, per the
-- standing instruction that the module "by default works as specified in
-- docx, but can be customized ... from admin side".
--
-- DEFAULT 'HR', because that is what was asked for and a company adopting
-- this build wants it on without hunting for a switch. A company that wants
-- Stage 6 as written sets 'FINALISER' and the HOD's tabs come back.
--
-- ── WHO "HR" IS HERE ───────────────────────────────────────────────────────
--
-- HR Manager AND HR Head, not HR Head alone. §2's matrix already gives
-- HR_MGR and HR_HEAD identical rights on every action except
-- configure_policy — give_feedback and upload_benefit are ✅ for both — so
-- restricting these controls to HR_HEAD would mean inventing a distinction
-- the matrix does not make, and editing the roles and permissions module,
-- which is load-bearing for every other module in the product. ADMIN is
-- included for the same reason 188 exempts it: it is the escalation path.
--
-- No value for 'HR_HEAD only' is offered, deliberately. An enum that cannot
-- be enforced without rewriting the permission matrix is a promise the
-- module cannot keep — the same reason the MD chain is absent from
-- pms_chain_rungs.
--
-- ── WHAT THIS COLUMN DOES NOT CHANGE ───────────────────────────────────────
--
-- Not the rating. HR still cannot alter a final rating through these screens;
-- that was settled earlier and 188's guards are untouched. This is about who
-- writes the words beside the number and who releases it.
--
-- Not the publication gate either. 200's trg_pms_publish_needs_signoff still
-- requires the final-review one-to-one to be acknowledged by both parties
-- before anything is published, whoever presses the button.

ALTER TABLE pms_policies
  ADD COLUMN IF NOT EXISTS post_final_owner text NOT NULL DEFAULT 'HR'
    CHECK (post_final_owner IN ('HR', 'FINALISER'));

COMMENT ON COLUMN pms_policies.post_final_owner IS
  'Who runs the appraisal after the rating is settled. HR (default): HR '
  'Manager, HR Head and Admin write the appreciation remark, improvement '
  'feedback and recognition awards, and publish. FINALISER: docx Stage 6 as '
  'written — whoever finalised submits all four and publishes. Never affects '
  'who may set the rating itself.';

NOTIFY pgrst, 'reload schema';
