#!/usr/bin/env node
/** Demo-only dev server (Vite + in-process demo backend). Production output is served by the backend CLI. */
import { SCENARIOS } from '../shared/protocol.ts';
import { errMessage } from '../shared/guards.ts';
import { buildRenderer, startDev } from './devserver.ts';

const args = process.argv.slice(2);
let port = 7461, seed = 1, population = 12, scenario = 'mixed', buildOnly = false, timescale: number | undefined;
const integer = (value: string | undefined, flag: string, min: number, max: number): number => {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${flag} requires an integer (${min}–${max})`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${flag} requires an integer (${min}–${max})`);
  return n;
};

async function main(): Promise<void> {
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--build': buildOnly = true; break;
      case '--port': port = integer(args[++i], '--port', 0, 65535); break;
      case '--seed': seed = integer(args[++i], '--seed', 0, 0xffffffff); break;
      case '--timescale': timescale = Number(args[++i]); break;
      case '--demo':
        if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) population = integer(args[++i], '--demo', 1, 64);
        break;
      case '--scenario':
        scenario = args[++i];
        if (!SCENARIOS.includes(scenario)) throw new Error(`--scenario must be one of: ${SCENARIOS.join(', ')}`);
        break;
      case '--help':
      case '-h':
        console.log('usage: npm run dev -- [--port N] [--demo [1..64]] [--scenario NAME] [--seed UINT32] [--timescale K]\n       npm run build');
        return;
      default: throw new Error(`unknown argument ${args[i]}`);
    }
  }
  if (buildOnly) { await buildRenderer(); return; }
  const dev = await startDev({ port, seed, population, scenario, timescale });
  const stop = (): void => { void dev.close().then(() => process.exit(0), (e: unknown) => { console.error(errMessage(e)); process.exit(1); }); };
  const u = (p: string) => { const x = new URL(dev.url); x.pathname = p; return x.toString(); };
  console.log(`Valley     → ${u('/')}`);
  console.log(`Workbench  → ${u('/workbench/')}`);
  console.log(`Gallery    → ${u('/gallery/')}`);
  console.log(`Demo only: ${population} agents, scenario ${scenario}, seed ${seed}. Ctrl+C closes both servers and removes temporary state.`);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
}

void main().catch((e: unknown) => { console.error(`dev: ${errMessage(e)}`); process.exitCode = 1; });
