'use client'
// components/learning/admin/BuilderDetails.tsx — how the course is described. These fields
// live on the course, not the version, so they stay editable after publishing.
import { useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { uploadLmsFile } from '@/lib/lms/upload-client'
import { Button, C, Field, IconLearning, R, S } from '@/lib/ui'
import {
  Bar, Chip, EditNumber, EditText, FilePick, Hint, Panel, PickList, SaveSelect, grid, row, stack, useLoad, type PickOption,
} from './shared'
import type { BuilderApi } from './builder-api'

function Thumbnail({ b }: { b: BuilderApi }) {
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const c = b.course
  const pick = async (file: File) => {
    setErr(''); setPct(0)
    try {
      const asset = await uploadLmsFile(file, { kind: 'IMAGE', companyId: c.company_id, onProgress: setPct })
      await b.patchCourse({ thumbnail_asset_id: asset.id })
    } catch (e: any) { setErr(e?.message || 'That image could not be uploaded.') }
    finally { setPct(null) }
  }
  const box = { width: 168, height: 96, borderRadius: R.md, border: `1px solid ${C.line}`, flexShrink: 0 } as const
  return (
    <div style={{ display: 'flex', gap: S.md, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {c.thumbnail
        ? <img src={c.thumbnail} alt="" style={{ ...box, objectFit: 'cover' }} />
        : <div style={{ ...box, background: C.sunken, color: C.faint, display: 'grid', placeItems: 'center' }}><IconLearning size={24} /></div>}
      <div style={stack(S.sm)}>
        {b.canEdit && (
          <div style={row()}>
            <FilePick accept="image/jpeg,image/png,image/webp" label={c.thumbnail ? 'Replace image' : 'Choose image'} disabled={pct != null} onFile={pick} />
            {c.thumbnail_asset_id && <Button size="sm" variant="ghost" onClick={() => b.patchCourse({ thumbnail_asset_id: null })}>Remove</Button>}
          </div>
        )}
        <Hint>JPG, PNG or WebP, up to 5 MB. A wide image works best.</Hint>
        {pct != null && <Bar pct={pct} width={168} />}
        {err && <div style={{ fontSize: 12, color: C.critical }}>{err}</div>}
      </div>
    </div>
  )
}

function Skills({ b, options }: { b: BuilderApi; options: PickOption[] }) {
  const skills: string[] = b.course.skills || []
  const toggle = (o: PickOption) => b.patchCourse({ skills: skills.includes(o.value) ? skills.filter(s => s !== o.value) : [...skills, o.value] })
  return (
    <div style={stack(S.sm)}>
      {skills.length > 0 && <div style={row(6)}>{skills.map(s => <Chip key={s} onRemove={b.canEdit ? () => toggle({ value: s, label: s }) : undefined}>{s}</Chip>)}</div>}
      {b.canEdit && <PickList options={options} selected={skills} onToggle={toggle} placeholder="Search skills" maxHeight={170} emptyText="No skills in the skills master yet." />}
      {!b.canEdit && !skills.length && <Hint>None set.</Hint>}
    </div>
  )
}

export default function BuilderDetails({ b }: { b: BuilderApi }) {
  const c = b.course, off = !b.canEdit
  const cats = useLoad<any>(() => lmsApi(`/api/lms/admin/catalog?company=${c.company_id}`), [c.company_id])
  const look = useLoad<any>(() => (b.canEdit ? lmsApi(`/api/lms/admin/lookups?company=${c.company_id}`) : Promise.resolve(null)), [c.company_id, b.canEdit])
  const skills: PickOption[] = (look.data?.skills || []).map((s: string) => ({ value: s, label: s }))
  const categories: any[] = (cats.data?.categories || []).filter((x: any) => x.is_active || x.id === c.category_id)
  return (
    <>
      <Panel title="About this course" hint="These details can change at any time, even after publishing, and show straight away.">
        <div style={stack()}>
          <Field label="Title" required><EditText value={c.title} disabled={off} onSave={v => b.patchCourse({ title: v })} /></Field>
          <Field label="Summary" hint="One or two lines shown on the course card.">
            <EditText multiline rows={2} value={c.summary} disabled={off} onSave={v => b.patchCourse({ summary: v || null })} />
          </Field>
          <Field label="Description" hint="What people will learn and why it matters.">
            <EditText multiline rows={5} value={c.description} disabled={off} onSave={v => b.patchCourse({ description: v || null })} />
          </Field>
          <div style={grid(190)}>
            <Field label="Category">
              <SaveSelect value={c.category_id || ''} disabled={off} onSave={v => b.patchCourse({ category_id: v || null })}>
                <option value="">No category</option>
                {categories.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </SaveSelect>
            </Field>
            <Field label="Difficulty">
              <SaveSelect value={c.difficulty} disabled={off} onSave={v => b.patchCourse({ difficulty: v })}>
                <option value="BEGINNER">Beginner</option><option value="INTERMEDIATE">Intermediate</option><option value="ADVANCED">Advanced</option>
              </SaveSelect>
            </Field>
            <Field label="Language"><EditText value={c.language} disabled={off} onSave={v => b.patchCourse({ language: v || 'English' })} /></Field>
            <Field label="Estimated minutes"><EditNumber value={c.est_minutes} min={1} disabled={off} onSave={v => b.patchCourse({ est_minutes: v })} /></Field>
          </div>
          <Field label="Tags" hint="Separate with commas. They help people search.">
            <EditText value={(c.tags || []).join(', ')} disabled={off}
              onSave={v => b.patchCourse({ tags: v.split(',').map(t => t.trim()).filter(Boolean) })} />
          </Field>
        </div>
      </Panel>
      <Panel title="Thumbnail"><Thumbnail b={b} /></Panel>
      <Panel title="Skills" hint="What finishing this course shows. Picked from the skills master."><Skills b={b} options={skills} /></Panel>
    </>
  )
}
