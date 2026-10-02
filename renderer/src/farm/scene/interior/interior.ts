/**
 * Walk-in rooms (system 'interior', service 'indoors'): the farmhouse (house.ts) and the barn (barn.ts), each a
 * `RoomDef` (space.ts) registered in ROOMS below.
 *
 * E on a door → a short fade → you stand inside; E on the inside door → back out in front of it. A room is built in
 * place, inside its structure's shell (in the structure's own frame), lazily on the first visit, and only exists in the
 * scene while you are in it: outside it costs nothing but this system's idle check.
 *
 * What every room shares (here):
 *  - the controller walks the room's floors and solids (IndoorSpace.floor / resolve, multi-level: the barn's loft) and
 *    the engine offers only the room's interactables (`owns`: ids 'interior:*'), so nothing outside is in reach
 *    through the walls;
 *  - the outdoor scene is hidden (every top-level scene object without lights in it, re-checked each frame) so the
 *    room renders in a few dozen draw calls; outdoor systems keep running (state, sounds, events). An outdoor object
 *    flagged `userData.indoors` comes in with you (your pet: scene/life/companion.ts, placed at `petSpot`);
 *  - the room's lights are registered while inside, the sky dims its open-air fill (sky.ts reads the service), the
 *    audio muffles the valley and drums rain on the roof (`AudioService.indoors(k, { roof })`).
 */
import * as THREE from 'three';
import type { AudioService, IndoorSpace, LightsService, SceneCtx, SystemFactory } from '../context.ts';
import type { Season } from '../../model/types.ts';
import { structure } from '../../world/map.ts';
import type { StructureId } from '../../world/map.ts';
import { frameOf } from './space.ts';
import type { Frame, RoomBuilt, RoomDef, RoomHost } from './space.ts';
import { houseRoom } from './house.ts';
import { barnRoom } from './barn.ts';

interface Controllerish { teleport(x: number, z: number, yaw?: number, pitch?: number): void }

/** every walk-in room; the first is the default for `enter()` and bare view names */
export const ROOMS: readonly RoomDef[] = [houseRoom, barnRoom];

const FADE_OUT = 0.32, FADE_IN = 0.45;

interface Slot {
  def: RoomDef;
  frame: Frame;
  host: RoomHost;
  holder: THREE.Group;
  built: RoomBuilt | null;
  season: Season | null;
}

export const interiorSystem: SystemFactory = (ctx: SceneCtx) => {
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const lights = () => ctx.services.get('lights') as LightsService | undefined;
  const controller = () => ctx.services.get('controller') as Controllerish | undefined;

  // ---- the fade (a black card in front of the camera; scene code never touches the DOM)
  const fadeMat = new THREE.MeshBasicMaterial({ color: 0x050302, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
  const fadeCard = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), fadeMat);
  fadeCard.name = 'interior:fade';
  fadeCard.renderOrder = 1e6;
  fadeCard.frustumCulled = false;
  let fade = 0, fadeTo = 0, hold = 0, onBlack: (() => void) | null = null, lastReal = performance.now();
  const fadeThen = (fn: () => void, holdS = 0) => { if (onBlack) return; fadeTo = 1; hold = holdS; onBlack = fn; };

  // ---- state
  let cur: Slot | null = null;
  let since = 0;
  const offs: (() => void)[] = [];
  const hidden = new Set<THREE.Object3D>();
  const lit = new WeakMap<THREE.Object3D, boolean>();
  const hasLight = (o: THREE.Object3D): boolean => {
    let v = lit.get(o);
    if (v === undefined) { v = false; o.traverse((c) => { if ((c as THREE.Light).isLight) v = true; }); lit.set(o, v); }
    return v;
  };
  const keep = (o: THREE.Object3D) => o === cur?.holder || o === fadeCard || (o as THREE.Light).isLight || o.userData.indoors === true || hasLight(o);
  function hideOutdoors(): void { for (const o of ctx.scene.children) if (o.visible && !keep(o)) { o.visible = false; hidden.add(o); } }
  function showOutdoors(): void { for (const o of hidden) o.visible = true; hidden.clear(); }

  const slots: Slot[] = ROOMS.map((def) => {
    const s = structure(def.site as StructureId);
    const frame = frameOf(s);
    const holder = new THREE.Group();
    holder.name = `interior:${def.id}`;
    const slot: Slot = { def, frame, holder, built: null, season: null, host: null as unknown as RoomHost };
    slot.host = {
      ctx, frame, audio,
      say: (t, ms, o) => ctx.ui.say(t, ms, o),
      fadeThen,
      leave: () => space.leave(),
      withOutdoors(fn) {
        if (cur !== slot) { fn(); return; }
        showOutdoors();
        const root = slot.built?.root;
        if (root) root.visible = false;
        try { fn(); } finally { if (root) root.visible = true; hideOutdoors(); }
      },
      since: () => since,
    };
    return slot;
  });
  const slotOf = (id: string | undefined) => (id ? slots.find((s) => s.def.id === id) : slots[0]) ?? null;

  function ensureBuilt(s: Slot): RoomBuilt {
    const season = ctx.valley.sky.season;
    if (s.built && s.season === season) return s.built;
    if (s.built) { s.holder.clear(); s.built.dispose(); }
    const b = s.def.build(s.host, season);
    b.root.position.set(s.frame.x, s.frame.y, s.frame.z);
    b.root.rotation.y = s.frame.yaw;
    s.holder.add(b.root, ...(b.extras ?? []));
    s.holder.updateMatrixWorld(true);
    s.built = b; s.season = season;
    return b;
  }

  function goIn(s: Slot, at = s.def.entry): void {
    if (cur === s) return;
    if (cur) goOut(false);
    const b = ensureBuilt(s);
    cur = s;
    since = 0;
    ctx.scene.add(s.holder);
    const L = lights();
    if (L) for (const e of b.emitters) offs.push(L.add(e));
    for (const i of b.interactables()) offs.push(ctx.interact.add(i));
    const w = s.frame.toWorld(at.x, at.z);
    controller()?.teleport(w.x, w.z, at.yaw + s.frame.yaw, at.pitch);
    hideOutdoors();
    audio()?.indoors?.(1, { roof: s.def.roof ?? 1 });
    try { b.entered?.(); } catch (e) { console.error('[interior] enter', e); }
  }
  function goOut(teleport: boolean): void {
    const s = cur;
    if (!s) return;
    cur = null;
    for (const f of offs.splice(0)) f();
    ctx.scene.remove(s.holder);
    showOutdoors();
    try { s.built?.left?.(); } catch (e) { console.error('[interior] leave', e); }
    audio()?.indoors?.(0);
    if (teleport) { const w = s.frame.toWorld(s.def.exit.x, s.def.exit.z); controller()?.teleport(w.x, w.z, s.def.exit.yaw + s.frame.yaw, s.def.exit.pitch); }
  }

  // ---- outside doors the rooms ask for (the farmhouse's own door is the structures package's)
  const doorOffs: (() => void)[] = [];
  for (const s of slots) { const off = s.def.init?.(ctx); if (off) doorOffs.push(off); }
  for (const s of slots) {
    const d = s.def.door;
    if (!d) continue;
    doorOffs.push(ctx.interact.add({
      id: `${s.def.id}:door`, kind: 'prop', verb: 'Go inside', label: () => d.label, hint: () => d.hint, reach: d.reach ?? 3.4,
      pos: s.frame.vec(d.at[0], d.at[1], d.at[2]),
      use: () => space.enter(false, s.def.id),
    }));
  }

  // ---- the service
  const tmpL = { x: 0, z: 0 }, tmpW = { x: 0, z: 0 };
  const petOut = { x: 0, y: 0, z: 0, yaw: 0 };
  const space: IndoorSpace = {
    get active() { return cur !== null; },
    get room() { return cur?.def.id ?? null; },
    floor(x, z, y) {
      if (!cur) return null;
      const l = cur.frame.toLocal(x, z, tmpL);
      const h = cur.def.floor(l.x, l.z, y === undefined ? undefined : y - cur.frame.y);
      return h === null ? null : cur.frame.y + h;
    },
    resolve(p, r) {
      if (!cur) return;
      const l = cur.frame.toLocal(p.x, p.z, tmpL);
      if (!cur.def.pushOut(l, r, p.y === undefined ? undefined : p.y - cur.frame.y)) return;
      const w = cur.frame.toWorld(l.x, l.z, tmpW);
      p.x = w.x; p.z = w.z;
    },
    owns: (i) => i.id.startsWith('interior:'),
    enter(instant, room) {
      const s = slotOf(room);
      if (!s || cur === s) return;
      if (instant) goIn(s); else { audio()?.play('creak', { volume: 0.6 }); fadeThen(() => goIn(s)); }
    },
    leave(instant) { if (!cur) return; if (instant) goOut(true); else fadeThen(() => goOut(true)); },
    view(name) {
      // 'hearth' (the first room's view), 'barn' (the barn's door view), 'barn:loft', 'farmhouse:bed'
      const i = name.indexOf(':');
      const named = slots.find((x) => x.def.id === (i < 0 ? name : name.slice(0, i)));
      const s = named ?? slots[0];
      const v = s.def.views[named ? (i < 0 ? 'door' : name.slice(i + 1)) : name];
      if (!v) return false;
      if (cur !== s) goIn(s);
      const at = s.frame.toWorld(v.x, v.z, tmpW);
      const t = s.frame.toWorld(v.tx, v.tz);
      const dx = t.x - at.x, dz = t.z - at.z;
      const floorY = v.y ?? s.def.floor(v.x, v.z) ?? 0;
      controller()?.teleport(at.x, at.z, Math.atan2(-dx, -dz), Math.atan2(v.ty - (floorY + 1.62), Math.hypot(dx, dz)));
      if (v.y !== undefined) ctx.player.pos.y = s.frame.y + v.y;
      return true;
    },
    petSpot() {
      const p = cur?.def.pet;
      if (!cur || !p) return null;
      const w = cur.frame.toWorld(p.x, p.z, tmpW);
      petOut.x = w.x; petOut.z = w.z; petOut.y = cur.frame.y + (p.y ?? 0); petOut.yaw = p.yaw + cur.frame.yaw;
      return petOut;
    },
  };
  ctx.services.set('indoors', space);

  const camDir = new THREE.Vector3();
  const lp = { x: 0, z: 0 };

  return {
    name: 'interior',
    update(f) {
      // ---- fade (real time: works with the animation clock frozen for shots)
      const now = performance.now(), rdt = Math.min(0.1, (now - lastReal) / 1000);
      lastReal = now;
      if (fadeTo === 1) {
        fade = Math.min(1, fade + rdt / FADE_OUT);
        if (fade >= 1) {
          if (onBlack) { const fn = onBlack; onBlack = null; try { fn(); } catch (e) { console.error('[interior]', e); } }
          hold -= rdt;
          if (hold <= 0) fadeTo = 0;
        }
      } else fade = Math.max(0, fade - rdt / FADE_IN);
      if (fade > 0) {
        if (!fadeCard.parent) ctx.scene.add(fadeCard);
        ctx.camera.getWorldDirection(camDir);
        fadeCard.position.copy(ctx.camera.position).addScaledVector(camDir, 0.12);
        fadeCard.quaternion.copy(ctx.camera.quaternion);
        fadeMat.opacity = fade * fade * (3 - 2 * fade);
      } else if (fadeCard.parent) ctx.scene.remove(fadeCard);

      const s = cur;
      if (!s || !s.built) return;
      since += f.dt > 0 ? f.dt : rdt;
      // walked (or was carried: map travel, dev teleports) out of the room: back to the valley as it is
      s.frame.toLocal(ctx.player.pos.x, ctx.player.pos.z, lp);
      if (!s.def.contains(lp.x, lp.z, -0.4) && fadeTo === 0) { goOut(false); return; }
      if (ctx.valley.sky.season !== s.season) {
        // rebuild for the new season where you stand
        const px = ctx.player.pos.x, pz = ctx.player.pos.z, py = ctx.player.pos.y, yaw = ctx.player.yaw, pitch = ctx.player.pitch;
        goOut(false); goIn(s);
        controller()?.teleport(px, pz, yaw, pitch);
        ctx.player.pos.y = py;
        return;
      }
      hideOutdoors();
      s.built.update(f, rdt);
    },
    stats: () => ({ inside: cur ? 1 : 0, room: cur?.def.id ?? '-', built: slots.filter((x) => x.built).length, hidden: hidden.size }),
    dispose() {
      goOut(false);
      for (const f of doorOffs.splice(0)) f();
      for (const s of slots) if (s.built) { s.built.dispose(); s.built = null; }
      ctx.scene.remove(fadeCard);
      if (ctx.services.get('indoors') === space) ctx.services.delete('indoors');
    },
  };
};
