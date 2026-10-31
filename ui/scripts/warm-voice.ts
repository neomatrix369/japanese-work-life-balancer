// Pre-records the tour's fixed narration lines into the dev server's on-disk TTS cache
// (ui/.tts-cache), so the tour opens with no Gemini/ElevenLabs wait and spends no quota on them.
// Lines with live solver numbers change every run, so they are not warmed.
//
// Usage (UI must be running):  make warm-voice [PROVIDER=gemini|gemini-argon|elevenlabs]
//   or from ui/:               npx vite-node scripts/warm-voice.ts -- gemini
// Requests go one at a time; a 429 waits the server's retryAfterMs and tries again.
import { TOUR_STEPS } from '../src/tour/steps';
import { fixedLines } from '../src/tour/useTourVoice';
import { isVoiceProvider } from '../src/tour/voice';
import costRun from '../src/tour/fixtures/burnout-cost-first.json';

const UI = process.env.UI_URL ?? 'http://localhost:5173';
const MAX_TRIES = 4;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Returns 'hit' | 'miss', or throws with the server's reason. */
async function warm(text: string, provider: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${UI}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, provider }),
    });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('audio')) {
      await res.arrayBuffer();
      return res.headers.get('x-tts-cache') ?? 'ok';
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfterMs?: number };
    if (res.status !== 429 || attempt >= MAX_TRIES) throw new Error(`${res.status} ${body.error ?? 'unknown'}`);
    const wait = body.retryAfterMs ?? 10_000;
    console.log(`    rate limited, waiting ${Math.ceil(wait / 1000)} s…`);
    await sleep(wait);
  }
}

async function main(): Promise<void> {
  const provider = process.argv.slice(2).find((a) => a !== '--') ?? 'gemini';
  if (!isVoiceProvider(provider) || provider === 'browser') {
    console.error(`Unknown provider "${provider}". Use gemini, gemini-argon or elevenlabs.`);
    process.exit(2);
  }
  const lines = fixedLines(TOUR_STEPS, costRun.final.schedule.employees.length);
  console.log(`Warming ${lines.length} fixed tour lines for ${provider} via ${UI}/tts`);
  let failed = 0;
  for (const [i, line] of lines.entries()) {
    try {
      console.log(`  ${i + 1}/${lines.length} ${await warm(line, provider)}`);
    } catch (e) {
      failed++;
      console.log(`  ${i + 1}/${lines.length} failed: ${(e as Error).message}`);
    }
  }
  if (failed > 0) {
    console.error(`${failed} line(s) not cached. Is the UI running (make ui) and the key set?`);
    process.exit(1);
  }
  console.log('Done: these lines now play instantly.');
}

main().catch((e: unknown) => {
  console.error(`warm-voice: ${(e as Error).message} (is the UI running on ${UI}?)`);
  process.exit(1);
});
