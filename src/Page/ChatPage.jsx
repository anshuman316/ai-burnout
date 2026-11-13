import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import RequireAuth from '../components/RequireAuth'
import { useAuth } from '../context/AuthContext'
import { CHAT_DAILY_LIMIT, listChatMessages, sendChatMessage } from '../lib/aiChat'

const MAX_LENGTH = 2000;

const STARTERS = [
    'I’m feeling overwhelmed',
    'I just need to vent',
    'Help me take a small break'
];

const ERROR_MESSAGES = {
    daily_limit: `That’s ${CHAT_DAILY_LIMIT} messages for today. Rest, and we can talk again tomorrow.`,
    ai_unavailable: 'Equilibria couldn’t answer just now. Your message is still in the box, so try again in a moment.',
    too_long: 'That’s a lot for one message. Try splitting it in two.',
    not_signed_in: 'Your login has expired. Please log in again.'
};
const FALLBACK_ERROR = 'Couldn’t reach Equilibria. Check your connection and try again.';

// The fixed crisis reply, with one-tap ways to reach 988
const SafetyReply = ({ content }) => (
    <div className="max-w-[85%] rounded-[20px] rounded-bl-md bg-mint border border-leaf/30 p-4 flex flex-col gap-3">
        <p className="text-[15px] leading-relaxed text-heading whitespace-pre-wrap">{content}</p>
        <div className="flex flex-wrap gap-2">
            <a href="tel:988" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white border border-hairline text-[14px] font-medium text-forest hover:border-leaf">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">call</span>
                Call 988
            </a>
            <a href="sms:988" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white border border-hairline text-[14px] font-medium text-forest hover:border-leaf">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">sms</span>
                Text 988
            </a>
        </div>
    </div>
)

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A new reply writes itself in, word by word, finishing in about two seconds whatever its length.
// Screen readers get the whole reply at once; reduced-motion users see it immediately.
const RevealText = ({ text, onProgress }) => {

    // Words and the spaces between them, so line breaks survive
    const tokens = useMemo(() => text.split(/(\s+)/), [text]);
    const [shown, setShown] = useState(() => (prefersReducedMotion() ? tokens.length : 0));

    useEffect(() => {
        if (shown >= tokens.length) return;
        const delay = Math.min(45, Math.max(12, 2200 / tokens.length));
        const timer = setTimeout(() => setShown((n) => Math.min(tokens.length, n + 2)), delay);
        return () => clearTimeout(timer);
    }, [shown, tokens.length]);

    useEffect(() => {
        onProgress();
    }, [shown, onProgress]);

    return (
        <>
            <span className="sr-only">{text}</span>
            <span aria-hidden="true">
                {tokens.slice(0, shown).map((token, i) => (/^\s+$/.test(token)
                    ? <Fragment key={i}>{token}</Fragment>
                    : <span key={i} className="inline-block animate-word-in">{token}</span>))}
            </span>
        </>
    )
}

// Three softly bouncing dots in a reply bubble while Equilibria thinks
const TypingIndicator = () => (
    <div role="status" className="flex animate-fade-in">
        <span className="sr-only">Equilibria is thinking…</span>
        <span className="px-4 py-4 rounded-[20px] rounded-bl-md bg-white border border-hairline flex items-center gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
                <span key={i} className="w-2 h-2 rounded-full bg-leaf animate-typing-dot" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
        </span>
    </div>
)

// Replies are always rendered as plain text, never as HTML.
// fresh: added during this visit (slides in; replies write themselves in)
const Message = ({ message, onProgress }) => {
    if (message.role === 'assistant' && message.isSafety) {
        return <li className={`flex ${message.fresh ? 'animate-fade-in' : ''}`}><SafetyReply content={message.content} /></li>;
    }
    const mine = message.role === 'user';
    return (
        <li className={`flex ${mine ? 'justify-end' : ''} ${message.fresh ? 'animate-fade-in' : ''}`}>
            <p className={`max-w-[85%] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap break-words ${mine
                ? 'rounded-[20px] rounded-br-md bg-mint text-heading'
                : 'rounded-[20px] rounded-bl-md bg-white border border-hairline text-heading'}`}>
                <span className="sr-only">{mine ? 'You: ' : 'Equilibria: '}</span>
                {message.fresh && !mine ? <RevealText text={message.content} onProgress={onProgress} /> : message.content}
            </p>
        </li>
    )
}

const Chat = () => {

    const { session } = useAuth();
    const userId = session.user.id;
    // History for this user: { userId, status: 'ready' | 'error', messages }
    const [history, setHistory] = useState({ userId: null });
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [notice, setNotice] = useState(null);
    const endRef = useRef(null);
    const inputRef = useRef(null);
    // Numbers messages added on screen before they come back from the server
    const localIdRef = useRef(0);

    useEffect(() => {
        let cancelled = false;
        listChatMessages()
            .then((messages) => {
                if (!cancelled) setHistory({ userId, status: 'ready', messages });
            })
            .catch((error) => {
                console.error('Loading the chat failed:', error.message);
                if (!cancelled) setHistory({ userId, status: 'error', messages: [] });
            });
        return () => { cancelled = true; };
    }, [userId]);

    const status = history.userId === userId ? history.status : 'loading';
    const messages = history.messages ?? [];

    // Keep the newest message in view
    useEffect(() => {
        endRef.current?.scrollIntoView({ block: 'end' });
    }, [messages.length, sending]);

    // Grow the writing box with its text, up to a limit
    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
    }, [draft]);

    // Keeps the newest words in view while a reply writes itself in
    const scrollToEnd = useCallback(() => endRef.current?.scrollIntoView({ block: 'end' }), []);

    const addMessage = (message) => setHistory((prev) => ({ ...prev, messages: [...prev.messages, message] }));

    const send = async (text) => {
        const message = text.trim();
        if (!message || sending) return;
        localIdRef.current += 1;
        const pendingId = `pending-${localIdRef.current}`;
        setNotice(null);
        setDraft('');
        setSending(true);
        addMessage({ id: pendingId, role: 'user', content: message, fresh: true });
        try {
            const { reply, safety } = await sendChatMessage(message);
            addMessage({ id: `reply-${localIdRef.current}`, role: 'assistant', content: reply, isSafety: safety, fresh: true });
        } catch (error) {
            console.error(error.message);
            // Take the message back so it can be sent again
            setHistory((prev) => ({ ...prev, messages: prev.messages.filter((m) => m.id !== pendingId) }));
            if (error.code !== 'daily_limit') setDraft(message);
            setNotice(ERROR_MESSAGES[error.code] ?? FALLBACK_ERROR);
        } finally {
            setSending(false);
            inputRef.current?.focus();
        }
    }

    const handleSubmit = (e) => {
        e.preventDefault();
        send(draft);
    }

    // Enter sends; Shift+Enter starts a new line
    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(draft);
        }
    }

    return (
        <div className="bg-canvas text-heading font-body h-[calc(100svh-8rem)] md:h-[calc(100svh-4rem)] flex flex-col">
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-4 md:px-8 py-6 flex flex-col gap-4">
                    <h1 className="sr-only">Chat with Equilibria</h1>

                    {status === 'loading' && <p role="status" className="text-[15px] text-body">Opening your conversation…</p>}
                    {status === 'error' && <p role="alert" className="text-[15px] text-heading">We couldn’t load your conversation. Check your connection and refresh the page.</p>}

                    {status === 'ready' && messages.length === 0 && (
                        <div className="py-8 text-center flex flex-col items-center gap-3 animate-fade-in">
                            <img src="/logo.png" alt="" className="w-16 h-16" />
                            <h2 className="font-headline text-[24px] font-semibold tracking-[-0.02em]">Hi. What’s on your mind?</h2>
                            <p className="text-[15px] text-body max-w-sm">Say as much or as little as you like. There’s no right way to start.</p>
                            <div className="mt-2 flex flex-wrap justify-center gap-2">
                                {STARTERS.map((starter) => (
                                    <button key={starter} type="button" onClick={() => send(starter)} disabled={sending} className="px-4 py-2 rounded-full bg-white border border-hairline text-[14px] text-heading hover:border-leaf transition-colors disabled:opacity-60">
                                        {starter}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {status === 'ready' && messages.length > 0 && (
                        <ul role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-3">
                            {messages.map((message) => <Message key={message.id} message={message} onProgress={scrollToEnd} />)}
                        </ul>
                    )}

                    {sending && <TypingIndicator />}
                    <div ref={endRef} />
                </div>
            </div>

            <div className="border-t border-hairline bg-white">
                <div className="max-w-2xl mx-auto px-4 md:px-8 py-3 flex flex-col gap-2">
                    {notice && (
                        <p role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-sun/15 text-[14px] text-heading">
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">info</span>
                            {notice}
                        </p>
                    )}
                    <form onSubmit={handleSubmit} className="flex items-end gap-2">
                        <label htmlFor="chat-input" className="sr-only">Message Equilibria</label>
                        <textarea
                            id="chat-input"
                            ref={inputRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={handleKeyDown}
                            maxLength={MAX_LENGTH}
                            rows={1}
                            placeholder="Write how you’re feeling…"
                            disabled={status !== 'ready'}
                            className="flex-1 min-w-0 resize-none px-4 py-3 rounded-2xl bg-canvas border border-hairline text-[15px] leading-relaxed text-heading placeholder:text-body/70 focus:outline-none focus:border-leaf focus:ring-3 focus:ring-leaf/15 disabled:opacity-60"
                        />
                        <button
                            type="submit"
                            disabled={sending || !draft.trim() || status !== 'ready'}
                            aria-label="Send"
                            className="w-12 h-12 shrink-0 rounded-2xl bg-forest text-white flex items-center justify-center hover:bg-forest/90 transition-colors disabled:opacity-50"
                        >
                            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">arrow_upward</span>
                        </button>
                    </form>
                    <p className="text-center text-[12px] text-body">Equilibria is an AI, not a therapist. In crisis? Call or text 988.</p>
                </div>
            </div>
        </div>
    )
}

const ChatPage = () => (
    <RequireAuth>
        <Chat />
    </RequireAuth>
)

export default ChatPage
