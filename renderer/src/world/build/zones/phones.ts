/**
 * Plaza phone booths (§7.1 PLZ mcp station, "Phone booths · 3"): the three hooded booths with their PHONE lightboxes
 * on the Plaza's south wall. Only the booths: the rest of the Plaza (signpost, bench, planter, street lamp) belongs
 * to the Plaza dresser / greybox; index.ts asks greybox to skip `phoneBooth` items (`envSkip.types`). Owner: ENV.
 */
import { poseOf } from './common.ts';
import type { DressKit } from './common.ts';
import type { HqLayout } from '../../layout/schema.ts';

const BOOTH_COLS = ['#4E6E6E', '#56727A', '#4E6E6E'];

export function dressPhones(layout: HqLayout, k: DressKit) {
  let i = 0;
  for (const f of layout.furniture) {
    if (f.type !== 'phoneBooth') continue;
    const [w, h, d] = f.size;
    k.put('phoneBooth', { w, h, d, colors: { body: BOOTH_COLS[i++ % BOOTH_COLS.length] } }, poseOf(f), f.id, 0.2);
  }
}
