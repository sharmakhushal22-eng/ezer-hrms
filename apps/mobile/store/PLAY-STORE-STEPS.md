# Putting EZER HRMS on Google Play: step by step

For whoever publishes the app. Everything to paste into Play Console is in
`PLAY-STORE-LISTING.md` (same folder); the graphics are here too.

## Before you start (one-time)

1. **A Google Play developer account in the company's name.** Open play.google.com/console and choose
   *Organisation*. You need the company's D-U-N-S number, a company website (ezerhrms.com), a contact email and
   phone, and the US$25 fee. Google verifies the organisation; this takes from a few days to two weeks. An
   organisation account does not need the 12-tester closed test that personal accounts need.
2. **The support mailbox.** Create `support@ezerhrms.com` (the privacy page and the listing give this address).
3. **The privacy page must be live.** It is `https://app.ezerhrms.com/privacy`, and it goes live when the app PR
   reaches `main`. Open it in a browser before you submit; Google checks it.
4. **A demo login for Google's reviewers.** One seeded employee (not a real person) with a password. You type it
   only into Play Console (App access), never into the repository.

## 1. Get the app file

The release file is an **.aab** (Android App Bundle) built on EAS. Open the "Production AAB" link from the build
message and download the `.aab`. (The `.apk` link is for installing on a phone directly to test; Play does not
take an APK.)

## 2. Create the app in Play Console

Play Console → **Create app**:
- App name: `EZER HRMS` · Default language: English (India) · App or game: **App** · Free or paid: **Free**
- Tick the two declarations (developer programme policies, US export laws) → **Create app**.

## 3. Fill in "App content" (Policy → App content)

Open each item and answer from `PLAY-STORE-LISTING.md` → *App content* and *Data safety*:

1. **Privacy policy:** `https://app.ezerhrms.com/privacy`
2. **App access:** "All or some functionality is restricted" → add the demo login and the one-line instructions.
3. **Ads:** No.
4. **Content rating:** fill the questionnaire as written (category Utility/Productivity; users can exchange
   content: Yes). Submit; you get a rating at once.
5. **Target audience:** 18 and over.
6. **News app / COVID-19 / Government app:** No. **Financial features:** none. **Health:** none.
7. **Data safety:** copy the table. "Collects data: Yes. Shares: No. Encrypted in transit: Yes. Deletion on
   request: Yes. Users cannot create accounts in the app."

## 4. Store listing (Grow → Store presence → Main store listing)

- **App name:** EZER HRMS
- **Short description** and **Full description:** paste from `PLAY-STORE-LISTING.md`.
- **App icon:** `icon-512.png`
- **Feature graphic:** `feature-graphic-1024x500.jpg`
- **Phone screenshots:** the files in `screenshots/` (1080 × 1920, seeded demo data). Upload 4 to 8.
- **App category:** Business · **Contact email:** support@ezerhrms.com · **Website:** https://ezerhrms.com
- Save.

## 5. First release: internal testing first (recommended)

1. **Testing → Internal testing → Create new release.**
2. When asked about app signing, accept **"Use Google-generated key"** (Play App Signing). EAS keeps the upload
   key; Google signs what users download.
3. Upload the `.aab`. Release name fills itself (e.g. `5 (1.3.0)`). Release notes, for example:
   `First release: attendance, leave, pay, claims, approvals, performance and learning.`
4. **Save → Review release → Start rollout to Internal testing.**
5. **Testers** tab → create an email list with your own and a few colleagues' Gmail addresses → copy the
   *opt-in link* and open it on those phones → install from Play. Check sign-in, punch, leave, a claim with a
   photo, and Learning.

## 6. Production

1. **Production → Create new release → Add from library** (pick the same bundle) — or upload the `.aab` again.
2. **Countries / regions:** India (add others if needed).
3. **Review release → Start rollout to Production → Send for review.**
4. Google's review usually takes 1–7 days for a new app. You get an email; the Play Store link is
   `https://play.google.com/store/apps/details?id=com.ezerhrms.app`.

## Later updates

1. Raise `version` in `apps/mobile/app.config.ts` (1.3.0 → 1.4.0); the build number goes up by itself on EAS.
2. `cd apps/mobile && npx eas-cli build --platform android --profile production`
3. Upload the new `.aab` in Play Console (Production → Create new release), or, once a Google service account key
   is in place as `apps/mobile/google-play-service-account.json` (never commit it), run
   `npx eas-cli submit --platform android --profile production`, which sends it to the internal track as a draft.

## Things Google may ask about

- **User-generated content** (Messages and the Wall): Google can ask for a way to report a post or block a user.
  If the review raises it, that is an app change to make before resubmitting.
- **Location:** the app asks only while in use (punching, journeys); no background location form is needed.
