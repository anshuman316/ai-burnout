import { supabase } from './supabase'

// The chat page talks to the AI only through this file.
// The AI itself runs in the ai-chat edge function, which holds the Groq key.

export const CHAT_DAILY_LIMIT = 50;
const MESSAGES_ON_SCREEN = 100;

export const listChatMessages = async () => {
    const { data, error } = await supabase
        .from('chat_messages')
        .select('id, role, content, is_safety, created_at')
        .order('created_at', { ascending: false })
        .limit(MESSAGES_ON_SCREEN);
    if (error) throw error;
    return data.reverse().map((row) => ({ id: row.id, role: row.role, content: row.content, isSafety: row.is_safety, createdAt: row.created_at }));
}

// Returns { reply, safety }. On failure throws an Error with .code:
// 'daily_limit', 'ai_unavailable', 'too_long', 'not_signed_in', 'server_error' or 'network'
export const sendChatMessage = async (message) => {
    const { data, error } = await supabase.functions.invoke('ai-chat', { body: { message } });
    if (!error) return { reply: data.reply, safety: Boolean(data.safety) };

    let code = 'network';
    if (error.context instanceof Response) {
        try {
            code = (await error.context.json()).error ?? 'server_error';
        } catch {
            code = 'server_error';
        }
    }
    throw Object.assign(new Error(`Chat request failed: ${code}`), { code });
}
