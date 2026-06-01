import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../src/lib/session';
import { getMyProfile } from '../src/services/profile';
import { isOnboardingComplete } from '../src/validation/profile';

export default function Index() {
  const { session, loading } = useSession();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) { setOnboarded(null); return; }
    getMyProfile().then((p) => setOnboarded(p ? isOnboardingComplete(p) : false)).catch(() => setOnboarded(false));
  }, [session]);

  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (onboarded === null) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (!onboarded) return <Redirect href="/(onboarding)/profile" />;
  return <Redirect href="/(app)/home" />;
}
