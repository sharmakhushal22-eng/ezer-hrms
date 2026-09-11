'use client';
import type { TodayPayload } from '@/lib/today/types';
import { ROUTES } from '@/lib/today/schema';
import { Star } from './icons';
const ago = (iso: string) => { const d = Math.round((Date.now() - new Date(iso).getTime()) / 864e5); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
export default function RecognitionCard({ data, nav }: { data: TodayPayload; nav: (r: string) => void }) {
  const r = data.recognition;
  return (
    <section className="card reveal" style={{ ['--i' as string]: 9 }}>
      <h2>Recognition <button className="more" onClick={() => nav(ROUTES.wall)}>Wall of Fame</button></h2>
      {r ? (
        <div className="kudo">
          <div className="badge"><Star /></div>
          <div>
            <div className="bt">{r.badge ?? 'Appreciation'} <span>· from {r.from}, {ago(r.at)}</span></div>
            {r.message && <div className="msg">{r.message}</div>}
            {r.tags && r.tags.length > 0 && <div className="tags">{r.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>}
          </div>
        </div>
      ) : <div style={{ fontSize: 12.5, color: 'var(--ez-faint)' }}>No kudos yet — appreciation from colleagues will appear here.</div>}
      <button className="give" onClick={() => nav(ROUTES.appreciate)}>Appreciate a colleague</button>
    </section>
  );
}
