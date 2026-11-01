// src/features/intro/state.ts — when the entrance plays, and how far through it is.
//
// `reveal` runs 0 → 1 as the doors let you through. The screens underneath read it
// from the UI thread, so the login card arrives with the doors and not after them.
// It rests at 1, so anything that reads it after the intro simply shows.
//
// A cold start plays the intro once. Signing out and landing back on the login
// screen does not, because this module outlives the navigation. A deep link
// (a notification, a shared link) skips it: that person came to do something.
import { Dimensions } from 'react-native'
import * as Linking from 'expo-linking'
import { makeMutable } from 'react-native-reanimated'

export const reveal = makeMutable(1)

let played = false

/** True the first time it is asked, on a launch that did not come from a link. */
export function claimIntro() {
  if (played) return false
  played = true
  const url = Linking.getLinkingURL()
  const path = url ? Linking.parse(url).path : null
  if (path) return false
  reveal.set(0)
  return true
}

/** Where the logo sits. The intro and the login screen share this one line, so the
 *  logo stays put while the building moves past it. */
export const headerGap = () => Dimensions.get('window').height * 0.07
