// Exit clearance waiting on you — components/ess/hris/ExitFnf.tsx ClearanceInbox
// + ClearanceForm, mounted in Tasks & Approvals as on the website.
//
// The department forms (IT / Admin / Finance / HR / the manager) waiting on this
// person; the HR Head also sees overdue ones they may override. Every rule is the
// server's (app/api/exit/clearance): GET ?inbox=1 (an error renders nothing),
// POST { action:'submit', id, items, signoff, remarks } or { action:'override', id, remarks }.
// The website's table (#, item, status, remarks, amount) becomes one card per item.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet, useOverlay } from '@/ui/overlays'
import { errMsg, fmtDate, fmtDateTime, FullModal, Pill, SectionTitle, SolidButton } from '../ui'
import { afterDecision } from '../approvals/shared'

export type ClearanceItemDef = { key: string; label: string; options: string[]; remark?: string; amount?: boolean; auto?: string }
export type ClearanceFormDef = { dept: string; label: string; formId: string; items: ClearanceItemDef[]; signoff: string[] }

export const DEPTS = ['IT', 'ADMIN', 'FINANCE', 'HR', 'HOD'] as const
export const DEPT_SHORT: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', FINANCE: 'Finance', HR: 'HR', HOD: 'HOD' }
export const SIGNOFF: Record<string, string> = {
  PENDING: 'Pending', CLEARED: 'Cleared', CLEARED_WITH_DUES: 'Cleared with dues', NOT_CLEARED: 'Not cleared',
  CLEARED_WITH_CONDITIONS: 'Cleared with conditions', CLEARED_WITH_REMARKS: 'Cleared with remarks',
}
export const rs = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
export const pillOf = (s: string | null | undefined) => !s ? 'mut' as const : s === 'PENDING' || s === 'NOT_CLEARED' ? 'warn' as const : s.startsWith('CLEARED') ? (s === 'CLEARED' ? 'ok' as const : 'info' as const) : 'mut' as const

function Choice({ label, value, options, disabled, onPick, placeholder = 'Select…' }: { label: string; value: string; options: { value: string; label: string }[]; disabled?: boolean; onPick: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <PickerField label={label} value={options.find(o => o.value === value)?.label || ''} placeholder={placeholder} disabled={disabled} onPress={() => setOpen(true)} />
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={label} value={value} options={options} onPick={v => onPick(String(v))} />
    </>
  )
}

function ItemCard({ it, i, v, off, showAmount, set }: { it: ClearanceItemDef; i: number; v: any; off: boolean; showAmount: boolean; set: (k: string, f: string, v: any) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.sm, backgroundColor: C.surface }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: S.sm }}>
        <Txt size={F.tiny} tone="faint" style={{ width: 18 }}>{i + 1}</Txt>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Txt size={12.5} w={600}>{it.label}</Txt>
          {!!it.auto && <Pill tone="info" label="auto" />}
        </View>
      </View>
      <Choice label="Status" value={v?.status || ''} disabled={off} options={[{ value: '', label: 'Select…' }, ...it.options.map(o => ({ value: o, label: o }))]} onPick={x => set(it.key, 'status', x)} />
      <Input label="Remarks" value={v?.remark || ''} editable={!off} placeholder={it.remark || ''} onChangeText={t => set(it.key, 'remark', t)} />
      {showAmount && it.amount && (
        <Input label="Amount (₹)" value={v?.amount == null ? '' : String(v.amount)} editable={!off} keyboardType="numeric"
          onChangeText={t => set(it.key, 'amount', t === '' ? null : Number(t))} />
      )}
    </View>
  )
}

/** One department's form: every item, then the sign-off. Read-only when `readOnly`. */
export function ClearanceForm({ employeeId, row, form, readOnly, canOverride, onDone, onClose }: {
  employeeId: string; row: any; form: ClearanceFormDef; readOnly?: boolean; canOverride?: boolean; onDone: () => void; onClose: () => void
}) {
  const { C } = useTheme()
  const { notify } = useOverlay()
  const [items, setItems] = React.useState<Record<string, any>>(() => ({ ...(row.items || {}) }))
  const [signoff, setSignoff] = React.useState<string>(row.status && row.status !== 'PENDING' ? row.status : '')
  const [remarks, setRemarks] = React.useState<string>(row.remarks || '')
  const [busy, setBusy] = React.useState(false)
  const [overriding, setOverriding] = React.useState(false)
  const set = (k: string, f: string, v: any) => setItems(s => ({ ...s, [k]: { ...(s[k] || {}), [f]: v } }))
  const dues = form.items.reduce((t, it) => t + (it.amount && !(form.dept === 'FINANCE' && it.key === 'expenses') ? Number(items[it.key]?.amount) || 0 : 0), 0)
  const payable = form.dept === 'FINANCE' ? Number(items.expenses?.amount) || 0 : 0
  const showAmount = form.items.some(i => i.amount)
  const off = !!readOnly || overriding

  async function submit() {
    setBusy(true)
    try {
      const j = await api<any>('/api/exit/clearance', { method: 'POST', employeeId, body: overriding ? { action: 'override', id: row.id, remarks } : { action: 'submit', id: row.id, items, signoff, remarks } })
      notify(j?.fnf ? `Signed off. All five departments are clear: F&F calculated (net ${rs(j.fnf.net_payable)}).` : 'Clearance signed off.')
      onDone(); onClose()
    } catch (e) { notify(errMsg(e), 'error') }
    setBusy(false)
  }

  const emp = row.employees || {}
  const sub = `${form.formId}-${emp.emp_code || ''} · last working day ${fmtDate(row.lwd || row.employee_resignation?.final_lwd)}${row.cleared_by_name ? ` · signed by ${row.cleared_by_name} ${fmtDateTime(row.cleared_at)}` : ''}`
  const footer = !readOnly ? (
    <SolidButton title={busy ? 'Saving…' : 'Sign off clearance'} disabled={busy || !signoff} onPress={() => void submit()} full />
  ) : canOverride && row.status === 'PENDING' ? (
    overriding ? (
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Button title="Back" variant="outline" onPress={() => setOverriding(false)} style={{ flex: 1 }} />
        <SolidButton title={busy ? '…' : 'Override and clear'} tone="critical" disabled={busy || !remarks.trim()} onPress={() => void submit()} style={{ flex: 1 }} full />
      </View>
    ) : <Button title="Override (HR Head)" variant="danger" onPress={() => { setOverriding(true); setRemarks('') }} full />
  ) : undefined

  return (
    <FullModal visible onClose={onClose} title={`${form.label} clearance · ${emp.full_name || ''}`} subtitle={sub} footer={footer}>
      {form.items.map((it, i) => <ItemCard key={it.key} it={it} i={i} v={items[it.key]} off={off} showAmount={showAmount} set={set} />)}
      <View style={{ marginTop: S.sm }}>
        {overriding ? (
          <View style={{ marginBottom: S.md }}>
            <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Override (HR Head)</Txt>
            <Txt size={F.small}>Cleared with conditions (override)</Txt>
          </View>
        ) : (
          <Choice label="Clearance status" value={signoff} disabled={!!readOnly} options={[{ value: '', label: 'Select…' }, ...form.signoff.map(x => ({ value: x, label: SIGNOFF[x] || x }))]} onPick={setSignoff} />
        )}
        <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>
          Total recovery from employee: <Txt size={F.tiny} w={700} color={dues ? C.critical : C.ink}>{rs(dues)}</Txt>
          {form.dept === 'FINANCE' && <> · payable to employee: <Txt size={F.tiny} w={700}>{rs(payable)}</Txt> · net: <Txt size={F.tiny} w={700}>{rs(dues - payable)}</Txt></>}
        </Txt>
        <Input label={overriding ? 'Reason for overriding *' : 'Remarks / conditions'} value={remarks} onChangeText={setRemarks} multiline
          editable={!(readOnly && !overriding)} inputStyle={{ minHeight: 64 }} />
      </View>
    </FullModal>
  )
}

export function ClearanceInbox({ employeeId }: { employeeId: string }) {
  const q = useQuery({
    queryKey: ['approvals', 'clearance', employeeId],
    queryFn: () => api<{ items: any[] }>('/api/exit/clearance', { query: { inbox: 1 }, employeeId }).catch(() => ({ items: [] })),
    enabled: !!employeeId,
  })
  const [open, setOpen] = React.useState<any | null>(null)
  const items = q.data?.items || []
  if (!items.length) return null
  return (
    <Card style={{ marginBottom: S.md }}>
      <SectionTitle>{`Exit clearance waiting on you (${items.length})`}</SectionTitle>
      {items.map(c => <InboxRow key={c.id} c={c} onOpen={() => setOpen(c)} />)}
      {open && <ClearanceForm employeeId={employeeId} row={open} form={open.form} readOnly={!open.can_fill} canOverride={open.can_override}
        onDone={() => void afterDecision()} onClose={() => setOpen(null)} />}
    </Card>
  )
}

function InboxRow({ c, onOpen }: { c: any; onOpen: () => void }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line, gap: 5 }}>
      <Txt size={F.small} w={600}>{c.employees?.full_name} <Txt size={F.small} tone="muted">{c.employees?.emp_code}{c.employees?.designation ? ` · ${c.employees.designation}` : ''}</Txt></Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Pill tone="info" label={c.form?.label || c.dept} />
        {!!c.escalated_to && <Pill tone="dang" label={`Overdue · escalated to ${c.escalated_to === 'HR_HEAD' ? 'HR Head' : 'HR Manager'}`} />}
      </View>
      <Txt size={11.5} tone="muted">Last working day {fmtDate(c.lwd)} · opened {fmtDate(c.started_at)}</Txt>
      <Button title={c.can_fill ? 'Fill clearance form' : 'Review / override'} size="sm" onPress={onOpen} style={{ alignSelf: 'flex-start', marginTop: 2 }} />
    </View>
  )
}
