/**
 * Golden replay fixture tooling. Owner: BE2 (record/replay).
 *
 *   node server/test/golden.ts <recording.ndjson>     # scrub → server/test/fixtures/hqtest-10min.ndjson
 *                                                     # and regenerate …golden.ndjson (the WorldModel output stream)
 *   node server/test/golden.ts --regen                # only regenerate the golden stream from the committed fixture
 *
 * Scrubbing (the fixture is committed, recordings are not): every absolute or home path → `/p/<n>` (one number per
 * distinct path, consistent across the file), terminal titles, task titles, prompts, prompt questions/options, tool
 * details, todo text, subagent labels, commands in event details and agent session ids → `h<hash>`; raw herdr fields
 * the model never reads (`revision`, `scroll`) are dropped, and snapshots identical to the previous one (after
 * scrubbing) are dropped. The golden stream is the replay at `--speed 20` under FakeClock: `entity`/`gone`/`event`
 * messages with the volatile fields removed (`statusSince`, `activity.since`, ack `at`), times relative to the start.
 * A deliberate behaviour change regenerates the golden file with the reason in the commit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashHex } from '../../shared/identity.ts';
import { FakeClock } from '../clock.ts';
import { WorldModel } from '../world/model.ts';
import { createReplay, parseRecording } from '../record.ts';
import { S2R } from '../../shared/protocol.ts';
import { errMessage, isRecord } from '../../shared/guards.ts';
import type { ServerMsg } from '../../shared/protocol.ts';
import type { RecordLine } from '../record.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = path.join(HERE, 'fixtures', 'hqtest-10min.ndjson');
export const GOLDEN = path.join(HERE, 'fixtures', 'hqtest-10min.golden.ndjson');
export const GOLDEN_SPEED = 20;

/** Keys whose string values are free text (prompts, titles, questions, commands…) → hashed. */
const HASH_KEYS = new Set(['terminal_title', 'terminal_title_stripped', 'title', 'lastPrompt', 'detail', 'content', 'activeForm', 'label',
  'question', 'raw', 'cmd', 'text', 'description', 'value', 'argv', 'cmdline']);
/** Raw herdr fields the WorldModel never reads (and that churn every snapshot). */
const DROP_KEYS = new Set(['revision', 'scroll']);
/** Keys whose values are labels we keep (workspace/tab labels and agent names are part of the story, not secrets). */
const KEEP_IN = new Set(['workspaces', 'tabs']);
const PATH_RE = /(?:~|\/(?:home|root|tmp|Users|var|opt|srv|mnt|media|run|etc|usr))(?:\/[^\s"'`:;,()<>|]*)*/g;

export function makeScrubber(): { walk: <T>(v: T) => T; paths: Map<string, string> } {
  const paths = new Map<string, string>();
  const p = (s: string): string => {
    let v = paths.get(s);
    if (v === undefined) paths.set(s, (v = `/p/${paths.size + 1}`));
    return v;
  };
  const h = (s: string): string => (s ? `h${hashHex(s)}` : s);
  const scrubStr = (s: string): string => s.replace(PATH_RE, (m) => p(m));
  const scrub = (v: unknown, key: string | null, parent: string | null): unknown => {
    if (Array.isArray(v)) return v.map((x) => scrub(x, key, parent));
    if (isRecord(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (DROP_KEYS.has(k)) continue;
        out[k] = scrub(x, k, key);
      }
      return out;
    }
    if (typeof v !== 'string') return v;
    if (key === 'label' && KEEP_IN.has(parent ?? '')) return v; // workspace/tab labels
    if (key && HASH_KEYS.has(key)) return h(v);
    return scrubStr(v);
  };
  // the scrub only rewrites string leaves and drops DROP_KEYS: the value keeps its structure, so it keeps its type
  return { walk: <T>(v: T): T => scrub(v, null, null) as T, paths };
}

/** Scrub a raw recording's text into the committable fixture text. */
export function scrubRecording(text: string): string {
  const { header, items } = parseRecording(text);
  const S = makeScrubber();
  const nested = new Set(items.filter((x) => x.in != null).map((x) => x.in));
  const out = [JSON.stringify(S.walk({ ...header, session: 'hqtest' }))];
  let lastRaw: string | null = null;
  for (const it of items) {
    const s: RecordLine = S.walk(it);
    if (s.k === 'snapshot') {
      const j = JSON.stringify(s.raw);
      if (j === lastRaw && (s.n == null || !nested.has(s.n))) continue;
      lastRaw = j;
    } else if (s.k === 'status') lastRaw = JSON.stringify(s.raw);
    out.push(JSON.stringify(s));
  }
  return out.join('\n') + '\n';
}

/** Volatile fields out of an emitted message (a copy). */
function stable(m: ServerMsg): unknown {
  const c: unknown = structuredClone(m);
  const e = isRecord(c) ? c.entity : undefined;
  if (isRecord(e)) {
    delete e.statusSince;
    if (isRecord(e.activity)) delete e.activity.since;
    if (isRecord(e.ack)) delete e.ack.at;
  }
  return c;
}

/**
 * Replay a fixture at `speed` under FakeClock → the WorldModel's `entity`/`gone`/`event` stream (volatile fields
 * removed), as NDJSON lines `{at, m}` with `at` relative to the start.
 */
export async function goldenStream(text: string, speed = GOLDEN_SPEED): Promise<string[]> {
  const clock = new FakeClock();
  const t0 = clock.now();
  const { source, enrichers, demo } = createReplay({ text, clock, speed });
  const model = new WorldModel({ source, enrichers, clock, demo, dev: true });
  const lines: string[] = [];
  const keep = new Set<string>([S2R.ENTITY, S2R.GONE, S2R.EVENT]);
  model.on('msg', (m) => keep.has(m.t) && lines.push(JSON.stringify({ at: clock.now() - t0, m: stable(m) })));
  source.start();
  const end = source.items.at(-1)?.at ?? 0;
  const span = (end - (source.items[0]?.at ?? 0)) / speed + 5000;
  for (let t = 0; t < span && !source.done; t += 100) {
    clock.advance(100);
    for (let i = 0; i < 4; i++) await null;
  }
  clock.advance(1000);
  model.flush();
  model.close();
  await source.close();
  return lines;
}

async function main(argv: string[]): Promise<void> {
  const arg = argv[0];
  if (arg !== '--regen') {
    if (!arg) throw new Error('usage: node server/test/golden.ts <recording.ndjson> | --regen');
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, scrubRecording(fs.readFileSync(arg, 'utf8')));
  }
  const lines = await goldenStream(fs.readFileSync(FIXTURE, 'utf8'));
  fs.writeFileSync(GOLDEN, lines.join('\n') + '\n');
  console.log(`fixture ${fs.statSync(FIXTURE).size} B · golden ${lines.length} messages → ${path.relative(process.cwd(), GOLDEN)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(errMessage(e));
    process.exit(1);
  });
}
