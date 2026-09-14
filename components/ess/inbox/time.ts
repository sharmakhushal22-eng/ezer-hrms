/** Relative time in the inbox voice: now · 12m · 3h · Yesterday · 10 Sept */
export function relTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 2) return 'now';
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  if (isYesterday(t, now)) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** Day divider label inside a thread. */
export function dayLabel(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (sameDay(t, now)) return 'Today';
  if (isYesterday(t, now)) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'long' });
}

/** Exact stamp for the bubble tooltip. */
export function exactTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** Two messages within 5 minutes from the same side collapse into one group. */
export function withinGroupWindow(aIso: string, bIso: string): boolean {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) <= 5 * 60000;
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
function isYesterday(t: number, now: number): boolean {
  const y = new Date(now); y.setDate(y.getDate() - 1);
  return sameDay(t, y.getTime());
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
