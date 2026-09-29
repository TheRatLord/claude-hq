// @pure
/**
 * Activity registry (DESIGN §6.3). Each activity is `{id, mask, sit, face, prop?, smear?, twos?, update(t, pose, a)}`;
 * `t` is the activity's own clock (s, energy/tempo-scaled), `a` = {amp, seed, energy, dt}. `smear` asks charBatch for
 * stop-motion smears on fast parts; `twos` holds the layer's key poses on twos (true = always, or [[t0, t1], …]
 * windows). Unknown ids fall back to `sitIdle` (sitting ids) or `standIdle`. Owner: CHR.
 */
import * as desk from './desk.ts';
import * as blocked from './blocked.ts';
import * as idle from './idle.ts';
import * as stations from './stations.ts';
import * as walking from './walking.ts';
import * as shelly from './shelly.ts';
import { FIDGET_ACTS } from './fidgets.ts';
import type { Pose } from '../pose.ts';

/** What the animator hands an activity or reaction each frame (the optional fields are Clawd-only). */
export interface ActivityArgs {
  amp: number;
  seed: number;
  energy: number;
  dt: number;
  variant?: number;
  /** crown height of the rig (shape frame): head-clearing poses reach above it */
  crown?: number;
  seated?: boolean;
  /** 0..1 nearness to the player (placards) */
  near?: number;
  close?: number;
  /** shared swing clock (0..1) or null */
  sync?: number | null;
  /** signed body yaw to the viewer (rad) and distance (m) */
  viewRel?: number;
  viewD?: number;
  /** 0..1 chair swivel-out */
  swivel?: number;
}

export interface Activity {
  id: string;
  /** pose groups this activity drives (pose.ts M) */
  mask: number;
  /** seated (the animator plays the hop onto / off the seat) */
  sit: boolean;
  /** default expression */
  face: string | null;
  prop?: string | null;
  smear?: boolean;
  /** the action layer clears whatever the previous activity held (blocked waves) */
  clearProps?: boolean;
  twos?: boolean | number[][];
  /** written in Shelly's own frame (head-mounted arms), not remapped */
  shelly?: boolean;
  /** `t` is the activity's own clock (s, energy/tempo-scaled) */
  update: (t: number, p: Pose, a: ActivityArgs) => void;
}

const isAct = (v: unknown): v is Activity =>
  typeof v === 'object' && v !== null && 'update' in v && typeof v.update === 'function' && 'id' in v && typeof v.id === 'string';
const collect = (...mods: Record<string, unknown>[]): Record<string, Activity> => {
  const out: Record<string, Activity> = {};
  for (const m of mods) for (const v of Object.values(m)) if (isAct(v)) out[v.id] = v;
  return out;
};

export const ACTIVITIES: Readonly<Record<string, Activity>> = Object.freeze({
  ...collect(desk, blocked, idle, stations, walking, shelly),
  ...Object.fromEntries(Object.entries(FIDGET_ACTS).map(([k, v]) => [`fidget:${k}`, v])),
});

export function activity(id: string | null): Activity | null {
  if (!id) return null;
  if (ACTIVITIES[id]) return ACTIVITIES[id];
  if (/^fidget:|^sit/.test(id)) return ACTIVITIES.sitIdle;
  return ACTIVITIES.standIdle;
}

/** The DESIGN §6.3 vocabulary (M2), grouped (tests assert every id exists; the hero sheet shows them all). */
export const VOCAB = Object.freeze({
  desk: ['type', 'typeFrenzy', 'pencilEdit', 'readBook', 'grepMagnify', 'globCards', 'think', 'bashPound', 'bashWatch', 'dishWeb',
    'delegate', 'clipboard', 'phoneMcp', 'cableMcp', 'compactBackpack', 'ask', 'stampEnvelope'],
  stations: ['libraryRead', 'ladder', 'labPour', 'mailSort', 'whiteboard', 'telescope', 'radio', 'roundTable'],
  walking: ['walkRead', 'walkType', 'walkMagnify', 'walkClipboard', 'walkPhone', 'walkFlask'],
  blocked: ['waveBlocked', 'queueWait', 'serveStepUp', 'pointTicket', 'queueHandUp'],
  idle: ['lounge', 'sleepDesk', 'sleepBunk', 'sleepwalk', 'sitIdle', 'coffee', 'windowGaze', 'arcade', 'pingpong', 'foosball',
    'waterPlants', 'petCat', 'fishStare', 'confused', 'holdSign', 'piano', 'treadmill', 'waterGreenhouse', 'boardGame', 'paint',
    'hammock', 'telescopeGaze', 'slideRide', 'hotDeskDoodle', 'microfiche', 'fileNook', 'vaultNap', 'parcelCarry', 'standLounge',
    'standWork', 'standIdle'],
  fidgets: ['stretch', 'hopInPlace', 'lookAround', 'danceShimmy', 'yoyo', 'jugglePebbles', 'spin', 'polishAccessory'].map((n) => `fidget:${n}`),
  shelly: ['cursorTap', 'knit', 'juggle', 'crank', 'newspaper', 'walkie', 'cocktail', 'sortEnvelopes', 'shovel', 'spinnerWatch'],
  reactions: ['startle', 'victory', 'dizzy', 'fistPump', 'slump', 'clap', 'arrive', 'leave', 'bump', 'pat', 'wave', 'busyFinger',
    'highFive', 'hop', 'bow', 'wake', 'sneeze', 'unblock', 'thankYou', 'workCall', 'exhale', 'dissolveIn',
    // [CHR M3.5] walk-up-and-manage reactions (BRN fires them; see reactions.ts)
    'glanceBack', 'lookBackWave', 'catchPlane', 'readNote', 'patted', 'summoned', 'summonBusy', 'crateUnwrap', 'cheer'],
});

