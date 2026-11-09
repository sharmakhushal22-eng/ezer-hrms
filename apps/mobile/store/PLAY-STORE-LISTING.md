# Google Play listing — EZER HRMS (Android)

Everything Play Console asks for, ready to paste. Keep it true: if the app
starts using a new permission or a new third party, update this file, the
Data safety answers in Play Console, and `app/privacy/page.tsx` together.

| | |
|---|---|
| Package | `com.ezerhrms.app` (fixed forever once uploaded) |
| App name | EZER HRMS |
| Default language | English (India) – en-IN |
| App or game | App |
| Free or paid | Free |
| Category | Business |
| Tags | HR, Employee self-service, Attendance |
| Privacy policy URL | https://ezer-hrms-chi.vercel.app/privacy |
| Contact email | the mailbox set in `app/privacy/page.tsx` → `CONTACT_EMAIL` (same one in both) |
| Website | https://ezer-hrms-chi.vercel.app |

## Graphics (files in this folder)

| Play Console field | File | Rule |
|---|---|---|
| App icon | `icon-512.png` | 512 × 512 PNG |
| Feature graphic | `feature-graphic-1024x500.jpg` | 1024 × 500 JPG |
| Phone screenshots | take on a phone (see below) | 2–8 images, 1080 × 1920 or similar, PNG/JPG |

Screenshots: sign in on a phone as a demo employee, and capture Home, Attendance
(punch), Leave calendar, Pay, Claims and the ID card. Avoid real people's
data in them.

## Short description (max 80 characters)

```
Attendance, leave, pay, claims and approvals for your workday.
```

## Full description (max 4000 characters)

```
EZER HRMS puts your company's HR desk in your pocket. Sign in with the work email or employee code your HR team has set up and handle your everyday HR tasks from your phone.

ATTENDANCE
• Punch in and out with your location
• See your monthly attendance and raise regularisation requests

LEAVE
• Check balances and apply for leave in a few taps
• Leave calendar with your attendance marked on it
• Managers approve or reject team requests on the go

PAY
• Salary details, flexi benefits and investment proofs
• Loans, voluntary PF and NPS

TRAVEL & EXPENSES
• Plan trips, record business journeys and submit claims with photos of bills
• Track the status of every claim

AND MORE
• Your profile, documents and letters, with e-signing
• Digital ID card
• Raise HR requests, read company announcements, celebrate colleagues on the wall
• Performance goals, self-ratings and reviews
• Approvals inbox for managers

Light and dark themes, built for every screen size.

EZER HRMS is used by companies for their employees. You need an account from your employer's HR team to sign in.
```

## App content (Policy → App content)

**Privacy policy** — the URL above.

**App access** — "All or some functionality is restricted". Add one instruction set:
- Name: Demo employee
- Username / password: a demo employee login (give Google a seeded demo account, never a real employee; enter it only in Play Console, not in this repo)
- Instructions: "Sign in on the first screen with the employee code and password above. All features are behind sign-in."

**Ads** — No, the app does not contain ads.

**Content rating** — category "Utility, Productivity, Communication or Other". Answer No to violence, sexual
content, language, controlled substances, gambling. Users can interact/exchange content? **Yes** (Messages and the
company Wall let colleagues post and reply; only people in the same company see them). Shares user location with other users? **No**. Result is usually "Everyone / 3+".

**Target audience** — 18 and over only. Not designed for children.

**News app** — No. **COVID-19 app** — No. **Government app** — No.

**Financial features** — "My app doesn't provide any financial features" (it shows the employer's payroll; it is
not a lender, bank or payment app).

**Health** — No health features.

**Data safety** — answers below.

### Data safety

Does the app collect or share user data? **Yes, collects.** Shared with third parties? **No** (Supabase / Vercel
are service providers, which Google does not count as sharing).
Encrypted in transit? **Yes.** Users can request deletion? **Yes** — through their employer's HR or the contact email.

Account creation: **"My app does not allow users to create an account"** — accounts are created by the employer;
the app only signs in.

| Data type | Collected | Purpose | Optional? |
|---|---|---|---|
| Location → Precise location | Yes | App functionality (attendance punch, travel journeys) | Optional (user can deny) |
| Location → Approximate location | Yes | App functionality | Optional |
| Personal info → Name, Email address, Phone number, User IDs | Yes | App functionality, Account management | Required |
| Personal info → Address, Other info (employee record) | Yes | App functionality | Required |
| Financial info → Other financial info (salary, bank details, claims) | Yes | App functionality | Required |
| Photos and videos → Photos | Yes | App functionality (bills, proofs, profile photo) | Optional |
| Files and docs | Yes | App functionality (documents, letters) | Optional |
| Messages → Other in-app messages (Inbox messages, Wall posts) | Yes | App functionality | Optional |
| App activity → Other user-generated content (leave reasons, requests) | Yes | App functionality | Required |

Everything else (contacts, messages, audio, health, web history, device IDs, crash logs, analytics): **not collected**.
None of the data is processed only on the device; none is used for ads or marketing.

### Sensitive permissions

The app asks for location only in the foreground (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`) — no
background location, so no location declaration form is needed. Camera is used only when the user takes a photo.
Photos are picked with the system photo picker, so there is no "Photo and video permissions" declaration either.
If Play Console ever asks, the reason is: "Attendance punches and travel claims record where the employee is when
they act; photos are bills and proof documents for claims."
