'use client'
// components/learning/Achievements.tsx — certificates, results, history and skills.
import { useCallback, useEffect, useState } from 'react'
import { C, F, W, S, R, Badge, Button, Card, Skeleton, numeric, IconAward, IconCheck, IconDownload, type Tone } from '@/lib/ui'
import { lmsApi, lmsDownload } from '@/lib/lms/client'
import { CalmMessage, IconExternal, Problem, SectionHead, STATUS, dayWords, errorWords, plural } from './shared'

interface Cert { id: string; cert_no: string; verify_code: string; title: string; score_pct: number | null; issued_at: string; expires_at: string | null; revoked_at: string | null }
interface Result { id: string; title: string; attempt_no: number; pct: number | null; pass_pct?: number; passed: boolean; submitted_at: string | null }
interface History { id: string; title: string; status: string; score_pct: number | null; completed_at: string | null; cycle_no: number; mandatory: boolean }
interface Data { certificates: Cert[]; results: Result[]; history: History[]; skills: string[] }

function certState(c: Cert): { label: string; t: Tone } {
  if (c.revoked_at) return { label: 'Revoked', t: 'critical' }
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return { label: 'Expired', t: 'warning' }
  return { label: 'Valid', t: 'positive' }
}

function CertRow({ c, first }: { c: Cert; first: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const st = certState(c)
  const save = async () => {
    setBusy(true); setErr('')
    try { await lmsDownload(`/api/lms/me/certificates/${c.id}`, `${c.cert_no}.pdf`) }
    catch (e) { setErr(errorWords(e)) } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr)', gap: S.md, padding: S.md, borderTop: first ? 0 : `1px solid ${C.line}` }}>
      <span style={{ width: 38, height: 38, borderRadius: R.md, display: 'grid', placeItems: 'center', background: C.brandTint, color: C.brand }}><IconAward size={18} /></span>
      <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontWeight: W.semi }}>{c.title}</span>
          <Badge t={st.t} size="sm">{st.label}</Badge>
        </div>
        <div style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>
          {c.cert_no} · Issued {dayWords(c.issued_at)}{c.expires_at ? ` · Valid until ${dayWords(c.expires_at)}` : ''}{c.score_pct != null ? ` · ${Number(c.score_pct)}%` : ''}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: S.md, alignItems: 'center', marginTop: 2 }}>
          {!c.revoked_at && <Button size="sm" icon={<IconDownload size={14} />} disabled={busy} onClick={save}>{busy ? 'Preparing' : 'Download PDF'}</Button>}
          <a className="ezl-linkbtn ezl-tap" style={{ fontSize: F.small }} href={`/learn/verify/${c.verify_code}`} target="_blank" rel="noopener noreferrer">Verify link <IconExternal size={13} /></a>
        </div>
        {err && <div role="alert" style={{ fontSize: F.tiny, color: C.critical }}>{err}</div>}
      </div>
    </div>
  )
}

export default function Achievements() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [allHistory, setAllHistory] = useState(false)
  const load = useCallback(() => {
    setErr('')
    lmsApi<Data>('/api/lms/me/achievements').then(setData).catch(e => setErr(errorWords(e)))
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <Problem message={err} onRetry={load} />
  if (!data) return <div style={{ display: 'grid', gap: S.md }}><Skeleton h={90} r={R.lg} /><Skeleton h={160} r={R.lg} /></div>
  const { certificates, results, history, skills } = data
  if (!certificates.length && !results.length && !history.length) {
    return <CalmMessage title="Nothing here yet" icon={<IconAward size={22} />}>Finish a course and your certificates, scores and skills will collect on this page.</CalmMessage>
  }
  const passed = history.filter(h => h.status === 'COMPLETED').length
  const line = [plural(passed, 'course') + ' completed', plural(certificates.filter(c => !c.revoked_at).length, 'certificate'), plural(skills.length, 'skill')].join(' · ')
  const shownHistory = allHistory ? history : history.slice(0, 6)

  return (
    <div className="ez-rise" style={{ display: 'grid', gap: S.xl }}>
      <div style={{ fontSize: F.small, color: C.muted, ...numeric }}>{line}</div>

      {certificates.length > 0 && (
        <section>
          <SectionHead title="Certificates" count={certificates.length} />
          <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
            {certificates.map((c, i) => <CertRow key={c.id} c={c} first={!i} />)}
          </Card>
        </section>
      )}

      {skills.length > 0 && (
        <section>
          <SectionHead title="Skills gained" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{skills.map(s => <Badge key={s} t="brand">{s}</Badge>)}</div>
        </section>
      )}

      <div className="ezl-two" style={{ alignItems: 'start', gap: S.xl }}>
        {results.length > 0 && (
          <section style={{ minWidth: 0 }}>
            <SectionHead title="Assessment results" />
            <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
              {results.slice(0, 12).map((r, i) => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: S.sm, alignItems: 'center', padding: `${S.sm + 2}px ${S.md}px`, borderTop: i ? `1px solid ${C.line}` : 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: F.small, fontWeight: W.medium }}>{r.title}</div>
                    <div style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>Attempt {r.attempt_no}{r.submitted_at ? ` · ${dayWords(r.submitted_at)}` : ''}{r.pass_pct != null ? ` · Pass mark ${r.pass_pct}%` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: W.semi, ...numeric }}>{r.pct != null ? `${Number(r.pct)}%` : '-'}</div>
                    <div style={{ fontSize: F.tiny, color: r.passed ? C.positive : C.muted }}>{r.passed ? 'Passed' : 'Not passed'}</div>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        )}
        {history.length > 0 && (
          <section style={{ minWidth: 0 }}>
            <SectionHead title="Learning history" />
            <Card pad={0} elevation="flat" style={{ overflow: 'hidden' }}>
              {shownHistory.map((h, i) => {
                const st = STATUS[h.status] || { label: h.status, t: 'neutral' as Tone }
                return (
                  <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr) auto', gap: S.sm, alignItems: 'center', padding: `${S.sm + 2}px ${S.md}px`, borderTop: i ? `1px solid ${C.line}` : 0 }}>
                    <span style={{ color: h.status === 'COMPLETED' ? C.positive : C.muted }}><IconCheck size={15} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: F.small, fontWeight: W.medium }}>{h.title}</div>
                      <div style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{h.completed_at ? dayWords(h.completed_at) : st.label}{h.score_pct != null ? ` · ${Number(h.score_pct)}%` : ''}</div>
                    </div>
                    {h.status !== 'COMPLETED' && <Badge t={st.t} size="sm">{st.label}</Badge>}
                  </div>
                )
              })}
              {history.length > 6 && (
                <div style={{ padding: `${S.sm}px ${S.md}px`, borderTop: `1px solid ${C.line}` }}>
                  <button className="ezl-linkbtn" style={{ fontSize: F.small }} onClick={() => setAllHistory(a => !a)}>{allHistory ? 'Show fewer' : `Show all ${history.length}`}</button>
                </div>
              )}
            </Card>
          </section>
        )}
      </div>
    </div>
  )
}
