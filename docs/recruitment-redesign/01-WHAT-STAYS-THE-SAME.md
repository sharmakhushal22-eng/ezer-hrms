# 01 · What stays the same

This redesign is a **presentation-layer change**. It must not alter how the
Recruitment & ATS module reads data, writes data, scopes rows, moves
candidates, or approves anything. This file is the contract. Every item here is
taken from the module's own documentation (`CORE-WORKING.md`, `DATA-FLOW.md`,
`API-ROUTES.md`, `WORKING.md`) and must hold after the change.

If an implementation step seems to require breaking one of these, stop — the
step is wrong, not the contract.

---

## 1. API routes — unchanged, all ten

No route is added, removed, renamed, or given a new method. Call sites keep
their current request shape.

| Route | Methods | Stays called from |
|---|---|---|
| `screen-resumes` | POST | AI Screening — still `multipart/form-data`, still **no `Content-Type` header** set by hand, still one `try/catch` per file |
| `interview-ai` | POST | Pipeline / interview modal — `type:'questions'` and `type:'feedback'`, fenced-JSON stripping kept |
| `generate-jd` | POST | MRF form |
| `interview-invite` | GET, POST | Interview scheduling |
| `send-offer-email` | POST | Send Offers |
| `send-letter` | GET, POST | Pre-onboarding |
| `offer-letter-image` | GET | Referenced as a URL, not fetched — do not remove |
| `upload-doc` | POST | Pre-onboarding |
| `upload-mrf-doc` | POST, GET, DELETE | MRF attachments |
| `share-report` | POST | Job Status |

The kit's components never call `fetch()`. Buttons receive callbacks, and those
callbacks are the existing handlers.

## 2. Data flow — unchanged

```
useGrant() ─▶ grantLoading === false ─▶ loadAll() ─▶ props to 11 tabs
                                             ▲
                                    onRefresh() after writes
```

- `loadAll` (page.tsx:286) keeps its five parallel queries and its
  `companyFilter` / `scopedCompanies` logic. **No query is added to it.**
- Tabs still receive the same props. The kit adds an adapter step
  (`toMrfVM`, `toCandidateVM`) that only reshapes those props for display.
- Writes still go straight from the browser to Supabase (or to the ten routes)
  and are followed by `onRefresh()`. No local cache mutation is introduced.
- Search, status filters and Cards/Table · Board/List switches in the new UI
  run **in memory over data the tab already has**. They never query.

## 3. Row scoping and visibility — unchanged

- `OVERSIGHT_CODES` and the `oversight` expression stay as they are.
- MRFs visible when assigned recruiter **or** raiser **or** approver.
- Candidates visible **only** to the assigned recruiter(s) of their MRF.
  The asymmetry is deliberate and must survive.
- Tab visibility: `canSeeScreen(grant, 'recruitment.<tabkey>')`, including the
  "no rows configured → all tabs visible" rule, plus the hard HR Head gate on
  `hrhead`. The new `<TabRail>` receives the already-filtered list and never
  decides visibility itself.

## 4. Requisition lifecycle — unchanged

```
DRAFT → SUBMITTED → APPROVED → CLOSED
             ↓  ↑
         ON_HOLD  REJECTED
```

- `QUICK_HIRE_CAP = 600000` and the lane check in the form stay authoritative.
  Monthly stipends are still annualised before the comparison.
- `REQ_TYPES` unchanged.
- The approval chain is still an ordered list of steps (role, approver,
  status); an MRF is APPROVED when every step is. The new stepper only draws it.

## 5. Candidate pipeline — unchanged

```
Applied → AI Screened → Telephonic → L1 → L2 → Optional Round
        → Shortlisted → Offer Sent → Joined          (Rejected — terminal)
```

- `moveStage` stays the only way a stage changes. It still refuses backward
  moves with its explicit message.
- Moving **past** Shortlisted still requires feedback on every scheduled round.
- Rejected stays out of the funnel.
- There is **no drag-and-drop** on the new board, on purpose: a drag would be a
  second code path for stage changes.
- The new "Move to" picker (`moveOptions()`) only *displays* which targets
  `moveStage` would accept and why others are locked. Its selection is passed
  to the existing `moveStage`.

## 6. Offer and approval flow — unchanged

Negotiation → Offer Approval → HR Head → Send Offers → Offers → Pre-onboarding.

- Pre-negotiation checks still gate Negotiation.
- `ctc_negotiations` writes and the tokenised candidate salary link unchanged.
- HR Head sign-off in `offer_approval_requests` is still required before
  an offer can be sent.
- An acceptance still moves the candidate to Pre-onboarding.

## 7. Two intake forms — unchanged

| Condition | Component |
|---|---|
| New MRF, user has an employee record | `components/ess/MrfForm.tsx` (shared with ESS "Raise MRF") |
| Edit, or legacy login with no employee record | Inline ten-step form in page.tsx |

⚠️ `MrfForm.tsx` is **shared with ESS**. Restyling it changes ESS too. See
`03-TAB-BY-TAB.md` → MRF for how to scope that.

## 8. Units — unchanged, and now surfaced

| Value | Stored | Entered |
|---|---|---|
| `current_ctc`, `expected_ctc` | rupees | ₹ lakh p.a. × 100000 |
| `budget_min`, `budget_max` | rupees | rupees |
| `experience_years` | whole years | years + months, rounded |
| Notice period | days | days, "Immediate" → 0 |

`derive.ts` formats rupees (`formatINR`, `formatLakh`) and exposes
`lakhToRupees` so the new budget-fit bar compares like with like.

## 9. Things deliberately left alone

- `CandidateDrawer` (page.tsx:4027) is dead code. The redesign does not revive
  it. Deleting it is a separate, optional clean-up.
- `application_details` fallback insert (migration 121) unchanged.
- The runtime stylesheet in `lib/ui/index.tsx` is not edited; the redesign CSS
  scopes its overrides under `.rx`.
