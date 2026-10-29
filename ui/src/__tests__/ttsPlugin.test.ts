// @vitest-environment node
/**
 * Author: Japanese Work-Life Balancer team
 * Created: 2026-10-29
 * Scope: the dev server's POST /tts handler (ui/tts-plugin.ts) — input validation, the
 *        on-disk cache, upstream error mapping, rate limiting, and that the ElevenLabs key
 *        never appears in a response. Tested as a pure function: no server, mocked fetch.
 */
import {
  DEFAULT_MODEL_ID,
  DEFAULT_VOICE_ID,
  MAX_TEXT_CHARS,
  createTtsHandler,
  ttsCacheKey,
  type FetchLike,
  type TtsCache,
  type TtsResult,
  type UpstreamResponse,
} from '../../tts-plugin';

const KEY = 'placeholder-test-key';
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]);

function memoryCache(): TtsCache & { store: Map<string, Uint8Array> } {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => void store.set(k, v),
  };
}

function upstream(status: number, body: string | Uint8Array): UpstreamResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : ''),
    arrayBuffer: async () => (typeof body === 'string' ? new ArrayBuffer(0) : body.slice().buffer),
  };
}

function setup(fetchImpl: FetchLike, apiKey: string | undefined = KEY, perMinute = 30) {
  const cache = memoryCache();
  const fetch = vi.fn(fetchImpl);
  const log = vi.fn();
  const handle = createTtsHandler(
    { apiKey, voiceId: DEFAULT_VOICE_ID, modelId: DEFAULT_MODEL_ID },
    { fetch, cache, now: () => 0, log },
    perMinute,
  );
  return { handle, cache, fetch, log };
}

const asText = (r: TtsResult) => (typeof r.body === 'string' ? r.body : new TextDecoder().decode(r.body));

describe('POST /tts handler', () => {
  it('rejects text that is not a non-empty string of at most 600 characters', async () => {
    /**
     * Scenario: a caller sends junk to the route.
     * Slice: voice narration — server-side safety.
     * Given a configured handler, when the body is missing, not an object, a non-string,
     * blank, or longer than the limit, then each gets 400 invalid_text and ElevenLabs is
     * never called.
     */
    // -- Given --
    const { handle, fetch } = setup(async () => upstream(200, MP3));
    const bad = [null, 'hello', { text: 42 }, { text: ['a'] }, { text: '   ' }, { text: 'x'.repeat(MAX_TEXT_CHARS + 1) }];
    // -- When --
    const results = await Promise.all(bad.map((b) => handle(b)));
    // -- Then --
    for (const r of results) {
      expect(r.status).toBe(400);
      expect(JSON.parse(asText(r)).error).toBe('invalid_text');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls ElevenLabs once, then serves the same line from the cache', async () => {
    /**
     * Scenario: the tour is replayed.
     * Slice: voice narration — caching.
     * Given an upstream that returns mp3 bytes, when the same text is requested twice, then
     * the first is a miss that calls ElevenLabs with Lily + multilingual v2 (calm settings) and the key in
     * the xi-api-key header, and the second is a cache hit with the same bytes and no call.
     */
    // -- Given --
    const { handle, fetch, cache } = setup(async () => upstream(200, MP3));
    // -- When --
    const first = await handle({ text: 'Sato-san works 8 hours today.' });
    const second = await handle({ text: 'Sato-san works 8 hours today.' });
    // -- Then --
    expect(first).toMatchObject({ status: 200, contentType: 'audio/mpeg', cache: 'miss' });
    expect(second).toMatchObject({ status: 200, contentType: 'audio/mpeg', cache: 'hit' });
    expect(second.body).toEqual(MP3);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}`);
    expect(init.headers).toMatchObject({ 'xi-api-key': KEY, Accept: 'audio/mpeg' });
    expect(JSON.parse(init.body)).toEqual({
      text: 'Sato-san works 8 hours today.',
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    });
    expect([...cache.store.keys()]).toEqual([
      ttsCacheKey(DEFAULT_VOICE_ID, DEFAULT_MODEL_ID, 'Sato-san works 8 hours today.'),
    ]);
  });

  it('maps an upstream permission error to 502 with its code and never leaks the key', async () => {
    /**
     * Scenario: the key lacks the text_to_speech permission (today's real state).
     * Slice: voice narration — error path.
     * Given ElevenLabs answers 401 missing_permissions (echoing the key in its message),
     * when we request a line, then we answer 502 {error:"missing_permissions", upstreamStatus:401},
     * nothing is cached, and neither the response nor the log contains the key or the text.
     */
    // -- Given --
    const upstreamBody = JSON.stringify({
      detail: { status: 'missing_permissions', message: `The API key ${KEY} is missing text_to_speech` },
    });
    const { handle, cache, log } = setup(async () => upstream(401, upstreamBody));
    // -- When --
    const r = await handle({ text: 'A private sentence.' });
    // -- Then --
    expect(r.status).toBe(502);
    expect(JSON.parse(asText(r))).toEqual({ error: 'missing_permissions', upstreamStatus: 401 });
    expect(asText(r)).not.toContain(KEY);
    expect(cache.store.size).toBe(0);
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('private sentence');
  });

  it('answers 503 without a key, 503 when ElevenLabs is unreachable, and 429 past the rate limit', async () => {
    /**
     * Scenario: misconfiguration, network loss, and a runaway client.
     * Slice: voice narration — error path.
     * Given no key / a fetch that throws / a limit of 2 upstream calls per minute, when we
     * request lines, then we get tts_not_configured, upstream_unreachable and rate_limited.
     */
    // -- Given --
    const noKey = setup(async () => upstream(200, MP3), '');
    const down = setup(async () => {
      throw new Error(`connect ECONNREFUSED with ${KEY}`);
    });
    const limited = setup(async () => upstream(200, MP3), KEY, 2);
    // -- When --
    const a = await noKey.handle({ text: 'hello' });
    const b = await down.handle({ text: 'hello' });
    const c = [];
    for (const t of ['one', 'two', 'three']) c.push(await limited.handle({ text: t }));
    // -- Then --
    expect(a.status).toBe(503);
    expect(JSON.parse(asText(a)).error).toBe('tts_not_configured');
    expect(noKey.fetch).not.toHaveBeenCalled();
    expect(b.status).toBe(503);
    expect(asText(b)).toBe(JSON.stringify({ error: 'upstream_unreachable' }));
    expect(c.map((r) => r.status)).toEqual([200, 200, 429]);
  });

  it('keys the cache by voice, so switching voices never replays the old audio', async () => {
    /**
     * Scenario: the presenter sets ELEVENLABS_VOICE_ID to another narrator.
     * Slice: voice narration — caching.
     * Given the default voice is Lily, when the same text is keyed for Lily and for another
     * voice, then the keys differ, and the handler for the other voice calls its own URL.
     */
    // -- Given --
    const text = 'Same line.';
    const fetch = vi.fn(async () => upstream(200, MP3));
    const other = createTtsHandler(
      { apiKey: KEY, voiceId: 'OtherVoice123', modelId: DEFAULT_MODEL_ID },
      { fetch, cache: memoryCache(), now: () => 0 },
    );
    // -- When --
    await other({ text });
    // -- Then --
    expect(DEFAULT_VOICE_ID).toBe('pFZP5JQG7iQjIQuC4Bku');
    expect(ttsCacheKey(DEFAULT_VOICE_ID, DEFAULT_MODEL_ID, text)).not.toBe(
      ttsCacheKey('OtherVoice123', DEFAULT_MODEL_ID, text),
    );
    expect(fetch.mock.calls[0][0]).toMatch(/\/text-to-speech\/OtherVoice123$/);
  });
});
