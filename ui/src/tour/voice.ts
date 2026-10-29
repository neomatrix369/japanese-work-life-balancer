/**
 * Voice narration for the guided tour.
 *
 * The narrator first asks the dev server's `POST /tts` (ElevenLabs "Lily", key kept
 * server-side) for an mp3. When that fails, is missing, or is slow (> 4 s), it falls back to
 * the browser's own speechSynthesis (an en-GB voice when there is one), so the tour always
 * keeps talking. Once the key works again, the premium voice comes back by itself.
 */

export type VoiceKind = 'premium' | 'browser' | 'none';

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
  /** notified when `voice()` changes; returns an unsubscribe */
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
export const TTS_TIMEOUT_MS = 4000;
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
  try {
    muted = d.storage?.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    muted = false;
  }
  let token = 0;
  let audio: AudioLike | null = null;
  let finishCurrent: (() => void) | null = null;
  let audioPlaying = false;
  let kind: VoiceKind = 'none';
  let serverOffUntil = 0;
  const urls = new Map<string, Promise<string | null>>();
  const listeners = new Set<() => void>();

  const setKind = (k: VoiceKind) => {
    if (k === kind) return;
    kind = k;
    listeners.forEach((fn) => fn());
  };
  const getAudio = () => (audio ??= d.createAudio?.() ?? null);

  function audioUrl(line: string): Promise<string | null> {
    const hit = urls.get(line);
    if (hit) return hit;
    if (!d.fetch || line.length > MAX_SERVER_CHARS || d.now() < serverOffUntil) return Promise.resolve(null);
    const fetchFn = d.fetch;
    const p = (async () => {
      try {
        const res = await fetchFn('/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: line }),
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
    urls.set(line, p);
    void p.then((u) => {
      if (!u) urls.delete(line);
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
      const url = await withTimeout(audioUrl(line), d.timeoutMs);
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
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return narrator;
}
