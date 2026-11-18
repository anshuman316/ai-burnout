// Equilibria's voice: reads one of Equilibria's chat replies aloud with Google's Gemini speech model.
// Runs on Supabase so the Gemini key stays secret. It only reads replies the chat has just written
// for this person, so it can't be used to speak anything else. The app falls back to the browser's
// own voice if this fails.
// Deploy with: npm run ai:deploy
import { createClient } from 'npm:@supabase/supabase-js@2';

// Streamed, so the app can start playing the first words while the rest is still being made.
// Each model has its own free allowance, so when the first is used up the lite one takes over.
const MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
const geminiUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
// Change the voice here. Sulafat is Google's "warm" voice; Achernar ("soft") also suits Equilibria.
const VOICE = 'Sulafat';
const STYLE = 'Warm, gentle and calm, like a caring friend sitting beside them. Unhurried, soft and kind, with natural pauses. Never cheerful on command, never like an announcer.';
const REPLY_MAX_AGE_MS = 60 * 60 * 1000;  // only recent replies can be read aloud
const VOICE_TIMEOUT_MS = 60_000;     // for the whole stream
// Gemini's streamed audio: 24 kHz, mono, 16-bit
const SAMPLE_RATE = 24000;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server-side client: the user id always comes from the login token, never from the request
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Only these sites may call the function from a browser (Supabase secret ALLOWED_ORIGINS, comma separated)
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((origin) => origin.trim());

const corsHeaders = (origin: string | null) => ({
    'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Sample-Rate',
    'Vary': 'Origin'
});

// Replies are plain text, but drop stray markdown symbols so they aren't read out
const forSpeaking = (text: string) => text.replace(/[*_#`>~]+/g, '').replace(/\s+/g, ' ').trim();

// Gemini sends the voice as base64 pieces of raw audio inside a stream of "data: {...}" lines.
// This turns that into a plain stream of audio bytes the app can start playing straight away.
const audioPieces = (events: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let buffered = '';
    return events.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            buffered += decoder.decode(chunk, { stream: true });
            const lines = buffered.split('\n');
            buffered = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.startsWith('data:')) continue;
                try {
                    const event = JSON.parse(line.slice(5));
                    for (const part of event.candidates?.[0]?.content?.parts ?? []) {
                        if (part.inlineData?.data) controller.enqueue(Uint8Array.from(atob(part.inlineData.data), (char) => char.charCodeAt(0)));
                    }
                } catch {
                    console.error('Voice: skipped a piece Gemini sent that could not be read');
                }
            }
        }
    }));
};

Deno.serve(async (req) => {
    const cors = corsHeaders(req.headers.get('Origin'));
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    // 1. Who is asking?
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'not_signed_in' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'not_signed_in' }, 401);

    // 2. Which reply? Only a recent one Equilibria wrote for this person.
    let body: { messageId?: unknown };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'bad_request' }, 400);
    }
    if (typeof body.messageId !== 'string' || !ID_PATTERN.test(body.messageId)) return json({ error: 'not_found' }, 404);
    const { data: message, error: messageError } = await admin
        .from('chat_messages')
        .select('content, created_at')
        .eq('id', body.messageId)
        .eq('user_id', auth.user.id)
        .eq('role', 'assistant')
        .maybeSingle();
    if (messageError) {
        console.error('Loading the reply failed:', messageError.message);
        return json({ error: 'server_error' }, 500);
    }
    if (!message || Date.now() - new Date(message.created_at).getTime() > REPLY_MAX_AGE_MS) return json({ error: 'not_found' }, 404);

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
        console.error('GEMINI_API_KEY is not set');
        return json({ error: 'voice_unavailable' }, 503);
    }

    // 3. Ask Gemini to read it, and pass the audio on as it arrives: raw 16-bit mono PCM,
    //    at the rate in the X-Sample-Rate header. Logs never include the text.
    try {
        const ask = (model: string) => fetch(geminiUrl(model), {
            method: 'POST',
            headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: forSpeaking(message.content), speech_metadata: { style: STYLE } }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { voice: VOICE } }
                }
            }),
            signal: AbortSignal.timeout(VOICE_TIMEOUT_MS)
        });
        let response = await ask(MODELS[0]);
        for (const model of MODELS.slice(1)) {
            if (response.status !== 429) break;
            await response.body?.cancel();
            response = await ask(model);
        }
        // 429: the free allowance is used up for now, on every model
        if (response.status === 429) return json({ error: 'voice_busy' }, 429);
        if (!response.ok || !response.body) throw new Error(`Gemini answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
        return new Response(audioPieces(response.body), {
            headers: { ...cors, 'Content-Type': 'application/octet-stream', 'X-Sample-Rate': String(SAMPLE_RATE) }
        });
    } catch (error) {
        console.error('Voice failed:', error instanceof Error ? error.message : String(error));
        return json({ error: 'voice_unavailable' }, 503);
    }
});
