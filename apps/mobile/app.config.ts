// app.config.ts — the Android app's identity and native permissions.
//
// Only public values belong here (they are compiled into the APK). The backend
// URL and Supabase public key come from EXPO_PUBLIC_* variables — see .env.example.
import type { ExpoConfig } from 'expo/config'

const config: ExpoConfig = {
  name: 'EZER HRMS',
  slug: 'ezer-hrms',
  // Bump for every APK you hand to testers; versionCode below must also go up.
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'ezerhrms',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'com.ezerhrms.app',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#EFF6FF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // Location: attendance punch and Travel & Expenses leg recording, the same
    // two places the website asks the browser for it. Camera / media: uploading
    // a photo, a bill or a proof.
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
    ],
    blockedPermissions: ['RECORD_AUDIO'],
    predictiveBackGestureEnabled: false,
    softwareKeyboardLayoutMode: 'resize',
  },
  ios: { bundleIdentifier: 'com.ezerhrms.app', supportsTablet: false },
  web: { output: 'single', favicon: './assets/images/favicon.png' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    ['expo-splash-screen', { backgroundColor: '#F6F8FB', image: './assets/images/splash-icon.png', imageWidth: 140,
      dark: { backgroundColor: '#0D1117', image: './assets/images/splash-icon.png' } }],
    ['expo-location', { locationWhenInUsePermission: 'EZER HRMS uses your location to record attendance punches and travel legs.' }],
    ['expo-image-picker', { photosPermission: 'EZER HRMS needs your photos to upload a profile picture, bills and proofs.', cameraPermission: 'EZER HRMS uses the camera to photograph bills and documents.' }],
    'expo-sharing',
  ],
  experiments: { typedRoutes: false, reactCompiler: true },
  // The Expo project the APK builds under (expo.dev → girish18 → ezer-hrms).
  owner: 'girish18',
  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID || '48b17f09-1718-4450-82cd-60b53aa8977f' },
  },
}

export default config
