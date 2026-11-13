// Equilibria AI chat. Runs on Supabase, never in the browser, so the Groq key stays secret.
// Deploy with: npm run ai:deploy
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CRISIS_PHRASES, CRISIS_REPLY, PROMPT_VERSION, SYSTEM_PROMPT } from './generated.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';
const DAILY_LIMIT = 50;             // messages a person can send in any 24 hours
const HISTORY_SIZE = 20;            // recent messages sent along so the AI can follow the conversation
const MAX_MESSAGE_LENGTH = 2000;
const MAX_REPLY_LENGTH = 4000;
const AI_TIMEOUT_MS = 25_000;

// Server-side client: the user id always comes from the login token, never from the request
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Only these sites may call the function from a browser (Supabase secret ALLOWED_ORIGINS, comma separated)
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((origin) => origin.trim());

const corsHeaders = (origin: string | null) => ({
    'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
});

const mentionsCrisis = (text: string) => {
    const lower = text.toLowerCase();
    return CRISIS_PHRASES.some((phrase) => lower.includes(phrase));
};

type Role = 'user' | 'assistant';

Deno.serve(async (req) => {
    const cors = corsHeaders(req.headers.get('Origin'));
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    // Logs never include message text
    const serverError = (step: string, error: { message: string }) => {
        console.error(`${step} failed:`, error.message);
        return json({ error: 'server_error' }, 500);
    };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    // 1. Who is asking?
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'not_signed_in' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'not_signed_in' }, 401);
    const userId = auth.user.id;

    // 2. Is the message usable?
    let body: { message?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'bad_request' }, 400);
    }
    if (typeof body.message !== 'string' || !body.message.trim()) return json({ error: 'empty_message' }, 400);
    const text = body.message.trim();
    if (text.length > MAX_MESSAGE_LENGTH) return json({ error: 'too_long' }, 400);

    // 3. Daily limit, counted over the last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await admin
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('role', 'user')
        .gte('created_at', since);
    if (countError) return serverError('Counting messages', countError);
    if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'daily_limit' }, 429);

    const saveMessage = (role: Role, content: string, isSafety = false) =>
        admin.from('chat_messages').insert({ user_id: userId, role, content, is_safety: isSafety }).select('id').single();

    // 4. Safety first: a crisis message gets the fixed reply and never reaches the AI
    if (mentionsCrisis(text)) {
        const saved = await saveMessage('user', text, true);
        if (saved.error) console.error('Saving a safety message failed:', saved.error.message);
        else {
            const reply = await saveMessage('assistant', CRISIS_REPLY, true);
            if (reply.error) console.error('Saving the safety reply failed:', reply.error.message);
        }
        return json({ reply: CRISIS_REPLY, safety: true });
    }

    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) {
        console.error('GROQ_API_KEY is not set');
        return json({ error: 'ai_unavailable' }, 503);
    }

    // 5. Save the message, then gather recent history (without safety messages)
    const saved = await saveMessage('user', text);
    if (saved.error) return serverError('Saving the message', saved.error);

    const { data: recent, error: historyError } = await admin
        .from('chat_messages')
        .select('role, content')
        .eq('user_id', userId)
        .eq('is_safety', false)
        .order('created_at', { ascending: false })
        .limit(HISTORY_SIZE);
    if (historyError) return serverError('Loading history', historyError);

    // 6. Ask the AI
    let reply: string;
    try {
        const response = await fetch(GROQ_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...recent.reverse()],
                temperature: 0.7,
                max_completion_tokens: 1024,
                reasoning_effort: 'low'
            }),
            signal: AbortSignal.timeout(AI_TIMEOUT_MS)
        });
        if (!response.ok) throw new Error(`Groq answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
        const data = await response.json();
        reply = String(data.choices?.[0]?.message?.content ?? '').trim().slice(0, MAX_REPLY_LENGTH);
        if (!reply) throw new Error('Groq returned an empty reply');
    } catch (error) {
        console.error('AI call failed:', error instanceof Error ? error.message : String(error));
        // Take the message back out so trying again doesn't repeat it or use up the daily limit
        await admin.from('chat_messages').delete().eq('id', saved.data.id);
        return json({ error: 'ai_unavailable' }, 503);
    }

    // 7. Save and return the reply (shown as plain text, never as HTML)
    const savedReply = await saveMessage('assistant', reply);
    if (savedReply.error) console.error('Saving the reply failed:', savedReply.error.message);
    return json({ reply, promptVersion: PROMPT_VERSION });
});
