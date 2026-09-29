// Sticky notes (§8.10, M3): stored by stable identity, follow re-keys, persist per session, never reach herdr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FakeClock } from '../clock.ts';
import type { Entity } from '../../shared/protocol.ts';
import { NotesEnricher, NOTE_TTL_MS } from './notes.ts';
import { isRecord } from '../../shared/guards.ts';
import { startApp, connect } from '../test/harness.ts';

const base = (terminalId: string) => ({ identity: { terminalId, agentSession: null, place: 'ws/tab/0//tmp' } });

function rig(dir: string, clock = new FakeClock()) {
  const n = new NotesEnricher({ dir, clock });
  const patches: [string, Partial<Entity>][] = [];
  n.onPatch = (id, p) => patches.push([id, p]);
  n.emitEvent = () => assert.fail('notes emit no events');
  return { n, patches, clock };
}

test('notes: set / clear / 280-char cap, persisted by identity, re-bound after a rekey and a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-notes-'));
  try {
    const clock = new FakeClock();
    let R = rig(dir, clock);
    R.n.attach('w1:p1', base('term_a'));
    assert.deepEqual(R.patches.at(-1), ['w1:p1', { note: null }]);
    const r = R.n.set('w1:p1', '  check the flaky test  ');
    assert.equal(r.note?.text, 'check the flaky test');
    assert.deepEqual(R.patches.at(-1)?.[1].note?.text, 'check the flaky test');
    assert.equal(R.n.set('w1:p1', 'x'.repeat(400)).note?.text.length, 280);
    R.n.set('w1:p1', 'keep me');
    // rekey: same terminal id, new pane id → same note
    R.n.detach('w1:p1');
    R.n.attach('w1:p7', base('term_a'));
    assert.equal(R.patches.at(-1)?.[1].note?.text, 'keep me');
    clock.advance(1500); // debounced write
    const file = path.join(dir, 'notes.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    // restart: a new enricher reads the file
    R = rig(dir, clock);
    R.n.attach('w2:p1', base('term_a'));
    assert.equal(R.patches.at(-1)?.[1].note?.text, 'keep me');
    assert.deepEqual(R.n.set('w2:p1', null), { note: null });
    assert.deepEqual(R.n.set('w2:p1', '   '), { note: null });
    await R.n.close();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
    assert.throws(() => R.n.set('nope', 'x'), { code: 'unknown_entity' });
    // TTL: a note unseen for 30 days is dropped on load
    R.n.set('w2:p1', 'old');
    await R.n.close();
    clock.advance(NOTE_TTL_MS + 1);
    R = rig(dir, clock);
    R.n.attach('w2:p1', base('term_a'));
    assert.deepEqual(R.patches.at(-1)?.[1], { note: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('note.set over the wire: entity.note updates for every client; oversize is a bad message', async () => {
  const app = await startApp({ scenario: 'mixed' });
  const c = await connect(app.port);
  const d = await connect(app.port, { cid: 'd' });
  try {
    const id = [...app.model.entities.keys()][0];
    const r = await c.call({ t: 'note.set', id, text: 'ship it' });
    assert.equal(r.ok, true, String(r.why));
    assert.ok(isRecord(r.note));
    assert.equal(r.note.text, 'ship it');
    await d.wait((m) => m.t === 'entity' && m.entity.id === id && m.entity.note?.text === 'ship it', 2000);
    assert.equal((await c.call({ t: 'note.set', id, text: 'y'.repeat(281) })).error, 'bad_message');
    assert.equal((await c.call({ t: 'note.set', id, text: null })).note, null);
  } finally {
    await c.close();
    await d.close();
    await app.close();
  }
});
