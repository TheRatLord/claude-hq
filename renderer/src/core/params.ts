// @pure
/**
 * Renderer URL params (§2.2). Parsed once at boot; the token `t` is stripped from the location by net/socket.ts.
 * Owner: CORE.
 */

const TIERS = ['low', 'medium', 'high', 'photo'] as const;

export type ParamTier = (typeof TIERS)[number];
const isTier = (v: string | null): v is ParamTier => TIERS.some((t) => t === v);

export interface Params {
  /** `t` */
  token: string | null;
  /** `pose=name` */
  pose: string | null;
  /** `hour=13.5` */
  hour: number | null;
  quality: ParamTier | null;
  /** null = main picks (hq, or proto for a proto pose) [LVL M1.5: hq is the default] */
  layout: 'proto' | 'hq' | null;
  nohud: boolean;
  silhouette: boolean;
  seed: string | null;
  timescale: number | null;
  noaudio: boolean;
  season: string | null;
  /** 'hero' | 'props' | 'ui' */
  sheet: string | null;
  greybox: boolean;
  /** name | paneId */
  open: string | null;
  /** 55–75, default 60 */
  fov: number;
  /**
   * Read by ui/index.ts (`params.nominimap`, `params.nohotbar`) but never set by `parseParams`: both stay `undefined`, so
   * `?nominimap` / `?nohotbar` do nothing today. Declared so those reads type-check with unchanged behaviour; wire them
   * in `parseParams` (`flag('nominimap')`) or delete the reads.
   */
  nominimap?: boolean;
  nohotbar?: boolean;
}

/** @param search location.search */
export function parseParams(search: string): Params {
  const q = new URLSearchParams(search);
  const num = (k: string): number | null => (q.has(k) && q.get(k) !== '' && Number.isFinite(+(q.get(k) ?? '')) ? +(q.get(k) ?? '') : null);
  const flag = (k: string): boolean => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  const quality = q.get('quality');
  const fov = num('fov');
  return {
    token: q.get('t'),
    pose: q.get('pose'),
    hour: num('hour'),
    quality: isTier(quality) ? quality : null,
    layout: q.get('layout') === 'hq' ? 'hq' : q.get('layout') === 'proto' ? 'proto' : null, // [LVL M1.5] was: default 'proto'
    nohud: flag('nohud'),
    silhouette: flag('silhouette'),
    seed: q.get('seed'),
    timescale: num('timescale'),
    noaudio: flag('noaudio'),
    season: q.get('season'),
    sheet: q.get('sheet'),
    greybox: flag('greybox'),
    open: q.get('open'),
    fov: fov === null ? 60 : Math.min(75, Math.max(55, fov)),
  };
}
