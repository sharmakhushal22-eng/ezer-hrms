// src/features/shell/TabScreen.tsx — the frame for a screen in the app's shell. The
// top bar and thumb bar belong to the (tabs) layout, the heading to its Section.
import * as React from 'react'
import { Screen, type ScreenProps } from '@/ui/Screen'

export function TabScreen({ children, ...rest }: Omit<ScreenProps, 'top' | 'back' | 'title'>) {
  return <Screen {...rest} back={false}>{children}</Screen>
}
