// Records the guided-tour fallback fixtures from a running model (default http://localhost:8083).
// Usage: node scripts/record-tour-fixtures.mjs   (run from ui/; solves run sequentially, 10 s each)
import { writeFileSync, mkdirSync } from 'node:fs';

const MODEL = process.env.MODEL_URL ?? 'http://localhost:8083';
const OUT = new URL('../src/tour/fixtures/', import.meta.url);
const RUNS = [
  ['burnout', 'cost-first'],
  ['burnout', 'health-first'],
  ['overloaded', 'health-first'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function record(scenario, preset) {
  const res = await fetch(`${MODEL}/schedules/scenario/${scenario}?preset=${preset}&limitSeconds=10`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  const id = (await res.text()).trim().replace(/^"|"$/g, '');
  const start = Date.now();
  const progress = [];
  for (;;) {
    await sleep(2000);
    const r = await (await fetch(`${MODEL}/schedules/${id}`)).json();
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (r.score && progress.at(-1)?.score !== r.score) progress.push({ elapsed, score: r.score, kpis: r.kpis });
    if (r.status === 'NOT_SOLVING') {
      mkdirSync(OUT, { recursive: true });
      const file = new URL(`${scenario}-${preset}.json`, OUT);
      writeFileSync(file, JSON.stringify({ scenario, preset, recordedAt: new Date().toISOString(), progress, final: r }));
      console.log(scenario, preset, r.score, 'steps', progress.length, JSON.stringify(r.kpis));
      return;
    }
    if (Date.now() - start > 60000) throw new Error('timeout');
  }
}

for (const [s, p] of RUNS) await record(s, p);
