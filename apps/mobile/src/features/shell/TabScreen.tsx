// src/features/shell/TabScreen.tsx — the frame for the four thumb-bar screens:
// the portal's top bar, a page heading like the website's TabHeader, and room
// under the content for the tab bar.
import * as React from 'react'
import { View } from 'react-native'
import { Screen, type ScreenProps } from '@/ui/Screen'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { TopBar } from './TopBar'

export function TabScreen({ heading, desc, children, ...rest }: Omit<ScreenProps, 'top' | 'tabBar' | 'back' | 'title'> & { heading?: string; desc?: string }) {
  return (
    <Screen {...rest} top={<TopBar />} tabBar back={false}>
      {!!heading && (
        <View style={{ marginBottom: S.lg }}>
          <Txt size={F.page} w={700}>{heading}</Txt>
          {!!desc && <Txt size={F.small} tone="muted" style={{ marginTop: 2 }}>{desc}</Txt>}
        </View>
      )}
      {children}
    </Screen>
  )
}
