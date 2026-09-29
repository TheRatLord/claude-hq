/**
 * Ambient office life (P3, §6.4.1, §6.9, §7.4, §11 M3 AMB): Ada the receptionist, Segfault the cat, Dusty the roomba,
 * the lobby fish tank, atrium ceiling fans ∝ load, coffee steam and Bean, the Café's flying espresso-bot barista. Everything here is visibly ambient: no nameplate,
 * no status ring, never an entity (P6). Characters draw inside charBatch (no extra draws); fans / fish add ≤ 5 draws.
 *
 * Wiring (main.ts, §8.1 step 3½): `createAmbient(deps)` after actors/fx/player/ui exist; `ambient.update(ctx)` after
 * `actors.update` and before `charBatch.write` (the rigs are written in the same frame).
 * Bus topics emitted (for AUD): 'amb.cat' {ev:'purr'|'meow'|'land'|'startle', pos} · 'amb.ada' {ev:'greet'} ·
 * 'amb.roomba' {ev:'bump'|'crumbs', who} · 'amb.steam' {ev:'pssht', pos} · 'amb.bean' {ev:'pssht'|'ding'|'serve'|'hello', pos}. Listens: 'answered', 'away.recap', 'stats.hotSpot'.
 * main.ts puts it on `ctx.ambient`: `__hq.ctx.ambient.debug()` → state; `.debug('cat', 'rack')` / ('ada', 'offline') …
 * forces a behaviour for shots; `__hq.stats().ambient` has the per-frame cost.
 * Owner: AMB.
 */
import { hqStatSection } from '../../core/debug.ts';
import { rng } from './util.ts';
import type * as THREE from 'three';
import type { HqLayout, Layout } from '../layout/schema.ts';
import type { AmbDeps, AmbFrame, AmbPart } from './util.ts';
import { createAda } from './ada.ts';
import { createCat } from './cat.ts';
import { createRoomba } from './roomba.ts';
import { createFish } from './fish.ts';
import { createFans } from './fans.ts';
import { createSteam } from './steam.ts';
import { createBarista } from './barista.ts';
import { registeredStats } from '../stats/registry.ts';

/** What main.ts hands over: the boot deps plus the shared ctx the cast reads (scene, store, bus, camera, params). */
export interface AmbientDeps extends Pick<AmbDeps, 'nav' | 'charBatch' | 'fx' | 'actors' | 'player' | 'ui'> {
  /** the proto room or the hq office; the cast only exists in hq */
  layout: Layout;
  ctx: Pick<AmbDeps, 'scene' | 'store' | 'bus'> & { camera: THREE.Camera; params?: { seed?: string | null } | null };
}

const isHqLayout = (l: Layout): l is HqLayout => l.id === 'hq';

export function createAmbient(deps: AmbientDeps) {
  const { ctx, layout, ...rest } = deps;
  const parts: Record<string, AmbPart> = {};
  const tryMake = (name: string, fn: () => AmbPart | null) => {
    try { const p = fn(); if (p) parts[name] = p; } catch (e) { console.error(`[ambient] ${name} failed`, e); }
  };
  if (isHqLayout(layout)) {
    const d: AmbDeps = {
      ...rest, layout, scene: ctx.scene, store: ctx.store, bus: ctx.bus,
      rand: rng(0x5e6fa417 ^ (Number(ctx.params?.seed) || 0)),
      peers: parts, // [AMB fix m2 r2] the cast reads each other (Bean serves Ada, treats the begging cat)
    };
    tryMake('ada', () => createAda(d));
    tryMake('cat', () => createCat(d));
    tryMake('roomba', () => createRoomba(d));
    tryMake('fish', () => createFish(d));
    // STAT owns the 'fans' stat anchor (world/stats/weather.ts); ours only stand in while no factory is registered
    if (!registeredStats().includes('fans')) tryMake('fans', () => createFans(d));
    tryMake('steam', () => createSteam(d));
    tryMake('barista', () => createBarista(d));
  }
  let ms = 0;
  /** per-part EMA cost (ms) */
  const partMs: Record<string, number> = {};
  const list = Object.entries(parts);
  /** [AMB fix m2 r2] seconds each moving cast member spent per zone (review: "Ada, the cat, the roomba never enter CAF") */
  const zoneS: Record<string, Record<string, number>> = {};
  const tallyZones = (dt: number) => {
    for (const k of ['ada', 'cat', 'roomba', 'barista']) {
      const p = parts[k]?.pos;
      if (!p) continue;
      const z = layout.zoneAt?.(p.x, p.z, 0) ?? 'OUT';
      const m = (zoneS[k] ??= {});
      m[z] = (m[z] ?? 0) + dt;
    }
  };
  const zoneSummary = () => Object.fromEntries(Object.entries(zoneS).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([z, v]) => [z, Math.round(v)]))]));

  hqStatSection('ambient', () => ({ ms: +ms.toFixed(3), zoneS: zoneSummary(), partMs: Object.fromEntries(Object.entries(partMs).map(([k, v]) => [k, +v.toFixed(3)])), ...Object.fromEntries(list.map(([k, p]) => [k, p.debug?.() ?? true])) }));
  return {
    parts,
    /** debug / shots: no args → state; (who, what, ...args) → force a behaviour or 'teleport' */
    debug(who?: string, what?: string, ...rest: number[]) {
      if (!who) return { ...Object.fromEntries(list.map(([k, p]) => [k, p.debug?.() ?? true])), zoneS: zoneSummary() };
      const p = parts[who];
      if (!p) return null;
      if (what === 'teleport') return p.teleport?.(...rest) ?? null;
      return p.force?.(what, ...rest) ?? null;
    },
    /** @param c frame ctx */
    update(c: AmbFrame) {
      if (c.hidden) return;
      const t0 = performance.now();
      for (let i = 0; i < list.length; i++) {
        const [k, p] = list[i];
        const t1 = performance.now();
        try { p.update(c, ctx.camera); } catch (e) { console.error(`[ambient] ${k}.update`, e); list.splice(i--, 1); continue; }
        partMs[k] = (partMs[k] ?? 0) + (performance.now() - t1 - (partMs[k] ?? 0)) * 0.05;
      }
      tallyZones(Math.min(c.dt ?? 0, 0.1));
      ms += (performance.now() - t0 - ms) * 0.05;
    },
    /** Ambient NPC positions (BRN may read the cat for the `cat` chill pick; §11.5 proposal). */
    catPos: () => parts.cat?.pos ?? null,
    adaPos: () => parts.ada?.pos ?? null,
    baristaPos: () => parts.barista?.pos ?? null,
    zoneSeconds: zoneSummary,
    dispose() { for (const [, p] of list) p.dispose?.(); },
  };
}
