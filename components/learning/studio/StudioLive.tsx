'use client'
// components/learning/studio/StudioLive.tsx — live sessions (webinars) in the Studio: the list,
// a new or edited session, and one session's register. The call itself is the company's Zoom,
// Meet or Teams; this is the schedule, the invitations, attendance and the recording.
//
// Everything is sent to /api/lms/admin/sessions, which decides (lib/lms/live.ts): inviting the
// whole company needs organisation-wide rights, branch HR invite their branch only, and every
// change people would put in a calendar sends them the updated invitation.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { uploadLmsFile, formatBytes } from '@/lib/lms/upload-client'
import { IconCheck, IconPlus } from '@/lib/ui'
import { ActionNotes, LoadError, NeedCompany, Toggle, plural, useAction, useLoad, withCompany, type Ctx, type Target } from '../admin/shared'
import { ASSIGN_KINDS, AudienceEditor } from '../admin/AudienceEditor'
import { Skel } from '../shared'
import { GArrowLeft, GCalendar, GClock, GLayers, GLive, GPlay, GUsers } from '../glyphs'
import { linkProps, navigate, to } from '../app/router'
import '../live.css'

const IST = 'Asia/Kolkata'
type Phase = 'cancelled' | 'upcoming' | 'joinable' | 'live' | 'ended'
const PHASE: Record<Phase, { label: string; t: string }> = {
  upcoming: { label: 'Scheduled', t: 'brand' }, joinable: { label: 'Starting soon', t: 'warning' }, live: { label: 'Live now', t: 'critical' },
  ended: { label: 'Held', t: 'positive' }, cancelled: { label: 'Cancelled', t: 'neutral' },
}
const STATUS: Record<string, string> = { INVITED: 'Invited', REGISTERED: 'Registered', DECLINED: 'Not going', REMOVED: 'Removed' }

/** The date and time a session starts, as the fields show them: in India time. */
function istParts(iso?: string | null) {
  if (!iso) return { date: '', time: '16:00' }
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString()
  return { date: d.slice(0, 10), time: d.slice(11, 16) }
}
const fromIst = (date: string, time: string) => (date && time ? new Date(`${date}T${time}:00+05:30`).toISOString() : '')
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

function PhaseTag({ phase }: { phase: Phase }) {
  const p = PHASE[phase] || PHASE.upcoming
  return <span className={`lx-tag ${p.t !== 'neutral' ? `lx-tag--${p.t}` : ''}`}>{phase === 'live' || phase === 'joinable' ? <span className="lx-live-dot" /> : null}{p.label}</span>
}

// ── The form ────────────────────────────────────────────────────────────────
interface FormValue {
  title: string; description: string; date: string; time: string; duration_min: string; join_url: string; location: string
  host_name: string; capacity: string; open_registration: boolean; course_id: string
}

function SessionForm({ ctx, initial, courses, lookups, presetCourse, onSaved, onCancel }: {
  ctx: Ctx; initial?: any; courses: any[]; lookups: any; presetCourse?: string | null
  onSaved: (id: string, note: string) => void; onCancel: () => void
}) {
  const start = istParts(initial?.starts_at)
  const [v, setV] = useState<FormValue>({
    title: initial?.title || '', description: initial?.description || '', date: start.date, time: start.time,
    duration_min: String(initial?.duration_min || 60), join_url: initial?.join_url || '', location: initial?.location || '',
    host_name: initial?.host_name || '', capacity: initial?.capacity ? String(initial.capacity) : '',
    open_registration: !!initial?.open_registration, course_id: initial?.course_id || presetCourse || '',
  })
  const [targets, setTargets] = useState<Target[]>([])
  const a = useAction()
  const set = (p: Partial<FormValue>) => setV(x => ({ ...x, ...p }))
  const kinds = ctx.branchOnly ? ASSIGN_KINDS.filter(k => k !== 'LOCATION') : ASSIGN_KINDS
  const missing = !v.title.trim() ? 'Give it a title.' : !v.date || !v.time ? 'Choose the date and time.' : !v.join_url.trim() && !v.location.trim() ? 'Add the meeting link, or a room.' : ''

  const save = async () => {
    const body = {
      company_id: ctx.company, title: v.title, description: v.description, starts_at: fromIst(v.date, v.time), duration_min: Number(v.duration_min) || 60,
      join_url: v.join_url, location: v.location, host_name: v.host_name, capacity: v.capacity, open_registration: v.open_registration, course_id: v.course_id || null,
      ...(initial ? {} : { targets: targets.filter(t => t.value || t.kind === 'COMPANY') }),
    }
    const r: any = await a.run(() => initial ? lmsApi(`/api/lms/admin/sessions/${initial.id}`, body, 'PATCH') : lmsApi('/api/lms/admin/sessions', body))
    if (!r) return
    const inv = r.invited
    const note = initial
      ? (r.mailed?.sent ? `Saved. ${plural(r.mailed.sent, 'person was', 'people were')} sent the updated invitation.` : 'Saved.')
      : inv ? `Scheduled, and ${plural(inv.invited, 'person')} invited${inv.mailed ? `; ${inv.mailed} invitation${inv.mailed === 1 ? '' : 's'} sent now` : ''}${inv.left ? `, the other ${inv.left} with tomorrow morning's mail` : ''}.` : 'Scheduled. Invite people from its page.'
    onSaved(r.session.id, note)
  }

  return (
    <div className="lx-st-host lx-in">
      <div className="lx-lv-form">
        <h2 style={{ margin: 0, fontSize: 20 }}>{initial ? 'Edit the session' : 'New live session'}</h2>
        <label>Title<input className="lx-input" value={v.title} onChange={e => set({ title: e.target.value })} placeholder="For example: DPDP Act — your questions answered" /></label>
        <label>What it covers<textarea value={v.description} onChange={e => set({ description: e.target.value })} placeholder="Shown on the invitation and in EZER Learn" /></label>
        <div className="lx-lv-row">
          <label>Date<input className="lx-input" type="date" value={v.date} onChange={e => set({ date: e.target.value })} /></label>
          <label>Start time (IST)<input className="lx-input" type="time" value={v.time} onChange={e => set({ time: e.target.value })} /></label>
          <label>Length (minutes)<input className="lx-input" type="number" min={5} max={600} step={5} value={v.duration_min} onChange={e => set({ duration_min: e.target.value })} /></label>
        </div>
        <div className="lx-lv-row">
          <label>Meeting link<input className="lx-input" value={v.join_url} onChange={e => set({ join_url: e.target.value })} placeholder="https://meet.google.com/… or Zoom / Teams" /></label>
          <label>Or a room, if in person<input className="lx-input" value={v.location} onChange={e => set({ location: e.target.value })} placeholder="Training room, 3rd floor" /></label>
        </div>
        <div className="lx-lv-row">
          <label>Host<input className="lx-input" value={v.host_name} onChange={e => set({ host_name: e.target.value })} placeholder="Who presents it" /></label>
          <label>Seats<input className="lx-input" type="number" min={1} value={v.capacity} onChange={e => set({ capacity: e.target.value })} placeholder="No limit" /></label>
          <label>Part of a course
            <select className="lx-select" style={{ height: 40 }} value={v.course_id} onChange={e => set({ course_id: e.target.value })}>
              <option value="">Not linked to a course</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}{c.status !== 'PUBLISHED' ? ' (draft)' : ''}</option>)}
            </select>
          </label>
        </div>
        {v.course_id && <div className="lx-st-hint">Attending this session, or watching most of its recording, completes the course’s live-session lesson.</div>}
        <Toggle checked={v.open_registration} onChange={x => set({ open_registration: x })} label="Open to everyone in the company"
          hint="Anyone can find it under Live sessions and register. Invited people get an invitation either way." />
        {!initial && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="lx-st-label" style={{ margin: 0 }}>Invite now (optional)</div>
            {lookups ? <AudienceEditor value={targets} onChange={setTargets} lookups={lookups} kinds={kinds} allowCompany={ctx.caps.automate} logicHint={false} /> : <Skel h={60} r={12} />}
            <div className="lx-st-hint">Each person gets an email with a calendar invitation. You can invite more people later.</div>
          </div>
        )}
        <ActionNotes a={a} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="lx-btn lx-btn--primary" disabled={a.busy || !!missing} onClick={save}>{a.busy ? 'Saving…' : initial ? 'Save changes' : 'Schedule the session'}</button>
          <button className="lx-btn lx-btn--ghost" onClick={onCancel}>Cancel</button>
          {missing && <span className="lx-st-hint">{missing}</span>}
        </div>
      </div>
    </div>
  )
}

// ── One session ─────────────────────────────────────────────────────────────
function Recording({ s, rec, onChanged }: { s: any; rec: any; onChanged: (note: string) => void }) {
  const [pct, setPct] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pick = async (file: File) => {
    setErr(''); setBusy(true); setPct(0)
    try {
      const asset = await uploadLmsFile(file, { kind: 'VIDEO', companyId: s.company_id, onProgress: setPct, purpose: 'recording' })
      const r: any = await lmsApi(`/api/lms/admin/sessions/${s.id}`, { action: 'recording', asset_id: asset.id })
      onChanged(r.missed ? `Recording added. ${plural(r.missed, 'person', 'people')} who missed it were sent it.` : 'Recording added.')
    } catch (e: any) { setErr(e?.message || 'The recording could not be uploaded.') } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="lx-st-label" style={{ margin: 0 }}>Recording</div>
      {rec ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><GPlay size={14} /> <b style={{ fontWeight: 650 }}>{rec.original_name}</b><span className="lx-st-hint">{[rec.size_bytes && formatBytes(Number(rec.size_bytes)), rec.duration_s && `${Math.round(Number(rec.duration_s) / 60)} min`].filter(Boolean).join(' · ')}</span></div>
        : <div className="lx-st-hint">None yet. Download it from Zoom, Meet or Teams as MP4 and upload it here; people who registered and missed the session are sent it once the session is marked as held.</div>}
      {busy && <div className="lx-lv-bar" style={{ maxWidth: 320 }}><i style={{ width: `${pct}%` }} /></div>}
      <div>
        <label className="lx-btn lx-btn--sm" style={{ cursor: busy ? 'progress' : 'pointer' }}>
          {busy ? `Uploading ${pct}%` : rec ? 'Replace the recording' : 'Upload the recording'}
          <input type="file" accept="video/mp4,.mp4" hidden disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f) }} />
        </label>
      </div>
      {err && <div className="lx-lv-err" role="alert">{err}</div>}
    </div>
  )
}

function Invite({ ctx, s, lookups, onDone }: { ctx: Ctx; s: any; lookups: any; onDone: (note: string) => void }) {
  const [targets, setTargets] = useState<Target[]>([])
  const a = useAction()
  const kinds = ctx.branchOnly ? ASSIGN_KINDS.filter(k => k !== 'LOCATION') : ASSIGN_KINDS
  const send = async () => {
    const r: any = await a.run(() => lmsApi(`/api/lms/admin/sessions/${s.id}`, { action: 'invite', targets: targets.filter(t => t.value || t.kind === 'COMPANY') }))
    if (r) { setTargets([]); onDone(r.invited ? `${plural(r.invited, 'person', 'people')} invited${r.mailed ? `, ${r.mailed} invitation${r.mailed === 1 ? '' : 's'} sent` : ''}${r.left ? `; the other ${r.left} go out with tomorrow morning's mail` : ''}.` : 'Everyone you chose was already invited.') }
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {lookups ? <AudienceEditor value={targets} onChange={setTargets} lookups={lookups} kinds={kinds} allowCompany={ctx.caps.automate} logicHint={false} /> : <Skel h={60} r={12} />}
      <ActionNotes a={a} />
      <div><button className="lx-btn lx-btn--primary lx-btn--sm" disabled={a.busy || !targets.some(t => !t.exclude && (t.value || t.kind === 'COMPANY'))} onClick={send}>{a.busy ? 'Inviting…' : 'Send invitations'}</button></div>
    </div>
  )
}

function RegisterRow({ r, s, canEdit, onChanged }: { r: any; s: any; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const attendance = async (on: boolean) => {
    setBusy(true)
    try { await lmsApi(`/api/lms/admin/sessions/${s.id}`, { action: 'attendance', learners: [r.learner_id], attended: on }); onChanged() } catch (e: any) { window.alert(e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(`Take ${r.name} off this session?`)) return
    setBusy(true)
    try { await lmsApi(`/api/lms/admin/sessions/${s.id}`, { action: 'remove', learner_id: r.learner_id }); onChanged() } finally { setBusy(false) }
  }
  const started = Date.now() >= new Date(s.starts_at).getTime() - 15 * 60_000
  return (
    <tr>
      <td><b style={{ fontWeight: 650 }}>{r.name}</b><div className="lx-st-hint">{[r.emp_code, r.designation].filter(Boolean).join(' · ')}</div></td>
      <td>{STATUS[r.status] || r.status}{r.source === 'SELF' ? <div className="lx-st-hint">signed up</div> : null}</td>
      <td>{r.joined_at ? <span title="Pressed Join in EZER Learn">{new Date(r.joined_at).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' })}</span> : <span className="lx-st-hint">—</span>}</td>
      <td>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: canEdit && started && s.status !== 'CANCELLED' ? 'pointer' : 'default' }}>
          <input type="checkbox" checked={!!r.attended} disabled={!canEdit || busy || !started || s.status === 'CANCELLED'} onChange={e => void attendance(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--ez-positive)' }} />
          {r.attended ? (r.attendance_by === 'CODE' ? 'Code' : 'Ticked') : ''}
        </label>
      </td>
      <td className="lx-num">{r.recording_done ? <span className="lx-tag lx-tag--positive"><IconCheck size={11} /> Watched</span> : Number(r.recording_watched_s) > 0 ? `${Math.round(Number(r.recording_watched_s) / 60)} min` : <span className="lx-st-hint">—</span>}</td>
      <td style={{ textAlign: 'right' }}>{canEdit && r.status !== 'REMOVED' && <button className="lx-btn lx-btn--ghost lx-btn--sm" disabled={busy} onClick={remove}>Remove</button>}</td>
    </tr>
  )
}

function SessionDetail({ ctx, id, courses, lookups, onBack }: { ctx: Ctx; id: string; courses: any[]; lookups: any; onBack: () => void }) {
  const d = useLoad<any>(() => lmsApi(`/api/lms/admin/sessions/${id}`), [id])
  const [mode, setMode] = useState<'view' | 'edit' | 'invite'>('view')
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const a = useAction()
  const s = d.data?.session
  const people: any[] = useMemo(() => (d.data?.attendees || []).filter((r: any) => r.status !== 'REMOVED' && (!q || `${r.name} ${r.emp_code || ''}`.toLowerCase().includes(q.toLowerCase()))), [d.data, q])
  if (d.error) return <LoadError error={d.error} setup={d.setup} />
  if (!s) return <Skel h={360} r={20} />
  const canEdit = ctx.caps.assign
  const all = (d.data.attendees || []).filter((r: any) => r.status !== 'REMOVED')
  const counts = { invited: all.length, registered: all.filter((r: any) => r.status === 'REGISTERED').length, attended: all.filter((r: any) => r.attended).length, watched: all.filter((r: any) => r.recording_done && !r.attended).length }
  const done = (text: string) => { setNote(text); setMode('view'); d.reload() }
  const act = (body: any, ok: string, confirm?: string) => async () => {
    if (confirm && !window.confirm(confirm)) return
    const r: any = await a.run(() => lmsApi(`/api/lms/admin/sessions/${s.id}`, body))
    if (r) done(typeof r.mailed === 'number' && body.action === 'cancel' ? `${ok} ${plural(r.mailed, 'cancellation')} sent.` : ok)
  }

  if (mode === 'edit') return <SessionForm ctx={ctx} initial={s} courses={courses} lookups={lookups} onSaved={(_, n) => done(n)} onCancel={() => setMode('view')} />
  const live = s.phase === 'live' || s.phase === 'joinable'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div><button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onBack}><GArrowLeft size={15} /> All live sessions</button></div>
      {note && <div className="lx-note" data-t="positive" role="status">{note}</div>}
      <div className="lx-st-host lx-in" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: '1 1 320px', display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><PhaseTag phase={s.phase} />{s.open_registration && <span className="lx-tag">Open to everyone</span>}{d.data.course && <a className="lx-tag" {...linkProps(to.studio('courses', d.data.course.id))}>Part of {d.data.course.title}</a>}</div>
            <h2 style={{ margin: 0, fontSize: 22 }}>{s.title}</h2>
            <div className="lx-lv-meta"><span><GCalendar size={14} /> {when(s.starts_at)} IST</span><span><GClock size={14} /> {s.duration_min} min</span>{s.host_name && <span><GUsers size={14} /> {s.host_name}</span>}{s.capacity && <span>{s.capacity} seats</span>}</div>
            {s.join_url && <div style={{ fontSize: 13.5, wordBreak: 'break-all' }}>Link: <a href={s.join_url} target="_blank" rel="noopener noreferrer">{s.join_url}</a></div>}
            {s.location && <div style={{ fontSize: 13.5 }}>Where: {s.location}</div>}
            {s.description && <div className="lx-lv-desc">{s.description}</div>}
            {s.status === 'CANCELLED' && <div className="lx-lv-desc">Cancelled{s.cancel_reason ? `: ${s.cancel_reason}` : '.'}</div>}
          </div>
          {s.status !== 'CANCELLED' && (
            <div style={{ display: 'grid', gap: 8, alignContent: 'start', justifyItems: 'start' }}>
              <div className="lx-st-label" style={{ margin: 0 }}>Attendance code</div>
              <div className="lx-lv-codebox" aria-label={`Attendance code ${s.checkin_code}`}>{s.checkin_code}</div>
              <div className="lx-st-hint" style={{ maxWidth: 260 }}>{live ? 'Read it out or show it on screen now.' : 'Read it out during the session.'} People type it under Live sessions to record that they attended.</div>
            </div>
          )}
        </div>
        <div className="lx-lv-stats">
          <div className="lx-lv-stat"><b>{counts.invited}</b><span>Invited</span></div>
          <div className="lx-lv-stat"><b>{counts.registered}</b><span>Registered</span></div>
          <div className="lx-lv-stat"><b>{counts.attended}</b><span>Attended</span></div>
          <div className="lx-lv-stat"><b>{counts.watched}</b><span>Watched the recording instead</span></div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {s.status === 'SCHEDULED' && <button className="lx-btn lx-btn--sm" onClick={() => setMode(mode === 'invite' ? 'view' : 'invite')}><IconPlus size={14} /> Invite people</button>}
            {s.status !== 'CANCELLED' && <button className="lx-btn lx-btn--sm" onClick={() => setMode('edit')}>Edit details</button>}
            {s.status === 'SCHEDULED' && s.phase !== 'upcoming' && <button className="lx-btn lx-btn--sm" disabled={a.busy} onClick={act({ action: 'attendance', all: true }, 'Everyone on the list is marked as attended. Untick anyone who did not come.')}>Mark everyone attended</button>}
            {s.status === 'SCHEDULED' && s.phase !== 'upcoming' && <button className="lx-btn lx-btn--primary lx-btn--sm" disabled={a.busy} onClick={act({ action: 'complete' }, 'Marked as held. Attendance can still be corrected.')}>Mark as held</button>}
            {s.status === 'SCHEDULED' && <button className="lx-btn lx-btn--ghost lx-btn--sm" disabled={a.busy} onClick={async () => { const reason = window.prompt('Why is it cancelled? Invited people are told, and the event leaves their calendars.'); if (reason !== null) await act({ action: 'cancel', reason }, 'Cancelled.')() }}>Cancel the session</button>}
          </div>
        )}
        <ActionNotes a={a} />
        {mode === 'invite' && <Invite ctx={ctx} s={s} lookups={lookups} onDone={done} />}
        {canEdit && s.status !== 'CANCELLED' && <Recording s={s} rec={d.data.recording} onChanged={done} />}
      </div>

      <div className="lx-st-host" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 15 }}>Register <span className="lx-st-hint">({plural(all.length, 'person', 'people')})</span></b>
          <input className="lx-input" style={{ height: 36, maxWidth: 260, fontSize: 13.5 }} placeholder="Find a person" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a person" />
        </div>
        {people.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="lx-lv-reg">
              <thead><tr><th>Person</th><th>Status</th><th>Pressed Join</th><th>Attended</th><th>Recording</th><th /></tr></thead>
              <tbody>{people.map(r => <RegisterRow key={r.id} r={r} s={s} canEdit={canEdit} onChanged={d.reload} />)}</tbody>
            </table>
          </div>
        ) : <div className="lx-st-hint" style={{ padding: '0 16px 16px' }}>{all.length ? 'Nobody matches.' : 'Nobody is invited yet.'}</div>}
      </div>
    </div>
  )
}

// ── The list ────────────────────────────────────────────────────────────────
function SessionRow({ s, onOpen }: { s: any; onOpen: () => void }) {
  return (
    <button className="lx-lv" data-phase={s.phase} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%' }} onClick={onOpen}>
      <div className="lx-lv-date" aria-hidden>
        <b>{new Date(s.starts_at).toLocaleDateString('en-GB', { timeZone: IST, weekday: 'short' })}</b>
        <span>{new Date(s.starts_at).toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric' })}</span>
        <i>{new Date(s.starts_at).toLocaleDateString('en-GB', { timeZone: IST, month: 'short' })}</i>
      </div>
      <div className="lx-lv-body">
        <div className="lx-lv-tags"><PhaseTag phase={s.phase} />{s.recording_asset_id && <span className="lx-tag"><GPlay size={11} /> Recording</span>}</div>
        <div className="lx-lv-title">{s.title}</div>
        <div className="lx-lv-meta">
          <span><GClock size={14} /> {when(s.starts_at)} · {s.duration_min} min</span>
          <span><GUsers size={14} /> {s.counts.invited} invited · {s.counts.registered} registered{s.phase === 'ended' ? ` · ${s.counts.attended} attended` : ''}</span>
        </div>
        {s.course_title && <div className="lx-lv-course"><GLayers size={14} /><span className="lx-clamp1">Part of <b>{s.course_title}</b></span></div>}
      </div>
    </button>
  )
}

export default function StudioLive({ ctx, item, tick }: { ctx: Ctx; item: string | null; tick: number }) {
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/sessions')), [ctx.company])
  const extra = useLoad<{ courses: any[]; lookups: any } | null>(async () => {
    if (!ctx.company) return null
    const [c, l] = await Promise.all([lmsApi(`/api/lms/admin/courses?company=${ctx.company}`), lmsApi(`/api/lms/admin/lookups?company=${ctx.company}`)])
    return { courses: (c.courses || []).filter((x: any) => x.status !== 'ARCHIVED'), lookups: l }
  }, [ctx.company])
  const [seen, setSeen] = useState(tick)
  const [making, setMaking] = useState(false)
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming')
  // A lesson editor's "Open Live sessions" link names its course: start a session for it.
  const [presetCourse] = useState(() => { try { return new URLSearchParams(window.location.search).get('course') } catch { return null } })
  const [auto, setAuto] = useState(!!presetCourse)
  const creating = making || tick !== seen || auto
  const stop = () => { setSeen(tick); setMaking(false); setAuto(false) }

  if (item) return <SessionDetail key={item} ctx={ctx} id={item} courses={extra.data?.courses || []} lookups={extra.data?.lookups || null} onBack={() => { navigate(to.studio('live')); list.reload() }} />
  if (creating) {
    if (!ctx.company) return <div className="lx-st-host"><NeedCompany doing="schedule a live session" /><button className="lx-btn" onClick={stop}>Back</button></div>
    return <SessionForm ctx={ctx} courses={extra.data?.courses || []} lookups={extra.data?.lookups || null} presetCourse={presetCourse}
      onSaved={(id, n) => { stop(); setNote(n); navigate(to.studio('live', id)) }} onCancel={stop} />
  }

  const all: any[] = list.data?.sessions || []
  const groups = {
    upcoming: all.filter(s => s.phase !== 'ended' && s.phase !== 'cancelled').sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    past: all.filter(s => s.phase === 'ended'),
    cancelled: all.filter(s => s.phase === 'cancelled'),
  }
  const rows = groups[tab]
  const held = groups.past
  const attended = held.reduce((n, s) => n + s.counts.attended, 0), invited = held.reduce((n, s) => n + s.counts.invited, 0)
  return (
    <>
      {note && <div className="lx-note" data-t="positive" role="status">{note}</div>}
      <LoadError error={list.error} setup={list.setup} />
      {list.data && (
        <div className="lx-st-kpis">
          <div className="lx-st-kpi"><i><GLive size={18} /></i><b>{groups.upcoming.length}</b><span>Coming up</span><small>{groups.upcoming.filter(s => s.phase === 'live').length ? 'one is live now' : 'scheduled'}</small></div>
          <div className="lx-st-kpi" data-t="positive"><i><GUsers size={18} /></i><b>{held.length}</b><span>Held</span><small>{plural(attended, 'attendance')}</small></div>
          <div className="lx-st-kpi" data-t="gold"><i><IconCheck size={18} /></i><b>{invited ? `${Math.round(attended / invited * 100)}%` : '—'}</b><span>Turn-up rate</span><small>attended of invited, sessions held</small></div>
        </div>
      )}
      <div className="lx-st-bar">
        <div className="lx-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'upcoming'} onClick={() => setTab('upcoming')}>Upcoming ({groups.upcoming.length})</button>
          <button role="tab" aria-selected={tab === 'past'} onClick={() => setTab('past')}>Held ({groups.past.length})</button>
          <button role="tab" aria-selected={tab === 'cancelled'} onClick={() => setTab('cancelled')}>Cancelled ({groups.cancelled.length})</button>
        </div>
      </div>
      {list.loading && !list.data ? <Skel h={260} r={18} /> : rows.length ? (
        <div className="lx-lv-list">{rows.map(s => <SessionRow key={s.id} s={s} onOpen={() => navigate(to.studio('live', s.id))} />)}</div>
      ) : (
        <div className="lx-empty">
          <div className="lx-empty-art"><GLive size={34} /></div>
          <h3>{tab === 'upcoming' ? 'No live session scheduled' : tab === 'past' ? 'No session held yet' : 'Nothing cancelled'}</h3>
          <p>{ctx.caps.assign ? 'Schedule a webinar with your Zoom, Meet or Teams link. People get a calendar invitation, reminders, a Join button, and the recording afterwards.' : 'Sessions appear here once someone schedules one.'}</p>
          {ctx.caps.assign && tab === 'upcoming' && <button className="lx-btn lx-btn--primary" onClick={() => setMaking(true)}><IconPlus size={15} /> New live session</button>}
        </div>
      )}
    </>
  )
}
