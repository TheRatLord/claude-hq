// @pure
/**
 * Test fixtures for BRN tests (not shipped in any runtime path): a D7-shaped proto room (12 desks in 3 pods of 4,
 * a 3-seat sofa, a 3-spot help queue, a window) and entity factories. Owner: BRN.
 */
import type { Entity } from '../../../../shared/protocol.ts';
import type { Furniture, Layout, Slot } from '../../world/layout/schema.ts';
import type { Nav, NavPoint } from '../../world/nav/index.ts';
import type { Store, StoreEvents } from '../../net/store.ts';
import type { Rig } from '../rig/clawd.ts';
import { fake } from '../../core/testDoubles.ts';

export function testLayout({ pods = true }: { pods?: boolean } = {}): Layout {
  const furniture: Furniture[] = [], slots: Slot[] = [];
  let n = 0;
  for (let p = 0; p < 3; p++) {
    const px = -3.8 + p * 3.8;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const x = px + (col - 0.5) * 1.2;
        const deskZ = row === 0 ? -0.8 : -0.2; // two rows of desks face each other; chairs on the outside
        furniture.push({ id: `desk${n}`, type: 'desk', pos: { x, y: 0, z: deskZ }, yaw: 0, size: [1.1, 0.55, 0.6], solid: true });
        const s: Slot = { id: `slot:desk:${n}`, tag: 'desk', pos: { x, y: 0, z: row === 0 ? -1.55 : 0.55 }, yaw: row === 0 ? Math.PI : 0, pose: 'sit', level: 0, anchor: `desk${n}` };
        if (pods) s.pod = p;
        slots.push(s);
        n++;
      }
    }
  }
  furniture.push({ id: 'sofa0', type: 'sofa', pos: { x: 4, y: 0, z: 3.7 }, yaw: 0, size: [2.4, 0.8, 0.8], solid: true });
  for (let i = 0; i < 3; i++) slots.push({ id: `slot:sofa:${i}`, tag: 'sofa', pos: { x: 3.2 + i * 0.8, y: 0, z: 3.1 }, yaw: 0, pose: 'sit', level: 0, anchor: 'sofa0' });
  furniture.push({ id: 'counter0', type: 'counter', pos: { x: -5.2, y: 0, z: 3 }, yaw: Math.PI / 2, size: [1.6, 1.05, 0.6], solid: true });
  for (let i = 0; i < 3; i++) slots.push({ id: `slot:queue:${i}`, tag: 'queue', pos: { x: -4.4 + i * 0.8, y: 0, z: 3 }, yaw: Math.PI / 2, pose: 'stand', level: 0, anchor: 'counter0' });
  const b = { minX: -6, maxX: 6, minZ: -4.5, maxZ: 4.5 };
  return {
    id: 'test', bounds: b, height: 3, furniture, slots,
    walls: [{ a: [b.minX, b.minZ], b: [b.maxX, b.minZ], h: 3, openings: [{ at: 4, w: 4, h: 1.5, sill: 0.9, kind: 'window' }] }],
    zones: [], visCells: [], anchors: [], spawn: [0, 0, 4, 0, 0], floorY: () => 0, zoneAt: () => 'test',
  };
}

/**
 * Minimal nav (reservation-free straight line). The proto director reads only these six members; the rest of the `Nav`
 * facade (grids, the A* budget) is absent, so the one cast is the test-double boundary.
 */
export function testNav(): Nav {
  const stub: Pick<Nav, 'path' | 'walkable' | 'reserve' | 'release' | 'releaseAll' | 'holder'> = {
    path: (a: NavPoint, b: NavPoint) => [a, b], walkable: () => true, reserve: () => null, release() {}, releaseAll() {}, holder: () => null,
  };
  return stub as Nav;
}

/** A renderer store double (§3.4 semantics are the caller's): the entity map, `on`, and `emit` to drive the listeners. */
export interface FakeStore extends Pick<Store, 'entities' | 'on'> {
  emit<K extends keyof StoreEvents>(evt: K, m: StoreEvents[K]): void;
}
export function fakeStore(entities: Iterable<Entity> = []): FakeStore {
  // listeners are stored as (payload: never) => void: any typed listener fits; `emit` is the one place the payload
  // type is re-attached (a listener for topic K only ever receives topic K's payload)
  const listeners = new Map<string, Set<(m: never) => void>>();
  return {
    entities: new Map([...entities].map((e) => [e.id, e])),
    on(evt, fn) {
      let set = listeners.get(evt);
      if (!set) listeners.set(evt, (set = new Set()));
      set.add(fn);
      return () => true;
    },
    emit(evt, m) { for (const fn of listeners.get(evt) ?? []) (fn as (m: StoreEvents[typeof evt]) => void)(m); },
  };
}

let seq = 0;
/** Every field optional, all the way down (arrays elementwise). */
type Deep<T> = T extends readonly (infer U)[] ? Deep<U>[] : T extends object ? { [K in keyof T]?: Deep<T[K]> } : T;
/**
 * A test entity: `i` numbers it; the fields a test sets override the defaults, the rest of the full `Entity` is absent
 * (the brains under test read only the fields set here), so the one cast (partial → Entity) is the fixture boundary.
 */
export function ent(o: Deep<Entity> & { i?: number } = {}): Entity {
  const i = o.i ?? seq++;
  const partial: Deep<Entity> = {
    id: `d1:p${i}`, kind: 'claude', name: `a${i}`, seedKey: `a${i}`, status: 'idle', statusSince: 0, statusSinceApprox: false,
    workspace: { id: 'w0', label: 'w', slot: 0, colorIndex: 0, cycle: 0 }, tab: { id: 't', label: 'claude', index: 0 }, paneIndex: 0,
    activity: null, ack: null, prompt: null, process: null, title: null, lastPrompt: null, project: 'p',
    ...o,
  };
  return partial as Entity;
}

/** `v`, failing the test when it is null / undefined (what a bare dereference used to do, with a message). */
export function must<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`fixture: expected ${what}, got ${String(v)}`);
  return v;
}

/**
 * A stub rig for the actors' tests and the headless sim: actors touch only `root` (position / rotation) and pass the rig
 * on to the (stub) animator and charBatch, so the stand-in goes through `fake` (the shared test-double boundary) rather than a
 * double cast.
 */
export function stubRig(): Rig {
  const root = { position: { set() {}, x: 0, y: 0, z: 0 }, rotation: { y: 0 } };
  return fake<Rig>({ root, nodes: {}, parts: [] });
}
