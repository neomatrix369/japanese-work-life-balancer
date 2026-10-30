/// <reference path="./tts-node.d.ts" />
/**
 * Server-side text-to-speech for the guided tour's narration.
 *
 * Default voice: ElevenLabs "Lily" (override with ELEVENLABS_VOICE_ID / ELEVENLABS_MODEL_ID).
 * The ElevenLabs API key must never reach the browser or the bundle, so the browser posts
 * `{ text }` to `POST /tts` on the Vite dev/preview server and this plugin calls ElevenLabs.
 * Audio is cached on disk by sha256(voice + model + text), so a replayed tour costs nothing.
 *
 * The request logic lives in `createTtsHandler` (pure, dependencies injected) so it can be
 * unit-tested without a server; `ttsPlugin` only wires it to Node's req/res.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export const TTS_ROUTE = '/tts';
export const DEFAULT_VOICE_ID = 'pFZP5JQG7iQjIQuC4Bku'; // "Lily" — warm, gentle British narrator
export const DEFAULT_MODEL_ID = 'eleven_multilingual_v2'; // says Japanese names like "Sato-san" well
/** calm delivery for a story about wellbeing and burnout */
export const VOICE_SETTINGS = { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } as const;
export const MAX_TEXT_CHARS = 600;
export const MAX_UPSTREAM_PER_MINUTE = 30;
const MAX_BODY_BYTES = 8 * 1024;
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// ── Pure handler ────────────────────────────────────────────────────────────

export interface TtsConfig {
  apiKey: string | undefined;
  voiceId: string;
  modelId: string;
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
  /** one-line diagnostics; never receives the key or the text */
  log?: (msg: string) => void;
}

export interface TtsResult {
  status: number;
  contentType: 'audio/mpeg' | 'application/json';
  body: Uint8Array | string;
  cache?: 'hit' | 'miss';
}

/** Voice, model and delivery settings are part of the key, so switching voices never replays old audio. */
export function ttsCacheKey(voiceId: string, modelId: string, text: string): string {
  return createHash('sha256')
    .update(`${voiceId}\n${modelId}\n${JSON.stringify(VOICE_SETTINGS)}\n${text}`)
    .digest('hex');
}

const json = (status: number, payload: Record<string, unknown>): TtsResult => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(payload),
});

/** Validated narration text, or null. */
export function parseTtsText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const text = (body as { text?: unknown }).text;
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TEXT_CHARS ? trimmed : null;
}

/** ElevenLabs puts a machine-readable code in `detail.status`; keep it only if it is a plain slug. */
async function upstreamErrorCode(res: UpstreamResponse): Promise<string> {
  try {
    const parsed = JSON.parse(await res.text()) as { detail?: { status?: unknown } };
    const code = parsed?.detail?.status;
    if (typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code)) return code;
  } catch {
    // non-JSON error body — fall through
  }
  return 'upstream_error';
}

/** Sliding one-minute window over upstream calls (cache hits are free and not counted). */
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
  return async (body) => {
    const text = parseTtsText(body);
    if (text === null) return json(400, { error: 'invalid_text', maxChars: MAX_TEXT_CHARS });

    const key = ttsCacheKey(config.voiceId, config.modelId, text);
    const cached = await deps.cache.get(key).catch(() => null);
    if (cached) return { status: 200, contentType: 'audio/mpeg', body: cached, cache: 'hit' };

    if (!config.apiKey) return json(503, { error: 'tts_not_configured' });
    if (!allow()) return json(429, { error: 'rate_limited' });

    let res: UpstreamResponse;
    try {
      res = await deps.fetch(`${ELEVENLABS_URL}/${encodeURIComponent(config.voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': config.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({ text, model_id: config.modelId, voice_settings: VOICE_SETTINGS }),
      });
    } catch {
      deps.log?.('[tts] upstream unreachable');
      return json(503, { error: 'upstream_unreachable' });
    }
    if (!res.ok) {
      const code = await upstreamErrorCode(res);
      deps.log?.(`[tts] upstream ${res.status} ${code}`);
      return json(502, { error: code, upstreamStatus: res.status });
    }
    const audio = new Uint8Array(await res.arrayBuffer());
    await deps.cache.put(key, audio).catch(() => deps.log?.('[tts] cache write failed'));
    return { status: 200, contentType: 'audio/mpeg', body: audio, cache: 'miss' };
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

/** Disk cache in `dir/<sha256>.mp3`. Keys are our own hex digests, so no path tricks. */
export function diskCache(dir: string): TtsCache {
  const file = (key: string) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('bad cache key');
    return join(dir, `${key}.mp3`);
  };
  return {
    get: (key) => readFile(file(key)).catch(() => null),
    put: async (key, audio) => {
      await mkdir(dir, { recursive: true });
      await writeFile(file(key), audio);
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

/** Parse KEY=VALUE lines; handles `#` comments and single/double-quoted values. */
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

/**
 * Load .env then .env.local from `root` — .env.local wins on conflict.
 * Shell process.env takes priority over both; this is only the file fallback.
 */
function loadFileEnv(root: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const name of ['.env', '.env.local']) {
    try {
      Object.assign(merged, parseDotEnv(readFileSync(join(root, name), 'utf8')));
    } catch {
      // file absent — skip
    }
  }
  return merged;
}

/** Vite plugin: `POST /tts` on the dev and preview servers. Reads the key per request. */
export function ttsPlugin(): Plugin {
  const install = (server: {
    config: { root: string; logger: { warn: (m: string) => void } };
    middlewares: { use: (route: string, fn: never) => void };
  }) => {
    const e = env();
    const fileEnv = loadFileEnv(server.config.root);
    // Priority: shell env → .env.local → .env → built-in default
    const voiceId = e.ELEVENLABS_VOICE_ID ?? fileEnv.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
    const modelId = e.ELEVENLABS_MODEL_ID ?? fileEnv.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;
    const hasKey = !!(e.ELEVENLABS_API_KEY ?? fileEnv.ELEVENLABS_API_KEY);
    server.config.logger.warn(
      `[tts] voice=${voiceId} model=${modelId} apiKey=${hasKey ? 'present' : 'MISSING — POST /tts will return 503'}`
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
        send(res, json(200, { voiceId, modelId }));
        return;
      }
      if (req.method !== 'POST') {
        send(res, json(405, { error: 'method_not_allowed' }));
        return;
      }
      const apiKey = env().ELEVENLABS_API_KEY ?? fileEnv.ELEVENLABS_API_KEY;
      if (!handler || handlerKey !== apiKey) {
        handler = createTtsHandler({ apiKey, voiceId, modelId }, deps);
        handlerKey = apiKey;
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
