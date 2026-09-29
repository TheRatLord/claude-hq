/**
 * Stats object registry (§5.4 seam). Each stats module calls `registerStat(anchorId, factory)` at import time; the
 * stats world (`stats/index.ts`) instantiates every registered factory at the layout's matching `statAnchors` entry.
 * Owner: STAT.
 */

import type * as THREE from 'three';
import type { Stats } from '../../../../shared/protocol.ts';
import type { Ctx } from '../../core/ctx.ts';
import type { StatAnchor } from '../layout/schema.ts';

export interface StatTooltip {
  title: string;
  value: string;
  /** ≤ 300 samples (5 min at 1 Hz), oldest first */
  spark: number[];
  /** where the number comes from (`/proc/stat`, `statfs /`, …) */
  source: string;
  /** sparkline unit hint ('%', 'GB', '°C', 'B/s') */
  unit?: string;
  /** sparkline y max (default: series max) */
  max?: number;
  /** past its critical threshold: the value draws red */
  crit?: boolean;
  /** sparkline colour (default clay-gold) */
  color?: string;
}

export interface StatObject {
  object3d: THREE.Object3D;
  update: (stats: Stats | null, dt: number, ctx: Ctx) => void;
  tooltip: () => StatTooltip;
  /** aim volumes (world); default = the object3d's world bounding box */
  hitBoxes?: THREE.Box3[];
  /** never aimable (weather) */
  noTooltip?: boolean;
  /** animate even when the camera is far (big, globally visible objects) */
  always?: boolean;
  /** canvas uploads so far (debug stats) */
  redraws?: () => number;
  dispose?: () => void;
}

/** A layout stat anchor plus the vis cell it stands in. */
export type StatAnchorCell = StatAnchor & { cell: string | null };
export type StatFactory = (ctx: Ctx, anchor: StatAnchorCell) => StatObject | StatObject[] | null;

const factories = new Map<string, StatFactory>();

export function registerStat(anchorId: string, factory: StatFactory): void {
  factories.set(anchorId, factory);
}

export const statFactory = (anchorId: string): StatFactory | undefined => factories.get(anchorId);

/** Registered anchor ids (debug). */
export const registeredStats = () => [...factories.keys()];
