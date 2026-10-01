/**
 * Small pure state machines for critter and pet behaviour (no three, no DOM), so the feel is testable:
 *  - Affection: how a pet answers being petted (a happy wiggle; pet it again quickly and it rolls over for belly
 *    rubs) and how its joy rises and settles.
 *  - Wariness: graze → freeze (alert) → bolt, for rabbits and squirrels, with sensible distances and a calm-down.
 *  - LookTilt: a dog tilts its head when you look straight at it, alternating sides, not constantly.
 */

export type PetReaction = 'happy' | 'rollover';

export class Affection {
  /** 0 calm … 1 overjoyed */
  joy = 0.3;
  private readonly times: number[] = [];
  private rollCool = 0;
  /** `need` pets within `window` seconds make a roll-over; joy settles to `base` */
  readonly window: number; readonly need: number; readonly base: number;
  constructor(window = 9, need = 3, base = 0.3) { this.window = window; this.need = need; this.base = base; this.joy = base; }

  pet(now: number): PetReaction {
    this.joy = Math.min(1, this.joy + 0.45);
    this.times.push(now);
    while (this.times.length && now - this.times[0] > this.window) this.times.shift();
    if (this.times.length >= this.need && this.rollCool <= 0) {
      this.times.length = 0;
      this.rollCool = 20;
      return 'rollover';
    }
    return 'happy';
  }

  /** a greeting, a game: joy up without counting as petting */
  cheer(k = 0.3): void { this.joy = Math.min(1, this.joy + k); }

  update(dt: number): void {
    this.rollCool = Math.max(0, this.rollCool - dt);
    // settles toward its baseline over ~20 s
    this.joy += (this.base - this.joy) * (1 - Math.exp(-dt / 20));
  }
}

export type Wary = 'calm' | 'alert' | 'bolt';

export interface WaryOpts {
  /** freeze when the player comes this close (m) */
  alertAt: number;
  /** bolt when closer than this, or when the player runs within alertAt */
  boltAt: number;
  /** player speed (m/s) that counts as a charge */
  charge: number;
}

export class Wariness {
  state: Wary = 'calm';
  /** seconds in the current state */
  t = 0;
  private freezeFor = 1;
  readonly o: WaryOpts;
  constructor(o: WaryOpts) { this.o = o; }

  /** advance with the player's distance and speed; `rnd` in 0..1 picks the freeze length. Returns the state. */
  step(dt: number, dist: number, playerSpeed: number, rnd: number): Wary {
    this.t += dt;
    const o = this.o;
    switch (this.state) {
      case 'calm':
        if (dist < o.boltAt || (dist < o.alertAt && playerSpeed > o.charge)) this.go('bolt');
        else if (dist < o.alertAt) { this.go('alert'); this.freezeFor = 0.7 + rnd * 1.6; }
        break;
      case 'alert':
        if (dist < o.boltAt || playerSpeed > o.charge || (this.t > this.freezeFor && dist < o.alertAt * 0.8)) this.go('bolt');
        else if (dist > o.alertAt * 1.25 && this.t > this.freezeFor) this.go('calm');
        break;
      case 'bolt':
        if (dist > o.alertAt * 1.8 && this.t > 1.5) this.go('calm');
        break;
    }
    return this.state;
  }

  private go(s: Wary): void { this.state = s; this.t = 0; }
}

/** Head tilt when looked at: returns a target tilt (rad) for this frame. */
export class LookTilt {
  private side = 1;
  private held = 0;
  private cool = 0;
  tilt = 0;
  update(dt: number, lookedAt: boolean): number {
    this.cool = Math.max(0, this.cool - dt);
    if (lookedAt) {
      this.held += dt;
      if (this.held > 0.5 && this.cool <= 0) {
        // a tilt lasts ~1.4 s, then the other way after a pause
        if (this.tilt === 0) this.tilt = 0.42 * this.side;
        if (this.held > 1.9) { this.tilt = 0; this.side = -this.side; this.held = 0.2; this.cool = 0.6; }
      }
    } else { this.held = 0; this.tilt = 0; }
    return this.tilt;
  }
}
