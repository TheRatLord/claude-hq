/**
 * Looping beds. Each loop is a small persistent graph (noise through filters, a few oscillators) plus generative
 * events scheduled ahead in `tick` (bird phrases, cricket chirps, fire crackles, river babble, creaks). `out` is the
 * loop's level; the ambience manager / `loop()` handles route it to a bus, positional or not.
 */
import { CRITTER_RECIPES, SFX_RECIPES } from './sfx.ts';
import type { NoiseKind } from './synth.ts';
import { noise, noiseSrc, tone } from './synth.ts';
import { cricketPeriod } from './mix.ts';

export const LOOP_KINDS = Object.freeze(['fire', 'river', 'waterfall', 'windmill', 'bees', 'rain', 'crickets', 'birds', 'wind', 'pond', 'owls', 'frogs'] as const);
export type LoopKind = (typeof LOOP_KINDS)[number];

export interface LoopEnv {
  /** 0..1 CPU (windmill speed) */
  cpu(): number;
  /** °C for the cricket thermometer */
  tempC(): number | null;
  /** optional reverb send */
  send: AudioNode | null;
}
export interface LoopVoice {
  out: GainNode;
  /** schedule generative events in [now, now + horizon); `level` 0..1 scales density */
  tick(now: number, horizon: number, level: number): void;
  stop(): void;
}

type C = BaseAudioContext;
const rnd = Math.random;

export function buildLoop(kind: LoopKind, c: C, env: LoopEnv): LoopVoice {
  const out = c.createGain();
  out.gain.value = 0;
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [out];
  const bed = (k: NoiseKind, type: BiquadFilterType, f: number, q: number, gain: number, dest: AudioNode = out) => {
    const src = noiseSrc(c, k, c.currentTime);
    const filt = c.createBiquadFilter();
    filt.type = type; filt.frequency.value = f; filt.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(filt).connect(g).connect(dest);
    sources.push(src); nodes.push(filt, g);
    return { src, filt, g };
  };
  const panner = (pan: number, sendAmt = 0) => {
    const p = c.createStereoPanner(); p.pan.value = pan; p.connect(out); nodes.push(p);
    if (env.send && sendAmt > 0) { const s = c.createGain(); s.gain.value = sendAmt; p.connect(s).connect(env.send); nodes.push(s); }
    return p;
  };
  let next = 0, next2 = 0, lastMod = -1;
  /** shared scheduling loop: runs `fire(at)` for each due event, `gap()` seconds apart */
  const every = (now: number, horizon: number, level: number, gap: () => number, fire: (at: number) => void) => {
    if (level < 0.02) { next = now + 0.5; return; }
    if (next < now) next = now + 0.05 + rnd() * 0.3;
    while (next < now + horizon) { fire(next); next += Math.max(0.02, gap()); }
  };
  const mod = (now: number) => { if (now - lastMod < 0.12) return false; lastMod = now; return true; };
  let tick: LoopVoice['tick'] = () => {};

  switch (kind) {
    case 'wind': {
      const body = bed('pink', 'bandpass', 450, 0.6, 0.55);
      const whistle = bed('white', 'bandpass', 1300, 9, 0);
      tick = (now) => {
        if (!mod(now)) return;
        const g = 0.5 + 0.28 * Math.sin(now * 0.21) + 0.17 * Math.sin(now * 0.57 + 1.3) + 0.1 * Math.sin(now * 1.63 + 0.4);
        body.filt.frequency.setTargetAtTime(260 + 620 * g, now, 0.6);
        body.g.gain.setTargetAtTime(0.3 + 0.55 * g, now, 0.5);
        whistle.g.gain.setTargetAtTime(0.35 * Math.max(0, g - 0.62), now, 0.8);
        whistle.filt.frequency.setTargetAtTime(1100 + 500 * g, now, 0.8);
      };
      break;
    }
    case 'rain': {
      bed('pink', 'bandpass', 2600, 0.35, 0.55);
      bed('brown', 'lowpass', 260, 0.7, 0.4);
      tick = (now, horizon, level) => every(now, horizon, level, () => (0.35 - 0.3 * level) * (0.3 + rnd()), (at) => {
        const f = 1800 + rnd() * 2800;
        tone(c, out, at, { f, f2: f * 0.75, glide: 0.03, gain: 0.03 + rnd() * 0.05, a: 0.001, d: 0.03 });
        if (rnd() < 0.25) noise(c, out, at, { kind: 'white', gain: 0.08 * rnd(), a: 0.001, d: 0.02, filter: 'highpass', f: 3000 });
      });
      break;
    }
    case 'river': {
      bed('brown', 'lowpass', 800, 0.7, 0.5);
      const mid = bed('pink', 'bandpass', 560, 0.7, 0.3);
      const bab = c.createGain(); bab.gain.value = 1; bab.connect(out); nodes.push(bab);
      tick = (now, horizon, level) => {
        if (mod(now)) {
          mid.filt.frequency.setTargetAtTime(480 + 180 * Math.sin(now * 0.7) + 90 * Math.sin(now * 2.3), now, 0.3);
          mid.g.gain.setTargetAtTime(0.26 + 0.08 * Math.sin(now * 1.1 + 2), now, 0.3);
        }
        every(now, horizon, level, () => 0.06 + rnd() * 0.12, (at) => {
          const f = 280 + rnd() * 700;
          tone(c, bab, at, { f, f2: f * (1.5 + rnd() * 0.8), glide: 0.04 + rnd() * 0.03, gain: 0.025 + rnd() * 0.035, a: 0.003, d: 0.05 });
        });
      };
      break;
    }
    case 'waterfall': {
      bed('pink', 'lowpass', 2400, 0.5, 0.4);
      bed('brown', 'lowpass', 220, 0.7, 0.45);
      bed('white', 'highpass', 5000, 0.5, 0.05);
      break;
    }
    case 'pond': {
      const lap = bed('brown', 'bandpass', 380, 0.8, 0);
      tick = (now, horizon, level) => {
        if (level < 0.02) return;
        if (next < now) next = now + rnd();
        while (next < now + horizon) {
          const p = lap.g.gain, peak = 0.5 + rnd() * 0.5;
          p.setTargetAtTime(peak, next, 0.25);
          p.setTargetAtTime(0.08, next + 0.7, 0.5);
          if (rnd() < 0.2) CRITTER_RECIPES.plop(c, out, next + 0.5 + rnd(), { pitch: 0.8 + rnd() * 0.5, rnd });
          next += 2 + rnd() * 2.2;
        }
      };
      break;
    }
    case 'fire': {
      const roar = bed('brown', 'lowpass', 380, 0.7, 0.55);
      tick = (now, horizon, level) => {
        if (mod(now)) roar.g.gain.setTargetAtTime(0.4 + 0.2 * Math.sin(now * 3.1) * Math.sin(now * 1.3), now, 0.2);
        every(now, horizon, level, () => 0.02 + rnd() * rnd() * 0.25, (at) => {
          if (rnd() < 0.06) {
            tone(c, out, at, { f: 250 + rnd() * 300, f2: 120, gain: 0.12, a: 0.001, d: 0.04 });
            noise(c, out, at, { kind: 'white', gain: 0.3, a: 0.001, d: 0.03, filter: 'bandpass', f: 1800, q: 0.8 });
          } else {
            noise(c, out, at, { kind: 'white', gain: 0.06 + rnd() * rnd() * 0.3, a: 0.0005, d: 0.004 + rnd() * 0.012, filter: 'bandpass', f: 2000 + rnd() * 4500, q: 1.2 });
          }
        });
      };
      break;
    }
    case 'windmill': {
      const whoosh = bed('pink', 'bandpass', 260, 0.6, 0.05);
      tick = (now, horizon, level) => {
        const period = 4.2 - 3.2 * Math.max(0, Math.min(1, env.cpu()));
        if (level < 0.02) { next = now + 0.5; next2 = now + 0.5; return; }
        if (next < now) next = now + rnd();
        while (next < now + horizon) {
          SFX_RECIPES.creak(c, out, next, { pitch: 0.8 + rnd() * 0.45, rnd });
          next += period * (0.85 + rnd() * 0.3);
        }
        if (next2 < now) next2 = now;
        while (next2 < now + horizon) {
          const p = whoosh.g.gain;
          p.setTargetAtTime(0.5, next2, period / 16);
          p.setTargetAtTime(0.06, next2 + period / 8, period / 12);
          next2 += period / 4;
        }
      };
      break;
    }
    case 'bees': {
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 750; f.Q.value = 1.1;
      const g = c.createGain(); g.gain.value = 0.16;
      f.connect(g).connect(out); nodes.push(f, g);
      const oscs: OscillatorNode[] = [];
      for (const hz of [218, 223.5, 231, 244]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.connect(f); o.start(); sources.push(o); oscs.push(o);
      }
      tick = (now) => {
        if (now - lastMod < 0.4) return;
        lastMod = now;
        oscs.forEach((o, i) => o.frequency.setTargetAtTime([218, 223.5, 231, 244][i] * (0.94 + rnd() * 0.12), now, 0.35));
        g.gain.setTargetAtTime(0.1 + rnd() * 0.1, now, 0.4);
      };
      break;
    }
    case 'crickets': {
      const n = 4;
      const gs: GainNode[] = [], nx = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const o = c.createOscillator(); o.frequency.value = 4300 + i * 170 + rnd() * 80;
        const g = c.createGain(); g.gain.value = 0;
        o.connect(g).connect(panner(-0.75 + (1.5 * i) / (n - 1)));
        o.start(); sources.push(o); nodes.push(g); gs.push(g);
      }
      tick = (now, horizon, level) => {
        const active = Math.ceil(level * n);
        const period = cricketPeriod(env.tempC());
        for (let i = 0; i < n; i++) {
          if (i >= active) { nx[i] = now + rnd(); continue; }
          if (nx[i] < now) nx[i] = now + rnd() * period;
          while (nx[i] < now + horizon) {
            const p = gs[i].gain, amp = 0.05 * (0.6 + 0.4 * rnd());
            for (let k = 0; k < 3; k++) {
              const s = nx[i] + k * 0.042;
              p.setValueAtTime(0, s); p.linearRampToValueAtTime(amp, s + 0.005); p.setValueAtTime(amp, s + 0.016); p.linearRampToValueAtTime(0, s + 0.022);
            }
            nx[i] += period * (0.92 + rnd() * 0.16) * (1 + i * 0.07);
          }
        }
      };
      break;
    }
    case 'birds': {
      const ps = [panner(-0.7, 0.35), panner(0.05, 0.35), panner(0.65, 0.35)];
      tick = (now, horizon, level) => every(now, horizon, level, () => (2.2 - 1.8 * level) * (0.4 + rnd() * 1.2), (at) => {
        const dst = ps[Math.floor(rnd() * ps.length)];
        const g = (0.04 + rnd() * 0.07);
        const sp = rnd();
        if (sp < 0.3) { // warbler trill
          const n = 6 + Math.floor(rnd() * 5), f0 = 4300 + rnd() * 600;
          for (let i = 0; i < n; i++) tone(c, dst, at, { f: f0 * (1 - i * 0.03), f2: f0 * (1 - i * 0.03) * 1.12, glide: 0.03, gain: g, a: 0.003, d: 0.03, delay: i * 0.05 });
        } else if (sp < 0.5) { // "fee-bee"
          tone(c, dst, at, { f: 3950, f2: 3900, gain: g, a: 0.02, hold: 0.18, d: 0.08 });
          tone(c, dst, at, { f: 3350, f2: 3300, gain: g * 0.9, a: 0.02, hold: 0.18, d: 0.1, delay: 0.34 });
        } else if (sp < 0.8) { // robin-ish phrase
          const n = 3 + Math.floor(rnd() * 3);
          for (let i = 0; i < n; i++) { const f = 2200 + rnd() * 1100; tone(c, dst, at, { f, f2: f * (rnd() < 0.5 ? 1.25 : 0.8), glide: 0.1, gain: g, a: 0.01, d: 0.1, delay: i * 0.19 }); }
        } else { // chip calls
          const n = 2 + Math.floor(rnd() * 2);
          for (let i = 0; i < n; i++) tone(c, dst, at, { f: 5000 + rnd() * 600, f2: 4200, glide: 0.02, gain: g * 0.8, a: 0.001, d: 0.025, delay: i * 0.11 });
        }
      });
      break;
    }
    case 'owls': {
      const ps = [panner(-0.6, 0.6), panner(0.55, 0.6)];
      tick = (now, horizon, level) => every(now, horizon, level, () => 10 + rnd() * 22, (at) => {
        CRITTER_RECIPES.hoot(c, ps[Math.floor(rnd() * 2)], at, { pitch: 0.92 + rnd() * 0.15, rnd });
      });
      break;
    }
    case 'frogs': {
      const ps = [panner(-0.35, 0.2), panner(0.3, 0.2)];
      tick = (now, horizon, level) => every(now, horizon, level, () => (1.3 - level) * (0.3 + rnd()), (at) => {
        CRITTER_RECIPES.ribbit(c, ps[Math.floor(rnd() * 2)], at, { pitch: 0.8 + rnd() * 0.45, rnd });
      });
      break;
    }
  }
  return {
    out,
    tick,
    stop() {
      const t = c.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, 0.1);
      setTimeout(() => {
        for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } s.disconnect(); }
        for (const n of nodes) n.disconnect();
      }, 600);
    },
  };
}
