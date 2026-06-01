import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: '멍백홈',
  slug: 'meongbackhome',
  scheme: 'meongbackhome',
  version: '0.1.0',
  orientation: 'portrait',
  ios: { bundleIdentifier: 'com.meongbackhome.app', supportsTablet: false, infoPlist: { UIBackgroundModes: ['location'] } },
  android: { package: 'com.meongbackhome.app', config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY } } },
  plugins: [
    'expo-router',
    'expo-secure-store',
    '@react-native-firebase/app',
    '@react-native-firebase/messaging',
    ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
    ['@react-native-kakao/core', { nativeAppKey: process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY }],
    [
      'expo-location',
      {
        locationWhenInUsePermission: '산책 경로를 기록하기 위해 위치를 사용합니다.',
        locationAlwaysAndWhenInUsePermission: '화면이 꺼져 있어도 산책 경로를 기록하기 위해 위치를 사용합니다.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    kakaoNativeAppKey: process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY,
    googleMapsAndroidKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY,
  },
};
export default config;
