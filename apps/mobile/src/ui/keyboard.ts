// src/ui/keyboard.ts — keeps the field being typed in above the keyboard.
//
// KeyboardAvoidingView shrinks the screen to end at the keyboard, but on Android that
// leaves the scroll where it was, so a field near the bottom ends up hidden under the
// keyboard while the person types. This scrolls it back into view once the keyboard
// has settled. Every vertical scroller that holds inputs passes its ref here.
import * as React from 'react'
import { Keyboard, Platform, TextInput, type ScrollView } from 'react-native'

const SETTLE_MS = 320
const MARGIN = 20

export function useFieldAboveKeyboard(scroller: React.RefObject<ScrollView | null>) {
  React.useEffect(() => {
    if (Platform.OS === 'web') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput()
        const box = scroller.current as any
        const content = box?.getInnerViewRef?.()
        if (!input || !box || !content) return
        box.measureInWindow((_x: number, boxY: number, _w: number, boxH: number) => {
          input.measureInWindow((_ix: number, inputY: number, _iw: number, inputH: number) => {
            // A scroller that is not on screen (a hidden tab) measures zero: leave it alone.
            if (!boxH || inputY + inputH + MARGIN <= boxY + boxH) return
            input.measureLayout(content, (_l: number, top: number, _cw: number, h: number) => {
              box.scrollTo({ y: top + h + MARGIN - boxH, animated: true })
            }, () => {})
          })
        })
      }, SETTLE_MS)
    })
    return () => { clearTimeout(timer); sub.remove() }
  }, [scroller])
}

/** How tall the keyboard is right now: 0 when it is closed. */
export function useKeyboardHeight() {
  const [height, setHeight] = React.useState(0)
  React.useEffect(() => {
    if (Platform.OS === 'web') return
    const show = Keyboard.addListener('keyboardDidShow', e => setHeight(e.endCoordinates.height))
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0))
    return () => { show.remove(); hide.remove() }
  }, [])
  return height
}
