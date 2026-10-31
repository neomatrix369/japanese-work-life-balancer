/**
 * Ties a Narrator to the tour: speaks each step's line on entry (and the "Finished: …"
 * part once a solve settles), prefetches the next line, follows Pause / Exit, and owns the
 * mute toggle ("M" key). useTour waits on `spoken()` before it auto-advances.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NarrationCtx, TourStep } from './steps';
import { unspokenTail, type Narrator } from './voice';
import { useVoiceProvider, type VoiceProviderState } from './useVoiceProvider';

export interface TourVoice {
  muted: boolean;
  toggleMute: () => void;
  /** true when the line was read by the browser's own voice (premium voice unavailable) */
  browserVoice: boolean;
  /** ElevenLabs voice ID the server is using (null while loading or when unavailable) */
  voiceId: string | null;
  /** which provider speaks (ElevenLabs / Gemini / Gemini Argon / browser) and its setter */
  voiceProvider: VoiceProviderState;
  /** resolves when the current step's line has been spoken (or skipped / stopped) */
  spoken: () => Promise<void>;
}

/** Pause after a spoken line before the tour moves on. */
export const SPEECH_TAIL_MS = 600;

/** True while the step's solve has not produced its result yet (from the very first render). */
export function isSolving(step: TourStep, ctx: NarrationCtx): boolean {
  return !!(step.solve && !ctx.results[step.solve]);
}

/**
 * What a step says. While its solve runs we leave out the live numbers (on entry they still
 * belong to the previous plan); the final numbers are said once the solve settles.
 */
export function spokenLine(step: TourStep, ctx: NarrationCtx): string {
  return isSolving(step, ctx)
    ? step.text({ ...ctx, running: true, current: null })
    : step.text({ ...ctx, running: false });
}

/** The line the next step will say on entry (for prefetching). */
export function nextLine(steps: TourStep[], index: number, ctx: NarrationCtx): string | null {
  const s = steps[index + 1];
  return s ? spokenLine(s, ctx) : null;
}

interface VoiceState {
  active: boolean;
  index: number;
  paused: boolean;
  steps: TourStep[];
  ctx: NarrationCtx;
}

export function useTourVoice(narrator: Narrator, { active, index, paused, steps, ctx }: VoiceState): TourVoice {
  const running = isSolving(steps[index], ctx);
  const lineRef = useRef('');
  lineRef.current = spokenLine(steps[index], ctx);
  const upcoming = nextLine(steps, index, ctx);
  const upcomingRef = useRef(upcoming);
  upcomingRef.current = upcoming;

  const speechRef = useRef<Promise<void>>(Promise.resolve());
  const saidRef = useRef<{ index: number; line: string; running: boolean } | null>(null);
  const [muted, setMuted] = useState(() => narrator.isMuted());
  const [kind, setKind] = useState(() => narrator.voice());
  const [voiceId, setVoiceId] = useState(() => narrator.voiceId());

  useEffect(() => narrator.subscribe(() => {
    setKind(narrator.voice());
    setVoiceId(narrator.voiceId());
  }), [narrator]);

  // Speak on step entry, and say the rest once a solve settles.
  useEffect(() => {
    if (!active) {
      if (saidRef.current) narrator.stop();
      saidRef.current = null;
      speechRef.current = Promise.resolve();
      return;
    }
    const said = saidRef.current;
    const line = lineRef.current;
    const sameStep = said?.index === index;
    // same step: only a solve that just settled has something new to say
    if (sameStep && (running || !said.running)) return;
    const toSay = sameStep ? unspokenTail(said.line, line) : line;
    saidRef.current = { index, line, running };
    const after = sameStep ? speechRef.current : Promise.resolve();
    speechRef.current = after.then(() =>
      saidRef.current?.index === index && toSay ? narrator.speak(toSay) : undefined,
    );
  }, [active, index, running, narrator]);

  useEffect(() => {
    if (active && !running && upcomingRef.current) narrator.prefetch(upcomingRef.current);
  }, [active, index, running, narrator]);

  useEffect(() => {
    if (!active) return;
    if (paused) narrator.pause();
    else narrator.resume();
  }, [active, paused, narrator]);

  useEffect(() => () => narrator.stop(), [narrator]);

  const toggleMute = useCallback(() => {
    const next = !narrator.isMuted();
    narrator.setMuted(next);
    setMuted(next);
  }, [narrator]);

  // Keyboard: M toggles mute while the tour is open.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, toggleMute]);

  const spoken = useCallback(() => speechRef.current, []);
  const voiceProvider = useVoiceProvider(narrator);

  return { muted, toggleMute, browserVoice: kind === 'browser' && !muted, voiceId, voiceProvider, spoken };
}
