/**
 * Injectable clock. EVERY server timer and timestamp goes through a clock; this is the only file allowed
 * to call Date.now()/setTimeout/setInterval directly. Owner: BE (M0.5 version written by BE2; complete as specified).
 */

import type { Clock, TimerHandle } from './interfaces.ts';

/**
 * Wall clock, optionally time-scaled: now = t0 + K·(wall − t0), timers ÷ K. `--timescale` only with --demo/--replay.
 */
export function RealClock(scale = 1): Clock {
  const k = scale > 0 ? scale : 1;
  const t0 = Date.now();
  const now = k === 1 ? () => Date.now() : () => Math.round(t0 + k * (Date.now() - t0));
  return {
    now,
    timescale: k,
    setTimeout: (fn, ms, ...args) => setTimeout(fn, Math.max(0, ms ?? 0) / k, ...args),
    clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout | undefined),
    setInterval: (fn, ms, ...args) => setInterval(fn, Math.max(1, (ms ?? 0) / k), ...args),
    clearInterval: (h) => clearInterval(h as NodeJS.Timeout | undefined),
  };
}

/**
 * Deterministic clock for tests: nothing fires until `advance(ms)`, which fires due timers in time order.
 */
interface FakeTimer {
  at: number;
  /** the callback with its args already bound */
  fn: () => void;
  every: number | null;
  seq: number;
}

export class FakeClock implements Clock {
  _now: number;
  _seq: number;
  _timers: Map<number, FakeTimer>;
  timescale: number;
  now: () => number;
  setTimeout: Clock['setTimeout'];
  setInterval: Clock['setInterval'];
  clearTimeout: Clock['clearTimeout'];
  clearInterval: Clock['clearInterval'];
  /** @param start ms epoch */
  constructor(start = 1_727_400_000_000) {
    this._now = start;
    this._seq = 0;
    this._timers = new Map();
    this.timescale = 1;
    this.now = () => this._now;
    this.setTimeout = (fn, ms = 0, ...args) => this._add(fn, ms, args, null);
    this.setInterval = (fn, ms = 0, ...args) => this._add(fn, ms, args, Math.max(1, ms));
    this.clearTimeout = (h) => void this._timers.delete(h as number);
    this.clearInterval = this.clearTimeout;
  }
  _add<A extends unknown[]>(fn: (...args: A) => void, ms: number, args: A, every: number | null): TimerHandle {
    const id = ++this._seq;
    this._timers.set(id, { at: this._now + Math.max(0, ms), fn: () => fn(...args), every, seq: id });
    return id;
  }
  /** Number of pending timers. */
  get pending(): number {
    return this._timers.size;
  }
  /** Advance time, firing due timers in order (timers scheduled while advancing also fire if due). @param ms */
  advance(ms: number): void {
    const end = this._now + ms;
    for (;;) {
      let next: FakeTimer | null = null, nextId = 0;
      for (const [id, t] of this._timers) {
        if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq))) {
          next = t;
          nextId = id;
        }
      }
      if (!next) break;
      this._now = Math.max(this._now, next.at);
      if (next.every) {
        next.at += next.every;
        next.seq = ++this._seq;
      } else this._timers.delete(nextId);
      next.fn();
    }
    this._now = end;
  }
}
