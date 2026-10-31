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
  JAPANESE_INSTRUCTION,
  createTtsHandler,
  pickDefaultProvider,
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

// ── Gemini providers ────────────────────────────────────────────────────────

const GEMINI_KEY = 'placeholder-gemini-key';
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9]); // "RIFF…"
const geminiAudio = () => upstream(200, JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: btoa(String.fromCharCode(...WAV)) } }] } }] }));
const argonText = (answer: string) =>
  upstream(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: answer }] } }] }));

function geminiSetup(fetchImpl: FetchLike, elevenKey: string | undefined = KEY) {
  const fetch = vi.fn(fetchImpl);
  const handle = createTtsHandler(
    { elevenlabs: { apiKey: elevenKey }, gemini: { apiKey: GEMINI_KEY } },
    { fetch, cache: memoryCache(), now: () => 0, log: vi.fn() },
  );
  return { handle, fetch };
}
const sentBody = (fetch: ReturnType<typeof vi.fn>, i: number) => JSON.parse((fetch.mock.calls[i] as Parameters<FetchLike>)[1].body);

describe('POST /tts with Gemini providers', () => {
  it('keeps ElevenLabs as the default when both keys are set', async () => {
    /**
     * Scenario: a Gemini key is added next to the existing ElevenLabs key.
     * Slice: voice provider picker — no regression.
     * Given both keys, when a line arrives without a provider, then ElevenLabs speaks it.
     */
    // -- Given --
    const { handle, fetch } = geminiSetup(async () => upstream(200, MP3));
    // -- When --
    const r = await handle({ text: 'Default voice.' });
    // -- Then --
    expect(r.contentType).toBe('audio/mpeg');
    expect(fetch.mock.calls[0][0]).toMatch(/api\.elevenlabs\.io/);
    expect(pickDefaultProvider(undefined, GEMINI_KEY, undefined)).toBe('gemini');
    expect(pickDefaultProvider('gemini-argon', GEMINI_KEY, KEY)).toBe('gemini-argon');
    expect(pickDefaultProvider('nonsense', undefined, undefined)).toBe('elevenlabs');
  });

  it('speaks with Gemini TTS, sends the key in a header (never the URL), and caches the wav', async () => {
    /**
     * Scenario: the presenter picks Gemini.
     * Slice: voice provider picker — Gemini.
     * Given a Gemini key, when the same line is asked twice, then Gemini is called once
     * with the key in x-goog-api-key, and both answers are the decoded wav.
     */
    // -- Given --
    const { handle, fetch } = geminiSetup(async () => geminiAudio());
    // -- When --
    const first = await handle({ text: 'Rest matters.', provider: 'gemini' });
    const second = await handle({ text: 'Rest matters.', provider: 'gemini' });
    // -- Then --
    const [url, init] = fetch.mock.calls[0] as Parameters<FetchLike>;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(url).toMatch(/gemini-3\.8-flash-tts:generateContent$/);
    expect(url).not.toContain(GEMINI_KEY);
    expect(init.headers['x-goog-api-key']).toBe(GEMINI_KEY);
    expect(sentBody(fetch, 0).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Aoede');
    expect(first).toMatchObject({ status: 200, contentType: 'audio/wav', cache: 'miss' });
    expect(Array.from(first.body as Uint8Array)).toEqual(Array.from(WAV));
    expect(second.cache).toBe('hit');
  });

  it('with Gemini Argon, speaks Argon\'s answer (not its thoughts), or the original line if Argon fails', async () => {
    /**
     * Scenario: the presenter picks Gemini Argon for live commentary.
     * Slice: voice provider picker — Argon.
     * Given Argon answers with a thought part and an answer, when a line arrives, then the
     * TTS call speaks only the answer; given Argon fails, then the original line is spoken.
     */
    // -- Given --
    const ok = geminiSetup(async (url) => (url.includes('argon') ? argonText('Sato-san gets two days of rest.') : geminiAudio()));
    const down = geminiSetup(async (url) => (url.includes('argon') ? upstream(500, '{}') : geminiAudio()));
    // -- When --
    const r = await ok.handle({ text: 'Sato-san: 2 rest days.', provider: 'gemini-argon' });
    await down.handle({ text: 'Sato-san: 2 rest days.', provider: 'gemini-argon' });
    // -- Then --
    expect(r).toMatchObject({ status: 200, contentType: 'audio/wav' });
    expect(ok.fetch.mock.calls[0][0]).toMatch(/gemini-4-argon:generateContent$/);
    expect(sentBody(ok.fetch, 1).contents[0].parts[0].text).toBe('Sato-san gets two days of rest.');
    expect(sentBody(down.fetch, 1).contents[0].parts[0].text).toBe('Sato-san: 2 rest days.');
  });

  it('speaks exactly the line (no added direction) in the picked Gemini voice, and ignores junk voice names', async () => {
    /**
     * Scenario: the presenter picks "Gemini · Sulafat (warm)".
     * Slice: Gemini voice options.
     * Given a Gemini key, when Sulafat and a junk voice id are asked for the same line, then Sulafat
     * speaks it, the junk id falls back to Aoede, and only the line itself is sent (in-text directions
     * were read aloud in testing, so none is added).
     */
    // -- Given --
    const { handle, fetch } = geminiSetup(async () => geminiAudio());
    const line = 'Rest matters.';
    // -- When --
    await handle({ text: line, provider: 'gemini', voiceId: 'Sulafat' });
    await handle({ text: line, provider: 'gemini', voiceId: 'x y!' });
    // -- Then --
    const voice = (i: number) => sentBody(fetch, i).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName;
    const spoken = (i: number) => sentBody(fetch, i).contents[0].parts[0].text;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect([voice(0), spoken(0)]).toEqual(['Sulafat', line]);
    expect([voice(1), spoken(1)]).toEqual(['Aoede', line]);
  });

  it('for a Japanese voice, translates the line with the fast text model, then speaks the Japanese', async () => {
    /**
     * Scenario: the presenter picks "日本語 · Sulafat (warm)".
     * Slice: Japanese voices.
     * Given a Gemini key, when a line is asked for in gemini-ja with Sulafat, then the translate model
     * gets the line with the Japanese instruction, and Sulafat speaks the translation; when the
     * translation fails, the original line is spoken instead of going silent.
     */
    // -- Given --
    const ok = geminiSetup(async (url) => (url.includes('flash-tts') ? geminiAudio() : argonText('佐藤さんは二日間休みます。')));
    const down = geminiSetup(async (url) => (url.includes('flash-tts') ? geminiAudio() : upstream(500, '{}')));
    // -- When --
    const r = await ok.handle({ text: 'Sato-san gets 2 days off.', provider: 'gemini-ja', voiceId: 'Sulafat' });
    await down.handle({ text: 'Sato-san gets 2 days off.', provider: 'gemini-ja', voiceId: 'Sulafat' });
    // -- Then --
    expect(r).toMatchObject({ status: 200, contentType: 'audio/wav' });
    expect(ok.fetch.mock.calls[0][0]).toMatch(/gemini-3\.8-flash:generateContent$/);
    expect(sentBody(ok.fetch, 0).systemInstruction.parts[0].text).toBe(JAPANESE_INSTRUCTION);
    expect(sentBody(ok.fetch, 1).contents[0].parts[0].text).toBe('佐藤さんは二日間休みます。');
    expect(sentBody(ok.fetch, 1).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Sulafat');
    expect(sentBody(down.fetch, 1).contents[0].parts[0].text).toBe('Sato-san gets 2 days off.');
  });

  it('passes on Gemini\'s 429 wait and stays off Gemini until that wait is over', async () => {
    /**
     * Scenario: the Gemini key hits its per-minute limit mid-tour.
     * Slice: voice narration — rate-limit recovery.
     * Given Gemini answers 429 RESOURCE_EXHAUSTED with retryDelay "17s", when a line is asked,
     * then we answer 429 with retryAfterMs 17000; a line asked 5 s later gets 429 with the
     * remaining 12000 ms and no upstream call; a line asked after the wait reaches Gemini again.
     */
    // -- Given --
    let t = 0;
    const exhausted = upstream(429, JSON.stringify({
      error: { status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }] },
    }));
    const fetch = vi.fn<FetchLike>().mockResolvedValueOnce(exhausted).mockResolvedValue(geminiAudio());
    const handle = createTtsHandler({ gemini: { apiKey: GEMINI_KEY } }, { fetch, cache: memoryCache(), now: () => t, log: vi.fn() });
    // -- When --
    const first = await handle({ text: 'One.', provider: 'gemini' });
    t = 5_000;
    const cooling = await handle({ text: 'Two.', provider: 'gemini' });
    t = 17_000;
    const after = await handle({ text: 'Three.', provider: 'gemini' });
    // -- Then --
    expect(first.status).toBe(429);
    expect(JSON.parse(asText(first))).toEqual({
      error: 'rate_limited', upstreamStatus: 429, upstreamError: 'resource_exhausted', retryAfterMs: 17_000,
    });
    expect(cooling.status).toBe(429);
    expect(JSON.parse(asText(cooling)).retryAfterMs).toBe(12_000);
    expect(after).toMatchObject({ status: 200, contentType: 'audio/wav' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('answers 503 for a Gemini request when there is no Gemini key', async () => {
    /**
     * Scenario: Gemini is picked but GEMINI_API_KEY is not set.
     * Slice: voice provider picker — fallback.
     * Given no Gemini key, when Gemini is asked, then 503 and no upstream call (the
     * browser voice takes over in the UI).
     */
    // -- Given --
    const fetch = vi.fn(async () => geminiAudio());
    const handle = createTtsHandler({ elevenlabs: { apiKey: KEY } }, { fetch, cache: memoryCache(), now: () => 0 });
    // -- When --
    const r = await handle({ text: 'Hello.', provider: 'gemini' });
    // -- Then --
    expect(r.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
