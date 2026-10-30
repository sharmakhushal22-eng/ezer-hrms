// src/ui/Screen.tsx — the frame every screen sits in: safe areas, the header,
// pull-to-refresh, and keyboard avoidance for forms.
//
// Pull-to-refresh is the phone's answer to the website's "reload": it refetches
// every query the screen owns, so a change HR made on the website shows up here
// without restarting the app.
import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTheme } from './ThemeProvider'
import { F, S } from './theme'
import { Txt } from './primitives'
import { IconChevron } from './icons'

export interface ScreenProps {
  title?: string
  subtitle?: string
  /** Show a back arrow. Defaults to true for stack screens. */
  back?: boolean
  onBack?: () => void
  right?: React.ReactNode
  children: React.ReactNode
  /** Pull-to-refresh. Pass the refetch of the screen's queries. */
  onRefresh?: () => Promise<unknown> | void
  scroll?: boolean
  padded?: boolean
  /** Sits under the header, outside the scroll (e.g. a tab row). */
  sub?: React.ReactNode
  /** Pinned to the bottom, above the safe area (e.g. a Submit bar). */
  footer?: React.ReactNode
  contentStyle?: StyleProp<ViewStyle>
  /** Extra bottom space so content clears the tab bar. */
  tabBar?: boolean
  /** Replaces the title header (the tab screens put the app's top bar here). */
  top?: React.ReactNode
  /** For a screen that scrolls to one of its own sections (Leave's "Apply for leave"). */
  scrollRef?: React.Ref<ScrollView>
}

export function Screen({ title, subtitle, back = true, onBack, right, children, onRefresh, scroll = true, padded = true, sub, footer, contentStyle, tabBar, top, scrollRef }: ScreenProps) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const [refreshing, setRefreshing] = React.useState(false)
  const refresh = React.useCallback(async () => {
    if (!onRefresh) return
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  }, [onRefresh])

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[{ padding: padded ? S.lg : 0, paddingBottom: (tabBar ? 96 : S.xl) + (footer ? 0 : insets.bottom) }, contentStyle]}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.brand} colors={[C.brand]} /> : undefined}>
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1, padding: padded ? S.lg : 0 }, contentStyle]}>{children}</View>

  return (
    <View style={{ flex: 1, backgroundColor: C.canvas }}>
      {top}
      {!top && (title || back) && (
        <View style={{ paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: S.sm, backgroundColor: C.canvas, borderBottomWidth: 1, borderBottomColor: C.hair, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {back ? (
            <Pressable onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace('/')))} hitSlop={10} accessibilityLabel="Back"
              style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '180deg' }] }}>
              <IconChevron size={20} color={C.ink} strokeWidth={2} />
            </Pressable>
          ) : <View style={{ width: S.sm }} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            {!!title && <Txt size={F.title} w={700} numberOfLines={1}>{title}</Txt>}
            {!!subtitle && <Txt size={F.tiny} tone="muted" numberOfLines={1}>{subtitle}</Txt>}
          </View>
          {right}
        </View>
      )}
      {sub}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
        {footer && (
          <View style={{ paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: insets.bottom + S.sm, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line }}>
            {footer}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  )
}
