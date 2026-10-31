/**
 * Voice narration for the guided tour.
 *
 * The narrator first asks the dev server's `POST /tts` for audio from the chosen provider
 * (ElevenLabs "Lily", Gemini, or Gemini Argon — keys kept server-side). When that fails, is
 * missing, or is slow, it falls back to the browser's own speechSynthesis (an en-GB voice
 * when there is one), so the tour always keeps talking. Once the key works again, the
 * premium voice comes back by itself.
 */

export type VoiceKind = 'premium' | 'browser' | 'none';

/** Same ids as the server's `VoiceProvider` in tts-plugin.ts. */
export type VoiceProvider = 'elevenlabs' | 'gemini' | 'gemini-argon' | 'gemini-ja' | 'browser';

export interface ProviderOption {
  id: VoiceProvider;
  label: string;
  voice: string | null;
  /** false when the server has no key for it */
  configured: boolean;
}

const PROVIDER_IDS: readonly VoiceProvider[] = ['elevenlabs', 'gemini', 'gemini-argon', 'gemini-ja', 'browser'];
/** providers with several voices in the picker: the voice is part of the option key */
const MULTI_VOICE: readonly VoiceProvider[] = ['gemini', 'gemini-ja'];

export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Picker value for an option: "<provider>|<voice>" for Gemini and Japanese voices (several share a provider),
 * otherwise just the provider id.
 */
export function optionKey(p: Pick<ProviderOption, 'id' | 'voice'>): string {
  return MULTI_VOICE.includes(p.id) && p.voice ? `${p.id}|${p.voice}` : p.id;
}

function providerOf(key: string): VoiceProvider | null {
  const id = key.split('|')[0];
  return isVoiceProvider(id) ? id : null;
}

/** Shown before GET /tts answers (or when it never does). */
export const FALLBACK_PROVIDERS: ProviderOption[] = [
  { id: 'elevenlabs', label: 'ElevenLabs', voice: null, configured: false },
  { id: 'browser', label: 'Browser voice', voice: null, configured: true },
];

export interface Narrator {
  /** say one line; resolves when it has been spoken, skipped, muted or stopped */
  speak(text: string): Promise<void>;
  /** warm the audio for a line that will be spoken soon */
  prefetch(text: string): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** call from a click handler: lets the browser play audio later (autoplay rules) */
  unlock(): void;
  /** which voice spoke the latest line */
  voice(): VoiceKind;
  /** voice ID/name of the active provider on the server (null until fetched or when unavailable) */
  voiceId(): string | null;
  /** the provider in use: the user's choice, else the server's default */
  provider(): VoiceProvider;
  /** providers the server offers (with key status) */
  providers(): ProviderOption[];
  /** switch provider (with its default voice); remembered across visits, takes effect from the next line */
  setProvider(p: VoiceProvider): void;
  /** the picker value in use (see `optionKey`) */
  selected(): string;
  /** switch to one picker option (provider + voice); remembered across visits */
  select(key: string): void;
  /** notified when `voice()`, the provider or the provider list changes; returns an unsubscribe */
  subscribe(fn: () => void): () => void;
}

/** Narrator that never makes a sound (tests, and before the App wires the real one). */
export const SILENT_NARRATOR: Narrator = {
  speak: () => Promise.resolve(),
  prefetch: () => undefined,
  stop: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
  setMuted: () => undefined,
  isMuted: () => true,
  unlock: () => undefined,
  voice: () => 'none',
  voiceId: () => null,
  provider: () => 'browser',
  providers: () => FALLBACK_PROVIDERS,
  setProvider: () => undefined,
  selected: () => 'browser',
  select: () => undefined,
  subscribe: () => () => undefined,
};

// ── Text → speakable text ───────────────────────────────────────────────────

const CURRENCY_WORDS: Record<string, [string, string]> = {
  '¥': ['yen', 'yen'],
  '£': ['pound', 'pounds'],
  $: ['dollar', 'dollars'],
};

/** Turn callout text into something a voice reads naturally ("¥1,234" → "1,234 yen"). */
export function toSpeech(text: string): string {
  return text
    .replace(/(-?\d+)hard\/(-?\d+)medium\/(-?\d+)soft/g, '$1 hard, $2 medium, $3 soft')
    .replace(/([+−-]?)([¥£$])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g, (_m, sign: string, sym: string, amount: string) => {
      const [one, many] = CURRENCY_WORDS[sym];
      return `${signWord(sign)}${amount} ${amount === '1' ? one : many}`;
    })
    .replace(/([+−]|(?<![\w\d])-)(\d+(?:\.\d+)?)%/g, (_m, sign: string, n: string) => `${signWord(sign)}${n}%`)
    .replace(/%/g, ' percent')
    .replace(/\s*→\s*/g, ' to ')
    .replace(/\s=\s/g, ' is ')
    .replace(/(\d+)\s*×\s*/g, '$1 for ')
    .replace(/(\d)\+/g, '$1 or more')
    .replace(/(\d) h\b/g, '$1 hours')
    .replace(/(\d) s\b/g, '$1 seconds')
    .replace(/\s*—\s*/g, ', ')
    .replace(/[“”"]/g, '')
    .replace(/…/g, '.')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function signWord(sign: string): string {
  if (sign === '+') return 'plus ';
  if (sign === '−' || sign === '-') return 'minus ';
  return '';
}

/**
 * The part of `next` not yet said in `prev`, cut at a sentence start — so when a solve
 * finishes we say "Finished: …" instead of repeating the step's intro.
 */
export function unspokenTail(prev: string, next: string): string {
  let common = 0;
  while (common < prev.length && common < next.length && prev[common] === next[common]) common++;
  if (common === next.length) return '';
  let cut = 0;
  const sentence = /[.!?]\s+/g;
  for (let m = sentence.exec(next); m && m.index + m[0].length <= common; m = sentence.exec(next)) {
    cut = m.index + m[0].length;
  }
  return next.slice(cut);
}

// ── Browser voice choice ────────────────────────────────────────────────────

/** Prefer a female British English voice (matches the premium narrator), then any en-GB, then any English. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const gb = voices.filter((v) => /^en[-_]GB$/i.test(v.lang));
  return (
    gb.find((v) => /Google UK English Female|Serena|Kate|Martha|Stephanie|Libby/i.test(v.name)) ??
    gb[0] ??
    voices.find((v) => /^en\b/i.test(v.lang)) ??
    null
  );
}

// ── The narrator ────────────────────────────────────────────────────────────

export const MUTE_STORAGE_KEY = 'tourVoiceMuted';
export const PROVIDER_STORAGE_KEY = 'tourVoiceProvider';
export const TTS_TIMEOUT_MS = 4000;
/**
 * Gemini needs ~4 s for a first-time line and Argon ~17 s (it writes the line, then speaks / Japanese ~7 s (translate, then speak)
 * it), so they get longer waits. Audio is cached on disk, so a rehearsal run makes replays instant.
 */
export const PROVIDER_TIMEOUT_MS: Partial<Record<VoiceProvider, number>> = { gemini: 10_000, 'gemini-ja': 12_000, 'gemini-argon': 25_000 };
const MAX_SERVER_CHARS = 600; // same limit as the /tts route
/** a 0-sample WAV: playing it inside a click "unlocks" audio for later */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

interface AudioLike {
  src: string;
  muted: boolean;
  play(): Promise<void> | void;
  pause(): void;
  onended: ((ev: Event) => void) | null;
  onerror: ((ev: Event | string) => void) | null;
}

interface SpeechLike {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): SpeechSynthesisVoice[];
}

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'headers' | 'blob'>>;

export interface NarratorDeps {
  fetch: FetchLike | null;
  createAudio: (() => AudioLike) | null;
  speech: SpeechLike | null;
  makeUtterance: ((text: string) => SpeechSynthesisUtterance) | null;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  createObjectURL: (blob: Blob) => string;
  timeoutMs: number;
  /** per-provider waits that override `timeoutMs` */
  providerTimeoutMs: Partial<Record<VoiceProvider, number>>;
  /** after a /tts failure, use the browser voice for this long before trying again */
  retryAfterMs: number;
  now: () => number;
}

function browserDeps(): NarratorDeps {
  const w = typeof window !== 'undefined' ? window : undefined;
  let storage: NarratorDeps['storage'] = null;
  try {
    storage = w?.localStorage ?? null;
  } catch {
    storage = null; // storage blocked (private window, etc.)
  }
  return {
    fetch: typeof fetch === 'function' ? (url, init) => fetch(url, init) : null,
    createAudio: typeof Audio === 'function' ? () => new Audio() : null,
    speech: w?.speechSynthesis ?? null,
    makeUtterance:
      typeof SpeechSynthesisUtterance === 'function' ? (t) => new SpeechSynthesisUtterance(t) : null,
    storage,
    createObjectURL: (b) => URL.createObjectURL(b),
    timeoutMs: TTS_TIMEOUT_MS,
    providerTimeoutMs: PROVIDER_TIMEOUT_MS,
    retryAfterMs: 60_000,
    now: () => Date.now(),
  };
}

/** Upper bound for one line, so a lost "ended" event never stalls the tour. */
function capMs(text: string): number {
  return 8000 + text.length * 120;
}

export function createNarrator(overrides: Partial<NarratorDeps> = {}): Narrator {
  const d: NarratorDeps = { ...browserDeps(), ...overrides };
  let muted = false;
  /** the user's picked option key (see optionKey), or null to follow the server default */
  let chosen: string | null = null;
  try {
    muted = d.storage?.getItem(MUTE_STORAGE_KEY) === '1';
    const stored = d.storage?.getItem(PROVIDER_STORAGE_KEY);
    if (stored && providerOf(stored)) chosen = stored;
  } catch {
    muted = false;
  }
  let serverDefault: VoiceProvider = 'elevenlabs';
  let providerList: ProviderOption[] = FALLBACK_PROVIDERS;
  const currentProvider = (): VoiceProvider => (chosen && providerOf(chosen)) || serverDefault;
  /** the listed option for the choice; a stale key (e.g. a removed voice) falls back to its provider's first option */
  const chosenOption = (): ProviderOption | undefined =>
    chosen
      ? (providerList.find((p) => optionKey(p) === chosen) ?? providerList.find((p) => p.id === providerOf(chosen!)))
      : undefined;
  const selectedKey = (): string => {
    const o = chosen ? chosenOption() : providerList.find((p) => p.id === serverDefault);
    return o ? optionKey(o) : (chosen ?? serverDefault);
  };
  /** voice to send for a multi-voice provider, read from the key itself so it works before GET /tts answers */
  const chosenGeminiVoice = (): string | undefined => {
    const [, voice] = (chosen ?? '').split('|');
    return voice || undefined;
  };
  let token = 0;
  let audio: AudioLike | null = null;
  let finishCurrent: (() => void) | null = null;
  let audioPlaying = false;
  let kind: VoiceKind = 'none';
  let serverOffUntil = 0;
  let activeVoiceId: string | null = null;
  const urls = new Map<string, Promise<string | null>>();
  const listeners = new Set<() => void>();

  // Fetch the server's active voice config once on init for display in the UI.
  if (d.fetch) {
    void (d.fetch as (url: string, init: RequestInit) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>)(
      '/tts', { method: 'GET', headers: { Accept: 'application/json' } }
    ).then((r) => {
      if (r.ok && r.json) return r.json();
      return null;
    }).then((body) => {
      if (body && typeof body === 'object' && 'voiceId' in body) {
        const b = body as { voiceId: string; provider?: unknown; providers?: unknown };
        activeVoiceId = b.voiceId;
        if (isVoiceProvider(b.provider)) serverDefault = b.provider;
        if (Array.isArray(b.providers)) {
          const list = b.providers.filter((p): p is ProviderOption => isVoiceProvider((p as ProviderOption)?.id));
          if (list.length > 0) providerList = list;
        }
        // Server is reachable and config may have changed (e.g. new API key in .env.local) —
        // clear any stale backoff so the next POST actually tries.
        serverOffUntil = 0;
        listeners.forEach((fn) => fn());
      }
    }).catch(() => undefined);
  }

  const setKind = (k: VoiceKind) => {
    if (k === kind) return;
    kind = k;
    listeners.forEach((fn) => fn());
  };
  const getAudio = () => (audio ??= d.createAudio?.() ?? null);

  function audioUrl(line: string): Promise<string | null> {
    const provider = currentProvider();
    if (provider === 'browser') return Promise.resolve(null);
    const cacheKey = `${selectedKey()}\n${line}`;
    const hit = urls.get(cacheKey);
    if (hit) return hit;
    if (!d.fetch || line.length > MAX_SERVER_CHARS || d.now() < serverOffUntil) return Promise.resolve(null);
    const fetchFn = d.fetch;
    const p = (async () => {
      try {
        const res = await fetchFn('/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // no provider until the user picks one: the server's default (as before)
          body: JSON.stringify(
            chosen ? { text: line, provider, ...(chosenGeminiVoice() ? { voiceId: chosenGeminiVoice() } : {}) } : { text: line },
          ),
        });
        if (res.ok && (res.headers.get('content-type') ?? '').includes('audio')) {
          return d.createObjectURL(await res.blob());
        }
      } catch {
        // network error — fall through to the browser voice
      }
      serverOffUntil = d.now() + d.retryAfterMs;
      return null;
    })();
    urls.set(cacheKey, p);
    void p.then((u) => {
      if (!u) urls.delete(cacheKey);
    });
    return p;
  }

  function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
    return new Promise((done) => {
      const t = setTimeout(() => done(null), ms);
      void p.then((v) => {
        clearTimeout(t);
        done(v);
      });
    });
  }

  /** resolves true when played (or stopped), false when the browser refused to play */
  function playUrl(url: string, line: string): Promise<boolean> {
    const el = getAudio();
    if (!el) return Promise.resolve(false);
    return new Promise((done) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(cap);
        el.onended = null;
        el.onerror = null;
        audioPlaying = false;
        if (finishCurrent === stopHere) finishCurrent = null;
        done(ok);
      };
      const stopHere = () => finish(true);
      const cap = setTimeout(stopHere, capMs(line));
      finishCurrent = stopHere;
      audioPlaying = true;
      el.muted = false;
      el.src = url;
      el.onended = stopHere;
      el.onerror = () => finish(false);
      try {
        void Promise.resolve(el.play()).catch(() => finish(false));
      } catch {
        finish(false);
      }
    });
  }

  function speakBrowser(line: string): Promise<void> {
    const speech = d.speech;
    if (!speech || !d.makeUtterance) {
      setKind('none');
      return Promise.resolve();
    }
    setKind('browser');
    return new Promise((done) => {
      const u = d.makeUtterance!(line);
      u.lang = 'en-GB';
      const v = pickVoice(speech.getVoices());
      if (v) u.voice = v;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(cap);
        if (finishCurrent === finish) finishCurrent = null;
        done();
      };
      const cap = setTimeout(finish, capMs(line));
      u.onend = finish;
      u.onerror = finish;
      finishCurrent = finish;
      speech.speak(u);
    });
  }

  const narrator: Narrator = {
    async speak(text) {
      narrator.stop();
      const line = toSpeech(text);
      if (muted || !line) return;
      const mine = token;
      const url = await withTimeout(audioUrl(line), d.providerTimeoutMs[currentProvider()] ?? d.timeoutMs);
      if (mine !== token) return;
      if (url) {
        setKind('premium');
        if (await playUrl(url, line)) return;
        if (mine !== token) return;
      }
      await speakBrowser(line);
    },
    prefetch(text) {
      const line = toSpeech(text);
      if (!muted && line) void audioUrl(line);
    },
    stop() {
      token++;
      audio?.pause();
      d.speech?.cancel();
      const f = finishCurrent;
      finishCurrent = null;
      f?.();
    },
    pause() {
      audio?.pause();
      d.speech?.pause();
    },
    resume() {
      if (audio && audioPlaying) void Promise.resolve(audio.play()).catch(() => undefined);
      d.speech?.resume();
    },
    setMuted(m) {
      muted = m;
      if (m) narrator.stop();
      try {
        d.storage?.setItem(MUTE_STORAGE_KEY, m ? '1' : '0');
      } catch {
        // best-effort; the in-memory state still applies
      }
    },
    isMuted: () => muted,
    unlock() {
      const el = getAudio();
      if (!el || finishCurrent) return;
      try {
        el.muted = true;
        el.src = SILENT_WAV;
        void Promise.resolve(el.play()).catch(() => undefined);
      } catch {
        // not allowed / not implemented — the browser voice still works
      }
    },
    voice: () => kind,
    voiceId: () => (chosen ? (chosenOption()?.voice ?? null) : activeVoiceId),
    provider: currentProvider,
    providers: () => providerList,
    setProvider(p) {
      narrator.select(p);
    },
    selected: selectedKey,
    select(key) {
      if (!providerOf(key) || key === chosen) return;
      chosen = key;
      serverOffUntil = 0; // a failure on the old voice says nothing about the new one
      try {
        d.storage?.setItem(PROVIDER_STORAGE_KEY, key);
      } catch {
        // best-effort; the in-memory choice still applies
      }
      listeners.forEach((fn) => fn());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return narrator;
}
