// src/ui/Screen.tsx — the frame every screen sits in: safe areas, the header,
// pull-to-refresh, and keyboard avoidance for forms.
//
// Pull-to-refresh is the phone's answer to the website's "reload": it refetches
// every query the screen owns, so a change HR made on the website shows up here
// without restarting the app.
//
// Two kinds of screen use this. A section (Payroll, Profile, HR Services…) sits
// inside the app's shell: the top bar and thumb bar stay put around it, and
// ScreenFrame hands it the section's heading and sub-tabs. A drill-down (a message
// thread, a trip, the Digital ID) is pushed over the shell with a back arrow.
import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTheme } from './ThemeProvider'
import { F, S } from './theme'
import { Txt } from './primitives'
import { IconChevron } from './icons'
import { useFieldAboveKeyboard } from './keyboard'

/** What a section draws around the screen inside it. The heading scrolls away with
 *  the page, as on the website; the tabs stay pinned, so switching is one tap away. */
export interface ScreenFrameValue { head?: React.ReactNode; tabs?: React.ReactNode }
export const ScreenFrame = React.createContext<ScreenFrameValue | null>(null)

/** The section heading for a screen with its own scroller (`ownFrame`): it scrolls away
 *  with the content, and cancels the scroller's padding so it sits as it does elsewhere. */
export function FrameHead() {
  const frame = React.useContext(ScreenFrame)
  return frame?.head ? <View style={{ marginHorizontal: -S.lg, marginTop: -S.lg }}>{frame.head}</View> : null
}

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
  /** Replaces the title header. */
  top?: React.ReactNode
  /** For a screen that scrolls to one of its own sections (Leave's "Apply for leave"). */
  scrollRef?: React.Ref<ScrollView>
  /** With scroll={false}: the screen's own scroller draws the section heading (FrameHead). */
  ownFrame?: boolean
}

export function Screen({ title, subtitle, back = true, onBack, right, children, onRefresh, scroll = true, padded = true, sub, footer, contentStyle, top, scrollRef, ownFrame }: ScreenProps) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const frame = React.useContext(ScreenFrame)
  const scroller = React.useRef<ScrollView>(null)
  React.useImperativeHandle(scrollRef, () => scroller.current as ScrollView, [])
  useFieldAboveKeyboard(scroller)
  // KeyboardAvoidingView works from its offset within this view, as if this view began at
  // the top of the window. In the shell it begins below the top bar, so it is told how far.
  const root = React.useRef<View>(null)
  const [topY, setTopY] = React.useState(0)
  const place = () => { if (frame) root.current?.measureInWindow((_x, y) => setTopY(y)) }
  const [refreshing, setRefreshing] = React.useState(false)
  const refresh = React.useCallback(async () => {
    if (!onRefresh) return
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  }, [onRefresh])

  // In the shell the thumb bar already clears the home indicator.
  const pad: ViewStyle = { padding: padded ? S.lg : 0, paddingBottom: S.xl + (footer || frame ? 0 : insets.bottom) }
  const pinned = frame && (frame.tabs || sub) ? <View style={{ backgroundColor: C.canvas }}>{frame.tabs}{sub}</View> : null

  const body = scroll ? (
    <ScrollView
      ref={scroller}
      keyboardShouldPersistTaps="handled"
      stickyHeaderIndices={pinned ? [1] : undefined}
      contentContainerStyle={frame ? undefined : [pad, contentStyle]}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.brand} colors={[C.brand]} /> : undefined}>
      {frame ? <View>{frame.head}</View> : children}
      {frame ? pinned ?? <View /> : null}
      {frame ? <View style={[pad, contentStyle]}>{children}</View> : null}
    </ScrollView>
  ) : <View style={[{ flex: 1, padding: padded ? S.lg : 0 }, contentStyle]}>{children}</View>

  return (
    <View ref={root} onLayout={place} style={{ flex: 1, backgroundColor: C.canvas }}>
      {!frame && top}
      {!frame && !top && (title || back) && (
        <View style={{ paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: S.sm, backgroundColor: C.canvas, borderBottomWidth: 1, borderBottomColor: C.hair, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {back ? (
            <Pressable onPress={onBack || (() => (router.canGoBack() ? router.back() : router.replace('/')))} hitSlop={10} accessibilityLabel="Back"
              style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '180deg' }] }}>
              <IconChevron size={20} color={C.ink} strokeWidth={2} />
            </Pressable>
          ) : <View style={{ width: S.sm }} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            {!!title && <Txt size={F.title} w={700}>{title}</Txt>}
            {!!subtitle && <Txt size={F.tiny} tone="muted">{subtitle}</Txt>}
          </View>
          {right}
        </View>
      )}
      {!frame && sub}
      {frame && !scroll && !ownFrame && <>{frame.head}{pinned}</>}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'} keyboardVerticalOffset={topY}>
        {body}
        {footer && (
          <View style={{ paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: (frame ? 0 : insets.bottom) + S.sm, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line }}>
            {footer}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  )
}
