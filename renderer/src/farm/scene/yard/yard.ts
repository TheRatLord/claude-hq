/**
 * The player's yard and the General store (system 'yard'; the economy itself is pure: model/wallet.ts + model/shop.ts,
 * service 'wallet', created by main.ts; the HUD's shop panel is hud/shop.ts).
 *
 *  - **The General store**: a little green cart with a striped awning on the meadow south-east of the square
 *    (`storeSpot`, layout.ts). E browses the shop, F sells your basket.
 *  - **Your yard**: the lawn behind the farmhouse (`YARD`, world/map.ts), fenced on three sides, with a painted
 *    sign at the north gate (E: the Yard tab). Decor you buy stands on 15 slots (`SLOTS`).
 *  - **Moving things**: look at a piece → `[E] Move` lifts it (it follows your look as a tinted ghost that snaps to
 *    the nearest slot: green = free, gold = swap, red = nowhere to put it; ghost rings mark every slot), E puts it
 *    down, F turns it 45°, X puts it away in storage. The Yard tab of the shop panel does the same with the mouse.
 *  - **Night**: lamp posts, the fairy-light arch, jack-o'-lanterns and the store's lantern are real `LightEmitter`s;
 *    their glass / bulbs brighten with `lighting.night`.
 *
 * Draw calls: one merged solid mesh (fence, sign posts, store cart, every placed piece), one bulbs mesh, one signs
 * mesh (both painted faces in one canvas), chime tubes (one instanced mesh, only while a chime stands) and, while
 * carrying, the slot rings and the ghost: ≤ 6. Rebuilt only when the layout / season changes; per frame it only
 * writes a few matrices and colours (no allocation).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AudioService, Interactable, LightEmitter, LightsService, SceneCtx, SystemFactory } from '../context.ts';
import type { Season } from '../../model/types.ts';
import type { Piece, WalletService } from '../../model/wallet.ts';
import { decorDef } from '../../model/shop.ts';
import { coins } from '../../model/shop.ts';
import { YARD, heightAt } from '../../world/map.ts';
import { Kit, LAMP_LIGHT, HAND, canvasTex, roundRect, woodPanel, fitText, solidMat } from '../structures/kit.ts';
import { warmEmitter } from '../lights/emitters.ts';
import { partName, recordParts } from '../parts.ts';
import { DECOR_R, buildDecor, buildStore, buildYardFence, buildYardSign } from './models.ts';
import type { DecorLight, Swinger } from './models.ts';
import { SIGN, SLOTS, VIEW, fenceRuns, inYard, slotNear, storeSpot } from './layout.ts';
import type { Slot } from './layout.ts';

/** what the HUD's shop panel and the dev API use (service 'yard') */
export interface YardService {
  /** pick a piece up to place it in the world (walks you to the yard first when you're far away) */
  carry(uid: number): void;
  carrying(): number | null;
  /** stop carrying (the piece stays where it was) */
  cancel(): void;
  /** stand at the yard's gate looking at the house */
  goto(): void;
  /** stand at the General store's counter */
  gotoStore(): void;
  readonly store: { readonly x: number; readonly z: number; readonly yaw: number };
  slots(): readonly Slot[];
}

const TUBES = 10;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const FREE = new THREE.Color(0x9fe6a0), SWAP = new THREE.Color(0xf2c33a), BAD = new THREE.Color(0xe0574a), RING = new THREE.Color(0xfff6e0), TAKEN = new THREE.Color(0xd9b46a);
const CANDLE = new THREE.Color(1.0, 0.45, 0.12), FAIRY = new THREE.Color(1.0, 0.62, 0.3);

export const yardSystem: SystemFactory = (ctx: SceneCtx) => {
  const root = new THREE.Group();
  root.name = 'yard';
  ctx.scene.add(root);
  const wallet = () => ctx.services.get('wallet') as WalletService | undefined;
  const lights = () => ctx.services.get('lights') as LightsService | undefined;
  const audio = () => ctx.services.get('audio') as AudioService | undefined;
  const sfx = (n: Parameters<AudioService['play']>[0], pos?: THREE.Vector3, volume = 1, pitch = 1) => { try { audio()?.play(n, { pos, volume, pitch }); } catch { /* optional */ } };
  const gy = (x: number, z: number) => heightAt(x, z);
  /** a base height that never floats: the lowest ground under the footprint */
  const baseY = (x: number, z: number, r: number) => {
    let y = gy(x, z);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; y = Math.min(y, gy(x + Math.cos(a) * r * 0.75, z + Math.sin(a) * r * 0.75)); }
    return y - 0.02;
  };

  const flora = ctx.services.get('floraSolids') as { blocked(x: number, z: number, r: number): boolean } | undefined;
  const store = storeSpot((x, z, r) => !!flora?.blocked(x, z, r) || ctx.colliders.blocked(x, z, r + 0.4));
  const toWorld = (ox: number, oz: number, yaw: number, lx: number, lz: number, out: { x: number; z: number }) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.x = ox + lx * c + lz * s; out.z = oz - lx * s + lz * c;
    return out;
  };
  // the cart stands on its two wheels and its prop leg, tilted to the ground under them (parked on a gentle slope)
  const tilt = (() => {
    const p = { x: 0, z: 0 };
    const at = (lx: number, lz: number) => { toWorld(store.x, store.z, store.yaw, lx, lz, p); return gy(p.x, p.z); };
    const hL = at(-1, -0.15), hR = at(1, -0.15), hB = at(0, -1.55);
    const s = ((hL + hR) / 2 - hB) / 1.4;
    return { y: (hL + hR) / 2 + s * 0.15 - 0.03, rx: -Math.atan(s), rz: Math.atan2(hR - hL, 2) };
  })();
  const storeY = tilt.y;
  const storeXf = { x: store.x, y: storeY, z: store.z, ry: store.yaw, rx: tilt.rx, rz: tilt.rz };

  // ---- materials ----
  const bulbMat = warmEmitter(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const solid = new THREE.Mesh(new THREE.BufferGeometry(), solidMat());
  solid.name = 'yard:solid';
  solid.castShadow = true; solid.receiveShadow = true;
  const bulbs = new THREE.Mesh(new THREE.BufferGeometry(), bulbMat);
  bulbs.name = 'yard:bulbs';
  root.add(solid, bulbs);

  // ---- the painted sign faces (one canvas: the store's board on top, the yard's below) ----
  const tex = canvasTex(512, 384);
  {
    const g = tex.g;
    const board = (y: number, h: number, base: string, seed: number) => {
      g.save(); g.translate(0, y);
      g.fillStyle = '#4a2e1a'; roundRect(g, 0, 0, 512, h, 18); g.fill();
      g.save(); roundRect(g, 6, 6, 500, h - 12, 14); g.clip(); woodPanel(g, 512, h, base, seed); g.restore();
      g.strokeStyle = '#f2d27a'; g.lineWidth = 4; roundRect(g, 12, 12, 488, h - 24, 11); g.stroke();
      g.restore();
    };
    board(0, 128, '#5f8f4a', 4);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff6e0';
    fitText(g, 'General store', 256 + 18, 66, 380, 62, HAND, 'bold');
    // a copper bit on the left
    g.fillStyle = '#d98a3a'; g.beginPath(); g.arc(58, 64, 30, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8a4a1a'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#5a8a3a'; g.beginPath(); g.ellipse(50, 58, 9, 14, -0.6, 0, Math.PI * 2); g.ellipse(66, 58, 9, 14, 0.6, 0, Math.PI * 2); g.fill();
    g.fillRect(56, 62, 4, 16);
    board(136, 216, '#c99a64', 9);
    g.fillStyle = '#4a2e1a';
    fitText(g, 'Your yard', 256, 136 + 82, 420, 72, HAND, 'bold');
    g.font = `600 30px ${HAND}`;
    g.fillStyle = '#6e4a2a';
    g.fillText('decor from the General store', 256, 136 + 152);
    // a little flower either side
    for (const x of [44, 468]) { g.fillStyle = '#e0574a'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(x + Math.cos(i * 1.256) * 11, 136 + 82 + Math.sin(i * 1.256) * 11, 9, 0, Math.PI * 2); g.fill(); } g.fillStyle = '#f2c33a'; g.beginPath(); g.arc(x, 136 + 82, 8, 0, Math.PI * 2); g.fill(); }
    tex.tex.needsUpdate = true;
  }
  const signMat = new THREE.MeshBasicMaterial({ map: tex.tex });
  const signs = (() => {
    const plane = (w: number, h: number, v0: number, v1: number, m: THREE.Matrix4) => {
      const p = new THREE.PlaneGeometry(w, h);
      const uv = p.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
      return p.applyMatrix4(m);
    };
    const mk = (x: number, y: number, z: number, yaw: number, lx: number, ly: number, lz: number, rx: number) =>
      new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z).multiply(new THREE.Matrix4().makeTranslation(lx, ly, lz)).multiply(new THREE.Matrix4().makeRotationX(rx));
    const sy = baseY(SIGN.x, SIGN.z, 0.5);
    // the painted faces belong to their boards (the audit's provenance: same names as the Kit parts)
    const parts = [
      partName(plane(1.4, 0.35, 1 - 128 / 384, 1, new THREE.Matrix4().compose(new THREE.Vector3(store.x, storeY, store.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt.rx, store.yaw, tilt.rz, 'YXZ')), new THREE.Vector3(1, 1, 1))
        .multiply(new THREE.Matrix4().makeTranslation(0, 2.98 + 0.038 * Math.sin(0.3), 0.42 + 0.038 * Math.cos(0.3))).multiply(new THREE.Matrix4().makeRotationX(-0.3))), 'generalStore#0'),
      partName(plane(0.96, 0.42, 1 - 352 / 384, 1 - 136 / 384, mk(SIGN.x, sy, SIGN.z, Math.PI, 0, 0.92, 0.0, 0).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.032))), 'yardSign#0'),
    ];
    const g = recordParts(mergeGeometries(parts)!, parts);
    const m = new THREE.Mesh(g, signMat);
    m.name = 'yard:signs';
    m.receiveShadow = true;
    return m;
  })();
  root.add(signs);

  // ---- chime tubes (instanced, swinging in the wind) ----
  const tubeGeo = new THREE.CylinderGeometry(0.013, 0.013, 1, 6).translate(0, -0.5, 0);
  const tubes = new THREE.InstancedMesh(tubeGeo, new THREE.MeshToonMaterial({ color: 0xc08a5a }), TUBES);
  tubes.name = 'yard:chimes';
  tubes.frustumCulled = false;
  tubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tubes.castShadow = true;
  for (let i = 0; i < TUBES; i++) tubes.setMatrixAt(i, ZERO);
  tubes.visible = false;
  root.add(tubes);
  const swing = new Float32Array(TUBES * 4); // x, y, z, len per tube
  let nTubes = 0;

  // ---- carrying: ghost rings over every slot, the tinted ghost of the piece ----
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.42, 0.56, 28).rotateX(-Math.PI / 2), ringMat, SLOTS.length);
  rings.name = 'yard:rings';
  rings.frustumCulled = false;
  rings.visible = false;
  for (const s of SLOTS) {
    _p.set(s.x, gy(s.x, s.z) + 0.05, s.z);
    rings.setMatrixAt(s.i, _m.compose(_p, _q.identity(), _s.set(1, 1, 1)));
    rings.setColorAt(s.i, RING);
  }
  root.add(rings);
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat);
  ghost.name = 'yard:ghost';
  ghost.visible = false;
  root.add(ghost);

  // ---- build / rebuild ----
  let season: Season = ctx.valley.sky.season;
  let builtVersion = -1, builtSeason = '';
  const emitters: LightEmitter[] = [];
  const offs: (() => void)[] = [];
  const pieceOffs: (() => void)[] = [];
  const carry = { uid: null as number | null, slot: null as Slot | null, hit: false, hx: 0, hz: 0, sig: -2 };
  const _w = { x: 0, z: 0 };

  function piecePose(p: Piece): { x: number; y: number; z: number; yaw: number } {
    const s = SLOTS[p.slot as number];
    return { x: s.x, y: baseY(s.x, s.z, DECOR_R[p.id] ?? 0.4), z: s.z, yaw: (p.rot / 8) * Math.PI * 2 };
  }

  function addLights(list: DecorLight[], ox: number, oy: number, oz: number, yaw: number): void {
    const L = lights();
    for (const l of list) {
      toWorld(ox, oz, yaw, l.x, l.z, _w);
      const e: LightEmitter = l.kind === 'lamp'
        ? { pos: new THREE.Vector3(_w.x, oy + l.y, _w.z), color: LAMP_LIGHT.clone(), intensity: 0.5, radius: 5, flicker: 0.2 }
        : l.kind === 'candle'
          ? { pos: new THREE.Vector3(_w.x, oy + l.y, _w.z), color: CANDLE.clone(), intensity: 0.4, radius: 2.6, flicker: 0.7 }
          : { pos: new THREE.Vector3(_w.x, oy + l.y, _w.z), color: FAIRY.clone(), intensity: 0.35, radius: 3.6, flicker: 0.1 };
      emitters.push(e);
      if (L) pieceOffs.push(L.add(e));
    }
  }
  function addSwing(list: Swinger[], ox: number, oy: number, oz: number, yaw: number): void {
    for (const sw of list) {
      if (nTubes >= TUBES) return;
      toWorld(ox, oz, yaw, sw.x, sw.z, _w);
      swing[nTubes * 4] = _w.x; swing[nTubes * 4 + 1] = oy + sw.y; swing[nTubes * 4 + 2] = _w.z; swing[nTubes * 4 + 3] = sw.len;
      nTubes++;
    }
  }

  function rebuild(): void {
    const w = wallet();
    for (const off of pieceOffs.splice(0)) off();
    emitters.length = 0;
    nTubes = 0;
    const k = new Kit(17), bk = new Kit(18);
    const both = (t: { x: number; y: number; z: number; ry: number; rx?: number; rz?: number }, fn: () => void) => k.at(t, () => bk.at(t, fn));
    // static: the fence, the yard sign, the store
    buildYardFence(k, fenceRuns(), gy);
    k.part('yardSign', () => k.at({ x: SIGN.x, y: baseY(SIGN.x, SIGN.z, 0.5), z: SIGN.z, ry: Math.PI }, () => buildYardSign(k)));
    k.part('generalStore', () => bk.part('generalStore', () => both(storeXf, () => {
      addLights(buildStore(k, bk, season).lights, store.x, storeY, store.z, store.yaw);
    })));
    // the placed pieces
    for (const p of w?.data().pieces ?? []) {
      if (p.slot === null || p.uid === carry.uid) continue;
      const def = decorDef(p.id);
      if (!def) continue;
      const pose = piecePose(p);
      k.part(`decor:${p.id}`, () => bk.part(`decor:${p.id}`, () => both({ x: pose.x, y: pose.y, z: pose.z, ry: pose.yaw }, () => {
        const o = buildDecor(k, bk, p.id, p.style, season);
        addLights(o.lights, pose.x, pose.y, pose.z, pose.yaw);
        addSwing(o.swing, pose.x, pose.y, pose.z, pose.yaw);
      })));
      pieceOffs.push(ctx.colliders.circle(pose.x, pose.z, (DECOR_R[p.id] ?? 0.4) * 0.8));
      pieceOffs.push(ctx.interact.add(pieceInteractable(p, pose)));
    }
    const sg = k.geometry('solid'), bg = bk.geometry('solid');
    solid.geometry.dispose(); solid.geometry = sg ?? new THREE.BufferGeometry();
    bulbs.geometry.dispose(); bulbs.geometry = bg ?? new THREE.BufferGeometry();
    tubes.visible = nTubes > 0;
    for (let i = nTubes; i < TUBES; i++) tubes.setMatrixAt(i, ZERO);
    tubes.instanceMatrix.needsUpdate = true;
    builtVersion = w?.yardVersion ?? 0;
    builtSeason = season;
  }

  // ---- interactables ----
  const storeAt = new THREE.Vector3();
  toWorld(store.x, store.z, store.yaw, 0, 0.55, _w);
  storeAt.set(_w.x, storeY + 1.45, _w.z);
  const hintStore = () => {
    const w = wallet();
    if (!w) return 'yard decor for bits';
    const n = w.basketCount();
    return `${coins(w.coins())} in your pocket${n ? ` · F sells your basket (${n})` : ''}`;
  };
  offs.push(ctx.interact.add({
    id: 'yard:store', kind: 'structure', verb: 'Browse', label: () => 'General store', reach: 3.6,
    pos: (o) => o.copy(storeAt), hint: hintStore,
    use: () => { sfx('bell', storeAt, 0.35, 1.6); ctx.ui.shop?.('buy'); },
    alt: { verb: 'Sell your basket', use: () => ctx.ui.shop?.('sell') },
  }));
  const signAt = new THREE.Vector3(SIGN.x, gy(SIGN.x, SIGN.z) + 0.95, SIGN.z);
  offs.push(ctx.interact.add({
    id: 'yard:sign', kind: 'structure', verb: 'Decorate', label: () => 'Your yard', reach: 3.4,
    pos: (o) => o.copy(signAt),
    hint: () => { const w = wallet(); const n = w?.data().pieces.length ?? 0; const placed = w?.data().pieces.filter((p) => p.slot !== null).length ?? 0; return n ? `${placed} of ${SLOTS.length} spots used · ${n - placed} in storage` : 'buy decor at the General store, south-east of the square'; },
    use: () => ctx.ui.shop?.('yard'),
  }));
  for (const [ax, az, bx, bz] of fenceRuns()) {
    const len = Math.hypot(bx - ax, bz - az);
    offs.push(ctx.colliders.rect((ax + bx) / 2, (az + bz) / 2, ax === bx ? 0.2 : len, ax === bx ? len : 0.2, 0));
  }
  { toWorld(store.x, store.z, store.yaw, 0, -0.5, _w); offs.push(ctx.colliders.rect(_w.x, _w.z, 2.3, 2.3, store.yaw)); }
  offs.push(ctx.colliders.circle(SIGN.x, SIGN.z, 0.45));

  function pieceInteractable(p: Piece, pose: { x: number; y: number; z: number }): Interactable {
    const def = decorDef(p.id)!;
    const at = new THREE.Vector3(pose.x, pose.y + 0.6, pose.z);
    return {
      id: `yard:piece:${p.uid}`, kind: 'prop', verb: 'Move', label: () => def.name, reach: 3.4,
      pos: (o) => o.copy(at),
      enabled: () => carry.uid === null,
      hint: () => { const cur = wallet()?.data().pieces.find((x) => x.uid === p.uid); const sty = cur && def.styles ? def.styles[cur.style] : ''; return `your yard${sty ? ` · ${sty.toLowerCase()}` : ''} · E picks it up to move it`; },
      use: () => startCarry(p.uid),
      alt: { verb: 'Turn', use: () => { wallet()?.rotate(p.uid, 1); sfx('creak', at, 0.4, 1.5); } },
    };
  }

  // the drop target while carrying: wherever you look, snapped to a slot
  const dropAt = new THREE.Vector3();
  /** loops, not closures: these run every frame while carrying */
  function findPiece(uid: number | null): Piece | undefined {
    const ps = wallet()?.data().pieces;
    if (!ps || uid === null) return undefined;
    for (let i = 0; i < ps.length; i++) if (ps[i].uid === uid) return ps[i];
    return undefined;
  }
  function occupant(s: Slot | null): Piece | undefined {
    const ps = wallet()?.data().pieces;
    if (!ps || !s) return undefined;
    for (let i = 0; i < ps.length; i++) if (ps[i].slot === s.i && ps[i].uid !== carry.uid) return ps[i];
    return undefined;
  }
  const carryName = () => decorDef(findPiece(carry.uid)?.id ?? '')?.name ?? 'it';
  const dropI: Interactable = {
    id: 'yard:drop', kind: 'prop', reach: 14, verb: 'Put down',
    label: carryName,
    pos: (o) => o.copy(dropAt),
    enabled: () => carry.uid !== null && carry.slot !== null && !ctx.player.frozen,
    hint: () => { const o = occupant(carry.slot); return `${o ? `swaps with the ${decorDef(o.id)?.name.toLowerCase() ?? 'piece'} · ` : ''}F turns it · X puts it away`; },
    use: () => drop(),
    alt: { verb: 'Turn', use: () => { if (carry.uid !== null) { wallet()?.rotate(carry.uid, 1); ghostFor(); } } },
  };
  offs.push(ctx.interact.add(dropI));

  function startCarry(uid: number): void {
    const w = wallet();
    const p = w?.data().pieces.find((x) => x.uid === uid);
    if (!w || !p) return;
    carry.uid = uid; carry.slot = null; carry.sig = -2;
    ghostFor();
    rings.visible = true;
    rebuild();
    sfx('pop', undefined, 0.5, 1.3);
    ctx.ui.say(`${decorDef(p.id)?.name ?? 'Got it'}: look where it should go and press E. F turns it, X puts it away.`, 3600, { who: 'Your yard' });
  }
  function ghostFor(): void {
    const p = carry.uid !== null ? wallet()?.data().pieces.find((x) => x.uid === carry.uid) : undefined;
    if (!p) { ghost.visible = false; return; }
    const k = new Kit(19);
    buildDecor(k, k, p.id, p.style, season);
    ghost.geometry.dispose();
    ghost.geometry = k.geometry('solid') ?? new THREE.BufferGeometry();
    ghost.rotation.y = (p.rot / 8) * Math.PI * 2;
  }
  function endCarry(): void {
    carry.uid = null; carry.slot = null;
    ghost.visible = false; rings.visible = false;
    rebuild();
  }
  function drop(): void {
    const w = wallet();
    if (!w || carry.uid === null || !carry.slot) return;
    const uid = carry.uid, slot = carry.slot;
    const other = occupant(slot);
    w.place(uid, slot.i);
    carry.uid = null; // rebuild after place (the version bump also triggers it)
    endCarry();
    _p.set(slot.x, gy(slot.x, slot.z) + 0.3, slot.z);
    sfx('pop', _p, 0.8, 1.05);
    setTimeout(() => sfx('sparkle', undefined, 0.35), 90);
    if (other) ctx.ui.say(`Swapped places with the ${decorDef(other.id)?.name.toLowerCase() ?? 'other piece'}.`, 2200, { who: 'Your yard', from: 'yard:sign' });
  }
  function putAway(): void {
    const w = wallet();
    if (!w || carry.uid === null) return;
    const name = carryName();
    w.store(carry.uid);
    endCarry();
    sfx('page', undefined, 0.6);
    ctx.ui.say(`${name} is in storage. Place it again from the Yard tab.`, 2600, { who: 'Your yard', from: 'yard:sign' });
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyX' || e.repeat || e.defaultPrevented || ctx.player.frozen || carry.uid === null) return;
    e.preventDefault();
    putAway();
  };
  addEventListener('keydown', onKey);

  /** where the view ray meets the ground (within 14 m): the carry target */
  function aim(): void {
    carry.hit = false;
    ctx.camera.getWorldDirection(_fwd);
    const e = ctx.player.eye;
    for (let d = 0.6; d <= 14; d += 0.2) {
      const x = e.x + _fwd.x * d, y = e.y + _fwd.y * d, z = e.z + _fwd.z * d;
      if (y > gy(x, z)) continue;
      carry.hit = true; carry.hx = x; carry.hz = z;
      break;
    }
    carry.slot = carry.hit && inYard(carry.hx, carry.hz, 0.6) ? slotNear(carry.hx, carry.hz, 1.4) : null;
  }

  const svc: YardService = {
    carry(uid) {
      const p = ctx.player.pos;
      if (!inYard(p.x, p.z, 8)) svc.goto();
      startCarry(uid);
    },
    carrying: () => carry.uid,
    cancel: () => { if (carry.uid !== null) endCarry(); },
    goto() {
      const c = ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined;
      c?.teleport(VIEW.x, VIEW.z, VIEW.yaw, VIEW.pitch);
    },
    gotoStore() {
      const c = ctx.services.get('controller') as { teleport(x: number, z: number, yaw?: number, pitch?: number): void } | undefined;
      toWorld(store.x, store.z, store.yaw, 0, 3.4, _w);
      c?.teleport(_w.x, _w.z, store.yaw, 0.04); // (yaw θ looks along (−sin θ, −cos θ): back at the store's front)
    },
    store,
    slots: () => SLOTS,
  };
  ctx.services.set('yard', svc);

  rebuild();

  return {
    name: 'yard',
    update(f) {
      const w = wallet();
      const s = ctx.valley.sky.season;
      if (s !== season) season = s;
      if ((w && w.yardVersion !== builtVersion) || season !== builtSeason) { rebuild(); if (carry.uid !== null) ghostFor(); }
      // night: bulbs and signs
      const n = ctx.lighting.night;
      bulbMat.color.setScalar(0.8 + n * 1.7);
      const dim = 1 - 0.5 * n;
      signMat.color.setRGB(dim, dim * 0.97, dim * 0.92);
      // chimes swing with the wind
      if (nTubes) {
        const wx = ctx.lighting.wind.x, wz = ctx.lighting.wind.z;
        for (let i = 0; i < nTubes; i++) {
          const t = f.time * (1.7 + i * 0.13) + i * 1.9;
          _e.set(Math.max(-0.6, Math.min(0.6, wz * 0.05 + Math.sin(t) * (0.05 + Math.abs(wz) * 0.03))), 0, Math.max(-0.6, Math.min(0.6, -wx * 0.05 + Math.cos(t * 0.8) * (0.05 + Math.abs(wx) * 0.03))));
          _q.setFromEuler(_e);
          _p.set(swing[i * 4], swing[i * 4 + 1], swing[i * 4 + 2]);
          _s.set(1, swing[i * 4 + 3], 1);
          tubes.setMatrixAt(i, _m.compose(_p, _q, _s));
        }
        tubes.instanceMatrix.needsUpdate = true;
      }
      // carrying
      if (carry.uid !== null) {
        const p = ctx.player.pos;
        if (!inYard(p.x, p.z, 30) || !w || !findPiece(carry.uid)) { endCarry(); return; }
        if (!ctx.player.frozen) aim();
        const occ = carry.slot ? occupant(carry.slot) : undefined;
        const sig = (carry.slot?.i ?? -1) * 100000 + (occ?.uid ?? 0);
        dropI.verb = occ ? 'Swap in' : 'Put down';
        if (carry.slot) {
          dropAt.set(carry.slot.x, gy(carry.slot.x, carry.slot.z) + 0.5, carry.slot.z);
          ghost.position.set(carry.slot.x, gy(carry.slot.x, carry.slot.z) + 0.04 + Math.sin(f.time * 4) * 0.03, carry.slot.z);
          ghost.visible = true;
          ghostMat.color.copy(occ ? SWAP : FREE);
        } else if (carry.hit) {
          ghost.position.set(carry.hx, gy(carry.hx, carry.hz) + 0.04, carry.hz);
          ghost.visible = true;
          ghostMat.color.copy(BAD);
        } else ghost.visible = false;
        if (sig !== carry.sig) {
          carry.sig = sig;
          for (const sl of SLOTS) {
            const o = occupant(sl);
            rings.setColorAt(sl.i, _c.copy(sl.i === carry.slot?.i ? (o ? SWAP : FREE) : o ? TAKEN : RING));
          }
          if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
        }
      }
    },
    stats: () => ({ pieces: wallet()?.data().pieces.filter((p) => p.slot !== null).length ?? 0, emitters: emitters.length, carrying: carry.uid ?? '-' }),
    dispose() {
      ctx.services.delete('yard');
      removeEventListener('keydown', onKey);
      for (const off of [...offs.splice(0), ...pieceOffs.splice(0)]) off();
      ctx.scene.remove(root);
      solid.geometry.dispose(); bulbs.geometry.dispose(); signs.geometry.dispose(); ghost.geometry.dispose();
      tex.tex.dispose();
    },
  };
};
