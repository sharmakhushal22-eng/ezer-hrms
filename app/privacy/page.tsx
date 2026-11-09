// app/privacy/page.tsx — the public privacy policy.
//
// Google Play refuses an app without a privacy policy at a public URL, and the
// Android app's store listing links here. Keep it true to what the website and
// the app actually do: when a feature starts collecting something new (a new
// permission, a new third party), this page changes in the same commit.
//
// A server component, so it imports tokens directly: '@/lib/ui' is a client
// module and its constants would arrive here as client references.
import type { Metadata } from 'next'
import { C, F, W, S, R } from '@/lib/ui/tokens'

// The mailbox users and Google write to. Replace with the real one before the
// Play Store listing goes live.
const CONTACT_EMAIL = 'support@ezerhrms.com'
const UPDATED = '7 November 2026'

export const metadata: Metadata = {
  title: 'Privacy Policy · EZER HRMS',
  description: 'How EZER HRMS and its Android app handle employee data.',
}

const h2: React.CSSProperties = { fontSize: F.title, fontWeight: W.semi, color: C.ink, margin: `${S.xl}px 0 ${S.sm}px` }
const p: React.CSSProperties = { fontSize: F.body, lineHeight: 1.65, color: C.inkSoft, margin: `0 0 ${S.md}px` }
const li: React.CSSProperties = { fontSize: F.body, lineHeight: 1.65, color: C.inkSoft, marginBottom: S.xs }

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return <li style={li}><strong style={{ color: C.ink, fontWeight: W.semi }}>{term}</strong> — {children}</li>
}

export default function PrivacyPage() {
  return (
    <main style={{ background: C.canvas, minHeight: '100vh', fontFamily: F.family, padding: `${S.xxl}px ${S.lg}px` }}>
      <article style={{
        maxWidth: 760, margin: '0 auto', background: C.surface, border: `1px solid ${C.line}`,
        borderRadius: R.lg, padding: `${S.xxl}px clamp(${S.lg}px, 5vw, ${S.huge}px)`,
      }}>
        <h1 style={{ fontSize: F.page, fontWeight: W.bold, color: C.ink, margin: 0 }}>Privacy Policy</h1>
        <p style={{ ...p, color: C.muted, fontSize: F.small, marginTop: S.xs }}>Last updated {UPDATED}</p>

        <p style={p}>
          EZER HRMS is human-resources software used by companies to run hiring, attendance, leave, payroll,
          travel and other HR work for their employees. This policy covers the EZER HRMS website and the
          EZER HRMS Android app (package <code>com.ezerhrms.app</code>).
        </p>
        <p style={p}>
          Your employer decides to use EZER HRMS and creates your account. Your employer controls your
          employee record and is responsible for how it is used; EZER HRMS stores and processes that record
          on your employer&apos;s behalf. The app has no sign-up of its own: you sign in with the work email
          or employee code your HR team has set up for you.
        </p>

        <h2 style={h2}>What we collect</h2>
        <ul style={{ paddingLeft: S.xl, margin: 0 }}>
          <Item term="Employee record">name, employee code, contact details, department, designation, manager and
            other details your employer keeps about you.</Item>
          <Item term="HR activity">attendance punches, leave requests, claims and bills, loans and advances,
            performance reviews, documents, letters and signatures, help-desk tickets and anything else you
            submit through the website or the app.</Item>
          <Item term="Pay information">salary structure, payslips, tax declarations and bank details held by your
            employer for payroll.</Item>
          <Item term="Location">only when you punch attendance or record a business journey for a travel claim,
            and only while the app is open on that screen. The app does not track you in the background.</Item>
          <Item term="Photos and files">only the ones you choose to upload, for example a profile picture, a bill
            or a proof document. The camera is used only when you choose to take a photo.</Item>
          <Item term="Sign-in session">a session token stored securely on your phone so you stay signed in.</Item>
        </ul>

        <h2 style={h2}>What we do not do</h2>
        <ul style={{ paddingLeft: S.xl, margin: 0 }}>
          <li style={li}>We do not sell your data or share it with advertisers.</li>
          <li style={li}>The app shows no ads and contains no advertising or analytics trackers.</li>
          <li style={li}>We do not read your contacts, messages, call logs or other apps.</li>
        </ul>

        <h2 style={h2}>How it is used</h2>
        <p style={p}>
          Only to provide the HR services your employer uses: recording attendance, processing leave and
          claims, running payroll, generating letters, routing approvals to your managers and HR, and
          sending you notifications about them.
        </p>

        <h2 style={h2}>Who can see it</h2>
        <p style={p}>
          People in your company with the right role (for example your manager, HR, payroll or finance) see
          what their role needs. We use service providers to run the product: Supabase (database and file
          storage, hosted in Mumbai, India), Vercel (web hosting) and an email provider for notifications.
          They process data only to run EZER HRMS. We disclose data to authorities only when the law requires it.
        </p>

        <h2 style={h2}>Security</h2>
        <p style={p}>
          Data travels over encrypted connections (HTTPS) and is stored with access controls. No system is
          perfectly secure; if we learn of a breach that affects you, we will inform your employer so you can
          be told as the law requires.
        </p>

        <h2 style={h2}>How long it is kept</h2>
        <p style={p}>
          For as long as your employer uses EZER HRMS and as long as Indian employment, tax and labour laws
          require them to keep records. When your employer stops using EZER HRMS, their data is deleted or
          returned to them.
        </p>

        <h2 style={h2}>Your choices and rights</h2>
        <p style={p}>
          You can turn off location or camera access for the app at any time in your phone&apos;s settings;
          attendance punches with location and photo uploads will then not work. Uninstalling the app removes
          the session stored on your phone.
        </p>
        <p style={p}>
          To see, correct or delete your personal data, ask your employer&apos;s HR team, who manage your record,
          or write to us at the address below and we will work with your employer on it. Some records may have
          to be kept for the period the law requires. These rights include those under India&apos;s Digital
          Personal Data Protection Act, 2023.
        </p>

        <h2 style={h2}>Children</h2>
        <p style={p}>EZER HRMS is for employees of companies and is not meant for anyone under 18.</p>

        <h2 style={h2}>Changes</h2>
        <p style={p}>When this policy changes we update the date at the top of this page.</p>

        <h2 style={h2}>Contact</h2>
        <p style={{ ...p, marginBottom: 0 }}>
          Questions or requests about your data: <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: C.brand }}>{CONTACT_EMAIL}</a>
        </p>
      </article>
    </main>
  )
}
