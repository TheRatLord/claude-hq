/**
 * Types shared by the FX modules: the specs callers hand to `fx.*`, the per-actor state record every pass reads and
 * writes (`FxState`, one hidden class: see `createFx`), the per-frame record (`FxFrame`) and the slice of an actor FX
 * reads. Types only (nothing here exists at runtime). Owner: FX.
 */
import type * as THREE from 'three';
import type { Entity, Struggle } from '../../../shared/protocol.ts';
import type { Tile } from './atlas.ts';
import type { PlacedItem } from './declutter.ts';

// ---- specs (the `fx.*` API, §5.4)
export type BubbleKind = 'speech' | 'thought' | 'alert';
export interface BubbleSpec {
  kind: BubbleKind;
  icon: string;
  title: string;
  detail?: string;
  priority: number;
  /** the spec this one was derived from (the '?' mark without its title) */
  src?: BubbleSpec;
}
export interface RingSpec { status: string; pulse: boolean }
export interface PlateSpec { name: string; tab: string; colorIndex: number }
export interface PlacardSpec { text: string; muted: boolean; deskAnchor: string | null }
/** A ✓ pennant handed to placards (`at` is read every frame from the actor state). */
export interface PennantSpec { text: string; colorIndex: number; at: PennantAt }
export interface PennantAt { x: number; z: number; floorY: number; top: number; phase: number; vis: boolean; yaw?: number }

/** Painted box of a bubble / chip tile (px): the quad maps the whole tile, `w` / `h` is the painted part. */
export interface BubbleLayout {
  w: number;
  h: number;
  bodyH: number;
  /** the "!" badge centre + radius in tile px (the hot sprite overlays it) */
  badge: { x: number; y: number; r: number } | null;
  /** the fitted title font, tile px */
  titlePx: number;
}
/** Painted box of a plate / flare tile (px). */
export interface BoxLayout { w: number; h: number }

/** Ambient signals derived from the entity each frame (rules.ambientOf). */
export interface AmbientFlags { rain: boolean; orbit: number; zzz: boolean; steam: boolean }
export interface FlareSpec { text: string; level: number }
export interface Vec3Like { x: number; y: number; z: number }

/** Inputs of the ✓ pennant lettering, memoised per actor. */
export interface PenKey {
  e: Partial<Entity> | null | undefined;
  title: Entity['title'] | undefined;
  base: Entity['baseTitle'] | undefined;
  prompt: Entity['lastPrompt'] | undefined;
  proc: Entity['process'] | undefined;
  todos: Entity['todos'] | undefined;
  text: string;
}

/**
 * EVERY per-actor field FX writes, declared once (see `createFx`'s `S0`): all states share one hidden class, so the hot
 * loops stay monomorphic.
 */
export interface FxState {
  id: string;
  ring: RingSpec | null;
  plate: PlateSpec | null;
  bubble: BubbleSpec | null;
  bubbleSpec: BubbleSpec | null;
  qSpec: BubbleSpec | null;
  glyph: string | null;
  dust: number;
  placardSpec: PlacardSpec | null;
  phase: number;
  x: number; y: number; z: number;
  floorY: number;
  top: number;
  bodyTop: number;
  headY: number;
  handTop: number;
  dist: number;
  depth: number;
  vis: boolean;
  fade: number;
  status: string;
  since: number;
  qPos: number;
  acked: boolean;
  hovered: boolean;
  selected: boolean;
  amb: AmbientFlags | null;
  mug: Vec3Like | null;
  nowT: number;
  // bubble
  bTile: Tile | null; bDrawn: BubbleSpec | null; bLayout: BubbleLayout | null; bPopKey: string; bPopT: number; bGoneT: number;
  bA: number; bW: number; bH: number; bS: number; bK: number; bWob: number; bDot: number;
  // compact alert chip
  cTile: Tile | null; cDrawn: BubbleSpec | null; cLayout: BubbleLayout | null; cWho: string | null;
  cW: number; cH: number; cS: number; cMinW: number;
  // plate + glyph
  pTile: Tile | null; pDrawn: PlateSpec | null; pLayout: BoxLayout | null; pA: number; pW: number; pH: number;
  gA: number; gPx: number;
  // label pass
  hasB: boolean; hasP: boolean; hasG: boolean; lMode: number; pMode: number; gMode: number; lChip: boolean; lTether: boolean; rank: number;
  ax: number; ay: number; hx: number; hy: number;
  lP: PlacedItem | null; lB: PlacedItem | null; lG: PlacedItem | null;
  occ: boolean;
  occT: number;
  bubbleTopX: number; bubbleTopY: number; bubbleTopZ: number; bubbleTopPx: number;
  name: string; pName: string; bWho: string; lEdge: boolean;
  // struggle flare
  flare: FlareSpec | null; fSrc: Struggle | null; fTile: Tile | null; fDrawn: FlareSpec | null; fLayout: BoxLayout | null;
  fW: number; fH: number; fA: number; hasF: boolean; fMode: number; lF: PlacedItem | null; fAcc: number;
  // ambient accumulators + the ✓ pennant
  rainAcc: number; zAcc: number; sAcc: number; dAcc: number;
  pen: PennantSpec | null; penAt: PennantAt | null; penKey: PenKey | null;
}

/** Per-frame camera / viewport record shared by every pass (rewritten by `createFx`'s update). */
export interface FxFrame {
  t: number;
  dt: number;
  now: number;
  camera: THREE.PerspectiveCamera;
  /** camera right / up / forward (world, unit) */
  R: THREE.Vector3;
  U: THREE.Vector3;
  F: THREE.Vector3;
  fovK: number;
  vw: number;
  vh: number;
}

/** The slice of a character actor FX reads (chars/actors owns the real type). */
export interface FxActor {
  pos: { x: number; y: number; z: number };
  mode?: string;
  entity?: Partial<Entity> | null;
  lift?: number;
  yaw?: number;
  visible?: boolean;
  intent?: { slot?: { tag?: string; id?: string | number } | null; phase?: string; face?: string | null } | null;
  rig?: {
    species?: string;
    crown?: number;
    nodes?: { shape?: THREE.Object3D };
    arms?: { hand: THREE.Object3D }[];
  } | null;
}
export interface FxActors { get(id: string): FxActor | null | undefined }

/** A UV rect (into a reused record). */
export interface UvRect { u0: number; v0: number; u1: number; v1: number }
