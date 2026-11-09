# EZER Sign — e-signature for EZER HRMS

## What it does

HR uploads a PDF, chooses who signs it, places the signature boxes and sends it. Each signer gets an e-mail link. They prove they control that inbox with a 6-digit OTP. Where the sender asked for it, they also complete an Aadhaar OTP step (demo for now). They then review the actual PDF and adopt a signature by drawing, typing or uploading it. Every box of theirs is filled with it.

When the last person signs:
- a footer goes on every page,
- a **Certificate of Completion** is appended,
- the file's SHA-256 is registered,
- everyone is e-mailed the signed PDF.

Anyone can later check a copy at `/sign/verify`.

## How the market does it, and what we copied

| Product | What we took |
|---|---|
| Leegality | E-mail/phone OTP before the document opens. Stamp under each signature (name, time, verification, reference). Audit trail with IP and device per step. Document hash and envelope ID on the certificate. Bulk send for one document to many people. |
| Adobe Acrobat Sign | "Certificate of completion" / final audit report appended to the PDF. Adopt-a-signature (draw / type / upload). Sequential or parallel signing. Remind, void, decline with reason. Public verification by document ID. |
| eMudra / NSDL eSign | Aadhaar OTP eSign under the IT Act's Second Schedule. Mocked behind the same step, ready for a licensed ESP/ASP API. |
| Keka | Offer letters and HR documents signed in the HRMS itself. A signature placeholder in the letter. |
| Darwinbox / greytHR / HROne | E-sign on HR letters, onboarding forms and policy acknowledgements. Employees see pending documents in ESS. |

## Where it lives in EZER

| Place | What it does |
|---|---|
| Compliance & Docs → **E-Sign** (`/dashboard/esign`, also inside ESS Manage) | HR desk: KPIs, tabs, search, the composer, and a detail drawer with signers, audit trail, downloads, remind / resend / void. |
| HR Letters → generated letter → **Send for e-sign** | Opens the composer with the letter PDF and the employee already filled in. |
| ESS → Profile → **Documents to sign** | The employee's own queue. "Review & sign" opens a fresh link, which still needs the e-mail OTP. |
| `/sign/<token>` | The public signing page. No login is needed. |
| `/sign/verify` | Public authenticity check: upload the PDF (SHA-256 match) or enter the envelope ID. |

## Security model

- Signing links are 256-bit random tokens. Only their SHA-256 is stored. Re-issuing a link rotates the token, so the old link stops working.
- OTPs are HMAC-sealed, bound to the signer and the purpose (e-mail or Aadhaar). They expire after 10 minutes. A signer gets at most 5 attempts per code and 6 sends per link, with a 30-second cooldown between sends.
- The document is fetched only after the OTP is verified, so a forwarded link shows the title alone.
- Tables have RLS on with no policy, and the `esign` bucket is private. Only the `/api/esign` routes, using the service role, can read or write them.
- HR routes require the **HR Letters** module: VIEW to see, EDIT to send, remind or void.
- When two people sign a parallel envelope at the same moment, an optimistic lock (`doc_version`) stops one overwriting the other's stamp. Completion is claimed exactly once.
- Only the last 4 digits of an Aadhaar number are stored (Aadhaar Act s.29).

## Legal note

Signing with an e-mail OTP is an *electronic signature* under the IT Act 2000 (s.3A), recognised for most HR documents. Its evidence is the OTP to the signer's inbox, the IP and device, the timestamps and the hash. An **Aadhaar eSign** through a licensed ESP has the strongest standing (Second Schedule).

The Aadhaar step here is a **demo**: no UIDAI call is made, and the certificate says so. To go live, implement the `aadhaar_send` / `aadhaar_verify` branch in `app/api/esign/sign/[token]/route.ts` against an ESP/ASP (eMudra, NSDL, Leegality and Digio offer APIs) and set `AADHAAR_DEMO = false` in `lib/esign/core.ts`.

A later step is a PAdES digital signature with an organisation certificate (`@signpdf`), so Adobe Reader shows "Signed and all signatures are valid".

## Setup

1. Run `supabase/migrations/174_esign.sql` in the Supabase SQL editor. It creates 4 tables and the private bucket.
2. Optional: set `ESIGN_SECRET` in Vercel. Without it, the OTP HMAC key falls back to the ESS / service-role secret.
3. Mail goes through the existing Gmail transport (`lib/mail/send.ts`). In local development with `GMAIL_*` blank, the OTP is shown on screen instead.

## Files

| Path | What it holds |
|---|---|
| `lib/esign/core.ts` | Pure functions: tokens, OTP, hashes, Aadhaar Verhoeff check, labels (unit-tested) |
| `lib/esign/stamp.ts` | pdf-lib signature block, footer and certificate (unit-tested, handles rotated pages) |
| `lib/esign/flow.ts` | Create envelopes (single and bulk), apply a signature, complete |
| `lib/esign/server.ts` | DB and storage helpers, the e-mails |
| `lib/esign/signer.ts` | Signing-link state and signer sessions |
| `app/api/esign/*` | `upload-url`, `envelopes`, `envelopes/[id]`, `mine`, `sign/[token]`, `sign/[token]/document`, `verify` |
| `components/esign/*` | `PdfPages` (pdf.js), `SignaturePad`, `Composer`, `MyDocumentsToSign`, shared UI |
| `app/sign/[token]`, `app/sign/verify`, `app/dashboard/esign` | Pages |
