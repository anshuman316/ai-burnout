import React, { useCallback, useEffect, useState } from 'react'
import { AuthContext } from '../context/AuthContext'
import { hasProfile } from '../lib/profiles'
import { supabase } from '../lib/supabase'

const AuthProvider = ({ children }) => {

    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(Boolean(supabase));
    // Whether the signed-in person has finished onboarding: { userId, status }
    const [profile, setProfile] = useState({ userId: null, status: null });
    const userId = session?.user.id;

    useEffect(() => {
        if (!supabase) return;
        supabase.auth.getSession().then(({ data, error }) => {
            if (error) console.error('Could not restore the sign-in session:', error.message);
            setSession(data.session);
            setLoading(false);
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
            setSession(newSession);
        });
        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        hasProfile(userId)
            .then((exists) => {
                if (!cancelled) setProfile({ userId, status: exists ? 'complete' : 'missing' });
            })
            .catch((error) => {
                console.error('Checking onboarding failed:', error.message);
                if (!cancelled) setProfile({ userId, status: 'error' });
            });
        return () => { cancelled = true; };
    }, [userId]);

    const markProfileComplete = useCallback(() => setProfile({ userId, status: 'complete' }), [userId]);

    let profileStatus = 'none';
    if (userId) profileStatus = profile.userId === userId ? profile.status : 'loading';

    return (
        <AuthContext.Provider value={{ session, loading, profileStatus, markProfileComplete }}>
            {children}
        </AuthContext.Provider>
    )
}

export default AuthProvider
