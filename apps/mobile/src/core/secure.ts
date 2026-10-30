// src/core/secure.ts — where the session lives on the phone.
//
// The website keeps the ESS session in localStorage['ezer_ess_session']. On
// Android that becomes Expo SecureStore: the value is encrypted with a key held
// in the Android Keystore, so another app — or someone copying the app's data
// directory — cannot read the token.
//
// The web build (used only for local testing, never shipped) has no keystore and
// falls back to localStorage, which is exactly what the website itself does.
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

export async function secureGet(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null
    return await SecureStore.getItemAsync(key)
  } catch { return null }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') { globalThis.localStorage?.setItem(key, value); return }
  await SecureStore.setItemAsync(key, value)
}

export async function secureDel(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') { globalThis.localStorage?.removeItem(key); return }
    await SecureStore.deleteItemAsync(key)
  } catch { /* nothing to delete */ }
}
