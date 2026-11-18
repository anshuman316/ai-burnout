import { useCallback, useEffect, useRef, useState } from 'react'
import { openReplyAudio } from '../lib/aiChat'

// Reads Equilibria's replies aloud. Saved replies use Gemini's warm voice (the ai-voice edge
// function), played as it streams in; if that fails, or for text that isn't a saved reply,
// the browser's built-in voice reads it.

const synth = typeof window === 'undefined' ? null : (window.speechSynthesis ?? null);
const AudioContextClass = typeof window === 'undefined' ? null : (window.AudioContext ?? window.webkitAudioContext ?? null);

export const speechOutputSupported = Boolean(synth || AudioContextClass);

// Replies are plain text, but drop stray markdown symbols so they aren't read out
const forSpeaking = (text) => text.replace(/[*_#`>~]+/g, '').replace(/\s+/g, ' ').trim();

// Chrome stops long utterances after about 15 seconds, so speak a sentence or two at a time
const chunks = (text) => (text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]).reduce((parts, sentence) => {
    const last = parts[parts.length - 1];
    if (last && (last + sentence).length < 200) parts[parts.length - 1] = last + sentence;
    else parts.push(sentence);
    return parts;
}, []);

// A clear voice in the person's language; the "natural" and Google voices sound least robotic
const pickVoice = () => {
    const language = (navigator.language || 'en-US').slice(0, 2);
    const voices = synth.getVoices().filter((voice) => voice.lang.startsWith(language));
    return voices.find((voice) => /natural/i.test(voice.name))
        ?? voices.find((voice) => /google/i.test(voice.name))
        ?? voices.find((voice) => voice.default)
        ?? voices[0]
        ?? null;
}

const WATCH_MS = 250;
const START_GRACE_MS = 3000;    // browser voice: if speech hasn't started by then, it never will
const FIRST_SOUND_MS = 5000;    // Gemini voice: no sound by then, so use the browser voice instead
const STALL_MS = 8000;          // Gemini voice: the stream went quiet partway, so end there
const LEAD_S = 0.05;            // a moment of buffer before each piece plays
const BUSY_PAUSE_MS = 10 * 60 * 1000; // after Google says the free allowance is used up, don't ask again for a while

// Until when the Gemini voice is resting (shared by every chat on the page)
let geminiBusyUntil = 0;

// Waits for promise, but gives up after ms
const within = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms / 1000} seconds`)), ms))
]);

// speak(id, text, { messageId, onStart, onDone }) reads a message aloud, stopping anything already
// playing; speakingId says which. With messageId (the saved reply's id) it uses the Gemini voice.
// onStart runs when the sound actually begins; onDone only if it reaches the end, not when stopped.
//
// Chrome sometimes never fires the "finished" event (and can drop utterances it has
// garbage-collected), which left voice mode stuck on "Speaking…". So each reading keeps
// hold of its utterances, and a watchdog checks whether the browser is still talking.
export const useSpeechOutput = () => {

    const [speakingId, setSpeakingId] = useState(null);
    // The reading in progress: { id, onStart, onDone, started, finished, utterances, sources,
    // abort, startedAt, heard, watchdog, endTimer }
    const currentRef = useRef(null);
    // Gemini audio already heard, by message id, so "Play again" doesn't ask again: { sampleRate, pieces }
    const savedRef = useRef(new Map());
    // One audio output for the page (browsers limit how many can be open)
    const contextRef = useRef(null);

    // Ends a reading once, however we find out it's over
    const endReading = useCallback((reading, reachedEnd) => {
        if (reading.finished) return;
        reading.finished = true;
        clearInterval(reading.watchdog);
        clearTimeout(reading.endTimer);
        reading.abort?.abort();
        reading.sources.forEach((source) => {
            try {
                source.stop();
            } catch {
                // never started
            }
        });
        if (currentRef.current === reading) currentRef.current = null;
        setSpeakingId((current) => (current === reading.id ? null : current));
        if (reachedEnd) reading.onDone?.();
    }, []);

    const markStarted = (reading) => {
        if (reading.started) return;
        reading.started = true;
        reading.onStart?.();
    }

    const stop = useCallback(() => {
        if (currentRef.current) endReading(currentRef.current, false);
        synth?.cancel();
        setSpeakingId(null);
    }, [endReading]);

    // The browser's own voice, for a reading that has already begun
    const speakInBrowser = useCallback((reading, text) => {
        const parts = synth ? chunks(forSpeaking(text)) : [];
        // Nothing to say (or no voice at all): still report it done, after the caller has seen the reply
        if (parts.length === 0) {
            markStarted(reading);
            return setTimeout(() => endReading(reading, true), 0);
        }

        reading.startedAt = Date.now();
        const voice = pickVoice();
        parts.forEach((part, i) => {
            const utterance = new SpeechSynthesisUtterance(part);
            if (voice) utterance.voice = voice;
            utterance.lang = voice?.lang ?? navigator.language;
            utterance.rate = 0.95; // a little slower than default: calmer
            utterance.onstart = () => {
                reading.heard = true;
                markStarted(reading);
            };
            if (i === parts.length - 1) {
                utterance.onend = () => endReading(reading, true);
                // Stopped on purpose: not the end. Any other failure: carry on as if it finished.
                utterance.onerror = (event) => endReading(reading, event.error !== 'interrupted' && event.error !== 'canceled');
            }
            reading.utterances.push(utterance); // keeps Chrome from throwing them away mid-speech
            synth.speak(utterance);
        });

        reading.watchdog = setInterval(() => {
            if (synth.speaking || synth.pending) {
                reading.heard = true;
                markStarted(reading);
                return;
            }
            // Quiet now: it finished without telling us, or it never started
            if (reading.heard || Date.now() - reading.startedAt > START_GRACE_MS) {
                markStarted(reading);
                endReading(reading, true);
            }
        }, WATCH_MS);
    }, [endReading]);

    // Gemini's voice, played piece by piece as it arrives. Any problem before the first sound
    // hands over to the browser's voice; a problem partway through just ends it there.
    const playReplyAudio = useCallback(async (reading, text, messageId) => {
        const fallBack = (error) => {
            if (reading.finished) return;
            if (/voice_busy/.test(error?.message)) geminiBusyUntil = Date.now() + BUSY_PAUSE_MS;
            reading.abort?.abort();
            if (reading.sources.length > 0) return finishAfterQueue();
            console.warn('Using the browser voice instead:', error?.message ?? error);
            speakInBrowser(reading, text);
        }

        let context;
        let nextTime = 0;
        const play = (sampleRate, samples) => {
            const buffer = context.createBuffer(1, samples.length, sampleRate);
            const floats = buffer.getChannelData(0);
            for (let i = 0; i < samples.length; i += 1) floats[i] = samples[i] / 32768;
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            nextTime = Math.max(nextTime, context.currentTime + LEAD_S);
            source.start(nextTime);
            nextTime += buffer.duration;
            reading.sources.push(source);
            markStarted(reading);
        }
        // Ends the reading when everything queued has been heard (a timer, which can't get lost)
        const finishAfterQueue = () => {
            const left = Math.max(0, nextTime - context.currentTime);
            reading.endTimer = setTimeout(() => endReading(reading, true), left * 1000 + 150);
        }

        try {
            if (!AudioContextClass) throw new Error('this browser can’t play streamed audio');
            context = contextRef.current ??= new AudioContextClass();
            await within(context.resume(), 1000);
            if (context.state !== 'running') throw new Error('the browser blocked the sound');

            // Heard before: play it again from memory
            const saved = savedRef.current.get(messageId);
            if (saved) {
                saved.pieces.forEach((samples) => play(saved.sampleRate, samples));
                return finishAfterQueue();
            }

            reading.abort = new AbortController();
            const { sampleRate, reader } = await within(openReplyAudio(messageId, reading.abort.signal), FIRST_SOUND_MS);
            const pieces = [];
            let leftover = null; // audio samples are 2 bytes; a piece can end halfway through one
            for (;;) {
                const { done, value } = await within(reader.read(), reading.sources.length > 0 ? STALL_MS : FIRST_SOUND_MS);
                if (reading.finished) return;
                if (done) break;
                let bytes = value;
                if (leftover) {
                    bytes = new Uint8Array(leftover.length + value.length);
                    bytes.set(leftover);
                    bytes.set(value, leftover.length);
                }
                const whole = bytes.length - (bytes.length % 2);
                leftover = whole < bytes.length ? bytes.slice(whole) : null;
                if (whole === 0) continue;
                const samples = new Int16Array(bytes.slice(0, whole).buffer);
                pieces.push(samples);
                play(sampleRate, samples);
            }
            if (pieces.length === 0) throw new Error('no audio came back');
            savedRef.current.set(messageId, { sampleRate, pieces });
            finishAfterQueue();
        } catch (error) {
            if (error.name === 'AbortError' && reading.finished) return;
            fallBack(error);
        }
    }, [endReading, speakInBrowser]);

    const speak = useCallback((id, text, { messageId, onStart, onDone } = {}) => {
        if (currentRef.current) endReading(currentRef.current, false);
        synth?.cancel();
        const reading = {
            id, onStart, onDone, started: false, finished: false, utterances: [], sources: [],
            abort: null, startedAt: Date.now(), heard: false, watchdog: null, endTimer: null
        };
        currentRef.current = reading;
        setSpeakingId(id);
        // The Gemini voice for a saved reply: heard before (it plays from memory), or Google isn't resting
        if (messageId && (savedRef.current.has(messageId) || Date.now() > geminiBusyUntil)) playReplyAudio(reading, text, messageId);
        else speakInBrowser(reading, text);
    }, [endReading, playReplyAudio, speakInBrowser]);

    // Browsers only let a page start sound right after a tap or click. Voice mode is spoken, not
    // tapped, so the sound is switched on when the person taps the mic, and stays on after that.
    const unlock = useCallback(() => {
        if (!AudioContextClass) return;
        contextRef.current ??= new AudioContextClass();
        contextRef.current.resume().catch(() => {});
    }, []);

    // Leaving the page stops the voice and closes the audio output
    useEffect(() => () => {
        if (currentRef.current) endReading(currentRef.current, false);
        synth?.cancel();
        contextRef.current?.close();
        contextRef.current = null;
    }, [endReading]);

    return { speakingId, speak, stop, unlock };
}
