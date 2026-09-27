# 06 · QA checklist

Run the section for each PR, then the whole list before release. Test with at
least three logins: an **oversight** role (HR_HEAD or SUPER_ADMIN), an
**assigned recruiter**, and a **raiser/approver who is not a recruiter**.

## A. Visibility and scoping (every PR)
- [ ] Tabs shown to each login are exactly the same set as before (compare with production).
- [ ] With no screen-access rows configured for recruitment, every tab shows.
- [ ] HR Head tab appears only for HR Head.
- [ ] Raiser/approver sees the MRF but **not** its candidates.
- [ ] Two recruiters on the same MRF see the same candidate list.
- [ ] A non-cross-company user never sees another company's rows or company name.
- [ ] Network tab: no new Supabase request on tab switch, search, filter or view toggle.

## B. Requisitions
- [ ] Create as a user with an employee record → `MrfForm` opens with RM1/RM2/HOD prefilled.
- [ ] Create as a legacy login → inline ten-step form.
- [ ] Edit always opens the inline ten-step form.
- [ ] ₹6,00,000 exactly → Quick Hire accepted; ₹6,00,001 → the form warns before submit.
- [ ] Monthly stipend ₹50,001 → annualised and flagged as above the cap.
- [ ] Approval chain: MRF becomes APPROVED only when every step is approved; the stepper matches.
- [ ] ON_HOLD / REJECTED transitions unchanged.
- [ ] Attachments upload, list (`upload-mrf-doc?path=…`) and delete.
- [ ] `generate-jd` still drafts the JD.
- [ ] Status filter pills and search only hide cards; counts say "Showing X of Y".
- [ ] ESS "Raise MRF" looks and behaves as agreed (restyled or unchanged).

## C. AI Screening
- [ ] PDF, DOCX and TXT each score. Request has `multipart/form-data` with a browser-set boundary.
- [ ] One corrupt file → that row shows the error; the rest of the batch completes.
- [ ] Progress advances per file.
- [ ] MRF without a JD → JD synthesised from role, skills, experience, education.
- [ ] "Add to pipeline" creates the candidate at `AI Screened`.
- [ ] A result whose email already exists on the MRF shows "Already in pipeline" and cannot be added twice.
- [ ] Excel export unchanged.

## D. Pipeline and interviews
- [ ] Board columns follow STAGES; Rejected is not a column.
- [ ] No drag-and-drop anywhere.
- [ ] Candidate modal opens from the board and from the list.
- [ ] Backward move is impossible from the picker and still refused by `moveStage` if forced.
- [ ] Skipping ahead (e.g. L2 → Shortlisted) works as it does today.
- [ ] Moving past Shortlisted with a round missing feedback is locked, with the round named.
- [ ] Add Candidate: all eight sections; "No" on either knockout files the candidate as Rejected with the reason.
- [ ] CTC entered in lakh saves as rupees; experience years+months rounds; "Immediate" → 0 days.
- [ ] `interview-ai` questions and feedback modes both work; fenced JSON still parsed.
- [ ] `interview-invite` link still issued and opens.
- [ ] Esc and backdrop click close the modal; focus returns to the card.

## E. Offer flow
- [ ] Pre-negotiation checks block entry exactly as before; the disabled Save states why.
- [ ] Negotiation saves to `ctc_negotiations`; salary link shows only the breakdown.
- [ ] Budget fit compares rupees with rupees (enter ₹8.04 lakh vs ₹9,00,000 budget → within).
- [ ] Offer cannot be sent before HR Head approval.
- [ ] HR Head approve / send back behave as before; audit log rows written as before.
- [ ] `send-offer-email` sends; `offer-letter-image` still renders wherever it is referenced.
- [ ] Acceptance moves the candidate to Pre-onboarding.

## F. Pre-onboarding and Job Status
- [ ] Document links, `upload-doc`, `send-letter` (both letters) unchanged.
- [ ] Missing-document list matches the collection link state.
- [ ] Job Status flags match production for every MRF (FILLED … CANCELLED).
- [ ] Clicking a flag tile filters the board; zero-count tiles are disabled.
- [ ] `share-report` and export unchanged.

## G. Quality floor
- [ ] Light and dark mode on every tab (theme toggle and OS setting).
- [ ] `prefers-reduced-motion`: no entrance waves, no count-up, no pulses.
- [ ] Keyboard: every action reachable with Tab; visible focus ring; `/` focuses search.
- [ ] 1280px, 1024px and 390px widths: nothing clipped; board scrolls sideways.
- [ ] Buttons keep their shapes with the runtime stylesheet loaded (pills stay pills).
