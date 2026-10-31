/**
 * Author: Japanese Work-Life Balancer team
 * Created: 2026-10-29
 * Scope: tour voice narration — toSpeech text clean-up, the narrator's premium/browser-voice
 *        fallback and mute (tour/voice.ts), the tour waiting for the spoken line before it
 *        auto-advances (useTour + useTourVoice), and the 🔊/🔇 control in TourOverlay.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { TourOverlay } from '../components/TourOverlay';
import type { TourStep } from '../tour/steps';
import { useTour, type TourController } from '../tour/useTour';
import {
  MUTE_STORAGE_KEY,
  PROVIDER_STORAGE_KEY,
  SILENT_NARRATOR,
  createNarrator,
  pickVoice,
  toSpeech,
  unspokenTail,
  type Narrator,
  type NarratorDeps,
  type ProviderOption,
} from '../tour/voice';
import type { VoiceProviderState } from '../tour/useVoiceProvider';

const PROVIDERS: ProviderOption[] = [
  { id: 'elevenlabs', label: 'ElevenLabs', voice: 'Lily', configured: true },
  { id: 'gemini', label: 'Gemini', voice: 'Aoede', configured: false },
  { id: 'browser', label: 'Browser voice', voice: null, configured: true },
];
const providerState = (over: Partial<VoiceProviderState> = {}): VoiceProviderState => ({
  provider: 'elevenlabs',
  selected: 'elevenlabs',
  providers: PROVIDERS,
  setProvider: vi.fn(),
  select: vi.fn(),
  ...over,
});

// ── Fakes ───────────────────────────────────────────────────────────────────

interface FakeUtterance {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoice | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function fakeSpeech() {
  const spoken: FakeUtterance[] = [];
  return {
    spoken,
    speak: vi.fn((u: SpeechSynthesisUtterance) => {
      spoken.push(u as unknown as FakeUtterance);
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () =>
      [
        { name: 'Alex', lang: 'en-US' },
        { name: 'Daniel', lang: 'en-GB' },
        { name: 'Serena', lang: 'en-GB' },
      ] as SpeechSynthesisVoice[],
    /** finish the latest utterance */
    end: () => spoken.at(-1)?.onend?.(),
  };
}

function fakeAudio() {
  return {
    src: '',
    muted: false,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    onended: null as ((ev: Event) => void) | null,
    onerror: null as ((ev: Event | string) => void) | null,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

const audioResponse = () => ({
  ok: true,
  headers: new Headers({ 'content-type': 'audio/mpeg' }),
  blob: async () => new Blob(['mp3']),
});
const errorResponse = (status: number) => ({
  ok: false,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  blob: async () => new Blob(['{}']),
});

function narratorWith(fetchImpl: NarratorDeps['fetch'], extra: Partial<NarratorDeps> = {}) {
  const speech = fakeSpeech();
  const audio = fakeAudio();
  const storage = memoryStorage();
  // Route GET /tts (voiceId init) to a silent no-op so the spy only sees POST calls.
  const fetch: NarratorDeps['fetch'] = fetchImpl
    ? (url, init) =>
        (init as RequestInit & { method?: string }).method === 'GET'
          ? Promise.resolve({ ok: false, headers: new Headers(), blob: async () => new Blob() })
          : fetchImpl(url, init)
    : null;
  const narrator = createNarrator({
    fetch,
    createAudio: () => audio,
    speech,
    makeUtterance: (text) =>
      ({ text, lang: '', voice: null, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
    storage,
    createObjectURL: () => 'blob:tts-1',
    ...extra,
  });
  return { narrator, speech, audio, storage };
}

/** let pending promise callbacks run */
const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

// ── toSpeech ────────────────────────────────────────────────────────────────

describe('toSpeech', () => {
  it.each([
    ['At-risk employees: 29 → 24.', 'At-risk employees: 29 to 24.'],
    ['Labor cost ¥1,234,567.', 'Labor cost 1,234,567 yen.'],
    ['Extra labor cost: +¥12,000 (£62), +3.4%.', 'Extra labor cost: plus 12,000 yen (62 pounds), plus 3.4 percent.'],
    ['Healthy share: 40% → 72%.', 'Healthy share: 40 percent to 72 percent.'],
    ['Cost went down (−2.1%).', 'Cost went down (minus 2.1 percent).'],
    ['Sato-san works 8 h today — day 3 in a row.', 'Sato-san works 8 hours today, day 3 in a row.'],
    ['Every 2 s the solver finds a better plan.', 'Every 2 seconds the solver finds a better plan.'],
    ['3 of them are on day 3+ of a run.', '3 of them are on day 3 or more of a run.'],
    ['reasons: 4 × “no qualified person”.', 'reasons: 4 for no qualified person.'],
    ['score 0hard/-2medium/-310soft.', 'score 0 hard, -2 medium, -310 soft.'],
    ['Waiting for the first plan…', 'Waiting for the first plan.'],
    ['It costs £1.', 'It costs 1 pound.'],
    ['labor cost ¥2,033,008, 0 hard-rule breaks.', 'labor cost 2,033,008 yen, 0 hard-rule breaks.'],
    ['Amber = 3rd day in a row.', 'Amber is 3rd day in a row.'],
  ])('reads %j as %j', (input, expected) => {
    /**
     * Scenario: callout text is written for the eye; the voice needs words.
     * Slice: voice narration — text clean-up.
     * Given a callout sentence, when converted, then symbols become spoken words.
     */
    // -- Given / When / Then --
    expect(toSpeech(input)).toBe(expected);
  });

  it('says only the new part once a solve finishes', () => {
    /**
     * Scenario: a solve step was introduced while solving; now the result is in.
     * Slice: voice narration — no repeats.
     * Given the line said on entry and the final line, when we diff them, then only the
     * sentences after the shared intro are said.
     */
    // -- Given --
    const entry = 'We ask for the cheapest plan. Every 2 s the solver finds a better plan. Waiting…';
    const done = 'We ask for the cheapest plan. Finished: 29 of 40 people at risk.';
    // -- When / Then --
    expect(unspokenTail(entry, done)).toBe('Finished: 29 of 40 people at risk.');
    expect(unspokenTail(done, done)).toBe('');
  });
});

// ── Narrator ────────────────────────────────────────────────────────────────

describe('createNarrator', () => {
  it('plays the server voice when /tts returns audio', async () => {
    /**
     * Scenario: the ElevenLabs key works.
     * Slice: voice narration — premium voice.
     * Given /tts answers with audio/mpeg, when a line is spoken, then the audio element
     * plays the clip, the browser voice is not used, and speak() resolves on "ended".
     */
    // -- Given --
    const fetch = vi.fn(async () => audioResponse());
    const { narrator, speech, audio } = narratorWith(fetch);
    // -- When --
    let done = false;
    const p = narrator.speak('Labor cost ¥1,000.').then(() => (done = true));
    await flush();
    // -- Then --
    expect(fetch).toHaveBeenCalledWith('/tts', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      text: 'Labor cost 1,000 yen.',
    });
    expect(audio.src).toBe('blob:tts-1');
    expect(audio.play).toHaveBeenCalled();
    expect(narrator.voice()).toBe('premium');
    expect(done).toBe(false);
    audio.onended?.(new Event('ended'));
    await p;
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it.each([
    ['the request fails', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the server answers 502 (missing permissions)', async () => errorResponse(502)],
  ])('falls back to the browser voice when %s', async (_label, impl) => {
    /**
     * Scenario: the key lacks text_to_speech permission, or the route is missing.
     * Slice: voice narration — fallback.
     * Given /tts fails, when a line is spoken, then speechSynthesis says it with a female
     * en-GB voice and speak() resolves when that utterance ends.
     */
    // -- Given --
    const { narrator, speech } = narratorWith(vi.fn(impl) as unknown as NarratorDeps['fetch']);
    // -- When --
    let done = false;
    const p = narrator.speak('Hard rules are never broken.').then(() => (done = true));
    await flush();
    // -- Then --
    expect(speech.spoken).toHaveLength(1);
    expect(speech.spoken[0].text).toBe('Hard rules are never broken.');
    expect(speech.spoken[0].voice?.name).toBe('Serena');
    expect(narrator.voice()).toBe('browser');
    expect(done).toBe(false);
    speech.end();
    await p;
    expect(done).toBe(true);
  });

  it('falls back to the browser voice when /tts takes longer than 4 s', async () => {
    /**
     * Scenario: the premium voice is slow on conference Wi-Fi.
     * Slice: voice narration — fallback.
     * Given /tts never answers, when 4 s pass, then the browser voice reads the line.
     */
    vi.useFakeTimers();
    try {
      // -- Given --
      const { narrator, speech } = narratorWith(vi.fn(() => new Promise(() => undefined)) as never);
      // -- When --
      void narrator.speak('Slow line.');
      await act(async () => vi.advanceTimersByTimeAsync(3900));
      const before = speech.spoken.length;
      await act(async () => vi.advanceTimersByTimeAsync(200));
      // -- Then --
      expect(before).toBe(0);
      expect(speech.spoken.map((u) => u.text)).toEqual(['Slow line.']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mute stops the current line, stays silent, and is remembered', async () => {
    /**
     * Scenario: the presenter presses mute mid-sentence.
     * Slice: voice narration — mute.
     * Given a line playing, when muted, then audio pauses, speak() resolves, later lines
     * are silent, the choice is stored, and a new narrator starts muted.
     */
    // -- Given --
    const fetch = vi.fn(async () => audioResponse());
    const { narrator, audio, storage } = narratorWith(fetch);
    const p = narrator.speak('First line.');
    await flush();
    // -- When --
    narrator.setMuted(true);
    await p;
    await narrator.speak('Second line.');
    // -- Then --
    expect(audio.pause).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(storage.data[MUTE_STORAGE_KEY]).toBe('1');
    expect(narrator.isMuted()).toBe(true);
    expect(createNarrator({ storage, speech: null, fetch: null }).isMuted()).toBe(true);
  });

  it('prefers a female British voice, then any British, then any English', () => {
    /**
     * Scenario: browsers ship different voice lists.
     * Slice: voice narration — fallback voice choice.
     * Given several voice lists, when we pick, then Serena/Google UK Female win, else en-GB, else en.
     */
    const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
    expect(pickVoice([v('Daniel', 'en-GB'), v('Google UK English Female', 'en-GB')])?.name).toBe(
      'Google UK English Female',
    );
    expect(pickVoice([v('Alex', 'en-US'), v('Daniel', 'en-GB')])?.name).toBe('Daniel');
    expect(pickVoice([v('Kyoko', 'ja-JP'), v('Alex', 'en-US')])?.name).toBe('Alex');
    expect(pickVoice([v('Kyoko', 'ja-JP')])).toBeNull();
  });
});

// ── Tour integration ────────────────────────────────────────────────────────

const STEPS: TourStep[] = [
  { id: 'a', title: 'A', target: null, text: () => 'First step.' },
  { id: 'b', title: 'B', target: null, text: () => 'Second step.' },
  { id: 'c', title: 'C', target: null, text: () => 'Last step.' },
];

const CONTROLLER: TourController = {
  solveLive: () => Promise.reject(new Error('unused')),
  stopLive: () => undefined,
  applyFrame: () => undefined,
  show: () => undefined,
  keep: () => undefined,
};

function controllableNarrator() {
  let finish: (() => void) | null = null;
  let muted = false;
  const narrator: Narrator = {
    speak: vi.fn(() => new Promise<void>((r) => (finish = r))),
    prefetch: vi.fn(),
    stop: vi.fn(() => finish?.()),
    pause: vi.fn(),
    resume: vi.fn(),
    setMuted: vi.fn((m: boolean) => {
      muted = m;
    }),
    isMuted: () => muted,
    unlock: vi.fn(),
    voice: () => 'browser',
    voiceId: () => null,
    provider: SILENT_NARRATOR.provider,
    providers: SILENT_NARRATOR.providers,
    setProvider: vi.fn(),
    selected: SILENT_NARRATOR.selected,
    select: vi.fn(),
    subscribe: () => () => undefined,
  };
  return { narrator, finishLine: () => finish?.() };
}

describe('useTour with narration', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits for the spoken line before auto-advancing', async () => {
    /**
     * Scenario: a long line takes longer to say than the reading dwell.
     * Slice: voice narration — pacing.
     * Given a narrator still speaking step 1, when the dwell (6 s) passes, then the tour
     * stays; once the line ends it moves on after a short tail, and prefetches step 2's line.
     */
    // -- Given --
    const { narrator, finishLine } = controllableNarrator();
    const { result } = renderHook(() => useTour(CONTROLLER, { current: null, currency: 'JPY' }, STEPS, narrator));
    act(() => result.current.start());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(narrator.unlock).toHaveBeenCalled();
    expect(narrator.speak).toHaveBeenCalledWith('First step.');
    expect(narrator.prefetch).toHaveBeenCalledWith('Second step.');
    // -- When --
    await act(async () => vi.advanceTimersByTimeAsync(12_000));
    const stillOnFirst = result.current.index;
    act(() => finishLine());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    const beforeTail = result.current.index;
    await act(async () => vi.advanceTimersByTimeAsync(200));
    // -- Then --
    expect(stillOnFirst).toBe(0);
    expect(beforeTail).toBe(0);
    expect(result.current.index).toBe(1);
    expect(narrator.speak).toHaveBeenLastCalledWith('Second step.');
  });

  it('pauses the voice with the tour, stops it on exit, and toggles mute with M', async () => {
    /**
     * Scenario: the presenter takes questions mid-tour.
     * Slice: voice narration — controls.
     * Given a speaking tour, when paused, M is pressed, and the tour exits, then the
     * narrator is paused, muted, and stopped.
     */
    // -- Given --
    const { narrator } = controllableNarrator();
    const { result } = renderHook(() => useTour(CONTROLLER, { current: null, currency: 'JPY' }, STEPS, narrator));
    act(() => result.current.start());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    // -- When --
    act(() => result.current.togglePause());
    act(() => {
      fireEvent.keyDown(window, { key: 'm' });
    });
    const mutedAfterKey = result.current.voice.muted;
    act(() => result.current.exit());
    // -- Then --
    expect(narrator.pause).toHaveBeenCalled();
    expect(narrator.setMuted).toHaveBeenCalledWith(true);
    expect(mutedAfterKey).toBe(true);
    expect(narrator.stop).toHaveBeenCalled();
  });
});

describe('TourOverlay voice control', () => {
  it('shows a mute toggle and a quiet "browser voice" note', () => {
    /**
     * Scenario: the premium voice is unavailable, so the browser reads the tour.
     * Slice: voice narration — UI.
     * Given voice props in fallback mode, when rendered, then a "Mute narration" button and
     * the "browser voice" note show, and clicking the button calls toggleMute.
     */
    // -- Given --
    const toggleMute = vi.fn();
    const voice = {
      muted: false,
      toggleMute,
      browserVoice: true,
      voiceId: null,
      voiceProvider: providerState(),
      spoken: () => Promise.resolve(),
    };
    render(
      <TourOverlay
        target={null}
        stepId="a"
        title="A"
        text="First step."
        index={0}
        total={3}
        paused={false}
        running={false}
        recorded={false}
        isLast={false}
        onNext={() => undefined}
        onBack={() => undefined}
        onTogglePause={() => undefined}
        onExit={() => undefined}
        onReplay={() => undefined}
        voice={voice}
      />,
    );
    // -- When --
    fireEvent.click(screen.getByRole('button', { name: 'Mute narration' }));
    // -- Then --
    expect(screen.getByText('browser voice')).toBeInTheDocument();
    expect(toggleMute).toHaveBeenCalledTimes(1);
  });

  it('lets the presenter switch voice from the tour controls; keyless providers are disabled', () => {
    /**
     * Scenario: mid-demo, the presenter wants a different narrator.
     * Slice: voice provider picker — UI.
     * Given ElevenLabs active and Gemini without a key, when the picker changes to the
     * browser voice, then setProvider gets "browser" and the Gemini option is disabled.
     */
    // -- Given --
    const select = vi.fn();
    const voice = {
      muted: false,
      toggleMute: () => undefined,
      browserVoice: false,
      voiceId: 'Lily',
      voiceProvider: providerState({ select }),
      spoken: () => Promise.resolve(),
    };
    render(
      <TourOverlay
        target={null}
        stepId="a"
        title="A"
        text="First step."
        index={0}
        total={3}
        paused={false}
        running={false}
        recorded={false}
        isLast={false}
        onNext={() => undefined}
        onBack={() => undefined}
        onTogglePause={() => undefined}
        onExit={() => undefined}
        onReplay={() => undefined}
        voice={voice}
      />,
    );
    const picker = screen.getByRole('combobox', { name: 'Narration voice' });
    // -- When --
    fireEvent.change(picker, { target: { value: 'browser' } });
    // -- Then --
    expect(select).toHaveBeenCalledWith('browser');
    expect(screen.getByRole('option', { name: /Gemini · Aoede \(no key\)/ })).toBeDisabled();
  });
});

describe('narrator voice provider', () => {
  it('sends the picked provider to /tts and remembers it for the next visit', async () => {
    /**
     * Scenario: the presenter picks Gemini before pressing Play demo.
     * Slice: voice provider picker — narrator.
     * Given a narrator, when Gemini is picked and a line is spoken, then the POST names
     * "gemini", the choice is stored, and a new narrator starts with Gemini.
     */
    // -- Given --
    const fetch = vi.fn(async () => audioResponse());
    const { narrator, audio, storage } = narratorWith(fetch as unknown as NarratorDeps['fetch']);
    // -- When --
    narrator.setProvider('gemini');
    const p = narrator.speak('Rest matters.');
    await flush();
    audio.onended?.(new Event('ended'));
    await p;
    const again = createNarrator({ fetch: null, storage, speech: null, createAudio: null });
    // -- Then --
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ text: 'Rest matters.', provider: 'gemini' });
    expect(storage.data[PROVIDER_STORAGE_KEY]).toBe('gemini');
    expect(again.provider()).toBe('gemini');
  });

  it('uses the browser voice straight away, without calling /tts, when "Browser voice" is picked', async () => {
    /**
     * Scenario: no Wi-Fi at the venue, so the presenter picks the offline voice.
     * Slice: voice provider picker — narrator.
     * Given "browser" picked, when a line is spoken, then /tts is never asked and
     * speechSynthesis reads it.
     */
    // -- Given --
    const fetch = vi.fn(async () => audioResponse());
    const { narrator, speech } = narratorWith(fetch as unknown as NarratorDeps['fetch']);
    narrator.setProvider('browser');
    // -- When --
    void narrator.speak('Offline line.');
    await flush();
    // -- Then --
    expect(fetch).not.toHaveBeenCalled();
    expect(speech.spoken.map((u) => u.text)).toEqual(['Offline line.']);
  });

  it('sends the picked Gemini voice with each line, even before the voice list has loaded', async () => {
    /**
     * Scenario: the presenter picked "Gemini · Sulafat (warm)" last time; GET /tts has not answered yet.
     * Slice: Gemini voice options — narrator.
     * Given a stored "gemini|Sulafat" choice, when a line is spoken, then the POST names provider
     * "gemini" and voiceId "Sulafat", and the picker value stays "gemini|Sulafat".
     */
    // -- Given --
    const fetch = vi.fn(async () => audioResponse());
    const { narrator: first, storage } = narratorWith(fetch as unknown as NarratorDeps['fetch']);
    first.select('gemini|Sulafat');
    const { narrator, audio } = narratorWith(fetch as unknown as NarratorDeps['fetch'], { storage });
    // -- When --
    const p = narrator.speak('Rest matters.');
    await flush();
    audio.onended?.(new Event('ended'));
    await p;
    // -- Then --
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ text: 'Rest matters.', provider: 'gemini', voiceId: 'Sulafat' });
    expect(narrator.selected()).toBe('gemini|Sulafat');
    expect(narrator.provider()).toBe('gemini');
  });

  it('waits longer for Gemini Argon than for ElevenLabs before falling back', async () => {
    /**
     * Scenario: Argon writes the commentary first, so its first answer takes ~17 s.
     * Slice: voice provider picker — pacing.
     * Given Argon picked and /tts slow, when 4 s pass the browser voice has not taken
     * over; it only does after the Argon wait.
     */
    vi.useFakeTimers();
    try {
      // -- Given --
      const { narrator, speech } = narratorWith(vi.fn(() => new Promise(() => undefined)) as never, {
        providerTimeoutMs: { 'gemini-argon': 20_000 },
      });
      narrator.setProvider('gemini-argon');
      // -- When --
      void narrator.speak('Slow Argon line.');
      await act(async () => vi.advanceTimersByTimeAsync(5_000));
      const after5s = speech.spoken.length;
      await act(async () => vi.advanceTimersByTimeAsync(15_100));
      // -- Then --
      expect(after5s).toBe(0);
      expect(speech.spoken).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
