import { TERMS_VERSION } from '../data/onboarding'
import { supabase } from './supabase'

// True once the person has finished onboarding. Throws the Supabase error on failure.
export const hasProfile = async (userId) => {
    const { data, error } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
    if (error) throw error;
    return Boolean(data);
}

// The person's username (used as their name in the app), or null if they haven't finished onboarding
export const getDisplayName = async (userId) => {
    const { data, error } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data?.display_name ?? null;
}

// Saves the onboarding answers that belong on the profile. Safe to run again if a later step failed.
// Throws the Supabase error on failure; error.code '23505' means the username was just taken.
export const saveOnboarding = async (userId, { username, diaryAiConsent }) => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('profiles').upsert({
        id: userId,
        username,
        display_name: username,
        diary_ai_consent: diaryAiConsent,
        terms_version: TERMS_VERSION,
        terms_accepted_at: now,
        onboarded_at: now
    });
    if (error) throw error;
}
