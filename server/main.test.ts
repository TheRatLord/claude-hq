import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from './main.ts';

test('parseArgs: §2.2 flags', () => {
  assert.deepEqual(parseArgs([]), { port: 7462 });
  assert.deepEqual(parseArgs(['--demo']), { port: 7462, demo: 12 });
  assert.deepEqual(parseArgs(['--demo', '40', '--port', '0', '--dev']), { port: 0, demo: 40, dev: true });
  assert.deepEqual(parseArgs(['--demo', '--scenario', 'trio', '--timescale', '10']), { port: 7462, demo: 12, scenario: 'trio', timescale: 10 });
  // --allow-mutations was removed: a hard error with the reason, never a silent no-op
  assert.throws(() => parseArgs(['--session', 'hqtest', '--allow-mutations']), /--allow-mutations was removed.*named session/);
  assert.throws(() => parseArgs(['--timescale', '10']), /only accepted with --demo/);
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => parseArgs(['--port']), /number/);
});

test('CLI: `--demo --port 0` prints the URL and exits cleanly on SIGTERM', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-cli-'));
  const main = new URL('./main.ts', import.meta.url).pathname;
  const p = spawn(process.execPath, [main, '--demo', '--port', '0'], { env: { ...process.env, CLAUDE_HQ_CONFIG_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d: Buffer) => (out += d));
  const url = await new Promise<RegExpMatchArray>((resolve, reject) => {
    p.stdout.on('data', () => {
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]{64})/);
      if (m) resolve(m);
    });
    p.on('exit', (c) => reject(new Error(`exited ${c}: ${out}`)));
  });
  assert.equal(fs.readFileSync(path.join(dir, 'token'), 'utf8').trim(), url[2]);
  assert.equal(fs.statSync(path.join(dir, 'token')).mode & 0o777, 0o600);
  const code = await new Promise<number | null>((r) => {
    p.on('exit', r);
    p.kill('SIGTERM');
  });
  assert.equal(code, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: live mode against an unreachable session starts offline (never the real herdr) and exits on SIGTERM', async () => {
  const main = new URL('./main.ts', import.meta.url).pathname;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-home-'));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-cli-'));
  const p = spawn(process.execPath, [main, '--port', '0', '--session', 'nosuch'], {
    env: { ...process.env, CLAUDE_HQ_CONFIG_DIR: cfg, HQ_HERDR_HOME: home, HQ_LOG: 'silent' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d: Buffer) => (out += d));
  await new Promise<void>((resolve, reject) => {
    p.stdout.on('data', () => /session "nosuch" → http/.test(out) && resolve());
    p.on('exit', (c) => reject(new Error(`exited ${c}: ${out}`)));
  });
  assert.equal(fs.existsSync(path.join(cfg, 'nosuch.lock')), true);
  const code = await new Promise<number | null>((r) => {
    p.on('exit', r);
    p.kill('SIGTERM');
  });
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(cfg, 'nosuch.lock')), false);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cfg, { recursive: true, force: true });
});
