// src/features/expenses/ui/TeSheet.tsx — the drawer every form of the module opens in
// (components/te/TeSheet.tsx), as a full-screen modal screen.
//
// Same props as the website: title (+ titleIcon), lead, crumb, back ("Back" link
// above the title), bar (the strip under the header, for the step navs), footer
// (sticky actions) and the close "X" (label "Close"). The sheet routes in
// src/app/expenses/_layout.tsx are presented as modals, so Android back = onClose
// for free; `onClose` defaults to closing the route.
//
// `scrollKey`: change it to scroll the body back to the top (the planner does
// this on every step change, as goStep() does on the website).
import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { TeIcon } from './TeIcon'
import { close } from '../nav'

export interface TeSheetProps {
  title: string
  titleIcon?: React.ReactNode
  lead?: string
  crumb?: React.ReactNode
  back?: () => void
  bar?: React.ReactNode
  footer?: React.ReactNode
  onClose?: () => void
  children: React.ReactNode
  scrollKey?: string | number
  /** Pull-to-refresh is not offered in a sheet; a sheet is a form. */
  padded?: boolean
}

export function TeSheet({ title, titleIcon, lead, crumb, back, bar, footer, onClose = close, children, scrollKey, padded = true }: TeSheetProps) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const scroll = React.useRef<ScrollView>(null)
  React.useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }) }, [scrollKey])

  return (
    <View style={{ flex: 1, backgroundColor: C.surface }} accessibilityLabel={title}>
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: S.lg, paddingBottom: S.md, flexDirection: 'row', gap: S.sm, borderBottomWidth: bar ? 0 : 1, borderBottomColor: C.line }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {(back || crumb) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              {back && (
                <Pressable onPress={back} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 }}>
                  <TeIcon name="back" size="sm" color={C.brand} />
                  <Txt size={F.small} w={600} tone="brand">Back</Txt>
                </Pressable>
              )}
              {crumb}
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {titleIcon}
            <Txt size={F.title + 2} w={700} style={{ flex: 1 }}>{title}</Txt>
          </View>
          {!!lead && <Txt size={F.small} tone="muted" style={{ marginTop: 4 }}>{lead}</Txt>}
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.sunken : 'transparent' })}>
          <TeIcon name="close" color={C.muted} />
        </Pressable>
      </View>
      {bar && (
        <View style={{ paddingHorizontal: S.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.surface }}>{bar}</View>
      )}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" style={{ backgroundColor: C.surface }}
          contentContainerStyle={{ padding: padded ? S.lg : 0, paddingBottom: (footer ? S.xl : S.xl + insets.bottom) }}>
          {children}
        </ScrollView>
        {footer && (
          <View style={{ paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: insets.bottom + S.sm, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line, gap: S.sm }}>
            {footer}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  )
}

/** The small coloured square before a sheet title (.hk.k-<kind>). */
export { KindSquare as TitleIcon } from './kit'
