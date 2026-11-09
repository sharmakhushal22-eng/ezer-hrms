'use client'
// components/learning/admin/BuilderPublish.tsx — what stands between this version and going
// live, the steps open to this person right now, and the version history.
//
// Which buttons appear follows courseAction in lib/lms/authoring.ts exactly. Every call waits
// for the save queue first: a field saved on blur must land before the publish that follows.
import { useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, C, F, Field, IconCheck, Notice, S, Select, TableWrap, Td, Th, Tr, W } from '@/lib/ui'
import {
  ActionNotes, ConfirmButton, Hint, Panel, StatusBadge, TextArea, TextInput, Toggle, VERSION_STATUS, plural, row, stack, useAction, when,
} from './shared'
import type { BuilderApi } from './builder-api'

function Checklist({ problems }: { problems: string[] }) {
  if (!problems.length) {
    return <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', fontSize: F.small, color: C.positive, fontWeight: W.medium }}><IconCheck size={16} /> Nothing is holding this version back.</div>
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {problems.map((p, i) => (
        <li key={i} style={{ display: 'flex', gap: S.sm, alignItems: 'flex-start', fontSize: F.small, color: C.inkSoft }}>
          <span style={{ width: 14, height: 14, marginTop: 3, borderRadius: '50%', border: `2px solid ${C.warning}`, flexShrink: 0 }} />{p}
        </li>
      ))}
    </ul>
  )
}

function SendBack({ busy, onSend }: { busy: boolean; onSend: (note: string) => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  if (!open) return <Button onClick={() => setOpen(true)}>Send back</Button>
  return (
    <div style={{ ...stack(S.sm), width: '100%' }}>
      <Field label="What needs to change" required><TextArea rows={2} autoFocus value={note} onChange={e => setNote(e.target.value)} /></Field>
      <div style={row()}>
        <Button variant="primary" disabled={busy || !note.trim()} onClick={() => onSend(note.trim())}>Send back to the author</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  )
}

function Schedule({ busy, onSchedule }: { busy: boolean; onSchedule: (iso: string) => void }) {
  const [at, setAt] = useState('')
  const [opened] = useState(() => Date.now())
  return (
    <div style={stack(S.xs)}>
      <div style={{ ...row(), alignItems: 'flex-end' }}>
        <div style={{ width: 240 }}><Field label="Go live on"><TextInput type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></Field></div>
        <Button disabled={busy || !at || new Date(at).getTime() <= opened} onClick={() => onSchedule(new Date(at).toISOString())}>Schedule</Button>
      </div>
      <Hint>The daily job publishes it on its first run after this time.</Hint>
    </div>
  )
}

function CopyTo({ b, busy, onCopy }: { b: BuilderApi; busy: boolean; onCopy: (company: string) => void }) {
  const [to, setTo] = useState('')
  const others = b.ctx.companies.filter(c => c.id !== b.course.company_id)
  return (
    <div style={{ ...row(), alignItems: 'flex-end' }}>
      <div style={{ width: 240 }}>
        <Field label="Copy to company">
          <Select value={to} onChange={e => setTo(e.target.value)}>
            <option value="">Choose a company</option>
            {others.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </Select>
        </Field>
      </div>
      <Button disabled={busy || !to} onClick={() => onCopy(to)}>Copy</Button>
    </div>
  )
}

function Lifecycle({ b, problems, settings, reload, onOpen }: { b: BuilderApi; problems: string[]; settings: any; reload: () => Promise<unknown>; onOpen: (id: string) => void }) {
  const { course: c, tree, ctx } = b
  const v = tree.version, caps = ctx.caps
  const a = useAction()
  const [move, setMove] = useState(false)
  const act = async (action: string, body: Record<string, unknown>, ok: string | ((r: any) => string)) => {
    await b.flush()
    const r = await a.run(() => lmsApi(`/api/lms/admin/courses/${c.id}`, { action, ...body }), ok)
    await reload()
    return r
  }
  const published = (r: any) => {
    if (r.scheduled) return `Scheduled for ${when(r.scheduled)}.`
    const parts = [`Version ${r.version_no} is live.`]
    if (r.moved) parts.push(`${plural(r.moved, 'person', 'people')} who had not started moved to it.`)
    if (r.carried) parts.push(`${plural(r.carried, 'person', 'people')} moved mid-course, keeping their progress.`)
    return parts.join(' ')
  }
  const needsReview = !!settings?.publish_requires_review
  const archived = c.status === 'ARCHIVED'
  const isWorking = v.status === 'DRAFT' || v.status === 'IN_REVIEW'
  const ownSubmission = needsReview && !!v.submitted_by_id && v.submitted_by_id === ctx.me
  const mayPublish = caps.publish && !archived && isWorking && (needsReview ? v.status === 'IN_REVIEW' && !ownSubmission : true)
  const republish = !!c.published_version_id
  const blocked = problems.length > 0

  return (
    <Panel title="Next steps">
      <div style={stack()}>
        <ActionNotes a={a} />
        {c.publish_at && (
          <Notice t="info" title={`Scheduled to go live on ${when(c.publish_at)}`}
            action={caps.publish ? <Button size="sm" disabled={a.busy} onClick={() => act('unschedule', {}, 'The schedule was cancelled.')}>Cancel schedule</Button> : undefined}>
            If something still needs fixing at that time, it waits and the audit log says why.
          </Notice>
        )}
        {needsReview && v.status === 'DRAFT' && !archived && <Hint>Your company requires a review: someone other than the person who submits it must publish it.</Hint>}
        {ownSubmission && v.status === 'IN_REVIEW' && <Hint>You submitted this version, so someone else must publish it.</Hint>}

        {mayPublish && republish && (
          <Toggle label="Also move people mid-course to this version" checked={move} onChange={setMove}
            hint="People who have not started always move. People who completed keep their record on the version they took. Those mid-course stay on their version unless you tick this. If you do, they keep the progress they have made." />
        )}
        <div style={row()}>
          {b.canEdit && v.status === 'DRAFT' && !archived && <Button variant={caps.publish && !needsReview ? 'secondary' : 'primary'} disabled={a.busy || blocked} onClick={() => act('submit_review', {}, 'Sent for review.')}>Submit for review</Button>}
          {mayPublish && <Button variant="primary" disabled={a.busy || blocked} onClick={() => act('publish', { move_in_progress: move || undefined }, published)}>{v.status === 'IN_REVIEW' ? 'Approve and publish now' : 'Publish now'}</Button>}
          {b.canEdit && v.status === 'IN_REVIEW' && <Button disabled={a.busy} onClick={() => act('withdraw_review', {}, 'Withdrawn. You can edit it again.')}>Withdraw</Button>}
          {b.canEdit && !isWorking && !archived && c.published_version_id && <Button variant="primary" disabled={a.busy} onClick={() => act('new_version', {}, 'A new draft is ready. Its content starts as a copy of the live version.')}>Start new version</Button>}
          {caps.publish && !isWorking && !archived && c.published_version_id && <Button disabled={a.busy} onClick={() => act('move_in_progress', {}, (r: any) => `${plural(r.moved, 'person', 'people')} moved to the live version.`)}>Move people mid-course to the live version</Button>}
        </div>
        {caps.publish && v.status === 'IN_REVIEW' && <SendBack busy={a.busy} onSend={note => act('reject', { note }, 'Sent back to the author.')} />}
        {mayPublish && !blocked && <Schedule busy={a.busy} onSchedule={iso => act('publish', { publish_at: iso }, published)} />}

        <div style={{ ...stack(S.sm), paddingTop: S.md, borderTop: `1px solid ${C.line}` }}>
          <div style={row()}>
            {b.canEdit && <Button disabled={a.busy} onClick={async () => { const r = await act('duplicate', {}, 'Copied.'); if (r?.course_id) onOpen(r.course_id) }}>Duplicate</Button>}
            {b.canEdit && isWorking && c.published_version_id && <ConfirmButton size="md" label="Discard draft" question="Throw this draft away?" confirm="Discard" disabled={a.busy} onConfirm={() => act('discard_draft', {}, 'Draft discarded. The live version is unchanged.')} />}
            {caps.publish && !archived && <ConfirmButton size="md" label="Archive" question="Take it out of the catalogue? Current learners keep access." confirm="Archive" disabled={a.busy} onConfirm={() => act('archive', {}, 'Archived.')} />}
            {caps.publish && archived && <Button disabled={a.busy} onClick={() => act('restore', {}, 'Restored.')}>Restore</Button>}
          </div>
          {b.canEdit && ctx.companies.length > 1 && <CopyTo b={b} busy={a.busy} onCopy={to => act('copy_to', { company_id: to }, 'Copied to that company as a draft.')} />}
        </div>
      </div>
    </Panel>
  )
}

function History({ versions, viewing, currentId, onView }: { versions: any[]; viewing: string | null; currentId: string; onView: (id: string | null) => void }) {
  return (
    <Panel title="Version history">
      <TableWrap stagger={false} minWidth={620} style={{ boxShadow: 'none' }}>
        <thead><tr><Th>Version</Th><Th>Status</Th><Th>Published</Th><Th>By</Th><Th>Note</Th><Th /></tr></thead>
        <tbody>
          {versions.map(v => (
            <Tr key={v.id} selected={v.id === currentId}>
              <Td mono strong>v{v.version_no}</Td>
              <Td><StatusBadge map={VERSION_STATUS} value={v.status} /></Td>
              <Td style={{ whiteSpace: 'nowrap' }}>{v.published_at ? when(v.published_at) : '-'}</Td>
              <Td>{v.published_by_name || v.submitted_by_name || '-'}</Td>
              <Td>{v.change_note || '-'}</Td>
              <Td align="right">{v.id !== currentId && <Button size="sm" onClick={() => onView(viewing && versions[0]?.id === v.id ? null : v.id)}>View</Button>}</Td>
            </Tr>
          ))}
        </tbody>
      </TableWrap>
    </Panel>
  )
}

export default function BuilderPublish({ b, versions, problems, settings, viewing, reload, onView, onOpen }: {
  b: BuilderApi; versions: any[]; problems: string[]; settings: any; viewing: string | null
  reload: () => Promise<unknown>; onView: (id: string | null) => void; onOpen: (id: string) => void
}) {
  const v = b.tree.version
  const live = v.status === 'PUBLISHED' || v.status === 'SUPERSEDED'
  return (
    <>
      {!live && <Panel title="Before it can go live"><Checklist problems={problems} /></Panel>}
      <Lifecycle b={b} problems={live ? [] : problems} settings={settings} reload={reload} onOpen={onOpen} />
      <History versions={versions} viewing={viewing} currentId={v.id} onView={onView} />
    </>
  )
}
