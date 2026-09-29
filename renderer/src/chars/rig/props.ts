/**
 * Held props (DESIGN §6.3, ART §6.5): every hand-held thing a Clawd or Shelly animates with. All props are built once
 * per rig under `propRoot` (hidden until an action's pose names them in `pose.prop`), so a prop swap never changes the
 * part list or the draw count: props reuse the shared instanced part types (rbox, cyl, limb, sphere, torus, …).
 *
 * The animator places the shown prop's root at the pose's (propX, propY, propZ, propRx, propRy, propRz) in the rig's
 * body frame and calls its `update(f, t)` with the pose channels (propA/propB/propC are per-prop parameters, documented
 * on each prop). A prop's root sits at its grip point unless noted, so an activity reaches the hand to the same point.
 * Owner: CHR.
 */
import type * as THREE from 'three';
import { makeBuilder, limbScale, type NodeFn, type PartFn, type RigPart } from './build.ts';
import { CH } from '../anim/pose.ts';
import { grepGrip, grepMagRot, grepTilt, grepBookH, GREP_TILT, GREP_BOOK_H, GREP_TOME } from '../anim/activities/common.ts';

const TAU = Math.PI * 2;
const COVERS = ['#5E9EA0', '#9DB38F', '#A99BD3', '#C79A6B']; // env accents (teal, sage, lavender, oak)
const C = Object.freeze({
  oak: '#B98A5A', walnut: '#7A5238', kraft: '#C9A27A', red: '#C9574A', glass: '#CFE3E8', mint: '#8FCFA8', gold: '#E8B84A',
  steel: '#A8A8A0', teal: '#5E9EA0', manila: '#D9B77A', leaf: '#7FA86A', pink: '#E9A0A8', coal: '#2A2826', yarn: '#7FC99A',
  screen: '#24493D', bag: '#6E8E6A', can: '#6E9E8A',
});
const P = { hull: true, shadow: true, group: 'prop' };
const S = { hull: false, shadow: false, group: 'prop' }; // small detail: no hull, no shadow

/** Per-frame prop animation from the pose channels `f` and time `t`. */
export type PropUpdate = (f: Float32Array, t: number) => void;
export interface Prop { root: THREE.Object3D; update?: PropUpdate }
type PropBuilder = (b: { part: PartFn; node: NodeFn }, root: THREE.Object3D, seed: number) => PropUpdate | undefined;

const BUILD: Record<string, PropBuilder> = {
  /** Open book, spine at the root. propA open (0..1), propB page flip (0..1). */
  book({ part, node }, root, seed) {
    const cover = COVERS[seed % COVERS.length];
    const halves = [-1, 1].map((side) => {
      const h = node(root, {});
      part(h, 'rbox', cover, { ...P, p: [side * 0.085, 0, 0], s: [0.17, 0.22, 0.016] });
      part(h, 'rbox', 'trim', { ...P, hull: false, p: [side * 0.08, 0, 0.012], s: [0.15, 0.2, 0.014] });
      return h;
    });
    const page = node(root, {});
    part(page, 'rbox', 'trim', { ...S, p: [0.075, 0, 0], s: [0.14, 0.19, 0.006] });
    return (f) => {
      const open = 0.35 + 0.65 * f[CH.propA];
      halves[0].rotation.y = -(1 - open) * 1.2 + 0.12;
      halves[1].rotation.y = (1 - open) * 1.2 - 0.12;
      const flip = f[CH.propB];
      page.visible = flip > 0.001 && flip < 0.999;
      page.rotation.y = -flip * Math.PI;
    };
  },
  /**
   * Laptop, root at the base centre, the user on its −z side: hinge on the far (+z) edge, the screen facing the user.
   * propA lid open (0 closed … 1 = 105°), propB screen flicker.
   */
  laptop({ part, node }, root) {
    part(root, 'rbox', 'ink2', { ...P, s: [0.3, 0.022, 0.21] });
    part(root, 'rbox', '#5A5650', { ...S, p: [0, 0.012, -0.02], s: [0.25, 0.006, 0.1] });
    const lid = node(root, { p: [0, 0.01, 0.1] });
    part(lid, 'rbox', 'ink2', { ...P, p: [0, 0.1, 0], s: [0.3, 0.2, 0.016] });
    part(lid, 'screen', C.screen, { p: [0, 0.1, -0.0095], r: [0, Math.PI, 0], s: [0.26, 0.16, 0.2], emissive: 1 });
    const lines = [0, 1, 2].map((i) => part(lid, 'stroke', 'phosphor', { p: [0.1, 0.15 - i * 0.04, -0.014], s: [0.012, 0.05, 0.012], r: [0, 0, Math.PI / 2], emissive: 1.1 }));
    // a sticker on the back of the lid (what everyone else sees)
    part(lid, 'cyl', 'workspace', { ...S, p: [0, 0.11, 0.009], s: [0.03, 0.004, 0.03], r: [Math.PI / 2, 0, 0] });
    return (f, t) => {
      const k = Math.max(0, Math.min(1, f[CH.propA]));
      lid.rotation.x = -(1 - k) * (Math.PI / 2) + k * 0.26;
      for (let i = 0; i < lines.length; i++) lines[i].scale.y = 0.02 + 0.045 * (0.5 + 0.5 * Math.sin(t * (3 + i) + i * 2 + f[CH.propB] * 9)); // [CHR m2 r2 alloc] index loops in per-frame prop updates
    };
  },
  /** Magnifying glass, root at the grip; the lens sits 0.14 m up the handle. */
  magnifier({ part, node }, root) {
    part(root, 'limb', C.walnut, { ...P, p: [0, 0.09, 0], s: limbScale(0.02, 0.09) });
    const head = node(root, { p: [0, 0.155, 0] });
    part(head, 'torus', 'ink2', { ...P, s: [0.07, 0.12, 0.07], r: [Math.PI / 2, 0, 0] });
    part(head, 'cyl', C.glass, { ...S, s: [0.062, 0.01, 0.062], r: [Math.PI / 2, 0, 0] });
    part(head, 'sphere', 'trim', { ...S, p: [-0.025, 0.025, 0.008], s: [0.012, 0.012, 0.004] });
  },
  /** Pencil, root at its middle, tip toward −y. */
  pencil({ part }, root) {
    part(root, 'cyl', C.gold, { ...P, s: [0.014, 0.12, 0.014] });
    part(root, 'cone', C.kraft, { ...S, p: [0, -0.06, 0], s: [0.014, 0.03, 0.014], r: [Math.PI, 0, 0] });
    part(root, 'cyl', C.pink, { ...S, p: [0, 0.066, 0], s: [0.015, 0.02, 0.015] });
  },
  /** Clipboard (root at the board centre, facing +z) with a pencil the other hand ticks with: propA tick (0..1), propB row. */
  clipboard({ part, node }, root) {
    part(root, 'rbox', C.oak, { ...P, s: [0.2, 0.26, 0.016] });
    part(root, 'rbox', 'trim', { ...S, p: [0, -0.01, 0.01], s: [0.17, 0.21, 0.006] });
    part(root, 'rbox', 'ink2', { ...S, p: [0, 0.125, 0.014], s: [0.08, 0.03, 0.018] });
    for (let i = 0; i < 3; i++) {
      part(root, 'limb', 'ink', { ...S, p: [-0.03, 0.06 - i * 0.055, 0.014], s: [0.008, 0.04, 0.008], r: [0, 0, Math.PI / 2] });
      part(root, 'rbox', 'ink2', { ...S, p: [-0.06, 0.06 - i * 0.055, 0.014], s: [0.018, 0.018, 0.004] });
    }
    const pen = node(root, {});
    part(pen, 'cyl', C.gold, { ...P, p: [0, 0.06, 0], s: [0.012, 0.11, 0.012] });
    part(pen, 'cone', 'ink2', { ...S, s: [0.012, 0.02, 0.012], r: [Math.PI, 0, 0] });
    return (f) => {
      const row = Math.floor(f[CH.propB] * 2.999);
      const k = f[CH.propA];
      pen.position.set(-0.06 + 0.02 * Math.sin(k * Math.PI), 0.06 - row * 0.055 + 0.03 * k * (1 - k) * 4, 0.02 + 0.03 * (1 - Math.sin(k * Math.PI)));
      pen.rotation.set(-0.5, 0, -0.5);
    };
  },
  /** Card file box (Glob), root at the box centre: propA flips cards up and out, one after another. */
  cards({ part, node }, root) {
    part(root, 'rbox', C.walnut, { ...P, s: [0.18, 0.09, 0.13] });
    part(root, 'rbox', C.oak, { ...S, p: [0, 0.045, 0], s: [0.16, 0.01, 0.11] });
    const cards = [0, 1, 2, 3].map(() => {
      const c = node(root, {});
      part(c, 'rbox', 'trim', { ...S, p: [0, 0.06, 0], s: [0.12, 0.1, 0.005] });
      part(c, 'limb', 'ink', { ...S, p: [-0.02, 0.08, 0.004], s: [0.006, 0.03, 0.006], r: [0, 0, Math.PI / 2] });
      return c;
    });
    return (f) => {
      const ph = f[CH.propA] * 4;
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const u = ((ph - i) % 4 + 4) % 4; // 0..4
        const fly = Math.min(1, u);
        c.position.set(0.02 * (i - 1.5) + 0.25 * fly * (i % 2 ? 1 : -1) * fly, 0.02 + 0.3 * Math.sin(fly * Math.PI) * (u < 1 ? 1 : 0), -0.03 + 0.02 * i);
        c.rotation.set(-0.2 - fly * 2.5 * (u < 1 ? 1 : 0), 0, fly * 1.5 * (i % 2 ? 1 : -1) * (u < 1 ? 1 : 0));
        c.visible = u < 1 || u > 1.3;
      }
    };
  },
  /** Retro handset (MCP call), root at the grip: earpiece +y, mouthpiece −y. */
  phone({ part }, root) {
    part(root, 'rbox', C.red, { ...P, s: [0.04, 0.16, 0.035] });
    part(root, 'rbox', C.red, { ...P, p: [0, 0.085, 0.022], s: [0.055, 0.05, 0.045], r: [0.4, 0, 0] });
    part(root, 'rbox', C.red, { ...P, p: [0, -0.085, 0.022], s: [0.055, 0.05, 0.045], r: [-0.4, 0, 0] });
    for (let i = 0; i < 4; i++) part(root, 'torus', 'ink2', { ...S, p: [0, -0.12 - i * 0.022, 0], s: [0.014, 0.1, 0.014] });
  },
  /** MCP cable plugged out of the back, root at the socket (back of the body): propA glow pulse 0..1. */
  cable({ part, node }, root) {
    let parent = root;
    for (let i = 0; i < 4; i++) {
      const seg = node(parent, { p: [0, i ? -0.09 : 0, 0], r: [i ? 0.35 : 1.1, 0, 0] });
      part(seg, 'limb', 'ink2', { ...P, s: limbScale(0.016, 0.09) });
      parent = seg;
    }
    const plug = node(parent, { p: [0, -0.1, 0] });
    part(plug, 'rbox', 'ink2', { ...P, s: [0.05, 0.05, 0.04] });
    const glow = part(plug, 'glint', '#7FE3A0', { p: [0, -0.03, 0], s: 0.018, emissive: 1.4 });
    return (f) => { glow.scale.setScalar(0.014 + 0.012 * f[CH.propA]); };
  },
  /** Round-bottom flask, root at the neck grip; the liquid sloshes with propA. */
  flask({ part, node }, root) {
    part(root, 'cyl', C.glass, { ...P, s: [0.025, 0.08, 0.025] });
    part(root, 'sphere', C.glass, { ...P, p: [0, -0.09, 0], s: 0.065 });
    const liq = node(root, { p: [0, -0.1, 0] });
    part(liq, 'sphere', C.mint, { ...S, s: [0.055, 0.04, 0.055] });
    part(root, 'cyl', C.walnut, { ...S, p: [0, 0.045, 0], s: [0.028, 0.02, 0.028] });
    return (f) => { liq.rotation.z = 0.4 * Math.sin(f[CH.propA] * TAU); };
  },
  /** Mug, root at the handle grip (handle on −x): propB tilt handled by the pose; steam is FX. */
  mug({ part, node }, root) {
    const body = node(root, { p: [0.06, 0, 0] });
    part(body, 'cyl', C.teal, { ...P, s: [0.045, 0.09, 0.045] });
    part(body, 'cyl', C.walnut, { ...S, p: [0, 0.04, 0], s: [0.038, 0.012, 0.038] });
    part(body, 'sphere', 'trim', { ...S, p: [0.01, 0.047, 0.005], s: [0.016, 0.01, 0.016] });
    part(root, 'torus', C.teal, { ...P, p: [0.018, 0, 0], s: [0.026, 0.14, 0.026], r: [Math.PI / 2, 0, 0] });
  },
  /** Git desk stamp: envelope lying at the root, stamp rising by propA (0 = pressed). */
  stamp({ part, node }, root) {
    part(root, 'rbox', 'trim', { ...P, s: [0.2, 0.008, 0.13] });
    part(root, 'diamond', 'ink2', { ...S, p: [0, 0.006, -0.02], s: [0.2, 0.09, 0.02], r: [-Math.PI / 2, 0, Math.PI / 2] });
    const mark = part(root, 'cyl', C.red, { ...S, p: [0.05, 0.006, 0.03], s: [0.03, 0.004, 0.03] });
    const st = node(root, { p: [0.05, 0.03, 0.03] });
    part(st, 'rbox', C.red, { ...P, s: [0.07, 0.025, 0.07] });
    part(st, 'cyl', C.walnut, { ...P, p: [0, 0.05, 0], s: [0.018, 0.07, 0.018] });
    part(st, 'sphere', C.walnut, { ...P, p: [0, 0.095, 0], s: 0.03 });
    return (f) => { st.position.y = 0.018 + 0.14 * f[CH.propA]; mark.visible = f[CH.propB] > 0.5; };
  },
  /**
   * Satellite dish on the head (web): root at the head top; propA pop-up (0..1), propB spin angle.
   * [CHR fix m2-r2] A closed clay saucer: the open 'dome' alone showed its inverted hull (a flat dark-grey plate) from
   * the dish side. Now a teal convex back with a hub, a cream face disc capping it and a butter rim, lit from both sides.
   */
  dish({ part, node }, root) {
    const up = node(root, {});
    part(up, 'limb', 'ink2', { ...P, p: [0, 0.14, 0], s: limbScale(0.016, 0.14) });
    const turn = node(up, { p: [0, 0.15, 0] });
    const d = node(turn, { r: [-0.9, 0, 0] });
    part(d, 'dome', C.teal, { ...P, p: [0, 0.03, 0], s: [0.13, 0.055, 0.13], r: [Math.PI, 0, 0] });
    part(d, 'cyl', C.walnut, { ...S, p: [0, -0.028, 0], s: [0.03, 0.02, 0.03] }); // hub where the stalk meets the back
    part(d, 'cyl', 'trim', { ...S, p: [0, 0.03, 0], s: [0.122, 0.01, 0.122] }); // face disc caps the open dome
    part(d, 'torus', C.gold, { ...S, p: [0, 0.032, 0], s: [0.13, 0.06, 0.13] }); // chunky clay rim
    part(d, 'cyl', '#E6DCC8', { ...S, p: [0, 0.036, 0], s: [0.07, 0.004, 0.07] }); // inner ring: the face reads as a bowl
    part(d, 'limb', 'ink2', { ...S, p: [0, 0.1, 0], s: limbScale(0.008, 0.065) });
    part(d, 'glint', '#F4B860', { p: [0, 0.105, 0], s: 0.016, emissive: 1.3 });
    return (f) => { const k = Math.max(0.001, f[CH.propA]); up.scale.set(k, k, k); turn.rotation.y = f[CH.propB]; };
  },
  /**
   * [CHR M3.5] The paper-plane prompt (FX flies it, the Clawd catches and reads it): two paper halves hinged on a
   * vertical centre crease, root at the crease centre. propA 0 = folded into a dart (halves swung into a V toward −z,
   * narrow; pitch the root +π/2 to fly it nose-first, wings up), 1 = a flat 0.26 × 0.3 m sheet with ink lines on both faces.
   */
  note({ part, node }, root) {
    const halves = [-1, 1].map((side) => {
      const h = node(root, {});
      const w = node(h, {});
      part(w, 'rbox', 'trim', { ...P, p: [side * 0.065, 0, 0], s: [0.13, 0.3, 0.006] });
      for (let i = 0; i < 4; i++) {
        for (const z of [-0.0045, 0.0045]) part(w, 'limb', 'ink2', { ...S, p: [side > 0 ? 0.012 : -0.11, 0.09 - i * 0.055, z], s: [0.009, i === 3 ? 0.03 : 0.049, 0.004], r: [0, 0, Math.PI / 2] });
      }
      return { h, w };
    });
    return (f) => {
      const u = Math.max(0, Math.min(1, f[CH.propA]));
      const fold = (1 - u) * 1.25; // wings swing toward −z (up, once the dart's nose is pitched forward)
      halves[0].h.rotation.y = -fold; halves[1].h.rotation.y = fold;
      const sx = 0.5 + 0.5 * u, sy = 0.85 + 0.15 * u;
      halves[0].w.scale.set(sx, sy, 1); halves[1].w.scale.set(sx, sy, 1);
    };
  },
  /** Wrapped parcel (sign-off run), root at the box centre; ribbon + bow in trim. */
  parcel({ part }, root) {
    part(root, 'rbox', C.kraft, { ...P, s: [0.3, 0.22, 0.24] });
    part(root, 'rbox', C.red, { ...S, s: [0.305, 0.225, 0.04] });
    part(root, 'rbox', C.red, { ...S, s: [0.04, 0.225, 0.245] });
    for (const side of [-1, 1]) part(root, 'sphere', C.red, { ...P, p: [side * 0.035, 0.125, 0], s: [0.04, 0.025, 0.02], r: [0, 0, side * 0.4] });
  },
  /** "still here?" sign on a stick, root at the grip; the lettering is FX. */
  sign({ part }, root) {
    part(root, 'limb', C.walnut, { ...P, p: [0, 0.2, 0], s: limbScale(0.014, 0.22) });
    part(root, 'rbox', 'trim', { ...P, p: [0, 0.3, 0.012], s: [0.34, 0.2, 0.014] });
    for (let i = 0; i < 2; i++) part(root, 'limb', 'ink', { ...S, p: [-0.1 + i * 0.03, 0.34 - i * 0.07, 0.022], s: [0.012, 0.09 - i * 0.02, 0.012], r: [0, 0, Math.PI / 2] });
    part(root, 'sphere', 'ink', { ...S, p: [0.12, 0.26, 0.022], s: [0.016, 0.016, 0.006] });
  },
  /** Watering can, root at the top handle; spout toward +z. */
  wateringCan({ part }, root) {
    part(root, 'band', C.can, { ...P, p: [0, -0.02, 0], s: [0.05, 0.05, 0.3], r: [0, Math.PI / 2, 0] });
    part(root, 'cyl', C.can, { ...P, p: [0, -0.1, 0], s: [0.07, 0.11, 0.07] });
    part(root, 'limb', C.can, { ...P, p: [0, -0.12, 0.05], s: limbScale(0.014, 0.12), r: [-2.3, 0, 0] });
    part(root, 'cyl', C.can, { ...S, p: [0, -0.04, 0.155], s: [0.024, 0.02, 0.024], r: [1.2, 0, 0] });
  },
  /** Ping-pong paddle with its ball, root at the grip: propA ball arc phase (0..1). */
  paddle({ part, node }, root) {
    // [BRN cross-owner] blade 0.07 → 0.105: at the rally distance (2–6 m) the 0.07 blade was lost against the body
    part(root, 'limb', C.walnut, { ...P, p: [0, 0.05, 0], s: limbScale(0.02, 0.07) });
    part(root, 'cyl', C.red, { ...P, p: [0, 0.14, 0], s: [0.105, 0.018, 0.105], r: [Math.PI / 2, 0, 0] });
    const ball = node(root, {});
    part(ball, 'sphere', 'trim', { ...S, s: 0.022 });
    // [BRN cross-owner] propA < 0: rallying (social.ts draws the one shared ball), the practice ball hides
    return (f) => { const u = f[CH.propA]; ball.visible = u >= 0; ball.position.set(0.05 * Math.sin(u * TAU), 0.13 + 0.25 * Math.sin(u * Math.PI), 0.06 + 0.35 * Math.sin(u * Math.PI)); };
  },
  /** Paintbrush, root at the grip, bristles toward +y. */
  brush({ part }, root) {
    part(root, 'limb', C.walnut, { ...P, p: [0, 0.08, 0], s: limbScale(0.012, 0.1) });
    part(root, 'cone', C.teal, { ...S, p: [0, 0.08, 0], s: [0.018, 0.05, 0.018] });
  },
  /** Brass spyglass, root at the grip; the eyepiece end is −z. */
  spyglass({ part }, root) {
    part(root, 'cyl', C.gold, { ...P, p: [0, 0, 0.05], s: [0.03, 0.18, 0.03], r: [Math.PI / 2, 0, 0] });
    part(root, 'cyl', 'ink2', { ...P, p: [0, 0, -0.07], s: [0.022, 0.1, 0.022], r: [Math.PI / 2, 0, 0] });
    part(root, 'torus', 'ink2', { ...S, p: [0, 0, 0.14], s: [0.03, 0.12, 0.03], r: [Math.PI / 2, 0, 0] });
  },
  /** Yo-yo, root at the finger: propA string length (0..1). */
  yoyo({ part, node }, root) {
    const str = node(root, {});
    part(str, 'limb', 'ink', { ...S, s: limbScale(0.004, 0.2) });
    const disc = node(root, {});
    part(disc, 'cyl', C.red, { ...P, s: [0.04, 0.03, 0.04], r: [0, 0, Math.PI / 2] });
    part(disc, 'cyl', 'trim', { ...S, s: [0.03, 0.034, 0.03], r: [0, 0, Math.PI / 2] });
    return (f, t) => { const L = 0.02 + 0.2 * f[CH.propA]; str.scale.y = L / 2; disc.position.y = -L; disc.rotation.x = t * 20; };
  },
  /** Three juggling balls, root between the hands: propA juggle phase (cascade), propB spread. */
  balls({ part, node }, root) {
    const balls = [C.red, C.teal, C.gold].map((c) => { const n = node(root, {}); part(n, 'sphere', c, { ...P, s: 0.032 }); return n; });
    return (f) => {
      const ph = f[CH.propA] * 3, w = 0.09 + 0.05 * f[CH.propB];
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        const u = ((ph + i) % 3) / 3; // one full cycle = 3 throws
        const half = u < 0.5 ? u * 2 : (u - 0.5) * 2;
        const dir = u < 0.5 ? 1 : -1;
        b.position.set(dir * w * (half * 2 - 1), 0.02 + (u < 0.5 ? 0.24 : 0.12) * 4 * half * (1 - half), 0.02 * Math.sin(u * TAU));
      }
    };
  },
  /** Manila file folder, root at the centre facing +z; propA opens the front cover. */
  folder({ part, node }, root) {
    part(root, 'rbox', C.manila, { ...P, s: [0.22, 0.28, 0.012] });
    part(root, 'rbox', 'trim', { ...S, p: [0, 0.02, 0.01], s: [0.19, 0.26, 0.005] });
    for (let i = 0; i < 3; i++) part(root, 'limb', 'ink2', { ...S, p: [-0.06, 0.1 - i * 0.05, 0.014], s: [0.008, 0.06, 0.008], r: [0, 0, Math.PI / 2] });
    const cover = node(root, { p: [-0.11, 0, 0.018] });
    part(cover, 'rbox', C.manila, { ...P, p: [0.11, -0.01, 0], s: [0.22, 0.26, 0.01] });
    return (f) => { cover.rotation.y = -2.2 * f[CH.propA]; };
  },
  /** Board-game pawn held between two fingers. */
  pawn({ part }, root) {
    part(root, 'cone', C.teal, { ...P, p: [0, -0.04, 0], s: [0.03, 0.06, 0.03] });
    part(root, 'sphere', C.teal, { ...P, p: [0, 0.03, 0], s: 0.022 });
  },
  /** The backpack hugged in front for compaction: propA stuffing (papers), propB squash (sat on). */
  pack({ part, node }, root) {
    const bag = node(root, {});
    part(bag, 'rbox', C.bag, { ...P, s: [0.3, 0.28, 0.18] });
    part(bag, 'rbox', C.bag, { ...P, p: [0, 0.12, 0.02], s: [0.31, 0.08, 0.2] });
    part(bag, 'rbox', 'trim', { ...S, p: [0, -0.02, 0.092], s: [0.16, 0.1, 0.02] });
    const papers = [0, 1, 2].map((i) => { const n = node(bag, { p: [-0.06 + i * 0.06, 0.16, 0], r: [0, 0, (i - 1) * 0.3] }); part(n, 'rbox', 'trim', { ...S, p: [0, 0.05, 0], s: [0.08, 0.12, 0.006] }); return n; });
    return (f) => {
      const sq = 1 - 0.45 * f[CH.propB];
      bag.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      for (let i = 0; i < papers.length; i++) { const n = papers[i]; n.position.y = 0.16 - 0.14 * Math.min(1, f[CH.propA] * 3 - i); n.visible = n.position.y > 0.03; }
    };
  },
  /**
   * Grep: the open book propped on the desk (root at the desk under its spine) + a magnifier swept over it: propB sweep
   * (−1..1 across the pages), propC "found!" thrust (0 = lens on the page, 1 = up over the head). The activity reaches
   * the hand to `grepGrip(f)`.
   */
  grep(b, root, seed) {
    // [CHR fix r3] propped up (pages toward Clawd, cover to the room) instead of flat on the desk; see grepLens.
    const bookRoot = b.node(root, { p: [0, GREP_BOOK_H, 0], r: [GREP_TILT, Math.PI, 0], s: [GREP_TOME, GREP_TOME, GREP_TOME] });
    const upd = BUILD.book(b, bookRoot, seed);
    const mag = b.node(root, {});
    BUILD.magnifier(b, mag, seed);
    const fb = new Float32Array(CH.propB + 1); // the book's own channels: open, no page flip (propB is the lens sweep)
    return (f, t) => {
      // [CHR fix m3-r3] propA = lay (walk-up: the tome lies down, bottom edge on the desk); the book stays open
      const tilt = grepTilt(f);
      bookRoot.rotation.x = tilt; bookRoot.position.y = grepBookH(tilt);
      fb[CH.propA] = 1;
      upd?.(fb, t);
      const [x, y, z] = grepGrip(f);
      const [rx, ry, rz] = grepMagRot(f);
      mag.position.set(x, y, z);
      mag.rotation.set(rx, ry, rz);
    };
  },
  // ---- Shelly props (head frame of the CRT robot) ------------------------------------------------------------------
  /** Tiny cup of green drink with a straw, root at the grip. */
  drink({ part }, root) {
    part(root, 'cone', C.glass, { ...P, p: [0, -0.04, 0], s: [0.04, 0.09, 0.04], r: [Math.PI, 0, 0] });
    part(root, 'cyl', '#7FE3A0', { ...S, p: [0, -0.005, 0], s: [0.034, 0.012, 0.034] });
    part(root, 'limb', C.pink, { ...S, p: [0.01, 0.05, 0], s: limbScale(0.006, 0.06), r: [0, 0, -0.3] });
  },
  /** Knitting needles + a growing code scarf: propA scarf length (0..1), propB needle click phase. */
  knit({ part, node }, root) {
    const L = node(root, { p: [-0.05, 0, 0] }), R = node(root, { p: [0.05, 0, 0] });
    part(L, 'limb', C.steel, { ...P, p: [0, 0.07, 0], s: limbScale(0.008, 0.12), r: [0, 0, -0.5] });
    part(R, 'limb', C.steel, { ...P, p: [0, 0.07, 0], s: limbScale(0.008, 0.12), r: [0, 0, 0.5] });
    const scarf = node(root, { p: [0, 0, 0.01] });
    const rows: THREE.Object3D[] = [];
    for (let i = 0; i < 6; i++) rows.push(part(scarf, 'rbox', i % 2 ? C.yarn : '#5FB883', { ...S, p: [0, -0.02 - i * 0.03, 0], s: [0.09, 0.032, 0.02] }));
    const ball = node(root, { p: [0.12, -0.16, 0.05] });
    part(ball, 'sphere', C.yarn, { ...P, s: 0.045 });
    return (f) => {
      const n = Math.max(3, Math.round(1 + f[CH.propA] * 5)); // [CHR fix m15-r1] a scarf from the start (readable)
      for (let i = 0; i < rows.length; i++) rows[i].visible = i < n;
      const c = Math.sin(f[CH.propB] * TAU);
      L.rotation.z = 0.25 * c; R.rotation.z = -0.25 * c;
      ball.rotation.y = f[CH.propB] * 2;
    };
  },
  /** Hand-crank generator box on the bench, root at the box; propA crank angle. */
  crank({ part, node }, root) {
    part(root, 'rbox', C.red, { ...P, s: [0.16, 0.12, 0.12] });
    part(root, 'cyl', 'ink2', { ...S, p: [0, 0.07, 0], s: [0.03, 0.02, 0.03] });
    const arm = node(root, { p: [0.09, 0, 0] });
    part(arm, 'rbox', C.steel, { ...P, p: [0.01, 0.04, 0], s: [0.02, 0.1, 0.02] });
    part(arm, 'cyl', C.walnut, { ...P, p: [0.04, 0.085, 0], s: [0.018, 0.05, 0.018], r: [0, 0, Math.PI / 2] });
    return (f) => { arm.rotation.x = f[CH.propA]; };
  },
  /** Newspaper with tiny bar charts, root at the fold centre (facing +z = reader): propA open. */
  newspaper({ part, node }, root) {
    const pages = [-1, 1].map((side) => {
      const pg = node(root, {});
      part(pg, 'rbox', 'trim', { ...P, p: [side * 0.11, 0, 0], s: [0.22, 0.28, 0.006] });
      for (let i = 0; i < 3; i++) part(pg, 'rbox', 'ink2', { ...S, p: [side * 0.11 - 0.05 + i * 0.05, -0.08 + 0.02 * ((i * 7 + side) % 3), 0.006], s: [0.03, 0.05 + 0.04 * ((i * 5 + side + 3) % 3), 0.004] });
      part(pg, 'limb', 'ink', { ...S, p: [side * 0.11 - 0.07, 0.1, 0.006], s: [0.008, 0.07, 0.008], r: [0, 0, Math.PI / 2] });
      return pg;
    });
    return (f) => { const o = 0.25 + 0.75 * f[CH.propA]; pages[0].rotation.y = -(1 - o) * 1.3; pages[1].rotation.y = (1 - o) * 1.3; };
  },
  /** Walkie-talkie, root at the grip: propA antenna LED blink (0/1). */
  walkie({ part }, root) {
    part(root, 'rbox', 'ink2', { ...P, s: [0.06, 0.12, 0.035] });
    part(root, 'rbox', '#5A5650', { ...S, p: [0, -0.02, 0.018], s: [0.04, 0.05, 0.006] });
    part(root, 'limb', 'ink', { ...P, p: [0.018, 0.14, 0], s: limbScale(0.008, 0.09) });
    const led = part(root, 'glint', '#EF5A4C', { p: [0.018, 0.145, 0], s: 0.014, emissive: 1.4 });
    return (f) => { led.visible = f[CH.propA] > 0.5; };
  },
  /** Cocktail shaker, root at the middle. */
  shaker({ part }, root) {
    part(root, 'cyl', C.steel, { ...P, s: [0.04, 0.12, 0.04] });
    part(root, 'cone', C.steel, { ...P, p: [0, 0.06, 0], s: [0.038, 0.05, 0.038] });
    part(root, 'sphere', C.steel, { ...S, p: [0, 0.09, 0], s: 0.014 });
    part(root, 'cyl', '#7FE3A0', { ...S, p: [0, -0.02, 0], s: [0.042, 0.02, 0.042] });
  },
  /** Envelope in hand + a sorting rack in front: propA which slot the envelope flies to (0..1 = travel). */
  envelopes({ part, node }, root) {
    const rack = node(root, { p: [0, -0.06, 0.1] });
    part(rack, 'rbox', C.oak, { ...P, s: [0.26, 0.1, 0.1] });
    for (let i = 0; i < 3; i++) part(rack, 'rbox', 'trim', { ...S, p: [-0.08 + i * 0.08, 0.055, 0], s: [0.06, 0.04, 0.005] });
    const env = node(root, {});
    part(env, 'rbox', 'trim', { ...P, s: [0.1, 0.065, 0.006] });
    part(env, 'diamond', 'ink2', { ...S, p: [0, 0.012, 0.004], s: [0.1, 0.045, 0.01], r: [0, 0, Math.PI / 2] });
    return (f) => {
      const u = f[CH.propA], slot = Math.floor(f[CH.propB] * 2.999);
      env.position.set((-0.08 + slot * 0.08) * u, 0.06 * Math.sin(u * Math.PI) - 0.04 * u, 0.1 * u);
      env.rotation.set(-1.2 * u, 0, 0);
    };
  },
  /** Coal shovel, root at the top grip; the blade is 0.26 m down the shaft (−y). propA coal on the blade. */
  shovel({ part, node }, root) {
    part(root, 'limb', C.walnut, { ...P, s: limbScale(0.014, 0.24) });
    part(root, 'rbox', C.walnut, { ...S, s: [0.06, 0.02, 0.02] });
    const blade = node(root, { p: [0, -0.27, 0.02], r: [0.5, 0, 0] });
    part(blade, 'rbox', C.steel, { ...P, s: [0.1, 0.1, 0.012] });
    const coal = [0, 1].map((i) => part(blade, 'sphere', C.coal, { ...S, p: [-0.02 + i * 0.035, -0.01, 0.02], s: 0.022 }));
    return (f) => { for (let i = 0; i < coal.length; i++) coal[i].visible = f[CH.propA] > 0.5; };
  },
};

export const PROP_IDS = Object.freeze(Object.keys(BUILD));
export const CLAWD_PROPS = Object.freeze(['book', 'laptop', 'magnifier', 'pencil', 'clipboard', 'cards', 'phone', 'cable', 'flask', 'mug', 'stamp', 'dish', 'parcel', 'sign', 'wateringCan', 'paddle', 'brush', 'spyglass', 'yoyo', 'balls', 'folder', 'pawn', 'pack', 'grep', 'envelopes', 'note']);
export const SHELLY_PROPS = Object.freeze(['drink', 'knit', 'balls', 'crank', 'newspaper', 'walkie', 'shaker', 'envelopes', 'shovel']);

/**
 * @param propRoot body-frame node (Clawd: the shape node's origin; Shelly: the head)
 * @param scale geometry scale about each prop's root
 */
export function buildProps(propRoot: THREE.Object3D, parts: RigPart[], seed: number, ids: readonly string[] = CLAWD_PROPS, scale = 1): Record<string, Prop> {
  const b = makeBuilder(parts);
  const out: Record<string, Prop> = {};
  for (const id of ids) {
    const root = b.node(propRoot, { name: `prop:${id}` });
    root.visible = false;
    // [CHR fix m15-r1] `scale` sizes the prop's geometry about its root (grip), not its placement (Shelly: 1.6×).
    const inner = scale === 1 ? root : b.node(root, { s: scale });
    const update = BUILD[id](b, inner, seed) || undefined;
    out[id] = { root, update };
  }
  return out;
}
