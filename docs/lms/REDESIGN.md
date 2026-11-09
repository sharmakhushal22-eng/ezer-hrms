# EZER Learn: the standalone redesign (3 Nov 2026)

EZER Learn used to be a page inside the admin dashboard and a tab inside the ESS portal. It now
opens as a product of its own at **/learning**, the way Travel & Expenses opens at /ess/travel:
full screen, with its own navigation, and with the same sign-in.

## How people get there

| From | Goes to | Notes |
|---|---|---|
| ESS portal → Learning | `/learning` | Plain link, same tab. Someone *viewing another person's portal* still gets the old inline view, because /learning shows the signed-in person's own learning. |
| Dashboard sidebar → People → Learning | `/dashboard/learning` → `/learning/studio` | The old address forwards, so the sidebar, the module map, old notification links and ESS's admin host keep working. |
| ESS admin module "Learning" (HR in ESS) | `/learning/studio` | Same forwarder. |
| Candidate link `/learn/<token>` | unchanged page | Uses the new player, quiz and course-complete screens. |

**No second sign-in.** Every call already carries whichever session the person has
(`lib/auth-headers.ts`). An ESS session gets the learner screens, plus the Studio if their roles
grant any Learning module. A dashboard login without an employee record gets the Studio only.
A visitor with neither session sees a sign-in page with links to both logins.

**Back to EZER HRMS** is in the sidebar, the top bar and (on phones) the drawer. It goes to
`/ess` for employees and `/dashboard` for admins.

## Addresses

```
/learning                       Home
/learning/catalog?q=&cat=       Explore courses
/learning/course/<course id>    Course page
/learning/play/<enrolment id>?lesson=<lesson id>   Player (full screen, no sidebar)
/learning/my?tab=todo|going|done|requests|paths     My learning
/learning/achievements          Certificates, skills, history, quiz results
/learning/team                  Managers only
/learning/studio/<section>/<item>                   Studio (HR and L&D)
```

One Next page, `app/learning/[[...path]]/page.tsx`, renders `components/learning/app/LearnApp.tsx`.
Screens change with `history.pushState`, so nothing reloads and Back, refresh and pasted links work
(`components/learning/app/router.ts`).

## Look and feel

- `components/learning/learn.css` is the product's stylesheet, scoped under `.ezl` like te.css.
  Every surface and text colour is a `var(--ez-*)` token, so light and dark mode both work. The few
  colours the product has no token for (the hero's night sky, category artwork) are `--lx-*` with a
  dark value. Z-index uses the `--ez-z-*` tiers only.
- Fraunces for headlines, DM Sans for everything else (both already loaded by the app).
- A course without a thumbnail gets generated artwork in a colour derived from its id, so no card is
  ever blank.
- Layouts: desktop with a dark sidebar; under 1100 px the sidebar becomes an icon rail; under 760 px
  it becomes a drawer, and a bottom tab bar appears.

## Learner screens

- **Home:** a hero with a greeting and the one course to pick up, with live counts. Then shelves:
  needs your attention (overdue and mandatory), continue learning, assigned to you, recommended,
  browse by category, featured by HR, recently added, popular with colleagues, and 15-minute
  courses. Beside them: upcoming deadlines, learning paths, waiting for approval, milestones
  (earned from the record, nothing awarded by hand) and recently completed. Empty shelves are left
  out.
- **Explore:** a spotlight on a featured course, search, category chips, sorting (best match,
  newest, most taken, highest rated, shortest, A to Z), and filters for level, length, content
  type, your progress and compliance. Learning paths appear below.
- **Course page:**
  - a hero with crumbs, tags, rating, learners, length, lessons, level, language and date updated;
  - a card with the one action that applies (enrol, request, start, continue, review, retake);
  - "This course includes";
  - **What you'll learn**: lines in the description that start with `- ` (or a bullet or a
    number) become this checklist;
  - fact tiles;
  - curriculum by module, with every lesson's type, length, quiz and question count, and a
    **Preview** button on free-preview lessons;
  - **Assessment and completion**: the version's completion rule, its order, and each quiz's pass
    mark, attempts and time limit;
  - prerequisites, the about text with skills, and reviews.
- **My learning:** tabs for to do, in progress, completed, requests and paths, with a completion ring.
- **Achievements:** totals, certificate cards (PDF download and the public verification page), skills,
  a history timeline and every quiz attempt.

## The player

- Lesson on a dark stage, course outline on the right (modules collapse; each lesson shows done,
  locked with the reason, current, type, length, quiz state). On tablets and phones the outline
  slides in.
- Top bar: back, course and lesson, mandatory and due, a progress ring, outline toggle.
- Under the stage: lesson title and tags, Previous and Next, the "lesson finished" note, mark
  complete and sign-off, the quiz card, then Overview, Downloads and About this course tabs.
- Order rules (sequential, module by module, free), drip dates, quiz gates, retries, cooldowns and
  completion are all still decided by `lib/lms/engine.ts`; the screen only draws them.

### Video and audio (`components/learning/VideoPlayer.tsx`)

- **Sound on.** Nothing mutes the element. It starts at the volume the person last chose (kept in
  their browser), and playback starts only from a click or a key, which is what lets browsers play
  sound.
- Controls: play and pause, back and forward 10 s, mute, volume slider, time, speed (0.5× up to the
  course's maximum, 2×), captions, picture-in-picture, full screen. Keyboard: Space or K, J and L,
  arrow keys, M, F, C, `<` and `>`. Click toggles play, double-click goes full screen.
- The timeline shows what has been buffered and watched, and hatches the part that cannot be
  skipped into yet when the lesson does not allow skipping ahead.
- Loading spinner, automatic retry with a fresh link (twice), then a "Try again" message.
- Resume from the last position, and progress reporting, are unchanged (PlayerMedia's heartbeat).
- **Captions:** attach a `.vtt` file to the lesson as a download. Any download named `.vtt`, or
  titled "captions" or "subtitles", becomes a captions track, and is on by default. The file is
  stored as plain text (the bucket from migration 206 does not list `text/vtt`), and the player
  fetches it and hands it to the video as a same-origin blob.
- **Delivery.** Progressive MP4 from private Supabase Storage on a signed URL, with range requests
  (206) and `faststart` files (the uploader refuses ones that are not). That plays at the file's
  own quality. Adaptive streaming (HLS with several qualities) needs a transcoding service such as
  Cloudflare Stream or Mux. The schema already allows a `CLOUDFLARE_STREAM` provider. It is a paid
  service, so it has not been switched on; see research/video-delivery.md for costs. **It needs
  your approval.**

### PDFs and slides (`components/learning/PdfDeck.tsx`)

- pdf.js draws each page as vector graphics at the screen's pixel density, and redraws it on every
  zoom, so text stays sharp. A text layer makes the words selectable.
- One page at a time like a presentation:
  - previous and next (buttons, arrow keys, Page Up and Page Down, Space, clicking either side of
    the page, swiping on a phone), Home and End, and a page number you can type;
  - zoom in and out, fit to width and fit to page;
  - a thumbnail strip, ticked once a page has been seen;
  - a slide transition, and "n of N seen";
  - full-screen presenting, where the toolbar fades away when the mouse is idle.
- **Progress:** the page you are on and the pages you have seen are saved on the server
  (`event: 'page'`, stored as page runs in `lms_lesson_progress`), so coming back on any device
  opens where you were. For **Slides** lessons, Mark complete waits until every slide has been
  seen. Documents show the count but do not wait. The server's minimum-time rule still applies to
  both.

### Quizzes (`components/learning/PlayerQuiz.tsx`)

- One question at a time, with lettered options, true or false as two large buttons, and short
  text. A question map shows answered, current, and marked or missing questions. There is "Mark
  for review", a timer that pulses in the last minute, and keys A to D or 1 to 4.
- Unsent answers survive a refresh (sessionStorage).
- The result shows a score ring, pass mark, score, number correct and attempts left. It then offers
  next lesson, retry (respecting cooldowns), go through the lesson again, or back. Answer review
  marks correct answers in green and wrong picks in red, with explanations, whenever the quiz's
  "show answers" setting allows it.

### Course complete

A celebration header with the trophy, download the certificate, review the lessons, a certificate
card, a star rating with a comment, and the next course to take.

## The Studio (HR and L&D)

`components/learning/studio/`:
- **Frame:** section navigation grouped Build, Deliver, Measure, Govern (filtered by the person's
  Learning permissions), with the company picker in each section header.
- **Overview:** live figures from `lms_overview` only.
- **Courses:** cover cards and a table with every old column.
- **Builder:** cover upload, save state, **Preview as learner**, and steps Details → Content →
  Completion rules → Who can find it → Publish.
- **Curriculum board:** drag lessons within and between modules and drag modules (the up and down
  buttons stay for the keyboard), add lessons from an icon picker, inline rename, and upload
  progress with speed and time left.
- **Preview:** `GET /api/lms/admin/preview?lesson=` signs a draft lesson's files for someone with
  view-content rights in that company. Nothing is recorded.
- **Assignments:** a four-step wizard (what, who, rules, review). Who: people, groups, whole company
  (organisation-wide rights only) or Excel. Rules: one time or keep applying, mandatory, due,
  start date, priority, reminders. It links to Automation for new joiners and to Preboarding for
  candidates.
- Paths, Automation, Preboarding, Reports, Certificates, Settings and Audit keep every feature in
  the new frame.

## What changed outside the screens

- `lib/lms/me.ts`: the catalogue adds lesson count, content types, quiz count, learners and
  published date for each course. The course page adds category, learners, rating, the version's
  rules, and for each lesson: preview, required, final, sign-off, file length and quiz facts.
  `previewLesson` serves free previews (`/api/lms/me/catalog/<id>?preview=<lesson>`), only for
  published preview lessons of a course the person may see.
- `lib/lms/engine.ts`: `pageMark` for the document bookmark (`event: 'page'`).
- `lib/lms/upload-client.ts`: `.vtt` is uploaded as `text/plain`.
- `components/ess/EmployeePortal.tsx`: Learning links to /learning, except when viewing someone
  else's portal.
- `app/dashboard/learning/page.tsx`: forwards to /learning/studio.
- **No migration, no new table, no new paid service.** RLS stays on, and the API is still the only
  way in.

## Demo data added for this

"CLAUDE TEST Demo 5: Workplace Security" in Sharma Retail is your example course. It has:
- module 1 with five short narrated videos (Introduction, Password, Email, Device, Best practices),
  each with captions and its own quiz;
- module 2 with a 20-slide deck;
- module 3 with a final assessment.

Lessons open in order. It is assigned (mandatory, due in 7 days) to Kiran (SRS9047) and Rohan
(SRS9042), and open to everyone else to enrol. The media and the scripts that made it are in
`~/Downloads/ezer-learn-demo/media/security` and `seed/make-security.mjs`, `seed/seed-security.mjs`.

## Tested (3 Nov 2026, real Chrome against the local app and the shared Supabase project)

Two learners went through Demo 5 from start to finish:
- Kiran in two runs, because the first was interrupted when the dev server reloaded the page after
  a code edit;
- Rohan in one clean run, which passed 28 of 29 checks. The one failure was a React warning in the
  slide viewer, since fixed and rechecked with no errors.

What the runs proved:
- **Video:** it starts with sound (not muted, volume 1, audio decoded), captions load from the
  `.vtt` and show, the speed menu works and M mutes and unmutes.
- **Quizzes:** each video counts as watched only after it has been played, each quiz passes and
  opens the next lesson, and the final assessment passes.
- **Slides:**
  - the 20 slides render with selectable text;
  - the arrow keys reach slide 20 and all 20 count as seen;
  - presentation mode goes full screen;
  - Mark complete waits for every slide and the minimum time;
  - after a reload the deck reopens on the saved page.
- **Course complete:** the completion screen shows and the certificate is issued.
- **Other screens:**
  - the free preview plays with sound;
  - search from the top bar, the category chips and the Back button work;
  - ESS Learning opens /learning without signing in again, a manager sees My team, and "EZER
    HRMS" goes back to ESS;
  - tablet (820 px) and phone (390 px) layouts have no sideways scrolling.
- **Studio:** all ten sections open without console errors, and drag-and-drop persists after a
  reload.

Not tested:
- the candidate link end to end (it needs the e-mailed code);
- real phones and Safari;
- videos over 50 MB;
- the PDF attachment mentioned in the brief, which did not arrive; tested with the generated
  20-slide deck instead.

Full test suite: 2200 tests, 15 failing and 5 cancelled, the same as before. None of them is a
Learn, theme, z-index or ESS-link test. Type-check: the repo's 39 existing errors, none in Learn.

## Speed (3 Nov 2026, later)

**What was slow.** From this Mac, each call to Supabase takes about 300–400 ms, and the screens
made theirs one after another: the course page took about 10 rounds in a row, and home, the
catalogue and the player 6–9 each.

**What changed.** Independent reads now run together:
- the learner lookup;
- the course page (3 rounds);
- home (2);
- catalogue (2–3);
- the player view;
- opening a lesson (3);
- progress beats (2);
- the team view.

Two things are now remembered between clicks:
- a learner's lookup, for 30 seconds (access itself is still checked on every call);
- signed thumbnail links, for 45 minutes.

The app's start asks only who you are (`overview?lite=1`), and the Studio fetches its figures when
it opens. The course page draws its header from the card that was clicked while the rest loads.

**Results**, second visit, measured locally:

| Request | Before | After |
|---|---|---|
| Home data | 3–4 s | about 1 s |
| Catalogue | 3.2 s | 1.3–1.6 s |
| Course page | 4–7 s | about 1.5 s |
| Player | 2.5–5 s | about 1 s |

The deployed site is several times faster again, because Vercel sits next to Supabase. In
development, every route also compiles on its first visit and after each code change, which can
take 10–30 s; that does not happen in production.

**Quiz after a video.** When the server reports a video as watched, the player now shows it at
once: the lesson is marked done and its quiz opens. It then refreshes the course in the background,
retrying if the connection drops, and again when the tab becomes visible. The quiz card also has
a "Check again" link. Tested with the refresh deliberately dropped: the quiz still opened.

### 4 Nov 2026: stalls, revisits, development mode

**Stalls.** From this Mac, some calls to Supabase hang for close to a minute, or fail to connect at
all (`ConnectTimeoutError` after 10 s). A request that took 57 s then came back as a false "not
found" from the player. Two changes:
- `lib/resilient-fetch.ts` makes reads give up after 8 s and retry once on a fresh connection, with
  15 s for the retry. Writes are never repeated. It is used by Learning's database client, the
  sign-in check (`lib/api-auth.ts`) and the permission lookup (`lib/rms/server.ts`).
- `myEnrollment` now reports a database error as an error, not as "That course was not found".

**Revisits.** `components/learning/app/cache.ts` keeps what was already fetched, so a screen seen
once opens at once and then refreshes:
- home and the catalogue, also kept in sessionStorage for this tab and filed under the signed-in
  employee, so another person signing in on the same tab never sees them;
- course pages, the player's course view and achievements.

Hovering over or focusing a card starts loading what it opens.

**Measured in Chrome** on a local production build:

| Screen | Time to content |
|---|---|
| Home, return or reload | under 0.1 s |
| Catalogue | under 0.1 s |
| Course page | header 0.4 s, complete 1.2 s |
| Player, first open | 4 s |
| Player, return | 2.7 s |

The player is still bound by two requests in a row over a connection that costs about 340 ms per
database call.

**Development mode is slower than it looks.**
- Each route compiles on first use and after every code change, which can take 10–30 s.
- Editing modules that are not plain components makes open tabs reload in full: one tab reloaded a
  course page 239 times while code was being saved.
- A long-running dev server picks up stale state. Restart it after a day of edits.

To judge speed locally, use a production build:

```
NEXT_DIST_DIR=.next-verify npx next build
git checkout -- tsconfig.json
GMAIL_USER= GMAIL_APP_PASSWORD= NEXT_DIST_DIR=.next-verify npx next start -p 3001
```

## 6 Nov 2026: webinars, SCORM, mail, motion

Needs `supabase/migrations/211_lms_live_and_scorm.sql` (209 and 210 belong to the PMS branch).

### Mail
- The manager now gets an **email** (not only the bell) when someone in their team is overdue:
  one mail per manager listing everyone, from the first overdue day (setting: "Tell the manager
  after", default now 1; at most weekly per person). Link: My team in EZER Learn.
- HR's **Remind** on an enrolment sends an email as well as the bell.
- Every Learning mail and bell links to `/learning`, not the old ESS page.

### Live sessions (webinars) — `lib/lms/live.ts`, `components/learning/Live*.tsx`, `studio/StudioLive.tsx`
- The call is the company's own Zoom, Meet or Teams link. EZER Learn holds the schedule.
- **Studio → Live sessions:** create (date and time in IST, length, link or room, host, seats,
  open to everyone or invited only, part of a course), invite with the assignment audience
  picker, edit (a calendar change re-sends the invitation with a higher SEQUENCE), cancel
  (sends a calendar cancellation), the register with attendance ticks and "mark everyone
  attended", the attendance code to read out, mark as held, upload the recording.
- **Learner → Live sessions:** the next session with a live countdown, Register / Accept /
  Can't make it, Add to calendar (.ics), **Join** (the link is only handed out from 15 minutes
  before to 30 minutes after), the attendance code, recordings (watching 90% counts as
  attending; credit is capped at double speed against the server clock).
- **Mail:** invitation with a calendar file (immediately for up to 25 people, the rest in the
  6 am IST job), the day before, the morning of, cancellation, and the recording to
  registered people who missed it. The calendar file also alerts 15 minutes before.
- **In a course:** a *Live session* lesson completes when the learner attended any session
  linked to that course, or watched its recording — including one attended before enrolling.
- Session hosts with assignment rights can upload the recording (video only) without
  course-editing rights.

### SCORM — `lib/lms/scorm*.ts`, `app/learn-scorm/[token]/[...path]`, `components/learning/PlayerScorm.tsx`
- Lesson type **SCORM package**: upload the .zip exported as SCORM 1.2 or 2004 (Storyline, Rise,
  Captivate, iSpring…), up to 1 GB. The manifest is read at upload; a zip that is not a package
  is refused with the reason.
- The zip is stored once and never unpacked: each file is read out of it with a range request,
  so the bucket's allowed types did not change. Stored video inside a package can be seeked.
- **Security:** the package runs in a sandboxed frame with an opaque origin, so its JavaScript
  cannot read EZER's session. Its pages get a SCORM API (1.2 *or* 2004, per the manifest) filled
  with the learner's saved data; commits are posted to the player and saved by the server.
  The address carries a signed token (10 hours), so relative links inside the package work.
- **Completion:** completed or passed finishes the lesson; failed does not; a 1.2 package with a
  mastery score is judged on its score. Resume (location, suspend data) and total time are kept.
  "Start over" clears an unfinished run. A finished lesson stays finished.
- Known limit: a package whose frames script each other directly (rare, older custom builds)
  cannot, because each frame is its own sandbox. Single-page exports from the common tools work.

### Motion — `components/learning/motion/*`, `motion.css`
Spotlight carousel on Home and the catalogue, shelf arrows and edge fades, aurora backgrounds,
count-up figures, rings and bars that fill on arrival, card tilt and light (mouse only),
certificate sheen, scroll reveals, and a cross-fade between screens (View Transitions). All of
it stops for anyone whose device asks for reduced motion; the carousel has a pause button.

### Tested
- Unit: `lib/lms/__tests__/scorm-core.test.ts` (zip reading, manifests, outcomes, the runtime)
  and `live-core.test.ts` (join and check-in windows, recording credit, the calendar file).
- End to end (`scripts/lms-e2e`, now applying 211): **92 passed, 0 failed** — the 75 existing
  scenarios plus SCORM upload/refusal/serving/ranges/forged links/resume/mastery/completion and
  webinar invite/visibility/seats/sequence/join window/check-in/host ticks/recording credit/
  cancel/cross-company refusal.
- Real Chrome against the rig: SCORM 1.2 and 2004 packages run, greet the learner, resume after a
  reload, fail then pass, complete the lesson; the package's attempt to read the parent page's
  storage is blocked; Join opens the meeting; the attendance code completes the course; the
  Studio list, register and form; the builder preview runs the package read-only. Live sessions
  page has no sideways scroll at 1440, 820 and 390. No page errors.
- Not yet run against the shared Supabase project: needs migration 211 first.
