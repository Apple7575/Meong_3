import '../src/lib/walkLocation';
import { useEffect, useState } from 'react';
import { Slot } from 'expo-router';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../src/lib/supabase';
import { SessionContext } from '../src/lib/session';
import { usePushNavigation } from '../src/lib/pushNav';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  usePushNavigation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={{ session, loading }}>
      <Slot />
    </SessionContext.Provider>
  );
}
