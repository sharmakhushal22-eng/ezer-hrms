'use client'
// components/learning/Achievements.tsx — certificates, skills, quiz results and the record of
// every course finished, all from /api/lms/me/achievements; and points, badges and the
// leaderboard from /api/lms/me/game (./game/GamePanel.tsx).
import { useCallback, useEffect, useState } from 'react'
import { IconDownload } from '@/lib/ui'
import { lmsApi, lmsDownload } from '@/lib/lms/client'
import { EmptyState, IconExternal, Oops, STATUS, Skel, dayWords, errorWords, plural } from './shared'
import { GCert, GCheckCircle, GTarget, GTrophy } from './glyphs'
import { cached, remember } from './app/cache'
import { CountUp } from './motion/CountUp'
import { GamePanel } from './game/GamePanel'

interface Cert { id: string; cert_no: string; verify_code: string; title: string; score_pct: number | null; issued_at: string; expires_at: string | null; revoked_at: string | null }
interface Result { id: string; title: string; attempt_no: number; pct: number | null; pass_pct?: number; passed: boolean; submitted_at: string | null }
interface History { id: string; title: string; status: string; score_pct: number | null; completed_at: string | null; cycle_no: number; mandatory: boolean }
interface Data { certificates: Cert[]; results: Result[]; history: History[]; skills: string[] }

function certState(c: Cert): { label: string; t: string } {
  if (c.revoked_at) return { label: 'Revoked', t: 'critical' }
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return { label: 'Expired', t: 'warning' }
  return { label: 'Valid', t: 'positive' }
}

function CertCard({ c }: { c: Cert }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const st = certState(c)
  const save = async () => {
    setBusy(true); setErr('')
    try { await lmsDownload(`/api/lms/me/certificates/${c.id}`, `${c.cert_no}.pdf`) }
    catch (e) { setErr(errorWords(e)) } finally { setBusy(false) }
  }
  return (
    <div className="lx-cert lx-in" style={{ display: 'grid', gap: 14 }}>
      <i className="lx-holo" aria-hidden />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="lx-cert-seal"><GCert size={22} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11.5, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--lx-gold)' }}>Certificate of completion</div>
          <div className="lx-num" style={{ fontSize: 12.5, color: 'var(--ez-muted)' }}>{c.cert_no}</div>
        </div>
        <span className={`lx-tag lx-tag--${st.t}`}>{st.label}</span>
      </div>
      <div className="lx-display" style={{ fontSize: 21, lineHeight: 1.2 }}>{c.title}</div>
      <div className="lx-num" style={{ fontSize: 13, color: 'var(--ez-muted)' }}>
        Issued {dayWords(c.issued_at)}{c.expires_at ? ` · valid until ${dayWords(c.expires_at)}` : ''}{c.score_pct != null ? ` · score ${Number(c.score_pct)}%` : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!c.revoked_at && <button className="lx-btn lx-btn--sm lx-btn--primary" disabled={busy} onClick={save}><IconDownload size={14} /> {busy ? 'Preparing…' : 'Download PDF'}</button>}
        <a className="lx-btn lx-btn--sm" href={`/learn/verify/${c.verify_code}`} target="_blank" rel="noopener noreferrer">Verification page <IconExternal size={13} /></a>
      </div>
      {err && <div role="alert" style={{ fontSize: 13, color: 'var(--ez-critical)' }}>{err}</div>}
    </div>
  )
}

export default function Achievements() {
  const [d, setD] = useState<Data | null>(() => cached<Data>('achievements'))
  const [err, setErr] = useState('')
  const load = useCallback(() => { setErr(''); lmsApi<Data>('/api/lms/me/achievements').then(x => setD(remember('achievements', x))).catch(e => setErr(errorWords(e))) }, [])
  useEffect(() => { load() }, [load])

  if (err && !d) return <Oops message={err} onRetry={load} />
  if (!d) return <div style={{ display: 'grid', gap: 24 }}><Skel h={150} r={22} /><div className="lx-ach-top">{[0, 1, 2, 3].map(i => <Skel key={i} h={100} r={18} />)}</div><Skel h={220} r={18} /></div>

  const completed = d.history.filter(h => h.status === 'COMPLETED')
  const passed = d.results.filter(r => r.passed)
  const scored = completed.filter(h => h.score_pct != null)
  const avg = scored.length ? Math.round(scored.reduce((a, h) => a + Number(h.score_pct), 0) / scored.length) : null
  const nothing = !d.certificates.length && !d.history.length && !d.results.length

  return (
    <div>
      <header className="lx-ph lx-in">
        <div className="lx-ph-row">
          <div>
            <h1>Achievements</h1>
            <p>Your points, badges and certificates, the skills you have built and the record of everything you have finished.</p>
          </div>
          <span className="lx-trophy" style={{ width: 72, height: 72 }}><GTrophy size={34} /></span>
        </div>
      </header>

      <div className="lx-stack" style={{ marginBottom: 32 }}><GamePanel /></div>

      {nothing ? (
        <EmptyState title="Your first achievement is one course away" icon={<GTrophy size={34} />}>Finish a course and its certificate, score and skills will be kept here for good.</EmptyState>
      ) : (
        <div className="lx-stack">
          <div className="lx-ach-top" style={{ marginBottom: 0 }}>
            <div className="lx-kpi" data-t="positive"><i><GCheckCircle size={20} /></i><b className="lx-num"><CountUp value={completed.length} /></b><span>Courses completed</span></div>
            <div className="lx-kpi" data-t="gold"><i><GCert size={20} /></i><b className="lx-num"><CountUp value={d.certificates.filter(c => !c.revoked_at).length} /></b><span>Certificates earned</span></div>
            <div className="lx-kpi"><i><GTarget size={20} /></i><b className="lx-num"><CountUp value={passed.length} /></b><span>Quizzes passed</span></div>
            <div className="lx-kpi"><i><GTrophy size={20} /></i><b className="lx-num">{avg != null ? <CountUp value={avg} suffix="%" /> : '—'}</b><span>Average course score</span></div>
          </div>

          {d.certificates.length > 0 && (
            <section>
              <div className="lx-sec-head"><div><h2 className="lx-sec-title">Certificates</h2><div className="lx-sec-sub">Anyone can check a certificate is genuine from its verification page</div></div></div>
              <div className="lx-certs">{d.certificates.map(c => <CertCard key={c.id} c={c} />)}</div>
            </section>
          )}

          {d.skills.length > 0 && (
            <section>
              <div className="lx-sec-head"><div><h2 className="lx-sec-title">Skills you have built</h2><div className="lx-sec-sub">From the courses you completed</div></div></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{d.skills.map(s => <span key={s} className="lx-skill"><i />{s}</span>)}</div>
            </section>
          )}

          {d.history.length > 0 && (
            <section>
              <div className="lx-sec-head"><div><h2 className="lx-sec-title">Learning history</h2><div className="lx-sec-sub lx-num">{plural(d.history.length, 'course')}</div></div></div>
              <div className="lx-timeline">
                {d.history.map(h => {
                  const st = STATUS[h.status] || { label: h.status, t: 'neutral' }
                  return (
                    <div key={h.id} className="lx-tl-item" data-t={st.t}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 650 }}>{h.title}{h.cycle_no > 1 && <span style={{ color: 'var(--ez-muted)', fontWeight: 500 }}> · round {h.cycle_no}</span>}</div>
                        <div className="lx-num" style={{ fontSize: 12.5, color: 'var(--ez-muted)', marginTop: 2 }}>{h.completed_at ? dayWords(h.completed_at) : st.label}{h.score_pct != null ? ` · ${Number(h.score_pct)}%` : ''}{h.mandatory ? ' · mandatory' : ''}</div>
                      </div>
                      <span className={`lx-tag ${st.t !== 'neutral' && st.t !== 'brand' ? `lx-tag--${st.t}` : ''}`}>{st.label}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {d.results.length > 0 && (
            <section>
              <div className="lx-sec-head"><div><h2 className="lx-sec-title">Quiz results</h2><div className="lx-sec-sub">Every attempt you handed in</div></div></div>
              <div className="lx-panel">
                {d.results.map((r, i) => (
                  <div key={r.id} className="lx-path" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderTop: i ? undefined : 0 }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: r.passed ? 'var(--ez-positive-tint)' : 'var(--ez-warning-tint)', color: r.passed ? 'var(--ez-positive)' : 'var(--ez-warning)' }}><GTarget size={16} /></span>
                    <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 650 }}>{r.title}</span>
                      <span className="lx-num" style={{ display: 'block', fontSize: 12.5, color: 'var(--ez-muted)' }}>Attempt {r.attempt_no}{r.submitted_at ? ` · ${dayWords(r.submitted_at)}` : ''}{r.pass_pct != null ? ` · pass mark ${r.pass_pct}%` : ''}</span>
                    </span>
                    <b className="lx-num" style={{ fontSize: 16 }}>{r.pct != null ? `${Number(r.pct)}%` : '—'}</b>
                    <span className={`lx-tag lx-tag--${r.passed ? 'positive' : 'warning'}`}>{r.passed ? 'Passed' : 'Not passed'}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
