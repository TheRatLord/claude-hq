import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFor, createBlockTracker, createAttention } from './attention.ts';
import type { AttentionStore, AttentionEntity, AttentionDoc, AttentionWin } from './attention.ts';

test('titleFor', () => {
  assert.equal(titleFor({ blocked: 0, unseen: 0, session: 'default' }), 'Claude HQ');
  assert.equal(titleFor({ blocked: 0, unseen: 0, session: 'hqtest' }), 'Claude HQ · hqtest');
  assert.equal(titleFor({ blocked: 2, unseen: 0, demo: true }), '(2) blocked — Claude HQ · DEMO');
  assert.equal(titleFor({ blocked: 1, unseen: 1, session: 'hqtest' }), '● (1) blocked — Claude HQ · hqtest');
});

test('block tracker: first snapshot seeds silently, transitions only', () => {
  const t = createBlockTracker();
  assert.deepEqual(t.world([{ id: 'a', status: 'blocked' }, { id: 'b', status: 'idle' }]), []);
  assert.equal(t.blockedCount(), 1);
  assert.equal(t.entity({ id: 'a', status: 'blocked' }), false);
  assert.equal(t.entity({ id: 'b', status: 'blocked' }), true);
  assert.deepEqual(t.world([{ id: 'a', status: 'idle' }, { id: 'b', status: 'blocked' }, { id: 'c', status: 'blocked' }]), ['c']);
  t.gone('c');
  assert.equal(t.blockedCount(), 1);
});

test('attention: hidden tab → title badge from store events alone; cleared on return', () => {
  // the dispatcher below stores handlers of different payload types under one key: the cast erases the payload type
  const L = new Map<string, (p?: unknown) => void>();
  const entities = new Map<string, AttentionEntity>();
  const store: AttentionStore = {
    entities, hello: { session: 'hqtest' }, demo: false,
    on: (evt, fn) => { L.set(evt, fn as (p?: unknown) => void); return () => {}; },
  };
  const fire = (evt: string, p?: unknown) => L.get(evt)?.(p);
  const docL = new Map<string, () => void>();
  const doc: AttentionDoc = { hidden: false, title: '', hasFocus: () => !doc.hidden, addEventListener: (k, f) => { docL.set(k, f); } };
  const win: AttentionWin = { addEventListener: () => {}, focus: () => {} };
  const att = createAttention({ store, doc, win });
  assert.equal(doc.title, 'Claude HQ · hqtest');
  store.entities.set('a', { id: 'a', status: 'working' });
  fire('world');
  doc.hidden = true;
  store.entities.set('a', { id: 'a', status: 'blocked' });
  fire('entity', store.entities.get('a'));
  assert.equal(doc.title, '● (1) blocked — Claude HQ · hqtest');
  assert.deepEqual(att.state().unseen, ['a']);
  doc.hidden = false;
  docL.get('visibilitychange')?.();
  assert.equal(doc.title, '(1) blocked — Claude HQ · hqtest');
  fire('gone', { id: 'a' });
  assert.equal(doc.title, 'Claude HQ · hqtest');
});
