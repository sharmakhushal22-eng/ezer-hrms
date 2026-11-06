# EZER Learn: feature decisions

Each candidate feature from the brief, with a verdict. "MVP" means built in this release.
Complexity is relative to this codebase. Evidence is in [research/lms-products.md](research/lms-products.md).

| Feature | Why it matters, or doesn't | Complexity | Phase |
|---|---|---|---|
| Automated email and in-app reminders | Deadlines without reminders are decoration. Sent as one daily digest, because Gmail has a daily limit and nobody wants ten mails | Medium | **MVP** |
| Training compliance tracking | The main reason a company buys an LMS | Low | **MVP** |
| Course expiry and recertification | Annual POSH and security training is standard in India. Modelled on completion, as most products do | Medium | **MVP** |
| Certificates with verification IDs | Common as templates, rarely verifiable. A low-cost way to be better than competitors | Low | **MVP** |
| Learning recommendations | A plain score from HR's picks, what your department takes, and what you finished. Machine learning has too little data at this size | Low | **MVP** (simple) |
| Skill tracking | Tag courses with the existing skills list and show skills gained. Gap analysis needs job-role profiles the HRMS lacks | Low | **MVP** (tags); Phase 3 for gaps |
| Learning paths | A named bundle above the course exists in nearly every product, and onboarding needs it | Medium | **MVP** |
| Training calendar | Self-paced learning has deadlines, not sessions. A list of due dates does the job | Low | Phase 2 |
| Course feedback and ratings | Tells HR what to fix, and helps the catalogue | Low | **MVP** |
| Course version management | Without it, editing a course changes what people are mid-way through and were certified on | High | **MVP** |
| Bulk assignment through Excel | HR lives in Excel. Validates everything before applying anything | Low | **MVP** |
| Bulk employee enrolment | Same thing as bulk assignment | Low | **MVP** |
| Assignment history | Needed to answer "who assigned this, and why" | Low | **MVP** |
| Assessment analytics | A quiz most people fail usually means a bad question. Pass rates per quiz | Low | **MVP**; per-question Phase 2 |
| Question banks | Random draw from a quiz's own pool is built. A bank shared across quizzes helps annual retesting, but only once libraries grow | Medium | Phase 2 |
| Learning content approval workflow | Found documented in only one product, yet compliance content needs a second pair of eyes. Optional, off by default | Low | **MVP** |
| Scheduled course publishing | Low effort with a daily job, and useful for policy launches. Re-validated at publish time | Low | **MVP** |
| Scheduled assignments | Same | Low | **MVP** |
| Drip-feed learning | Days after start, per module. Cheap once locks exist | Low | **MVP** |
| Gamification and badges | Corporate compliance learners rarely want it, and points need a programme to run them | Medium | Phase 3 |
| Training completion reports | Core | Low | **MVP** |
| Manager approval workflows | Per-course and optional, as in most products. Only for self-enrolment; assignments bypass it | Low | **MVP** |
| Training cost tracking | Self-paced internal content has little per-course cost. Matters with paid vendors | Low | Phase 3 |
| External learning resource links | Link lessons and resources. Completion is by acknowledgement, since an external site cannot report back | Low | **MVP** |
| SCORM 1.2 import | Not expected at this size until a customer brings a purchased library. Weeks of work, and Supabase cannot serve the unzipped HTML as it stands | High | Phase 3, on first paid request |
| xAPI, cmi5 | No demand at this size | High | Not planned |
| Quiz inside the video timeline | Only Workday verified. Quiz after the video gives the same evidence with far less to build and author | High | Not planned |
| Essay and manually graded questions | There is no instructor to mark them | Medium | Not planned |
| Offline learning | Offline products exclude hosted links and often tests, and it needs the native app | High | With native app |
| Native mobile app screens | All ten products have one. The Expo app is on an unmerged branch | Medium | Phase 2 |
| Auto-unenrol when someone leaves an audience | Surprising when a department field changes. Enrolment stays and HR can cancel it | Low | Phase 2, as an option |
| AI-generated quizzes | Gemini is already in the stack, and it would speed authoring. Not in the brief, and answers need human review | Medium | Phase 3 |
