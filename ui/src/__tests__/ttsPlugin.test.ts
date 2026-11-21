// @vitest-environment node
/**
 * Author: Japanese Work-Life Balancer team
 * Created: 2026-10-29
 * Scope: the dev server's POST /tts handler (ui/tts-plugin.ts) — input validation, the
 *        on-disk cache, upstream error mapping, rate limiting, and that the ElevenLabs key
 *        never appears in a response. Tested as a pure function: no server, mocked fetch.
 *        Also the Auto narration voice: the curated ElevenLabs pool, the credits check, the
 *        Gemini guard, the fallback chain, the X-TTS-Provider header and GET /tts.
 */
import {
  DEFAULT_MODEL_ID,
  DEFAULT_VOICE_ID,
  ELEVENLABS_VOICE_OPTIONS,
  GEMINI_JA_VOICES,
  MAX_TEXT_CHARS,
  JAPANESE_INSTRUCTION,
  createCreditsCache,
  createTtsHandler,
  fetchElevenCredits,
  geminiAllowed,
  pickDefaultProvider,
  pickElevenVoice,
  sendTtsResult,
  ttsCacheKey,
  ttsStatus,
  type Credits,
  type ElevenVoiceOption,
  type FetchLike,
  type GeminiPolicy,
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
    // the manual ElevenLabs path; Auto (the new default) has its own tests below
    { apiKey, voiceId: DEFAULT_VOICE_ID, modelId: DEFAULT_MODEL_ID, defaultProvider: 'elevenlabs' },
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
    expect(JSON.parse(init.body ?? '')).toEqual({
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
     * Scenario: the presenter picks another curated ElevenLabs narrator.
     * Slice: voice narration — caching.
     * Given the default voice is Lily, when the same text is keyed for Lily and for George (a pool
     * voice), then the keys differ, and a manual request for George calls George's own URL.
     */
    // -- Given --
    const text = 'Same line.';
    const george = ELEVENLABS_VOICE_OPTIONS.find((v) => v.label === 'George')!.voiceId;
    const fetch = vi.fn<FetchLike>(async () => upstream(200, MP3));
    const handle = createTtsHandler(
      { apiKey: KEY, voiceId: DEFAULT_VOICE_ID, modelId: DEFAULT_MODEL_ID },
      { fetch, cache: memoryCache(), now: () => 0 },
    );
    // -- When --
    await handle({ text, provider: 'elevenlabs', voiceId: george });
    // -- Then --
    expect(DEFAULT_VOICE_ID).toBe('pFZP5JQG7iQjIQuC4Bku');
    expect(ttsCacheKey(DEFAULT_VOICE_ID, DEFAULT_MODEL_ID, text)).not.toBe(ttsCacheKey(george, DEFAULT_MODEL_ID, text));
    expect(fetch.mock.calls[0][0]).toMatch(new RegExp(`/text-to-speech/${george}$`));
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
const sentBody = (fetch: ReturnType<typeof vi.fn>, i: number) => JSON.parse((fetch.mock.calls[i] as Parameters<FetchLike>)[1].body ?? '');

describe('POST /tts with Gemini providers', () => {
  it('defaults to Auto with an ElevenLabs key, else to Gemini only when its guard allows, else the browser voice', async () => {
    /**
     * Scenario: a line arrives without a provider.
     * Slice: Auto narration voice — default.
     * Given both keys, when a line arrives without a provider, then Auto speaks it with Lily on
     * ElevenLabs. Without an ElevenLabs key the default is Gemini only if the guard allows it,
     * else the browser voice; a valid TTS_PROVIDER still wins.
     */
    // -- Given --
    const { handle, fetch } = geminiSetup(async () => upstream(200, MP3));
    // -- When --
    const r = await handle({ text: 'Default voice.' });
    // -- Then --
    expect(r).toMatchObject({ status: 200, contentType: 'audio/mpeg', provider: 'elevenlabs' });
    expect(fetch.mock.calls.map(([u]) => u)).toContain(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}`);
    expect(pickDefaultProvider(undefined, GEMINI_KEY, KEY)).toBe('elevenlabs-auto');
    expect(pickDefaultProvider(undefined, GEMINI_KEY, undefined)).toBe('browser');
    expect(pickDefaultProvider(undefined, GEMINI_KEY, undefined, true)).toBe('gemini');
    expect(pickDefaultProvider(undefined, undefined, undefined, true)).toBe('browser');
    expect(pickDefaultProvider('gemini-argon', GEMINI_KEY, KEY)).toBe('gemini-argon');
    expect(pickDefaultProvider('nonsense', undefined, undefined)).toBe('browser');
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

// ── Auto narration voice (elevenlabs-auto) ──────────────────────────────────

const LILY = DEFAULT_VOICE_ID;
const ALICE = 'Xb7hH8MSUJpSbSDYk0k2';
const EN_LINE = 'Sato-san rests on Sunday.';
const JA_LINE = '佐藤さんは日曜日に休みます。';
const FULL: Credits = { used: 0, limit: 10_000, leftPct: 100 };
const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';
const subscription = (used: number, limit: number) =>
  upstream(200, JSON.stringify({ character_count: used, character_limit: limit, next_character_count_reset_unix: 0 }));
const isTts = (url: string) => url.includes('/text-to-speech/');
const isGeminiTts = (url: string) => url.includes('flash-tts:generateContent');

/** Auto handler: subscription calls answer `credits`, everything else goes to `tts`. */
function autoSetup(
  tts: FetchLike,
  opts: { credits?: () => Promise<UpstreamResponse>; policy?: GeminiPolicy; elevenKey?: string | null } = {},
) {
  const cache = memoryCache();
  const policy: GeminiPolicy = opts.policy ?? {};
  const fetch = vi.fn<FetchLike>(async (url, init) =>
    url === SUBSCRIPTION_URL ? (opts.credits ? opts.credits() : subscription(0, 10_000)) : tts(url, init),
  );
  const handle = createTtsHandler(
    { elevenlabs: { apiKey: opts.elevenKey === null ? undefined : (opts.elevenKey ?? KEY) }, gemini: { apiKey: GEMINI_KEY } },
    { fetch, cache, now: () => 0, log: vi.fn(), geminiPolicy: () => policy },
  );
  const urls = (match: (u: string) => boolean) => fetch.mock.calls.map(([u]) => u).filter(match);
  const geminiVoices = () =>
    fetch.mock.calls
      .filter(([u]) => isGeminiTts(u))
      .map(([, init]) => JSON.parse(init.body ?? '{}').generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName);
  return { handle, fetch, cache, policy, urls, geminiVoices };
}

function fakeRes() {
  const headers: Record<string, string> = {};
  return { headers, statusCode: 0, setHeader: (n: string, v: string) => void (headers[n] = v), end: vi.fn() };
}

describe('Auto narration voice', () => {
  const en: ElevenVoiceOption[] = ELEVENLABS_VOICE_OPTIONS.filter((v) => v.lang === 'en');
  it.each<[string, string, readonly ElevenVoiceOption[], Credits, string | null]>([
    ['an English line gets the top English voice', EN_LINE, ELEVENLABS_VOICE_OPTIONS, FULL, LILY],
    ['a Japanese line gets the top Japanese voice', JA_LINE, ELEVENLABS_VOICE_OPTIONS, FULL, ALICE],
    ['unknown credits fail open', EN_LINE, ELEVENLABS_VOICE_OPTIONS, 'unknown', LILY],
    ['below 10% left gets no voice', EN_LINE, ELEVENLABS_VOICE_OPTIONS, { used: 9_100, limit: 10_000, leftPct: 9 }, null],
    ['a line that would drop the account below 10% gets no voice', 'x'.repeat(200), ELEVENLABS_VOICE_OPTIONS, { used: 8_900, limit: 10_000, leftPct: 11 }, null],
    ['a Japanese line with an English-only pool gets no voice', JA_LINE, en, FULL, null],
    ['an empty pool gets no voice', EN_LINE, [], FULL, null],
  ])('pickElevenVoice: %s', (_name, text, pool, credits, expected) => {
    /**
     * Scenario: Auto chooses the ElevenLabs voice for one line.
     * Slice: Auto narration voice — voice pick.
     * Given a pool and the cached credits, when a line is checked, then it gets the best voice for
     * its language, or null (skip ElevenLabs) when credits are low or the language has no voice.
     */
    // -- Given / When --
    const voice = pickElevenVoice(text, pool, credits, text.length);
    // -- Then --
    expect(voice?.voiceId ?? null).toBe(expected);
  });

  it.each<[string, () => Promise<UpstreamResponse>, Credits, number]>([
    ['a good reply is parsed and kept 5 minutes', async () => subscription(2_500, 10_000), { used: 2_500, limit: 10_000, leftPct: 75 }, 300_000],
    ['an error reply is "unknown" and kept 60 seconds', async () => upstream(401, '{}'), 'unknown', 60_000],
    ['a network error is "unknown" and not retried on every line', async () => { throw new Error(`down ${KEY}`); }, 'unknown', 60_000],
  ])('fetchElevenCredits: %s', async (_name, reply, expected, ttl) => {
    /**
     * Scenario: Auto checks the ElevenLabs credits before speaking.
     * Slice: Auto narration voice — credits.
     * Given a subscription reply, when credits are read now, just before the cache expires, and
     * at expiry, then the value is parsed (or "unknown") and the network is called only twice.
     */
    // -- Given --
    let t = 0;
    const fetch = vi.fn<FetchLike>(reply);
    const credits = createCreditsCache(() => fetchElevenCredits(KEY, fetch), () => t);
    // -- When --
    const first = await credits.get();
    t = ttl - 1;
    await credits.get();
    const callsBeforeExpiry = fetch.mock.calls.length;
    t = ttl;
    await credits.get();
    // -- Then --
    expect(first).toEqual(expected);
    expect(callsBeforeExpiry).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe(SUBSCRIPTION_URL);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { 'xi-api-key': KEY } });
  });

  it.each<[string, GeminiPolicy & { coolingUntil?: number }, boolean]>([
    ['tier unset blocks Gemini', {}, false],
    ['free tier blocks Gemini', { tier: 'free' }, false],
    ['paid with no budget value allows Gemini', { tier: 'paid' }, true],
    ['paid with budget above 10% allows Gemini', { tier: 'paid', budgetLeftPct: 50 }, true],
    ['budget below 10% blocks Gemini', { tier: 'paid', budgetLeftPct: 9 }, false],
    ['a 429 cooldown blocks Gemini', { tier: 'paid', coolingUntil: 5_000 }, false],
  ])('geminiAllowed: %s', (_name, policy, expected) => {
    /**
     * Scenario: Auto decides whether Gemini may be spent on a line.
     * Slice: Auto narration voice — Gemini guard.
     * Given a tier, budget and cooldown, when checked at t = 0, then Gemini is allowed only on the
     * paid tier with budget unset or at least 10% and no cooldown.
     */
    // -- Given / When / Then --
    expect(geminiAllowed(policy, 0)).toBe(expected);
  });

  it('reads the Gemini tier and budget on every line, so edits apply without a restart', async () => {
    /**
     * Scenario: the presenter sets GEMINI_TIER=paid while the UI is running.
     * Slice: Auto narration voice — config per request.
     * Given no ElevenLabs key and no tier, when a line arrives the browser voice is chosen; after
     * the tier is set to paid the next line is spoken by Gemini; after the budget drops to 5% the
     * browser voice is chosen again.
     */
    // -- Given --
    const { handle, policy, urls } = autoSetup(async () => geminiAudio(), { elevenKey: null });
    // -- When --
    const before = await handle({ text: EN_LINE });
    policy.tier = 'paid';
    const paid = await handle({ text: EN_LINE });
    policy.budgetLeftPct = 5;
    const low = await handle({ text: 'Another line.' });
    // -- Then --
    expect(JSON.parse(asText(before))).toEqual({ fallback: true, provider: 'browser' });
    expect(paid).toMatchObject({ status: 200, contentType: 'audio/wav', provider: 'gemini' });
    expect(JSON.parse(asText(low))).toEqual({ fallback: true, provider: 'browser' });
    expect(urls(isGeminiTts)).toHaveLength(1);
  });

  it.each<[string, number, string, GeminiPolicy, string, 'gemini' | 'browser', string[], number]>([
    ['402 insufficient_credits goes to Gemini (Aoede)', 402,
      JSON.stringify({ detail: { type: 'payment_required', code: 'insufficient_credits', message: 'no credits', status: 'payment_required', request_id: 'r1' } }),
      { tier: 'paid' }, EN_LINE, 'gemini', ['Aoede', 'Aoede'], 1],
    ['401 quota_exceeded (old shape) goes to the browser voice', 401,
      JSON.stringify({ detail: { status: 'quota_exceeded', message: 'quota' } }), {}, EN_LINE, 'browser', [], 1],
    ['400 quota_exceeded on a Japanese line goes to a Japanese Gemini voice', 400,
      JSON.stringify({ detail: { type: 'invalid_request', code: 'quota_exceeded', message: 'quota' } }),
      { tier: 'paid' }, JA_LINE, 'gemini', [GEMINI_JA_VOICES[0], GEMINI_JA_VOICES[0]], 1],
    ['401 invalid_api_key falls back but does not mark credits exhausted', 401,
      JSON.stringify({ detail: { type: 'authentication_error', code: 'invalid_api_key', message: 'bad key' } }), {}, EN_LINE, 'browser', [], 2],
  ])('an ElevenLabs error inside Auto: %s, never a 502', async (_name, status, body, policy, text, served, geminiVoices, elevenCalls) => {
    /**
     * Scenario: ElevenLabs fails mid-tour.
     * Slice: Auto narration voice — quota errors and fallback.
     * Given ElevenLabs answers an error, when two lines are spoken with Auto, then both are served by
     * Gemini (if its guard allows) or the browser voice, the X-TTS-Provider header says which, and a
     * quota error keeps the second line off ElevenLabs (an invalid key does not).
     */
    // -- Given --
    const { handle, urls, geminiVoices: voices } = autoSetup(
      async (url) => (isTts(url) ? upstream(status, body) : geminiAudio()),
      { policy },
    );
    const res = fakeRes();
    // -- When --
    const first = await handle({ text, provider: 'elevenlabs-auto' });
    const second = await handle({ text: text + ' 2', provider: 'elevenlabs-auto' });
    sendTtsResult(res, first);
    // -- Then --
    expect([first.status, second.status]).toEqual([200, 200]);
    expect([first.provider, second.provider]).toEqual([served, served]);
    expect(res.headers['X-TTS-Provider']).toBe(served);
    expect(voices()).toEqual(geminiVoices);
    expect(urls(isTts)).toHaveLength(elevenCalls);
  });

  it('still reports a quota error to a manual ElevenLabs request, and Auto then skips ElevenLabs', async () => {
    /**
     * Scenario: the presenter picked "ElevenLabs · Lily" by hand and the credits run out.
     * Slice: Auto narration voice — quota errors.
     * Given ElevenLabs answers 402 insufficient_credits, when a manual line is asked, then it gets
     * 502 with that code; a following Auto line goes to the browser voice without calling ElevenLabs.
     */
    // -- Given --
    const body = JSON.stringify({ detail: { type: 'payment_required', code: 'insufficient_credits', message: 'no credits' } });
    const { handle, urls } = autoSetup(async () => upstream(402, body));
    // -- When --
    const manual = await handle({ text: EN_LINE, provider: 'elevenlabs' });
    const auto = await handle({ text: 'Next line.', provider: 'elevenlabs-auto' });
    // -- Then --
    expect(manual.status).toBe(502);
    expect(JSON.parse(asText(manual))).toEqual({ error: 'insufficient_credits', upstreamStatus: 402 });
    expect(JSON.parse(asText(auto))).toEqual({ fallback: true, provider: 'browser' });
    expect(urls(isTts)).toHaveLength(1);
  });

  it.each<[string, string, string]>([
    ['an English line uses Lily', EN_LINE, LILY],
    ['a Japanese line uses the Japanese pool voice', JA_LINE, ALICE],
  ])('elevenlabs-auto: %s, and a replay is a cache hit for that voice', async (_name, text, voiceId) => {
    /**
     * Scenario: the tour plays with Auto and plenty of credits.
     * Slice: Auto narration voice — handler.
     * Given credits at 100%, when a line is spoken twice, then the chosen voice is in the URL, the
     * audio is cached under that voice's key, and the replay is a hit with no second TTS call.
     */
    // -- Given --
    const { handle, cache, urls } = autoSetup(async () => upstream(200, MP3));
    // -- When --
    const first = await handle({ text, provider: 'elevenlabs-auto' });
    const replay = await handle({ text, provider: 'elevenlabs-auto' });
    // -- Then --
    expect(first).toMatchObject({ status: 200, contentType: 'audio/mpeg', cache: 'miss', provider: 'elevenlabs' });
    expect(replay).toMatchObject({ status: 200, cache: 'hit', provider: 'elevenlabs' });
    expect(urls(isTts)).toEqual([`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`]);
    expect([...cache.store.keys()]).toEqual([ttsCacheKey(voiceId, DEFAULT_MODEL_ID, text)]);
  });

  it('accepts only a curated or the configured voice for a manual ElevenLabs request', async () => {
    /**
     * Scenario: a client sends an arbitrary ElevenLabs voice id.
     * Slice: Auto narration voice — allow-list.
     * Given the pool, when a manual request names a pool voice, no voice, or an unknown voice, then
     * the first two are spoken and the unknown one gets 400 voice_not_allowed before any cache or
     * network access, so credits are never spent on it.
     */
    // -- Given --
    const { handle, cache, urls } = autoSetup(async () => upstream(200, MP3));
    const cacheGet = vi.spyOn(cache, 'get');
    // -- When --
    const pool = await handle({ text: EN_LINE, provider: 'elevenlabs', voiceId: ALICE });
    const configured = await handle({ text: EN_LINE, provider: 'elevenlabs' });
    const callsBefore = cacheGet.mock.calls.length;
    const unknown = await handle({ text: EN_LINE, provider: 'elevenlabs', voiceId: 'SomeRandomVoice' });
    // -- Then --
    expect([pool.status, configured.status]).toEqual([200, 200]);
    expect(unknown.status).toBe(400);
    expect(JSON.parse(asText(unknown))).toEqual({ error: 'voice_not_allowed' });
    expect(cacheGet.mock.calls.length).toBe(callsBefore);
    expect(urls(isTts)).toEqual([
      `https://api.elevenlabs.io/v1/text-to-speech/${ALICE}`,
      `https://api.elevenlabs.io/v1/text-to-speech/${LILY}`,
    ]);
  });

  it('GET /tts lists Auto and every curated voice, marks unkeyed entries, and returns credits without a network wait', async () => {
    /**
     * Scenario: the picker loads the voice list.
     * Slice: Auto narration voice — GET /tts.
     * Given no ElevenLabs key, when the status is built, then Auto and each pool voice are listed
     * unconfigured; given a key and a subscription reply that has not arrived, the credits are
     * "unknown" at once, and the cached value once the background refresh lands.
     */
    // -- Given --
    let arrive: (r: UpstreamResponse) => void = () => {};
    const { handle, fetch } = autoSetup(async () => upstream(200, MP3), {
      credits: () => new Promise<UpstreamResponse>((done) => (arrive = done)),
    });
    const base = { requestedProvider: undefined, geminiKey: GEMINI_KEY, elevenVoiceId: LILY, geminiVoice: 'Aoede', geminiOk: false };
    // -- When --
    const unkeyed = ttsStatus({ ...base, elevenKey: undefined, credits: 'unknown' });
    const peekNow = handle.peekCredits();
    arrive(subscription(2_500, 10_000));
    await new Promise((r) => setTimeout(r, 0));
    const keyed = ttsStatus({ ...base, elevenKey: KEY, credits: handle.peekCredits() });
    // -- Then --
    expect(ELEVENLABS_VOICE_OPTIONS[0]).toMatchObject({ voiceId: LILY, label: 'Lily', lang: 'en', rank: 1 });
    expect(ELEVENLABS_VOICE_OPTIONS.filter((v) => v.lang === 'en').length).toBeGreaterThanOrEqual(3);
    expect(ELEVENLABS_VOICE_OPTIONS.filter((v) => v.lang === 'ja').length).toBeGreaterThanOrEqual(2);
    expect(unkeyed.provider).toBe('browser');
    expect(unkeyed.providers[0]).toEqual({ id: 'elevenlabs-auto', label: 'Auto', voice: null, configured: false });
    expect(unkeyed.providers.filter((p) => p.id === 'elevenlabs')).toEqual(
      ELEVENLABS_VOICE_OPTIONS.map((v) => ({
        id: 'elevenlabs',
        label: `ElevenLabs · ${v.label} (${v.lang === 'ja' ? '日本語' : 'English'})`,
        voice: v.voiceId,
        configured: false,
      })),
    );
    expect(unkeyed.providers.filter((p) => p.id === 'gemini').every((p) => p.configured)).toBe(true);
    expect(peekNow).toBe('unknown');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(keyed).toMatchObject({ provider: 'elevenlabs-auto', credits: { used: 2_500, limit: 10_000, leftPct: 75 } });
    expect(keyed.providers[0].configured).toBe(true);
  });
});
