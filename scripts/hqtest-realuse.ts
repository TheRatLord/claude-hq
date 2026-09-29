#!/usr/bin/env node
/**
 * Real-usage acceptance run (M3.5 BE): start HQ the way a user does (web backend or Electron) against a herdr session,
 * then drive it like the UI would. Owner: BE.
 *
 *   node scripts/hqtest-realuse.ts --session default [--mode web|electron]      read-only-safe checks
 *   node scripts/hqtest-realuse.ts --session hqtest  [--mode web|electron]      full actions (hire + prompt, + Shell)
 *     [--port 7725] [--dist dir] [--config-dir dir] [--shots dir] [--no-page]
 *
 * default: world renders (web: a real Chromium page on the GPU → screenshot; electron: Electron --shoot), a terminal
 *          opens only on an explicit action (web: `__hq.openTerminal`, electron: term.open over the WS) in OBSERVE mode,
 *          `spawn` and `pane.close` are refused with `mutations_disabled` + an explanation. Wrap it in
 *          `node scripts/integrity.ts run -- …` to prove the default session's structure hash is unchanged.
 * hqtest:  needs ≤ 1 claude agent already there (the hire makes 2; `HQ_FRESH=1 HQ_CLAUDES=1 scripts/hqtest-up.sh`).
 *          Hires a claude in scout's workspace with the first prompt "say hi" → reply prompted:true → the entity goes
 *          working; `+ Shell` in the same workspace → a shell entity appears. Both are closed again with pane.close;
 *          `scripts/hqtest-down.sh` removes everything.
 * Exit 0 = all checks passed. Every process it starts is killed on exit.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { Browser, Page } from 'playwright-core';
import type { ClientMsg, Entity, EntityMsg, Hello, ReplyMsg, ServerMsg, TermStateMsg, WorldMsg } from '../shared/protocol.ts';
import { isRecord } from '../shared/guards.ts';
import { isServerMsg } from '../shared/serverMsg.ts';
import type { HqStats, PageWindow } from './pageTypes.ts';

declare const window: PageWindow;

const REPO = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const flag = <D extends string | number>(n: string, d: D): string | D => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const session = flag('--session', 'default');
const mode = flag('--mode', 'web');
const port = Number(flag('--port', 7725));
const shots = flag('--shots', path.join(os.tmpdir(), 'hq-realuse'));
const configDir = flag('--config-dir', fs.mkdtempSync(path.join(os.tmpdir(), 'hq-realuse-cfg-')));
const dist = flag('--dist', path.join(REPO, 'dist'));
const noPage = args.includes('--no-page');
fs.mkdirSync(shots, { recursive: true });

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: unknown, detail: unknown = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const children: ChildProcess[] = [];
const cleanup = () => {
  for (const c of children) {
    if (c.pid === undefined) continue; // never spawned
    try {
      process.kill(-c.pid, 'SIGTERM');
    } catch {}
  }
};
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(1));

// ------------------------------------------------------------------ start HQ like a user
function startHq() {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_HQ_CONFIG_DIR: configDir };
  let cmd: string, argv: string[];
  if (mode === 'electron') {
    const electron = path.join(REPO, 'node_modules/.bin/electron');
    const eargs = ['--no-sandbox', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '.', '--session', session,
      '--port', String(port), '--dist', dist, '--size', '1600x900', '--shoot', path.join(shots, `electron-${session}.png`), '--shoot-wait', '30000'];
    if (process.env.DISPLAY) [cmd, argv] = [electron, eargs];
    else [cmd, argv] = ['xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', electron, ...eargs]];
  } else {
    [cmd, argv] = [process.execPath, ['server/main.ts', '--session', session, '--port', String(port), '--dist', dist, '--new-instance']];
  }
  const child = spawn(cmd, argv, { cwd: REPO, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return new Promise<{ child: ChildProcess; url: string; out: () => string }>((resolve, reject) => {
    const t0 = Date.now();
    const poll = setInterval(() => {
      const m = /→ (http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+)/.exec(out);
      if (m) {
        clearInterval(poll);
        resolve({ child, url: m[1], out: () => out });
      } else if (child.exitCode !== null || Date.now() - t0 > 30_000) {
        clearInterval(poll);
        reject(new Error(`HQ did not start:\n${out}`));
      }
    }, 100);
  });
}

// ------------------------------------------------------------------ a WS client (what the renderer speaks)
/** A text frame from our own backend: parsed and checked by the same guard the renderer store uses. */
function parseServerMsg(text: string): ServerMsg | null {
  const v: unknown = JSON.parse(text);
  return isServerMsg(v) ? v : null;
}

interface WsClient {
  msgs: ServerMsg[];
  rid: number;
  hello: Hello | null;
  entities: Map<string, Entity>;
  /** first received message matching `pred`, or null after `ms` */
  wait<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, ms?: number): Promise<T | null>;
  call(m: ClientMsg, ms?: number): Promise<ReplyMsg | null>;
  close(): void;
}

async function wsClient(url: string): Promise<WsClient> {
  const u = new URL(url);
  const ws = new WebSocket(`ws://127.0.0.1:${u.port}/ws?t=${u.searchParams.get('t')}&cid=realuse`, { origin: u.origin });
  const msgs: ServerMsg[] = [];
  const entities = new Map<string, Entity>();
  const c: WsClient = {
    msgs, rid: 0, hello: null, entities,
    async wait<T extends ServerMsg>(pred: (m: ServerMsg) => m is T, ms = 10_000) {
      const t0 = Date.now();
      for (;;) {
        const m = msgs.find(pred);
        if (m) return m;
        if (Date.now() - t0 > ms) return null;
        await sleep(50);
      }
    },
    async call(m, ms = 30_000) {
      const rid = ++c.rid;
      ws.send(JSON.stringify({ ...m, rid }));
      return c.wait((x): x is ReplyMsg => x.t === 'reply' && x.rid === rid, ms);
    },
    close: () => ws.close(),
  };
  ws.on('message', (d, bin) => {
    if (bin) return;
    const m = parseServerMsg(String(d));
    if (!m) return;
    msgs.push(m);
    if (m.t === 'hello') {
      c.hello = m;
      ws.send(JSON.stringify({ t: 'hello.ack', protocol: m.protocol, rid: 'ack' } satisfies ClientMsg));
    }
    if (m.t === 'world') for (const e of m.entities) entities.set(e.id, e);
    if (m.t === 'entity') entities.set(m.entity.id, m.entity);
    if (m.t === 'gone') entities.delete(m.id);
  });
  await new Promise((res, rej) => (ws.once('open', res), ws.once('error', rej)));
  await c.wait((m): m is WorldMsg => m.t === 'world', 15_000);
  return c;
}

/** The `SHOOT {...}` line Electron prints under --shoot (the fields checked here). */
interface ShootReport { ready: boolean; renderer?: string; file?: string; stats?: { entities?: number; fps?: number } }
function parseShoot(v: unknown): ShootReport | null {
  if (!isRecord(v)) return null;
  const st = isRecord(v.stats) ? v.stats : undefined;
  return {
    ready: v.ready === true,
    renderer: typeof v.renderer === 'string' ? v.renderer : undefined,
    file: typeof v.file === 'string' ? v.file : undefined,
    stats: st && { entities: typeof st.entities === 'number' ? st.entities : undefined, fps: typeof st.fps === 'number' ? st.fps : undefined },
  };
}

async function main() {
  console.log(`real-usage run: ${mode} · session ${session} · port ${port} · config ${configDir}`);
  const hq = await startHq();
  check('HQ starts and prints its token URL', !!hq.url, hq.url.replace(/t=[0-9a-f]{8}[0-9a-f]+/, 't=…'));
  if (mode === 'web') check('prints the mode line', /mode: /.test(hq.out()), (/mode: .*/.exec(hq.out()) ?? [''])[0]);
  const c = await wsClient(hq.url);
  const ents = [...c.entities.values()];
  check('hello: session + safety flags', c.hello?.session === session && (session === 'default' ? c.hello.defaultSession && !c.hello.allowMutations : c.hello.allowMutations),
    `defaultSession=${c.hello?.defaultSession} allowMutations=${c.hello?.allowMutations} herdr=${JSON.stringify(c.hello?.herdr)}`);
  check('world has entities from herdr', ents.length > 0, `${ents.length} panes: ${ents.map((e) => `${e.name}:${e.kind}/${e.status}`).join(' ')}`);
  const agent = ents.find((e) => e.kind !== 'shell') ?? ents[0];

  // nothing opened by itself: no terminal children yet
  check('no terminal opened before an explicit action', !c.msgs.some((m) => m.t === 'term.state'));

  // ---- the page (web): renders on the GPU, then an explicit open
  let page = null, browser = null;
  if (mode === 'web' && !noPage) {
    const { launchBrowser, openPage } = await import('./shoot.ts');
    browser = await launchBrowser({});
    const o = await openPage(browser, hq.url, { size: [1600, 900], wait: 4000 });
    page = o.page;
    const st = await page.evaluate(() => window.__hq?.stats?.() ?? null);
    const shot = path.join(shots, `web-${session}.png`);
    await page.screenshot({ path: shot });
    check('web page renders the world', o.ready === 'ready' && (st?.entities ?? 0) > 0 && (st?.frame ?? 0) > 10 && !o.gpu.software,
      `${o.gpu.renderer} · entities=${st?.entities} actors=${st?.actors} fps=${st?.fps} → ${shot}`);
    await page.evaluate((id) => window.__hq.openTerminal(id), agent.id);
    let ts = null; // term.state goes to the page's own socket: read it from the page's store
    for (let i = 0; i < 150 && !ts; i++) {
      ts = await page.evaluate((id) => {
        const s = window.__hq.store.termStates.get(id);
        return s && s.state === 'live' ? { ...s } : null;
      }, agent.id);
      if (!ts) await sleep(100);
    }
    await sleep(1500);
    await page.screenshot({ path: path.join(shots, `web-${session}-terminal.png`) });
    check('explicit open (as a click would) → a live OBSERVE terminal', ts && ts.mode === 'observe', ts ? `${ts.mode} ${ts.cols}×${ts.rows} writer=${ts.writer}` : 'no term.state');
    await page.evaluate((id) => window.__hq.closeTerminal?.(id), agent.id).catch(() => {});
  } else {
    const r = await c.call({ t: 'term.open', id: agent.id, cols: 100, rows: 30, mode: 'observe' });
    const ts = await c.wait((m): m is TermStateMsg => m.t === 'term.state' && m.id === agent.id && m.state === 'live', 15_000);
    check('explicit term.open → a live OBSERVE terminal', r?.ok && ts?.mode === 'observe', ts ? `${ts.mode} ${ts.cols}×${ts.rows}` : JSON.stringify(r));
    await c.call({ t: 'term.close', id: agent.id });
  }

  if (session === 'default') {
    const sp = await c.call({ t: 'spawn', kind: 'claude', prompt: 'say hi' });
    check('default: spawn refused with an explanation', sp && !sp.ok && sp.error === 'mutations_disabled' && /default herdr session/.test(String(sp.why)), sp?.why);
    const pc = await c.call({ t: 'pane.close', id: agent.id });
    check('default: pane.close refused with an explanation', pc && !pc.ok && pc.error === 'mutations_disabled', pc?.why);
    const st = await c.call({ t: 'settings.set', patch: { allowMutations: true } });
    check('default: the UI cannot switch mutations on', st && !st.ok && st.error === 'mutations_disabled');
  } else {
    const claudes = ents.filter((e) => e.kind === 'claude' || e.kind === 'codex');
    const scout = claudes.find((e) => e.name === 'scout') ?? claudes[0] ?? agent;
    if (claudes.length >= 2) {
      check('hqtest: ≤ 1 claude before hiring (≤ 2 total)', false, `${claudes.length} already: run HQ_FRESH=1 HQ_CLAUDES=1 scripts/hqtest-up.sh`);
    } else {
      const t0 = Date.now();
      const r = await c.call({ t: 'spawn', workspaceId: scout.workspace.id, cwd: scout.cwd, kind: 'claude', name: 'hq-hire', prompt: 'say hi' }, 40_000);
      check('hqtest: hire claude with first prompt → prompted:true', r?.ok && r.prompted === true, `${JSON.stringify(r)} in ${Date.now() - t0} ms`);
      const hired = typeof r?.paneId === 'string' ? r.paneId : undefined;
      const working = hired && (await c.wait((m): m is EntityMsg => m.t === 'entity' && m.entity.id === hired && m.entity.status === 'working', 30_000));
      check('hqtest: the new hire goes working', !!working, working ? `${working.entity.name} working ${((Date.now() - t0) / 1000).toFixed(1)} s after the hire` : `last: ${hired ? c.entities.get(hired)?.status : undefined}`);
      if (page) {
        await sleep(2500);
        await page.screenshot({ path: path.join(shots, `web-hqtest-hired.png`) });
      }
      const sh = await c.call({ t: 'spawn', workspaceId: scout.workspace.id, label: 'hq-shell' });
      const shellPane = typeof sh?.paneId === 'string' ? sh.paneId : undefined;
      const shellEnt = shellPane && (await c.wait((m): m is EntityMsg => m.t === 'entity' && m.entity.id === shellPane && m.entity.kind === 'shell', 10_000));
      check('hqtest: + Shell → a shell entity appears', sh?.ok && !!shellEnt, JSON.stringify(sh));
      const audit: unknown = await fetch(`http://127.0.0.1:${port}/api/audit?n=10&t=${new URL(hq.url).searchParams.get('t')}`).then((x): Promise<unknown> => x.json()).catch(() => null);
      const entries = isRecord(audit) && Array.isArray(audit.entries) ? audit.entries : [];
      const acts = entries.map((e) => (isRecord(e) ? `${e.action}:${e.ok}` : 'undefined:undefined'));
      check('hqtest: audit has spawn + prompt, never the text', acts.includes('spawn:true') && acts.includes('prompt:true') && !JSON.stringify(audit).includes('say hi'), acts.join(' '));
      for (const id of [hired, shellPane].filter((x): x is string => !!x)) {
        const x = await c.call({ t: 'pane.close', id });
        check(`hqtest: pane.close ${id}`, x?.ok, x?.why ?? '');
      }
    }
  }
  c.close();
  await browser?.close();
  if (mode === 'electron') {
    // --shoot: Electron takes its screenshot after --shoot-wait and quits by itself
    const t0 = Date.now();
    while (hq.child.exitCode === null && Date.now() - t0 < 60_000) await sleep(200);
    const m = /SHOOT (\{.*\})/.exec(hq.out());
    const s = m ? parseShoot(JSON.parse(m[1])) : null;
    check('electron renders the world (GPU)', s?.ready && (s.stats?.entities ?? 0) > 0 && !/swiftshader|llvmpipe/i.test(s.renderer ?? ''),
      s ? `${s.renderer} · entities=${s.stats?.entities} fps=${s.stats?.fps} → ${s.file}` : hq.out().slice(-800));
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  cleanup();
  await sleep(500);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e) : e);
  process.exit(2);
});
