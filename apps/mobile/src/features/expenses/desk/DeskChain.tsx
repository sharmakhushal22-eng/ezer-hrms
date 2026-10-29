// src/features/expenses/desk/DeskChain.tsx — how far a request has got through
// its approvers (components/te/TeChain.tsx). The sentence and ordering are
// chainState() in lib/te/approval-chain.ts (shared); this only draws them.
import * as React from 'react'
import { View } from 'react-native'
import { chainState, chainTone, shortRole, type ChainStep } from '@web/te/approval-chain'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Chip } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'

function mark(status: string): { icon: string; cls: 'ok' | 'no' | 'back' | 'off' | 'wait' } {
  if (status === 'approved' || status === 'auto') return { icon: 'check', cls: 'ok' }
  if (status === 'rejected') return { icon: 'close', cls: 'no' }
  if (status === 'sent_back') return { icon: 'back', cls: 'back' }
  if (status === 'cancelled') return { icon: 'close', cls: 'off' }
  return { icon: 'clock', cls: 'wait' }
}

export function DeskChain({ steps, compact }: { steps: ChainStep[]; compact?: boolean }) {
  const { C } = useTheme()
  const s = chainState(steps)
  const tone = `t-${chainTone(s.state)}`
  const chip = <Chip label={s.text} tone={tone === 't-plain' ? 'plain' : tone} />
  if (compact || !steps.length) return chip
  const colour = { ok: C.positive, no: C.critical, back: C.warning, off: C.faint, wait: C.muted }
  return (
    <View style={{ marginTop: 6, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {chip}
        {s.total > 1 ? <Txt size={F.tiny} tone="muted">{`${s.done} of ${s.total} done`}</Txt> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }}>
        {steps.map(step => {
          const m = mark(step.status)
          const acted = step.actedBy && step.actedBy !== step.who ? step.actedBy : null
          return (
            <View key={step.stepNo} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TeIcon name={m.icon} size="sm" color={colour[m.cls]} />
              <Txt size={F.tiny} w={700}>{shortRole(step.roleLabel)}</Txt>
              {step.who ? <Txt size={F.tiny} tone="muted">{step.who}</Txt> : null}
              {acted ? <Txt size={F.tiny} tone="muted">{`signed by ${acted}`}</Txt> : null}
            </View>
          )
        })}
      </View>
    </View>
  )
}
