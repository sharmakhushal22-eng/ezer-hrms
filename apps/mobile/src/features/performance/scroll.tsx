// src/features/performance/scroll.tsx — bring a view to the top of the
// Performance screen's scroller. When a sub-tab swaps a list for a panel in
// place (the review panel, a person's ratings), the scroll offset would
// otherwise stay where the list was tapped and the panel's top would sit
// above the screen.
import * as React from 'react'
import { Platform, type ScrollView, type View } from 'react-native'

type Reveal = (target: View | null) => void
const Ctx = React.createContext<Reveal>(() => {})
export const useReveal = () => React.useContext(Ctx)

/** Scroll `scroller` so that `target` sits at the top, once a swap in place has laid out. */
export function revealIn(scroller: React.RefObject<ScrollView | null>, target: View | null) {
  if (!target) return
  setTimeout(() => {
    if (Platform.OS === 'web') {
      (target as unknown as { scrollIntoView?: (o: object) => void }).scrollIntoView?.({ block: 'start', behavior: 'smooth' })
      return
    }
    const box = scroller.current as unknown as { getInnerViewRef?: () => unknown; scrollTo: (o: { y: number; animated: boolean }) => void } | null
    const content = box?.getInnerViewRef?.()
    if (!box || !content) return
    target.measureLayout(content as never, (_x, y) => box.scrollTo({ y: Math.max(0, y - 8), animated: true }), () => {})
  }, 60)
}

export function RevealProvider({ scroller, children }: { scroller: React.RefObject<ScrollView | null>; children: React.ReactNode }) {
  const reveal = React.useCallback<Reveal>(target => revealIn(scroller, target), [scroller])
  return <Ctx.Provider value={reveal}>{children}</Ctx.Provider>
}
