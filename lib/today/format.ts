// lib/today/format.ts — every time and date on the Today tab goes through these two
// functions so the user's 12h/24h and date-format preference applies everywhere.
import type { DateFormat, TimeFormat } from './types';

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const two = (n: number) => String(n).padStart(2, '0');

export function fmtTime(h: number, m: number, tf: TimeFormat, s?: number): string {
  const sec = s === undefined ? '' : ':' + two(s);
  if (tf === '24') return `${two(h)}:${two(m)}${sec}`;
  return `${h % 12 || 12}:${two(m)}${sec} ${h >= 12 ? 'PM' : 'AM'}`;
}
export const fmtClock = (d: Date, tf: TimeFormat) => fmtTime(d.getHours(), d.getMinutes(), tf);
export const fmtHHMM = (hhmm: string, tf: TimeFormat) => { const [h, m] = hhmm.split(':').map(Number); return fmtTime(h, m, tf); };
export const fmtISO = (iso: string | null, tf: TimeFormat) => (iso ? fmtClock(new Date(iso), tf) : '');

export function fmtDate(d: Date, df: DateFormat): string {
  const dd = two(d.getDate()), mm = two(d.getMonth() + 1), yy = d.getFullYear();
  switch (df) {
    case 'long':  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    case 'short': return `${d.toLocaleDateString('en-IN', { weekday: 'short' })}, ${d.getDate()} ${MON[d.getMonth()]} ${yy}`;
    case 'dmy':   return `${dd}/${mm}/${yy}`;
    case 'mdy':   return `${mm}/${dd}/${yy}`;
    case 'iso':   return `${yy}-${mm}-${dd}`;
  }
}
/** Dates inside cards never use the 'long' weekday form — it is too wide. */
export const fmtDateCompact = (iso: string, df: DateFormat) => fmtDate(new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')), df === 'long' ? 'short' : df);
export const dayMonth = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return `${d.getDate()} ${MON[d.getMonth()]}`; };
export const weekday = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });

export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function tenure(doj: string, now = new Date()) {
  const d = new Date(doj); let months = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
  if (now.getDate() < d.getDate()) months--;
  return { years: Math.floor(months / 12), months: months % 12, totalMonths: months };
}
export function greeting(h: number) { return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
