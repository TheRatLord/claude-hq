// @pure
/**
 * Pose = a flat Float32Array of named channels + a few discrete fields. Layers (locomotion → action → reaction) each
 * fill a Pose; `blendInto` mixes them per joint group (mask) and weight. Additive motion (breath, springs, look-at,
 * blink) is applied by the animator afterwards. Values are absolute (arms rest at ARM_REST), not offsets. Owner: CHR.
 */

const NAMES = [
  // hips / body (group BODY)
  'hipY', 'hipX', 'hipZ', 'pitch', 'roll', 'twist', 'sq', 'grow',
  // arms (ARM_L / ARM_R): pitch (+ forward), raise (+ out/up from hanging), bend (elbow, + forward), len (noodle ×), twist,
  // curl ([CHR fix m15-r2] total noodle curve along the forearm in the raise plane, rad; + = the tip curls further along the raise, i.e. up and in over the head for a raised arm)
  'aLp', 'aLr', 'aLb', 'aLs', 'aLt', 'aLc',
  'aRp', 'aRr', 'aRb', 'aRs', 'aRt', 'aRc',
  // legs (LEGS): per leg lift (m) + swing (rad, + forward). 0 FL, 1 FR, 2 BL, 3 BR
  'l0y', 'l0s', 'l1y', 'l1s', 'l2y', 'l2s', 'l3y', 'l3s',
  // face (FACE): look offset (−1..1), eye scale, eye y-scale, flat-top lid (0..1), brow angle (+ = inner up / worried),
  // brow visibility, blush, mouth scale, eye spin (dizzy)
  'lookX', 'lookY', 'eyeS', 'eyeSY', 'lid', 'browA', 'browOn', 'blush', 'mouthS', 'eyeSpin',
  // prop (PROP): generic prop parameters (book open angle, page flip, …) + the held prop's placement in the body
  // ("shape") frame: position (m) and Euler XYZ (rad). Blendable, so a prop glides between hands/poses.
  'propA', 'propB', 'propC', 'propX', 'propY', 'propZ', 'propRx', 'propRy', 'propRz',
  // [CHR M3.5] arrival crate (BODY group; rig node on the root, so it stays on the floor while the body hops):
  // shown (0..1 scale), walls fall open (0..1), lid flaps open (0..1), shake (rad)
  'crate', 'crateO', 'crateLid', 'crateShake',
] as const;

export type ChName = (typeof NAMES)[number];

/** Channel index by name. */
// Object.fromEntries widens the keys to string; NAMES is the exact key set.
export const CH = Object.freeze(Object.fromEntries(NAMES.map((n, i) => [n, i]))) as Readonly<Record<ChName, number>>;
export const N_CH = NAMES.length;
export const CH_NAMES = Object.freeze(NAMES);

/** Joint-group mask bits. */
export const M = Object.freeze({ BODY: 1, ARM_L: 2, ARM_R: 4, LEGS: 8, FACE: 16, PROP: 32, ARMS: 6 });
export const MASK_ALL = 63;
export const MASK_ARMS = M.ARM_L | M.ARM_R;

const GROUP = new Uint8Array(N_CH);
for (let i = 0; i < N_CH; i++) {
  const n = NAMES[i];
  GROUP[i] = n.startsWith('aL') ? M.ARM_L : n.startsWith('aR') ? M.ARM_R : /^l\d/.test(n) ? M.LEGS
    : i >= CH.lookX && i <= CH.eyeSpin ? M.FACE : n.startsWith('prop') ? M.PROP : M.BODY;
}
export const groupOf = (i: number): number => GROUP[i];

/** Resting arm raise: the mascot's side nubs stick out, a little below horizontal. */
export const ARM_REST = 1.15;

const REST = new Float32Array(N_CH);
REST[CH.aLr] = ARM_REST; REST[CH.aRr] = ARM_REST;
REST[CH.aLs] = 1; REST[CH.aRs] = 1;
REST[CH.grow] = 1; REST[CH.eyeS] = 1; REST[CH.eyeSY] = 1; REST[CH.mouthS] = 1;

export interface Pose {
  f: Float32Array;
  /** discrete eye-shape override ('slot'|'arc'|'heart'|'star'|'swirl'|'closed'|null) */
  eye: string | null;
  /** discrete mouth override */
  mouth: string | null;
  /** expression id requested by this layer (null = keep) */
  face: string | null;
  /** held prop id (null = none) */
  prop: string | null;
}

export function createPose(): Pose {
  return { f: new Float32Array(REST), eye: null, mouth: null, face: null, prop: null };
}
export function resetPose(p: Pose): Pose {
  p.f.set(REST); p.eye = null; p.mouth = null; p.face = null; p.prop = null;
  return p;
}
export function copyPose(dst: Pose, src: Pose): Pose {
  dst.f.set(src.f); dst.eye = src.eye; dst.mouth = src.mouth; dst.face = src.face; dst.prop = src.prop;
  return dst;
}

/**
 * Blend `src` over `dst` with weight w, restricted to `mask` groups. Discrete fields take the source when its
 * effective weight ≥ 0.5 and it sets them.
 */
export function blendInto(dst: Pose, src: Pose, w: number, mask: number): Pose {
  if (w <= 0) return dst;
  const a = dst.f, b = src.f;
  for (let i = 0; i < N_CH; i++) if (mask & GROUP[i]) a[i] += (b[i] - a[i]) * w;
  if (w >= 0.5) {
    if (mask & M.FACE) { if (src.eye) dst.eye = src.eye; if (src.mouth) dst.mouth = src.mouth; if (src.face) dst.face = src.face; }
    if ((mask & M.PROP) && src.prop !== undefined) dst.prop = src.prop;
  }
  return dst;
}

/** Volume-preserving squash scales: [xz, y] for squash value s = 1 + sq. */
export const squashScale = (sq: number): [number, number] => { const s = Math.max(0.3, 1 + sq); return [1 / Math.sqrt(s), s]; };
