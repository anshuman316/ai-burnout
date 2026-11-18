// Equilibria memory agent: turns one diary entry into a short note the AI chat uses as background.
// The app calls it after a diary entry is saved. Chat notes are written by ai-chat itself.
// Deploy with: npm run ai:deploy
import { createClient } from 'npm:@supabase/supabase-js@2';
import { mentionsCrisis, writeNote } from '../_shared/memory.ts';

const DAILY_LIMIT = 30;  // diary notes a person can get in any 24 hours
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

Deno.serve(async (req) => {
    const cors = corsHeaders(req.headers.get('Origin'));
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    // Logs never include diary text
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

    // 2. Which entry? Only ever one of their own.
    let body: { entryId?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'bad_request' }, 400);
    }
    if (typeof body.entryId !== 'string' || !ID_PATTERN.test(body.entryId)) return json({ error: 'not_found' }, 404);
    const entryId = body.entryId;

    const [entryResult, profileResult] = await Promise.all([
        admin.from('diary_entries').select('id, body, is_private, created_at').eq('id', entryId).eq('user_id', userId).maybeSingle(),
        admin.from('profiles').select('diary_ai_consent').eq('id', userId).maybeSingle()
    ]);
    if (entryResult.error) return serverError('Loading the entry', entryResult.error);
    if (profileResult.error) return serverError('Loading the profile', profileResult.error);
    const entry = entryResult.data;
    if (!entry) return json({ error: 'not_found' }, 404);

    // 3. Privacy: no note without diary consent, for private entries, or for entries that
    //    mention a crisis. Any old note for the entry goes too.
    if (!profileResult.data?.diary_ai_consent || entry.is_private || mentionsCrisis(entry.body)) {
        const { error } = await admin.from('memories').delete().eq('diary_entry_id', entry.id);
        if (error) return serverError('Removing a note', error);
        return json({ remembered: false });
    }

    // 4. Already noted? (Editing the words drops the old note, so this means nothing changed.)
    const { data: existing, error: existingError } = await admin
        .from('memories').select('id').eq('diary_entry_id', entry.id).maybeSingle();
    if (existingError) return serverError('Checking for a note', existingError);
    if (existing) return json({ remembered: true });

    // 5. Daily limit, counted over the last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await admin
        .from('memories')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('source', 'diary')
        .gte('created_at', since);
    if (countError) return serverError('Counting notes', countError);
    if ((count ?? 0) >= DAILY_LIMIT) return json({ error: 'daily_limit' }, 429);

    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) {
        console.error('GROQ_API_KEY is not set');
        return json({ error: 'ai_unavailable' }, 503);
    }

    // 6. Write the note and keep it
    const note = await writeNote(groqKey, entry.body);
    if (!note) return json({ error: 'ai_unavailable' }, 503);
    const { error: saveError } = await admin.from('memories').insert({
        user_id: userId,
        source: 'diary',
        diary_entry_id: entry.id,
        happened_at: entry.created_at,
        ...note
    });
    // 23505: another request noted this entry at the same moment, which is fine
    if (saveError && saveError.code !== '23505') return serverError('Saving the note', saveError);
    return json({ remembered: true });
});
