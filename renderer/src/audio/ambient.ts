/**
 * Continuous layers: the room tone (one pink-noise loop through a zone-tuned lowpass + an HVAC rumble; a zone change is
 * a 0.8 s filter/gain glide, never a new source), the Engine Room hum ∝ CPU (positional at the rack wall), the office
 * mood undertone (a soft, slow drone while anything is blocked), fish-tank bubbles, and typing clicks from working
 * agents near the player (up to 4 typists, keystrokes scheduled 150 ms ahead on the audio clock).
 * Owner: AUD.
 */
import { zoneTone, hourHush, humFor, typingRate, occlusion } from './mix.ts';
import type { Engine } from './engine.ts';
import type { Layout, HqPoints } from '../world/layout/schema.ts';

const TYPE_R = 7; // m: typing audible within
const TYPISTS = 4;
const LOOKAHEAD = 0.15;

/** What a typist needs from a character actor (chars/actors owns the real type). */
export interface AmbientActor {
  id: string;
  mode?: string;
  level?: number;
  pos: { x: number; y?: number; z: number };
  intent?: { activity?: string | null } | null;
  entity?: { status?: string | null } | null;
}

/** Per-frame inputs from the audio director. */
export interface AmbientFrame {
  dt: number;
  camZone: string | null;
  hour: number;
  player: { pos: { x: number; y?: number; z: number } } | null | undefined;
  actors: { list(): Iterable<AmbientActor> } | null | undefined;
  cpu: number | null;
  blocked: number;
  hidden: boolean;
  reduced: boolean;
}

interface Typist { next: number; burstLeft: number; x: number; y: number; z: number; zone: string | null; seen: number; rate: number }

export function createAmbient(eng: Engine, { layout }: { layout: Layout }) {
  // ambient is only created from eng.onReady, i.e. once the context exists
  const ac = eng.ac as AudioContext;
  const amb = eng.cats.ambient;
  const T = () => ac.currentTime;

  // ---- room bed --------------------------------------------------------------------------------------------------
  const bed = ac.createBufferSource(); bed.buffer = eng.bank.get('pink'); bed.loop = true;
  const bedLp = ac.createBiquadFilter(); bedLp.type = 'lowpass'; bedLp.frequency.value = 1200; bedLp.Q.value = 0.5;
  const bedHp = ac.createBiquadFilter(); bedHp.type = 'highpass'; bedHp.frequency.value = 120;
  const bedG = ac.createGain(); bedG.gain.value = 0;
  bed.connect(bedHp).connect(bedLp).connect(bedG).connect(amb);
  // HVAC: the same noise, deep lowpass (a soft building breath) + a very faint 60/120 Hz mains hum
  const hv = ac.createBufferSource(); hv.buffer = eng.bank.get('pink'); hv.loop = true; hv.playbackRate.value = 0.5;
  const hvLp = ac.createBiquadFilter(); hvLp.type = 'lowpass'; hvLp.frequency.value = 160; hvLp.Q.value = 0.7;
  const hvG = ac.createGain(); hvG.gain.value = 0;
  hv.connect(hvLp).connect(hvG).connect(amb);
  bed.start(0, 0.3); hv.start(0, 2.1);

  // ---- Engine Room hum (positional at the CPU rack; 110 Hz + harmonics so laptop speakers carry it) ---------------------------------------------------------------
  const rack = layout.statAnchors?.find((a) => a.id === 'cpuRack')?.pos ?? null;
  const rackZone = rack ? layout.zoneAt?.(rack.x - 0.8, rack.z, 0) ?? 'ENG' : null;
  let hum: {
    o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; lp: BiquadFilterNode; g: GainNode; fanBp: BiquadFilterNode;
    fanG: GainNode; occ: BiquadFilterNode; occG: GainNode; pos: { x: number; y: number; z: number }; lastOcc: string;
  } | null = null;
  if (rack) {
    const pos = { x: rack.x - 0.4, y: 1.3, z: rack.z };
    const o1 = ac.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 110;
    const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 220.7;
    const o3 = ac.createOscillator(); o3.type = 'sine'; o3.frequency.value = 331.1;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 1.2;
    const trem = ac.createOscillator(); trem.frequency.value = 0.23; // slow "breathing" of the machines
    const tremG = ac.createGain(); tremG.gain.value = 0.15;
    const g = ac.createGain(); g.gain.value = 0;
    const g2 = ac.createGain(); g2.gain.value = 0.6; const g3 = ac.createGain(); g3.gain.value = 0.35;
    o1.connect(lp); o2.connect(g2).connect(lp); o3.connect(g3).connect(lp);
    lp.connect(g);
    trem.connect(tremG).connect(g.gain);
    // fans: the pink loop through a band that opens with load
    const fan = ac.createBufferSource(); fan.buffer = eng.bank.get('pink'); fan.loop = true; fan.playbackRate.value = 1.3;
    const fanBp = ac.createBiquadFilter(); fanBp.type = 'bandpass'; fanBp.frequency.value = 500; fanBp.Q.value = 0.6;
    const fanG = ac.createGain(); fanG.gain.value = 0;
    fan.connect(fanBp).connect(fanG);
    const p = ac.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 5; p.rolloffFactor = 1.2; p.maxDistance = 40;
    eng.setPos(p, pos);
    const occ = ac.createBiquadFilter(); occ.type = 'lowpass'; occ.frequency.value = 20000;
    const occG = ac.createGain(); occG.gain.value = 1;
    g.connect(p); fanG.connect(p);
    p.connect(occ).connect(occG).connect(amb);
    for (const n of [o1, o2, o3, trem, fan]) n.start();
    hum = { o1, o2, o3, lp, g, fanBp, fanG, occ, occG, pos, lastOcc: '' };
  }

  // ---- mood undertone (anything blocked): a soft open fifth with a slow swell, never a siren ----------------------
  const moodG = ac.createGain(); moodG.gain.value = 0;
  const moodLp = ac.createBiquadFilter(); moodLp.type = 'lowpass'; moodLp.frequency.value = 600;
  const moods = [110, 164.8, 220.6].map((f, i) => {
    const o = ac.createOscillator(); o.type = i === 1 ? 'triangle' : 'sine'; o.frequency.value = f;
    const g = ac.createGain(); g.gain.value = i === 2 ? 0.25 : 0.5;
    o.connect(g).connect(moodLp); o.start();
    return o;
  });
  const swell = ac.createOscillator(); swell.frequency.value = 0.12;
  const swellG = ac.createGain(); swellG.gain.value = 0.35;
  const moodVca = ac.createGain(); moodVca.gain.value = 0.65;
  swell.connect(swellG).connect(moodVca.gain); swell.start();
  moodLp.connect(moodVca).connect(moodG).connect(amb);

  // ---- fish tank bubbles --------------------------------------------------------------------------------------------
  // proto layouts only carry the LayoutPoints core; hq adds fishTank (HqPoints). The one cast.
  const fish = (layout.points as Partial<HqPoints> | undefined)?.fishTank ?? null;
  let nextBubble = 0;

  // ---- typing ------------------------------------------------------------------------------------------------------
  const typists = new Map<string, Typist>();
  let scanAcc = 0, seenTick = 0;
  const near: { a: AmbientActor; d2: number; rate: number }[] = [];

  let zoneKey = '';
  const state = { zone: null as string | null, typists: 0, hum: 0, blocked: 0 };

  function update(f: AmbientFrame) {
    const now = T();
    // room tone
    const tone = zoneTone(f.camZone);
    const hush = hourHush(f.hour) * (f.hidden ? 0.25 : 1);
    const key = `${f.camZone}|${hush}`;
    if (key !== zoneKey) {
      zoneKey = key;
      bedLp.frequency.setTargetAtTime(tone.lp, now, 0.3);
      // [AUD m3.5 mix pass] bed 0.2 → 0.8, HVAC 0.28 → 0.7: the room tone measured rms 0.004–0.01 at the default
      // sliders (inaudible on laptop speakers), under mix.MIX_TARGETS.bed; now ≈ 0.009 (library) … 0.027 (engine room)
      bedG.gain.setTargetAtTime(0.8 * tone.gain * hush, now, 0.35);
      hvG.gain.setTargetAtTime(0.7 * tone.hvac * hush, now, 0.35);
      eng.setRoomReverb(tone.rev);
      state.zone = f.camZone;
    }
    // hum
    if (hum) {
      const h = humFor(f.cpu);
      hum.o1.frequency.setTargetAtTime(110 * h.pitch, now, 0.8);
      hum.o2.frequency.setTargetAtTime(220.7 * h.pitch, now, 0.8);
      hum.o3.frequency.setTargetAtTime(331.1 * h.pitch, now, 0.8);
      hum.lp.frequency.setTargetAtTime(h.cutoff, now, 0.8);
      hum.g.gain.setTargetAtTime(0.8 * h.gain * (f.hidden ? 0.3 : 1), now, 0.8); // [AUD m3.5 mix pass] 0.7 → 0.8
      hum.fanBp.frequency.setTargetAtTime(420 + 1500 * h.fan, now, 0.8);
      hum.fanG.gain.setTargetAtTime(0.4 * h.fan * (f.hidden ? 0.3 : 1), now, 0.8);
      const occKey = `${f.camZone}`;
      if (occKey !== hum.lastOcc) {
        hum.lastOcc = occKey;
        const o = occlusion(f.camZone, rackZone);
        hum.occ.frequency.setTargetAtTime(o.lp, now, 0.25);
        hum.occG.gain.setTargetAtTime(o.gain, now, 0.25);
      }
      state.hum = h.gain;
    }
    // mood
    const b = Math.min(4, f.blocked);
    moodG.gain.setTargetAtTime(b ? 0.012 + 0.006 * b : 0, now, b ? 1.5 : 0.6);
    state.blocked = f.blocked;

    const P = f.player?.pos;
    if (!P || f.hidden) { typists.clear(); state.typists = 0; return; }
    // fish tank
    if (fish && now >= nextBubble) {
      const d = Math.hypot(P.x - fish.x, P.z - fish.z);
      nextBubble = now + 1.5 + Math.random() * 3.5;
      if (d < 7) { // a little cluster of 1–4 bloops rising from the aerator
        const n = 1 + Math.floor(Math.random() * 4), x = fish.x + (Math.random() - 0.5) * 1.2;
        for (let i = 0; i < n; i++) {
          eng.play(`bubble:${(i + Math.floor(Math.random() * 4)) & 3}`, {
            cat: 'ambient', gain: 0.3, rate: (0.9 + Math.random() * 0.3) * (1 + i * 0.06), when: now + i * (0.07 + Math.random() * 0.08),
            pos: { x, y: 0.7 + i * 0.1, z: fish.z }, zone: 'LOB', ref: 1.2, rev: 0.05,
          });
        }
      }
    }
    // typing: rescan at 5 Hz, schedule every frame
    scanAcc += f.dt;
    if (scanAcc > 0.2 && f.actors) {
      scanAcc = 0; seenTick++;
      near.length = 0;
      for (const a of f.actors.list()) {
        const rate = a.mode !== 'wait' && a.mode !== 'leave' ? typingRate(a.intent?.activity, a.entity?.status) : 0;
        if (!rate) continue;
        const dx = a.pos.x - P.x, dz = a.pos.z - P.z, d2 = dx * dx + dz * dz;
        if (d2 < TYPE_R * TYPE_R && Math.abs((a.pos.y ?? 0) - (P.y ?? 0)) < 2) near.push({ a, d2, rate });
      }
      near.sort((x, y) => x.d2 - y.d2);
      for (let i = 0; i < Math.min(TYPISTS, near.length); i++) {
        const a = near[i].a;
        let t = typists.get(a.id);
        if (!t) { t = { next: now + Math.random() * 0.3, burstLeft: 0, x: 0, y: 0, z: 0, zone: null, seen: 0, rate: 1 }; typists.set(a.id, t); }
        t.rate = near[i].rate;
        t.x = a.pos.x; t.y = (a.pos.y ?? 0) + 0.75; t.z = a.pos.z; t.seen = seenTick;
        t.zone = layout.zoneAt?.(a.pos.x, a.pos.z, a.level ?? 0) ?? null;
      }
      for (const [id, t] of typists) if (t.seen !== seenTick) typists.delete(id);
      state.typists = typists.size;
    }
    for (const t of typists.values()) {
      while (t.next < now + LOOKAHEAD) {
        if (t.next < now) t.next = now + 0.005;
        if (t.burstLeft <= 0) { // a thinking pause, then a burst of keys (frenzy: longer bursts, shorter pauses)
          t.burstLeft = 3 + Math.floor(Math.random() * 12 * t.rate);
          t.next += (0.25 + Math.random() * 1.3) / t.rate;
          continue;
        }
        t.burstLeft--;
        const space = Math.random() < 0.16;
        eng.play(`key:${space ? 5 : Math.floor(Math.random() * 5)}`, {
          cat: 'sfx', gain: (0.45 + Math.random() * 0.2) * Math.min(1.3, t.rate), rate: 0.94 + Math.random() * 0.12, when: t.next,
          pos: t, zone: t.zone, ref: 1.0, rev: 0.05,
        });
        t.next += (0.07 + Math.random() * 0.1) / t.rate;
      }
    }
  }

  return {
    update, state,
    dispose() { for (const n of [bed, hv, ...moods, swell]) { try { n.stop(); } catch { /* */ } } },
  };
}
