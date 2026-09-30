// @pure
/**
 * Animation clock with configurable scale, freezing, and a pinned hour.
 * `time` is scaled animation seconds; `dt` is clamped to 0.1 s.
 */

export interface AnimClock {
  /** scaled seconds since boot */
  time: number;
  /** scaled seconds of the last tick */
  dt: number;
  /** unscaled wall seconds of the last tick (clamped 0.25) */
  rawDt: number;
  scale: number;
  frozen: boolean;
  hourPin: number | null;
  tick(wallMs: number): void;
  setScale(k: number): void;
  freeze(b: boolean): void;
  /** `undefined` / non-finite also unpin (URL / debug input) */
  setHour(h: number | null | undefined): void;
  /** pinned hour, else local wall-clock hour (fractional) */
  hour(): number;
}

export function createClock({ scale = 1, hour = null }: { scale?: number; hour?: number | null } = {}): AnimClock {
  let last: number | null = null;
  const c: AnimClock = {
    time: 0, dt: 0, rawDt: 0, scale, frozen: false, hourPin: hour,
    tick(wallMs) {
      const raw = last === null ? 1 / 60 : Math.min(0.25, Math.max(0, (wallMs - last) / 1000));
      last = wallMs;
      c.rawDt = raw;
      c.dt = c.frozen ? 0 : Math.min(0.1, raw * c.scale);
      c.time += c.dt;
    },
    setScale(k) { c.scale = Number.isFinite(k) && k >= 0 ? k : 1; },
    freeze(b) { c.frozen = !!b; },
    setHour(h) { c.hourPin = h === null || h === undefined || !Number.isFinite(+h) ? null : ((+h % 24) + 24) % 24; },
    hour() {
      if (c.hourPin !== null) return c.hourPin;
      const d = new Date();
      return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    },
  };
  return c;
}
