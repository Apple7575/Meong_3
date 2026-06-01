import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: '멍백홈',
  slug: 'meongbackhome',
  scheme: 'meongbackhome',
  version: '0.1.0',
  orientation: 'portrait',
  newArchEnabled: true,
  ios: { bundleIdentifier: 'com.meongbackhome.app', supportsTablet: false },
  android: { package: 'com.meongbackhome.app' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    '@react-native-firebase/app',
    '@react-native-firebase/messaging',
    ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
};
export default config;
