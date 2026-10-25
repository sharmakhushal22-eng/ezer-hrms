// TEMPORARY test harness — delete before finishing.
import * as React from 'react'
import { ScrollView } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { Screen } from '@/ui/Screen'
import { useEmployeeId } from '@/core/session'
import { Stage } from '@/features/funzone/kit'
import { MemoryVsBot, TicTacToeVsBot, TriviaVsBot } from '@/features/funzone/vs'
import PlayTogether from '@/features/funzone/live/PlayTogether'
import LiveTicTacToe from '@/features/funzone/live/LiveTicTacToe'

export default function VsTest() {
  const { g, sid, host, opp } = useLocalSearchParams<{ g?: string; sid?: string; host?: string; opp?: string }>()
  const me = useEmployeeId()
  const back = () => {}
  let el: React.ReactNode = null
  if (g === 'mem') el = <MemoryVsBot onBack={back} />
  else if (g === 'quiz') el = <TriviaVsBot onBack={back} />
  else if (g === 'live') el = (
    <Stage cat="arcade" icon="🤝" title="Play together" sub="Invite a colleague and play on two screens, live." onBack={back} left>
      {!!me && <PlayTogether meId={me} />}
    </Stage>
  )
  else if (g === 'tttlive' && me && sid && host) el = (
    <Stage cat="arcade" icon="🤝" title="Play together" sub="host harness" left>
      <LiveTicTacToe sessionId={sid} meId={me} hostId={host} opponentName={opp || 'them'} onExit={() => {}} />
    </Stage>
  )
  else el = <TicTacToeVsBot onBack={back} />
  return (
    <Screen title="Fun Zone test" scroll={false} padded={false}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>{el}</ScrollView>
    </Screen>
  )
}
