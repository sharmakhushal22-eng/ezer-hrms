// lib/wall/catalogue.ts — the recognition catalogue.
//
// Transcribed from HRMS_Employee_Applause_Recognition_Master.docx: thirty
// badges and forty-four tags across eleven categories. This file is the
// CANONICAL copy — migration 089's seed data is generated from it by
// scripts/gen-catalogue.py, and a test re-parses the migration and asserts
// the two still agree. Editing the SQL by hand will fail that test, which is
// the intended outcome: two lists of seventy-four items maintained
// separately would disagree within a month, and nobody would notice until an
// employee saw a badge on one screen that did not exist on another.
//
// BADGES AND TAGS ARE NOT THE SAME THING, and the difference is why they are
// two lists rather than one with a flag:
//
//   A BADGE is an award. It is given deliberately, one per recognition, and
//   it accumulates on the employee's profile — "Best Performer", earned four
//   times, is a statement about a career.
//
//   A TAG is a description. Several apply at once, they attach to the
//   recognition rather than to the person, and they exist so the reason is
//   searchable later — "why do we keep recognising this team? Reliable,
//   Proactive, Knowledge Sharer."
//
// FIVE NAMES APPEAR IN BOTH LISTS — Team Player, Problem Solver, Culture
// Champion, Decision Maker, Positive Energy. That is from the source document
// and it is deliberate, not an oversight to be tidied away: "Team Player" as
// a tag describes how somebody worked this week; as a badge it is an award
// for having done it consistently. A test pins the five so a future
// de-duplication has to be a decision rather than an accident.

export const CATEGORIES = [
  'Behavior',
  'Collaboration',
  'Communication',
  'Culture',
  'Customer',
  'Growth',
  'Innovation',
  'Leadership',
  'Performance',
  'Project',
  'Technology',
] as const
export type Category = typeof CATEGORIES[number]

export interface CatalogueItem {
  /** The reference from the source document, B001-B030 / T001-T044. Kept so a
   *  row here can be traced back to the sheet HR signed off. */
  ref: string
  name: string
  category: Category
  glyph: string
  description: string
}

/** Thirty badges. One per recognition — an award, not a description. */
export const BADGES: CatalogueItem[] = [
  { ref: 'B001', name: 'Best Performer', category: 'Performance', glyph: '🏆',
    description: 'Outstanding overall performance' },
  { ref: 'B002', name: 'Star Performer', category: 'Performance', glyph: '⭐',
    description: 'Consistently strong performance' },
  { ref: 'B003', name: 'High Achiever', category: 'Performance', glyph: '📈',
    description: 'Exceeded goals or targets' },
  { ref: 'B004', name: 'Innovation Champion', category: 'Innovation', glyph: '💡',
    description: 'Introduced a useful new idea or solution' },
  { ref: 'B005', name: 'Out-of-the-Box Thinker', category: 'Innovation', glyph: '💡',
    description: 'Demonstrated creative thinking' },
  { ref: 'B006', name: 'Team Player', category: 'Collaboration', glyph: '🤝',
    description: 'Excellent teamwork and collaboration' },
  { ref: 'B007', name: 'Leadership Excellence', category: 'Leadership', glyph: '🧭',
    description: 'Demonstrated strong leadership' },
  { ref: 'B008', name: 'Goal Crusher', category: 'Performance', glyph: '🥇',
    description: 'Consistently achieved or exceeded targets' },
  { ref: 'B009', name: 'Going the Extra Mile', category: 'Behavior', glyph: '🏃',
    description: 'Went beyond normal responsibilities' },
  { ref: 'B010', name: 'Speed & Efficiency', category: 'Performance', glyph: '⚡',
    description: 'Delivered work quickly and efficiently' },
  { ref: 'B011', name: 'Excellence Award', category: 'Performance', glyph: '🎖️',
    description: 'Exceptional quality of work' },
  { ref: 'B012', name: 'Rising Star', category: 'Growth', glyph: '🌟',
    description: 'Rapid growth and strong potential' },
  { ref: 'B013', name: 'Problem Solver', category: 'Innovation', glyph: '💡',
    description: 'Successfully solved complex problems' },
  { ref: 'B014', name: 'Growth Champion', category: 'Growth', glyph: '🌱',
    description: 'Significant improvement or development' },
  { ref: 'B015', name: 'Customer Champion', category: 'Customer', glyph: '💙',
    description: 'Exceptional customer focus' },
  { ref: 'B016', name: 'Collaboration Champion', category: 'Collaboration', glyph: '🤝',
    description: 'Excellent cross-functional collaboration' },
  { ref: 'B017', name: 'Quality Champion', category: 'Performance', glyph: '✨',
    description: 'Consistently high-quality output' },
  { ref: 'B018', name: 'Reliability Award', category: 'Behavior', glyph: '🛡️',
    description: 'Highly dependable and reliable' },
  { ref: 'B019', name: 'Ownership Champion', category: 'Behavior', glyph: '🔑',
    description: 'Takes complete ownership of work' },
  { ref: 'B020', name: 'Learning Champion', category: 'Growth', glyph: '📚',
    description: 'Proactively learns and applies new skills' },
  { ref: 'B021', name: 'Tech Champion', category: 'Technology', glyph: '⚙️',
    description: 'Strong technical contribution' },
  { ref: 'B022', name: 'Data Champion', category: 'Technology', glyph: '📊',
    description: 'Excellent data-driven contribution' },
  { ref: 'B023', name: 'Communication Star', category: 'Communication', glyph: '🗣️',
    description: 'Exceptional communication' },
  { ref: 'B024', name: 'Decision Maker', category: 'Leadership', glyph: '🧭',
    description: 'Strong judgment and decision-making' },
  { ref: 'B025', name: 'Culture Champion', category: 'Culture', glyph: '🎉',
    description: 'Strongly demonstrates company values' },
  { ref: 'B026', name: 'Positive Energy', category: 'Culture', glyph: '🎉',
    description: 'Creates a positive work environment' },
  { ref: 'B027', name: 'Execution Champion', category: 'Performance', glyph: '🎯',
    description: 'Excellent execution and delivery' },
  { ref: 'B028', name: 'Key Contributor', category: 'Performance', glyph: '🎯',
    description: 'Made a critical contribution' },
  { ref: 'B029', name: 'Project Hero', category: 'Project', glyph: '🚩',
    description: 'Played a major role in project success' },
  { ref: 'B030', name: 'Celebration Champion', category: 'Culture', glyph: '🎉',
    description: 'Contributes to team engagement' },
]

/** Forty-four tags. Several per recognition — descriptions, not awards. */
export const TAGS: CatalogueItem[] = [
  { ref: 'T001', name: 'High Performer', category: 'Performance', glyph: '🎯',
    description: 'Consistently delivers strong results' },
  { ref: 'T002', name: 'Consistent', category: 'Performance', glyph: '🎯',
    description: 'Maintains dependable performance' },
  { ref: 'T003', name: 'Target Achiever', category: 'Performance', glyph: '🎯',
    description: 'Achieves assigned targets' },
  { ref: 'T004', name: 'Result Oriented', category: 'Performance', glyph: '🎯',
    description: 'Focuses on measurable outcomes' },
  { ref: 'T005', name: 'Quality Focused', category: 'Performance', glyph: '🎯',
    description: 'Pays strong attention to quality' },
  { ref: 'T006', name: 'Efficient', category: 'Performance', glyph: '🎯',
    description: 'Uses time and resources effectively' },
  { ref: 'T007', name: 'Reliable', category: 'Behavior', glyph: '🪴',
    description: 'Can be depended upon' },
  { ref: 'T008', name: 'Fast Learner', category: 'Growth', glyph: '🌱',
    description: 'Learns new concepts quickly' },
  { ref: 'T009', name: 'Ownership', category: 'Behavior', glyph: '🪴',
    description: 'Takes responsibility end-to-end' },
  { ref: 'T010', name: 'Accountability', category: 'Behavior', glyph: '🪴',
    description: 'Owns commitments and outcomes' },
  { ref: 'T011', name: 'Proactive', category: 'Behavior', glyph: '🪴',
    description: 'Takes initiative without waiting for instructions' },
  { ref: 'T012', name: 'Dependable', category: 'Behavior', glyph: '🪴',
    description: 'Consistently dependable' },
  { ref: 'T013', name: 'Positive Attitude', category: 'Culture', glyph: '🎉',
    description: 'Maintains a constructive attitude' },
  { ref: 'T014', name: 'Disciplined', category: 'Behavior', glyph: '🪴',
    description: 'Demonstrates strong work discipline' },
  { ref: 'T015', name: 'Adaptable', category: 'Behavior', glyph: '🪴',
    description: 'Adapts effectively to change' },
  { ref: 'T016', name: 'Resilient', category: 'Behavior', glyph: '🪴',
    description: 'Handles challenges and setbacks effectively' },
  { ref: 'T017', name: 'Innovative', category: 'Innovation', glyph: '💡',
    description: 'Brings new ideas and approaches' },
  { ref: 'T018', name: 'Creative Thinker', category: 'Innovation', glyph: '💡',
    description: 'Uses creative approaches to problems' },
  { ref: 'T019', name: 'Out of the Box', category: 'Innovation', glyph: '💡',
    description: 'Thinks beyond conventional solutions' },
  { ref: 'T020', name: 'Idea Generator', category: 'Innovation', glyph: '💡',
    description: 'Frequently contributes useful ideas' },
  { ref: 'T021', name: 'Problem Solver', category: 'Innovation', glyph: '💡',
    description: 'Solves issues effectively' },
  { ref: 'T022', name: 'Process Improver', category: 'Innovation', glyph: '💡',
    description: 'Improves processes or workflows' },
  { ref: 'T023', name: 'Tech Savvy', category: 'Technology', glyph: '⚙️',
    description: 'Strong technology orientation' },
  { ref: 'T024', name: 'Team Player', category: 'Collaboration', glyph: '🤝',
    description: 'Works effectively with others' },
  { ref: 'T025', name: 'Collaborative', category: 'Collaboration', glyph: '🤝',
    description: 'Works well across teams' },
  { ref: 'T026', name: 'Supportive', category: 'Collaboration', glyph: '🤝',
    description: 'Actively supports colleagues' },
  { ref: 'T027', name: 'Cross Functional', category: 'Collaboration', glyph: '🤝',
    description: 'Works effectively across functions' },
  { ref: 'T028', name: 'Knowledge Sharer', category: 'Collaboration', glyph: '🤝',
    description: 'Shares knowledge with others' },
  { ref: 'T029', name: 'Mentor', category: 'Leadership', glyph: '🧑‍🏫',
    description: 'Supports and develops colleagues' },
  { ref: 'T030', name: 'Great Communicator', category: 'Communication', glyph: '🗣️',
    description: 'Communicates clearly and effectively' },
  { ref: 'T031', name: 'Leadership', category: 'Leadership', glyph: '🧭',
    description: 'Demonstrates leadership qualities' },
  { ref: 'T032', name: 'Influencer', category: 'Leadership', glyph: '🧭',
    description: 'Positively influences others' },
  { ref: 'T033', name: 'Decision Maker', category: 'Leadership', glyph: '🧭',
    description: 'Makes sound decisions' },
  { ref: 'T034', name: 'Strategic Thinker', category: 'Leadership', glyph: '🧭',
    description: 'Thinks strategically' },
  { ref: 'T035', name: 'People Leader', category: 'Leadership', glyph: '🧭',
    description: 'Supports and guides people effectively' },
  { ref: 'T036', name: 'Change Maker', category: 'Leadership', glyph: '🧭',
    description: 'Drives positive change' },
  { ref: 'T037', name: 'Role Model', category: 'Leadership', glyph: '🪞',
    description: 'Sets a strong example for others' },
  { ref: 'T038', name: 'Culture Champion', category: 'Culture', glyph: '🎉',
    description: 'Promotes company culture and values' },
  { ref: 'T039', name: 'Value Driven', category: 'Culture', glyph: '🎉',
    description: 'Demonstrates organizational values' },
  { ref: 'T040', name: 'Positive Energy', category: 'Culture', glyph: '🎉',
    description: 'Creates positive team energy' },
  { ref: 'T041', name: 'Helpful', category: 'Culture', glyph: '🎉',
    description: 'Consistently helps colleagues' },
  { ref: 'T042', name: 'Inclusive', category: 'Culture', glyph: '🎉',
    description: 'Promotes an inclusive environment' },
  { ref: 'T043', name: 'Employee First', category: 'Culture', glyph: '🎉',
    description: 'Prioritizes employee/team experience' },
  { ref: 'T044', name: 'Team Spirit', category: 'Culture', glyph: '🎉',
    description: 'Strengthens team morale' },
]

export const ALL_ITEMS: CatalogueItem[] = [...BADGES, ...TAGS]

// ── lookups ──────────────────────────────────────────────────────────────

const BADGE_BY_REF = new Map(BADGES.map(b => [b.ref, b]))
const TAG_BY_REF   = new Map(TAGS.map(t => [t.ref, t]))

export function badgeByRef(ref: string): CatalogueItem | null {
  return BADGE_BY_REF.get(ref) ?? null
}
export function tagByRef(ref: string): CatalogueItem | null {
  return TAG_BY_REF.get(ref) ?? null
}

/** Grouped for a picker. Categories keep the document's order — alphabetical —
 *  rather than a frequency guess that would reshuffle as usage changed. */
export function byCategory(items: CatalogueItem[]): { category: Category; items: CatalogueItem[] }[] {
  return CATEGORIES
    .map(category => ({ category, items: items.filter(i => i.category === category) }))
    .filter(g => g.items.length > 0)
}

/** Search across name and description. Somebody looking for "helps others"
 *  should find Supportive and Knowledge Sharer without knowing the names. */
export function search(items: CatalogueItem[], q: string): CatalogueItem[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return items
  return items.filter(i =>
    i.name.toLowerCase().includes(needle) ||
    i.description.toLowerCase().includes(needle) ||
    i.category.toLowerCase().includes(needle))
}

// ── what a recognition may carry ─────────────────────────────────────────

/** One badge is an award; a handful of tags describe it. Past a few, tags
 *  stop narrowing anything and the recognition reads as a word cloud. */
export const MAX_TAGS = 5

export interface Selection { badgeRef: string | null; tagRefs: string[] }

export const EMPTY_SELECTION: Selection = { badgeRef: null, tagRefs: [] }

export interface SelectionCheck { ok: boolean; faults: string[] }

export function checkSelection(s: Selection): SelectionCheck {
  const faults: string[] = []
  if (s.badgeRef && !BADGE_BY_REF.has(s.badgeRef)) {
    faults.push(`${s.badgeRef} is not a badge in the catalogue.`)
  }
  for (const r of s.tagRefs) {
    if (!TAG_BY_REF.has(r)) faults.push(`${r} is not a tag in the catalogue.`)
  }
  if (new Set(s.tagRefs).size !== s.tagRefs.length) {
    faults.push('The same tag has been picked twice.')
  }
  if (s.tagRefs.length > MAX_TAGS) {
    faults.push(`Pick at most ${MAX_TAGS} tags — past that they stop telling anybody anything.`)
  }
  return { ok: faults.length === 0, faults }
}

/** A one-line summary for a feed row: the badge, then the tags. */
export function describe(s: Selection): string {
  const badge = s.badgeRef ? badgeByRef(s.badgeRef)?.name : null
  const tags = s.tagRefs.map(r => tagByRef(r)?.name).filter(Boolean)
  if (badge && tags.length) return `${badge} — ${tags.join(', ')}`
  if (badge) return badge
  if (tags.length) return tags.join(', ')
  return ''
}
