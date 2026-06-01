import { createContext, useContext } from 'react';
import { Session } from '@supabase/supabase-js';

export type SessionState = { session: Session | null; loading: boolean };
export const SessionContext = createContext<SessionState>({ session: null, loading: true });
export const useSession = () => useContext(SessionContext);
