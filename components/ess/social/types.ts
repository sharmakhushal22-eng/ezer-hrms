// components/ess/social/types.ts — the shape of the Social section.
//
// ONE POST MODEL, FOUR SUB-SECTIONS.
//
// Birthdays, anniversaries, new joiners and shoutouts look different on screen
// but behave identically: each can be reacted to and commented on. Modelling
// them as one `SocialPost` with a `kind` is what makes a single PostCard, one
// reaction bar and one comment thread serve all four — rather than four
// near-copies that drift apart the first time a reaction is added to one.
//
// These shapes are written to match what the API will return, so wiring the
// real data later is a swap of the source, not a rewrite of the components:
//   * birthdays / anniversaries  → ess_today_payload().celebrations + a window
//   * new joiners                → ess_new_joiners_feed()
//   * shoutouts                  → v_company_feed / get_company_feed_as
//
// SCOPE. The feed is group-wide: every company sharing a `groups.id` through
// companies.group_id sees the same posts. `company` is carried on every person
// because in a group feed "who is this?" includes which company they are in —
// without it, two colleagues from different companies are indistinguishable.

/** Which sub-section a post belongs to, and how it renders. */
export type SocialKind = 'birthday' | 'anniversary' | 'joiner' | 'shoutout';

/** A person as Social shows them. Never carries pay, contact or date of birth. */
export interface SocialPerson {
  id: string;
  name: string;
  /** Precomputed server-side, as every other ESS payload does. */
  initials: string;
  designation: string | null;
  department: string | null;
  /** The company inside the group. Shown because the feed crosses companies. */
  company: string | null;
  /** Signed URL, or null. Falls back to initials. */
  photo?: string | null;
}

/**
 * One emoji and its tally.
 *
 * `mine` is what lets the bar answer "did I already react?" without a second
 * request per post — the same reason `already_wished` exists on the
 * celebrations payload.
 */
export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/**
 * Why something is no longer readable.
 *
 * DELIBERATELY WITHOUT AN AUTHOR. HR can take a post or comment down and must
 * give a remark, and the person affected is told what the remark said — but
 * never who wrote it. Naming the HR user turns a policy action into a personal
 * one between two colleagues, which is exactly what this wording avoids. The
 * identity is still recorded server-side for audit; it just never ships to a
 * client.
 */
export interface Removal {
  /** HR's own words, shown to the author verbatim. */
  remark: string;
  at: string;
}

export interface SocialComment {
  id: string;
  author: SocialPerson;
  body: string;
  /**
   * A wish may be a GIF with no words at all, which is why social_comments
   * allows an empty body when media_ref is set. Without this field the route
   * returns a GIF the thread cannot render.
   */
  media?: SocialMedia | null;
  at: string;
  reactions: Reaction[];
  /** Set when HR has taken it down. The row stays; the body is replaced. */
  removed?: Removal | null;
  /** True when the signed-in employee wrote it — they may delete their own. */
  mine?: boolean;
}

/** GIFs and stickers come from a curated pack we host, never a third party. */
export interface SocialMedia {
  kind: 'gif' | 'sticker';
  /** Key into the pack, e.g. 'confetti'. Resolved to an asset at render. */
  ref: string;
  label: string;
}

export interface SocialPost {
  id: string;
  /**
   * Which store the row came from, and therefore where a reaction goes.
   * Celebrations and joiners are `social` (social_posts, migration 118);
   * shoutouts are `wall` and keep living in recognitions with the Wall's own
   * reaction and comment tables. Nothing is duplicated between them.
   */
  source?: 'social' | 'wall';
  kind: SocialKind;
  /** Who the post is ABOUT — the person with the birthday, the new joiner. */
  subject: SocialPerson;
  /** Who WROTE it. Absent for the automatic celebration posts. */
  author?: SocialPerson | null;
  at: string;
  body?: string | null;
  media?: SocialMedia | null;

  /** anniversary: completed years. Never shown for a birthday — no age. */
  years?: number;
  /** birthday / anniversary: the day it falls on, ISO. Year is not displayed. */
  on?: string;
  /** joiner: joining date and the intro they wrote themselves. */
  joined_on?: string;
  intro?: string | null;
  hobbies?: string[];
  skills?: string[];
  /** shoutout: the category chip the Wall already carries. */
  category?: { label: string; glyph: string | null } | null;

  reactions: Reaction[];
  comments: SocialComment[];
  /** Has the signed-in employee already wished/welcomed this person today? */
  acted?: boolean;
  removed?: Removal | null;
  mine?: boolean;
}

/** The four sub-tabs, in the order they appear. */
export type SocialTab = 'wall' | 'birthdays' | 'anniversaries' | 'joiners';

export interface SocialPayload {
  /** The group whose people this feed covers. */
  group: { name: string; companies: number };
  me: SocialPerson;
  /** Falling today. Rendered first and loudest. */
  today: SocialPost[];
  /** Birthdays ahead, inside the announce window. */
  upcoming_birthdays: SocialPost[];
  /** Anniversaries in the current week, per the brief. */
  week_anniversaries: SocialPost[];
  /** Inside the new-joiner announce window (ess_new_joiner_settings). */
  joiners: SocialPost[];
  /** Shoutouts, the Wall of Fame feed moved in here. */
  wall: SocialPost[];
  /** Posts of mine HR removed, so the notice reaches me where I posted. */
  notices: Array<{ id: string; kind: SocialKind; removed: Removal; excerpt: string }>;
}
