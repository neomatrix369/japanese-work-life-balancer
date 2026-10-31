/// <reference path="./tts-node.d.ts" />
/**
 * Server-side text-to-speech for the guided tour's narration.
 *
 * Supports multiple voice providers:
 *  - Gemini TTS (gemini-3.8-flash-tts with Aoede/Kore/Puck)
 *  - Gemini Argon (gemini-4-argon commentary + gemini-3.8-flash-tts)
 *  - ElevenLabs ("Lily", eleven_multilingual_v2)
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

// Gemini defaults
export const DEFAULT_GEMINI_VOICE = 'Aoede'; // breezy, natural long-form voice
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_GEMINI_ARGON_MODEL = 'gemini-4-argon';

export const VOICE_SETTINGS = { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } as const;
export const MAX_TEXT_CHARS = 600;
export const MAX_UPSTREAM_PER_MINUTE = 30;
const MAX_BODY_BYTES = 8 * 1024;
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type VoiceProvider = 'gemini' | 'gemini-argon' | 'elevenlabs' | 'browser';

export interface GeminiConfig {
  apiKey?: string | undefined;
  voiceName?: string | undefined;
  ttsModel?: string | undefined;
  argonModel?: string | undefined;
}

export interface ElevenLabsConfig {
  apiKey?: string | undefined;
  voiceId?: string | undefined;
  modelId?: string | undefined;
}

export interface TtsConfig {
  elevenlabs?: ElevenLabsConfig;
  gemini?: GeminiConfig;
  defaultProvider?: VoiceProvider;
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
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<UpstreamResponse>;

export interface TtsCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, audio: Uint8Array): Promise<void>;
}

export interface TtsDeps {
  fetch: FetchLike;
  cache: TtsCache;
  now: () => number;
  log?: (msg: string) => void;
}

export interface TtsResult {
  status: number;
  contentType: 'audio/mpeg' | 'audio/wav' | 'application/json';
  body: Uint8Array | string;
  cache?: 'hit' | 'miss';
}

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

const PROVIDERS: readonly VoiceProvider[] = ['elevenlabs', 'gemini', 'gemini-argon', 'browser'];

export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Default voice when the caller does not pick one: TTS_PROVIDER if valid, else ElevenLabs
 * when its key is set (the original narrator), else Gemini when its key is set. With no keys
 * it stays ElevenLabs, so the route answers 503 and the browser voice takes over.
 */
export function pickDefaultProvider(
  requested: string | undefined,
  geminiKey: string | undefined,
  elevenKey: string | undefined,
): VoiceProvider {
  if (isVoiceProvider(requested)) return requested;
  if (elevenKey) return 'elevenlabs';
  if (geminiKey) return 'gemini';
  return 'elevenlabs';
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

async function upstreamErrorCode(res: UpstreamResponse): Promise<string> {
  try {
    const parsed = JSON.parse(await res.text()) as { detail?: { status?: unknown }; error?: { message?: unknown; status?: unknown } };
    const code = parsed?.detail?.status ?? parsed?.error?.status;
    if (typeof code === 'string' && /^[a-z0-9_]{1,64}$/i.test(code)) return code.toLowerCase();
  } catch {
    // non-JSON body
  }
  return 'upstream_error';
}

function rateLimiter(perMinute: number, now: () => number) {
  const calls: number[] = [];
  return () => {
    const t = now();
    while (calls.length > 0 && t - calls[0] >= 60_000) calls.shift();
    if (calls.length >= perMinute) return false;
    calls.push(t);
    return true;
  };
}

export function createTtsHandler(
  config: TtsConfig,
  deps: TtsDeps,
  perMinute: number = MAX_UPSTREAM_PER_MINUTE,
): (body: unknown) => Promise<TtsResult> {
  const allow = rateLimiter(perMinute, deps.now);

  const eleven: ElevenLabsConfig = {
    apiKey: config.elevenlabs?.apiKey ?? config.apiKey,
    voiceId: config.elevenlabs?.voiceId ?? config.voiceId ?? DEFAULT_VOICE_ID,
    modelId: config.elevenlabs?.modelId ?? config.modelId ?? DEFAULT_MODEL_ID,
  };

  const gemini: GeminiConfig = {
    apiKey: config.gemini?.apiKey,
    voiceName: config.gemini?.voiceName ?? DEFAULT_GEMINI_VOICE,
    ttsModel: config.gemini?.ttsModel ?? DEFAULT_GEMINI_TTS_MODEL,
    argonModel: config.gemini?.argonModel ?? DEFAULT_GEMINI_ARGON_MODEL,
  };

  const defaultProvider = config.defaultProvider ?? pickDefaultProvider(undefined, gemini.apiKey, eleven.apiKey);

  return async (body) => {
    const parsedReq = parseTtsBody(body);
    if (parsedReq === null) return json(400, { error: 'invalid_text', maxChars: MAX_TEXT_CHARS });

    const { text } = parsedReq;
    const provider = parsedReq.provider ?? defaultProvider;

    if (provider === 'browser') {
      return json(200, { fallback: true, provider: 'browser' });
    }

    if (provider === 'elevenlabs') {
      const voiceId = parsedReq.voiceId ?? eleven.voiceId ?? DEFAULT_VOICE_ID;
      const modelId = eleven.modelId ?? DEFAULT_MODEL_ID;
      // Keyed by voiceId + modelId + text (backward-compatible cache key format)
      const key = ttsCacheKey(voiceId, modelId, text);
      const cached = await deps.cache.get(key).catch(() => null);
      if (cached) return { status: 200, contentType: 'audio/mpeg', body: cached, cache: 'hit' };

      if (!eleven.apiKey) return json(503, { error: 'tts_not_configured' });
      if (!allow()) return json(429, { error: 'rate_limited' });

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

      if (!res.ok) {
        const code = await upstreamErrorCode(res);
        deps.log?.(`[tts] elevenlabs upstream ${res.status} ${code}`);
        return json(502, { error: code, upstreamStatus: res.status });
      }

      const audio = new Uint8Array(await res.arrayBuffer());
      await deps.cache.put(key, audio).catch(() => deps.log?.('[tts] cache write failed'));
      return { status: 200, contentType: 'audio/mpeg', body: audio, cache: 'miss' };
    }

    // Gemini provider (direct or argon-augmented)
    if (provider === 'gemini' || provider === 'gemini-argon') {
      const voiceName = parsedReq.voiceId ?? gemini.voiceName ?? DEFAULT_GEMINI_VOICE;
      const ttsModel = gemini.ttsModel ?? DEFAULT_GEMINI_TTS_MODEL;
      const argonModel = gemini.argonModel ?? DEFAULT_GEMINI_ARGON_MODEL;

      const key = provider === 'gemini-argon'
        ? ttsCacheKey(voiceName, `${argonModel}+${ttsModel}`, text, 'gemini-argon')
        : ttsCacheKey(voiceName, ttsModel, text, 'gemini');
      // Key in a header, never in the URL (URLs end up in proxy and server logs).
      const geminiHeaders = { 'Content-Type': 'application/json', 'x-goog-api-key': gemini.apiKey ?? '' };

      const cached = await deps.cache.get(key).catch(() => null);
      if (cached) return { status: 200, contentType: 'audio/wav', body: cached, cache: 'hit' };

      if (!gemini.apiKey) return json(503, { error: 'tts_not_configured' });
      if (!allow()) return json(429, { error: 'rate_limited' });

      let textToSpeak = text;

      // When Argon mode is active, query gemini-4-argon to produce spoken commentary
      if (provider === 'gemini-argon') {
        try {
          const argonRes = await deps.fetch(`${GEMINI_API_BASE}/${encodeURIComponent(argonModel)}:generateContent`, {
            method: 'POST',
            headers: geminiHeaders,
            body: JSON.stringify({
              systemInstruction: {
                parts: [{
                  text: 'You are an empathetic workplace wellbeing narrator for a Japanese work-life balance dashboard. Rephrase the input into one or two natural, spoken sentences highlighting human wellbeing, rest, and safety. Do not output markdown, bullet points, or commentary prefixes.'
                }],
              },
              contents: [{ parts: [{ text }] }],
            }),
          });
          if (argonRes.ok) {
            const parsed = JSON.parse(await argonRes.text()) as {
              candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
            };
            // Argon is a thinking model: skip any "thought" parts, speak only the answer.
            const generated = (parsed.candidates?.[0]?.content?.parts ?? [])
              .filter((p) => !p.thought && typeof p.text === 'string')
              .map((p) => p.text)
              .join(' ')
              .trim();
            if (generated) textToSpeak = generated;
          } else {
            deps.log?.(`[tts] argon commentary ${argonRes.status}, speaking the original text`);
          }
        } catch {
          deps.log?.('[tts] argon commentary step failed, falling back to direct text');
        }
      }

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

      if (!res.ok) {
        const code = await upstreamErrorCode(res);
        deps.log?.(`[tts] gemini upstream ${res.status} ${code}`);
        return json(502, { error: code, upstreamStatus: res.status });
      }

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
      return { status: 200, contentType: 'audio/wav', body: audio, cache: 'miss' };
    }

    return json(400, { error: 'unsupported_provider' });
  };
}

// ── Node wiring ─────────────────────────────────────────────────────────────

interface NodeReq {
  method?: string;
  setEncoding(enc: 'utf8'): void;
  on(event: 'data', fn: (chunk: string) => void): void;
  on(event: 'end' | 'error', fn: () => void): void;
  destroy(): void;
}

interface NodeRes {
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

function send(res: NodeRes, result: TtsResult) {
  res.statusCode = result.status;
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Cache-Control', 'no-store');
  if (result.cache) res.setHeader('X-TTS-Cache', result.cache);
  res.end(result.body);
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

    const requestedProvider = e.TTS_PROVIDER ?? fileEnv.TTS_PROVIDER;
    const defaultProvider = pickDefaultProvider(requestedProvider, geminiKey, elevenKey);

    server.config.logger.warn(
      `[tts] default=${defaultProvider} geminiKey=${geminiKey ? 'present' : 'missing'} elevenLabsKey=${elevenKey ? 'present' : 'missing'}`
    );

    const deps: TtsDeps = {
      fetch: (globalThis as unknown as { fetch: FetchLike }).fetch,
      cache: diskCache(resolve(server.config.root, '.tts-cache')),
      now: () => Date.now(),
      log: (m) => server.config.logger.warn(m),
    };

    let handler: ((body: unknown) => Promise<TtsResult>) | null = null;
    let handlerKey: string | undefined;

    const middleware = async (req: NodeReq, res: NodeRes) => {
      if (req.method === 'GET') {
        const fileNow = loadFileEnv(server.config.root);
        const currentGeminiKey = env().GEMINI_API_KEY ?? fileNow.GEMINI_API_KEY;
        const currentElevenKey = env().ELEVENLABS_API_KEY ?? fileNow.ELEVENLABS_API_KEY;
        const current = pickDefaultProvider(requestedProvider, currentGeminiKey, currentElevenKey);
        const providers = [
          { id: 'elevenlabs', label: 'ElevenLabs', voice: elevenVoiceId, configured: !!currentElevenKey },
          { id: 'gemini', label: 'Gemini', voice: geminiVoice, configured: !!currentGeminiKey },
          { id: 'gemini-argon', label: 'Gemini Argon', voice: geminiVoice, configured: !!currentGeminiKey },
          { id: 'browser', label: 'Browser voice', voice: null, configured: true },
        ];
        // voiceId = the default provider's voice (kept for older clients)
        const voiceId = providers.find((p) => p.id === current)?.voice ?? elevenVoiceId;
        send(res, json(200, { provider: current, voiceId, providers }));
        return;
      }

      if (req.method !== 'POST') {
        send(res, json(405, { error: 'method_not_allowed' }));
        return;
      }

      const activeEnv = loadFileEnv(server.config.root);
      const activeGeminiKey = env().GEMINI_API_KEY ?? activeEnv.GEMINI_API_KEY;
      const activeElevenKey = env().ELEVENLABS_API_KEY ?? activeEnv.ELEVENLABS_API_KEY;
      const cacheCompositeKey = `${activeGeminiKey}:${activeElevenKey}`;

      if (!handler || handlerKey !== cacheCompositeKey) {
        handler = createTtsHandler(
          {
            elevenlabs: { apiKey: activeElevenKey, voiceId: elevenVoiceId, modelId: elevenModelId },
            gemini: { apiKey: activeGeminiKey, voiceName: geminiVoice, ttsModel: geminiTtsModel, argonModel: geminiArgonModel },
            defaultProvider: pickDefaultProvider(requestedProvider, activeGeminiKey, activeElevenKey),
          },
          deps,
        );
        handlerKey = cacheCompositeKey;
      }

      try {
        send(res, await handler(await readJsonBody(req)));
      } catch {
        send(res, json(500, { error: 'tts_failed' }));
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
