// Monitor screens (atlas feed): watched panes get `screen` messages ≤ 1 Hz from pane.read (demo: the
// pane's live mock TUI, even when no drawer ever opened it) or from the terminal mirror once a terminal is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, connect } from '../test/harness.ts';
import type { ScreenMsg } from '../../shared/protocol.ts';

test('screen.watch: demo panes nobody opened still feed their monitor; late watchers get the cache; unwatch stops', async () => {
  const app = await startApp({ scenario: 'mixed' });
  const c = await connect(app.port);
  try {
    const ents = [...app.model.entities.values()];
    const agent = ents.find((e) => e.kind === 'claude' && e.status === 'working');
    const shell = ents.find((e) => e.kind === 'shell');
    assert.ok(agent && shell, 'the mixed scenario has a working agent and a shell');
    assert.equal((await c.call({ t: 'screen.watch', ids: [agent.id, shell.id] })).ok, true);
    const sa = await c.wait<ScreenMsg>((m) => m.t === 'screen' && m.id === agent.id && m.lines.some((l) => /Claude Code \(demo\)|⏺|✻/.test(l)), 4000);
    assert.ok(sa.cols > 0 && sa.rows > 0 && sa.lines.length <= sa.rows, 'grid + at most one line per row');
    assert.deepEqual([sa.cols, sa.rows], [agent.layoutRect?.cols, agent.layoutRect?.rows], 'the pane\'s own grid');
    const ss = await c.wait<ScreenMsg>((m) => m.t === 'screen' && m.id === shell.id && m.lines.some((l) => l.trim()), 4000);
    assert.ok(ss.lines.length > 0);
    assert.ok(sa.lines.every((l) => l === l.trimEnd()), 'no trailing padding on the wire');
    // a second client watching the same pane gets the cached screen right away
    const d = await connect(app.port, { cid: 'd2' });
    await d.call({ t: 'screen.watch', ids: [agent.id] });
    await d.wait((m) => m.t === 'screen' && m.id === agent.id, 1000);
    await d.close();
    assert.equal((await c.call({ t: 'screen.watch', ids: [] })).ok, true);
    const n = c.msgs.filter((m) => m.t === 'screen').length;
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(c.msgs.filter((m) => m.t === 'screen').length, n, 'nothing after unwatch');
  } finally {
    await c.close();
    await app.close();
  }
});

test('screen.watch: 8 ids per client, ansi:true keeps SGR colour only, plain watchers never see escapes', async () => {
  const app = await startApp({ scenario: 'mixed' });
  const c = await connect(app.port);
  const p = await connect(app.port, { cid: 'plain' });
  try {
    const ids = [...app.model.entities.values()].filter((e) => e.kind !== 'shell').map((e) => e.id).slice(0, 8);
    assert.equal(ids.length, 8);
    assert.equal((await c.call({ t: 'screen.watch', ids, ansi: true })).ok, true);
    assert.equal((await p.call({ t: 'screen.watch', ids: ids.slice(0, 2) })).ok, true);
    assert.equal((await c.call({ t: 'screen.watch', ids: [...ids, ids[0].replace(/\d+$/, '99')] })).error, 'bad_message', '9 ids → rejected');
    for (const id of ids) {
      const m = await c.wait<ScreenMsg>((x) => x.t === 'screen' && x.id === id && x.ansi === true, 4000);
      assert.ok(m.lines.every((l) => !/\x1b(?!\[[0-9;:]*m)/.test(l)), 'only SGR escapes');
    }
    assert.ok(c.msgs.some((x) => x.t === 'screen' && x.lines.some((l) => l.includes('\x1b['))), 'some colour came through');
    const pm = await p.wait<ScreenMsg>((x) => x.t === 'screen' && x.id === ids[0], 4000);
    assert.equal(pm.ansi, undefined);
    assert.ok(p.msgs.filter((x) => x.t === 'screen').every((x) => x.lines.every((l) => !l.includes('\x1b'))), 'plain has no escapes');
    assert.ok(p.msgs.filter((x) => x.t === 'screen').every((x) => ids.slice(0, 2).includes(x.id)), 'only its own ids');
  } finally {
    await c.close();
    await p.close();
    await app.close();
  }
});

test('screens helpers: sgrOnly drops cursor/OSC/mode escapes, toLines trims coloured padding', async () => {
  const { sgrOnly, stripAnsi, toLines } = await import('./screens.ts');
  assert.equal(sgrOnly('\x1b]0;t\x07a\x1b[2K\x1b[31mb\x1b[?25l'), 'a\x1b[31mb');
  assert.equal(stripAnsi('\x1b[1;31mred\x1b[0m'), 'red');
  assert.deepEqual(toLines('\x1b[48;5;4mx  \x1b[0m\x1b[48;5;4m   \x1b[0m\r\n\r\n', true), ['\x1b[48;5;4mx\x1b[0m', '']);
  assert.deepEqual(toLines('\x1b[48;5;4mx  \x1b[0m\r\n', false), ['x']);
});
