// src/ui/overlays.tsx — sheets, pickers, confirmations and toasts.
//
// The website uses dropdowns, popovers, window.confirm() and a notify() toast.
// On a phone those become: a bottom sheet for any list of choices, a calendar
// sheet for dates, a centred dialog for "are you sure", and a toast that slides
// up from the bottom. All are drawn in JS (no native Alert), so they look the
// same on every Android version and can show the website's exact wording.
import * as React from 'react'
import { Animated, Easing, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from './ThemeProvider'
import { elevation, F, FONT, R, S } from './theme'
import { Button, Gap, MAX_FONT_SCALE, Txt, webNoOutline } from './primitives'
import { IconCheck, IconChevron, IconClose, IconSearch } from './icons'
import { useFieldAboveKeyboard, useKeyboardHeight } from './keyboard'

const NATIVE = Platform.OS !== 'web'

// ── Sheet ───────────────────────────────────────────────────────────────────
export function Sheet({ visible, onClose, title, children, footer, full }: {
  visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode; full?: boolean
}) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const scroller = React.useRef<ScrollView>(null)
  useFieldAboveKeyboard(scroller)
  const keyboard = useKeyboardHeight()
  // The scrim fades while the panel rises, rather than the whole Modal sliding up
  // with its grey backdrop attached; the panel stays mounted until it has gone.
  const [mounted, setMounted] = React.useState(visible)
  if (visible && !mounted) setMounted(true)
  const [open] = React.useState(() => new Animated.Value(0))
  const [drag] = React.useState(() => new Animated.Value(0))
  React.useEffect(() => {
    if (visible) drag.setValue(0)
    const anim = Animated.timing(open, {
      toValue: visible ? 1 : 0, duration: visible ? 240 : 180, useNativeDriver: NATIVE,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
    })
    anim.start(({ finished }) => { if (finished && !visible) setMounted(false) })
    return () => anim.stop()
  }, [visible, open, drag])
  // Pull the grip down to dismiss.
  const grip = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => g.dy > 4,
    onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => {
      if (g.dy > 90 || g.vy > 0.9) onClose()
      else Animated.spring(drag, { toValue: 0, useNativeDriver: NATIVE, bounciness: 0 }).start()
    },
  }), [drag, onClose])
  const rise = open.interpolate({ inputRange: [0, 1], outputRange: [height, 0] })
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.scrim, opacity: open }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View style={{
          backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
          // With the keyboard up the panel gets the room left above it, and scrolls inside that.
          maxHeight: keyboard ? height - keyboard - insets.top - S.sm : full ? '94%' : '86%',
          minHeight: full && !keyboard ? '70%' : undefined, paddingBottom: keyboard ? S.sm : insets.bottom + S.sm, ...elevation(C, 3),
          transform: [{ translateY: Animated.add(rise, drag) }],
        }}>
          <View {...grip.panHandlers} style={{ alignItems: 'center', paddingTop: 8, paddingBottom: title ? 0 : 8 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.lineStrong }} />
          </View>
          {!!title && (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.sm }}>
              <Txt size={F.lead + 1} w={700} style={{ flex: 1 }}>{title}</Txt>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={{ padding: 6 }}>
                <IconClose size={18} color={C.muted} />
              </Pressable>
            </View>
          )}
          <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: S.lg }}>
            {children}
          </ScrollView>
          {footer && <View style={{ paddingHorizontal: S.lg, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>{footer}</View>}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Select ──────────────────────────────────────────────────────────────────
export interface Option<V = string> { value: V; label: string; note?: string; disabled?: boolean }

export function SelectSheet<V extends string | number>({ visible, onClose, title, options, value, onPick, searchable }: {
  visible: boolean; onClose: () => void; title: string; options: Option<V>[]; value?: V | null; onPick: (v: V) => void; searchable?: boolean
}) {
  const { C } = useTheme()
  const [q, setQ] = React.useState('')
  const shown = q ? options.filter(o => `${o.label} ${o.note || ''}`.toLowerCase().includes(q.toLowerCase())) : options
  return (
    <Sheet visible={visible} onClose={() => { setQ(''); onClose() }} title={title}>
      {(searchable ?? options.length > 8) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm + 1, paddingHorizontal: S.md, marginBottom: S.sm }}>
          <IconSearch size={16} color={C.faint} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={C.faint}
            maxFontSizeMultiplier={MAX_FONT_SCALE} style={[{ flex: 1, height: 44, fontFamily: FONT[400], fontSize: F.body, color: C.ink }, webNoOutline]} />
        </View>
      )}
      {shown.map(o => {
        const on = o.value === value
        return (
          <Pressable key={String(o.value)} disabled={o.disabled} onPress={() => { setQ(''); onPick(o.value); onClose() }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: pressed ? C.brandTint : 'transparent', opacity: o.disabled ? 0.45 : 1 })}>
            <View style={{ flex: 1 }}>
              <Txt size={F.body} w={on ? 600 : 400} color={on ? C.brandDeep : C.ink}>{o.label}</Txt>
              {!!o.note && <Txt size={F.tiny} tone="muted">{o.note}</Txt>}
            </View>
            {on && <IconCheck size={16} color={C.brand} />}
          </Pressable>
        )
      })}
      {!shown.length && <Txt tone="muted" center style={{ padding: S.lg }}>No matches</Txt>}
    </Sheet>
  )
}

// ── Date picker ─────────────────────────────────────────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n: number) => String(n).padStart(2, '0')
/** 'YYYY-MM-DD' in local time — what every date column on the website stores. */
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseYmd = (s?: string | null) => {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

export function DateSheet(props: {
  visible: boolean; onClose: () => void; value?: string | null; onPick: (ymd: string) => void; min?: string | null; max?: string | null; title?: string
}) {
  // The calendar starts at the picked month every time the sheet opens: keyed on
  // open + value, so its state is fresh rather than reset from an effect.
  return (
    <Sheet visible={props.visible} onClose={props.onClose} title={props.title || 'Pick a date'}>
      {props.visible && <DateBody key={`${props.value || ''}`} {...props} />}
    </Sheet>
  )
}

function DateBody({ onClose, value, onPick, min, max }: {
  onClose: () => void; value?: string | null; onPick: (ymd: string) => void; min?: string | null; max?: string | null
}) {
  const { C } = useTheme()
  const init = parseYmd(value) || new Date()
  const [cursor, setCursor] = React.useState(new Date(init.getFullYear(), init.getMonth(), 1))
  const [yearMode, setYearMode] = React.useState(false)

  const y = cursor.getFullYear(), m = cursor.getMonth()
  const first = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  const today = ymd(new Date())
  const out = (d: string) => (!!min && d < min) || (!!max && d > max)

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: S.sm }}>
        <Pressable onPress={() => setCursor(new Date(y, m - 1, 1))} hitSlop={10} style={{ padding: 10, transform: [{ rotate: '180deg' }] }} accessibilityLabel="Previous month">
          <IconChevron size={18} color={C.ink} />
        </Pressable>
        <Pressable onPress={() => setYearMode(v => !v)} style={{ flex: 1, alignItems: 'center' }}>
          <Txt size={F.lead} w={700}>{MONTHS[m]} {y}</Txt>
        </Pressable>
        <Pressable onPress={() => setCursor(new Date(y, m + 1, 1))} hitSlop={10} style={{ padding: 10 }} accessibilityLabel="Next month">
          <IconChevron size={18} color={C.ink} />
        </Pressable>
      </View>
      {yearMode ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Array.from({ length: 81 }, (_, i) => new Date().getFullYear() + 5 - i).map(yy => (
            <Pressable key={yy} onPress={() => { setCursor(new Date(yy, m, 1)); setYearMode(false) }}
              style={{ width: '22%', paddingVertical: 10, borderRadius: R.sm, alignItems: 'center', backgroundColor: yy === y ? C.brand : C.sunken }}>
              <Txt size={F.small} w={600} color={yy === y ? C.onAccent : C.ink}>{yy}</Txt>
            </Pressable>
          ))}
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row' }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }}><Txt size={F.micro} w={700} tone="muted">{d}</Txt></View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cells.map((d, i) => {
              if (!d) return <View key={i} style={{ width: `${100 / 7}%`, height: 44 }} />
              const key = `${y}-${pad(m + 1)}-${pad(d)}`
              const sel = key === value, dis = out(key), isToday = key === today
              return (
                <Pressable key={i} disabled={dis} onPress={() => { onPick(key); onClose() }}
                  style={{ width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? C.brand : 'transparent', borderWidth: isToday && !sel ? 1 : 0, borderColor: C.brand }}>
                    <Txt size={F.body} w={sel ? 700 : 500} color={sel ? C.onAccent : dis ? C.lineStrong : C.ink}>{d}</Txt>
                  </View>
                </Pressable>
              )
            })}
          </View>
        </>
      )}
      <Gap h={S.sm} />
      <Button title="Today" variant="ghost" size="sm" onPress={() => { const t = ymd(new Date()); if (!out(t)) { onPick(t); onClose() } else setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) }} />
    </>
  )
}

/** 'Mon, 19 Oct 2026' style label for a YYYY-MM-DD, en-IN like the website. */
export function fmtDay(s?: string | null) {
  const d = parseYmd(s)
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

// ── Toasts & confirm ────────────────────────────────────────────────────────
type ToastKind = 'success' | 'error' | 'info'
interface ConfirmOpts { title: string; message?: string; confirm?: string; cancel?: string; destructive?: boolean; input?: { placeholder?: string; required?: boolean; label?: string } }
interface OverlayApi {
  /** The website's notify(message, type). */
  notify: (msg: string, kind?: ToastKind) => void
  /** window.confirm, styled. Resolves true/false — or the typed text when `input` is set. */
  confirm: (o: ConfirmOpts) => Promise<boolean>
  prompt: (o: ConfirmOpts) => Promise<string | null>
}
const OverlayCtx = React.createContext<OverlayApi>({ notify: () => {}, confirm: async () => false, prompt: async () => null })
export const useOverlay = () => React.useContext(OverlayCtx)

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const { C } = useTheme()
  const insets = useSafeAreaInsets()
  const [toast, setToast] = React.useState<{ msg: string; kind: ToastKind; id: number } | null>(null)
  const [dialog, setDialog] = React.useState<(ConfirmOpts & { resolve: (v: string | boolean | null) => void }) | null>(null)
  const [text, setText] = React.useState('')
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const notify = React.useCallback((msg: string, kind: ToastKind = 'success') => {
    if (timer.current) clearTimeout(timer.current)
    setToast({ msg, kind, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 5200 : 3200)
  }, [])
  const confirm = React.useCallback((o: ConfirmOpts) => new Promise<boolean>(res => { setText(''); setDialog({ ...o, resolve: v => res(!!v) }) }), [])
  const prompt = React.useCallback((o: ConfirmOpts) => new Promise<string | null>(res => { setText(''); setDialog({ ...o, input: o.input || {}, resolve: v => res(typeof v === 'string' ? v : null) }) }), [])
  const api = React.useMemo(() => ({ notify, confirm, prompt }), [notify, confirm, prompt])

  const close = (v: string | boolean | null) => { dialog?.resolve(v); setDialog(null) }
  const tc = toast?.kind === 'error' ? C.critical : toast?.kind === 'info' ? C.info : C.positive

  return (
    <OverlayCtx.Provider value={api}>
      {children}
      {toast && (
        <View pointerEvents="none" style={{ position: 'absolute', left: S.md, right: S.md, bottom: insets.bottom + 80 }}>
          <View style={{ backgroundColor: C.dark, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: S.lg, flexDirection: 'row', gap: 10, alignItems: 'center', borderLeftWidth: 4, borderLeftColor: tc, ...elevation(C, 3), maxWidth: 520 }}>
            <Txt size={F.small} w={500} color={C.onDark} style={{ flexShrink: 1 }}>{toast.msg}</Txt>
          </View>
        </View>
      )}
      <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={() => close(dialog?.input ? null : false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'web' ? undefined : 'padding'} style={{ flex: 1, backgroundColor: C.scrim, justifyContent: 'center', padding: S.xl }}>
          {dialog && (
            <View style={{ backgroundColor: C.surface, borderRadius: R.xl, padding: S.xl, ...elevation(C, 3) }}>
              <Txt size={F.title} w={700}>{dialog.title}</Txt>
              {!!dialog.message && <Txt size={F.small} tone="soft" style={{ marginTop: S.sm }}>{dialog.message}</Txt>}
              {dialog.input && (
                <TextInput autoFocus value={text} onChangeText={setText} placeholder={dialog.input.placeholder} placeholderTextColor={C.faint} multiline
                  style={{ marginTop: S.md, minHeight: 80, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm + 1, padding: S.md, fontFamily: FONT[400], fontSize: F.body, color: C.ink, textAlignVertical: 'top' }} />
              )}
              <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.lg }}>
                <Button title={dialog.cancel || 'Cancel'} variant="outline" style={{ flex: 1 }} onPress={() => close(dialog.input ? null : false)} />
                <Button title={dialog.confirm || 'OK'} variant={dialog.destructive ? 'danger' : 'primary'} style={{ flex: 1 }}
                  disabled={!!dialog.input?.required && !text.trim()}
                  onPress={() => close(dialog.input ? text.trim() : true)} />
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </OverlayCtx.Provider>
  )
}
