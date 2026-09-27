# 05 · New features in the redesign

Everything the redesign shows that the current module does not. Each one is
optional and can be dropped without affecting the rest. "Data" says whether it
needs anything beyond what the tab already loads.

| # | Feature | Where | Data | Writes |
|---|---|---|---|---|
| 1 | **Duplicate guard** — "Already in pipeline at L2" instead of "Add to pipeline" | AI Screening | Candidates already in props; matches email within the MRF | none |
| 2 | **Bulk add** — "Add N new Strong matches" | AI Screening | Same | Calls the existing add handler once per candidate |
| 3 | **Next-step line** on every MRF and candidate card | MRF, Pipeline | MRF: none. Candidate: best with that candidate's `interview_rounds`; pass `[]` to stay on stage-only text with no new read | none |
| 4 | **"Your next steps"** dashboard panel | Dashboard | MRF items: none. HR Head item: `offer_approval_requests` count — omit if not loaded | none |
| 5 | **Send back with a reason** | HR Head | Needs an existing remarks column on the request | Only if that column exists |
| 6 | **Budget fit bar** (offer vs MRF ceiling) | Negotiation, HR Head | `budget_max` of the MRF — already loaded | none |
| 7 | **"Move to" picker** with locked-target reasons | Candidate modal | Rounds already loaded by the modal | Existing `moveStage` |
| 8 | **Interviews coming up** | Dashboard | `interview_rounds` for the next 7 days — **one new read**, scoped to the viewer's visible candidates | none |
| 9 | **Missing documents + Send reminder** | Pre-onboarding | Collection link data already loaded | Only if a reminder action already exists |
| 10 | **Sent recently** list | Send Offers | Offers the component already has | none |
| 11 | **Search, status filters, Cards/Table, Board/List** | MRF, Pipeline, Offer Approval, Job Status | In memory | none |
| 12 | **Inline help popovers** | Headers | none | none |
| 13 | **`/` to search, Esc to close** | Global | none | none |
| 14 | **Toast confirmations** | After writes | none | none |
| 15 | **KPI micro-visuals + count-up**, clickable KPI tiles | Dashboard | none | none |
| 16 | **Sticky tab rail** and sticky form footer | Global, MRF edit | none | none |
| 17 | **Responsive layout** below 1180px and 760px | Global | none | none |
| 18 | **Display font** Bricolage Grotesque for titles and numerals | Global | Google Font via `next/font` | none |

### The ones that touch data

Your brief is that data flows stay exactly as they are. So the **default is to
ship without new reads**: omit `interviews` (#8) and call
`candidateNextStep(c, [])` on the board (#3). Turn them on only after you
decide the extra read is worth it.

- **#3 on the board with rounds** needs rounds for every visible candidate — one batched `interview_rounds` read filtered to those candidate ids.
- **#8 Interviews coming up** adds one read. Keep it inside the same scoping
  as the candidates list: only rounds whose candidate is in the viewer's
  `candidates` prop. Or omit the `interviews` prop — the module hides itself.
- **#5 Send back with a reason** writes a reason only if the table already
  has somewhere to put it. Adding a column is out of scope for this redesign.

Everything else is derived from props already on the page.
