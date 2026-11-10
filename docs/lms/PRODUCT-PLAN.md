# EZER Learn as a product of its own: research, plan and what was built (10 Nov 2026)

Written for whoever builds, sells or tests EZER Learn. Branch `feat/lms-experience`, from `main`
at cad4e35. Needs `supabase/migrations/227_lms_showcase_game_room.sql`.

## The brief

EZER Learn has to sell on its own, to companies, schools, colleges, training businesses and
webinar organisers, not only as the place employees do mandatory training. That means:
- browsing that feels like a streaming service: rows with arrows, a spotlight, live tiles, and
  a card that grows and plays a clip when the pointer rests on it, fast;
- large webinars run inside the product;
- gamification;
- speed, and phones.

## One repository or two?

**Keep one repository and one database, with two Vercel projects. That is how it already runs,
and it stays the recommendation.**

| | One repo (today) | Separate repo |
|---|---|---|
| Shared employees, managers, roles, mail, design system | Free | Needs an employee sync (Darwinbox ↔ Cornerstone style) or a shared package |
| Ship a fix to both products | One commit, two deploys | Two PRs, version drift |
| Sell the LMS alone | Already works: ezerlms.com with `NEXT_PUBLIC_EZER_SURFACE=lms`, HRMS routes return 404 | Cleaner story, same result for the customer |
| Separate team, separate release cadence | Harder | Easier |
| Customer demands its own database (data residency) | Needs per-tenant DB work either way | Same |

The code is already kept separable: `components/learning`, `lib/lms` and `app/api/lms` depend
on the rest only through auth, the employee directory and mail.

**When to change.** Split only when one of these happens:
- a separate team owns EZER Learn;
- it needs its own release train;
- an enterprise customer requires an isolated database.

Even then, the next step is a monorepo (`apps/hrms`, `apps/lms`, `packages/ui`, `packages/db`),
not two repositories.

## What the market does (research)

**Netflix-style browsing**
- Netflix opens an enlarged "bob" card after a short hover-intent delay. It plays a pre-made
  preview muted, with a mute toggle, and offers Play, My List, rating and More info.
- Members can turn autoplay previews off. Netflix added that switch after complaints, so it is
  a must-have, not a nicety.
- Published implementations wait 0.8–1.5 s before playing, and start buffering during that wait.
  - [Jellyfin TrailerPreview](https://github.com/Ziifkah/jellyfin-plugin-trailerpreview) uses
    800 ms.
  - The HoverTrailer plugin is muted until the page has user activation, because browsers refuse
    sound before a click.
- Sources: [Netflix autoplay setting](https://abc7chicago.com/post/heres-how-to-turn-off-netflix-autoplay/5911422/),
  [hover-preview experiment write-up](https://www.datainterview.com/ab-testing-lab/hover-previews),
  [Emby forum on how previews are pre-made and preloaded](https://emby.media/community/topic/60005-discuss-how-a-netflix-feature-works).

**Course marketplaces**
- Udemy, Teachable and Thinkific give every course a promo video, uploaded by the instructor,
  and a hover popover with what you'll learn and the call to action.
- Coursera and LinkedIn Learning use rows with arrows and "Top picks" rows.

**Gamification in LMSs.** TalentLMS has points, badges, levels, leaderboards and rewards on every
plan; Docebo has the same and adds challenges. Streaks are what Duolingo-style products add on
top. Sources: [TalentLMS gamification](https://www.talentlms.com/features/gamification),
[Docebo vs TalentLMS](https://www.selecthub.com/lms-software/talentlms-vs-docebo/),
[2026 comparison](https://lms-guide.pages.dev/guides/gamification-engagement-compared).

**Webinars at scale**
- The scalable shape is one-to-many video: the host streams once, an HLS/CDN or YouTube fans it
  out, and chat, Q&A and polls travel separately.
- Zoom Webinars, Livestorm and YouTube Live all work this way. A peer-to-peer meeting (Meet,
  Zoom meeting) tops out in the hundreds.
- Supabase Realtime broadcast can carry the interaction. A server sends through its REST
  endpoint without holding a socket
  ([docs](https://supabase.com/docs/guides/realtime/broadcast)).

## The plan, in phases

| Phase | What | State |
|---|---|---|
| 1. Showcase | Trailers, hover card with clip, preloading, billboard, Top 10, My list, live tiles, phone fixes | **Built** |
| 2. Gamification | XP, levels, streaks, 17 badges, weekly goal, company and department leaderboards, privacy switches | **Built** |
| 3. Webinar room | In-app room with the stream (YouTube, Vimeo, HLS, or the meeting link), chat, Q&A with upvotes, polls, reactions, attendance by time in the room | **Built** (see the room section) |
| 4. Speed | Code-split screens with idle warm-up, shared signed clip URLs, one catalogue read for everything | **Built** |
| 5. Sell it beyond employees | See "Next" below | Planned |

## What was built

### Trailers and the hover card (Phase 1)

**What plays**, decided by `lib/lms/showcase-core.ts`, unit-tested:
1. The course's trailer. In the Studio, on the course's Details step under **Trailer**, HR either
   uploads a short video or picks a clip from one of the course's own video lessons. They then
   set where it starts and how long it plays, and the preview loops exactly that window.
2. Otherwise, a free-preview video lesson.
3. Otherwise, the first video lesson, but only if the course is open to self-enrolment or the
   person is already enrolled.

A course that needs approval or an assignment never shows a lesson before then. The signed file
could be downloaded whole, so rule 3's limit is the real security boundary. The Studio warns
about this when HR picks a lesson clip for such a course.

**No clip is cut or stored twice.** The card plays a window of the file (start to end) and loops
inside it. The file's URL is the shared, daily-rotated signed URL (`mediaUrl`), so every learner
asks for the same address, and the CDN and browser cache serve repeat views.

**The hover card** (`components/learning/showcase/HoverLayer.tsx`):
- It grows out of the card after 450 ms, or 120 ms when moving between cards.
- Above every row it shows the clip, muted with a sound toggle, plus a switch that turns
  autoplay previews off and is remembered in the browser.
- **Play/Resume** goes straight back into the course for someone taking it, and to the course
  page for anyone else.
- It also has **My list**, **More info**, rating, level, length, lessons, quizzes, learners,
  progress, summary and skills.
- It closes on leaving, Escape, a scroll of its own row or the page, and a screen change.
- It is mouse-only. Touch screens open the course on tap, and keyboards use the card itself.

**Preloading** (`components/learning/showcase/preview.ts`):
- A card resting in view for 0.9 s fetches its clip's index (`preload="metadata"`). This happens
  at most ten times per visit, when the browser is idle, and not on 2G/3G or Save-Data.
- The moment the pointer arrives it fetches the clip itself (`preload="auto"`), and when the card
  opens, that same buffered `<video>` element is moved into it.
- Measured on the dev server: the card opened at about 780 ms after the pointer arrived
  (450 ms intent plus test-harness time), and the clip was playing about 200–300 ms after that.

**Also built:**
- **Billboard** on Home: up to five courses (HR's featured picks, then recommended, then the
  chart), each playing its trailer behind the title, with Play, More info, My list and sound.
  It pauses while a hover card plays, off screen and in background tabs.
- The spotlight in Explore plays its clip too, and the course page loops the trailer behind its
  artwork.
- **Top 10 in your company this month**: courses ranked by starts in the last 30 days, beside
  large outlined numerals.
- **My list**: the hover card, the billboard, a Home row and an Explore filter (table `lms_saved`).
- **Live tiles** on Home:
  - points and streak (Phase 2);
  - the next live session, counting down, or "Live now" with the way in;
  - "Just added", turning over the newest courses;
  - category tiles whose artwork cycles through their courses.

Everything holds still for anyone who asked for less motion.

### Gamification (Phase 2)

`lib/lms/game-core.ts` (13 unit tests), `lib/lms/game.ts`, `GET /api/lms/me/game`,
`components/learning/game/`.

Everything is worked out from the learning record on each request, so there is no points
ledger to drift, and history counts from the first day.

**Points**

| Activity | XP |
|---|---|
| Lesson finished (once per lesson) | 10 |
| Course completed | 100, +50 if mandatory and on time |
| Quiz, first pass | 20 |
| Quiz, first 100% | +20 |
| Live session attended | 40 |
| Recording watched instead | 20 |
| Path completed | 200 |

**Levels, streaks and goals**
- Levels go Starter → Legend, with each level starting at 50·n·(n−1) XP.
- The streak counts IST days with any learning activity.
- The weekly goal is 150 XP.

**Badges (17):**
- first lesson; first course; 5, 10 and 25 courses
- perfect score; quiz ace; always on time
- 3-, 7- and 30-day streaks
- early bird; night owl
- live learner; path finisher; explorer; reviewer

**Where it shows:**
- a top-bar chip;
- the Home tile;
- Achievements, with points, badges and a leaderboard (week, month or all time; company or
  department);
- XP and badges earned on the course-complete screen.

**Studio → Settings → Points and leaderboard** has three switches: points on or off, the
leaderboard on or off, and whether names show. With names off, colleagues appear as
"A colleague in Sales".

### The webinar room (Phase 3)

`lib/lms/room-core.ts` (22 unit tests), `lib/lms/room.ts`, `GET`/`POST /api/lms/room/<id>`,
`components/learning/room/`, Studio → Live sessions.

**The stage**
- A YouTube or Vimeo live stream, or an HLS (`.m3u8`) address. HLS plays natively on Safari,
  and elsewhere through `hls.js`, which loads only inside the room.
- Or the existing Zoom, Meet or Teams link, with the room as its companion. Learners only get
  the link through the usual Join window.
- A countdown first (the host may **Go live** early), a LIVE badge, viewers, and
  **End session**. The ended screen offers the recording.
- This is the scalable shape: the host streams once (from YouTube Live, or OBS to an HLS
  service), the CDN serves any audience size, and the room carries the interaction.

**Interaction**
- **Chat.** The host can pin or hide lines and switch chat off.
- **Q&A.** One upvote per person, sorted by top or newest. People can ask without their name
  (the host still sees who). The host marks questions answered, live or with a typed answer.
- **Polls.** 2–6 options, results shown after answering if the host allows, close and reopen.
- **Emoji reactions** floating over the stage.
- **A pinned note.**

**Live updates**
- The server pushes every change over Supabase Realtime broadcast, through its REST endpoint,
  so the server holds no socket.
- The channel name is a server-side HMAC of the session id, handed only to people allowed in.
- Browsers only listen, except for reactions, which they batch and check against the allowed
  set.
- Each browser re-reads the room from the API every 30 s and when the tab returns, so nothing
  spoofed survives. If Realtime cannot connect, it falls back to polling every 8 s.
- Measured against the real project: a broadcast arrived in about 290 ms.

**Attendance**
- A 45-second heartbeat. The server credits the time by its own clock, capped at 60 s per
  beat, and only around the session's times.
- Reaching the session's share (default 50%) marks someone attended **by room**, which also
  completes the course's live lesson. It never overrides the attendance code or the host's tick.

**Limits.** Server rate limits: one chat line per 2 s, one question per 10 s, 500 characters.
Who may enter follows the existing session rules. Anyone else, or another company's host,
gets "not found".

**Studio → Live sessions** gains:
- the stream kind and address;
- the room switches (chat, questions, the share to stay for);
- **Open room** for the host.

Learners get **Enter the room** on the session card and the Home tile.

**Verified**
- The e2e rig (`scripts/lms-e2e`, now applying 227): **103 of 103**, which is the 92 existing
  checks plus 11 room scenarios. Those cover entry allowed and refused, chat, anonymous
  questions, voting once, polls, host-only actions, hide, pin and chat off, heartbeat credit
  and auto-attendance, Go live and End, a meeting link not leaking, and the room switched off.
- Screenshots at 1440 and 390 px.

**Not verified:** a real stream playing end to end, Safari, real phones, and Realtime quotas
with a very large audience. Supabase Pro allows 500 concurrent Realtime connections by default.
More needs the add-on, or the room's 8-second polling fallback.

### Speed (Phase 4)

- **Code-split screens.** Home and Explore are in the first download. The course page, player
  (video, PDF, SCORM), Studio, webinar room, My learning, Achievements, Live and Team are
  separate chunks, fetched one by one when the browser is idle after start-up, so the first
  click on them does not wait.
- **No extra request for any of this.** Trailers, the chart and My list ride on the catalogue
  read the app already makes, with the clip lookups in the same rounds.
- Clip URLs are shared per file, which is cacheable, and clips stream with HTTP range requests
  from faststart MP4s.
- **Measured** on a production build in Chrome (signed in, local, against the live database):
  - Home drew in about 0.8 s.
  - The page's own scripts are about 300 KB compressed. The deferred screens, about 125 KB
    more, arrive in the background afterwards. Before this change all of it, about 430 KB, came
    first: roughly 30% less JavaScript before Home can draw.

## Next (Phase 5): selling it to schools, colleges, training firms and webinar organisers

Proposed, not built. Each needs a decision from you.

1. **Workspace types and words.** Company, School, College and Academy each change the labels:
   employee/student, department/class, manager/teacher. The engine stays the same.
2. **Sign-up without HRMS.** Self-registration with an invite code or email domain, guest
   learners, and bulk CSV import of students.
3. **Instructors and cohorts.** A teacher role that owns courses and a batch, plus assignments
   with file submissions and grading, rubrics and due dates.
4. **Discussion and community.** Per-course Q&A threads, and announcements.
5. **Selling courses.** Razorpay checkout, coupons, a public course landing page with SEO, and
   GST invoices.
6. **White label per tenant.** Logo, colours, custom domain (`learn.client.com`) and a
   certificate template designer.
7. **Adaptive streaming** (HLS) through Cloudflare Stream or Mux for long videos on weak
   networks. Its cost is in `research/video-delivery.md`. The schema already has the
   `CLOUDFLARE_STREAM` provider.
8. **Native webinar broadcasting from the browser** (no OBS or YouTube), through a paid SFU such
   as LiveKit, 100ms or Daily. This is only worth it once rooms regularly pass a few hundred.
9. **Standards and integrations.** xAPI/LTI, SAML SSO and a public API.
10. **AI.** Course outlines and quizzes from a PDF (Gemini, already used in recruitment), and
    "what to learn next".

## How to test

### Before anything: run migration 227

In the Supabase SQL Editor, run `supabase/migrations/227_lms_showcase_game_room.sql`. It is safe
to run twice and rewrites no rows.

Until it runs:
- hover previews already work, from lesson clips;
- the chart works;
- My list and trailer uploads say "run migration 227";
- points work with their defaults;
- the webinar room says it needs 227.

### Test videos

`~/Downloads/ezer-learn-demo/trailers/` holds four narrated 18-second 1280×720 trailers (H.264 +
AAC, faststart, about 3 MB each), plus `make-trailer.swift`, which made them:
- `trailer-workplace-security.mp4`
- `trailer-customer-experience.mp4`
- `trailer-dpdp.mp4`
- `trailer-workplace-safety.mp4`

After 227, attach them to the demo courses with:

```
node ~/Downloads/ezer-learn-demo/seed/seed-trailers.mjs
```

Or upload one by hand: Studio → Courses → a course → Details → Trailer → Upload a trailer.

For the webinar room's HLS stage, the public test stream
`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` works. Any YouTube or Vimeo address works for
those kinds.

### Step by step (desktop Chrome, as Kiran SRS9047 / abc123 on /ess-login, then Learning)

1. **Home.**
   - Below the welcome, the spotlight plays a muted clip behind the course title.
   - The sound button unmutes it.
   - The arrows and dots change the slide.
   - It pauses while the pointer is on it.
2. **Hover a course card** in any row (cards with a clip show a small "▶ Preview" mark).
   - After about half a second it grows into a larger card, and the clip starts within a moment.
   - Move to the next card: it switches quickly.
   - Move away: it closes.
   - Press Esc: it closes.
3. **On the hover card:**
   - ▶ opens the course, or resumes it if you are taking it.
   - **+** adds it to My list, which shows as a row on Home and as the "My list" filter in
     Explore (needs 227).
   - **⌄** opens the course page.
   - The crossed-play button turns autoplay previews off: cards then show "Play preview"
     instead, and the choice survives a reload.
4. **Top 10 row:** large numerals and course posters. Hovering a poster opens the same card,
   with a red "TOP n" badge.
5. **Live tiles:**
   - the points/streak tile;
   - the next live session counting down (create one in Studio → Live sessions, starting in two
     days);
   - "Just added" turning over every few seconds;
   - category tiles changing pictures.
6. **Explore:** the spotlight plays its clip, and the "My list" toggle filters.
7. **Course page:** the trailer loops behind the course artwork. "Watch a free preview" still
   opens the full preview with sound.
8. **Achievements:**
   - points, level, streak and weekly goal;
   - 17 badges, earned ones lit with their dates;
   - the leaderboard, with week, month and all-time tabs and company or department scope. Your
     own row shows even outside the top 10.
9. **Studio** (Khushal@ezerhrms.com / Test@1234 on `/`, then Learning):
   - Courses → a course → Details → **Trailer**: upload a trailer, or choose a lesson clip, then
     drag "Starts at" and "Plays for". The preview loops that window. "Use automatic" clears it.
   - Settings → Points and leaderboard: switch names off, and the leaderboard shows "A colleague
     in …" for others.
10. **Less motion:**
    - In macOS System Settings → Accessibility → Display → Reduce motion, the clips stop
      autoplaying and the tiles hold still.
    - In Chrome DevTools → Network → "Slow 3G" with Save-Data, nothing preloads.
11. **Phone** (DevTools at 390 px, or a real phone):
    - no sideways scrolling;
    - the spotlight plays muted;
    - cards open on tap, with no hover card;
    - the points chip shrinks to the flame.

### Automated checks

```
node --experimental-strip-types --test lib/lms/__tests__/showcase-core.test.ts lib/lms/__tests__/game-core.test.ts
npm test                     # whole suite
npx tsc --noEmit -p .        # the repo's existing errors are outside Learning
```
