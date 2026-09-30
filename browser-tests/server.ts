import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';

export interface DemoServer { url: string; origin: string; token: string }

const root = fileURLToPath(new URL('../', import.meta.url));

export const test = base.extend<{ demoServer: DemoServer }>({
  demoServer: async ({}, use, testInfo) => {
    const configDir = await mkdtemp(path.join(tmpdir(), 'hq-browser-'));
    let log = '';
    const child = spawn(process.execPath, [
      'server/main.ts', '--demo', '3', '--seed', '7', '--scenario', 'allStates',
      '--port', '0', '--metrics', '--dist', path.join(root, 'dist'), '--config-dir', configDir,
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const append = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-64 * 1024); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    const waitForClose = async (ms: number): Promise<boolean> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          closed.then(() => true),
          new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
        ]);
      } finally { clearTimeout(timer); }
    };
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Demo server did not print its URL within 15 seconds')), 15_000);
        const onError = (error: Error) => finish(error);
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => finish(new Error(`Demo server exited during startup (${code ?? signal})`));
        const onData = () => {
          const match = /http:\/\/127\.0\.0\.1:\d+\/\?t=[a-zA-Z0-9_-]+/.exec(log);
          if (match) finish(null, match[0]);
        };
        const finish = (error: Error | null, value?: string) => {
          clearTimeout(timer);
          child.off('error', onError);
          child.off('exit', onExit);
          child.stdout.off('data', onData);
          if (error) reject(error); else resolve(value!);
        };
        child.once('error', onError);
        child.once('exit', onExit);
        child.stdout.on('data', onData);
        onData();
      });
      const parsed = new URL(url);
      const token = parsed.searchParams.get('t');
      if (!token) throw new Error('Demo server URL omitted bootstrap token');
      parsed.pathname = '/workbench/';
      await use({ url: parsed.toString(), origin: parsed.origin, token });
    } finally {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        if (!(await waitForClose(5_000))) {
          child.kill('SIGKILL');
          if (!(await waitForClose(5_000))) throw new Error('Demo server did not terminate');
        }
      } finally {
        try {
          await testInfo.attach('demo-server.log', {
            body: log.replace(/([?&]t=)[a-zA-Z0-9_-]+/g, '$1[redacted]'), contentType: 'text/plain',
          });
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      }
    }
  },
});

export { expect } from '@playwright/test';
