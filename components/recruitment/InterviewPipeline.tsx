'use client'
// components/recruitment/InterviewPipeline.tsx
// Multi-round interview management embedded in Recruitment.
// State-driven views (no routing). All sub-components are defined OUTSIDE the
// parent to avoid the re-mount/focus-loss bug. Loads/saves to `interview_rounds`.
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

// ── Types ──────────────────────────────────────────────────────────
export type RoundType = string
export type RoundStatus = 'pending' | 'scheduled' | 'done' | 'rejected'
export type Recommendation = 'yes' | 'no' | 'hold' | null
export interface ParamFeedback { param_id: string; param_label: string; rating: number; text: string }
export interface Round {
  id: string
  candidate_id: string
  round_type: string
  round_number: number
  interviewer_name?: string
  interviewer_email?: string
  status: RoundStatus
  scheduled_at?: string | null
  interview_mode?: string | null
  feedback_submitted_at?: string | null
  recommendation?: Recommendation
  next_round_suggestion?: string | null
  suggested_interviewer?: string | null
  notes_for_recruiter?: string | null
  overall_score?: number | null
  params: ParamFeedback[]
  created_at?: string
}
export interface Candidate {
  id: string; full_name: string; designation: string; department?: string
  offered_ctc?: number; current_ctc?: number; ai_score?: number
}

// ── Styles (C constant — matches project palette) ──────────────────
const C = {
  page:  { background: TK.canvas, minHeight: '100vh', color: TK.ink, fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: '13px' } as React.CSSProperties,
  card:  { background: TK.surface, borderRadius: 10, border: '1px solid rgba(37,99,235,0.12)', padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(37,99,235,0.06)' } as React.CSSProperties,
  btnP:  { padding: '8px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: TK.brand, color: '#fff' } as React.CSSProperties,
  btnG:  { padding: '8px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', background: TK.positive, color: '#fff' } as React.CSSProperties,
  btnO:  { padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(37,99,235,0.2)', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: TK.brand } as React.CSSProperties,
  inp:   { width: '100%', padding: '9px 11px', background: TK.sunken, border: '1px solid rgba(37,99,235,0.12)', borderRadius: 7, color: TK.ink, fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const },
  lbl:   { fontSize: 11, fontWeight: 600, color: TK.brandDeep, textTransform: 'uppercase' as const, letterSpacing: '.05em', display: 'block', marginBottom: 4 },
  g2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as React.CSSProperties,
  g3:    { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 } as React.CSSProperties,
  pill:  (bg: string, color: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 600, background: bg, color }),
}

// ── Round configs ──────────────────────────────────────────────────
interface ParamDef { id: string; label: string; tags: string[] }
interface RoundConfig { badge: string; color: string; lightBg: string; params: ParamDef[] }

const ROUND_CONFIGS: Record<string, RoundConfig> = {
  'Recruiter Screening': { badge: 'RS', color: '#185FA5', lightBg: '#E6F1FB', params: [
    { id: 'comm',       label: 'Communication',     tags: ['Clear & articulate', 'Needs polish', 'Strong English'] },
    { id: 'exp',        label: 'Experience match',  tags: ['Relevant experience', 'Partial match', 'Over-qualified'] },
    { id: 'salary',     label: 'Salary alignment',  tags: ['Within budget', 'Slightly high', 'Negotiable'] },
    { id: 'avail',      label: 'Availability',      tags: ['Immediate', '30-day notice', '60+ days'] },
    { id: 'impression', label: 'First impression',  tags: ['Very positive', 'Average', 'Some concerns'] },
  ]},
  'L1 Interview': { badge: 'L1', color: TK.positive, lightBg: TK.positiveTint, params: [
    { id: 'tech',       label: 'Technical depth',    tags: ['Strong fundamentals', 'Some gaps', 'Excellent'] },
    { id: 'problem',    label: 'Problem solving',    tags: ['Structured approach', 'Needs guidance', 'Creative'] },
    { id: 'domain',     label: 'Domain knowledge',   tags: ['Deep', 'Surface-level', 'Solid'] },
    { id: 'comm',       label: 'Communication',      tags: ['Clear', 'Hesitant', 'Confident'] },
    { id: 'leadership', label: 'Leadership signals', tags: ['Visible', 'Emerging', 'Not evident'] },
  ]},
  'L2 Interview': { badge: 'L2', color: TK.warning, lightBg: TK.warningTint, params: [
    { id: 'design',    label: 'System design',            tags: ['Scalable thinking', 'Basic', 'Strong'] },
    { id: 'ownership', label: 'Ownership & leadership',   tags: ['High ownership', 'Needs nudging', 'Proactive'] },
    { id: 'crossfn',   label: 'Cross-functional thinking',tags: ['Collaborative', 'Siloed', 'Strategic'] },
    { id: 'tech',      label: 'Technical depth',          tags: ['Expert', 'Adequate', 'Gaps'] },
    { id: 'culture',   label: 'Cultural fit',             tags: ['Great fit', 'Neutral', 'Risk'] },
  ]},
  'HOD Round': { badge: 'HOD', color: TK.critical, lightBg: TK.criticalTint, params: [
    { id: 'strategic', label: 'Strategic alignment',  tags: ['Aligned', 'Partial', 'Misaligned'] },
    { id: 'chemistry', label: 'Team chemistry',       tags: ['Strong', 'Neutral', 'Concern'] },
    { id: 'potential', label: 'Leadership potential',  tags: ['High', 'Moderate', 'Limited'] },
    { id: 'vision',    label: 'Vision alignment',     tags: ['Shared vision', 'Unclear', 'Divergent'] },
    { id: 'orgfit',    label: 'Org fit',              tags: ['Excellent', 'Average', 'Risk'] },
  ]},
  'Final HR Round': { badge: 'FHR', color: TK.brand, lightBg: TK.brandTint, params: [
    { id: 'comp',      label: 'Compensation alignment', tags: ['Agreed', 'Negotiating', 'Gap'] },
    { id: 'joining',   label: 'Joining & timeline',     tags: ['Immediate', 'Notice period', 'Delayed'] },
    { id: 'bgv',       label: 'BGV readiness',          tags: ['Docs ready', 'Pending', 'Concern'] },
    { id: 'reference', label: 'Reference check',        tags: ['Positive', 'Pending', 'Negative'] },
    { id: 'final',     label: 'Final recommendation',   tags: ['Strong hire', 'Hire', 'Hold'] },
  ]},
}
const GENERIC_PARAMS: ParamDef[] = [
  { id: 'p1', label: 'Technical / Role fit',  tags: ['Strong', 'Average', 'Weak'] },
  { id: 'p2', label: 'Communication',         tags: ['Clear', 'Average', 'Concern'] },
  { id: 'p3', label: 'Problem solving',       tags: ['Strong', 'Average', 'Weak'] },
  { id: 'p4', label: 'Cultural fit',          tags: ['Great', 'Neutral', 'Risk'] },
  { id: 'p5', label: 'Overall impression',    tags: ['Positive', 'Average', 'Concern'] },
]
const BUILT_IN_ROUNDS = ['Recruiter Screening', 'L1 Interview', 'L2 Interview', 'HOD Round', 'Final HR Round']
const RATING_LABELS = ['', 'Poor', 'Below average', 'Average', 'Good', 'Excellent']
const MODES = ['In-person', 'Video call', 'Telephonic']

const cfgFor = (t: string): RoundConfig =>
  ROUND_CONFIGS[t] || { badge: t.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'RND', color: TK.brand, lightBg: TK.brandTint, params: GENERIC_PARAMS }
const scoreOf = (params: ParamFeedback[]): number => {
  const rated = params.filter(p => p.rating > 0)
  if (!rated.length) return 0
  return Math.round((rated.reduce((a, b) => a + b.rating, 0) / rated.length) * 20)
}
const words = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0)
const clampWords = (s: string, max: number): string => {
  const parts = s.split(/(\s+)/)
  let count = 0, out = ''
  for (const p of parts) {
    if (/\s/.test(p)) { out += p; continue }
    if (p === '') continue
    if (count >= max) break
    out += p; count++
  }
  return out
}
const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

// ════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS (all OUTSIDE the parent)
// ════════════════════════════════════════════════════════════════════
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ display: 'flex', gap: 3 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <span key={n} onClick={() => onChange(n)} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
            style={{ cursor: 'pointer', fontSize: 22, lineHeight: 1, color: n <= shown ? TK.warning : TK.line, transition: 'transform .1s', transform: hover === n ? 'scale(1.15)' : 'none' }}>
            ★
          </span>
        ))}
      </div>
      <span style={{ fontSize: 11, color: TK.muted, minWidth: 80 }}>{shown ? RATING_LABELS[shown] : 'Not rated'}</span>
    </div>
  )
}

function StatusPill({ status }: { status: RoundStatus }) {
  const map: Record<RoundStatus, [string, string, string]> = {
    pending:   ['#F3F4F6', TK.muted, 'Pending'],
    scheduled: [TK.warningTint, TK.warning, 'Scheduled'],
    done:      [TK.positiveTint, TK.positive, 'Done'],
    rejected:  [TK.criticalTint, TK.critical, 'Rejected'],
  }
  const [bg, color, label] = map[status]
  return <span style={C.pill(bg, color)}>{label}</span>
}

function RoundNode({ round, isLast }: { round: Round; isLast: boolean }) {
  const cfg = cfgFor(round.round_type)
  const done = round.status === 'done'
  const rejected = round.status === 'rejected'
  const dot = rejected ? TK.critical : done ? cfg.color : round.status === 'scheduled' ? TK.warning : '#D1D5DB'
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: done || rejected ? dot : '#fff', border: `2px solid ${dot}`, color: done || rejected ? '#fff' : dot, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
          {cfg.badge}
        </div>
        <div style={{ fontSize: 9, color: TK.muted, whiteSpace: 'nowrap', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>{round.round_type.replace(' Interview', '').replace(' Round', '')}</div>
        {done && <div style={{ fontSize: 9, fontWeight: 700, color: cfg.color }}>{round.overall_score ?? 0}</div>}
      </div>
      {!isLast && <div style={{ width: 26, height: 2, background: TK.brandTint, margin: '0 2px', marginBottom: 18 }} />}
    </div>
  )
}

function RoundCard({ round, onSchedule, onAssess, onView }: {
  round: Round
  onSchedule: (r: Round) => void
  onAssess: (r: Round) => void
  onView: (r: Round) => void
}) {
  const cfg = cfgFor(round.round_type)
  return (
    <div style={{ ...C.card, borderLeft: `3px solid ${cfg.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={C.pill(cfg.lightBg, cfg.color)}>{cfg.badge}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{round.round_type}</span>
            <StatusPill status={round.status} />
            {round.status === 'done' && <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color }}>Score: {round.overall_score ?? 0}/100</span>}
          </div>
          <div style={{ fontSize: 11, color: TK.muted, marginTop: 4 }}>
            {round.interviewer_name ? `Interviewer: ${round.interviewer_name}` : 'No interviewer assigned'}
            {round.scheduled_at ? ` · ${fmtDate(round.scheduled_at)}` : ''}
            {round.interview_mode ? ` · ${round.interview_mode}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {round.status === 'pending' && <button onClick={() => onSchedule(round)} style={C.btnO}>Schedule</button>}
          {round.status === 'scheduled' && <button onClick={() => onAssess(round)} style={C.btnP}>Open assessment</button>}
          {round.status === 'done' && <button onClick={() => onView(round)} style={C.btnO}>View feedback</button>}
        </div>
      </div>
    </div>
  )
}

function PrevFeedbackBlock({ rounds }: { rounds: Round[] }) {
  const [open, setOpen] = useState(false)
  const done = rounds.filter(r => r.status === 'done')
  if (!done.length) return null
  return (
    <div style={{ ...C.card, background: TK.sunken }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: TK.brandDeep }}>Previous rounds feedback ({done.length}) — read-only</span>
        <span style={{ fontSize: 12, color: TK.muted }}>{open ? 'Hide' : 'Show'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {done.map(r => {
            const cfg = cfgFor(r.round_type)
            return (
              <div key={r.id} style={{ borderTop: '1px solid #EDE9FE', paddingTop: 10, marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={C.pill(cfg.lightBg, cfg.color)}>{cfg.badge}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{r.round_type}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color }}>{r.overall_score ?? 0}/100</span>
                  <span style={{ fontSize: 11, color: TK.muted }}>by {r.interviewer_name || '—'}</span>
                </div>
                {(r.params || []).map(p => (
                  <div key={p.param_id} style={{ fontSize: 11, color: TK.inkSoft, marginBottom: 3 }}>
                    <strong>{p.param_label}:</strong> {''.repeat(p.rating)}{''.repeat(5 - p.rating)} {p.text ? `— ${p.text}` : ''}
                  </div>
                ))}
                {r.notes_for_recruiter && <div style={{ fontSize: 11, color: TK.muted, marginTop: 4, fontStyle: 'italic' }}>Note: {r.notes_for_recruiter}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ScheduleForm({ round, onCancel, onSave }: {
  round: Round
  onCancel: () => void
  onSave: (data: { interviewer_name: string; interviewer_email: string; scheduled_at: string; interview_mode: string }) => void
}) {
  const [name, setName] = useState(round.interviewer_name || '')
  const [email, setEmail] = useState(round.interviewer_email || '')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [mode, setMode] = useState(round.interview_mode || 'Video call')
  const cfg = cfgFor(round.round_type)
  return (
    <div style={C.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={C.pill(cfg.lightBg, cfg.color)}>{cfg.badge}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Schedule — {round.round_type}</span>
      </div>
      <div style={C.g2}>
        <div><label style={C.lbl}>Interviewer Name *</label><input style={C.inp} value={name} onChange={e => setName(e.target.value)} /></div>
        <div><label style={C.lbl}>Interviewer Email</label><input style={C.inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="interviewer@company.com" /></div>
        <div><label style={C.lbl}>Date *</label><input type="date" style={C.inp} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label style={C.lbl}>Time</label><input type="time" style={C.inp} value={time} onChange={e => setTime(e.target.value)} /></div>
        <div><label style={C.lbl}>Mode</label>
          <select style={C.inp} value={mode} onChange={e => setMode(e.target.value)}>{MODES.map(m => <option key={m}>{m}</option>)}</select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onCancel} style={C.btnO}>Cancel</button>
        <button onClick={() => {
          if (!name || !date) { alert('Interviewer name and date are required'); return }
          onSave({ interviewer_name: name, interviewer_email: email, scheduled_at: new Date(`${date}T${time || '10:00'}`).toISOString(), interview_mode: mode })
        }} style={{ ...C.btnP, flex: 1 }}>Save & mark Scheduled</button>
      </div>
    </div>
  )
}

function AssessmentForm({ round, prevRounds, onCancel, onSubmit }: {
  round: Round
  prevRounds: Round[]
  onCancel: () => void
  onSubmit: (payload: { params: ParamFeedback[]; recommendation: Recommendation; next_round_suggestion: string; suggested_interviewer: string; notes_for_recruiter: string; overall_score: number }) => void
}) {
  const cfg = cfgFor(round.round_type)
  const defs = cfg.params
  const [params, setParams] = useState<ParamFeedback[]>(
    (round.params && round.params.length ? round.params : defs.map(d => ({ param_id: d.id, param_label: d.label, rating: 0, text: '' })))
  )
  const [tab, setTab] = useState(0)
  const [rec, setRec] = useState<Recommendation>(round.recommendation || null)
  const [nextRound, setNextRound] = useState(round.next_round_suggestion || '')
  const [suggInterviewer, setSuggInterviewer] = useState(round.suggested_interviewer || '')
  const [notes, setNotes] = useState(round.notes_for_recruiter || '')

  const setParam = (idx: number, patch: Partial<ParamFeedback>) => setParams(ps => ps.map((p, i) => i === idx ? { ...p, ...patch } : p))
  const liveScore = scoreOf(params)
  const def = defs[tab]
  const cur = params[tab]

  return (
    <div>
      <PrevFeedbackBlock rounds={prevRounds} />

      <div style={C.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={C.pill(cfg.lightBg, cfg.color)}>{cfg.badge}</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{round.round_type} — Assessment</span>
          </div>
          {liveScore > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>Score: {liveScore}/100</span>}
        </div>

        {/* Parameter tabs */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
          {defs.map((d, i) => (
            <button key={d.id} onClick={() => setTab(i)} style={{
              padding: '6px 11px', borderRadius: 7, border: `1px solid ${i === tab ? cfg.color : 'rgba(37,99,235,0.15)'}`,
              background: i === tab ? cfg.color : '#fff', color: i === tab ? '#fff' : TK.muted,
              fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              {params[i].rating > 0 ? '★ ' : ''}{d.label}
            </button>
          ))}
        </div>

        {/* Active parameter */}
        <div style={{ marginBottom: 8 }}>
          <label style={C.lbl}>{def.label}</label>
          <StarRating value={cur.rating} onChange={v => setParam(tab, { rating: v })} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
            {def.tags.map(tg => (
              <button key={tg} onClick={() => setParam(tab, { text: clampWords((cur.text ? cur.text + ' ' : '') + tg, 100) })}
                style={{ padding: '3px 9px', borderRadius: 99, border: '1px solid rgba(37,99,235,0.2)', background: TK.sunken, color: TK.brandDeep, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                + {tg}
              </button>
            ))}
          </div>
          <textarea style={{ ...C.inp, minHeight: 80, resize: 'vertical' }} value={cur.text}
            onChange={e => setParam(tab, { text: clampWords(e.target.value, 100) })}
            placeholder={`Feedback on ${def.label.toLowerCase()} (max 100 words)`} />
          <div style={{ fontSize: 10, color: words(cur.text) >= 100 ? TK.critical : TK.faint, textAlign: 'right', marginTop: 2 }}>{words(cur.text)}/100 words</div>
        </div>
      </div>

      {/* Recommendation */}
      <div style={C.card}>
        <label style={C.lbl}>Recommendation</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setRec('yes')} style={{ ...C.btnO, ...(rec === 'yes' ? { background: TK.positive, color: '#fff', borderColor: TK.positive } : {}) }}>Proceed to next round</button>
          <button onClick={() => setRec('hold')} style={{ ...C.btnO, ...(rec === 'hold' ? { background: TK.warning, color: '#fff', borderColor: TK.warning } : {}) }}>On hold</button>
          <button onClick={() => setRec('no')} style={{ ...C.btnO, ...(rec === 'no' ? { background: TK.critical, color: '#fff', borderColor: TK.critical } : {}) }}>Do not proceed</button>
        </div>
        {rec === 'yes' && (
          <div style={C.g2}>
            <div><label style={C.lbl}>Suggest next round</label>
              <select style={C.inp} value={nextRound} onChange={e => setNextRound(e.target.value)}>
                <option value="">Select…</option>
                {BUILT_IN_ROUNDS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div><label style={C.lbl}>Suggest interviewer</label><input style={C.inp} value={suggInterviewer} onChange={e => setSuggInterviewer(e.target.value)} placeholder="Name or email (optional)" /></div>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <label style={C.lbl}>Notes for recruiter (optional)</label>
          <textarea style={{ ...C.inp, minHeight: 60, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} style={C.btnO}>Cancel</button>
        <button onClick={() => {
          if (!params.some(p => p.rating > 0)) { alert('Rate at least one parameter'); return }
          if (!rec) { alert('Please select a recommendation'); return }
          onSubmit({ params, recommendation: rec, next_round_suggestion: nextRound, suggested_interviewer: suggInterviewer, notes_for_recruiter: notes, overall_score: liveScore })
        }} style={{ ...C.btnG, flex: 1 }}>Submit assessment</button>
      </div>
    </div>
  )
}

function DetailView({ round, onBack }: { round: Round; onBack: () => void }) {
  const cfg = cfgFor(round.round_type)
  const recLabel = round.recommendation === 'yes' ? 'Proceed' : round.recommendation === 'hold' ? 'On hold' : round.recommendation === 'no' ? 'Do not proceed' : '—'
  return (
    <div>
      <button onClick={onBack} style={{ ...C.btnO, marginBottom: 12 }}>Back to pipeline</button>
      <div style={C.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={C.pill(cfg.lightBg, cfg.color)}>{cfg.badge}</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{round.round_type}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{round.overall_score ?? 0}/100</span>
        </div>
        <div style={{ fontSize: 11, color: TK.muted, marginBottom: 12 }}>
          {round.interviewer_name || '—'} · {fmtDate(round.scheduled_at)} · {round.interview_mode || '—'} · Recommendation: <strong>{recLabel}</strong>
        </div>
        {(round.params || []).map(p => (
          <div key={p.param_id} style={{ borderTop: '1px solid #EDE9FE', paddingTop: 8, marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{p.param_label} <span style={{ color: TK.warning }}>{''.repeat(p.rating)}{''.repeat(5 - p.rating)}</span></div>
            {p.text && <div style={{ fontSize: 12, color: TK.inkSoft, marginTop: 2 }}>{p.text}</div>}
          </div>
        ))}
        {round.next_round_suggestion && <div style={{ fontSize: 12, color: TK.brandDeep, marginTop: 12 }}>Suggested next: <strong>{round.next_round_suggestion}</strong>{round.suggested_interviewer ? ` (by ${round.suggested_interviewer})` : ''}</div>}
        {round.notes_for_recruiter && <div style={{ fontSize: 12, color: TK.muted, marginTop: 6, fontStyle: 'italic' }}>Note: {round.notes_for_recruiter}</div>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════
export default function InterviewPipeline({ candidate, initialRounds }: { candidate: Candidate; initialRounds?: Round[] }) {
  const [rounds, setRounds] = useState<Round[]>(initialRounds || [])

  useEffect(() => {
    supabase
      .from('interview_rounds')
      .select('*')
      .eq('candidate_id', candidate.id)
      .order('round_number', { ascending: true })
      .then(({ data }) => {
        if (data?.length) {
          setRounds(data.map((r: any) => ({
            ...r,
            params: typeof r.params === 'string' ? JSON.parse(r.params) : (r.params || []),
          })))
        }
      })
  }, [candidate.id])

  const [view, setView] = useState<'pipeline' | 'schedule' | 'feedback' | 'detail'>('pipeline')
  const [activeRound, setActiveRound] = useState<Round | null>(null)
  const [picking, setPicking] = useState(false)
  const [customName, setCustomName] = useState('')
  const [busy, setBusy] = useState(false)

  const doneRounds = rounds.filter(r => r.status === 'done')
  const avgScore = doneRounds.length ? Math.round(doneRounds.reduce((a, b) => a + (b.overall_score || 0), 0) / doneRounds.length) : null

  async function addRound(type: string) {
    setBusy(true)
    const round_number = (rounds.reduce((m, r) => Math.max(m, r.round_number), 0)) + 1
    const { data, error } = await supabase.from('interview_rounds').insert({
      candidate_id: candidate.id, round_type: type, round_number, status: 'pending', params: [],
    }).select('*').single()
    setBusy(false)
    if (error || !data) { alert('Could not add round: ' + (error?.message || '')); return }
    const r: Round = { ...data, params: [] }
    setRounds(rs => [...rs, r])
    setPicking(false); setCustomName('')
    setActiveRound(r); setView('schedule')
  }

  async function saveSchedule(d: { interviewer_name: string; interviewer_email: string; scheduled_at: string; interview_mode: string }) {
    if (!activeRound) return
    setBusy(true)
    const { error } = await supabase.from('interview_rounds').update({ ...d, status: 'scheduled' }).eq('id', activeRound.id)
    setBusy(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setRounds(rs => rs.map(r => r.id === activeRound.id ? { ...r, ...d, status: 'scheduled' } : r))
    setActiveRound(null); setView('pipeline')
  }

  async function submitFeedback(payload: { params: ParamFeedback[]; recommendation: Recommendation; next_round_suggestion: string; suggested_interviewer: string; notes_for_recruiter: string; overall_score: number }) {
    if (!activeRound) return
    setBusy(true)
    const status: RoundStatus = payload.recommendation === 'no' ? 'rejected' : 'done'
    const upd = {
      params: payload.params,
      recommendation: payload.recommendation,
      next_round_suggestion: payload.next_round_suggestion || null,
      suggested_interviewer: payload.suggested_interviewer || null,
      notes_for_recruiter: payload.notes_for_recruiter || null,
      overall_score: payload.overall_score,
      status,
      feedback_submitted_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('interview_rounds').update(upd).eq('id', activeRound.id)
    setBusy(false)
    if (error) { alert('Submit failed: ' + error.message); return }
    setRounds(rs => rs.map(r => r.id === activeRound.id ? { ...r, ...upd } : r))
    setActiveRound(null); setView('pipeline')
  }

  // ── SCHEDULE ──
  if (view === 'schedule' && activeRound) {
    return <div style={{ ...C.page, padding: 20 }}><div style={{ maxWidth: 760, margin: '0 auto' }}>
      <button onClick={() => { setActiveRound(null); setView('pipeline') }} style={{ ...C.btnO, marginBottom: 12 }}>Back to pipeline</button>
      <ScheduleForm round={activeRound} onCancel={() => { setActiveRound(null); setView('pipeline') }} onSave={saveSchedule} />
    </div></div>
  }
  // ── FEEDBACK ──
  if (view === 'feedback' && activeRound) {
    const prev = rounds.filter(r => r.round_number < activeRound.round_number)
    return <div style={{ ...C.page, padding: 20 }}><div style={{ maxWidth: 760, margin: '0 auto' }}>
      <button onClick={() => { setActiveRound(null); setView('pipeline') }} style={{ ...C.btnO, marginBottom: 12 }}>Back to pipeline</button>
      <AssessmentForm round={activeRound} prevRounds={prev} onCancel={() => { setActiveRound(null); setView('pipeline') }} onSubmit={submitFeedback} />
    </div></div>
  }
  // ── DETAIL ──
  if (view === 'detail' && activeRound) {
    return <div style={{ ...C.page, padding: 20 }}><div style={{ maxWidth: 760, margin: '0 auto' }}>
      <DetailView round={activeRound} onBack={() => { setActiveRound(null); setView('pipeline') }} />
    </div></div>
  }

  // ── PIPELINE (default) ──
  return (
    <div style={{ ...C.page, padding: 20 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Candidate header */}
        <div style={C.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{candidate.full_name}</div>
              <div style={{ fontSize: 12, color: TK.muted, marginTop: 2 }}>{candidate.designation || '—'}{candidate.department ? ` · ${candidate.department}` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              {candidate.ai_score != null && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: TK.faint }}>AI SCORE</div><div style={{ fontSize: 18, fontWeight: 700, color: TK.brand }}>{candidate.ai_score}</div></div>}
              {avgScore != null && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 10, color: TK.faint }}>AVG ROUNDS</div><div style={{ fontSize: 18, fontWeight: 700, color: TK.positive }}>{avgScore}</div></div>}
            </div>
          </div>
        </div>

        {/* Timeline */}
        {rounds.length > 0 && (
          <div style={{ ...C.card, overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 4 }}>
              {rounds.map((r, i) => <RoundNode key={r.id} round={r} isLast={i === rounds.length - 1} />)}
            </div>
          </div>
        )}

        {/* Round cards */}
        {rounds.map(r => (
          <RoundCard key={r.id} round={r}
            onSchedule={(rr) => { setActiveRound(rr); setView('schedule') }}
            onAssess={(rr) => { setActiveRound(rr); setView('feedback') }}
            onView={(rr) => { setActiveRound(rr); setView('detail') }} />
        ))}
        {rounds.length === 0 && <div style={{ ...C.card, textAlign: 'center', color: TK.faint, padding: 28 }}>No interview rounds yet. Add the first round below.</div>}

        {/* Add round */}
        {!picking ? (
          <button onClick={() => setPicking(true)} style={{ ...C.btnP, marginTop: 4 }}>+ Add round</button>
        ) : (
          <div style={C.card}>
            <label style={C.lbl}>Choose a round type</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {BUILT_IN_ROUNDS.map(t => {
                const cfg = cfgFor(t)
                return <button key={t} disabled={busy} onClick={() => addRound(t)} style={{ ...C.btnO, borderColor: cfg.color, color: cfg.color }}>{cfg.badge} · {t}</button>
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...C.inp, flex: 1 }} value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Or a custom round name (e.g. Panel Interview)" />
              <button disabled={busy || !customName.trim()} onClick={() => addRound(customName.trim())} style={{ ...C.btnP, opacity: busy || !customName.trim() ? .5 : 1 }}>Add</button>
              <button onClick={() => { setPicking(false); setCustomName('') }} style={C.btnO}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
