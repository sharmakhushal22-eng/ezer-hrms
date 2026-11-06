// src/features/expenses/plan/gps.ts — one GPS reading, for the place picker and Start now.
//
// The website calls navigator.geolocation.getCurrentPosition with
// { enableHighAccuracy: true, timeout } (12 000 ms in TePlacePicker, 20 000 ms in
// TeStartNow). Here that is expo-location: ask for foreground permission first,
// then getCurrentPositionAsync at High accuracy, raced against the same timeout.
// The callers keep the website's sentences; this file only says which of the
// three failures happened:
//   nodevice  the device cannot read a location at all ('geolocation' in navigator false)
//   denied    PERMISSION_DENIED
//   failed    anything else (timeout, no fix, location services off)
import * as Location from 'expo-location'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { Platform } from 'react-native'

export type GpsFailKind = 'nodevice' | 'denied' | 'failed'

export class GpsError extends Error {
  kind: GpsFailKind
  constructor(kind: GpsFailKind) {
    super(kind)
    this.name = 'GpsError'
    this.kind = kind
  }
}

/** A fresh position (no cached fix, like the website's maximumAge 0 / default). */
export async function readPosition(timeoutMs: number): Promise<Location.LocationObject> {
  let perm: Location.LocationPermissionResponse
  try {
    perm = await Location.requestForegroundPermissionsAsync()
  } catch {
    throw new GpsError('nodevice')
  }
  if (perm.status !== 'granted') throw new GpsError('denied')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new GpsError('failed')), timeoutMs) }),
    ])
  } catch (e) {
    throw e instanceof GpsError ? e : new GpsError('failed')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** GpsFix.device — spec Part 4 "Known defects" 6: the web never sends it; the app does. */
export function deviceInfo(): Record<string, unknown> {
  return {
    os: Platform.OS,
    osVersion: String(Platform.Version ?? ''),
    model: Device.modelName ?? null,
    appVersion: Constants.expoConfig?.version ?? null,
  }
}
