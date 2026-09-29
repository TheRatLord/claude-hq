// Unit tests for the @pure UI modules (keymap, rekey/pins, roster model, input pipe, fit, lifecycle). Owner: UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BINDINGS, LEADER_CHORDS, WORLD_CODES, BROWSER_EATEN_CODES, SCOPES, resolveKey, resolveChord, isLeader, overlayRows,
  actionNames, matchSpec, parseSpec, tableFor,
} from './keymap.ts';
import { createRekey, createPins } from './rekey.ts';
import { buildRoster, parseQuery, matchEntity, initialSelection, needsYou, dirOf, GROUP_MODES, oldestBlocked, rowAriaLabel, nameQualifier } from './roster/model.ts';
import { createInputPipe, chunkUtf8 } from './terminal/input.ts';
import { createFit, letterbox, gridFor, observeGrid, minFontPx } from './terminal/fit.ts';
import { lifeView, peekKey } from './terminal/lifecycle.ts';
import { ent, ident, must, type Deep } from './testFixtures.ts';
import type { Entity } from '../../../shared/protocol.ts';
import type { Layout } from '../world/layout/schema.ts';
import type { SavedMark } from './unread.ts';
import type { RingItem } from './recap.ts';
import type { StandActor } from './goto.ts';
import type { Nav } from '../world/nav/index.ts';
import type { StorageIo } from './rekey.ts';
import type { GroupItem, RowItem, RosterItem } from './roster/model.ts';

interface EvOpts { key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }
const ev = (code: string, o: EvOpts = {}) => ({ code, key: o.key ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

test('keymap: leader chords are disjoint from world keys and browser-eaten letters (both platforms)', () => {
  for (const mac of [false, true]) {
    const chordCodes = new Set(LEADER_CHORDS.map((c) => c.code));
    for (const c of WORLD_CODES) assert.ok(!chordCodes.has(c), `chord ${c} collides with a world key (mac=${mac})`);
    for (const c of BROWSER_EATEN_CODES) assert.ok(!chordCodes.has(c), `chord ${c} is browser-eaten`);
  }
});

test('keymap: every spec parses; scope tables resolve their own rows', () => {
  for (const list of Object.values(BINDINGS)) for (const x of list) if (x.action) assert.doesNotThrow(() => parseSpec(x.keys), x.keys);
  for (const s of SCOPES) assert.ok(BINDINGS[tableFor(s)], s);
  assert.equal(resolveKey('world-locked', ev('Enter'), false)?.action, 'openLast');
  assert.equal(resolveKey('world-unlocked', ev('Tab'), false)?.action, 'rosterOpen');
  assert.deepEqual(resolveKey('world-locked', ev('Digit3'), false)?.arg, 3);
  assert.equal(resolveKey('world-locked', ev('Digit3', { shiftKey: true, key: '#' }), false)?.action, 'pinAssign');
  assert.equal(resolveKey('world-locked', ev('Digit2', { altKey: true }), false)?.action, 'quickAnswer');
  assert.equal(resolveKey('world-locked', ev('Digit2', { ctrlKey: true }), true)?.action, 'quickAnswer', 'mac QA = Ctrl');
  assert.equal(resolveKey('world-locked', ev('Digit2', { altKey: true }), true), null, 'mac Option+digit types characters');
  assert.equal(resolveKey('world-locked', ev('KeyK', { ctrlKey: true }), false)?.action, 'palette');
  assert.equal(resolveKey('world-locked', ev('KeyK', { metaKey: true }), true)?.action, 'palette');
  assert.equal(resolveKey('world-locked', ev('Slash', { key: '?', shiftKey: true }), false)?.action, 'keys');
  assert.equal(resolveKey('roster', ev('KeyJ'), false)?.action, 'down');
  assert.equal(resolveKey('roster', ev('Digit4', { altKey: true }), false)?.arg, 4);
  assert.equal(resolveKey('roster', ev('Digit8', { altKey: true }), false), null, 'Alt+1..7 only');
  assert.equal(resolveKey('roster', ev('KeyW'), false), null, 'W unbound in the roster');
  assert.equal(resolveKey('roster', ev('Enter', { ctrlKey: true }), false)?.action, 'follow');
  assert.equal(resolveKey('xterm', ev('Insert', { ctrlKey: true }), false)?.action, 'copy');
  assert.equal(resolveKey('xterm', ev('KeyC', { metaKey: true }), true)?.action, 'copy');
  assert.equal(resolveKey('xterm', ev('KeyC', { ctrlKey: true }), true), null, 'mac Ctrl+C goes to the pane');
  assert.equal(resolveKey('xterm', ev('KeyC', { ctrlKey: true }), false), null, 'linux Ctrl+C goes to the pane');
  assert.equal(resolveKey('xterm', ev('Equal', { metaKey: true, key: '=' }), true)?.action, 'fontUp');
});

test('keymap: leader detection and chords', () => {
  assert.ok(isLeader(ev('Backquote', { ctrlKey: true })));
  assert.ok(isLeader(ev('F9')));
  assert.ok(!isLeader(ev('Backquote')));
  assert.ok(isLeader(ev('Space', { ctrlKey: true }), 'Ctrl+Space'));
  assert.equal(resolveChord(ev('KeyX'))?.action, 'tabClose');
  assert.equal(resolveChord(ev('KeyX', { shiftKey: true }))?.action, 'tabCloseOthers');
  assert.equal(resolveChord(ev('Digit7', { ctrlKey: true }))?.arg, 7);
  assert.equal(resolveChord(ev('KeyW')), null);
});

test('keymap: the ? overlay lists exactly the handler table actions', () => {
  const names = actionNames();
  for (const scope of ['world-locked', 'roster', 'xterm', 'input', 'palette']) {
    for (const mac of [false, true]) {
      const rows = overlayRows(scope, mac);
      const actions = new Set(rows.map((r) => r.action).filter((x): x is string => !!x));
      const t = tableFor(scope);
      const table = new Set(BINDINGS[t].filter((x) => x.action && (x.mac === undefined || x.mac === mac)).map((x) => x.action).filter((x): x is string => !!x));
      for (const a of table) assert.ok(actions.has(a), `${scope}: overlay misses ${a}`);
      for (const a of actions) assert.ok(table.has(a) || names.leader.includes(a), `${scope}: overlay shows unknown ${a}`);
    }
  }
  assert.ok(matchSpec('?', ev('Slash', { key: '?', shiftKey: true }), false));
});

test('rekey: chains resolve and holders migrate', () => {
  const r = createRekey();
  const seen: [string, string][] = [];
  r.onRekey((o, n) => { seen.push([o, n]); });
  r.record('a', 'b');
  r.record('b', 'c');
  assert.equal(r.resolve('a'), 'c');
  assert.equal(r.resolve('x'), 'x');
  assert.deepEqual(seen, [['a', 'b'], ['b', 'c']]);
});

test('pins: stable identity survives re-keyed ids and reloads', () => {
  type PinsData = Parameters<typeof createPins>[0] extends StorageIo<infer T> & object ? T : never;
  let saved: PinsData | null = null;
  const io: StorageIo<PinsData> & { now?: () => number } = { load: () => saved, save: (v) => { saved = JSON.parse(JSON.stringify(v)); }, now: () => 1000 };
  const e1 = { id: 'w1:p1', name: 'scout', identity: { terminalId: 't1', agentSession: null, place: 'a/b/0/~' } };
  const e2 = { id: 'w1:p2', name: 'tinker', identity: { terminalId: 't2', agentSession: null, place: 'a/b/1/~' } };
  const pins = createPins(io);
  assert.equal(pins.toggle(e1), 1);
  pins.assign(3, e2);
  assert.equal(pins.idAt(3), 'w1:p2');
  // reload after herdr restart: same terminal ids, new pane ids
  const pins2 = createPins(io);
  pins2.rebind([{ ...e1, id: 'w9:p1' }, { ...e2, id: 'w9:p2' }]);
  assert.equal(pins2.idAt(1), 'w9:p1');
  assert.equal(pins2.idAt(3), 'w9:p2');
  assert.equal(pins2.toggle({ ...e1, id: 'w9:p1' }), 0, 'toggle unpins');
  pins2.rebind([]);
  assert.ok(pins2.slots[2]?.missingSince, 'missing slot kept dimmed');
});

const now = 1_000_000;
/** The action / agent id of a palette hit (the hit is one or the other). */
const hitAction = (h: { kind: string; a?: { id: string } } | undefined) => h?.a?.id;
const hitAgent = (h: { kind: string; e?: { id: string } } | undefined) => h?.e?.id;
const isGroup = (x: RosterItem): x is GroupItem => x.type === 'group';
const isRow = (x: RosterItem): x is RowItem => x.type === 'row';
const E = (id: string, o: Deep<Entity> = {}): Entity => ent({ id, name: id, kind: 'claude', status: 'idle', statusSince: now - 1000, identity: {}, workspace: { id: 'w1', label: 'hq-core', number: 1, colorIndex: 0 }, tab: { id: 't1', label: 'claude', number: 1 }, cwd: '/home/u/src/claude-hq/server', repo: 'claude-hq', project: 'claude-hq', ...o });

test('roster: needs-you order, grouping, search tokens, initial selection', () => {
  const ents = [
    E('idle1'),
    E('b-new', { status: 'blocked', statusSince: now - 1000 }),
    E('b-old', { status: 'blocked', statusSince: now - 9000 }),
    E('done1', { status: 'done', statusSince: now - 5000 }),
    E('acked', { status: 'done', statusSince: now - 6000, ack: { at: 1, by: 'hq' } }),
    E('sh', { kind: 'shell', status: 'unknown', cwd: '/home/u/ops', repo: null, workspace: { id: 'w2', label: 'infra', number: 2, colorIndex: 1 } }),
  ];
  const r = buildRoster(ents, { mode: 'state' });
  const groups = r.list.filter(isGroup).map((x) => x.label);
  assert.deepEqual(groups, ['Blocked', 'Done', 'Idle', 'Shells']);
  const rows = r.list.filter(isRow).map((x) => x.id);
  assert.deepEqual(rows.slice(0, 2), ['b-old', 'b-new']);
  assert.equal(initialSelection(r.list, new Map(ents.map((e) => [e.id, e])), null), 'b-old');
  for (const mode of GROUP_MODES) assert.equal(buildRoster(ents, { mode }).count, ents.length, mode);
  assert.equal(buildRoster(ents, { mode: 'state', query: 'is:blocked' }).count, 2);
  assert.equal(buildRoster(ents, { mode: 'state', query: 'ws:infra' }).count, 1);
  assert.equal(buildRoster(ents, { mode: 'state', query: 'cwd:~/ops' }).count, 1);
  assert.equal(buildRoster(ents, { mode: 'state', query: 'kind:shell' }).count, 1);
  assert.equal(buildRoster(ents, { mode: 'state', shells: false }).count, 5);
  assert.equal(buildRoster(ents, { mode: 'state', query: 'bold' }).count, 1, 'fuzzy: b-old');
  assert.equal(buildRoster(ents, { mode: 'state', collapsed: new Set(['s:blocked']) }).list.filter(isRow).length, 4);
  const pinned = buildRoster(ents, { mode: 'workspace', pinnedIds: ['sh'] });
  const [pinHead, pinRow] = pinned.list;
  assert.equal(pinHead && isGroup(pinHead) ? pinHead.label : null, 'Pinned');
  assert.equal(pinRow && isRow(pinRow) ? pinRow.id : null, 'sh');
  assert.equal(dirOf(E('x')).label, 'claude-hq › server/');
  assert.equal(needsYou(E('s', { struggle: { level: 2 } }))?.[0], 1);
  assert.equal(oldestBlocked(ents)?.id, 'b-old');
  assert.match(rowAriaLabel(ents[2], now), /^b-old, blocked 9 seconds, hq-core › claude/);
  assert.deepEqual(parseQuery('is:blocked foo'), { filters: [{ field: 'is', value: 'blocked' }], words: ['foo'] });
  assert.ok(matchEntity(E('n'), parseQuery('has:note'), { hasNote: () => true }));
});

test('input pipe: credit window, paste chunking order, hold/outbox', async () => {
  const log: [string, string][] = [];
  const replies: ((r: { ok: boolean }) => void)[] = [];
  const pipe = createInputPipe({
    id: 'p1', window: 10, interactiveMax: 4, chunk: 5,
    sendBinary: (b) => { log.push(['bin', new TextDecoder().decode(b)]); return true; },
    call: (m) => new Promise((res) => { log.push(['paste', m.text]); replies.push(res); }),
  });
  pipe.write('abc');
  pipe.write('defgh'.slice(0, 4));
  assert.deepEqual(log.map((x) => x[1]), ['abc', 'defg']);
  pipe.write('xyz'); // 7 in flight + 3 = 10 ≤ 10 → sent
  pipe.write('Q'); // over the window → queued
  assert.equal(pipe.queued, 1);
  pipe.ack(10);
  assert.equal(pipe.queued, 0);
  log.length = 0;
  pipe.write('0123456789A', { paste: true }); // 3 chunks
  pipe.write('k'); // queued behind the paste
  assert.deepEqual(log, [['paste', '01234']]);
  for (let i = 0; i < 3; i++) { replies.shift()?.({ ok: true }); await 0; await 0; }
  assert.deepEqual(log.map((x) => x[1]), ['01234', '56789', 'A', 'k']);
  pipe.hold();
  assert.equal(pipe.write('zz'), 'held');
  assert.equal(pipe.held, 2);
  pipe.discard();
  assert.equal(pipe.held, 0);
  pipe.write('ok');
  pipe.release();
  assert.equal(log.at(-1)?.[1], 'ok');
  assert.deepEqual(chunkUtf8('ééé', 4), ['éé', 'é']);
  assert.deepEqual(chunkUtf8('a😀b', 4), ['a', '😀', 'b']);
});

test('fit: debounced settle, explicit reason wins; letterbox scales then pans', () => {
  const timers: (() => void)[] = [];
  const fired: [number, number, string | null][] = [];
  const fit = createFit({ measure: () => ({ cols: 80, rows: 24 }), onSettled: (c, r, why) => fired.push([c, r, why]), setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  fit.invalidate('window');
  fit.invalidate('drag');
  fit.invalidate('roster');
  timers.at(-1)?.();
  assert.deepEqual(fired, [[80, 24, 'drag']]);
  const cw = (px: number) => px * 0.6, ch = (px: number) => px * 1.2;
  assert.equal(letterbox({ boxW: 800, boxH: 600, cols: 80, rows: 24, fontPx: 14, cellW: cw, cellH: ch }).fontPx, 14);
  const s = letterbox({ boxW: 600, boxH: 600, cols: 80, rows: 24, fontPx: 14, cellW: cw, cellH: ch });
  assert.ok(s.fontPx < 14 && !s.pan);
  assert.ok(letterbox({ boxW: 300, boxH: 200, cols: 200, rows: 60, fontPx: 14, cellW: cw, cellH: ch }).pan);
  assert.deepEqual(gridFor(1000, 10, 10, 20), { cols: 100, rows: 4 });
  // readable floor of the observe cap (drawer fix r1): never below 11 px nor 0.8× of the user's size, never above it
  assert.deepEqual([minFontPx(14), minFontPx(20), minFontPx(9)], [11, 16, 9]);
});

test('lifecycle: peek promotes only on printable/Enter; states map to input routes', () => {
  assert.equal(lifeView({ state: 'live', mode: 'observe' }).input, 'promote');
  assert.equal(lifeView({ state: 'live', mode: 'control', writer: true }).input, 'send');
  assert.equal(lifeView({ state: 'live', mode: 'control', writer: false }).actions[0].action, 'writer');
  assert.equal(lifeView({ state: 'gone' }).input, 'disabled');
  assert.equal(lifeView({ state: 'busy' }).actions[0].action, 'takeover');
  assert.equal(lifeView(null).spinner, true);
  const k = (key: string, o: { code?: string; ctrlKey?: boolean } = {}) => peekKey({ key, code: o.code ?? '', ctrlKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(k('a'), 'promote');
  assert.equal(k('Enter'), 'promote');
  assert.equal(k('Escape'), 'esc');
  for (const x of ['ArrowUp', 'Tab', 'Backspace', 'F5']) assert.equal(k(x), 'swallow', x);
  assert.equal(k('c', { ctrlKey: true, code: 'KeyC' }), 'ctrlc');
  assert.equal(k('r', { ctrlKey: true, code: 'KeyR' }), 'swallow');
});

import { computeLayout } from './layout.ts';
test('layout: §8.2.1 widths at 1366 px', () => {
  assert.deepEqual(computeLayout({ W: 1366, pct: 0.5, roster: true, drawer: 'docked' }), { rosterW: 360, rosterMode: 'full', drawerW: 683, worldW: 323 });
  assert.deepEqual(computeLayout({ W: 1366, pct: 0.8, roster: true, drawer: 'docked' }), { rosterW: 64, rosterMode: 'rail', drawerW: 1062, worldW: 240 });
  assert.equal(computeLayout({ W: 1366, pct: 0.35, roster: false, drawer: 'docked' }).drawerW, 480);
  assert.equal(computeLayout({ W: 1920, pct: 0.5, roster: false, drawer: 'fullscreen' }).drawerW, 1920);
});

test('roster: group badges split blocked (▲) from done-unacked (✓); names qualify only on collision', () => {
  const ents = [
    E('b', { status: 'blocked' }), E('d1', { status: 'done' }), E('d2', { status: 'done', ack: { at: 1 } }),
    E('st', { struggle: { level: 1 } }),
  ];
  const g = buildRoster(ents, { mode: 'workspace' }).list.find(isGroup);
  assert.equal(g?.blocked, 1);
  assert.equal(g?.doneUnacked, 1);
  const noBlocked = buildRoster([E('d1', { status: 'done' })], { mode: 'tool' }).list.find(isGroup);
  assert.equal(noBlocked?.blocked, 0, 'done-only group shows no ▲');
  const ws2 = { id: 'w2', label: 'infra', number: 2, colorIndex: 1 };
  const a = E('a', { name: 'claude' }), b = E('b', { name: 'claude', workspace: ws2 }), c = E('c', { name: 'scout' });
  assert.equal(nameQualifier(c, [a, b, c]), '');
  assert.equal(nameQualifier(a, [a, b, c]), 'hq-core');
  assert.equal(nameQualifier(b, [a, b, c]), 'infra');
  const t2 = E('t2', { name: 'claude', tab: { id: 't2', label: 'api', number: 2 } });
  assert.equal(nameQualifier(t2, [a, t2]), 'hq-core › api');
  const same = E('z', { name: 'claude' });
  assert.equal(nameQualifier(a, [a, same]), 'hq-core › claude #1');
  assert.equal(nameQualifier(same, [a, same]), 'hq-core › claude #2');
});

test('fit: observe grid never crops the pane (max of drawer grid and layoutRect)', () => {
  assert.deepEqual(observeGrid({ cols: 98, rows: 50 }, { cols: 120, rows: 40 }), { cols: 120, rows: 50 });
  assert.deepEqual(observeGrid({ cols: 98, rows: 50 }, null), { cols: 98, rows: 50 });
  assert.deepEqual(observeGrid(null, { cols: 120, rows: 40 }), { cols: 120, rows: 40 });
  // a 200-col pane in a drawer that shows 140 cols at the 0.7× font: capped (no pan), the drawer shows a crop chip
  assert.deepEqual(observeGrid({ cols: 98, rows: 42 }, { cols: 200, rows: 50 }, { cols: 140, rows: 60 }), { cols: 140, rows: 50 });
  assert.deepEqual(observeGrid({ cols: 98, rows: 42 }, { cols: 120, rows: 40 }, { cols: 140, rows: 60 }), { cols: 120, rows: 42 });
  // 120 cols fit an 800 px box at ≥ 0.7× of 14 px (cell ≈ 0.6 em) → no pan
  const cw = (px: number) => px * 0.6, ch = (px: number) => px * 1.2;
  const lb = letterbox({ boxW: 800, boxH: 700, cols: 120, rows: 50, fontPx: 14, cellW: cw, cellH: ch });
  assert.ok(!lb.pan && lb.fontPx >= 10, JSON.stringify(lb));
});

test('glyphs: missing Claude-UI glyphs swap in place (3-byte UTF-8), split sequences carry over', async () => {
  const { buildGlyphTable, glyphMapper } = await import('./terminal/glyphs.ts');
  const table = buildGlyphTable((ch) => !['⎿', '⏺'].includes(ch));
  const map = glyphMapper(table);
  const enc = new TextEncoder(), dec = new TextDecoder();
  assert.equal(dec.decode(map(enc.encode('⏺ Bash(ls)\r\n  ⎿ ok ✻'))), '● Bash(ls)\r\n  └ ok ✻');
  const b = enc.encode('a⎿b');
  const out = dec.decode(map(b.subarray(0, 2))) + dec.decode(map(b.subarray(2)));
  assert.equal(out, 'a└b');
  const same = enc.encode('plain ascii');
  assert.equal(map(same), same, 'no copy without a hit');
  assert.equal(glyphMapper(new Map())(same), same);
});

// ---- crosshair aim (real rigs, oriented body boxes, nearest entry depth) ----
import * as THREE from 'three';
import { createAim, AIM_MAX_DIST } from './aim.ts';
import { createRig } from '../chars/rig/clawd.ts';

function aimScene(specs: [string, 'claude' | 'shell', number, number, number?][]) {
  const list = specs.map(([id, kind, x, z, y = 0]) => {
    const rig = createRig({ kind, seedKey: id });
    rig.root.position.set(x, y, z);
    rig.root.updateMatrixWorld(true);
    return { id, entity: ent({ id, name: id, kind }), pos: { x, y, z }, yaw: 0, rig };
  });
  return { list: () => list };
}
const camAt = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => {
  const c = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 100);
  c.position.set(x, y, z); c.lookAt(tx, ty, tz); c.updateMatrixWorld(true);
  return c;
};

test('aim: a Clawd behind a foreground Shelly wins when the reticle is on the Clawd (nearest depth at the pixel)', () => {
  // Shelly 2 m ahead, a little left of and below the line of sight to a Clawd 6.5 m away (the review repro shape)
  const actors = aimScene([['dev2', 'shell', -0.35, -2], ['tinker', 'claude', 0, -6.5]]);
  const aim = createAim(actors);
  assert.equal(aim.pick(camAt(0, 1.3, 0, 0, 0.5, -6.5))?.id, 'tinker');
  // looking straight at the Shelly's monitor head picks the Shelly (it is in front)
  assert.equal(aim.pick(camAt(0, 1.3, 0, -0.35, 0.55, -2))?.id, 'dev2');
  // a Shelly directly in front of the Clawd occludes it
  const blocked = createAim(aimScene([['dev2', 'shell', 0, -2], ['tinker', 'claude', 0, -6.5]]));
  assert.equal(blocked.pick(camAt(0, 0.5, 0, 0, 0.5, -6.5))?.id, 'dev2');
});

test('aim: body height, not a sphere at 0.5 m; reach covers the proto room', () => {
  const aim = createAim(aimScene([['a', 'claude', 0, -3]]));
  assert.equal(aim.pick(camAt(0, 1.6, 0, 0, 0.8, -3))?.id, 'a', 'top of the head');
  assert.equal(aim.pick(camAt(0, 1.6, 0, 0, 1.3, -3)), null, 'above the head');
  assert.equal(aim.pick(camAt(0, 1.6, 0, 0.7, 0.4, -3)), null, 'beside the body');
  const far = createAim(aimScene([['f', 'claude', 0, -8.5]]));
  assert.ok(AIM_MAX_DIST >= 9);
  assert.equal(far.pick(camAt(0, 1.2, 0, 0, 0.4, -8.5))?.id, 'f');
  // stale / missing rig matrices fall back to an upright box at the feet
  const bare = createAim({ list: () => [{ id: 'b', entity: ent({ name: 'b', kind: 'claude' }), pos: { x: 0, y: 0, z: -4 }, yaw: 0.3 }] });
  assert.equal(bare.pick(camAt(0, 1.6, 0, 0, 0.5, -4))?.id, 'b');
});

test('aim: layout walls occlude (solid span), openings / glass rails do not; furniture never', () => {
  const actors = aimScene([['a', 'claude', 0, -5]]);
  // a full-height wall across the sightline at z = -2.5 (x -3..3)
  const solid: Pick<Layout, 'walls'> = { walls: [{ a: [-3, -2.5], b: [3, -2.5], h: 2.8 }] };
  assert.equal(createAim(actors, () => solid).pick(camAt(0, 1.6, 0, 0, 0.5, -5)), null, 'behind a solid wall');
  assert.equal(createAim(actors, () => null).pick(camAt(0, 1.6, 0, 0, 0.5, -5))?.id, 'a', 'no layout: no occluders');
  // door 1.4 m wide centred on x = 0 (at = 2.3 from a), sill 0, 2.1 high → visible through it
  const door: Pick<Layout, 'walls'> = { walls: [{ a: [-3, -2.5], b: [3, -2.5], h: 2.8, openings: [{ at: 2.3, w: 1.4, h: 2.1, sill: 0, kind: 'door' }] }] };
  assert.equal(createAim(actors, () => door).pick(camAt(0, 1.6, 0, 0, 0.5, -5))?.id, 'a', 'through a door');
  // window with sill 0.9: the ray crosses the wall at y ≈ 1.6 − 2.5·(1.1/5) ≈ 1.05 → inside [0.9, 2.1] → visible
  const win: Pick<Layout, 'walls'> = { walls: [{ a: [-3, -2.5], b: [3, -2.5], h: 2.8, openings: [{ at: 2.3, w: 1.4, h: 1.2, sill: 0.9, kind: 'window' }] }] };
  assert.equal(createAim(actors, () => win).pick(camAt(0, 1.6, 0, 0, 0.5, -5))?.id, 'a', 'through a window');
  // same window, but crouched view line crosses below the sill → occluded
  assert.equal(createAim(actors, () => win).pick(camAt(0, 0.6, 0, 0, 0.4, -5)), null, 'below the sill');
  // a low rail and a wall past the actor never occlude
  const rail: Pick<Layout, 'walls'> = { walls: [{ a: [-3, -2.5], b: [3, -2.5], h: 1.0, kind: 'rail' }, { a: [-3, -7], b: [3, -7], h: 3 }] };
  assert.equal(createAim(actors, () => rail).pick(camAt(0, 1.6, 0, 0, 0.5, -5))?.id, 'a', 'rail / wall behind');
  // a wall parallel to the ray, beside it, does not occlude
  const side: Pick<Layout, 'walls'> = { walls: [{ a: [1, 0], b: [1, -8], h: 3 }] };
  assert.equal(createAim(actors, () => side).pick(camAt(0, 1.6, 0, 0, 0.5, -5))?.id, 'a');
});

// ---- M2: unread (§8.9), away recap (§6.4.5), serve card model (§6.8.1 / §8.8), serve keys ----
import { createUnread, unreadLabel } from './unread.ts';
import { buildRecap, createRing, awayDue, mmss, nameList } from './recap.ts';
import { blockedQueue, doneQueue, cardRows, rowForDigit, confirmText, questionText, answerOutcome, isRule, firstQuestionLine, dangerOf, initialRow } from './serveModel.ts';

const memIo = (init: SavedMark[] | null = null) => { let v = init; return { load: () => v, save: (x: SavedMark[]) => { v = JSON.parse(JSON.stringify(x)); }, get v() { return v; } }; };

test('unread: bump / clear, persisted by stable identity, rebinds after a reload with new pane ids', () => {
  const io = memIo();
  const u = createUnread(io);
  const a = { id: 'w1:p1', identity: { ...ident('t-a'), place: 'x' } };
  u.bump(a); u.bump(a); u.bump({ id: 'w1:p2', identity: ident('t-b') });
  assert.equal(u.of('w1:p1'), 2);
  assert.equal(u.total(), 3);
  u.clear('w1:p2');
  assert.equal(u.of('w1:p2'), 0);
  // reload: same identity, new pane id
  const u2 = createUnread(memIo(io.v));
  u2.rebind([{ id: 'w9:p7', identity: ident('t-a') }]);
  assert.equal(u2.of('w9:p7'), 2);
  u2.rekey('w9:p7', 'w9:p8');
  assert.equal(u2.of('w9:p8'), 2);
  assert.equal(u2.of('w9:p7'), 0);
  assert.equal(unreadLabel(0), ''); assert.equal(unreadLabel(1), '•'); assert.equal(unreadLabel(4), '4'); assert.equal(unreadLabel(12), '9+');
  for (let i = 0; i < 200; i++) u.bump(a);
  assert.equal(u.of('w1:p1'), 99);
});

test('fix r3 art: recap lines name namesakes apart and carry the agent\'s own lamp (never the shell CRT for a Claude)', () => {
  const now = 10_000_000;
  const ents = [
    ent({ id: 'p1', name: 'claude', kind: 'claude', status: 'working' }),
    ent({ id: 'p2', name: 'claude', kind: 'claude', status: 'idle' }),
    ent({ id: 's1', name: 'sh', kind: 'shell', status: 'idle', process: { activity: 'run' } }),
  ];
  const label = (e: Entity) => (e.id === 'p2' ? 'claude · 2' : e.name);
  const ev = (kind: string, id: string): RingItem => ({ at: now - 1000, id, name: 'claude', kind });
  const lines = buildRecap({ events: [ev('test-fail', 'p1'), ev('test-fail', 'p2'), ev('commit', 'p2'), ev('left', 'gone')], entities: ents, now, label });
  const t = lines.find((l) => l.kind === 'tests');
  assert.ok(t);
  assert.equal(t.name, 'claude');
  assert.match(t.say ?? '', /so does claude · 2/);
  assert.equal(t.lamp, 'working');
  assert.notEqual(t.lamp, 'busy');
  const c = lines.find((l) => l.kind === 'commit');
  assert.ok(c);
  assert.equal(c.name, 'claude · 2');
  assert.equal(c.lamp, 'idle');
  const crowd = lines.find((l) => l.kind === 'crowd');
  assert.ok(crowd);
  assert.equal(crowd.lamp, null, 'a departed agent gets no lamp');
  const sh = buildRecap({ events: [{ at: now - 1, id: 's1', name: 'sh', kind: 'test-fail' }], entities: ents, now, label });
  assert.equal(sh[0].lamp, 'busy', 'a shell keeps its CRT lamp');
});

test('recap: §6.4.5 order, ≤ 6 lines, honest quiet line', () => {
  const now = 10_000_000;
  const ents = [
    ent({ id: 'b1', name: 'tinker', status: 'blocked', statusSince: now - 41 * 60_000 - 2000 }),
    ent({ id: 'b2', name: 'scout', status: 'blocked', statusSince: now - 60_000 }),
    ent({ id: 'i1', name: 'moss', status: 'idle', kind: 'claude' }),
  ];
  const ev2 = (kind: string, id: string, name: string, extra: Partial<RingItem> = {}): RingItem => ({ at: now - 1000, id, name, kind, ...extra });
  const events = [
    ev2('finished', 'x1', 'relay'), ev2('status', 'x2', 'quill', { to: 'done' }), ev2('commit', 'x1', 'relay'), ev2('commit', 'x1', 'relay'),
    ev2('test-pass', 's', 'scout'), ev2('test-pass', 's', 'scout'), ev2('test-pass', 's', 'scout'), ev2('test-fail', 'q', 'quill'),
    ev2('arrived', 'n', 'nova'), ev2('left', 'p', 'pike'), ev2('struggle', 'e', 'ember', { detail: { level: 2 } }),
  ];
  const lines = buildRecap({ events, entities: ents, now });
  assert.equal(lines.length, 6);
  assert.deepEqual(lines.map((l) => l.kind), ['blocked', 'finished', 'commit', 'tests', 'crowd', 'struggle']);
  assert.equal(lines[0].strong, '2 blocked');
  assert.match(lines[0].text, /tinker waiting 41:02/);
  assert.equal(lines[0].id, 'b1');
  assert.match(lines[1].strong + lines[1].text, /2 finished · quill and relay|2 finished · relay and quill/);
  assert.match(lines[2].strong + lines[2].text, /2 commits · relay 2/);
  assert.match(lines[3].text, /scout 3× pass/);
  assert.match(lines[3].text, /quill failing/);
  assert.match(lines[4].strong + lines[4].text, /1 arrived \(nova\) · 1 left \(pike\)/);
  assert.match(lines[5].strong + lines[5].text, /ember struggled \(level 2\)/);
  const quiet = buildRecap({ events: [], entities: [ent({ id: 'a', status: 'idle', kind: 'claude' }), ent({ id: 'b', status: 'idle', kind: 'claude' })], now });
  assert.deepEqual(quiet.map((l) => l.strong + l.text), ['All quiet · 2 idle, dust settling']);
  assert.equal(mmss(3_723_000), '1:02:03');
  assert.equal(nameList(['a', 'b', 'c', 'd', 'e']), 'a, b, c +2');
  assert.ok(awayDue(now - 11 * 60_000, now, 10));
  assert.ok(!awayDue(now - 9 * 60_000, now, 10));
  assert.ok(!awayDue(now - 99 * 60_000, now, 0), '0 = off');
  const ring = createRing(3);
  for (let i = 0; i < 5; i++) ring.push({ at: i, id: 'x', kind: 'commit' });
  assert.deepEqual(ring.items.map((x) => x.at), [2, 3, 4]);
  assert.deepEqual(ring.since(3).map((x) => x.at), [3, 4]);
});

test('serve card model: queue order, 1–9 rows + Open terminal, confirm text, reply outcomes', () => {
  const es = [
    ent({ id: 'a', status: 'blocked', statusSince: 30 }), ent({ id: 'b', status: 'blocked', statusSince: 10 }), ent({ id: 'c', status: 'done', statusSince: 5 }),
    ent({ id: 'd', status: 'done', statusSince: 1, ack: { at: 1, by: 'hq' } }), ent({ id: 'e', status: 'done', statusSince: 2, kind: 'shell' }),
  ];
  assert.deepEqual(blockedQueue(es).map((e) => e.id), ['b', 'a']);
  assert.deepEqual(doneQueue(es).map((e) => e.id), ['c']);
  const prompt = { question: '────────\nDo you trust the files in this folder?\n', options: [{ key: '1', label: 'Yes, proceed', index: 0 }, { key: '2', label: 'No, exit', index: 1 }], hash: 'h' };
  const rows = cardRows(prompt);
  assert.deepEqual(rows.map((r) => r.kind), ['opt', 'opt', 'open']);
  assert.equal(rowForDigit(rows, 2), 1);
  assert.equal(rowForDigit(rows, 7), -1);
  assert.equal(confirmText({ name: 'tinker' }, rows[0]), 'Send ‘1. Yes, proceed’ to tinker?');
  assert.equal(questionText(prompt), 'Do you trust the files in this folder?', 'TUI rules dropped');
  assert.equal(firstQuestionLine('╭──────╮\n  Edit file?'), 'Edit file?');
  assert.ok(isRule('  ───── … ') && !isRule('Yes — do it'));
  assert.deepEqual(cardRows(null).map((r) => r.kind), ['open'], 'free-text prompt: terminal only');
  // bullets (not numbered): keys are the option keys, digits still pick the n-th option
  const b = cardRows({ options: [{ key: 'a', label: 'Fade' }, { key: 'b', label: 'Pop' }] });
  assert.equal(rowForDigit(b, 2), 1);
  assert.equal(answerOutcome({ ok: true }), 'sent');
  assert.equal(answerOutcome({ ok: false, error: 'prompt_changed', prompt: { hash: 'x' } }), 'changed');
  assert.equal(answerOutcome({ ok: false, error: 'prompt_changed', prompt: null }), 'gone');
  assert.equal(answerOutcome({ ok: false, error: 'not_accepted' }), 'notAccepted');
  assert.equal(answerOutcome({ ok: false, error: 'internal' }), 'failed');
});

test('serve card: destructive options are flagged, never the initial highlight, and the confirm says what happens', () => {
  for (const l of ['No, exit', 'Quit', 'End session', 'Exit Claude Code']) assert.equal(dangerOf(l), 'exit', l);
  for (const l of ['No', 'No, and tell Claude what to do differently (esc)', 'No, keep planning', 'Reject', 'Cancel', 'Deny']) assert.equal(dangerOf(l), 'reject', l);
  for (const l of ['Yes', 'Yes, proceed', "Yes, and don't ask again for this command", 'Yes, delete the old file', 'Nothing else', 'Know more']) assert.equal(dangerOf(l), null, l);
  // tinker's folder-trust prompt with Claude Code's ❯ on "No, exit": the card starts on the safe option
  const trust = cardRows({ options: [{ key: '1', label: 'No, exit' }, { key: '2', label: 'Yes, proceed' }] });
  assert.equal(initialRow(trust, 0), 1);
  assert.equal(initialRow(trust, 1), 1);
  // only destructive options → Open terminal (Enter opens the terminal, never sends)
  const bad = cardRows({ options: [{ key: '1', label: 'No, exit' }, { key: '2', label: 'Cancel' }] });
  assert.equal(bad[initialRow(bad, 0)].kind, 'open');
  assert.equal(initialRow(cardRows(null), 0), 0);
  assert.equal(confirmText({ name: 'tinker', kind: 'claude' }, trust[0]), 'Send ‘1. No, exit’ to tinker? This exits tinker\'s Claude session.');
  assert.match(confirmText({ name: 'moss' }, bad[1]), /refuses the request/);
  assert.equal(confirmText({ name: 'moss' }, trust[1]), 'Send ‘2. Yes, proceed’ to moss?');
});

test('keymap M2: serve scope digits/confirm, world G = high-five, M = map, B = inbox', () => {
  assert.equal(resolveKey('serve', ev('Digit2'), false)?.action, 'option');
  assert.equal(resolveKey('serve', ev('Digit2'), false)?.arg, 2);
  assert.equal(resolveKey('serve', ev('Enter'), false)?.action, 'choose');
  assert.equal(resolveKey('serve', ev('KeyS'), false)?.action, 'down');
  assert.equal(resolveKey('serve', ev('KeyW'), false)?.action, 'up');
  assert.equal(resolveKey('serve', ev('Escape'), false)?.action, 'close');
  assert.equal(resolveKey('serve', ev('KeyO'), false)?.action, 'openTerm');
  assert.equal(resolveKey('world-locked', ev('KeyG'), false)?.action, 'highFive');
  assert.equal(resolveKey('world-locked', ev('KeyM'), false)?.action, 'map');
  assert.equal(resolveKey('world-unlocked', ev('KeyB'), false)?.action, 'inbox');
  assert.equal(resolveKey('roster', ev('KeyG'), false)?.action, 'goTo', 'roster G stays go-to');
  const rows = overlayRows('serve', false);
  const acts = new Set(rows.map((r) => r.action).filter((x): x is string => !!x));
  for (const x of BINDINGS.serve) if (x.action) assert.ok(acts.has(x.action), `serve overlay lists ${x.action}`);
});

// ---- fix round 1: map label declutter ----
import { layoutLabels } from './minimap.ts';

test('map labels: a row of shells 0.5 m apart never overlaps; clusters fold into +N; blocked always placed', () => {
  const measure = (t: string) => t.length * 6.5;
  // the hq ENG shell row: 5 shells ~12 px apart on screen (0.5 m), plus a blocked agent on top of the row
  const names = ['dev', 'dev·2', 'git', 'tmp', 'tmp·2'];
  const items = names.map((n, i) => ({ id: `s${i}`, x: 100 + i * 12, y: 100, wx: i * 0.5, wz: 0, r: 6, text: n, isB: false, prio: 3 }));
  items.push({ id: 'b', x: 124, y: 104, wx: 1, wz: 0.1, r: 7.2, text: '▲ tinker', isB: true, prio: 0 });
  const placed = layoutLabels(items, measure);
  const boxes = placed.map((p) => [p.tx - 2, p.ty - 10, p.tx + p.w + 2, p.ty + 3]);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(!(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]), `${placed[i].it.text} overlaps ${placed[j].it.text}`);
  }
  assert.ok(placed.some((p) => p.it.id === 'b'), 'blocked label placed');
  const shown = placed.length + placed.reduce((n, p) => n + p.more, 0);
  assert.equal(shown, items.length, 'every dot is either labelled or counted in a +N bubble');
  // isolated dots keep the plain right-hand label
  const solo = layoutLabels([{ id: 'x', x: 50, y: 50, wx: 0, wz: 0, r: 6, text: 'scout', isB: false, prio: 2 }], measure);
  assert.equal(solo[0].tx, 60);
  assert.equal(solo[0].lead, false);
});

// ---- UI fix r2: hat aim box, off-axis world strip, breadcrumb, long confirm labels ----
test('aim: the hat (rig.crown from ACC_TOP) is part of the body; top() is the aim boxes\' world top', () => {
  const mk = (id: string, colorIndex: number | undefined) => {
    const rig = createRig({ kind: 'claude', seedKey: id, colorIndex });
    rig.root.position.set(0, 0, -4); rig.root.updateMatrixWorld(true);
    return { id, entity: ent({ id, name: id, kind: 'claude' }), pos: { x: 0, y: 0, z: -4 }, yaw: 0, rig };
  };
  const cone = mk('c', 2), bare = mk('b', undefined);
  const aimC = createAim({ list: () => [cone] }), aimB = createAim({ list: () => [bare] });
  const tc = aimC.top(cone), tb = aimB.top(bare);
  assert.ok(tc > tb + 0.15, `cone top ${tc.toFixed(2)} > bare top ${tb.toFixed(2)}`);
  const y = (tb + tc) / 2; // over a bare head, inside the cone
  assert.equal(aimC.pick(camAt(0, y, 0, 0, y, -4))?.id, 'c', 'the reticle on the hat opens its wearer');
  assert.equal(aimB.pick(camAt(0, y, 0, 0, y, -4)), null, 'no hat, no hit');
  assert.equal(aimC.pick(camAt(0, tc + 0.06, 0, 0, tc + 0.06, -4)), null, 'just over the hat top misses');
});

test('stripView: projection centred on the world strip; the reticle ray is the camera axis', async () => {
  const { stripView } = await import('./layout.ts');
  assert.equal(stripView(1600, 0, 0), null);
  assert.equal(stripView(1600, 300, 300), null, 'symmetric strip');
  const v = stripView(1600, 372, 0); // roster open
  assert.deepEqual(v, { fullW: 2 * 986, offsetX: 986 - 986 }); // cx = 986 → virtual frame [0, 1972], canvas at 0
  const w = stripView(1600, 0, 640); // drawer docked right: cx = 480
  assert.deepEqual(w, { fullW: 2 * 1120, offsetX: 1120 - 480 });
  // with three's setViewOffset the strip centre projects to NDC.x of (cx / W) * 2 - 1 and is on the camera axis
  const W = 1600, H = 900, c = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  const s = stripView(W, 372, 480), cx = (372 + (W - 480)) / 2;
  assert.ok(s);
  c.aspect = s.fullW / H; c.setViewOffset(s.fullW, H, s.offsetX, 0, W, H); c.updateProjectionMatrix(); c.updateMatrixWorld(true);
  const p = new THREE.Vector3(0, 0, -5).project(c);
  assert.ok(Math.abs(p.x - ((cx / W) * 2 - 1)) < 1e-6 && Math.abs(p.y) < 1e-6, `axis → ${p.x.toFixed(4)}`);
  // pixel scale unchanged (vertical fov and height are the same): a point 1 m up at 5 m stays at the same NDC y
  const q = new THREE.Vector3(0, 1, -5).project(c);
  const c0 = new THREE.PerspectiveCamera(70, W / H, 0.05, 100); c0.updateMatrixWorld(true);
  assert.ok(Math.abs(q.y - new THREE.Vector3(0, 1, -5).project(c0).y) < 1e-6);
});

test('inbox breadcrumb collapses repeats; long option labels are clipped in the confirm sentence', async () => {
  const { crumbLabel, clipLabel, CONFIRM_LABEL_MAX } = await import('./serveModel.ts');
  assert.equal(crumbLabel('hq-core', 'hq-core', 'claude'), 'hq-core › claude');
  assert.equal(crumbLabel('hq-core › claude', 'hq-core', 'claude'), 'hq-core › claude');
  assert.equal(crumbLabel('hq-core › claude #2', 'hq-core', 'claude'), 'hq-core › claude #2');
  assert.equal(crumbLabel('', 'web', 'web'), 'web');
  assert.equal(crumbLabel('', 'web', 'api'), 'web › api');
  const long = 'Yes, and don\'t ask again for bash commands in /home/david/claude-hq';
  const c = clipLabel(long);
  assert.ok(c.length <= CONFIRM_LABEL_MAX && c.endsWith('…'), c);
  assert.equal(clipLabel('Yes'), 'Yes');
  assert.equal(confirmText({ name: 'tinker' }, { n: 2, label: long }), `Send ‘2. ${c}’ to tinker?`);
});

// ---- reviewer r3 (UI fix round 3) ----
import { isFreeText } from './serveModel.ts';
import { cmpNeedsYou, comparator } from './roster/model.ts';
import { statusCardGeometry, RETICLE_CLEAR_PX } from './layout.ts';

test('serve card r3: every card change starts on a safe row, never on the previous card\'s index or an EXIT option', () => {
  const opts = (...labels: string[]) => ({ options: labels.map((label, i) => ({ key: String(i + 1), label, index: i })) });
  const orbit = cardRows(opts('Keep both for one release', 'Drop the old keys now', 'Type something.'));
  const comet = cardRows(opts('Yes, proceed', 'No, exit'));
  const exitFirst = cardRows(opts('No, exit', 'Yes, proceed'));
  // the previous card's index (2 = orbit's 'Type something.') is not an input: a stale / out-of-range ❯ falls back safely
  for (const sel of [undefined, null, 0, 1, 2, 7, -1]) {
    const i = initialRow(comet, sel);
    assert.equal(comet[i].kind, 'opt');
    assert.equal(comet[i].danger, null, `comet highlight for selected=${sel} is ${comet[i].label}`);
    const j = initialRow(exitFirst, sel);
    assert.notEqual(exitFirst[j].danger, 'exit', `exit-first highlight for selected=${sel}`);
  }
  assert.equal(orbit[initialRow(orbit, 2)].label, 'Type something.'); // Claude Code's own ❯ on a safe option is kept
  // no option is safe → Open terminal, never an EXIT
  const allBad = cardRows(opts('No, exit', 'No, and tell Claude what to do differently'));
  assert.equal(allBad[initialRow(allBad, 0)].kind, 'open');
});

test('serve card r3: free-text options are classified and the confirm says to type in the terminal', () => {
  assert.ok(isFreeText('Type something.'));
  assert.ok(isFreeText('No, and tell Claude what to do differently'));
  assert.ok(isFreeText('No, and tell Codex what to do differently (esc)'));
  assert.ok(!isFreeText('Yes, proceed'));
  assert.ok(!isFreeText('No, exit'));
  const rows = cardRows({ options: [{ key: '1', label: 'Yes' }, { key: '2', label: 'Type something.' }, { key: '3', label: 'No, and tell Claude what to do differently' }] });
  assert.equal(rows[1].free, true);
  assert.equal(rows[0].free, false);
  const e = ent({ name: 'orbit', kind: 'claude' });
  assert.match(confirmText(e, rows[1]), /then type your reply in orbit's terminal/i);
  assert.match(confirmText(e, rows[2]), /refuses the request; then type your reply in orbit's terminal/);
});

test('needs-you r3: roster, inbox queue, oldestBlocked and initial selection agree when statusSince ties', () => {
  const T = 1000;
  const ents = [
    ent({ id: 'p3', name: 'pike', kind: 'claude', status: 'blocked', statusSince: T, activity: { since: T + 900 } }),
    ent({ id: 'p1', name: 'claude', kind: 'claude', status: 'blocked', statusSince: T, activity: { since: T + 10 } }),
    ent({ id: 'p2', name: 'comet', kind: 'claude', status: 'blocked', statusSince: T }),
    ent({ id: 'p4', name: 'idle', kind: 'claude', status: 'idle', statusSince: 0 }),
  ];
  const q = blockedQueue(ents).map((e) => e.id);
  assert.deepEqual(q, ['p1', 'p2', 'p3']);
  assert.equal(oldestBlocked(ents)?.id, q[0]);
  const r = buildRoster(ents, { mode: 'state', sort: 'recent' });
  assert.equal(initialSelection(r.list, new Map(ents.map((e) => [e.id, e])), null), q[0]);
  assert.deepEqual(r.list.filter(isRow).map((x) => x.id).slice(0, 3), q);
  for (const s of ['name', 'elapsed', 'recent'] as const) assert.deepEqual([...ents].sort(comparator(s)).slice(0, 3).map((e) => e.id), q, `sort ${s}`);
  assert.equal(cmpNeedsYou(ents[3], ents[0]) > 0, true);
});

test('status card r3: never covers the reticle ± 60 px; compact under 900 px of strip', () => {
  for (const [W, H] of [[683, 768], [1366, 768], [546, 768], [420, 700], [899, 900], [900, 900], [1920, 1080], [300, 600]]) {
    const g = statusCardGeometry(W, H);
    // card: right-aligned 12 px from the strip edge, bottom-anchored 12 px up; reticle at the strip centre
    const x0 = W - 12 - g.w, y0 = H - 12 - g.maxH;
    const clearX = x0 >= W / 2 + RETICLE_CLEAR_PX;
    const clearY = y0 >= H / 2 + RETICLE_CLEAR_PX;
    assert.ok(clearX || clearY, `${W}×${H}: card ${g.w}×${g.maxH} at (${x0}, ${y0}) covers the reticle`);
    assert.equal(g.compact, W < 900);
    if (g.compact) { assert.ok(g.w <= Math.max(180, 0.4 * W) + 0.5, `${W}: width ${g.w}`); assert.ok(g.maxH <= 0.45 * H + 0.5); }
  }
});

test('M3 deep links: names, ids, ws/name, keywords, ambiguity, agents before shells', async () => {
  const { resolveDeepLink } = await import('./deeplink.ts');
  const ents = [
    ent({ id: 'p1', name: 'scout', kind: 'claude', workspace: { label: 'hq-core' } }),
    ent({ id: 'p2', name: 'scout', kind: 'claude', workspace: { label: 'tinker' } }),
    ent({ id: 'p3', name: 'dev', kind: 'shell', workspace: { label: 'tinker' } }),
    ent({ id: 'p4', name: 'dev', kind: 'codex', workspace: { label: 'tinker' } }),
    ent({ id: 'p5', name: 'pike', kind: 'claude', workspace: { label: 'hq-core' } }),
    ent({ id: 'p6', name: 'inbox', kind: 'claude', workspace: { label: 'x' } }),
  ];
  assert.deepEqual(resolveDeepLink('p5', ents), { kind: 'agent', id: 'p5' });
  assert.deepEqual(resolveDeepLink('PIKE', ents), { kind: 'agent', id: 'p5' });
  assert.deepEqual(resolveDeepLink('pi', ents), { kind: 'agent', id: 'p5' }, 'unique prefix');
  assert.equal(resolveDeepLink('scout', ents).kind, 'ambiguous');
  assert.deepEqual(resolveDeepLink('tinker/scout', ents), { kind: 'agent', id: 'p2' });
  assert.deepEqual(resolveDeepLink('scout@hq-core', ents), { kind: 'agent', id: 'p1' });
  assert.deepEqual(resolveDeepLink('hq-core › scout', ents), { kind: 'agent', id: 'p1' });
  assert.deepEqual(resolveDeepLink('dev', ents), { kind: 'agent', id: 'p4' }, 'the agent wins over a namesake shell');
  assert.deepEqual(resolveDeepLink('inbox', ents), { kind: 'inbox' });
  assert.deepEqual(resolveDeepLink('agent:inbox', ents), { kind: 'agent', id: 'p6' });
  assert.deepEqual(resolveDeepLink('roster:directory', ents), { kind: 'roster', groupBy: 'directory' });
  assert.deepEqual(resolveDeepLink('roster:bogus', ents), { kind: 'roster', badGroup: 'bogus' }, 'an unknown group-by is reported (toast), never silently State');
  // [m2-r2] the roster's own short labels (Dir · Space · Proj) and common spellings
  for (const [q, g] of [['dir', 'directory'], ['ws', 'workspace'], ['space', 'workspace'], ['workspace', 'workspace'], ['proj', 'project'], ['project', 'project'], ['tab', 'tab'], ['state', 'state'], ['kind', 'kind'], ['tool', 'tool']]) {
    assert.deepEqual(resolveDeepLink(`roster:${q}`, ents), { kind: 'roster', groupBy: g }, `roster:${q}`);
  }
  assert.deepEqual(resolveDeepLink('nobody', ents), { kind: 'none' });
  assert.deepEqual(resolveDeepLink('', ents), { kind: 'none' });
});

test('M3 onboarding: each card is gated by doing the thing; automation never auto-starts it', async () => {
  const { stepDone, shouldAutoStart } = await import('./onboarding.ts');
  const z = { look: 0, walk: 0, aimed: false, opened: false, roster: false };
  assert.equal(stepDone(0, z), false);
  assert.equal(stepDone(0, { ...z, look: 1 }), true);
  assert.equal(stepDone(1, { ...z, look: 5 }), false, 'looking does not count as walking');
  assert.equal(stepDone(1, { ...z, walk: 3 }), true);
  assert.equal(stepDone(2, { ...z, aimed: true }), true);
  assert.equal(stepDone(3, { ...z, aimed: true }), false);
  assert.equal(stepDone(3, { ...z, opened: true }), true);
  assert.equal(stepDone(4, { ...z, roster: true }), true);
  assert.equal(shouldAutoStart({ flag: null, webdriver: false, forced: false, nohud: false, pose: null }), true);
  assert.equal(shouldAutoStart({ flag: '1', webdriver: false, forced: false, nohud: false, pose: null }), false, 'first run only');
  assert.equal(shouldAutoStart({ flag: null, webdriver: true, forced: false, nohud: false, pose: null }), false, 'shoot/p2 never see it');
  assert.equal(shouldAutoStart({ flag: null, webdriver: false, forced: false, nohud: false, pose: 'spawn' }), false, 'canonical poses stay clean');
  assert.equal(shouldAutoStart({ flag: '1', webdriver: true, forced: true, nohud: false, pose: 'spawn' }), true, '?tour=1 forces it');
});

test('M3 prefs + portraits: prefs persist; portraits wear the workspace accessory (= CHR colorIndex % 8)', async () => {
  const { createPrefs } = await import('./settings.ts');
  const mem = new Map<string, string>();
  const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  const a = createPrefs(st);
  assert.equal(a.get('doneToasts'), true);
  a.set({ doneToasts: false });
  assert.equal(createPrefs(st).get('doneToasts'), false);
  const { portraitSvg, accessorySvg, ACCESSORY_NAMES, crestSvg, workspaceHex } = await import('./dom.ts');
  const { ACCESSORIES } = await import('../chars/rig/accessories.ts');
  assert.deepEqual([...ACCESSORY_NAMES], [...ACCESSORIES], 'same order as the 3D rig');
  for (let ci = 0; ci < 8; ci++) {
    const svg = portraitSvg({ kind: 'claude', status: 'working', workspace: { colorIndex: ci } }, 32);
    assert.ok(svg.includes(accessorySvg(ci, workspaceHex(ci))), `accessory ${ACCESSORIES[ci]} in the workspace colour`);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    assert.ok(crestSvg(ci).includes('<path'));
  }
  const faces = new Set((['working', 'blocked', 'done', 'idle'] as const).map((s) => portraitSvg({ kind: 'claude', status: s, workspace: { colorIndex: 0 } })));
  assert.equal(faces.size, 4, 'every state has its own face');
});

test('m2-r1 tour: card 3 needs a fresh aim held ≥ 400 ms (a reticle already resting on an agent does not count)', async () => {
  const { createAimGate, AIM_HOLD_MS } = await import('./onboarding.ts');
  assert.equal(AIM_HOLD_MS, 400);
  const g = createAimGate('rook');
  assert.equal(g.feed('rook', 0), false);
  assert.equal(g.feed('rook', 5000), false, 'the aim that was already there when the card appeared never passes');
  assert.equal(g.feed(null, 5100), false);
  assert.equal(g.feed('rook', 5200), false, 'fresh aim starts');
  assert.equal(g.feed('rook', 5500), false, '300 ms is not enough');
  assert.equal(g.feed('gale', 5550), false, 'switching agent restarts the hold');
  assert.equal(g.feed('gale', 5949), false);
  assert.equal(g.feed('gale', 5950), true);
  const g2 = createAimGate(null);
  assert.equal(g2.feed('a', 0), false);
  assert.equal(g2.feed('a', 400), true);
});

test('m2-r1 recap: done agents waiting for sign-off are listed with time in state, even with no finish event', () => {
  const now = 50_000_000;
  const ents = [
    ent({ id: 'b', name: 'claude', status: 'blocked', statusSince: now - 55_000 }),
    ent({ id: 'd1', name: 'moss', status: 'done', kind: 'claude', statusSince: now - 12 * 60_000 }),
    ent({ id: 'd2', name: 'willow', status: 'done', kind: 'claude', statusSince: now - 3 * 60_000 }),
    ent({ id: 'd3', name: 'gale', status: 'done', kind: 'claude', statusSince: now - 70_000 }),
    ent({ id: 'd4', name: 'acked', status: 'done', kind: 'claude', ack: { at: 1 }, statusSince: now - 1000 }),
    ent({ id: 's', name: 'dev', status: 'done', kind: 'shell', statusSince: now - 1000 }),
  ];
  const lines = buildRecap({ events: [], entities: ents, now });
  assert.deepEqual(lines.map((l) => l.kind), ['blocked', 'finished']);
  assert.equal(lines[0].strong + lines[0].text, '1 blocked · claude waiting 0:55');
  assert.equal(lines[1].strong + lines[1].text, '3 done · moss 12m, willow 3m and gale 1m');
  assert.equal(lines[1].id, 'd1');
  // a finish event for an agent that is still done is not counted twice
  const l2 = buildRecap({ events: [{ at: now - 1, id: 'd3', name: 'gale', kind: 'finished' }, { at: now - 1, id: 'x', name: 'relay', kind: 'finished' }], entities: ents, now });
  assert.equal(l2[1].strong + l2[1].text, '4 finished · moss 12m, willow 3m, gale 1m +1');
});

test('m2-r2 palette: tiered ranking across agents and actions (set → Settings, sign → sign off all, tour → Replay tour)', async () => {
  const { rankPalette, matchTier } = await import('./paletteRank.ts');
  const ag = (id: string, name: string, title: string, o: Deep<Entity> = {}) => ent({ id, name, kind: 'claude', status: 'working', title, workspace: { label: 'hq-core' }, tab: { label: name }, statusSince: 1, ...o });
  const ents = [
    ag('p1', 'flint', 'Coalesce store updates'), ag('p2', 'onyx', 'Reset the session tests'), ag('p3', 'claude', 'Parse settings file'),
    ag('p4', 'tinker', 'Set up the toast queue'), ag('p5', 'lumen', 'Ship the tour card', { status: 'blocked' }), ag('p6', 'settler', 'x'),
  ];
  const acts = [
    { id: 'roster', label: 'Open roster', hint: 'Tab' },
    { id: 'signoff', label: 'Sign off all done (2)', hint: 'HQ-local; herdr keeps its done' },
    { id: 'settings', label: 'Settings', hint: 'volumes, quality, FOV, terminal…' },
    { id: 'tour', label: 'Replay the tour (Ada)' },
    { id: 'font+', label: 'Terminal font larger', hint: 'Leader +' },
  ];
  const top = (q: string) => { const r = rankPalette(q, ents, acts)[0]; return r?.kind === 'agent' ? `agent:${r.e.name}` : `action:${r?.a.id}`; };
  // 'set': Settings (label prefix) beats settler? no: both are label prefixes → the agent 'settler' ties at tier 1; a
  // name-prefix agent is a fair first. Without settler, Settings must beat every task-text hit.
  assert.equal(top('settings'), 'action:settings', 'exact label');
  const noSettler = ents.filter((e) => e.id !== 'p6');
  const r = rankPalette('set', noSettler, acts);
  assert.equal(r[0]?.kind, 'action'); assert.equal(hitAction(r[0]), 'settings', "'set' + Enter opens Settings, not flint's terminal");
  assert.ok(r.findIndex((x) => x.kind === 'agent' && x.e.name === 'flint') > 0, 'flint still listed (subsequence), below Settings');
  assert.equal(hitAction(rankPalette('sign', noSettler, acts)[0]), 'signoff', "'sign' → Sign off all");
  assert.equal(hitAction(rankPalette('tour', noSettler, acts)[0]), 'tour', "'tour' → Replay the tour (word prefix beats lumen's task substring)");
  assert.equal(hitAgent(rankPalette('flint', noSettler, acts)[0]), 'p1', 'a name still wins for a name');
  assert.equal(hitAction(rankPalette('term', noSettler, acts)[0]), 'font+', 'word prefix inside a label');
  // tiers
  assert.equal(matchTier('set', ['settings'], []), 1);
  assert.equal(matchTier('set', ['flint'], ['coalesce store updates']), 6);
  assert.equal(matchTier('tour', ['replay the tour (ada)'], []), 2);
  assert.equal(matchTier('zzz', ['flint'], ['x']), null);
  // empty query: agents first (needs-you order), then ≤ 6 actions
  const e0 = rankPalette('', noSettler, acts);
  assert.equal(hitAgent(e0[0]), 'p5', 'blocked first');
  assert.equal(e0.filter((x) => x.kind === 'action').length, 5);
});

test('m2-r2 names: namesakes get the Big Board suffix everywhere (claude · 2)', async () => {
  const { createNames } = await import('./names.ts');
  const entities = new Map<string, Entity>([['p1', ent({ id: 'p1', name: 'claude' })], ['p2', ent({ id: 'p2', name: 'flint' })], ['p9', ent({ id: 'p9', name: 'claude' })]]);
  const n = createNames({ entities });
  assert.equal(n.label(must(entities, 'p1')), 'claude');
  assert.equal(n.label('p9'), 'claude · 2');
  assert.equal(n.label(must(entities, 'p2')), 'flint');
  entities.delete('p1');
  assert.equal(n.label('p9'), 'claude', 'recomputed when the set changes');
});

test('m2-r2 roster freeze: cross-group moves apply at once, only within-group order stays frozen', async () => {
  const { reconcileFrozen } = await import('./roster/model.ts');
  const G = (key: string): GroupItem => ({ type: 'group', key, label: key, count: 0, collapsed: false, needs: 0, blocked: 0, doneUnacked: 0, pinned: false });
  const R = (id: string, group: string): RowItem => ({ type: 'row', id, group });
  const frozen = [G('blocked'), R('a', 'blocked'), G('working'), R('b', 'working'), R('c', 'working'), G('idle'), R('d', 'idle'), R('e', 'idle')];
  // fresh: d started working (idle → working), c and b swapped by the recent sort, a new f idle
  const fresh = [G('blocked'), R('a', 'blocked'), G('working'), R('c', 'working'), R('d', 'working'), R('b', 'working'), G('idle'), R('f', 'idle'), R('e', 'idle')];
  const { list, pending } = reconcileFrozen(frozen, fresh);
  const flat = list.map((x) => (x.type === 'row' ? x.id : `#${x.key}`)).join(' ');
  assert.equal(flat, '#blocked a #working b d c #idle f e', 'd moved to Working at once (at its fresh slot); b/c keep the frozen order');
  assert.ok(pending > 0, 'the within-group swap is pending');
  assert.equal(reconcileFrozen(fresh, fresh).pending, 0);
  // a group that vanished / appeared follows fresh
  const r2 = reconcileFrozen(frozen, [G('working'), R('a', 'working'), R('b', 'working')]);
  assert.deepEqual(r2.list.map((x) => (x.type === 'row' ? x.id : x.key)), ['working', 'a', 'b']);
});

test('m2-r2 go there: stand point is clear, in sight and on the customer side of the Help Desk; glide follows the nav path', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { createNav } = await import('../world/nav/index.ts');
  const { pickStand, glidePath } = await import('./goto.ts');
  const nav = createNav(layout);
  const q = layout.slots.filter((s) => s.tag === 'queue').slice(0, 4);
  assert.ok(q.length >= 3, 'queue slots');
  const actors = q.map((s, i) => ({ id: `q${i}`, pos: { x: s.pos.x, y: layout.floorY(s.pos.x, s.pos.z, 0), z: s.pos.z }, yaw: s.yaw ?? 0 }));
  const a = actors[1];
  const from = layout.points.spawn ?? layout.spawn ?? { x: 0, z: 0 };
  const s = pickStand({ a, others: actors, layout, nav, eyeH: 1.2, from: { x: from.x, z: from.z, level: 0 } });
  assert.ok(s, 'a stand point');
  const d = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
  assert.ok(d >= 1.6 && d <= 2.85, `1.6–2.8 m away (${d.toFixed(2)}; m2-r3 minimum stand distance)`);
  assert.ok(!nav.collides(s.x, s.z, 0.28, 0), 'not inside a collider');
  for (const b of actors) if (b !== a) assert.ok(Math.hypot(b.pos.x - s.x, b.pos.z - s.z) >= 0.6, `clear of ${b.id}`);
  // never across the counter from the agent (the reviewer's 'behind the Help Desk' shot): a knee-high line is free
  const { worldBlocked, followWorld } = await import('../player/follow.ts');
  const W = followWorld(layout);
  for (const b of actors) {
    const t = pickStand({ a: b, others: actors, layout, nav, eyeH: 1.2 });
    assert.ok(t, `${b.id}: a spot`);
    assert.equal(worldBlocked(W, 0, t.x, 0.5, t.z, b.pos.x, 0.5, b.pos.z, 0.6), null, `${b.id}: no counter between (${t.x.toFixed(2)}, ${t.z.toFixed(2)})`);
    assert.equal(worldBlocked(W, 0, t.x, t.y + 1.2, t.z, b.pos.x, b.pos.y + 0.85, b.pos.z, 0.45), null, `${b.id}: face in sight`);
  }
  // facing the agent
  const want = Math.atan2(-(a.pos.x - s.x), -(a.pos.z - s.z));
  assert.ok(Math.abs(Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw))) < 0.2, 'faces the agent');
  // glide along the route: every sample stays walkable-ish (off solid geometry), duration 400–900 ms
  const route = nav.route({ x: from.x, z: from.z, level: 0 }, { x: s.x, z: s.z, level: 0 }, { owner: '*' });
  assert.ok(route, 'route');
  const g = glidePath(route.points, [from.x, 0, from.z, 0, 0], [s.x, s.y, s.z, s.yaw, s.pitch], (x, z, l) => layout.floorY(x, z, l));
  assert.ok(g.ms >= 400 && g.ms <= 900);
  let bad = 0;
  for (let t = 0; t <= 1.0001; t += 0.02) { const p = g.at(t); if (!nav.walkable(p[0], p[2], 0, { owner: '*' })) bad++; }
  assert.equal(bad, 0, 'the glide never cuts through walls / furniture');
  const end = g.at(1);
  assert.ok(Math.hypot(end[0] - s.x, end[2] - s.z) < 1e-6 && Math.abs(end[3] - s.yaw) < 1e-6, 'ends exactly on the stand pose');
});

test('m2-r3 names: a twin carries the same label on every surface (roster rows, palette, map, deep link, inbox)', async () => {
  const { createNames } = await import('./names.ts');
  const { rankPalette } = await import('./paletteRank.ts');
  const { resolveDeepLink, normLabel } = await import('./deeplink.ts');
  const fs = await import('node:fs');
  const ents = [
    ent({ id: 'p1', name: 'claude', kind: 'claude', status: 'blocked', statusSince: 1, workspace: { label: 'infra' }, tab: { label: 'claude' } }),
    ent({ id: 'p2', name: 'flint', kind: 'claude', status: 'working', statusSince: 2, workspace: { label: 'hq-core' }, tab: { label: 'claude' } }),
    ent({ id: 'p9', name: 'claude', kind: 'claude', status: 'idle', statusSince: 3, workspace: { label: 'infra' }, tab: { label: 'claude' } }),
    ent({ id: 's1', name: 'dev', kind: 'shell', status: 'idle', statusSince: 4, workspace: { label: 'tinker' }, tab: { label: 'dev' } }),
    ent({ id: 's2', name: 'dev', kind: 'shell', status: 'idle', statusSince: 5, workspace: { label: 'tinker' }, tab: { label: 'dev' } }),
  ];
  const n = createNames({ entities: new Map(ents.map((e) => [e.id, e])) });
  const label = (e: Entity) => n.label(e);
  assert.equal(label(ents[2]), 'claude · 2');
  assert.equal(label(ents[4]), 'dev · 2');
  // roster row (visible name + aria-label) — view.ts renders label(e) into .nm/.rn and passes it to rowAriaLabel
  assert.ok(rowAriaLabel(ents[2], 10, label(ents[2])).startsWith('claude · 2, idle'));
  // palette: the twin's label ranks it first, with or without the spaces around '·'
  for (const q of ['claude · 2', 'claude·2']) {
    const r = rankPalette(q, ents, [], { label });
    assert.equal(hitAgent(r[0]), 'p9', `palette '${q}'`);
  }
  // deep link: the label (any spacing around '·') resolves the twin; the bare name is ambiguous → exact-name filter
  for (const q of ['claude · 2', 'claude·2', 'claude ·2', 'Claude· 2', 'dev · 2']) {
    const want = q.startsWith('dev') ? 's2' : 'p9';
    assert.deepEqual(resolveDeepLink(q, ents), { kind: 'agent', id: want }, `?open=${q}`);
  }
  assert.equal(normLabel(' claude·2 '), 'claude · 2');
  const amb = resolveDeepLink('claude', ents);
  assert.ok(amb.kind === 'ambiguous');
  assert.deepEqual([amb.name, amb.exact, amb.ids.sort()], ['claude', true, ['p1', 'p9']]);
  // … and the roster's `name:` token keeps exactly the namesakes (not every claude-kind agent: flint)
  const q = parseQuery(`name:${amb.name}`);
  assert.deepEqual(ents.filter((e) => matchEntity(e, q)).map((e) => e.id), ['p1', 'p9']);
  // every surface module routes the display name through the shared label (no bare e.name in rendered text)
  const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const bare = /(setText\([^)]*,\s*[a-z0-9]+\.name\b|\$\{[a-z0-9]+\.name\}|\[[a-z0-9]+\.name\])/;
  for (const f of ['./roster/view.ts', './cmdk.ts', './minimap.ts', './statusCard.ts', './inbox.ts', './chevrons.ts', './notify.ts']) {
    const hit = src(f).split('\n').find((l) => bare.test(l) && !/\/\/.*name/.test(l.split(bare)[0]));
    assert.equal(hit, undefined, `${f} renders a bare name: ${hit?.trim()}`);
  }
  for (const [f, re] of [['./roster/view.ts', /label\(e\)/], ['./cmdk.ts', /d\.label\(e\)/], ['./minimap.ts', /nameOf\(e\)/], ['./statusCard.ts', /d\.label\(e\)/]] satisfies [string, RegExp][]) {
    assert.match(src(f), re, `${f} uses the shared label`);
  }
});

test('m2-r3 go there: minimum stand distance, walker destination, rope/stanchion foreground clutter', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { createNav } = await import('../world/nav/index.ts');
  const { pickStand, GOTO, destOf, ropeClutter, ropeSegs, polyDist } = await import('./goto.ts');
  const nav = createNav(layout);
  assert.ok(GOTO.minDist >= 1.6 && Math.min(...GOTO.dists) >= GOTO.minDist, 'no candidate closer than the minimum');
  // every desk worker and every queue place: the stand point is ≥ 1.6 m off (0.8 m behind a back was the bug)
  const slots = layout.slots.filter((s) => /^slot:(desk|queue)/.test(s.id));
  const actors = slots.map((s, i) => ({ id: `a${i}`, pos: { x: s.pos.x, y: layout.floorY(s.pos.x, s.pos.z, s.level ?? 0), z: s.pos.z }, yaw: s.yaw ?? 0 }));
  let n = 0, back = 0;
  for (const a of actors) {
    const s = pickStand({ a, others: [], layout, nav, eyeH: 1.2 });
    if (!s) continue;
    n++;
    const d = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
    assert.ok(d >= GOTO.minDist - 1e-6, `${a.id} stands ${d.toFixed(2)} m off`);
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    if (((s.x - a.pos.x) * fx + (s.z - a.pos.z) * fz) / d < -0.85) back++;
  }
  assert.ok(n > 20, `spots found (${n})`);
  assert.ok(back / n < 0.35, `mostly side / 3/4 views, not the back of the head (${back}/${n} straight behind)`);
  // a walker is framed at its destination slot, and the stand point keeps off the rest of its walk
  const desk = layout.slots.find((s) => /^slot:desk/.test(s.id));
  assert.ok(desk);
  const walker = { id: 'w', pos: { x: desk.pos.x + 6, y: 0, z: desk.pos.z }, yaw: 0, arrived: false, intent: { slot: desk },
    path: [{ x: desk.pos.x + 6, z: desk.pos.z }, { x: desk.pos.x + 3, z: desk.pos.z }, { x: desk.pos.x, z: desk.pos.z }], pathI: 1 };
  const t = destOf(walker);
  assert.ok('dest' in t);
  assert.equal(t.dest, desk.id);
  assert.deepEqual([t.pos.x, t.pos.z], [desk.pos.x, desk.pos.z]);
  assert.ok(t.route.length >= 2, 'the remaining walk');
  assert.ok(!('dest' in destOf({ ...walker, arrived: true })), 'settled → the actor itself');
  const s = pickStand({ a: t, others: [], layout, nav, eyeH: 1.2, avoid: t.route });
  assert.ok(s && polyDist(t.route, s.x, s.z) >= GOTO.pathClear - 1e-6, 'not standing in the walker\'s way');
  // rope clutter: a spot right behind a rope run looking across it scores clutter; one looking away scores none
  const R = ropeSegs(layout);
  assert.ok(R);
  assert.ok(R.segs.length >= 5 && R.posts.length >= 8, 'queue ropes + stanchions');
  const [x0, z0, x1, z1] = R.segs[0];
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, nx = -(z1 - z0), nz = x1 - x0, L = Math.hypot(nx, nz);
  const lens = { x: mx + (nx / L) * 0.4, z: mz + (nz / L) * 0.4 };
  const subj = { pos: { x: mx - (nx / L) * 2, z: mz - (nz / L) * 2 } };
  const yawAt = Math.atan2(-(subj.pos.x - lens.x), -(subj.pos.z - lens.z));
  assert.ok(ropeClutter(R, { ...lens, yaw: yawAt }, subj) > 3, 'rope at the lens');
  assert.equal(ropeClutter(R, { ...lens, yaw: yawAt + Math.PI }, { pos: { x: lens.x + (nx / L) * 2, z: lens.z + (nz / L) * 2 } }), 0, 'looking away');
  // queue members: the chosen spot keeps the rope out of the lens' foreground
  const q = layout.slots.filter((x) => x.tag === 'queue').slice(0, 4).map((x, i) => ({ id: `q${i}`, pos: { x: x.pos.x, y: layout.floorY(x.pos.x, x.pos.z, 0), z: x.pos.z }, yaw: x.yaw }));
  for (const a of q) {
    const log: string[] = [];
    const sp = pickStand({ a, others: q, layout, nav, eyeH: 1.2, log });
    assert.ok(sp, `${a.id}: a spot`);
    assert.ok(ropeClutter(R, sp, a) < 3, `${a.id}: rope clutter ${ropeClutter(R, sp, a).toFixed(1)}`);
  }
});

test('m2-r3 status card: no G high-five hint on a blocked agent; the palette keeps a disabled sign-off row', async () => {
  const fs = await import('node:fs');
  const card = fs.readFileSync(new URL('./statusCard.ts', import.meta.url), 'utf8');
  assert.match(card, /blocked \? hint\('G', 'go to ticket'\)/, 'blocked → G goes to its ticket, never a high-five (M3.5)');
  assert.match(card, /hint\('B', 'answer'\)/);
  const { rankPalette } = await import('./paletteRank.ts');
  const acts = [{ id: 'settings', label: 'Settings' }, { id: 'signoff', label: 'Sign off all — nobody is done', disabled: true }];
  assert.equal(hitAction(rankPalette('sign', [], acts)[0]), 'signoff');
});

test('M3.5 walk-up: minimum stand distance, face cone, desk screen, moving target, budgeted searches', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { createNav } = await import('../world/nav/index.ts');
  const { pickStand, standBegin, standStep, GOTO, WALKUP, destOf, monitorOf, segHitsMonitor } = await import('./goto.ts');
  const nav = createNav(layout);
  const bearingCos = (a: { pos: { x: number; z: number } }, s: { x: number; z: number }, yaw: number) => { const d = Math.hypot(s.x - a.pos.x, s.z - a.pos.z); return ((s.x - a.pos.x) * -Math.sin(yaw) + (s.z - a.pos.z) * -Math.cos(yaw)) / d; };
  // (1) minimum distance: every desk worker and queue place is framed from ≥ 1.6 m (desks ≤ 2.4 m)
  const slots = layout.slots.filter((s) => /^slot:(desk|queue)/.test(s.id));
  let n = 0;
  for (const sl of slots) {
    const a = { id: sl.id, pos: { x: sl.pos.x, y: layout.floorY(sl.pos.x, sl.pos.z, sl.level ?? 0), z: sl.pos.z }, yaw: sl.yaw ?? 0, intent: { slot: sl }, arrived: true };
    const s = pickStand({ a, others: [], layout, nav, eyeH: 1.2, faceYaw: sl.yaw });
    if (!s) continue;
    n++;
    const d = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
    // [UI fix r1] a desk walk-up may come to WALKUP.deskMin (the face + screen only read from beside the desk)
    const minD = /desk/.test(sl.id) ? WALKUP.deskMin : GOTO.minDist;
    assert.ok(d >= minD - 1e-6, `${sl.id}: ${d.toFixed(2)} m ≥ ${minD}`);
    if (/desk/.test(sl.id)) assert.ok(d <= 2.4 + 1e-6, `${sl.id}: ${d.toFixed(2)} m ≤ 2.4`);
  }
  assert.ok(n > 30, `spots (${n})`);
  // (2) yaw vs facing: an agent standing in the open is framed from within 60° of where its face looks
  const open = [{ x: 0, z: 0 }, { x: 2, z: 3 }, { x: -2, z: -2 }].filter((p) => nav.walkable(p.x, p.z, 0, { owner: '*' }) && !nav.collides(p.x, p.z, 0.6, 0));
  assert.ok(open.length, 'an open floor point');
  for (const p of open) {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const a = { id: 'o', pos: { x: p.x, y: 0, z: p.z }, yaw };
      const s = pickStand({ a, others: [], layout, nav, eyeH: 1.2, faceYaw: yaw });
      if (!s) continue;
      assert.ok(bearingCos(a, s, yaw) >= Math.cos((WALKUP.faceMaxDeg * Math.PI) / 180) - 1e-6, `(${p.x},${p.z}) yaw ${yaw.toFixed(2)}: within 60° (cf ${s.cf})`);
    }
  }
  // desk worker in a FULL office (every desk seated: the neighbours are the hard part, reviewers m3-r1): never the back
  // of its head (slot facing ≥ cfFloor), the face never behind its monitor panel; [UI fix r2, reviewer art] tier 0 is a
  // SCREEN-SPACE claim (both eyes in frame, facing the lens at ≥ eyeGoodDot, unhidden + a readable screen), the lens
  // never pitches below pitchMin, never frames tighter than a 60° lens at frameDist, and a both-eyes face view wins
  // below tier 0 (in a pod the face + readable screen band is walled in: the face is what a walk-up must show)
  const deskSlots = layout.slots.filter((x) => /^slot:desk:[EW]/.test(x.id));
  const seated = deskSlots.map((x) => ({ id: x.id, pos: { x: x.pos.x, y: 0, z: x.pos.z }, yaw: x.yaw, intent: { slot: x }, arrived: true }));
  let faces = 0, desks = 0;
  const tanB = Math.tan((WALKUP.fovBase * Math.PI) / 360);
  for (const a of seated) {
    const sl = a.intent.slot;
    const M = monitorOf(layout, sl);
    assert.ok(M, `${sl.id}: monitor`);
    const job = standBegin({ a, others: seated, layout, nav, eyeH: 1.2, faceYaw: sl.yaw });
    standStep(job);
    const s = job.result;
    if (!s) continue;
    desks++;
    const d = Math.hypot(s.x - a.pos.x, s.z - a.pos.z);
    assert.ok(s.pitch >= WALKUP.pitchMin - 1e-9, `${sl.id}: pitch ${s.pitch} ≥ ${WALKUP.pitchMin}`);
    const framed = d * Math.tan(((s.fov ?? NaN) * Math.PI) / 360) / tanB; // what a 60° lens would need to show as much
    assert.ok(framed >= WALKUP.frameDist - 0.02 || (s.fov ?? NaN) >= WALKUP.fovMax - 1e-6, `${sl.id}: framed like ${framed.toFixed(2)} m (d ${d.toFixed(2)}, fov ${s.fov})`);
    const tier = s.tier ?? NaN, faceSide = (c: { s: { tier?: number } }) => c.s.tier !== undefined && c.s.tier <= 1;
    assert.ok(tier <= 1 || !job.scored.some(faceSide), `${sl.id}: a face-side spot exists but tier ${s.tier} won`);
    if (tier <= 1) {
      assert.ok((s.eyes ?? NaN) >= 1 && (s.cf ?? NaN) >= WALKUP.cfFloor - 1e-6, `${sl.id}: eyes ${s.eyes}, facing ${s.cf}`);
      assert.ok((s.cover ?? NaN) <= WALKUP.maxCover, `${sl.id}: a neighbour fills ${s.cover} of the frame`);
    }
    if (job.scored.some((c) => c.s.tier === 0)) assert.equal(s.tier, 0, `${sl.id}: a face + screen spot exists`);
    if (s.tier === 0) assert.ok(s.eyesGood === 2 && (s.mon ?? NaN) >= WALKUP.monReadDot && s.monHidden === 0, `${sl.id}: tier 0 = both eyes ${s.eyesGood} + screen ${s.mon}`);
    if (job.scored.some((c) => faceSide(c) && c.s.eyesGood === 2)) assert.equal(s.eyesGood, 2, `${sl.id}: a both-eyes face view exists but a profile won`);
    if (s.eyesGood === 2) faces++;
    assert.ok(!segHitsMonitor(M, s.x, 1.2, s.z, a.pos.x, WALKUP.seatedFaceY, a.pos.z), `${sl.id}: face behind its monitor`);
  }
  assert.ok(desks >= 30 && faces >= 24, `desks framed with both eyes: ${faces}/${desks}`);
  // (3) moving target: a blocked agent walking to its queue place is framed there, not where it is now
  const qs = layout.slots.find((x) => x.tag === 'queue');
  assert.ok(qs);
  const walker = { id: 'w', pos: { x: qs.pos.x + 7, y: 0, z: qs.pos.z }, yaw: 0, arrived: false, intent: { slot: qs }, path: [{ x: qs.pos.x + 7, z: qs.pos.z }, { x: qs.pos.x, z: qs.pos.z }], pathI: 1 };
  const t = destOf(walker);
  assert.ok('dest' in t);
  const s = pickStand({ a: t, others: [], layout, nav, eyeH: 1.2, faceYaw: t.yaw, avoid: t.route });
  assert.ok(s, 'a spot at the destination');
  const dq = Math.hypot(s.x - qs.pos.x, s.z - qs.pos.z);
  assert.ok(dq >= 1.6 - 1e-6 && dq <= 3.7, `framed at the queue slot (${dq.toFixed(2)} m)`);
  assert.ok(Math.hypot(s.x - walker.pos.x, s.z - walker.pos.z) > 3, 'not at the walker');
  // (4) budget: ≤ 2 nav.route searches per step, and the route found is kept for the glide
  let routes = 0;
  const spy = { ...nav, route: (...args: Parameters<Nav['route']>) => { routes++; return nav.route(...args); }, walkable: nav.walkable, collides: nav.collides };
  const job = standBegin({ a: t, others: [], layout, nav: spy, eyeH: 1.2, faceYaw: t.yaw, from: { x: 0, z: 0, level: 0 } });
  assert.equal(routes, 0, 'scoring does no path search');
  let steps = 0;
  while (!standStep(job, WALKUP.routesPerFrame)) { steps++; assert.ok(routes <= 2 * (steps + 1)); }
  assert.ok(routes <= 2 * (steps + 1), `≤ 2 searches per frame (${routes} in ${steps + 1})`);
  assert.ok((job.result?.route?.points.length ?? 0) >= 2, 'the glide reuses the found route');
  // (5) a scorer exception is logged + counted, not silently 'no spot'
  const { standErrors } = await import('./goto.ts');
  const before = standErrors.n;
  const bad = { id: 'x', pos: { x: 0, y: 0, z: 0 }, yaw: 0 };
  const warn = console.warn; console.warn = () => {};
  try { pickStand({ a: bad, others: [{ id: 'y', get pos(): { x: number; z: number } { throw new Error('boom'); } }], layout, nav, eyeH: 1.2 }); } finally { console.warn = warn; }
  assert.ok(standErrors.n > before, 'scorer error counted');
});

// [LVL m3 fix r2, cross-owner UI] art review m3-r2 pat-b0: go-there on the queue head chose the staff side (across the
// counter: the top filled the lower 40 %, the face cut at the mouth) whenever walkers stood on the corridor spots
test('LVL m3 r2 go there: a Help Desk queue member is framed from the queue side, never across the counter', async () => {
  const { layout } = await import('../world/layout/hq.ts');
  const { createNav } = await import('../world/nav/index.ts');
  const { pickStand } = await import('./goto.ts');
  const nav = createNav(layout);
  const counter = layout.furniture.find((f) => f.id === 'counter0');
  assert.ok(counter);
  const [w, , d] = counter.size;
  const staffSide = (s: { x: number; z: number }) => s.z > counter.pos.z && Math.abs(s.x - counter.pos.x) < w / 2 + 0.3; // lobby side of the counter, within its span
  const qa = layout.slots.filter((x) => x.tag === 'queue').map((x, i) => ({ id: `q${i}`, pos: { x: x.pos.x, y: layout.floorY(x.pos.x, x.pos.z, 0), z: x.pos.z }, yaw: x.yaw, intent: { slot: x }, arrived: true }));
  const corridor = [[-0.9, 7.2], [-1.3, 6.5], [-0.9, 5.8]].map(([x, z], i) => ({ id: `x${i}`, pos: { x, y: 0, z } }));
  let n = 0;
  for (const k of [1, 3, 6]) for (let b = 0; b <= 3; b++) for (const from of [{ x: 0, z: 12.5 }, { x: -4, z: 2 }]) {
    const s = pickStand({ a: qa[0], others: [...qa.slice(0, k), ...corridor.slice(0, b)], layout, nav, eyeH: 1.2, faceYaw: qa[0].yaw, from: { ...from, level: 0 } });
    assert.ok(s, `a spot (queue ${k}, ${b} corridor walkers)`);
    assert.ok(!staffSide(s), `queue ${k}, ${b} corridor walkers: ${s.x.toFixed(2)},${s.z.toFixed(2)} is across the counter (d ${d})`);
    n++;
  }
  assert.equal(n, 24);
});

test('palette: action hints split into keycaps + a plain aside (no grey "· Tab" text)', async () => {
  const { splitKeyHint } = await import('./paletteRank.ts');
  assert.deepEqual(splitKeyHint('Tab'), { keys: ['Tab'], rest: '' });
  assert.deepEqual(splitKeyHint('Shift+B · 3 blocked, one key each'), { keys: ['Shift+B'], rest: '3 blocked, one key each' });
  assert.deepEqual(splitKeyHint('Leader U'), { keys: ['Leader', 'U'], rest: '' });
  assert.deepEqual(splitKeyHint('Leader Shift+X'), { keys: ['Leader', 'Shift+X'], rest: '' });
  assert.deepEqual(splitKeyHint('H / F1'), { keys: ['H', '/', 'F1'], rest: '' });
  assert.deepEqual(splitKeyHint('Alt+C in roster'), { keys: ['Alt+C'], rest: 'in roster' });
  assert.deepEqual(splitKeyHint('a new shell tab in herdr'), { keys: null, rest: 'a new shell tab in herdr' });
  assert.deepEqual(splitKeyHint('HQ-local; herdr keeps its done'), { keys: null, rest: 'HQ-local; herdr keeps its done' });
  assert.deepEqual(splitKeyHint(undefined), { keys: null, rest: '' });
});
