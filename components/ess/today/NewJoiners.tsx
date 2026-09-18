'use client';
// components/ess/today/NewJoiners.tsx — who has just joined, on ESS Home.
//
// CONGRATULATE, NOT WISH. Migration 116 makes the point in its own header and
// the copy here follows it: a joining is an achievement, not a date that came
// round again. The badge stored is 'JOINING', which is also what
// ess_new_joiners_feed() keys `already_congratulated` on — send it under any
// other badge and the button never flips.
//
// WHO COUNTS AS NEW is not decided here. 116 decides it, in two parts: HR
// issuing the ESS code is the trigger, and having actually started within
// qualify_days (90) is the qualifier — without the second, one bulk credential
// run announces 128 of 398 staff as new joiners. The list is then shown for
// announce_days (30) from the day the code was issued.
//
// THE FALLBACK. 117 adds `new_joiners` to the Today payload, but it is a
// separate migration from 116, so a database can have the ledger and not the
// payload key. Rather than render nothing in that case, this reads the same
// feed function directly — the pattern the Wall already uses where no route
// exists yet. The function is security definer and exposes only name,
// designation and department, so nothing private travels this way.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { TodayPayload } from '@/lib/today/types';

type Joiner = NonNullable<TodayPayload['new_joiners']>[number];

const TINT = [
  ['var(--ez-positive-tint)', 'var(--ez-positive)'],
  ['var(--ez-brand-tint)', 'var(--ez-brand)'],
  ['var(--ez-info-tint)', 'var(--ez-info)'],
  ['var(--gold-soft)', 'var(--gold)'],
];

/** "Joined 2 Sep" — an absolute date, so it cannot disagree across hydration. */
const joined = (iso: string | null) => {
  if (!iso) return 'Recently joined';
  return `Joined ${new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
};

export default function NewJoiners({ data, onCongratulate, onToast }: {
  data: TodayPayload;
  onCongratulate: (employeeId: string) => Promise<void>;
  onToast: (m: string) => void;
}) {
  // DERIVED, NOT MIRRORED INTO STATE. The payload is the source of truth
  // whenever it carries the key; `fetched` only ever holds the fallback.
  // Copying props into state needed an effect to keep the two in step, and that
  // effect's synchronous setState is an error under this repo's
  // react-hooks/set-state-in-effect rule — the same one TimeAgo and the Social
  // fetch both tripped. Deriving removes the effect rather than working around
  // it.
  const [fetched, setFetched] = useState<Joiner[] | null>(null);
  const [sent, setSent] = useState<Record<string, boolean>>({});
  const list = data.new_joiners ?? fetched ?? [];

  useEffect(() => {
    // Runs only when 117 has not been applied, and the setState happens inside
    // the async IIFE — never synchronously in the effect body.
    if (data.new_joiners) return;
    void (async () => {
      const { data: rows, error } = await supabase
        .rpc('ess_new_joiners_feed', { p_employee_id: data.employee.id });
      // A missing function is a deployment state, not an error to shout about:
      // the card simply does not render. Same rule the rest of ESS follows.
      if (!error && Array.isArray(rows)) setFetched(rows as Joiner[]);
    })();
  }, [data.new_joiners, data.employee.id]);

  // Nothing to say is not a card. The other Home cards that can be empty say so
  // because their absence would be surprising; nobody expects a permanent
  // "new joiners" panel in a month when nobody joined.
  if (!list.length) return null;

  return (
    <section className="card reveal" style={{ ['--i' as string]: 9 }}>
      <h2>New joiners</h2>
      <div className="people">
        {list.map((j, i) => {
          const done = j.already_congratulated || sent[j.id];
          return (
            <div key={j.id} className="person">
              <div className="pav" style={{ background: TINT[i % 4][0], color: TINT[i % 4][1] }}>
                {j.initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="n">{j.name}</div>
                <div className="w">
                  {[j.designation, j.department].filter(Boolean).join(' · ') || joined(j.joined_on)}
                </div>
              </div>
              <button
                className={'wish' + (done ? ' sent' : '')}
                disabled={done}
                onClick={async () => {
                  try {
                    await onCongratulate(j.id);
                    setSent(s => ({ ...s, [j.id]: true }));
                    onToast(`You welcomed ${j.name.split(' ')[0]}`);
                  } catch {
                    onToast('Could not send that');
                  }
                }}
              >
                {done ? 'Welcomed' : 'Welcome'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
