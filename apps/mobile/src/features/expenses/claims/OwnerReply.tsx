// src/features/expenses/claims/OwnerReply.tsx — "Your answer" to a sent-back claim
// (components/te/TeClaims.tsx TeClaimDetail, since 4a92155): the half-typed answer
// is kept as a draft (kind 'claim', body { text }, claim_id) while the owner
// types, and discarded once it is sent. Only the employee's own reply is kept —
// an approver's comment is not (website rule).
//
// One deliberate addition: the website saves this draft ("— you can come back
// to this") but never reads it back. Here the reply opens with the draft saved
// for this claim, if there is one, so the promise is kept.
import * as React from 'react'
import { View } from 'react-native'
import { draftTitle } from '@web/te/autosave'
import type { TeDraft } from '@web/te/types'
import { F, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { useDraftAutosave } from '../drafts/useDraftAutosave'
import { SavedLine } from '../drafts/SavedLine'

export function OwnerReply({ claimId, resuming, busy, onSend }: {
  claimId: string
  resuming?: TeDraft
  busy: boolean
  /** Sends the answer; resolves true when it went. */
  onSend: (text: string) => Promise<boolean>
}) {
  const [text, setText] = React.useState(() => {
    const body = resuming?.body as { text?: string } | undefined
    return typeof body?.text === 'string' ? body.text : ''
  })
  const [pristine] = React.useState<Record<string, unknown>>(() => ({ text }))
  const body = React.useMemo<Record<string, unknown>>(() => ({ text }), [text])
  const autosave = useDraftAutosave({
    kind: 'claim',
    body,
    pristine,
    title: draftTitle('claim', body),
    claimId,
    resumingId: resuming?.id ?? null,
    enabled: !busy,
  })

  async function send() {
    if (await onSend(text)) {
      await autosave.discard()
      setText('')
    }
  }

  return (
    <View style={{ marginBottom: S.md }}>
      <Input label="Your answer" multiline value={text} onChangeText={setText} style={{ marginBottom: S.xs }} />
      {autosave.state === 'saved' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: S.sm }}>
          <SavedLine autosave={autosave} />
          <Txt size={F.tiny} tone="muted">— you can come back to this</Txt>
        </View>
      ) : <View style={{ marginBottom: S.sm }}><SavedLine autosave={autosave} /></View>}
      <Button title="Send answer" full disabled={busy || !text.trim()} onPress={() => void send()} />
    </View>
  )
}
