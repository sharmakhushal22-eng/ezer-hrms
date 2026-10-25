// src/app/_layout.tsx — providers and the sign-in gate.
//
// Signed out → only /login is reachable. Signed in → the app. A forced password
// change happens inside the login flow before any session is stored, exactly as on
// the website's /ess-login, so it never needs a route of its own.
import * as React from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useFonts } from 'expo-font'
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, DMSans_800ExtraBold } from '@expo-google-fonts/dm-sans'
import { Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces'
import { queryClient } from '@/core/query'
import { SessionProvider, useSession } from '@/core/session'
import { ThemeProvider, useTheme } from '@/ui/ThemeProvider'
import { OverlayProvider } from '@/ui/overlays'

SplashScreen.preventAutoHideAsync().catch(() => {})

function Gate() {
  const { status } = useSession()
  const { C, isDark } = useTheme()
  const segments = useSegments()
  const router = useRouter()
  const at = segments[0] as string | undefined

  React.useEffect(() => {
    if (status === 'loading') return
    SplashScreen.hideAsync().catch(() => {})
    if (status === 'signedOut' && at !== 'login') router.replace('/login')
    else if (status === 'signedIn' && at === 'login') router.replace('/')
  }, [status, at, router])

  // Nothing renders until the stored session is read: a screen opened by a deep
  // link would otherwise fire its queries with no token and no employee id.
  if (status === 'loading') return null

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.canvas }, animation: 'slide_from_right' }} />
    </>
  )
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, DMSans_800ExtraBold, Fraunces_500Medium, Fraunces_600SemiBold })
  if (!fontsLoaded) return null
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <SessionProvider>
              <OverlayProvider>
                <Gate />
              </OverlayProvider>
            </SessionProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
