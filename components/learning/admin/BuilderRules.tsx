'use client'
// components/learning/admin/BuilderRules.tsx — what counts as finishing. Order and completion
// belong to the version and freeze with it. Validity, certificates and retirement belong to
// the course. Changing validity or retirement on a live course is a publishing decision, so
// the server asks for publish rights there, and the controls follow.
import { Button, Field, S } from '@/lib/ui'
import { EditNumber, EditText, Hint, Panel, RadioList, Toggle, dateValue, grid, row, stack, when } from './shared'
import type { BuilderApi } from './builder-api'

const ORDER = [
  { value: 'SEQUENTIAL', label: 'Lesson by lesson', hint: 'Each required lesson must be finished before the next one opens.' },
  { value: 'MODULE_SEQUENTIAL', label: 'Module by module', hint: 'Modules open in order. Lessons inside a module can be taken in any order.' },
  { value: 'FREE', label: 'Any order', hint: 'Everything is open from the start.' },
]
const COMPLETION = [
  { value: 'ALL_REQUIRED', label: 'Every required lesson', hint: 'The usual choice. The course is done when all required lessons are done.' },
  { value: 'PERCENT', label: 'A share of the required lessons', hint: 'Done once the share you set below is finished.' },
  { value: 'FINAL_ONLY', label: 'The final assessment alone', hint: 'Passing the final assessment finishes the course, so people can test out of the lessons.' },
]

export default function BuilderRules({ b, onPublish }: { b: BuilderApi; onPublish: () => void }) {
  const v = b.tree.version, c = b.course, off = b.readOnly
  const governed = !b.canEdit || (c.status === 'PUBLISHED' && !b.ctx.caps.publish)
  return (
    <>
      <Panel title="Order" hint={off ? 'Saved with this version.' : 'How people move through the course.'}>
        <RadioList name="order_mode" value={v.order_mode} options={ORDER} disabled={off} onChange={m => b.patchRules({ order_mode: m })} />
      </Panel>
      <Panel title="What counts as complete">
        <div style={stack()}>
          <RadioList name="completion_mode" value={v.completion_mode} options={COMPLETION} disabled={off} onChange={m => b.patchRules({ completion_mode: m })} />
          {v.completion_mode === 'PERCENT' && (
            <div style={{ maxWidth: 220 }}>
              <Field label="Share of required lessons (%)"><EditNumber value={v.completion_pct} min={1} max={100} disabled={off} onSave={n => b.patchRules({ completion_pct: n ?? 100 })} /></Field>
            </div>
          )}
          <Toggle label="All required quizzes must be passed" hint="Finishing the lessons is not enough while a required quiz is still unpassed." checked={v.require_all_quizzes} disabled={off} onChange={x => b.patchRules({ require_all_quizzes: x })} />
          <Toggle label="The final assessment must be passed" hint="Needs one lesson marked as the final assessment in Content." checked={v.require_final} disabled={off} onChange={x => b.patchRules({ require_final: x })} />
          <div style={{ maxWidth: 260 }}>
            <Field label="Lowest overall quiz score (%)" hint="The average across quizzes. Leave blank for none.">
              <EditNumber value={v.min_overall_pct} min={0} max={100} disabled={off} onSave={n => b.patchRules({ min_overall_pct: n })} />
            </Field>
          </div>
        </div>
      </Panel>
      <Panel title="After completing" hint="These belong to the course rather than a version.">
        <div style={stack()}>
          <Toggle label="Give a certificate" hint="People get one on completing, if certificates are on in Settings." checked={c.certificate_enabled} disabled={!b.canEdit} onChange={x => b.patchCourse({ certificate_enabled: x })} />
          <div style={grid(220)}>
            <Field label="Valid for (months)" hint="Training that must be repeated, such as yearly compliance. Leave blank if it never lapses.">
              <EditNumber value={c.validity_months} min={1} disabled={governed} onSave={n => b.patchCourse({ validity_months: n })} />
            </Field>
            <Field label="Renew this many days before it lapses" hint="A new round is assigned ahead of the expiry date.">
              <EditNumber value={c.renew_before_days} min={0} disabled={!b.canEdit} onSave={n => b.patchCourse({ renew_before_days: n ?? 30 })} />
            </Field>
          </div>
        </div>
      </Panel>
      <Panel title="Dates" hint="Dates are in India time.">
        <div style={stack()}>
          <div style={row()}>
            <Hint>{c.publish_at ? `Scheduled to go live on ${when(c.publish_at)}.` : 'Not scheduled to go live.'}</Hint>
            {b.canEdit && <Button size="sm" onClick={onPublish}>Schedule in Publish</Button>}
          </div>
          <div style={{ maxWidth: 260, marginTop: S.xs }}>
            <Field label="Retire on" hint="The daily job archives the course on this date. People already enrolled keep their record.">
              <EditText type="date" value={dateValue(c.retire_at)} disabled={governed}
                onSave={d => b.patchCourse({ retire_at: d ? `${d}T23:59:59+05:30` : null })} />
            </Field>
          </div>
        </div>
      </Panel>
      {!off && (
        <Panel title="What changed in this version" hint="A line for the version history.">
          <EditText multiline rows={2} value={v.change_note} onSave={n => b.patchRules({ change_note: n || null })} />
        </Panel>
      )}
    </>
  )
}
