# EZER Learn

The self-paced learning module of EZER HRMS. Centrally managed content, no instructor role.
HR builds courses from short videos, documents and quizzes, publishes them to a company
catalogue, and assigns them to people, groups or new joiners. The system tracks progress,
enforces passing rules, chases deadlines and issues verifiable certificates.

| Read this | For |
|---|---|
| [SETUP.md](SETUP.md) | What must be done before it works: migrations, Supabase plan, one 15-minute check |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The blueprint: features, roles, permissions, workflows, schema, security, video, phases, testing |
| [FEATURE-DECISIONS.md](FEATURE-DECISIONS.md) | Each candidate feature: useful or not, how hard, and which phase |
| [IMPLEMENTATION-REPORT.md](IMPLEMENTATION-REPORT.md) | What was built, test results, and what is outstanding |
| [research/lms-products.md](research/lms-products.md) | Ten LMS products and four Indian HR suites, with source links |
| [research/video-delivery.md](research/video-delivery.md) | Video hosting options, a worked cost model, upload and tracking design |

## Where it lives

```
supabase/migrations/206_lms_schema.sql    27 tables, RLS, storage bucket
supabase/migrations/207_lms_engine.sql    bulk enrolment, sweeps, cloning, reporting functions
supabase/migrations/208_lms_roles.sql     three new roles and the permission matrix
supabase/verify/208_lms_verify.sql        read-only checks to run after them

lib/lms/core.ts            the rules, pure and unit-tested
lib/lms/caps.ts            permissions
lib/lms/access.ts          who is asking, and how far they reach
lib/lms/learner.ts         the employee or candidate behind a request
lib/lms/engine.ts          taking a course: player, heartbeats, quizzes, completion
lib/lms/authoring.ts       building and publishing
lib/lms/assign.ts          assignments, enrolment actions, Excel import
lib/lms/preboarding.ts     candidates: invite, sign-in, conversion
lib/lms/daily.ts           the nightly job

app/api/lms/**             admin, learner, team, candidate and public routes
app/dashboard/learning/    the HR workspace (also reachable inside ESS)
components/learning/       employee and manager screens, course player
app/learn/[token]/         the candidate portal
app/learn/verify/[code]/   public certificate check
```
