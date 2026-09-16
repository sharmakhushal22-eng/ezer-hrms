// components/ess/social/mock.ts — sample data for the design preview.
//
// INVENTED PEOPLE ON PURPOSE. This file is read by a harness that runs without
// a login, so it must not carry anyone's real name, photo or joining date. The
// shapes are exact; the people are not real.
//
// It covers the states the design has to answer for, not just the happy one:
//   * a birthday today, and birthdays ahead
//   * an anniversary today, and more later this week
//   * a first anniversary (one year) next to a long one (ten)
//   * a joiner who wrote a full intro, and one who has not written it yet
//   * a post with many reactions and a long thread, and one with none
//   * a post HR removed, and a comment HR removed
//   * two companies in the group, so cross-company posts are visible
import type { SocialPayload, SocialPerson } from './types';

const P = (
  id: string, name: string, designation: string, department: string, company: string,
): SocialPerson => ({
  id,
  name,
  initials: name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(),
  designation,
  department,
  company,
});

// Two companies under one group, so the feed visibly crosses company lines.
const ACME = 'Ezer Technologies';
const NOVA = 'Ezer Logistics';

const me = P('me', 'Rhea Sharma', 'Senior Analyst', 'Finance', ACME);

const kavya = P('e1', 'Kavya Iyer', 'Product Designer', 'Design', ACME);
const arjun = P('e2', 'Arjun Mehta', 'Warehouse Lead', 'Operations', NOVA);
const farid = P('e3', 'Farid Ansari', 'Backend Engineer', 'Engineering', ACME);
const neha = P('e4', 'Neha Kulkarni', 'HR Executive', 'People', ACME);
const dev = P('e5', 'Devanshi Rao', 'Accounts Payable', 'Finance', NOVA);
const imran = P('e6', 'Imran Qureshi', 'Fleet Coordinator', 'Operations', NOVA);
const tara = P('e7', 'Tara Menon', 'QA Engineer', 'Engineering', ACME);
const sunil = P('e8', 'Sunil Bhatt', 'Regional Manager', 'Sales', NOVA);

/** Relative ISO helper — the preview should never look stale. */
const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const r = (emoji: string, count: number, mine = false) => ({ emoji, count, mine });

export const MOCK: SocialPayload = {
  group: { name: 'Ezer Group', companies: 2 },
  me,

  // ── Today ──────────────────────────────────────────────────────────────
  today: [
    {
      id: 'p1',
      kind: 'birthday',
      subject: kavya,
      on: day(0),
      at: ago(190),
      reactions: [r('🎉', 14), r('❤️', 6, true), r('👏', 3)],
      acted: false,
      comments: [
        {
          id: 'c1', author: farid, at: ago(150), reactions: [r('❤️', 2)],
          body: 'Happy birthday Kavya! Thanks for rescuing the onboarding screens last month.',
        },
        {
          id: 'c2', author: dev, at: ago(96), reactions: [],
          body: 'Have a brilliant one 🎂',
        },
        {
          id: 'c3', author: sunil, at: ago(74), reactions: [],
          body: '', removed: { remark: 'Personal remarks about a colleague’s appearance.', at: ago(60) },
        },
      ],
    },
    {
      id: 'p2',
      kind: 'anniversary',
      subject: arjun,
      years: 10,
      on: day(0),
      at: ago(230),
      reactions: [r('👏', 22), r('🔥', 9), r('🙌', 4)],
      acted: true,
      comments: [
        {
          id: 'c4', author: imran, at: ago(120), reactions: [r('👏', 3)],
          body: 'Ten years! Half the warehouse process is something Arjun wrote down once and we never changed.',
        },
      ],
    },
  ],

  // ── Birthdays ahead ────────────────────────────────────────────────────
  upcoming_birthdays: [
    { id: 'p3', kind: 'birthday', subject: farid, on: day(1), at: ago(600), reactions: [], comments: [], acted: false },
    { id: 'p4', kind: 'birthday', subject: dev, on: day(3), at: ago(600), reactions: [], comments: [], acted: false },
    { id: 'p5', kind: 'birthday', subject: sunil, on: day(6), at: ago(600), reactions: [], comments: [], acted: false },
    { id: 'p6', kind: 'birthday', subject: tara, on: day(11), at: ago(600), reactions: [], comments: [], acted: false },
  ],

  // ── Anniversaries this week ────────────────────────────────────────────
  week_anniversaries: [
    { id: 'p7', kind: 'anniversary', subject: neha, years: 1, on: day(2), at: ago(600), reactions: [], comments: [], acted: false },
    { id: 'p8', kind: 'anniversary', subject: tara, years: 4, on: day(4), at: ago(600), reactions: [r('👏', 2)], comments: [], acted: false },
  ],

  // ── New joiners ────────────────────────────────────────────────────────
  joiners: [
    {
      id: 'p9',
      kind: 'joiner',
      subject: dev,
      joined_on: day(-6),
      at: ago(400),
      intro: 'Moved from Pune to join the Logistics finance team. I spent four years in vendor payments '
           + 'and I am happiest when a reconciliation finally nets to zero.',
      hobbies: ['Long-distance running', 'Carnatic music', 'Baking'],
      skills: ['Accounts payable', 'SAP', 'Advanced Excel', 'Vendor reconciliation'],
      reactions: [r('👋', 11), r('🎉', 5, true)],
      acted: true,
      comments: [
        { id: 'c5', author: neha, at: ago(300), reactions: [], body: 'Welcome aboard Devanshi! Your induction is on Thursday.' },
        { id: 'c6', author: me, at: ago(240), reactions: [r('❤️', 1)], body: 'Welcome! Finance sits on the third floor — come find us.', mine: true },
      ],
    },
    {
      id: 'p10',
      kind: 'joiner',
      subject: imran,
      joined_on: day(-2),
      at: ago(120),
      // Nothing written yet. The card has to be honest about that rather than
      // printing an empty block where a person should be.
      intro: null,
      hobbies: [],
      skills: [],
      reactions: [r('👋', 3)],
      acted: false,
      comments: [],
    },
  ],

  // ── Wall of Fame, moved in ─────────────────────────────────────────────
  wall: [
    {
      id: 'p11',
      kind: 'shoutout',
      subject: tara,
      author: farid,
      at: ago(320),
      category: { label: 'Above and beyond', glyph: '★' },
      body: 'Tara stayed late to reproduce the payroll rounding bug and wrote the test that now stops it '
          + 'coming back. Nobody asked her to do either.',
      reactions: [r('👏', 18), r('🔥', 7), r('❤️', 5, true)],
      acted: false,
      comments: [
        { id: 'c7', author: kavya, at: ago(280), reactions: [r('👏', 4)], body: 'That test has already caught two regressions. Enormously useful.' },
      ],
    },
    {
      id: 'p12',
      kind: 'shoutout',
      subject: imran,
      author: sunil,
      at: ago(1500),
      category: { label: 'Customer first', glyph: '◆' },
      body: 'Rerouted three trucks during the Nashik closure and called every customer himself before they called us.',
      reactions: [r('👏', 9)],
      acted: false,
      comments: [],
    },
    {
      id: 'p13',
      kind: 'shoutout',
      subject: neha,
      author: me,
      at: ago(2600),
      category: null,
      body: '',
      mine: true,
      // The author's own view of a removed post: the notice, their words gone,
      // and HR's remark — with nothing at all about which HR user acted.
      removed: {
        remark: 'Named an employee’s leave reason, which is confidential.',
        at: ago(2400),
      },
      reactions: [],
      comments: [],
    },
  ],

  notices: [
    {
      id: 'p13',
      kind: 'shoutout',
      excerpt: 'A shoutout you posted for Neha Kulkarni',
      removed: {
        remark: 'Named an employee’s leave reason, which is confidential.',
        at: ago(2400),
      },
    },
  ],
};

/**
 * The curated pack. Hosted by us, never a third-party GIF search.
 *
 * Each entry is drawn in CSS by GifTile rather than loaded as a file, so the
 * preview needs no binary assets and no network. When the real pack is
 * uploaded to Storage these keys become its filenames.
 */
export const GIF_PACK: Array<{ ref: string; label: string; hue: number }> = [
  { ref: 'confetti', label: 'Confetti', hue: 268 },
  { ref: 'cake', label: 'Cake', hue: 338 },
  { ref: 'balloons', label: 'Balloons', hue: 16 },
  { ref: 'clap', label: 'Applause', hue: 42 },
  { ref: 'popper', label: 'Party popper', hue: 158 },
  { ref: 'highfive', label: 'High five', hue: 205 },
];

/** The reaction row. Six is the most that fits a phone without wrapping. */
export const REACTIONS = ['👏', '❤️', '🎉', '🙌', '😄', '🔥'] as const;

/** Suggested lines in the composer, so an empty box is never the only option. */
export const WISH_SUGGESTIONS: Record<string, string[]> = {
  birthday: [
    'Happy birthday! Hope you get the day you want.',
    'Many happy returns 🎂',
    'Have a brilliant one — enjoy every bit of it.',
  ],
  anniversary: [
    'Congratulations on the milestone!',
    'Thanks for everything you have built here.',
    'Here is to the next one 🎉',
  ],
  joiner: [
    'Welcome to the team!',
    'Great to have you with us — shout if you need anything.',
    'Welcome aboard 👋',
  ],
};
