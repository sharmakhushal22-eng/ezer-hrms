'use client'
// components/learning/admin/PathsTab.tsx — learning paths: several courses taken as one
// programme. Each course keeps its own enrolment, completion and certificate.
import { useMemo, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { Button, C, Empty, F, Field, IconLearning, IconPlus, S, Select, SkeletonRows, TableWrap, Td, Th, Tr, W, numeric } from '@/lib/ui'
import {
  ActionNotes, COURSE_STATUS, ConfirmButton, Hint, LoadError, NeedCompany, Panel, PickList, StatusBadge, TextArea, TextInput, Toggle,
  companyName, day, grid, row, stack, useAction, useLoad, withCompany, type Ctx, type PickOption,
} from './shared'

interface Item { course_id: string; title: string; is_required: boolean; course_status?: string }
interface Draft { id?: string; company_id?: string; title: string; summary: string; order_mode: string; visibility: string; enrolment_mode: string; certificate_enabled: boolean; items: Item[] }

const blank = (): Draft => ({ title: '', summary: '', order_mode: 'SEQUENTIAL', visibility: 'EVERYONE', enrolment_mode: 'ASSIGN_ONLY', certificate_enabled: true, items: [] })
const fromPath = (p: any): Draft => ({
  id: p.id, company_id: p.company_id, title: p.title, summary: p.summary || '', order_mode: p.order_mode, visibility: p.visibility, enrolment_mode: p.enrolment_mode,
  certificate_enabled: p.certificate_enabled, items: (p.items || []).map((i: any) => ({ course_id: i.course_id, title: i.title, is_required: i.is_required, course_status: i.course_status })),
})

function ItemRow({ item, index, count, off, onMove, onRequired, onRemove }: {
  item: Item; index: number; count: number; off: boolean; onMove: (dir: -1 | 1) => void; onRequired: (v: boolean) => void; onRemove: () => void
}) {
  return (
    <div style={{ ...row(), justifyContent: 'space-between', padding: '7px 0', borderBottom: `1px solid ${C.line}` }}>
      <div style={{ minWidth: 0, flex: '1 1 240px', fontSize: F.small, color: C.ink, fontWeight: W.medium }}>
        <span style={{ color: C.muted, marginRight: 8, ...numeric }}>{index + 1}</span>{item.title}
        {item.course_status && item.course_status !== 'PUBLISHED' && <span style={{ marginLeft: 8 }}><StatusBadge map={COURSE_STATUS} value={item.course_status} /></span>}
      </div>
      <div style={row(4)}>
        <Toggle label="Required" checked={item.is_required} disabled={off} onChange={onRequired} />
        {!off && (
          <>
            <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)}>Up</Button>
            <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)}>Down</Button>
            <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>
          </>
        )}
      </div>
    </div>
  )
}

function PathEditor({ ctx, initial, statusOf, onClose, onSaved }: { ctx: Ctx; initial: Draft; statusOf: (id?: string) => string | undefined; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(initial)
  const status = statusOf(d.id)
  const company = initial.company_id || ctx.company
  const off = !ctx.caps.editContent
  const a = useAction()
  const list = useLoad<any>(() => lmsApi(`/api/lms/admin/courses?company=${company}`), [company])
  const options: PickOption[] = useMemo(() => (list.data?.courses || []).filter((c: any) => c.status !== 'ARCHIVED').map((c: any) => ({ value: c.id, label: c.title, meta: `${c.code} · ${c.status === 'PUBLISHED' ? 'Published' : 'Draft'}` })), [list.data])
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }))
  const toggleItem = (o: PickOption) => set({ items: d.items.some(i => i.course_id === o.value) ? d.items.filter(i => i.course_id !== o.value) : [...d.items, { course_id: o.value, title: o.label, is_required: true }] })
  const move = (i: number, dir: -1 | 1) => { const items = [...d.items]; [items[i], items[i + dir]] = [items[i + dir], items[i]]; set({ items }) }
  const save = async () => {
    const r = await a.run(() => lmsApi('/api/lms/admin/paths', {
      id: d.id, company_id: d.id ? undefined : company, title: d.title, summary: d.summary || null, order_mode: d.order_mode, visibility: d.visibility,
      enrolment_mode: d.enrolment_mode, certificate_enabled: d.certificate_enabled, items: d.items.map(i => ({ course_id: i.course_id, is_required: i.is_required })),
    }), 'Saved.')
    // Keep the id: without it, pressing Save again would create a second path.
    if (r) { if (!d.id) set({ id: r.id, company_id: company || undefined }); onSaved() }
  }
  const act = async (action: string, ok: string) => { if (await a.run(() => lmsApi(`/api/lms/admin/paths/${d.id}`, { action }), ok)) onSaved() }
  return (
    <Panel title={d.id ? d.title || 'Learning path' : 'New learning path'} actions={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}>
      <div style={stack()}>
        <ActionNotes a={a} />
        <Field label="Title" required><TextInput value={d.title} disabled={off} onChange={e => set({ title: e.target.value })} /></Field>
        <Field label="Summary"><TextArea rows={2} value={d.summary} disabled={off} onChange={e => set({ summary: e.target.value })} /></Field>
        <div style={grid(220)}>
          <Field label="Order" hint={d.order_mode === 'SEQUENTIAL' ? 'Each course opens once the required one before it is done.' : 'Courses can be taken in any order.'}>
            <Select value={d.order_mode} disabled={off} onChange={e => set({ order_mode: e.target.value })}><option value="SEQUENTIAL">One after another</option><option value="FLEXIBLE">Any order</option></Select>
          </Field>
          <Field label="Who can find it" hint={d.visibility === 'EVERYONE' ? 'Listed in the catalogue.' : 'Reached only when assigned.'}>
            <Select value={d.visibility} disabled={off} onChange={e => set({ visibility: e.target.value })}><option value="EVERYONE">Everyone</option><option value="HIDDEN">Nobody</option></Select>
          </Field>
          <Field label="How people get in" hint={d.enrolment_mode === 'SELF' ? 'People can start it themselves.' : 'Only by assignment.'}>
            <Select value={d.enrolment_mode} disabled={off} onChange={e => set({ enrolment_mode: e.target.value })}><option value="ASSIGN_ONLY">Only by assignment</option><option value="SELF">People can start it</option></Select>
          </Field>
        </div>
        <Toggle label="Give a certificate for the whole path" checked={d.certificate_enabled} disabled={off} onChange={v => set({ certificate_enabled: v })} />
        <div>
          <div style={{ fontSize: F.tiny, fontWeight: W.semi, color: C.inkSoft, marginBottom: 4 }}>Courses, in order</div>
          {d.items.map((it, i) => (
            <ItemRow key={it.course_id} item={it} index={i} count={d.items.length} off={off} onMove={dir => move(i, dir)}
              onRequired={v => set({ items: d.items.map(x => (x.course_id === it.course_id ? { ...x, is_required: v } : x)) })}
              onRemove={() => set({ items: d.items.filter(x => x.course_id !== it.course_id) })} />
          ))}
          {!d.items.length && <Hint>No courses yet.</Hint>}
        </div>
        {!off && <PickList options={options} selected={d.items.map(i => i.course_id)} onToggle={toggleItem} placeholder="Search courses to add" emptyText="No courses to add yet." />}
        <div style={row()}>
          {!off && <Button variant="primary" disabled={a.busy || !d.title.trim()} onClick={save}>Save path</Button>}
          {d.id && ctx.caps.publish && status !== 'PUBLISHED' && <Button disabled={a.busy} onClick={() => act('publish', 'Published.')}>Publish</Button>}
          {d.id && ctx.caps.publish && status !== 'ARCHIVED' && <ConfirmButton size="md" label="Archive" question="Archive this path?" confirm="Archive" disabled={a.busy} onConfirm={() => act('archive', 'Archived.')} />}
        </div>
        {d.id && <Hint>Save first if you changed anything. Publishing needs every course in the path to be published.</Hint>}
      </div>
    </Panel>
  )
}

export default function PathsTab({ ctx }: { ctx: Ctx }) {
  const list = useLoad<any>(() => lmsApi(withCompany(ctx, '/api/lms/admin/paths')), [ctx.company])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [needs, setNeeds] = useState(false)
  const rows: any[] = list.data?.paths || []
  const startNew = () => { if (!ctx.company) { setNeeds(true); return } setNeeds(false); setEditing(blank()) }
  return (
    <>
      <LoadError error={list.error} setup={list.setup} />
      {needs && !ctx.company && <NeedCompany doing="create a learning path" />}
      {editing && <PathEditor key={editing.id || 'new'} ctx={ctx} initial={editing} statusOf={id => rows.find(p => p.id === id)?.status} onClose={() => setEditing(null)} onSaved={list.reload} />}
      <div style={{ ...row(), justifyContent: 'space-between', marginBottom: S.md }}>
        <Hint>A path is several courses taken as one programme. Each course keeps its own completion and certificate.</Hint>
        {ctx.caps.editContent && <Button variant="primary" icon={<IconPlus size={15} />} onClick={startNew}>New path</Button>}
      </div>
      {list.loading && !list.data ? <SkeletonRows /> : rows.length ? (
        <TableWrap minWidth={760}>
          <thead><tr><Th>Path</Th>{ctx.companies.length > 1 && !ctx.company && <Th>Company</Th>}<Th>Status</Th><Th>Order</Th><Th>Courses</Th><Th>Who can find it</Th><Th>Updated</Th></tr></thead>
          <tbody>
            {rows.map(p => (
              <Tr key={p.id} onClick={() => setEditing(fromPath(p))} selected={editing?.id === p.id}>
                <Td><div style={{ fontWeight: W.semi, color: C.ink }}>{p.title}</div><div style={{ fontSize: F.tiny, color: C.muted, ...numeric }}>{p.code}</div></Td>
                {ctx.companies.length > 1 && !ctx.company && <Td>{companyName(ctx, p.company_id)}</Td>}
                <Td><StatusBadge map={COURSE_STATUS} value={p.status} /></Td>
                <Td>{p.order_mode === 'SEQUENTIAL' ? 'One after another' : 'Any order'}</Td>
                <Td style={{ maxWidth: 320 }}>{(p.items || []).map((i: any) => i.title).join(', ') || '-'}</Td>
                <Td>{p.visibility === 'EVERYONE' ? 'Everyone' : 'Nobody'}</Td>
                <Td style={{ whiteSpace: 'nowrap' }}>{day(p.updated_at)}</Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <Empty icon={<IconLearning size={22} />} title="No learning paths yet" hint="Join courses into a programme, such as new-manager training." />}
    </>
  )
}
