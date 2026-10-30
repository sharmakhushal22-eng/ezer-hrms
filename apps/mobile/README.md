# EZER HRMS — Android app

The website's employee self-service portal (`/ess`) as an Android app. It uses the
same backend, database, logins and rules as the website. Architecture, security
notes and how to add a new website feature:
[`docs/mobile-app-architecture.md`](../../docs/mobile-app-architecture.md). Screen-by-screen
coverage: [`docs/mobile-feature-parity.md`](../../docs/mobile-feature-parity.md).

## 1. Install and run (developers)

Needs Node 22 (the website's version). From the repo root:

```bash
cd apps/mobile
npm install
cp .env.example .env.local      # then fill in the two Supabase PUBLIC values
npx expo start                  # dev server
```

`.env.local` needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. These
are the same public values as the website's `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel → Project → Settings → Environment Variables).
`EXPO_PUBLIC_API_URL` defaults to production (`https://ezer-hrms-chi.vercel.app`).
Everything prefixed `EXPO_PUBLIC_` is compiled into the app and readable by anyone,
so **never put a secret there**.

Quick look in a browser (no phone needed): `npx expo start --web`. The live API sends
no CORS headers for `localhost`, so API calls only succeed from a browser started
with web security disabled. That is a developer convenience and is not used in the APK.

Checks before committing:

```bash
npm run check        # TypeScript + shared-code purity check + unit tests
npx expo lint
```

## 2. Test on an Android emulator

1. Install Android Studio and create a virtual device (Pixel, API 34+).
2. Build a development client once: `npx eas-cli build --profile development --platform android`,
   then install the APK it produces on the emulator (drag the file onto the emulator window).
3. `npx expo start --dev-client` and press `a`.

Expo Go is not enough: the app uses SecureStore, location and the image picker,
which need the app's own build.

## 3. Test on a physical Android phone

* **Easiest:** install the test APK (§4) and sign in as any employee.
* **With live reload:** install the *development* build from step 2 on the phone, keep the
  phone and computer on the same Wi-Fi, run `npx expo start --dev-client` and scan the QR code.

## 4. Build a test APK (EAS, cloud)

One-time setup (only the account owner):

```bash
npm install -g eas-cli          # or use npx eas-cli@latest for each command
eas login                       # Expo account (free)
eas init                        # links this app to an Expo project; writes the projectId
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL      --value <public url>  --visibility plaintext
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key>    --visibility plaintext
```

Every new APK:

```bash
# 1. bump version / android.versionCode in app.config.ts (each APK you share must be higher)
# 2. commit — eas.json has requireCommit, so only committed files are uploaded
npm run build:apk               # = eas build --platform android --profile preview
```

The build runs on Expo's servers (about 10–20 minutes on the free tier, sometimes queued).
When it finishes the CLI prints a link. The same link is in the Expo dashboard
(expo.dev → your project → Builds). Signing keys are generated and stored by EAS the
first time; don't delete them, or testers will have to uninstall before updating.

## 5. Share the APK with testers

* Send them the build page link from §4. It shows a QR code and an **Install** button that
  downloads the `.apk` directly on their phone. They need no Expo account.
* Or download the `.apk` yourself and share it as a file (Drive, WhatsApp, email).
  The app is not on the Play Store, so this is "side-loading".

## 6. Install and test the APK (testers)

1. Open the link on the Android phone and download the `.apk`.
2. Tap the downloaded file. Android asks to **allow installs from this source** (the browser or
   Files app); allow it once, then tap **Install**. Play Protect may warn that the app is
   from an unknown developer. Choose **Install anyway**.
3. Open **EZER HRMS** and sign in with your ESS email or employee code, exactly as on
   `/ess-login`.
4. To update, install the newer APK over the old one; you stay signed in.

What to try: punch in/out on Home, the attendance calendar, apply for and withdraw a leave,
the inbox, profile change requests. Check that each change also appears on the website
(and the other way round, after pulling down to refresh).
