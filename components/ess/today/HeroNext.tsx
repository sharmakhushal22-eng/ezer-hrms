'use client';
// components/ess/today/HeroNext.tsx — the one thing to do next, in the hero.
//
// The hero's brief already SAYS how many things are waiting ("You have 1 thing
// waiting on you") and then makes you scroll to a card to find out what it is.
// This closes that gap with the first item: its title, when it is due, and the
// button that opens it.
//
// ONE ITEM, NOT A LIST. "Pending on you" lower down is the list, and a second
// one in the hero would be the same content twice. The hero's job is the next
// action, so it shows exactly that and defers to the card for the rest.
//
// It renders nothing when nothing is waiting — an empty strip saying "nothing
// to do" is furniture, and the brief already says it in words.
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { fmtDateCompact } from '@/lib/today/format';

export default function HeroNext({ data, prefs, nav, now }: {
  data: TodayPayload;
  prefs: Prefs;
  /** The same navigator PendingList uses, so one route resolver serves both. */
  nav: (route: string) => void;
  /** The hero's clock. Passed in rather than read here: Date.now() during
   *  render is an impure call and this repo fails the build on it. */
  now: Date;
}) {
  const next = data.pending[0];
  if (!next) return null;

  const due = next.due_on ? new Date(next.due_on) : null;
  // "Soon" on the same 21-day horizon PendingList uses, so the two cannot
  // disagree about whether the same item is urgent.
  const soon = due ? (due.getTime() - now.getTime()) / 864e5 <= 21 : false;
  const more = data.pending.length - 1;

  return (
    <div className="heronext">
      <span className="hn-l">Next on you</span>
      <button type="button" className="hn-go" onClick={() => nav(next.cta_route)}>
        <span className="hn-t">{next.title}</span>
        {due ? (
          <span className={soon ? 'hn-due soon' : 'hn-due'}>
            {`Due ${fmtDateCompact(next.due_on!, prefs.date_format === 'long' ? 'short' : prefs.date_format).replace(/^\w{3}, /, '')}`}
          </span>
        ) : null}
        {/* Label only, like PendingList's own button — this icon set has no
            arrow, and the one I reached for did not exist. */}
        <span className="hn-cta">{next.cta_label}</span>
      </button>
      {more > 0 ? <span className="hn-more">+{more} more below</span> : null}
    </div>
  );
}
