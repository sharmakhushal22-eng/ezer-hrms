'use client'
// components/learning/admin/AuditTab.tsx — the append-only trail, newest first.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Empty, IconCompliance, SkeletonRows, TableWrap, Td, Th, Tr } from '@/lib/ui'
import { LoadError, Pager, plural, useLoad, when, withCompany, type Ctx } from './shared'

const ACTION: Record<string, string> = {
  COURSE_CREATED: 'Created a course', COURSE_UPDATED: 'Changed a course', COURSE_SUBMITTED: 'Sent a course for review', COURSE_WITHDRAWN: 'Withdrew a course from review',
  COURSE_SENT_BACK: 'Sent a course back', COURSE_PUBLISHED: 'Published a course', COURSE_SCHEDULED: 'Scheduled a course', COURSE_UNSCHEDULED: 'Cancelled a schedule',
  COURSE_PUBLISH_HELD: 'Scheduled publish held back', COURSE_ARCHIVED: 'Archived a course', COURSE_RESTORED: 'Restored a course', COURSE_COPIED: 'Copied a course',
  VERSION_STARTED: 'Started a new version', VERSION_DISCARDED: 'Discarded a draft', LEARNERS_MOVED: 'Moved people to the live version',
  PATH_CREATED: 'Created a learning path', PATH_UPDATED: 'Changed a learning path', PATH_PUBLISHED: 'Published a learning path', PATH_ARCHIVED: 'Archived a learning path',
  ASSIGNMENT_CREATED: 'Assigned learning', ASSIGNMENT_APPLIED: 'Applied an assignment again', ASSIGNMENT_PAUSED: 'Paused an assignment', ASSIGNMENT_RESUMED: 'Resumed an assignment', ASSIGNMENT_CANCELLED: 'Cancelled an assignment',
  ENROLMENT_EXTENDED: 'Extended a due date', ENROLMENT_WAIVED: 'Waived an enrolment', ENROLMENT_CANCELLED: 'Cancelled an enrolment', ENROLMENT_REASSIGNED: 'Reassigned a course', ATTEMPTS_GRANTED: 'Gave extra attempts', REMINDER_SENT: 'Sent a reminder',
  CANDIDATE_INVITED: 'Invited a candidate', CANDIDATE_RESENT: 'Sent a new link', CANDIDATE_REVOKED: 'Revoked a candidate', CERTIFICATE_REVOKED: 'Revoked a certificate', SETTINGS_UPDATED: 'Changed settings',
}
const readable = (a: string) => ACTION[a] || a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, ' ')

/** The fields worth reading. Ids, audience lists and result objects stay in the stored record. */
function detailText(d: any, subject?: string): string {
  if (!d || typeof d !== 'object') return subject || ''
  const out: string[] = []
  if (subject && !d.title) out.push(subject)
  if (d.name) out.push(String(d.name))
  if (d.title) out.push(String(d.title))
  if (d.code) out.push(String(d.code))
  if (d.version != null) out.push(`Version ${d.version}`)
  if (d.note) out.push(String(d.note))
  if (d.reason) out.push(String(d.reason))
  if (d.publish_at) out.push(when(d.publish_at))
  if (d.to) out.push(`To ${when(d.to)}`)
  if (d.attempts) out.push(plural(Number(d.attempts), 'attempt'))
  if (d.enrolled != null) out.push(`${d.enrolled} enrolled`)
  if (d.count != null) out.push(`${d.count} people`)
  if (d.withdrawn) out.push(`${d.withdrawn} withdrawn`)
  if (d.not_started_moved) out.push(`${d.not_started_moved} moved`)
  if (d.in_progress_moved) out.push(`${d.in_progress_moved} moved mid-course`)
  if (Array.isArray(d.fields) && d.fields.length) out.push(`Fields: ${d.fields.join(', ')}`)
  if (Array.isArray(d.problems) && d.problems.length) out.push(d.problems.join(' '))
  return out.join(' · ')
}

export default function AuditTab({ ctx }: { ctx: Ctx }) {
  const [page, setPage] = useState(0)
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, `/api/lms/admin/audit?page=${page}`)), [ctx.company, page])
  // The log stores ids. Most course rows carry no title, so "Published a course" needs this.
  const courses = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/courses')), [ctx.company])
  const titles = useMemo(() => new Map<string, string>((courses.data?.courses || []).map((c: any) => [c.id, c.title])), [courses.data])
  const rows: any[] = list.data?.rows || []
  return (
    <>
      <LoadError error={list.error} setup={list.setup} />
      {list.loading && !list.data ? <SkeletonRows /> : rows.length ? (
        <TableWrap minWidth={760} stagger={false}>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Details</Th></tr></thead>
          <tbody>
            {rows.map(r => (
              <Tr key={r.id}>
                <Td mono style={{ whiteSpace: 'nowrap' }}>{when(r.created_at)}</Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{r.actor_label || 'Automatic'}</Td>
                <Td strong>{readable(r.action)}</Td>
                <Td>{detailText(r.detail, r.entity === 'course' ? titles.get(r.entity_id) : undefined) || '-'}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <Empty icon={<IconCompliance size={22} />} title="Nothing recorded yet" hint="Every change to courses, assignments and certificates is written here, and cannot be altered." />}
      <Pager page={page} size={100} shown={rows.length} onPage={setPage} />
    </>
  )
}
