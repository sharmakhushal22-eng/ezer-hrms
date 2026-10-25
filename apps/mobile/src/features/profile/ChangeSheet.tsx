// src/features/profile/ChangeSheet.tsx — Profile360's ChangeModal: edit one
// field directly, or raise a change request for it.
//
// Exactly the website's rules: the value starts empty, it is free text for
// every field (no per-type control and no format check — the website has
// neither), a request needs a reason, and every refusal shows the server's own
// sentence (POST /api/ess/profile: "{label} cannot be emptied here.",
// "A reason is required. HR sees it when they review this.", the 503 "no
// approval route configured yet", …).
import * as React from 'react'
import { View } from 'react-native'
import type { ProfileField } from '@web/profile/types'
import { Sheet } from '@/ui/overlays'
import { Button, Input, Notice, Txt } from '@/ui/primitives'
import { F, S } from '@/ui/theme'
import { editField, requestChange } from './api'
import { routeNote } from './format'

export function ChangeSheet({ field, onClose, onDone }: { field: ProfileField | null; onClose: () => void; onDone: (msg: string) => void }) {
  return (
    <Sheet visible={!!field} onClose={onClose} title={field ? (field.state === 'direct' ? `Edit ${field.label}` : `Request a change to ${field.label}`) : ''}>
      {/* Keyed by field so each open starts from fresh state, like the web's mount-on-open. */}
      {field && <ChangeForm key={field.key} field={field} onClose={onClose} onDone={onDone} />}
    </Sheet>
  )
}

function ChangeForm({ field, onClose, onDone }: { field: ProfileField; onClose: () => void; onDone: (msg: string) => void }) {
  const [value, setValue] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const direct = field.state === 'direct'

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      if (direct) await editField(field.key, value)
      else await requestChange(field.key, value, reason)
    } catch (e) {
      setBusy(false)
      setErr(e instanceof Error ? e.message : 'Could not reach the server.')
      return
    }
    setBusy(false)
    onDone(direct ? `${field.label} saved.` : 'Sent. You will see the outcome in your change history.')
  }

  return (
    <View>
      <Txt size={F.small} tone="muted" style={{ marginBottom: S.md }}>
        {direct ? 'This saves straight away.' : 'Nothing changes yet. Somebody reviews this first.'}
      </Txt>
      {!direct && <Notice tone="warning" style={{ marginBottom: S.md }}>{routeNote(field.key)}</Notice>}

      <Input label="New value" value={value} onChangeText={setValue} autoFocus />
      {!direct && (
        <Input label="Reason" value={reason} onChangeText={setReason} multiline
          placeholder="Why is this changing? The approver reads this." />
      )}

      {!!field.hint && <Notice tone="warning" style={{ marginBottom: S.md }}>{field.hint}</Notice>}
      {!!err && <Notice tone="critical" style={{ marginBottom: S.md }}>{err}</Notice>}

      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.xs }}>
        <Button title="Cancel" variant="outline" style={{ flex: 1 }} onPress={onClose} />
        <Button title={busy ? 'Sending…' : direct ? 'Save' : 'Send request'} style={{ flex: 1 }}
          disabled={busy || !value.trim() || (!direct && !reason.trim())} onPress={submit} />
      </View>
    </View>
  )
}
