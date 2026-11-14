'use client'
// components/analytics/DigestSettings.tsx — People Analytics → Email digests.
//
// Two emails, both off until switched on here:
//   * the Monday note — to every manager, about their own team (they can stop it from
//     ESS → Insights → My team);
//   * the monthly executive briefing — to the people listed, each on the slice of the
//     company their own analytics access covers.
// Preview shows your own copy as it would go out; "Send me a test" mails it to you.

import * as React from 'react'
import { createPortal } from 'react-dom'
import { C, F, W, R, S, E, Z, Button, Notice } from '@/lib/ui'
import { PeoplePicker, call, type Person } from './AccessManager'

interface State {
  ready: boolean; mail: boolean; manage: boolean
  settings?: { monday_note: boolean; monthly_briefing: boolean; briefing_recipients: string[]; updated_by_name: string | null; updated_at: string | null }
  recipients?: { id: string; name: string; code: string | null; designation: string | null }[]
}

export default function DigestSettings({ onClose }: { onClose: () => void }) {
  const [st, setSt] = React.useState<State | null>(null)
  const [monday, setMonday] = React.useState(false)
  const [monthly, setMonthly] = React.useState(false)
  const [people, setPeople] = React.useState<Person[]>([])
  const [msg, setMsg] = React.useState<{ t: 'info' | 'critical'; text: string } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [preview, setPreview] = React.useState<{ subject: string; html: string; to: string | null } | null>(null)
  const [busy, setBusy] = React.useState('')

  React.useEffect(() => {
    call('/api/analytics/digest').then((b: State) => {
      setSt(b)
      setMonday(!!b.settings?.monday_note); setMonthly(!!b.settings?.monthly_briefing)
      setPeople((b.recipients || []).map(r => ({ ...r, company: null })))
    }, e => setMsg({ t: 'critical', text: e?.message || 'Could not load.' }))
  }, [])
  React.useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (preview) setPreview(null); else onClose() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose, preview])

  const save = async () => {
    setSaving(true); setMsg(null)
    try {
      await call('/api/analytics/digest', { method: 'POST', body: JSON.stringify({ action: 'settings', monday_note: monday, monthly_briefing: monthly, briefing_recipients: people.map(p => p.id) }) })
      setMsg({ t: 'info', text: 'Saved. The Monday note goes out at 9:00 AM every Monday; the briefing at 10:00 AM on the 1st.' })
    } catch (e: any) { setMsg({ t: 'critical', text: e?.message || 'Could not save.' }) } finally { setSaving(false) }
  }
  const show = async (kind: string) => {
    setBusy(kind); setMsg(null)
    try { setPreview(await call(`/api/analytics/digest?preview=${kind}`)) } catch (e: any) { setMsg({ t: 'critical', text: e?.message || 'No preview.' }) } finally { setBusy('') }
  }
  const test = async (kind: string) => {
    setBusy(`t-${kind}`); setMsg(null)
    try { const r = await call('/api/analytics/digest', { method: 'POST', body: JSON.stringify({ action: 'test', kind }) }); setMsg({ t: 'info', text: `Sent to ${r.to}.` }) }
    catch (e: any) { setMsg({ t: 'critical', text: e?.message || 'Not sent.' }) } finally { setBusy('') }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Analytics emails" style={{ position: 'fixed', inset: 0, zIndex: Z.modal, background: C.canvas, color: C.ink, fontFamily: F.family, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.md, padding: '12px 20px', borderBottom: `1px solid ${C.line}`, background: C.surface, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: F.lead, fontWeight: W.semi }}>Email digests</div>
          <div style={{ fontSize: F.tiny, color: C.muted }}>The Monday note for managers, and the monthly executive briefing for leadership.</div>
        </div>
        <Button size="sm" onClick={onClose}>Close</Button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: S.lg }}>
        <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gap: S.lg }}>
          {msg && <Notice t={msg.t} title={msg.t === 'info' ? 'Done' : 'Not done'}>{msg.text}</Notice>}
          {st && !st.ready && <Notice t="warning" title="One step first">Run <strong>233_analytics_digests.sql</strong> in the Supabase SQL editor. Until then nothing is emailed; the in-app Monday note and briefing work as they are.</Notice>}
          {st && !st.mail && <Notice t="info" title="Email is not set up on this deployment">Nothing can be sent from here, but Preview shows exactly what would go out.</Notice>}
          {st && (
            <>
              <Panel title="Monday note to managers" on={monday} setOn={st.manage && st.ready ? setMonday : undefined}
                hint="Every Monday at 9:00 AM, every manager gets their own team's week: who is out, what is waiting on them, dates coming up, and a conversation opener for anyone showing warning signs. A manager can stop it from ESS → Insights → My team.">
                <Row><Button size="sm" onClick={() => show('monday_note')} disabled={!!busy}>{busy === 'monday_note' ? 'Loading…' : 'Preview my Monday note'}</Button>
                  <Button size="sm" onClick={() => test('monday_note')} disabled={!!busy || !st.mail}>{busy === 't-monday_note' ? 'Sending…' : 'Send me a test'}</Button></Row>
              </Panel>
              <Panel title="Monthly executive briefing" on={monthly} setOn={st.manage && st.ready ? setMonthly : undefined}
                hint="On the 1st at 10:00 AM: last month on one page — what changed, likely causes, three things to do. Each person gets it on the part of the company their own analytics access covers; anyone without access gets nothing.">
                <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.07em', margin: `${S.sm}px 0 6px` }}>Who receives it</div>
                {st.manage ? <PeoplePicker value={people} onChange={setPeople} me={null} /> : <div style={{ fontSize: F.small, color: C.muted }}>{people.map(p => p.name).join(', ') || 'Nobody yet.'}</div>}
                <Row><Button size="sm" onClick={() => show('monthly_briefing')} disabled={!!busy}>{busy === 'monthly_briefing' ? 'Loading…' : 'Preview my briefing'}</Button>
                  <Button size="sm" onClick={() => test('monthly_briefing')} disabled={!!busy || !st.mail}>{busy === 't-monthly_briefing' ? 'Sending…' : 'Send me a test'}</Button></Row>
              </Panel>
              {st.manage && st.ready && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: F.micro, color: C.faint }}>{st.settings?.updated_by_name ? `Last changed by ${st.settings.updated_by_name}${st.settings.updated_at ? ` on ${new Date(st.settings.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.` : 'Not changed yet.'}</span>
                  <Button size="sm" variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {preview && (
        <div role="dialog" aria-label="Email preview" style={{ position: 'fixed', inset: 0, zIndex: Z.modal + 1, background: C.canvas, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.md, padding: '10px 20px', borderBottom: `1px solid ${C.line}`, background: C.surface }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: F.small, fontWeight: W.semi }}>{preview.subject}</div>
              <div style={{ fontSize: F.micro, color: C.muted }}>Would go to {preview.to || 'nobody — no deliverable email on your record'}</div>
            </div>
            <Button size="sm" onClick={() => setPreview(null)}>Back</Button>
          </div>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} style={{ flex: 1, border: 'none', width: '100%', background: C.surface }} />
        </div>
      )}
    </div>,
    document.body,
  )
}

function Panel({ title, hint, on, setOn, children }: { title: string; hint: string; on: boolean; setOn?: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, padding: S.lg }}>
      <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: setOn ? 'pointer' : 'default' }}>
        <input type="checkbox" checked={on} disabled={!setOn} onChange={e => setOn?.(e.target.checked)} style={{ marginTop: 4, accentColor: C.brand, width: 16, height: 16 }} />
        <span>
          <span style={{ display: 'block', fontSize: F.lead, fontWeight: W.semi }}>{title} <span style={{ fontSize: F.micro, fontWeight: W.bold, color: on ? C.positive : C.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginLeft: 6 }}>{on ? 'On' : 'Off'}</span></span>
          <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{hint}</span>
        </span>
      </label>
      <div style={{ marginTop: S.md, paddingLeft: 28 }}>{children}</div>
    </section>
  )
}
const Row = ({ children }: { children: React.ReactNode }) => <div style={{ display: 'flex', gap: S.sm, flexWrap: 'wrap', marginTop: S.md }}>{children}</div>
