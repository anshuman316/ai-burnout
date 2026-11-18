import { useCallback, useEffect, useRef, useState } from 'react'

// Text to speech with the browser's built-in voices (every modern browser). Free, no key.

const synth = typeof window === 'undefined' ? null : (window.speechSynthesis ?? null);

export const speechOutputSupported = Boolean(synth);

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
const START_GRACE_MS = 3000; // if speech hasn't started by then, it never will

// speak(id, text, onDone) reads a message aloud (stopping anything already playing); speakingId says which.
// onDone runs only if it reaches the end, not when it is stopped.
//
// Chrome sometimes never fires the "finished" event (and can drop utterances it has
// garbage-collected), which left voice mode stuck on "Speaking…". So each reading keeps
// hold of its utterances, and a watchdog checks whether the browser is still talking.
export const useSpeechOutput = () => {

    const [speakingId, setSpeakingId] = useState(null);
    // The reading in progress: { id, onDone, utterances, startedAt, heard, finished, watchdog }
    const currentRef = useRef(null);

    // Ends a reading once, however we find out it's over
    const endReading = useCallback((reading, reachedEnd) => {
        if (reading.finished) return;
        reading.finished = true;
        clearInterval(reading.watchdog);
        if (currentRef.current === reading) currentRef.current = null;
        setSpeakingId((current) => (current === reading.id ? null : current));
        if (reachedEnd) reading.onDone?.();
    }, []);

    const stop = useCallback(() => {
        if (currentRef.current) endReading(currentRef.current, false);
        synth?.cancel();
        setSpeakingId(null);
    }, [endReading]);

    const speak = useCallback((id, text, onDone) => {
        if (!synth) return;
        if (currentRef.current) endReading(currentRef.current, false);
        synth.cancel();
        const parts = chunks(forSpeaking(text));
        // Nothing to say: still report it done, after the caller has seen the reply
        if (parts.length === 0) return setTimeout(() => onDone?.(), 0);

        const reading = { id, onDone, utterances: [], startedAt: Date.now(), heard: false, finished: false, watchdog: null };
        currentRef.current = reading;
        const voice = pickVoice();
        parts.forEach((part, i) => {
            const utterance = new SpeechSynthesisUtterance(part);
            if (voice) utterance.voice = voice;
            utterance.lang = voice?.lang ?? navigator.language;
            utterance.rate = 0.95; // a little slower than default: calmer
            utterance.onstart = () => { reading.heard = true; };
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
                return;
            }
            // Quiet now: it finished without telling us, or it never started
            if (reading.heard || Date.now() - reading.startedAt > START_GRACE_MS) endReading(reading, true);
        }, WATCH_MS);
        setSpeakingId(id);
    }, [endReading]);

    // Leaving the page stops the voice
    useEffect(() => () => {
        if (currentRef.current) endReading(currentRef.current, false);
        synth?.cancel();
    }, [endReading]);

    return { speakingId, speak, stop };
}
