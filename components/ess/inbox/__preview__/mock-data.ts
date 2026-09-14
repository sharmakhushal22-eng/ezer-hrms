/**
 * Sample data for the preview harness and the unit tests. Fictional SRS
 * employees only — never import this from production code paths.
 *
 * The folder inks here are copied from lib/inbox/streams.ts verbatim, including
 * the three the original capture was missing. Production reads streams.ts, so
 * a divergence here would only mislead a reviewer — which is reason enough not
 * to have one.
 */
import type {
  BroadcastVM, ConversationVM, DirectoryVM, FolderVM, MessageVM, NoteVM, WallItemVM,
} from '../types';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export const MOCK_FOLDERS: FolderVM[] = [
  { code: 'DIRECT', label: 'Direct messages', hint: 'People writing to you', inkLight: '#1F5BC1', inkDark: '#588BE4', unread: 2 },
  { code: 'HR', label: 'HR', hint: 'Policy, records, letters', inkLight: '#6C2FB1', inkDark: '#A576DB', unread: 1 },
  { code: 'PAYROLL', label: 'Payroll', hint: 'Salary, payslips, tax, declarations', inkLight: '#1D7C4D', inkDark: '#51D694', unread: 1 },
  { code: 'FINANCE', label: 'Finance', hint: 'Claims, advances, reimbursements', inkLight: '#187991', inkDark: '#47C2E1', unread: 0 },
  { code: 'TIME', label: 'Leave & Attendance', hint: 'Requests, approvals, regularisation', inkLight: '#2373A9', inkDark: '#4DA2DB', unread: 1 },
  { code: 'PERFORMANCE', label: 'Performance', hint: 'KRAs, reviews, ratings', inkLight: '#AF3181', inkDark: '#D364AA', unread: 0 },
  { code: 'RECRUITMENT', label: 'Recruitment', hint: 'Requisitions, candidates, offers', inkLight: '#A75C1B', inkDark: '#E18F47', unread: 0 },
  { code: 'EXIT', label: 'Exit', hint: 'Resignation, clearance, full & final', inkLight: '#B1402F', inkDark: '#D46E5E', unread: 0 },
  { code: 'IT', label: 'IT & Access', hint: 'Accounts, roles, the portal itself', inkLight: '#497A29', inkDark: '#89C95E', unread: 0 },
  { code: 'FUNZONE', label: 'Fun Zone', hint: 'Game invites and scores colleagues shared', inkLight: '#115E59', inkDark: '#3FC7BE', unread: 0 },
];

export const MOCK_CONVERSATIONS: ConversationVM[] = [
  { id: 'c1', folder: 'DIRECT', kind: 'DIRECT', title: 'Priya Nair', subtitle: 'SRS0088 · HR Business Partner', preview: 'Also add the two new hires to the headcount tab, please.', unread: 2, updatedAt: ago(1), starred: true, muted: false, closed: false, staffed: false },
  { id: 'c2', folder: 'PAYROLL', kind: 'DESK', title: 'Payroll desk', subtitle: 'Answered by the payroll team', preview: 'We have re-run September TDS after your revised HRA declaration.', unread: 1, updatedAt: ago(1290), starred: false, muted: false, closed: false, staffed: false },
  { id: 'c3', folder: 'TIME', kind: 'SYSTEM', title: 'Leave & Attendance', subtitle: 'Updates', preview: 'Leave approved — Your casual leave for 18–19 Sept was approved.', unread: 1, updatedAt: ago(1410), starred: false, muted: false, closed: false, staffed: false },
  { id: 'c4', folder: 'HR', kind: 'SYSTEM', title: 'HR', subtitle: 'Updates', preview: 'Policy to acknowledge — The POSH Policy 2026 has been updated.', unread: 1, updatedAt: ago(1500), starred: false, muted: false, closed: false, staffed: false },
  { id: 'c5', folder: 'DIRECT', kind: 'DIRECT', title: 'Vikram Menon', subtitle: 'SRS0044 · Head of Operations', preview: 'You: Thursday 11am works. I will update the invite.', unread: 0, updatedAt: ago(4400), starred: false, muted: false, closed: false, staffed: false },
  { id: 'c6', folder: 'FINANCE', kind: 'DESK', title: 'Finance desk', subtitle: 'You staff this desk', preview: 'You: Approved this morning. It will be in the 25th payout.', unread: 0, updatedAt: ago(7300), starred: false, muted: false, closed: false, staffed: true },
  { id: 'c7', folder: 'FUNZONE', kind: 'SYSTEM', title: 'Fun Zone', subtitle: 'Updates', preview: 'Quiz Friday — Aman Verma invited you to Round 3.', unread: 0, updatedAt: ago(9900), starred: false, muted: true, closed: false, staffed: false },
  { id: 'c8', folder: 'IT', kind: 'DESK', title: 'IT helpdesk', subtitle: 'Answered by IT', preview: 'Message deleted', unread: 0, updatedAt: ago(13000), starred: false, muted: false, closed: true, staffed: false },
];

export const MOCK_MESSAGES: Record<string, MessageVM[]> = {
  c1: [
    { id: 'm1', mine: false, body: 'Hi Rajesh — the mid-year review calendar is out. Your team slots are on the 18th and 19th.', sentAt: ago(4320), deleted: false },
    { id: 'm2', mine: true, body: 'Got it, thanks. I will block both mornings.', sentAt: ago(4300), deleted: false },
    { id: 'm3', mine: false, body: 'Could you send the revised KRA sheet before the review call on Friday?', sentAt: ago(2), deleted: false },
    { id: 'm4', mine: false, body: 'Also add the two new hires to the headcount tab, please.', sentAt: ago(1), deleted: false },
  ],
  c2: [
    { id: 'm5', mine: true, body: 'My August payslip shows TDS higher than July though nothing changed in my declaration. Can someone check?', sentAt: ago(2900), deleted: false },
    { id: 'm6', mine: false, authorName: 'Payroll team', body: 'We have re-run September TDS after your revised HRA declaration. The August difference was the one-off incentive taxed in the same month — the worksheet is attached.', sentAt: ago(1290), deleted: false, attachment: { name: 'TDS-worksheet-Aug-2026.pdf', size: '184 KB' } },
  ],
  c5: [
    { id: 'm7', mine: false, body: 'Rajesh, can we move the weekly ops sync to Thursday this week?', sentAt: ago(4500), deleted: false },
    { id: 'm8', mine: true, body: 'Thursday 11am works. I will update the invite.', sentAt: ago(4400), deleted: false },
  ],
  c6: [
    { id: 'm9', mine: false, authorName: 'Aman Verma', body: 'Claim CL-2231 for Pune travel is pending with you since Monday. Any update?', sentAt: ago(7500), deleted: false },
    { id: 'm10', mine: true, body: 'Approved this morning. It will be in the 25th payout.', sentAt: ago(7300), deleted: false },
  ],
  c8: [
    { id: 'm11', mine: true, body: 'VPN keeps dropping on the office Wi-Fi since Monday.', sentAt: ago(13300), deleted: false },
    { id: 'm12', mine: false, authorName: 'IT', body: 'Fixed — the certificate on your laptop had expired. Pushed a new one; reconnect once.', sentAt: ago(13000), deleted: false },
    { id: 'm13', mine: true, body: '', sentAt: ago(12990), deleted: true },
  ],
};

export const MOCK_NOTES: Record<string, NoteVM[]> = {
  c3: [
    { id: 'n1', title: 'Leave approved', body: 'Your casual leave for 18–19 Sept was approved by Vikram Menon. Balance now 7 days.', sentAt: ago(1410), cta: { label: 'View leave', href: '#' }, done: false },
    { id: 'n2', title: 'Regularisation needed', body: 'No punch-out was recorded on 09 Sept. Regularise it before the 15th so it is not marked as half-day.', sentAt: ago(5800), cta: { label: 'Regularise', href: '#' }, done: true },
  ],
  c4: [
    { id: 'n3', title: 'Policy to acknowledge', body: 'The POSH Policy 2026 has been updated. Read and acknowledge it by 20 Sept.', sentAt: ago(1500), cta: { label: 'Read & acknowledge', href: '#' }, done: false },
  ],
  c7: [
    { id: 'n4', title: 'Quiz Friday', body: 'Aman Verma invited you to Quiz Friday · Round 3. 14 colleagues have joined so far.', sentAt: ago(9900), cta: { label: 'Join', href: '#' }, done: false },
  ],
};

export const MOCK_DIRECTORY: DirectoryVM = {
  matchedSelf: false,
  desks: [
    { code: 'HR', name: 'HR desk', hint: 'Policy, records, letters', unstaffed: false },
    { code: 'PAYROLL', name: 'Payroll desk', hint: 'Salary, payslips, tax', unstaffed: false },
    { code: 'FINANCE', name: 'Finance desk', hint: 'Claims, advances, reimbursements', unstaffed: false },
    { code: 'IT', name: 'IT helpdesk', hint: 'Accounts, roles, the portal itself', unstaffed: true },
  ],
  people: [
    { id: 'p1', name: 'Priya Nair', code: 'SRS0088', designation: 'HR Business Partner' },
    { id: 'p2', name: 'Vikram Menon', code: 'SRS0044', designation: 'Head of Operations' },
    { id: 'p3', name: 'Aman Verma', code: 'SRS0311', designation: 'Finance Executive' },
    { id: 'p4', name: 'Meera Iyer', code: 'SRS0127', designation: 'Product Designer' },
    { id: 'p5', name: 'Kabir Shah', code: 'SRS0209', designation: 'Sales Manager' },
  ],
};

export const MOCK_WALL: WallItemVM[] = [
  { id: 'w1', type: 'appreciation', actorName: 'Meera Iyer', actorDesignation: 'Product Designer', headline: 'Meera Iyer appreciated you', badge: 'Team Player', text: 'Stayed on the call till 11pm to get the payroll cut-over right. Could not have shipped without you.', sentAt: ago(120), unread: true, thanked: false, canThankBack: true, thankId: 'm1' },
  { id: 'w2', type: 'comments', actorName: 'Aman Verma', actorDesignation: 'Finance Executive', headline: 'Aman Verma commented on your recognition', text: 'Congrats on the Best Performer badge, Rajesh! Well deserved.', sentAt: ago(1500), unread: true, canThankBack: false, thankId: 'w2' },
  { id: 'w3', type: 'replies', actorName: 'Priya Nair', actorDesignation: 'HR Business Partner', headline: 'Priya Nair replied to your comment', text: 'Absolutely \u2014 five years flew by.', sentAt: ago(4300), unread: false, canThankBack: false, thankId: 'w3' },
  { id: 'w4', type: 'appreciation', actorName: 'Kabir Shah', actorDesignation: 'Sales Manager', headline: 'Kabir Shah appreciated you', badge: 'Innovation Champion', text: 'The one-click claim approval saved my team hours every week.', sentAt: ago(9000), unread: false, thanked: true, canThankBack: true, thankId: 'm4' },
];

export const MOCK_BROADCASTS: BroadcastVM[] = [
  { id: 'b1', pinned: true, unread: true, priority: 'IMPORTANT', priorityLabel: 'Important', canRespond: true, publisher: 'Sunita Rao \u00b7 CHRO', publishedAt: ago(180), title: 'Diwali holidays announced', body: 'Offices will remain closed on 20 and 21 October. Plants run on the shift roster shared with your HOD.' },
  { id: 'b2', pinned: false, unread: true, priority: 'NORMAL', priorityLabel: 'Normal', canRespond: true, publisher: 'Payroll', publishedAt: ago(2600), title: 'Investment proof window opens 1 Oct', body: 'Upload proofs against your declaration in Workspace \u2192 Tax. The window closes on 31 January.' },
  { id: 'b3', pinned: false, unread: false, priority: 'NORMAL', priorityLabel: 'Normal', canRespond: false, cannotRespondBecause: 'You published this one.', publisher: 'IT', publishedAt: ago(6000), title: 'Planned maintenance on Sunday', body: 'The portal will be unavailable from 02:00 to 04:00 IST on 21 Sept for a database upgrade.' },
];
