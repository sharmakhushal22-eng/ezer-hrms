# 03 · Tab by tab

For each tab: what replaces what, which existing handlers are kept, and what to
leave alone. "Keep" means: do not change the function, its query, or its
arguments — only where it is called from.

---

## 1. Dashboard — `DashTab` → `<DashboardView>`

```tsx
<DashboardView
  rail={rail}
  mrfs={mrfVMs}
  candidates={candVMs}
  stages={STAGES}
  joinedThisMonth={joinedThisMonth}         // keep DashTab's current calculation
  todos={dashboardTodos({ mrfs: mrfVMs, viewerName: me.name })}
  interviews={upcoming}                     // OPTIONAL, see 05-NEW-FEATURES #8 — omit to hide
  onTab={setTab}
  onOpenCandidate={openCandidateModal}      // keep
  onRaiseMrf={openCreateMrf}                // keep: MrfForm path
/>
```

Read-only. No writes on this tab.

## 2. MRF — `MRFTab` → `<MrfListView>` + drawer shell

```tsx
<MrfListView
  rail={rail}
  mrfs={mrfVMs}
  companyLabel={currentCompanyName}
  filterBar={<ExistingFilterBar … />}       // pass through unchanged
  quickHireCap={QUICK_HIRE_CAP}
  onCreate={openCreateMrf}                  // keep: MrfForm when employee record, else inline form
  onEdit={openEditMrf}                      // keep: inline ten-step form
  onView={openMrfDrawer}                    // keep
  onMore={openCardMenu}                     // keep (delete etc.)
  canEdit={m => existingCanEdit(m.raw)}     // keep whatever rule the tab uses today
/>
```

**Detail drawer** — replace only the container:

```tsx
<RxDialog open={!!drawerMrf} onClose={closeDrawer} variant="drawer" label="Requisition detail">
  {/* existing drawer content: meta, budget, approval chain, attachments (upload-mrf-doc), audit trail */}
</RxDialog>
```

Inside, swap the approval chain list for `<Timeline>` or `<ApprovalChain>`; keep
the attachment handlers (`upload-mrf-doc` POST/GET/DELETE) exactly.

**Inline ten-step form (edit path)** — layout only:

```tsx
<div className="rx-grid">
  <aside className="rx-mod s3">
    <div className="rx-track"><i style={{ width: `${(step / 10) * 100}%` }} /></div>
    <nav className="rx-vs">{STEPS.map((s, i) => (
      <button key={s} type="button" className={`rx-vsi ${i < step ? 'done' : i === step ? 'now' : ''}`} onClick={() => setStep(i)}>
        <span className="rx-sd">{i < step ? <Icon name="check" /> : i + 1}</span>{s}
      </button>))}
    </nav>
  </aside>
  <section className="rx-mod s9">{/* existing step body */}
    <div className="rx-footbar">…existing Back / Next…</div>
  </section>
</div>
```

Keep: the lane check against `QUICK_HIRE_CAP` (show its message in
`<Callout tone="warn">`), `generate-jd`, attachments, validation.
Only let the stepper jump between steps if the current form already allows it;
otherwise render the items as non-interactive `<div>`s.

**`MrfForm.tsx` (create path)** is shared with ESS. Two options:
- restyle it and accept that ESS "Raise MRF" changes too, or
- wrap its call site in `<div className="rx">` and add rules under `.rx` only,
  so ESS keeps its current look.

## 3. AI Screening — keep `ScreeningTab`, swap result markup

```tsx
{results.map(r => (
  <ScreeningResultCard key={r.fileName}
    r={toScreenResult(r)}                                   // map the route's JSON 1:1
    existing={existingCandidate(r.email, mrfId, candVMs)}   // NEW duplicate guard (05 #1)
    onAdd={() => addToPipeline(r)}                          // keep: writes stage 'AI Screened'
    onOpenExisting={() => openCandidateModal(existing.id)}
    onRetry={() => retryFile(r.fileName)} />                // only if a retry exists today
))}
```

Keep untouched: the upload loop, `multipart/form-data` without a manual
`Content-Type`, per-file `try/catch` with the synthetic NOT_SUITABLE result,
per-file progress, JD synthesis, Excel export.
Upload area: `.rx-drop`; progress: `<Track pct=…/>`; the file in flight:
`.rx-li.rx-scan` with `<Badge tone="brand" live>Scoring</Badge>`.

## 4. Pipeline — `PipelineTab` → `<PipelineView>` + modal shell

```tsx
<PipelineView
  rail={rail}
  candidates={visibleCandVMs}                 // what the tab shows today, filters applied
  stages={STAGES}
  nextStepFor={c => candidateNextStep(c, roundsFor(c.id))}   // roundsFor: see 05 #3
  onOpen={openCandidateModal}                 // keep
  onAddCandidate={openAddCandidateForm}       // keep: 8 sections + knockout questions
  openingSelect={<ExistingOpeningSelect />}   // pass through
  filterBar={<ExistingFilterBar />}           // pass through
  onShowRejected={showRejected}               // keep, if it exists
/>
```

**CandidateInterviewModal** — container and move control only:

```tsx
<RxDialog open={!!cand} onClose={close} variant="modal" label={cand?.name ?? 'Candidate'}>
  {/* existing: rounds, interviewers, InterviewFeedbackForm, interview-ai questions, interview-invite */}
  <div className="rx-move" role="radiogroup" aria-label="Next stage">
    {moveOptions(STAGES, cand.stage, rounds).map(o => (
      <label key={o.stage} className={o.allowed ? '' : 'off'}>
        <input type="radio" name="mv" disabled={!o.allowed} checked={target === o.stage} onChange={() => setTarget(o.stage)} />
        <b>{o.stage}</b><small>{o.reason ?? ''}</small>
      </label>))}
  </div>
  <button className="rx-btn p" disabled={!target} onClick={() => moveStage(cand, target)}>Move candidate</button>  {/* keep moveStage */}
</RxDialog>
```

`moveStage` remains the authority. If it refuses, show its message as it does today.

## 5. Negotiation — keep `NegotiationTab`, restyle

- Candidate list → `.rx-li` rows in a `<Module title="Ready to negotiate">`.
- Pre-negotiation checks → the existing checks, rendered as check rows; when a
  check fails, show `<Callout tone="warn">` with the fix, and put
  `<span className="rx-why"><Icon name="lock"/>…</span>` next to the disabled Save.
- CTC breakdown → `<PropBar>` above the existing inputs; amounts via `formatINR`.
- Hike → `hikePct(current_ctc, totalCtc)`.
- Budget fit (NEW, 05 #6) → `budgetFit(totalCtcRupees, mrf.budget_max)` + `<Track>`.
- Keep: `ctc_negotiations` write, the salary-link token generation, the lakh→rupee conversion.

## 6. Offer Approval — keep `OfferApprovalTab`, restyle

- Raise form → `<Module tone="brand">`; submit button unchanged (writes `offer_approval_requests`).
- Each request → card with a three-step `<ApprovalChain>`: Raised → HR Head → Ready to send,
  built from the request's status.
- Status filter (NEW, in-memory) → `<Segmented>` or `<FilterPills>` over the list.
- Per-status action: Approved → `setTab('sendoffer')`; Sent back → `setTab('negotiation')`.

## 7. HR Head — `HRHeadApprovalDashboard` (offer-flow-components.tsx)

- Keep the HR Head gate exactly (tab gate + whatever the component checks).
- Card tiles: Offered CTC / MRF ceiling / Hike; `.rx-tile.crit` when over ceiling.
- Approve / Send back → existing handlers.
- Send back with reason (05 #5): only if the request row already has a
  remarks/reason column. If it does not, keep the current Send back and skip
  the reason box — do **not** add a column as part of the redesign.
- Audit trail → `<Timeline>` from the existing `recruitment_audit_logs` read, newest first.

## 8. Send Offers — `HRManagerSendOffer` (offer-flow-components.tsx)

Three columns: approved-not-sent list · letter preview (`.rx-paper`) · send form.
Keep `send-offer-email` POST and the letter generation. "Sent recently" (05 #10)
uses offers the component already has; omit if it needs a new read.

## 9. Offers — keep `OffersTab`

Tiles (Sent / Accepted / Awaiting / Declined) from the existing list; each offer
card uses `<ApprovalChain steps={[{role:'Sent',…,status:'APPROVED'},{role:'Candidate reply',…}]}/>`.
Acceptance → Pre-onboarding logic unchanged.

## 10. Pre-onboarding — keep `PreOnboardTab`

- Days to joining → `daysUntil(doj)` in the header chip.
- Documents → check list + `<Ring>` (received/total) from `document_collection_links`.
- Missing documents summary → `missingDocuments()`.
- "Send reminder" (05 #9) → only wire it to an existing reminder action.
- Letters → rows with `<Badge>`; keep `send-letter` GET/POST and `upload-doc`.

## 11. Job Status — `JobStatusTab` → `<JobStatusView>`

```tsx
<JobStatusView
  rail={rail}
  rows={mrfVMs.map(m => ({ m, standing: existingStanding(m.raw), note: existingNote(m.raw), elapsedPct: existingElapsed(m.raw) }))}
  recruiterTable={<ExistingRecruiterTable />}   // pass through
  onOpenMrf={openMrfDrawer}
  onShare={shareReport}                         // keep: share-report POST
  onExport={exportReport}                       // keep
/>
```

`standing` must come from the tab's current calculation (FILLED · ON_TRACK ·
WATCH ≤3w · CRITICAL ≤1w · BREACHED · NO_DEADLINE · AWAITING · CANCELLED).
