import { createContext, useContext } from 'react'

// session: the Supabase session or null. loading: true until the first check is done.
// profileStatus: 'none' (signed out) | 'loading' | 'complete' | 'missing' (onboarding not done) | 'error'
export const AuthContext = createContext({ session: null, loading: true, profileStatus: 'none', markProfileComplete: () => {} });

export const useAuth = () => useContext(AuthContext);
