// src/features/expenses/leg/JourneyAnswer.tsx — a desk's question about one journey,
// and the box to answer it (components/te/leg/TeJourneyAnswer.tsx). Shown under the
// journey's row on the trip and on the journey's own screen, only while
// review.backAt is set. Answering unblocks the claim; it is not the desk agreeing.
import * as React from 'react'
import { View } from 'react-native'
import type { TeLegReview } from '@web/te/types'
import { S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { errorText, te } from '../api'
import { Flag } from '../ui/kit'

export function JourneyAnswer({ legId, n, review, onDone }: {
  legId: string
  n: number
  review: TeLegReview | null | undefined
  onDone: (message: string) => void
}) {
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  if (!review?.backAt) return null
  const who = review.backDesk === 'finance_team' ? 'Finance' : 'The travel desk'

  async function send() {
    setBusy(true); setError('')
    try {
      await te.legAnswer(legId, text.trim())
      onDone(`Your answer about journey ${n} was sent.`)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ gap: S.sm, marginTop: S.sm, marginBottom: S.sm }}>
      <Flag tone="crit" icon="warn" title={`${who} asked about journey ${n}`}>
        {review.backWhy ? <Txt size={12.5} tone="soft">{review.backWhy}</Txt> : null}
        <Txt size={12} tone="soft" style={{ marginTop: 2 }}>Your claim for this trip waits until you answer.</Txt>
      </Flag>
      <Input label="Your answer" multiline value={text} onChangeText={setText}
        placeholder="The signal dropped in the basement car park, so the route starts at the exit."
        help={`This unblocks your claim. ${who === 'Finance' ? 'Finance' : 'The desk'} will look again and either confirm the journey or come back to you.`} />
      {error ? <Flag tone="crit" icon="warn">{error}</Flag> : null}
      <Button title={busy ? 'Sending…' : 'Send my answer'} disabled={busy || !text.trim()} onPress={() => void send()} />
    </View>
  )
}
