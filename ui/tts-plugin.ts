/// <reference path="./tts-node.d.ts" />
/**
 * Server-side text-to-speech for the guided tour's narration.
 *
 * Supports multiple voice providers:
 *  - Gemini TTS (gemini-3.8-flash-tts with Aoede/Kore/Puck)
 *  - Gemini Argon (gemini-4-argon commentary + gemini-3.8-flash-tts)
 *  - ElevenLabs (a curated English + Japanese pool, Lily first, eleven_multilingual_v2)
 *  - Auto (`elevenlabs-auto`): per line, ElevenLabs while credits last, then Gemini if its guard
 *    allows, then the browser voice
 *  - Browser Voice (local Web Speech fallback)
 *
 * Audio is cached on disk by sha256(provider + voice + model + text),
 * so replaying steps consumes zero API tokens.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export const TTS_ROUTE = '/tts';

// ElevenLabs defaults
export const DEFAULT_VOICE_ID = 'pFZP5JQG7iQjIQuC4Bku'; // "Lily" — warm, gentle British narrator
export const DEFAULT_MODEL_ID = 'eleven_multilingual_v2'; // says Japanese names like "Sato-san" well

export interface ElevenVoiceOption {
  voiceId: string;
  /** voice name for the picker label */
  label: string;
  /** the language of lines this voice speaks in Auto */
  lang: 'en' | 'ja';
  /** 1 = best for its language (the API has no quality score, so the order lives here) */
  rank: number;
}

/** Curated premade ElevenLabs voices (no add step, free tier). Lily stays the English default. */
export const ELEVENLABS_VOICE_OPTIONS: readonly ElevenVoiceOption[] = [
  { voiceId: DEFAULT_VOICE_ID, label: 'Lily', lang: 'en', rank: 1 },
  { voiceId: 'JBFqnCBsd6RMkjVDRZzb', label: 'George', lang: 'en', rank: 2 }, // MOCK: not ear-checked yet
  { voiceId: 'nPczCjzI2devNBz1zQrb', label: 'Brian', lang: 'en', rank: 3 }, // MOCK: not ear-checked yet
  { voiceId: 'Xb7hH8MSUJpSbSDYk0k2', label: 'Alice', lang: 'ja', rank: 1 }, // MOCK: not ear-checked yet
  { voiceId: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte', lang: 'ja', rank: 2 }, // MOCK: not ear-checked yet
];

/**
 * The pool Auto, the allow-list and the picker all use. A configured ELEVENLABS_VOICE_ID that is not
 * curated is the user's own voice: it leads the English lines as "Your voice".
 */
export function voicePool(
  configuredVoiceId: string = DEFAULT_VOICE_ID,
  base: readonly ElevenVoiceOption[] = ELEVENLABS_VOICE_OPTIONS,
): readonly ElevenVoiceOption[] {
  if (base.some((v) => v.voiceId === configuredVoiceId)) return base;
  return [{ voiceId: configuredVoiceId, label: 'Your voice', lang: 'en', rank: 0 }, ...base];
}

// Gemini defaults
export const DEFAULT_GEMINI_VOICE = 'Aoede'; // breezy, natural long-form voice
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_GEMINI_ARGON_MODEL = 'gemini-4-argon';
export const DEFAULT_GEMINI_TRANSLATE_MODEL = 'gemini-3.8-flash'; // fast text model for the Japanese voices
/** Gemini voices offered in Japanese (picked by ear, 2026-10-31). */
export const GEMINI_JA_VOICES: readonly string[] = ['Sulafat', 'Achird'];

/*
 * No "speak like a person" direction is sent with the text. Tested 2026-10-31 by transcribing the audio:
 * in-text directions ("Read this like a real person…: ", "Say warmly and naturally: ") were read aloud in
 * 3 of 6 and 3 of 4 samples, in English and Japanese, and gemini-3.8-flash-tts rejects systemInstruction
 * ("Developer instruction is not enabled"). The natural sound comes from the voice choice instead.
 */

export interface GeminiVoiceOption {
  /** Gemini prebuilt voice name; also what the picker sends as `voiceId` */
  voiceName: string;
  /** one word for the picker label */
  style: string;
}

/** The voices the team picked by ear (2026-10-31). All speak English and Japanese. */
export const GEMINI_VOICE_OPTIONS: readonly GeminiVoiceOption[] = [
  { voiceName: 'Aoede', style: 'breezy' },
  { voiceName: 'Sulafat', style: 'warm' },
  { voiceName: 'Achernar', style: 'soft' },
  { voiceName: 'Vindemiatrix', style: 'gentle' },
  { voiceName: 'Gacrux', style: 'mature' },
  { voiceName: 'Achird', style: 'friendly' },
];

/**
 * A Gemini voice name to use: the requested one if it looks like a voice name (listed, or another
 * prebuilt voice such as GEMINI_VOICE_NAME=Kore), otherwise the fallback.
 */
export function resolveGeminiVoice(id: string | undefined, fallback: string = DEFAULT_GEMINI_VOICE): string {
  if (id && /^[A-Za-z]{2,24}$/.test(id)) return id;
  return /^[A-Za-z]{2,24}$/.test(fallback) ? fallback : DEFAULT_GEMINI_VOICE;
}

export const VOICE_SETTINGS = { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } as const;
export const MAX_TEXT_CHARS = 600;
export const MAX_UPSTREAM_PER_MINUTE = 30;
const MAX_BODY_BYTES = 8 * 1024;
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
export const ELEVENLABS_SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Auto keeps at least this share of ElevenLabs credits (and of the Gemini budget) unspent. */
export const MIN_LEFT_PCT = 10;
/** Credits reply kept this long; also how long a quota error keeps Auto off ElevenLabs. */
export const CREDITS_TTL_MS = 5 * 60_000;
/** A failed credits check ("unknown") is kept this long, so it is not retried on every line. */
export const CREDITS_UNKNOWN_TTL_MS = 60_000;
/** ElevenLabs codes for "out of credits" (new errors page, then the older help pages). */
const QUOTA_CODES: readonly string[] = ['insufficient_credits', 'quota_exceeded'];

export type VoiceProvider = 'gemini' | 'gemini-argon' | 'gemini-ja' | 'elevenlabs' | 'elevenlabs-auto' | 'browser';
type GeminiProvider = 'gemini' | 'gemini-argon' | 'gemini-ja';
type Upstream = 'elevenlabs' | 'gemini';

export interface GeminiConfig {
  apiKey?: string | undefined;
  voiceName?: string | undefined;
  ttsModel?: string | undefined;
  argonModel?: string | undefined;
  translateModel?: string | undefined;
}

export interface ElevenLabsConfig {
  apiKey?: string | undefined;
  voiceId?: string | undefined;
  modelId?: string | undefined;
}

export interface TtsConfig {
  elevenlabs?: ElevenLabsConfig;
  gemini?: GeminiConfig;
  /** fixed default (TTS_PROVIDER); unset = picked per request by `pickDefaultProvider` */
  defaultProvider?: VoiceProvider | undefined;
  // Backward compatibility with legacy tests:
  apiKey?: string | undefined;
  voiceId?: string | undefined;
  modelId?: string | undefined;
}

export interface UpstreamResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<UpstreamResponse>;

export interface TtsCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, audio: Uint8Array): Promise<void>;
}

/** Gemini spend settings, read on every request (GEMINI_TIER, GEMINI_BUDGET_LEFT_PCT). */
export interface GeminiPolicy {
  tier?: string | undefined;
  budgetLeftPct?: number | undefined;
}

export interface TtsDeps {
  fetch: FetchLike;
  cache: TtsCache;
  now: () => number;
  log?: (msg: string) => void;
  /** current Gemini policy; absent = Gemini is never chosen automatically */
  geminiPolicy?: () => GeminiPolicy;
}

export interface TtsResult {
  status: number;
  contentType: 'audio/mpeg' | 'audio/wav' | 'application/json';
  body: Uint8Array | string;
  cache?: 'hit' | 'miss';
  /** the engine that spoke the line (sent as X-TTS-Provider) */
  provider?: Upstream | 'browser';
}

/** ElevenLabs characters used and allowed this period, or 'unknown' (fail open). */
export type Credits = { used: number; limit: number; leftPct: number } | 'unknown';

export type TtsHandler = ((body: unknown) => Promise<TtsResult>) & {
  /** cached credits, never waiting on the network (a stale value starts a background refresh) */
  peekCredits(): Credits;
};

export interface TtsRequestBody {
  text: string;
  provider?: VoiceProvider;
  voiceId?: string;
}

/**
 * Cache key: voice + model + delivery settings + text. `namespace` (e.g. "gemini") keeps
 * other providers' audio apart; ElevenLabs omits it so existing cached mp3s stay valid.
 */
export function ttsCacheKey(voiceId: string, modelId: string, text: string, namespace?: string): string {
  const prefix = namespace ? `${namespace}\n` : '';
  return createHash('sha256')
    .update(`${prefix}${voiceId}\n${modelId}\n${JSON.stringify(VOICE_SETTINGS)}\n${text}`)
    .digest('hex');
}

const PROVIDERS: readonly VoiceProvider[] = ['elevenlabs-auto', 'elevenlabs', 'gemini', 'gemini-argon', 'gemini-ja', 'browser'];

export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Default voice when the caller does not pick one: TTS_PROVIDER if valid, else Auto when an
 * ElevenLabs key is set, else Gemini only when its key is set and its guard allows it
 * (`geminiOk`), else the browser voice.
 */
export function pickDefaultProvider(
  requested: string | undefined,
  geminiKey: string | undefined,
  elevenKey: string | undefined,
  geminiOk: boolean = false,
): VoiceProvider {
  if (isVoiceProvider(requested)) return requested;
  if (elevenKey) return 'elevenlabs-auto';
  if (geminiKey && geminiOk) return 'gemini';
  return 'browser';
}

/** Japanese if the line has any kana or kanji, otherwise English (a heuristic). */
export function isJapanese(text: string): boolean {
  return /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/.test(text);
}

/**
 * The ElevenLabs voice Auto uses for a line: the best-ranked pool voice for the line's language,
 * or null (skip ElevenLabs) when the language has no voice or speaking `lineChars` more would
 * leave less than MIN_LEFT_PCT of the credits. Unknown credits fail open.
 */
export function pickElevenVoice(
  text: string,
  pool: readonly ElevenVoiceOption[],
  credits: Credits,
  lineChars: number = text.length,
): ElevenVoiceOption | null {
  if (credits !== 'unknown') {
    const leftAfter = credits.limit - credits.used - lineChars;
    if (credits.limit <= 0 || (leftAfter / credits.limit) * 100 < MIN_LEFT_PCT) return null;
  }
  const lang = isJapanese(text) ? 'ja' : 'en';
  return pool.filter((v) => v.lang === lang).sort((a, b) => a.rank - b.rank)[0] ?? null;
}

/** One credits check: GET /v1/user/subscription. Any non-OK, malformed or failed reply is 'unknown'. */
export async function fetchElevenCredits(apiKey: string, fetch: FetchLike): Promise<Credits> {
  try {
    const res = await fetch(ELEVENLABS_SUBSCRIPTION_URL, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return 'unknown';
    const parsed = JSON.parse(await res.text()) as { character_count?: unknown; character_limit?: unknown };
    const used = parsed.character_count;
    const limit = parsed.character_limit;
    if (typeof used !== 'number' || typeof limit !== 'number' || !(limit > 0) || !Number.isFinite(used)) return 'unknown';
    return { used, limit, leftPct: Math.max(0, Math.floor(((limit - used) / limit) * 100)) };
  } catch {
    return 'unknown';
  }
}

export interface CreditsCache {
  /** the cached credits, loading them first when stale */
  get(): Promise<Credits>;
  /** the cached credits now; a stale value starts a background refresh */
  peek(): Credits;
}

/**
 * Caches `load()`: a value for CREDITS_TTL_MS, 'unknown' for CREDITS_UNKNOWN_TTL_MS. Concurrent
 * reads share one call. `mayCall` (the rate limiter) can refuse a refresh; the old value is kept.
 */
export function createCreditsCache(
  load: () => Promise<Credits>,
  now: () => number,
  mayCall: () => boolean = () => true,
): CreditsCache {
  let value: Credits = 'unknown';
  let freshUntil = Number.NEGATIVE_INFINITY;
  let inflight: Promise<Credits> | null = null;
  const get = (): Promise<Credits> => {
    if (now() < freshUntil) return Promise.resolve(value);
    if (inflight) return inflight;
    if (!mayCall()) return Promise.resolve(value);
    inflight = load()
      .catch((): Credits => 'unknown')
      .then((v) => {
        value = v;
        freshUntil = now() + (v === 'unknown' ? CREDITS_UNKNOWN_TTL_MS : CREDITS_TTL_MS);
        inflight = null;
        return v;
      });
    return inflight;
  };
  return {
    get,
    peek: () => {
      void get();
      return value;
    },
  };
}

/**
 * May Auto spend Gemini on a line? Only on the paid tier, with the budget unset or at least
 * MIN_LEFT_PCT, and outside a 429 cooldown.
 */
export function geminiAllowed(policy: GeminiPolicy & { coolingUntil?: number | undefined }, now: number): boolean {
  if (policy.tier?.trim().toLowerCase() !== 'paid') return false;
  if (policy.budgetLeftPct !== undefined && !(policy.budgetLeftPct >= MIN_LEFT_PCT)) return false;
  return (policy.coolingUntil ?? 0) <= now;
}

/** Decode base64 to binary bytes (runs universally in Node 18+ and browsers). */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const json = (status: number, payload: Record<string, unknown>): TtsResult => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

/** Parse text and options from incoming request body. */
export function parseTtsBody(body: unknown): TtsRequestBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const text = b.text;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TEXT_CHARS) return null;

  const provider = isVoiceProvider(b.provider) ? b.provider : undefined;
  const voiceId = typeof b.voiceId === 'string' && b.voiceId.trim() ? b.voiceId.trim() : undefined;
  return { text: trimmed, provider, voiceId };
}

/** Legacy helper: validated narration text, or null. */
export function parseTtsText(body: unknown): string | null {
  return parseTtsBody(body)?.text ?? null;
}

/** Wait used when an upstream 429 does not say how long to back off. */
export const DEFAULT_RETRY_AFTER_MS = 10_000;

interface UpstreamError {
  code: string;
  /** Gemini's RetryInfo.retryDelay ("17s", "0.5s") in ms, when present */
  retryAfterMs?: number;
}

async function upstreamError(res: UpstreamResponse): Promise<UpstreamError> {
  try {
    const parsed = JSON.parse(await res.text()) as {
      // ElevenLabs: new {detail:{code, status(legacy)}}, old {detail:{status}}
      detail?: { code?: unknown; status?: unknown };
      error?: { status?: unknown; details?: { retryDelay?: unknown }[] };
    };
    const raw = parsed?.detail?.code ?? parsed?.detail?.status ?? parsed?.error?.status;
    const code = typeof raw === 'string' && /^[a-z0-9_]{1,64}$/i.test(raw) ? raw.toLowerCase() : 'upstream_error';
    const delay = (parsed?.error?.details ?? []).map((d) => d?.retryDelay).find((d) => typeof d === 'string');
    const secs = typeof delay === 'string' ? Number.parseFloat(delay) : Number.NaN;
    return Number.isFinite(secs) ? { code, retryAfterMs: Math.ceil(secs * 1000) } : { code };
  } catch {
    return { code: 'upstream_error' }; // non-JSON body
  }
}

/** Returns 0 when a call may go upstream now, else the ms until the oldest call leaves the window. */
function rateLimiter(perMinute: number, now: () => number) {
  const calls: number[] = [];
  return (): number => {
    const t = now();
    while (calls.length > 0 && t - calls[0] >= 60_000) calls.shift();
    if (calls.length >= perMinute) return 60_000 - (t - calls[0]);
    calls.push(t);
    return 0;
  };
}

const rateLimited = (retryAfterMs: number, extra: Record<string, unknown> = {}): TtsResult =>
  json(429, { error: 'rate_limited', ...extra, retryAfterMs });

const ARGON_INSTRUCTION =
  'You are an empathetic workplace wellbeing narrator for a Japanese work-life balance dashboard. Rephrase the input into one or two natural, spoken sentences highlighting human wellbeing, rest, and safety. Do not output markdown, bullet points, or commentary prefixes.';

export const JAPANESE_INSTRUCTION =
  'Translate the input into natural, spoken Japanese, as a warm narrator explaining a work schedule to a small room. Keep every number and amount exactly. Write names with さん (e.g. Sato-san → 佐藤さん). Output only the Japanese sentences: no romaji, notes, quotes or markdown.';

/**
 * Ask a Gemini text model to rewrite one line (Argon commentary, or a Japanese translation).
 * Returns the answer, skipping "thought" parts of thinking models, or null when the call fails.
 */
async function geminiRewrite(
  deps: TtsDeps,
  headers: Record<string, string>,
  model: string,
  instruction: string,
  text: string,
  label: string,
  think = true,
): Promise<string | null> {
  try {
    const res = await deps.fetch(`${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ parts: [{ text }] }],
        // thinking off: translation took ~2.4 s instead of ~11 s (measured 2026-10-31), same quality
        ...(think ? {} : { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }),
      }),
    });
    if (!res.ok) {
      deps.log?.(`[tts] ${label} ${res.status}, speaking the original text`);
      return null;
    }
    const parsed = JSON.parse(await res.text()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    };
    const answer = (parsed.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join(' ')
      .trim();
    return answer || null;
  } catch {
    deps.log?.(`[tts] ${label} failed, speaking the original text`);
    return null;
  }
}

export function createTtsHandler(
  config: TtsConfig,
  deps: TtsDeps,
  perMinute: number = MAX_UPSTREAM_PER_MINUTE,
): TtsHandler {
  const waitBeforeCall = rateLimiter(perMinute, deps.now);
  /**
   * After an upstream 429, answer 429 locally until the provider's wait is over: each extra
   * call while limited only burns quota and can lengthen the penalty.
   */
  const coolingUntil: Partial<Record<Upstream, number>> = {};
  /** After an ElevenLabs quota error, Auto stays off ElevenLabs until this time. */
  let elevenExhaustedUntil = 0;
  const gate = (upstream: Upstream): TtsResult | null => {
    const cooling = (coolingUntil[upstream] ?? 0) - deps.now();
    if (cooling > 0) return rateLimited(cooling, { upstreamStatus: 429 });
    const wait = waitBeforeCall();
    return wait > 0 ? rateLimited(wait) : null;
  };
  const upstreamFailed = async (upstream: Upstream, res: UpstreamResponse): Promise<TtsResult> => {
    const { code, retryAfterMs } = await upstreamError(res);
    deps.log?.(`[tts] ${upstream} upstream ${res.status} ${code}`);
    if (upstream === 'elevenlabs' && [400, 401, 402].includes(res.status) && QUOTA_CODES.includes(code)) {
      elevenExhaustedUntil = deps.now() + CREDITS_TTL_MS;
      deps.log?.('[tts] elevenlabs credits exhausted, Auto skips it for 5 minutes');
    }
    if (res.status !== 429) return json(502, { error: code, upstreamStatus: res.status });
    const wait = retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
    coolingUntil[upstream] = deps.now() + wait;
    return rateLimited(wait, { upstreamStatus: 429, upstreamError: code });
  };

  const eleven: ElevenLabsConfig = {
    apiKey: config.elevenlabs?.apiKey ?? config.apiKey,
    voiceId: config.elevenlabs?.voiceId ?? config.voiceId ?? DEFAULT_VOICE_ID,
    modelId: config.elevenlabs?.modelId ?? config.modelId ?? DEFAULT_MODEL_ID,
  };
  const pool = voicePool(eleven.voiceId);

  const gemini: GeminiConfig = {
    apiKey: config.gemini?.apiKey,
    voiceName: config.gemini?.voiceName ?? DEFAULT_GEMINI_VOICE,
    ttsModel: config.gemini?.ttsModel ?? DEFAULT_GEMINI_TTS_MODEL,
    argonModel: config.gemini?.argonModel ?? DEFAULT_GEMINI_ARGON_MODEL,
    translateModel: config.gemini?.translateModel ?? DEFAULT_GEMINI_TRANSLATE_MODEL,
  };

  const credits = createCreditsCache(
    () => (eleven.apiKey ? fetchElevenCredits(eleven.apiKey, deps.fetch) : Promise.resolve<Credits>('unknown')),
    deps.now,
    () => waitBeforeCall() === 0,
  );
  /** Gemini may be chosen automatically (read per request, so config edits apply without a restart). */
  const geminiOk = (): boolean =>
    !!gemini.apiKey && geminiAllowed({ ...(deps.geminiPolicy?.() ?? {}), coolingUntil: coolingUntil.gemini }, deps.now());
  const elevenOk = (): boolean =>
    !!eleven.apiKey && elevenExhaustedUntil <= deps.now() && (coolingUntil.elevenlabs ?? 0) <= deps.now();

  const spoken = (body: Uint8Array, contentType: 'audio/mpeg' | 'audio/wav', cache: 'hit' | 'miss', provider: Upstream): TtsResult =>
    ({ status: 200, contentType, body, cache, provider });
  const browserFallback = (): TtsResult => ({ ...json(200, { fallback: true, provider: 'browser' }), provider: 'browser' });

  /** Speak one line with one ElevenLabs voice: cache, key check, gate, upstream, cache write. */
  const elevenSpeak = async (text: string, voiceId: string): Promise<TtsResult> => {
    const modelId = eleven.modelId ?? DEFAULT_MODEL_ID;
    // Keyed by voiceId + modelId + text (backward-compatible cache key format)
    const key = ttsCacheKey(voiceId, modelId, text);
    const cached = await deps.cache.get(key).catch(() => null);
    if (cached) return spoken(cached, 'audio/mpeg', 'hit', 'elevenlabs');

    if (!eleven.apiKey) return json(503, { error: 'tts_not_configured' });
    const limited = gate('elevenlabs');
    if (limited) return limited;

    let res: UpstreamResponse;
    try {
      res = await deps.fetch(`${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': eleven.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({ text, model_id: modelId, voice_settings: VOICE_SETTINGS }),
      });
    } catch {
      deps.log?.('[tts] elevenlabs upstream unreachable');
      return json(503, { error: 'upstream_unreachable' });
    }

    if (!res.ok) return upstreamFailed('elevenlabs', res);

    const audio = new Uint8Array(await res.arrayBuffer());
    await deps.cache.put(key, audio).catch(() => deps.log?.('[tts] cache write failed'));
    return spoken(audio, 'audio/mpeg', 'miss', 'elevenlabs');
  };

  /** Speak one line with Gemini: direct, Argon commentary, or Japanese (translated, then spoken). */
  const geminiSpeak = async (text: string, voiceName: string, namespace: GeminiProvider): Promise<TtsResult> => {
    const ttsModel = gemini.ttsModel ?? DEFAULT_GEMINI_TTS_MODEL;
    const argonModel = gemini.argonModel ?? DEFAULT_GEMINI_ARGON_MODEL;
    const translateModel = gemini.translateModel ?? DEFAULT_GEMINI_TRANSLATE_MODEL;
    // the text model that rewrites the line before it is spoken (none for plain Gemini)
    const rewrite =
      namespace === 'gemini-argon' ? { model: argonModel, instruction: ARGON_INSTRUCTION, label: 'argon commentary', think: true }
      : namespace === 'gemini-ja' ? { model: translateModel, instruction: JAPANESE_INSTRUCTION, label: 'japanese translation', think: false }
      : null;

    const key = ttsCacheKey(voiceName, rewrite ? `${rewrite.model}+${ttsModel}` : ttsModel, text, namespace);
    // Key in a header, never in the URL (URLs end up in proxy and server logs).
    const geminiHeaders = { 'Content-Type': 'application/json', 'x-goog-api-key': gemini.apiKey ?? '' };

    const cached = await deps.cache.get(key).catch(() => null);
    if (cached) return spoken(cached, 'audio/wav', 'hit', 'gemini');

    if (!gemini.apiKey) return json(503, { error: 'tts_not_configured' });
    const limited = gate('gemini');
    if (limited) return limited;

    // If the rewrite fails, the original line is spoken rather than going silent.
    const textToSpeak = rewrite
      ? ((await geminiRewrite(deps, geminiHeaders, rewrite.model, rewrite.instruction, text, rewrite.label, rewrite.think)) ?? text)
      : text;

    let res: UpstreamResponse;
    try {
      res = await deps.fetch(`${GEMINI_API_BASE}/${encodeURIComponent(ttsModel)}:generateContent`, {
        method: 'POST',
        headers: geminiHeaders,
        body: JSON.stringify({
          contents: [{ parts: [{ text: textToSpeak }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
          },
        }),
      });
    } catch {
      deps.log?.('[tts] gemini upstream unreachable');
      return json(503, { error: 'upstream_unreachable' });
    }

    if (!res.ok) return upstreamFailed('gemini', res);

    let b64: string | undefined;
    try {
      const parsed = JSON.parse(await res.text()) as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
      };
      b64 = parsed.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch {
      // non-JSON or malformed payload
    }

    if (!b64) {
      deps.log?.('[tts] gemini returned no inline audio data');
      return json(502, { error: 'invalid_audio_response' });
    }

    const audio = decodeBase64(b64);
    await deps.cache.put(key, audio).catch(() => deps.log?.('[tts] cache write failed'));
    return spoken(audio, 'audio/wav', 'miss', 'gemini');
  };

  /**
   * Auto: ElevenLabs (pool voice for the line's language, while credits last), then Gemini if its
   * guard allows (Aoede, or the first Japanese voice for a Japanese line; no translation), then the
   * browser voice. A failure falls through to the next step, so Auto never answers 502.
   */
  const autoSpeak = async (text: string): Promise<TtsResult> => {
    if (elevenOk()) {
      const voice = pickElevenVoice(text, pool, await credits.get(), text.length);
      if (voice) {
        const r = await elevenSpeak(text, voice.voiceId);
        if (r.status === 200) return r;
      }
    }
    if (geminiOk()) {
      const voiceName = isJapanese(text) ? (GEMINI_JA_VOICES[0] ?? DEFAULT_GEMINI_VOICE) : DEFAULT_GEMINI_VOICE;
      const r = await geminiSpeak(text, voiceName, 'gemini');
      if (r.status === 200) return r;
    }
    return browserFallback();
  };

  const handle = async (body: unknown): Promise<TtsResult> => {
    const parsedReq = parseTtsBody(body);
    if (parsedReq === null) return json(400, { error: 'invalid_text', maxChars: MAX_TEXT_CHARS });

    const { text } = parsedReq;
    const provider = parsedReq.provider ?? config.defaultProvider ?? pickDefaultProvider(undefined, gemini.apiKey, eleven.apiKey, geminiOk());

    if (provider === 'browser') return browserFallback();
    if (provider === 'elevenlabs-auto') return autoSpeak(text);

    if (provider === 'elevenlabs') {
      const voiceId = parsedReq.voiceId ?? eleven.voiceId ?? DEFAULT_VOICE_ID;
      // Only pool voices (curated, plus the configured one), so credits are never spent on an arbitrary voice.
      if (!pool.some((v) => v.voiceId === voiceId)) {
        return json(400, { error: 'voice_not_allowed' });
      }
      return elevenSpeak(text, voiceId);
    }

    if (provider === 'gemini' || provider === 'gemini-argon' || provider === 'gemini-ja') {
      return geminiSpeak(text, resolveGeminiVoice(parsedReq.voiceId, gemini.voiceName ?? DEFAULT_GEMINI_VOICE), provider);
    }

    return json(400, { error: 'unsupported_provider' });
  };

  return Object.assign(handle, { peekCredits: (): Credits => (eleven.apiKey ? credits.peek() : 'unknown') });
}

// ── Node wiring ─────────────────────────────────────────────────────────────

interface NodeReq {
  method?: string;
  setEncoding(enc: 'utf8'): void;
  on(event: 'data', fn: (chunk: string) => void): void;
  on(event: 'end' | 'error', fn: () => void): void;
  destroy(): void;
}

export interface NodeRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: Uint8Array | string): void;
}

/** Disk cache supporting both .wav and .mp3 */
export function diskCache(dir: string): TtsCache {
  const file = (key: string, ext = 'audio') => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('bad cache key');
    return join(dir, `${key}.${ext}`);
  };
  return {
    get: async (key) => {
      const wav = await readFile(file(key, 'wav')).catch(() => null);
      if (wav) return wav;
      const mp3 = await readFile(file(key, 'mp3')).catch(() => null);
      if (mp3) return mp3;
      return readFile(file(key, 'audio')).catch(() => null);
    },
    put: async (key, audio) => {
      await mkdir(dir, { recursive: true });
      const isWav = audio.length >= 4 && audio[0] === 0x52 && audio[1] === 0x49 && audio[2] === 0x46 && audio[3] === 0x46;
      await writeFile(file(key, isWav ? 'wav' : 'mp3'), audio);
    },
  };
}

function readJsonBody(req: NodeReq): Promise<unknown> {
  return new Promise((done) => {
    let raw = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES && !tooBig) {
        tooBig = true;
        req.destroy();
        done(null);
      }
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        done(JSON.parse(raw));
      } catch {
        done(null);
      }
    });
    req.on('error', () => done(null));
  });
}

/** Write a handler result to the Node response; `X-TTS-Provider` names the engine that spoke. */
export function sendTtsResult(res: NodeRes, result: TtsResult): void {
  res.statusCode = result.status;
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Cache-Control', 'no-store');
  if (result.cache) res.setHeader('X-TTS-Cache', result.cache);
  if (result.provider) res.setHeader('X-TTS-Provider', result.provider);
  res.end(result.body);
}

export type ProviderEntry = { id: VoiceProvider; label: string; voice: string | null; configured: boolean };
export type TtsStatus = { provider: VoiceProvider; voiceId: string; providers: ProviderEntry[]; credits: Credits };
export type TtsStatusInput = {
  requestedProvider: string | undefined;
  geminiKey: string | undefined;
  elevenKey: string | undefined;
  elevenVoiceId: string;
  geminiVoice: string;
  /** the Gemini guard's answer right now */
  geminiOk: boolean;
  /** cached credits (never fetched here) */
  credits: Credits;
};

/** The `GET /tts` body: the default provider, every picker entry, and the cached credits. */
export function ttsStatus(input: TtsStatusInput): TtsStatus {
  const { geminiKey, elevenKey, elevenVoiceId } = input;
  const current = pickDefaultProvider(input.requestedProvider, geminiKey, elevenKey, input.geminiOk);
  const defaultGemini = resolveGeminiVoice(input.geminiVoice);
  const providers: ProviderEntry[] = [
    { id: 'elevenlabs-auto', label: 'Auto', voice: null, configured: !!elevenKey },
    // one entry per pool voice (the user's own first, if set); `voice` is what the client sends back as voiceId
    ...voicePool(elevenVoiceId).map((v): ProviderEntry => ({
      id: 'elevenlabs',
      label: `ElevenLabs · ${v.label} (${v.lang === 'ja' ? '日本語' : 'English'})`,
      voice: v.voiceId,
      configured: !!elevenKey,
    })),
    // one entry per Gemini voice
    ...GEMINI_VOICE_OPTIONS.map((o): ProviderEntry => ({
      id: 'gemini',
      label: `Gemini · ${o.voiceName} (${o.style})`,
      voice: o.voiceName,
      configured: !!geminiKey,
    })),
    { id: 'gemini-argon', label: `Gemini Argon · ${defaultGemini}`, voice: defaultGemini, configured: !!geminiKey },
    // Japanese: each line is translated, then spoken by one of these voices
    ...GEMINI_JA_VOICES.map((v): ProviderEntry => ({
      id: 'gemini-ja',
      label: `日本語 · ${v} (${GEMINI_VOICE_OPTIONS.find((o) => o.voiceName === v)?.style ?? 'Japanese'})`,
      voice: v,
      configured: !!geminiKey,
    })),
    { id: 'browser', label: 'Browser voice', voice: null, configured: true },
  ];
  // voiceId = the default provider's voice (kept for older clients)
  const voiceId = providers.find((p) => p.id === current)?.voice ?? elevenVoiceId;
  return { provider: current, voiceId, providers, credits: input.credits };
}

function env(): Record<string, string | undefined> {
  return (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
}

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else {
      const comment = val.indexOf(' #');
      if (comment >= 0) val = val.slice(0, comment).trim();
    }
    out[key] = val;
  }
  return out;
}

function loadFileEnv(root: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local']) {
    try {
      Object.assign(merged, parseDotEnv(readFileSync(join(root, name), 'utf8')));
    } catch {
      // file absent
    }
  }
  return merged;
}

/** Vite plugin: `POST /tts` and `GET /tts` */
export function ttsPlugin(): Plugin {
  const install = (server: {
    config: { root: string; logger: { warn: (m: string) => void } };
    middlewares: { use: (route: string, fn: never) => void };
  }) => {
    const e = env();
    const fileEnv = loadFileEnv(server.config.root);

    // ElevenLabs:
    const elevenKey = e.ELEVENLABS_API_KEY ?? fileEnv.ELEVENLABS_API_KEY;
    const elevenVoiceId = e.ELEVENLABS_VOICE_ID ?? fileEnv.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
    const elevenModelId = e.ELEVENLABS_MODEL_ID ?? fileEnv.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;

    // Gemini:
    const geminiKey = e.GEMINI_API_KEY ?? fileEnv.GEMINI_API_KEY;
    const geminiVoice = e.GEMINI_VOICE_NAME ?? fileEnv.GEMINI_VOICE_NAME ?? DEFAULT_GEMINI_VOICE;
    const geminiTtsModel = e.GEMINI_TTS_MODEL ?? fileEnv.GEMINI_TTS_MODEL ?? DEFAULT_GEMINI_TTS_MODEL;
    const geminiArgonModel = e.GEMINI_ARGON_MODEL ?? fileEnv.GEMINI_ARGON_MODEL ?? DEFAULT_GEMINI_ARGON_MODEL;
    const geminiTranslateModel = e.GEMINI_TRANSLATE_MODEL ?? fileEnv.GEMINI_TRANSLATE_MODEL ?? DEFAULT_GEMINI_TRANSLATE_MODEL;

    const requestedProvider = e.TTS_PROVIDER ?? fileEnv.TTS_PROVIDER;
    // Read on every call, so GEMINI_TIER / GEMINI_BUDGET_LEFT_PCT edits apply without a restart.
    const geminiPolicy = (): GeminiPolicy => {
      const fileNow = loadFileEnv(server.config.root);
      const pct = (env().GEMINI_BUDGET_LEFT_PCT ?? fileNow.GEMINI_BUDGET_LEFT_PCT)?.trim();
      return { tier: env().GEMINI_TIER ?? fileNow.GEMINI_TIER, budgetLeftPct: pct ? Number(pct) : undefined };
    };
    const defaultProvider = pickDefaultProvider(requestedProvider, geminiKey, elevenKey, geminiAllowed(geminiPolicy(), Date.now()));

    server.config.logger.warn(
      `[tts] default=${defaultProvider} geminiKey=${geminiKey ? 'present' : 'missing'} elevenLabsKey=${elevenKey ? 'present' : 'missing'}`
    );

    const deps: TtsDeps = {
      fetch: (globalThis as unknown as { fetch: FetchLike }).fetch,
      cache: diskCache(resolve(server.config.root, '.tts-cache')),
      now: () => Date.now(),
      log: (m) => server.config.logger.warn(m),
      geminiPolicy,
    };

    let handler: TtsHandler | null = null;
    let handlerKey: string | undefined;
    /** The handler for the current keys (rebuilt when a key changes in .env / .env.local). */
    const currentHandler = (): { handler: TtsHandler; geminiKey: string | undefined; elevenKey: string | undefined } => {
      const fileNow = loadFileEnv(server.config.root);
      const activeGeminiKey = env().GEMINI_API_KEY ?? fileNow.GEMINI_API_KEY;
      const activeElevenKey = env().ELEVENLABS_API_KEY ?? fileNow.ELEVENLABS_API_KEY;
      const cacheCompositeKey = `${activeGeminiKey}:${activeElevenKey}`;
      if (!handler || handlerKey !== cacheCompositeKey) {
        handler = createTtsHandler(
          {
            elevenlabs: { apiKey: activeElevenKey, voiceId: elevenVoiceId, modelId: elevenModelId },
            gemini: { apiKey: activeGeminiKey, voiceName: geminiVoice, ttsModel: geminiTtsModel, argonModel: geminiArgonModel, translateModel: geminiTranslateModel },
            // a valid TTS_PROVIDER is fixed; otherwise the handler picks the default per request
            defaultProvider: isVoiceProvider(requestedProvider) ? requestedProvider : undefined,
          },
          deps,
        );
        handlerKey = cacheCompositeKey;
      }
      return { handler, geminiKey: activeGeminiKey, elevenKey: activeElevenKey };
    };

    const middleware = async (req: NodeReq, res: NodeRes) => {
      if (req.method === 'GET') {
        const current = currentHandler();
        const status = ttsStatus({
          requestedProvider,
          geminiKey: current.geminiKey,
          elevenKey: current.elevenKey,
          elevenVoiceId,
          geminiVoice,
          geminiOk: !!current.geminiKey && geminiAllowed(geminiPolicy(), Date.now()),
          credits: current.handler.peekCredits(),
        });
        sendTtsResult(res, json(200, { ...status }));
        return;
      }

      if (req.method !== 'POST') {
        sendTtsResult(res, json(405, { error: 'method_not_allowed' }));
        return;
      }

      const { handler: active } = currentHandler();
      try {
        sendTtsResult(res, await active(await readJsonBody(req)));
      } catch {
        sendTtsResult(res, json(500, { error: 'tts_failed' }));
      }
    };

    server.middlewares.use(TTS_ROUTE, middleware as never);
  };

  return {
    name: 'tour-tts',
    configureServer: (server) => install(server as never),
    configurePreviewServer: (server) => install(server as never),
  };
}
