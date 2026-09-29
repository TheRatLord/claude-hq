// @pure
/**
 * Office-wide social moments (DESIGN §11.5 "lively ambient"; tunables `SOCIAL` in tuning.ts). One instance per office
 * (actors.ts owns it). Where a brain is one Clawd's FSM, this is the stage manager for the little scenes that need
 * more than one actor:
 *  - **ping-pong rallies**: a lone player at the table waves a free idle colleague over; once both stand at the table
 *    they rally on one shared clock (synced swings + one real ball crossing the net), somebody misses every 5–13
 *    crossings, the winner hops and the ball rolls away. Idle agents close by drift over to **watch** and clap points;
 *  - **high-five on done**: a free pod-mate trots over to a freshly finished agent's desk and they high-five;
 *  - **the Pit welcome wave**: a done agent sits down in the Pit → the others clap in turn around the sofa ring;
 *  - **Big Board huddles**: something finished (or now and then, when the office is quiet) → 2–3 idle agents gather at
 *    the Pit rim, look up at the Board, point and chat;
 *  - **water-cooler invites**: a lone coffee drinker waves a desk-idle colleague over (the brain's social-spot chat
 *    then takes over).
 * Honesty (§6.9 "verbs never lie", P6): only agents whose brain says they are **free** (idle, awake, not on a parcel
 * run / slide ride / chat / other gig) are ever given a gig, and the brain runs gigs only from its idle branch, so a
 * status change ends one on the same frame. Gigs are plain data: `{key, kind, x, z, yaw, level, tag?, near?, look?,
 * until, speed, chat?, lead?, icons?}`; the brain decides how to walk there and what to do.
 * No three.js here. Owner: BRN.
 */
import { hash32 } from '../../../../shared/identity.ts';
import { SOCIAL as S, TUNING as T } from './tuning.ts';
import type { Entity } from '../../../../shared/protocol.ts';
import type { Furniture, KeepClearRect, KeepClearView, Slot, Vec3 } from '../../world/layout/schema.ts';
import type { Director } from './director.ts';

const TAU = Math.PI * 2;
interface P2 { x: number; z: number }
const d2 = (a: P2, b: P2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const faceTo = (from: P2, to: P2) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

/** a live look target (the ball has `visible`) */
export interface LookPoint { x: number; y: number; z: number; visible?: boolean }

/**
 * A social gig: plain data the brain plays (it decides how to walk there and what to do). `key` is unique per gig
 * (the brain restarts on a new key). The point gigs (watch / congrats / huddle) stand at (x, z, yaw, level); a claim
 * gig takes the pick spot `tag`, nearest to `near`. The rest is the casting bookkeeping.
 */
export interface Gig {
  key: number;
  kind: 'watch' | 'congrats' | 'huddle' | 'claim';
  x: number; z: number; yaw: number; level: number;
  tag?: string;
  near?: { x: number; z: number; level?: number };
  /** live look target once there (the ball, the Board, a friend) */
  look?: LookPoint | null;
  /** watch: where to look while the ball is out of play */
  lookRest?: LookPoint;
  /** local seconds */
  until: number;
  /** m/s */
  speed?: number;
  /** glyph chat bubbles once there */
  chat?: boolean;
  /** speaks on even beats */
  lead?: boolean;
  icons?: string[];
  /** congrats: the done agent */
  target?: string;
  gait?: string;
  /** which branch of the brain plays it: an idle agent's idle ladder, or a done agent's Pit stay */
  mode?: 'done' | 'idle';
  /** watch: the index of its spectator spot */
  spot?: number;
  /** a showcase regular's room zone */
  regular?: string;
  len?: number;
  ext?: number;
  /** invite gigs: the agent whose table / coffee it joins */
  host?: string;
  maxLen?: number;
  spotId?: string;
  cameo?: string;
  done?: boolean;
  nextBeat?: number;
  rallyGone?: number;
}
type NewGig = Omit<Gig, 'key'>;

/** One actor as social.ts and the brains' neighbour lists see it (actors.ts keeps it current, per actor). */
export interface Lite {
  id: string;
  pos: Vec3;
  yaw: number;
  status: string;
  seated: boolean;
  chattingWith: string | null;
  social: boolean;
  pocket: boolean;
  level: number;
  moving: boolean;
  /** id of the slot / point it is settled at */
  settledAt: string | null;
  /** the brain's committed status */
  bstatus: string | null;
  phase: string;
  /** free idle agent: the brain may play a gig */
  free: boolean;
  idleMs: number;
  /** key of the last claim gig it could not take */
  declined: number;
  riding: boolean;
  ghost: boolean;
  urgent: boolean;
  /** may be borrowed from a showcase room */
  castable: boolean;
}

/** the scene counters (`__hq.metrics().social`); `reg<ZONE>` counts the showcase regulars placed per room */
export interface SocialTally {
  rallies: number; rallyHits: number; points: number; watchers: number; highFives: number; pitWaves: number; huddles: number;
  invites: number; cheers: number; passFives: number;
  [dynamic: string]: number | undefined;
}

/** `counts()`: the tally plus the live scene numbers */
export interface SocialCounts {
  rallies: number; rallyHits: number; points: number; watchers: number; highFives: number; pitWaves: number; huddles: number;
  invites: number; cheers: number; passFives: number;
  /** cameo visits (absent until the first) */
  cameos?: number;
  gigs: number;
  rally: { a: string; b: string; point: number; n: number } | null;
}

/** what social.ts reads of the layout */
export interface SocialLayout {
  slots?: Slot[];
  furniture?: Furniture[];
  points?: { spawn?: { x: number; z: number }; pitCenter?: Vec3; bigBoard?: Partial<Vec3> };
  keepClear?: KeepClearRect[];
  keepClearViews?: ReadonlyArray<KeepClearView>;
  spawn?: readonly number[];
  zones?: readonly { id: string; rect: readonly number[]; level?: number }[];
  zoneAt?: (x: number, z: number, level?: number) => string | null;
}
/** what social.ts reads of the director */
export type SocialDirector = Partial<Pick<Director, 'isHq' | 'walkable' | 'inView' | 'slideExit' | 'spotsOf' | 'tagDist' | 'spotOk' | 'approach' | 'slotFor' | 'pathLen' | 'holds'>>;

interface Rim { x: number; z: number; a: number; yaw: number }
interface Room { zone: string; tag: string; near: { x: number; z: number; level: number }; level: number; core: boolean }
interface RoomDef { zone: string; zones?: string[]; tag: string; view?: string; core?: boolean }
interface CameoSpot { tag: string; spot: Slot; k: number }
interface CameoTarget { zone: string; tag: string; near: { x: number; z: number; level: number }; level: number }
interface Rally {
  a: string; b: string; t0: number; n: number; hits: number; point: number;
  miss: { t: number; from: Vec3; dir: number; dx: number; loser: string } | null;
  /** who serves (0 = a) */
  side: number;
  nextSide: number;
  sxN?: number; sx0?: number; sx1?: number;
}
interface CastOpts { level?: number; not?: string | null; steal?: boolean; done?: boolean; outing?: boolean; preferDone?: boolean; pitFloor?: number }

export function createSocial({ layout, director }: { layout?: SocialLayout | null; director?: SocialDirector | null }) {
  const hq = !!director?.isHq;
  const slots = layout?.slots ?? [];
  const pp = slots.filter((s) => s.tag === 'pingpong').sort((a, b) => (a.id < b.id ? -1 : 1));
  const table = layout?.furniture?.find((f) => f.type === 'pingPong') ?? null;
  const pit = layout?.points?.pitCenter ?? null;
  const boardY = layout?.points?.bigBoard?.y ?? 4;
  const walk = (x: number, z: number, l = 0) => !director?.walkable || director.walkable(x, z, l);
  // ([BRN fix m3-r2] + never in an authored view's 3 m no-stand cone)
  const clear = (x: number, z: number) => !(layout?.keepClear ?? []).some((k) => !k.headSlotOnly && x >= k.x0 - 0.3 && x <= k.x1 + 0.3 && z >= k.z0 - 0.3 && z <= k.z1 + 0.3)
    && !director?.inView?.(x, z, 0);

  // ---- spectator spots round the ping-pong table, in preference order: the strip on the far (stairs) side first, so
  // the audience faces the Pit and the spawn view over the table; then the two near corners; the near side last (it
  // stands between the Pit and the players)
  const watchSpots: { x: number; z: number; yaw: number }[] = [];
  if (table && pp.length === 2) {
    const c = table.pos, hw = table.size[0] / 2, hd = table.size[2] / 2;
    const far = pit ? Math.sign(c.x - pit.x) || 1 : 1; // the table's side away from the Pit (x)
    for (const [ox, oz] of [[hw + 0.5, -0.42], [hw + 0.5, 0.42], [-(hw + 0.72), -(hd + 0.5)], [-(hw + 0.72), hd + 0.5], [-(hw + 0.95), 0]]) {
      const x = c.x + far * ox, z = c.z + oz;
      if (walk(x, z) && clear(x, z)) watchSpots.push({ x, z, yaw: faceTo({ x, z }, c) });
    }
  }
  // ---- the Pit rim ring for Board huddles (walkable, off the keep-clear corridors, ≥ 0.9 m apart)
  const rim: Rim[] = [];
  const exitP = director?.slideExit?.()?.pos ?? null; // [BRN fix m175-r2] slide riders step off here: keep the huddle off it
  if (pit) {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      const x = pit.x + Math.sin(a) * S.rimR, z = pit.z + Math.cos(a) * S.rimR;
      if (exitP && Math.hypot(x - exitP.x, z - exitP.z) < 1.2) continue;
      if (walk(x, z) && clear(x, z) && walk(x + Math.sin(a) * 0.35, z + Math.cos(a) * 0.35)) rim.push({ x, z, a, yaw: faceTo({ x, z }, pit) });
    }
  }
  const boardLook = pit ? { x: pit.x, y: boardY, z: pit.z } : null;
  const queueHead = slots.find((q) => q.tag === 'queue')?.pos ?? null;
  let blockedPrev = 0;
  // huddles prefer the rim arc beyond the Pit as seen from spawn: the group then faces the spawn view, looking up
  const sp = layout?.spawn ? { x: layout.spawn[0], z: layout.spawn[2] } : null;
  const rimPref = pit && sp ? Math.atan2(pit.x - sp.x, pit.z - sp.z) : 0;
  const angD = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  const gigs = new Map<string, Gig>();
  const pokes: { at: number; id: string; r: string }[] = [];
  let seq = 0, now = 0;
  /** id → lite (this frame) */
  const byId = new Map<string, Lite>();
  const cool = new Map<string, number>(); // `${kind}|${id}` → next allowed t
  const counts: SocialTally = { rallies: 0, rallyHits: 0, points: 0, watchers: 0, highFives: 0, pitWaves: 0, huddles: 0, invites: 0, cheers: 0, passFives: 0 };
  let forceWatch = false;
  // [BRN M3.5] the rally floor's clock (rallyFloor) and the passing high-fives' scratch list (passFives)
  let rallyEndT = 0, rallied = false; // [BRN fix m2-fix1] last local t a rally was on; has there been one yet
  let rallyWant: number | null = null, rallyAt = 0, rallyCoolUntil = -Infinity, rallyLast2 = -Infinity, rallyCand = 0;
  const passL: Lite[] = [];
  let nextAmbientHuddle = 0, lastHuddle = -Infinity, nextSlow = 0, slow = false;

  const rnd = (k: string | number) => (hash32(`social|${k}`) % 100_003) / 100_003;
  // [BRN fix m3-r2] the night hearth (art review m3-r2: an empty campfire circle and empty rooms at 22h): after dark the
  // Pit keeps S.pitKeepNight loungers and the showcase casting fills it first (S.regularRoomsNight)
  let night = false;
  const isNight = (h: number | null | undefined) => h !== null && h !== undefined && (h >= S.nightHours[0] || h < S.nightHours[1]);
  const pitKeep = () => (night ? S.pitKeepNight : T.pitKeep);
  // [BRN M3.5] a gig remembers which branch of the brain plays it: an idle agent's idle ladder, or a done agent's Pit stay
  // (its pin stays held; the gig ends the moment its status is anything else)
  // ([BRN fix m2-fix1] casting a Pit lounger counts it gone from the Pit at once: scenes + outings cannot double-spend)
  const assign = (id: string, ng: NewGig): Gig => { const l0 = byId.get(id); if (l0 && (loungingDone(l0) || homingDone(l0)) && !gigs.has(id)) { pitLoungeN--; pitBoundN--; } const g = Object.assign(ng, { key: ++seq }); g.mode ??= byId.get(id)?.bstatus === 'done' ? 'done' : 'idle'; gigs.set(id, g); return g; };
  const poke = (id: string, r: string, dt = 0) => { if (pokes.length < 64) pokes.push({ at: now + dt, id, r }); };
  const coolOk = (k: string, s: number) => { if ((cool.get(k) ?? -Infinity) > now) return false; cool.set(k, now + s); return true; };
  /** free idle agents (not in a gig) within r of p, nearest first */
  const freeNear = (p: P2, r: number, minIdle: number = S.minIdleMs, level = 0, not: string | null = null): Lite[] => {
    const out: [number, Lite][] = [];
    for (const l of byId.values()) {
      if (!l.free || gigs.has(l.id) || l.id === not || (l.level ?? 0) !== level || (l.idleMs ?? 0) < minIdle) continue;
      const dd = d2(l.pos, p);
      if (dd <= r * r) out.push([dd, l]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  };
  /**
   * [BRN M3.5] social rate floors (ideation GD #2: with few free idle agents in `mixed`, no scene ever fired): who may be
   * cast in a scene — a free idle agent (idle ≥ minIdle), an idle showcase regular if `steal` (its stint ends early),
   * or a done agent lounging awake in the Pit (its pin stays held, like its own outings). Nearest first.
   */
  const castNear = (p: P2, r: number, minIdle: number = S.minIdleMs, { level = 0, not = null, steal = false, done = true, outing = false, preferDone = false, pitFloor = pitKeep() }: CastOpts = {}): Lite[] => {
    const out: [number, Lite][] = [];
    for (const l of byId.values()) {
      if (l.id === not || (l.level ?? 0) !== level) continue;
      const g = gigs.get(l.id);
      // (never the Café / Library regulars: the showcase dwell floor; a touring one may be borrowed)
      const ok = (l.bstatus === 'idle' && (l.idleMs ?? 0) >= minIdle && ((l.free && !g) || (steal && g?.regular && !S.keepRegular.includes(g.regular) && !(night && g.regular === 'PIT') && g.mode === 'idle' && l.castable)))
        || (done && !g && (loungingDone(l) || (outing && (outingDone(l) || homingDone(l)))));
      if (!ok) continue;
      const dd = d2(l.pos, p);
      // (idle first, then done, then a regular; preferDone: done first — a rally leaves the free idle ones to the showcase rooms)
      if (dd <= r * r) out.push([dd + (l.bstatus === 'done' ? (preferDone ? -200 : 9) : 0) + (g ? 4 : 0), l]);
    }
    out.sort((a, b) => a[0] - b[0]);
    // [BRN fix m2-fix1] the Pit keeps T.pitKeep done loungers: only the ones beyond that may be called away
    // (a done agent on its way back to its seat counts as the Pit's too)
    let spare = pitBoundN - pitFloor;
    const res: Lite[] = [];
    for (const [, l] of out) { if ((loungingDone(l) || homingDone(l)) && spare-- <= 0) continue; res.push(l); }
    return res;
  };
  /** [BRN fix m2-fix1] done agents lounging (settled, awake) in their Pit seats / + those walking back to them, as of
   * the last regulars pass (4 Hz) */
  let pitLoungeN = 0, pitBoundN = 0;

  // ------------------------------------------------------------------------------------------ ping-pong
  let rally: Rally | null = null;
  const ball: LookPoint & { visible: boolean } = { x: table?.pos.x ?? 0, y: 0.6, z: table?.pos.z ?? 0, visible: false };
  const sync = new Map<string, number>(); // id → swing phase u (0..1), CHR pingpong activity
  const atTable = (l: Lite | null | undefined, s: Slot) => !!l && l.settledAt === s.id && !l.moving && (l.bstatus === 'idle' || l.bstatus === 'done');
  /** contact point in front of a player (ball height a little over the table top) */
  const contact = (s: Slot, out: Vec3): Vec3 => {
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    out.x = s.pos.x + fx * 0.42; out.z = s.pos.z + fz * 0.42; out.y = (table?.size?.[1] ?? 0.76) + 0.16;
    return out;
  };
  const cA = { x: 0, y: 0, z: 0 }, cB = { x: 0, y: 0, z: 0 };
  const playerAt = (s: Slot): Lite | null => { for (const l of byId.values()) if (atTable(l, s)) return l; return null; };
  const held = (s: Slot) => { if (!director?.holds) return false; for (const id of byId.keys()) if (director.holds(id, s.id)) return true; return false; };

  function updateRally(t: number) {
    sync.clear();
    ball.visible = false;
    if (pp.length !== 2) return;
    const hA = playerAt(pp[0]), hB = playerAt(pp[1]);
    if (!hA || !hB) {
      if (rally) rally = null;
      // a lone player at the table asks a free colleague over (one invite per S.inviteEveryS)
      const lone = hA ?? hB, other = hA ? pp[1] : pp[0];
      if (lone && slow && !held(other) && coolOk(`pp|${lone.id}`, S.inviteEveryS)
        && rnd(`pp|${lone.id}|${Math.floor(t)}`) < S.partnerChance) {
        const c = castNear(lone.pos, S.inviteR, S.rallyMinIdleMs, { not: lone.id })[0];
        if (c) {
          const len = S.rallyGigS[0] + rnd(`ppl|${c.id}|${t}`) * (S.rallyGigS[1] - S.rallyGigS[0]);
          assign(c.id, { kind: 'claim', tag: 'pingpong', near: other.pos, x: other.pos.x, z: other.pos.z, yaw: other.yaw, level: 0, until: t + len, speed: 1.3, host: lone.id });
          poke(lone.id, 'wave');
          counts.invites++;
        }
      }
      return;
    }
    if (!rally || rally.a !== hA.id || rally.b !== hB.id) {
      rally = { a: hA.id, b: hB.id, t0: t + 0.6, n: 0, hits: 0, point: 0, miss: null, side: 0, nextSide: 0 };
      rally.hits = pointLen(rally);
      counts.rallies++;
    }
    const H = S.rallyHalfS;
    contact(pp[0], cA); contact(pp[1], cB);
    const r = rally;
    if (r.miss) {
      // the missed ball sails past the loser, drops to the floor, bounces and rolls away; then the next serve
      const u = t - r.miss.t;
      if (u >= S.rallyServeS) { r.miss = null; r.t0 = t + 0.25; r.n = 0; r.point++; r.hits = pointLen(r); r.side = r.nextSide; }
      else {
        const from = r.miss.from, dir = r.miss.dir;
        // off the paddle edge: a short hop up, down to the floor, then little decaying bounces as it rolls on
        const k = 1 - Math.exp(-u * 1.6);
        ball.x = from.x + r.miss.dx * k; ball.z = from.z + dir * k * 2.4;
        const tf = (1 + Math.sqrt(1 + 24 * Math.max(0, from.y - 0.03))) / 12;
        ball.y = u < tf ? from.y + u - 6 * u * u : 0.03 + Math.abs(Math.sin((u - tf) * 8)) * 0.2 * Math.exp(-(u - tf) * 3);
        ball.visible = u < S.rallyServeS - 0.2;
      }
    }
    const players = r.side === 0 ? [r.a, r.b] : [r.b, r.a];
    const cs = r.side === 0 ? [cA, cB] : [cB, cA];
    const tt = t - r.t0;
    if (!r.miss && tt >= 0) {
      const n = Math.floor(tt / H), u = tt / H - n;
      if (n !== r.n) { // a crossing completed: the receiver hits it back (or misses the last one)
        r.n = n;
        counts.rallyHits++;
        if (n >= r.hits) {
          const loser = players[n % 2], winner = players[(n + 1) % 2];
          const at = cs[n % 2], dir = Math.sign(at.z - cs[(n + 1) % 2].z) || 1;
          r.miss = { t, from: { ...at }, dir, dx: (rnd(`mx|${r.point}|${r.a}`) - 0.5) * 0.9, loser };
          r.nextSide = loser === r.a ? 0 : 1; // the loser serves the next point
          counts.points++;
          poke(winner, 'hop', 0.2);
          for (const [id, g] of gigs) if (g.kind === 'watch' && rnd(`clap|${id}|${r.point}`) < S.clapChance) poke(id, 'clap', 0.25 + rnd(`cd|${id}|${r.point}`) * 0.35);
        }
      }
      if (!r.miss) {
        // ball: from the hitter's contact point, a low arc, one bounce on the far half, up into the receiver's contact
        const from = cs[n % 2], to = cs[(n + 1) % 2];
        // (sx0 / sx1 read as NaN when the first crossing seen is n ≥ 1, after a frame hitch: kept as shipped)
        if (r.sxN !== n) { r.sxN = n; r.sx0 = n ? r.sx1 ?? NaN : 0; r.sx1 = (rnd(`bx|${r.a}|${r.point}|${n}`) - 0.5) * 0.36; }
        const x0 = from.x + (r.sx0 ?? NaN), x1 = to.x + (r.sx1 ?? NaN);
        const top = (table?.size?.[1] ?? 0.76) + 0.03;
        let y: number;
        if (u < 0.68) { const v = u / 0.68; y = from.y + (top - from.y) * v + 0.3 * Math.sin(Math.PI * v); }
        else { const v = (u - 0.68) / 0.32; y = top + (to.y - top) * v + 0.16 * Math.sin(Math.PI * v); }
        ball.x = x0 + (x1 - x0) * u; ball.z = from.z + (to.z - from.z) * u; ball.y = y;
        ball.visible = true;
      }
      // swings: each player's CHR swing (period 2H) peaks (contact at u 0.42) when the ball reaches it
      for (let i = 0; i < 2; i++) {
        const since = tt - (i === 0 ? 0 : H); // player i hits at crossings n ≡ i (mod 2)
        let ph = (since / (2 * H)) % 1; if (ph < 0) ph += 1;
        sync.set(players[i], (ph + 0.42) % 1);
      }
    } else {
      // waiting to serve: the server bounces the ball on its paddle side (a little toss), the swing parked in its
      // follow-through for both until the serve
      sync.set(r.a, 0.75); sync.set(r.b, 0.75);
      if (!r.miss) {
        const c = cs[0];
        ball.x = c.x; ball.z = c.z; ball.y = c.y + 0.12 * Math.abs(Math.sin(t * 7));
        ball.visible = true;
      }
    }
  }
  const pointLen = (r: Rally) => S.rallyHits[0] + Math.floor(rnd(`len|${r.a}|${r.b}|${r.point}`) * (S.rallyHits[1] - S.rallyHits[0] + 1));

  function updateWatchers(t: number) {
    if (!rally || !table || !watchSpots.length) return;
    let n = 0;
    const taken = new Set<number | undefined>();
    for (const g of gigs.values()) if (g.kind === 'watch') { n++; taken.add(g.spot); }
    if (n >= S.watchMax || !coolOk('watch', S.watchEveryS) || (!forceWatch && rnd(`w|${Math.floor(t)}`) >= S.watchChance)) return;
    const c = table.pos;
    const cand = castNear(c, forceWatch ? 60 : S.watchR, forceWatch ? 0 : S.rallyMinIdleMs)[0]; // [BRN M3.5] + done loungers / done agents out and about
    if (!cand) return;
    const best = watchSpots.findIndex((_, i) => !taken.has(i)); // the best-staged free spot
    if (best < 0) return;
    const s = watchSpots[best];
    const len = S.watchS[0] + rnd(`wl|${cand.id}|${t}`) * (S.watchS[1] - S.watchS[0]);
    assign(cand.id, { kind: 'watch', spot: best, x: s.x, z: s.z, yaw: s.yaw, level: 0, look: ball, lookRest: { x: c.x, y: 0.9, z: c.z }, until: t + len, speed: 1.2 });
    counts.watchers++;
  }

  // ------------------------------------------------------------------------------------------ coffee invites
  function updateCoffee(t: number) {
    for (const l of byId.values()) {
      if (l.bstatus !== 'idle' || l.moving || !l.settledAt || !/^slot:coffee:/.test(l.settledAt)) continue;
      if (!coolOk(`cof|${l.id}`, S.inviteEveryS)) continue;
      // somebody already drinking with them? then the brain's water-cooler chat runs by itself
      let mate = false;
      for (const o of byId.values()) if (o !== l && o.settledAt && /^slot:coffee:/.test(o.settledAt) && d2(o.pos, l.pos) < 2.5 * 2.5) mate = true;
      if (mate || rnd(`cof|${l.id}|${Math.floor(t)}`) >= S.coffeeChance) continue;
      const c = freeNear(l.pos, S.inviteR, S.minIdleMs, l.level ?? 0, l.id)[0];
      if (!c) continue;
      const len = S.coffeeGigS[0] + rnd(`cl|${c.id}|${t}`) * (S.coffeeGigS[1] - S.coffeeGigS[0]);
      assign(c.id, { kind: 'claim', tag: 'coffee', near: l.pos, x: l.pos.x, z: l.pos.z, yaw: 0, level: l.level ?? 0, until: t + len, speed: 1.2, host: l.id });
      poke(l.id, 'wave');
      counts.invites++;
    }
  }

  // ------------------------------------------------------------------------------------------ showcase regulars
  // [BRN fix m2-r2] (art + gameplay review m2-r2: the Café / Library / Lab / Pit poses were deserted most of the time) A
  // dwell floor: while agents are free, each showcase room nobody else is using gets one idle 'regular' (S.regularRooms,
  // in priority order, at most ceil(regularShare × free) at once). The regular claims the room's pick tag starting from
  // the seat best framed by the room's authored view, stays a stint (regularS), and its successor is cast
  // regularHandoverS before the stint ends (or, with nobody else free, the stint is simply extended). Honest: only free
  // idle agents, and any status change ends the gig on the same frame (a working agent evicts a regular from a station).
  const views = new Map((layout?.keepClearViews ?? []).map((v): [string, KeepClearView] => [v.id, v]));
  const zoneOfSpot = (s: Slot) => s.zone ?? layout?.zoneAt?.(s.pos.x, s.pos.z, s.level ?? 0) ?? null;
  const zoneOfLite = (l: Lite) => ((l.level ?? 0) === 1 ? 'MEZ' : layout?.zoneAt?.(l.pos.x, l.pos.z, 0) ?? null);
  /** how badly a spot is framed by view v (lower = better; Infinity = out of frame): ~5 m in front, near the axis, facing the lens */
  const framing = (s: Slot, v: KeepClearView | undefined) => {
    if (!v || (v.level ?? 0) !== (s.level ?? 0)) return 50;
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), dx = s.pos.x - v.x, dz = s.pos.z - v.z;
    const al = dx * fx + dz * fz;
    if (al < 2) return 40;
    const lat = Math.abs(dx * fz - dz * fx) / al;
    const facing = -Math.sin(s.yaw) * -dx - Math.cos(s.yaw) * -dz; // (a slot faces (−sin yaw, −cos yaw))
    // ([BRN fix m3-r2] 2 → 8 for a back to the lens: the Pit's first regular took a near-arc seat, its back to pitOverview)
    return Math.abs(al - 5) + 4 * lat + (lat > 0.75 ? 20 : 0) + (facing > 0 ? 0 : 8);
  };
  /** layout zone → the room key it counts toward */
  const roomOfZone = new Map<string | null, string>();
  const mkRoom = (r: RoomDef): Room | null => {
    const zs = r.zones ?? [r.zone];
    const list = (director?.spotsOf?.(r.tag) ?? []).filter((s) => zs.includes(zoneOfSpot(s) ?? ''));
    if (!list.length) return null;
    let best = list[0], bd = Infinity;
    for (const s of list) { const d = framing(s, views.get(r.view ?? '')); if (d < bd) { bd = d; best = s; } }
    for (const z of zs) roomOfZone.set(z, r.zone);
    return { zone: r.zone, tag: r.tag, near: { x: best.pos.x, z: best.pos.z, level: best.level ?? 0 }, level: best.level ?? 0, core: !!r.core };
  };
  /** the fixed dwell floor (priority order) and the touring showcase (one of these at a time, S.regularTourS each) */
  const nonNull = <T,>(x: T | null): x is T => x !== null;
  const roomsDay: Room[] = hq ? (S.regularRooms ?? []).map(mkRoom).filter(nonNull) : [];
  const roomsNight: Room[] = hq ? (S.regularRoomsNight ?? S.regularRooms ?? []).map(mkRoom).filter(nonNull) : [];
  let rooms = roomsDay; // (setHour swaps in roomsNight after dark)
  const coreZone = new Set([...roomsDay, ...roomsNight].filter((r) => r.core).map((r) => r.zone));
  /** a fixed room's priority (its first listing; lower = cast first) */
  const roomRank = (zone: string) => { const i = rooms.findIndex((r) => r.zone === zone); return i < 0 ? 99 : i; };
  /** [BRN fix m2-fix1] room → local t somebody was last settled there (the tour's drought order) */
  const tourSeen = new Map<string, number>();
  const tour: Room[] = hq ? (S.regularTour ?? []).map(mkRoom).filter(nonNull) : [];
  /** zone → people using it now (settled there, or a regular not yet handing over) */
  const covered = new Map<string, number>();
  const cover = (zn: string) => covered.set(zn, (covered.get(zn) ?? 0) + 1);
  /** id → local t until which a regular back from its stint is not recast (unless nobody else is free) */
  const restUntil = new Map<string, number>();
  /** room → local t until which it is not cast again (its last regular found no free spot there) */
  const roomCool = new Map<string, number>();
  function updateRegulars(t: number) {
    if (!rooms.length && !tour.length) return;
    covered.clear();
    let free = 0, regs = 0, pitDone = 0, homing = 0, pitAll = 0;
    for (const l of byId.values()) {
      const g = gigs.get(l.id);
      // [BRN fix m2-fix1] who is settled where (regulars too): the tour's drought clock and the Pit's head count (any
      // awake agent settled in the Pit counts toward T.pitKeep: an idle Pit regular lets a done lounger go out)
      if (!l.moving && l.settledAt) {
        const lz = zoneOfLite(l), rz = roomOfZone.get(lz);
        if (rz) tourSeen.set(rz, t);
        if (lz === 'PIT' && !/nap|Nap|sleep/.test(l.phase ?? '')) pitAll++;
      }
      // ([BRN fix m2-fix1] a stint shorter than the handover — a done agent's 40–70 s — covered its room for 0–20 s only,
      // so the Café was cast again and again: three done loungers left the Pit for it within 3 s)
      if (g?.regular) { regs++; if (g.until - t > Math.min(S.regularHandoverS, 0.35 * (g.len ?? Infinity))) cover(g.regular); continue; }
      if (l.free && !g) free++;
      if (homingDone(l)) { homing++; if (roomOfZone.has('PIT')) cover('PIT'); } // (on its way: the Pit needs no regular for it)
      if (l.moving || !l.settledAt) continue;
      if (loungingDone(l)) pitDone++;
      const zn = roomOfZone.get(zoneOfLite(l));
      if (zn) cover(zn);
    }
    // done agents lounging in the Pit may take a stint too (a cocoa at the Café, a read in the Library: the pennant
    // and the happy face come along, like their own outings), as long as one stays behind in the Pit
    // [BRN fix m2-fix1] … as long as T.pitKeep stay behind (was 1: the Pit sofas read empty in every review sample)
    pitLoungeN = Math.max(pitDone, pitAll); pitBoundN = pitLoungeN + homing;
    spareDone = Math.max(0, Math.min(pitDone, pitLoungeN - pitKeep()));
    for (const r of rooms) {
      if ((covered.get(r.zone) ?? 0) > 0) emptySince.delete(r.zone);
      else if (!emptySince.has(r.zone)) emptySince.set(r.zone, t);
    }
    const cap = Math.max(1, Math.ceil((free + regs + spareDone) * S.regularShare));
    want.clear();
    // [BRN fix m2-r3] after the first room (the Café), the room empty the longest is cast first (gameplay review m2-r3:
    // with few free agents the fixed order CAF → PIT → LIB left the Library to the leftovers: its regular was seated in
    // 2 of 5 samples); ties keep the priority order. In place on a reused array (4 Hz, 3 rooms)
    // [BRN fix m2-fix1] the core rooms first, in order and outside the cap (the Café's one, the Pit's two), then the rest
    // with whoever is left (a core room short of people takes a non-core regular over on a later pass: pickRegular)
    // The touring showcase: the tour room nobody has visited the longest (was a fixed 110 s rotation: with the core rooms
    // first, a starved turn left the Nap Nook / the W bays unvisited for 10 min); past S.tourDroughtS it goes before the
    // Library
    // (one touring regular at a time; a room nobody can reach within the desk cap is passed over for the next one)
    let n = 0, touring = false;
    for (const g of gigs.values()) if (g.regular && tourZone.has(g.regular)) touring = true;
    for (let i = 0; i < tour.length; i++) tourOrder[i] = tour[i];
    tourOrder.sort(byDrought);
    const tourFirst = !touring && tour.length > 0 && t - (tourSeen.get(tourOrder[0].zone) ?? 0) > S.tourDroughtS;
    for (const r of rooms) { if (r.core) regs = castRoom(r, t, regs, Infinity); else roomOrder[n++] = r; }
    if (tourFirst) regs = castTour(t, regs, cap + 1);
    roomOrder.length = n;
    roomOrder.sort(byEmptiest);
    for (const r of roomOrder) regs = castRoom(r, t, regs, cap);
    if (!touring && !tourFirst) castTour(t, regs, cap + 1); // (its own seat)
  }
  const tourOrder: Room[] = [];
  const tourZone = new Set(tour.map((r) => r.zone));
  const byDrought = (a: Room, b: Room) => (tourSeen.get(a.zone) ?? 0) - (tourSeen.get(b.zone) ?? 0) || tour.indexOf(a) - tour.indexOf(b);
  let starved: Room | null = null;
  function castTour(t: number, regs: number, cap: number) {
    for (const r of tourOrder) {
      want.delete(r.zone);
      starved = t - (tourSeen.get(r.zone) ?? 0) > S.tourStarveS ? r : null;
      const r2 = castRoom(r, t, regs, cap);
      starved = null;
      if (r2 > regs || (covered.get(r.zone) ?? 0) > 0) return r2;
    }
    return regs;
  }
  const roomOrder: Room[] = [];
  const borrowPit: Record<string, number | undefined> = S.regularBorrowPit;
  const emptyW = (r: Room) => (now - (emptySince.get(r.zone) ?? now)) * (borrowPit[r.zone] ?? 0.8);
  const byEmptiest = (a: Room, b: Room) => (a === rooms[0] ? -1 : b === rooms[0] ? 1 : 0) || emptyW(b) - emptyW(a) || rooms.indexOf(a) - rooms.indexOf(b);
  const want = new Map<string, number>();
  /** one room's turn: cast a regular if it is short of one (the k-th listing of a zone wants k people there) */
  function castRoom(r: Room, t: number, regs: number, cap: number): number {
    const k = (want.get(r.zone) ?? 0) + 1;
    want.set(r.zone, k);
    if ((covered.get(r.zone) ?? 0) >= k || (roomCool.get(r.zone) ?? -Infinity) > t) return regs;
    const c = regs < cap ? pickRegular(r, t, k) : null;
    if (!c) { // nobody else to take over: the current regular (if any) stays on a while
      if (k === 1) for (const g of gigs.values()) {
        if (g.regular !== r.zone || g.mode === 'done' || g.until - t > S.regularHandoverS || (g.ext ?? 0) >= S.regularExtendMax) continue;
        g.until = t + S.regularS[0]; g.ext = (g.ext ?? 0) + 1;
      }
      return regs;
    }
    // (a done stint is short: its own outings go on; [BRN fix m3-r2] a night at the hearth is long)
    const L = c.bstatus === 'done' ? S.regularDoneS : night && r.zone === 'PIT' ? S.regularNightS : S.regularS;
    const len = L[0] + rnd(`rg|${c.id}|${Math.floor(t)}`) * (L[1] - L[0]);
    if (loungingDone(c) && !gigs.has(c.id)) spareDone = Math.max(0, spareDone - 1); // (assign() counts it out of the Pit)
    assign(c.id, { kind: 'claim', tag: r.tag, near: r.near, x: r.near.x, z: r.near.z, yaw: 0, level: r.level, until: t + len, len,
      speed: S.regularSpeed, regular: r.zone, mode: c.bstatus === 'done' ? 'done' : 'idle' });
    counts.regulars = (counts.regulars ?? 0) + 1;
    counts[`reg${r.zone}`] = (counts[`reg${r.zone}`] ?? 0) + 1;
    cover(r.zone);
    return regs + 1;
  }
  /** zone → local t since when it has had nobody (absent = somebody there now) */
  const emptySince = new Map<string, number>();
  /** [BRN fix m2-fix1] zone → local t until which an empty room is booked by the agent on its way (roomEmpty) */
  const booked = new Map<string, number>();
  // ([BRN fix m2-fix1] borrowTurn is gone: the Pit's last loungers are never borrowed; spare ones go by emptiness order)
  /** a done agent settled in its Pit seat, awake (not dozing, not already on an outing) */
  const loungingDone = (l: Lite) => l.bstatus === 'done' && !l.moving && (l.phase === 'pit' || l.phase === 'pitStand');
  /** [BRN M3.5] a done agent out on one of its own outings (not the slide): may be called over to a scene */
  /** [BRN M3.5] a done agent on its way back to its Pit seat (its outing over): may stop for a game on the way */
  const homingDone = (l: Lite) => l.bstatus === 'done' && l.moving && (l.phase === 'pit' || l.phase === 'pitStand');
  const outingDone = (l: Lite) => l.bstatus === 'done' && !l.moving && !!l.settledAt && typeof l.phase === 'string' && l.phase.startsWith('outing:') && !/slide|slid|whee/i.test(l.phase);
  let spareDone = 0;
  /** the free idle agent closest to the room (a rested one first), else a spare done agent from the Pit */
  function pickRegular(r: Room, t: number, _k: number): Lite | null {
    let best: Lite | null = null, bd = Infinity;
    for (const l of byId.values()) {
      const g = gigs.get(l.id);
      // [BRN fix m2-fix1] a core room short of people may take over a regular from a fixed room further down the list
      // (the Café from the Library or the Pit's idle regular; never the tour: its one visitor is often the far rooms' only one)
      const moveOver = !!g && r.core && !!g.regular && !tourZone.has(g.regular) && roomRank(g.regular) > roomRank(r.zone)
        && (r.zone === rooms[0]?.zone || !coreZone.has(g.regular)) && (g.mode === 'done' || l.castable); // ([BRN fix m3-r2] the first room: the Café by day, the Pit hearth at night)
      if (g && !moveOver) continue;
      // [BRN fix m2-fix1] a done lounger only while T.pitKeep others stay in the Pit (its default rest), never for the Pit
      // (a tour room unvisited for S.tourStarveS may borrow one of them, as long as the Pit keeps one: the far rooms —
      // the Nap Nook is out of every desk's work-call reach — have nobody else)
      const done = !moveOver && r.zone !== 'PIT' && loungingDone(l) && (spareDone > 0 || (starved === r && pitLoungeN > 1));
      if (!done && !moveOver && (!l.free || (l.idleMs ?? 0) < S.regularMinIdleMs)) continue;
      // [BRN M3.5] §6.4.2: an idle regular's work call home must fit the dash budget (the Café from a W-bay desk took 9.9 s)
      const home = l.bstatus === 'done' ? 0 : director?.tagDist?.(l.id, r.tag) ?? 0;
      if (home > S.regularDeskCapM) continue;
      const d = Math.sqrt(d2(l.pos, r.near)) + ((l.level ?? 0) !== r.level ? 10 : 0) + ((restUntil.get(l.id) ?? -Infinity) > t ? 1000 : 0) + (done ? 30 : 0) + (moveOver ? 15 : 0);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  // ------------------------------------------------------------------------------------------ cameos + boot cast
  // [BRN fix m2-fix1] (fun review m2: big rooms stayed empty for 15–24 s while the player looked at them) the zone the
  // player's camera is in gets a visitor within ~20 s: empty of settled agents for S.cameoAfterS → one agent is cast
  // (claim gig, S.cameoS) to the zone's pick tag (the Pit: until it has T.pitKeep); honest like every gig (a status
  // change ends it).
  /** zone → [{tag, spot}] (every S.cameoTags spot in the zone: by tag priority, then nearest the zone's centre first) */
  const cameoZones = new Map<string, CameoSpot[]>();
  if (hq) {
    const zc = new Map((layout?.zones ?? []).map((z): [string, { id: string; rect: readonly number[] }] => [z.id, z]));
    (S.cameoTags ?? []).forEach((tag, ti) => {
      for (const s of director?.spotsOf?.(tag) ?? []) {
        const zn = zoneOfSpot(s);
        if (!zn || S.cameoSkipZones?.includes(zn)) continue;
        const z = zc.get(zn);
        const cx = z ? (z.rect[0] + z.rect[2]) / 2 : s.pos.x, cz = z ? (z.rect[1] + z.rect[3]) / 2 : s.pos.z;
        let list = cameoZones.get(zn);
        if (!list) cameoZones.set(zn, (list = []));
        list.push({ tag, spot: s, k: ti * 1000 + Math.hypot(s.pos.x - cx, s.pos.z - cz) });
      }
    });
    for (const list of cameoZones.values()) list.sort((a, b) => a.k - b.k);
  }
  let viewZone: string | null = null, viewEmptySince = 0, viewPos: P2 | null = null;
  const cameoCool = new Map<string, number>();
  /** spot id → local t until which a cameo does not try it again (its visitor could not claim it: held, a live bay) */
  const cameoBad = new Map<string, number>();
  function updateCameo(t: number) {
    const zn = viewZone, list = zn ? cameoZones.get(zn) : null;
    if (!zn || !list) return;
    // (the Pit wants its T.pitKeep loungers; any other zone one visitor; cameos in flight to it count)
    const wantN = zn === 'PIT' ? pitKeep() : 1;
    let here = 0;
    for (const l of byId.values()) {
      const g = gigs.get(l.id);
      if (g?.cameo === zn || (!l.moving && l.settledAt && zoneOfLite(l) === zn) || (zn === 'PIT' && homingDone(l))) here++;
    }
    if (here >= wantN) { viewEmptySince = t; return; }
    if (t - viewEmptySince < S.cameoAfterS || (cameoCool.get(zn) ?? -Infinity) > t) return;
    // the zone's first spot nobody holds (a claim gig for exactly that spot: near it, S.cameoClaimM of path)
    // (not right by the player: a visitor walking up to a seat next to the camera would have to squeeze past it)
    // ([BRN fix m3-r2] and never one inside the player's personal space or a view cone: director.spotOk)
    const ok = (q: CameoSpot) => !held(q.spot) && !((cameoBad.get(q.spot.id) ?? -Infinity) > t) && (director?.spotOk?.(q.spot) ?? true);
    const e = list.find((q) => ok(q) && !(viewPos && d2(q.spot.pos, viewPos) < S.cameoPlayerR ** 2)) ?? list.find(ok);
    if (!e) { cameoCool.set(zn, t + S.cameoCoolS); return; }
    // (near = the spot's step-out point: a sofa / beanbag seat itself sits inside its furniture, off the nav grid)
    const ap = director?.approach?.(e.spot) ?? e.spot.pos;
    const cz = { zone: zn, tag: e.tag, near: { x: ap.x, z: ap.z, level: e.spot.level ?? 0 }, level: e.spot.level ?? 0 };
    const c = pickCameo(cz, t);
    if (!c) return;
    const old = gigs.get(c.id);
    if (old?.regular) restUntil.set(c.id, t + S.regularRestS);
    const len = S.cameoS[0] + rnd(`cm|${c.id}|${Math.floor(t)}`) * (S.cameoS[1] - S.cameoS[0]);
    assign(c.id, { kind: 'claim', tag: cz.tag, near: cz.near, x: cz.near.x, z: cz.near.z, yaw: 0, level: cz.level, until: t + len,
      maxLen: S.cameoClaimM, spotId: e.spot.id, speed: S.cameoSpeed, cameo: zn, mode: c.bstatus === 'done' ? 'done' : 'idle' });
    counts.cameos = (counts.cameos ?? 0) + 1;
    viewEmptySince = t; // (the next one, if the zone wants more, after another S.cameoAfterS)
  }
  /** the cameo's visitor: nearest free idle, else a touring regular, else a done agent out / a spare Pit lounger */
  function pickCameo(cz: CameoTarget, t: number): Lite | null {
    let best: Lite | null = null, bd = Infinity;
    for (const l of byId.values()) {
      const g = gigs.get(l.id);
      let pen = 0;
      // (what the player looks at comes first: any idle regular of another room may be borrowed, and a done lounger
      // as long as the Pit keeps one — the showcase rooms are refilled by their own casting once it is free again)
      if (l.bstatus === 'idle') {
        const free = l.free && !g && (l.idleMs ?? 0) >= S.cameoMinIdleMs;
        // (a touring regular, or one of a showcase room ranked below the viewed one: never the Café's / the Pit's for a bay)
        const reg = !!g?.regular && roomOfZone.get(cz.zone) !== g.regular && l.castable
          && (tourZone.has(g.regular) || roomRank(g.regular) > roomRank(roomOfZone.get(cz.zone) ?? ''));
        if (!free && !reg) continue;
        if ((director?.tagDist?.(l.id, cz.tag) ?? 0) > S.regularDeskCapM) continue; // (§6.4.2 work call home)
        pen = reg && g?.regular !== undefined ? (tourZone.has(g.regular) ? 10 : 20) : 0;
      } else if (l.bstatus === 'done' && (!g || (g.regular && roomOfZone.get(cz.zone) !== g.regular && (tourZone.has(g.regular) || roomRank(g.regular) > roomRank(roomOfZone.get(cz.zone) ?? ''))))
        && (outingDone(l) || (cz.zone !== 'PIT' && loungingDone(l) && pitLoungeN > 1))) pen = 30;
      else continue;
      const d = Math.sqrt(d2(l.pos, cz.near)) + ((l.level ?? 0) !== cz.level ? 10 : 0) + pen + ((restUntil.get(l.id) ?? -Infinity) > t ? 15 : 0);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  /**
   * Cold start (§6.4.3; the canonical review poses are shot seconds after boot): idle agents whose idle age is unknown
   * (statusSinceApprox) or already past the fresh-idle desk read begin their stay as a showcase regular — the Café, the
   * Pit (two, the done loungers count), the Library, then the touring rooms — and are cold-placed there.
   * `ents`: the entities being cold-placed this frame.
   */
  function bootCast(ents: readonly Entity[], t: number, nowMs: number) {
    if (!hq || !ents.length) return 0;
    let pitN = 0;
    for (const e of ents) if (e.kind !== 'shell' && e.status === 'done' && !e.ack) pitN++;
    const order: Room[] = [];
    for (const r of rooms) { if (r.zone === 'PIT' && pitN > 0) { pitN--; continue; } order.push(r); }
    order.push(...tour);
    const idle = ents.filter((e) => e.kind !== 'shell' && (e.status === 'idle' || (e.status === 'done' && e.ack)) && !gigs.has(e.id)
      && (e.statusSinceApprox || nowMs - (e.statusSince ?? nowMs) >= S.regularMinIdleMs)).sort((a, b) => (a.id < b.id ? -1 : 1));
    let n = 0, ri = 0;
    for (const e of idle) {
      for (let k = 0; k < order.length; k++) {
        const r = order[(ri + k) % order.length];
        if ((director?.tagDist?.(e.id, r.tag) ?? 0) > S.regularDeskCapM) continue;
        const len = S.regularS[0] + rnd(`rg|${e.id}|boot`) * (S.regularS[1] - S.regularS[0]);
        assign(e.id, { kind: 'claim', tag: r.tag, near: r.near, x: r.near.x, z: r.near.z, yaw: 0, level: r.level, until: t + len, len,
          speed: S.regularSpeed, regular: r.zone, mode: 'idle' });
        counts.regulars = (counts.regulars ?? 0) + 1;
        order.splice((ri + k) % order.length, 1);
        ri = order.length ? (ri + k) % order.length : 0;
        n++;
        break;
      }
      if (!order.length) break;
    }
    return n;
  }

  // ------------------------------------------------------------------------------------------ Big Board huddle
  const huddleNow = (minIdle: number) => huddle(now, 'finished', minIdle);
  function huddle(t: number, why: 'finished' | 'ambient', minIdle: number = S.minIdleMs, finisher: Lite | null = null) {
    // [BRN M3.5] every `finished` gathers a huddle (its own short cooldown): the finisher itself (after its desk victory,
    // on its way to the Pit: "that's me up there!") with the Pit's done loungers / done agents out and about / free idle ones
    if (!pit || !rim.length || t - lastHuddle < (why === 'finished' ? S.huddleFinishedCooldownS : S.huddleCooldownS)) return false;
    const fin = why === 'finished';
    const cand = castNear(pit, S.huddleR, minIdle, { not: finisher?.id ?? null, steal: fin, outing: fin }).slice(0, S.huddleMax - (finisher ? 1 : 0));
    if (fin) for (const l of cand) { const old = gigs.get(l.id); if (old?.regular) { restUntil.set(l.id, t + S.regularRestS); gigs.delete(l.id); } }
    if (finisher && !gigs.has(finisher.id) && cand.length) cand.push(finisher);
    if (cand.length < S.huddleMin) return false;
    lastHuddle = t;
    const len = S.huddleS[0] + rnd(`h|${t}`) * (S.huddleS[1] - S.huddleS[0]);
    // each walker takes the free rim spot nearest to it (in walk order), ≥ 1.0 m from the others
    const used: Rim[] = [];
    cand.forEach((l, i) => {
      let best: Rim | null = null, bd = Infinity;
      for (const s of rim) {
        if (used.some((u) => d2(u, s) < 1.0)) continue;
        // keep the group together: within 3.2 m of the first spot
        if (used.length && d2(used[0], s) > 3.2 * 3.2) continue;
        const dd = Math.sqrt(d2(s, l.pos)) + (used.length ? 0 : 4 * angD(s.a, rimPref)); // the group's anchor: the far arc
        if (dd < bd) { bd = dd; best = s; }
      }
      if (!best) return;
      used.push(best);
      const fin = l === finisher; // (its desk victory + the walk over come first: it stays a little longer)
      assign(l.id, { kind: 'huddle', x: best.x, z: best.z, yaw: best.yaw, level: 0, look: boardLook, until: fin ? t + S.huddleFinisherS : t + len, speed: fin ? 1.6 : 1.25,
        gait: fin ? 'skip' : undefined, mode: fin || l.bstatus === 'done' ? 'done' : 'idle', chat: true, lead: i % 2 === 0, icons: why === 'finished' ? ['check', 'star', 'heart', 'check'] : ['bulb', 'note', 'star', 'coffee'] });
      if (i === 0) poke(l.id, 'wave', 0); // "look!" — an arm up toward the Board as the group sets off
    });
    if (used.length) counts.huddles++;
    return used.length > 0;
  }

  // ------------------------------------------------------------------------------------------ API
  return {
    /** Per frame, after the brains ran. `t`: local seconds. */
    update(t: number, lites: readonly Lite[]) {
      now = t;
      byId.clear();
      for (const l of lites) byId.set(l.id, l);
      // drop gigs whose actor left, is no longer idle, ran out, or whose scene ended
      for (const [id, g] of gigs) {
        const l = byId.get(id);
        // (a done gig: done — or done still pending the brain's 1.5 s hysteresis, the freshly finished agent's huddle)
        const stOk = g.mode === 'done' ? l?.bstatus === 'done' || (l?.status === 'done' && l.bstatus !== 'idle') : l?.bstatus === 'idle';
        let end = !l || !stOk || t >= g.until;
        if (!end && g.kind === 'watch' && !rally) g.until = Math.min(g.until, (g.rallyGone ??= t) + 1.8); // clap the last point, then go
        if (!end && g.kind === 'claim' && g.host) { // the host walked off: the invite is over
          const h = byId.get(g.host);
          if (!h || h.bstatus !== 'idle' || (!h.moving && h.settledAt && !(h.settledAt.startsWith('slot:pingpong') || h.settledAt.startsWith('slot:coffee')))) g.until = Math.min(g.until, t + 2);
        }
        if (!end && l && g.kind === 'claim' && l.declined === g.key) end = true;
        if (!end && l && g.kind === 'congrats') end = congratsStep(g, l, t);
        // the huddle's lead points up at the Board now and then ("see? there!"), the others nod along with a hop
        if (!end && l && g.kind === 'huddle' && !l.moving && l.settledAt?.startsWith('pt:huddle') && t >= (g.nextBeat ??= t + 1.2)) {
          g.nextBeat = t + 4 + rnd(`hb|${id}|${Math.floor(t)}`) * 3.5;
          poke(id, g.lead ? 'wave' : rnd(`hn|${id}|${Math.floor(t)}`) < 0.5 ? 'hop' : 'clap');
        }
        if (end && g.cameo && l && l.declined === g.key && g.spotId !== undefined) cameoBad.set(g.spotId, t + 30); // [BRN fix m2-fix1] (try another spot)
        if (end) { if (g.regular) { restUntil.set(id, t + S.regularRestS); if (l && l.declined === g.key) roomCool.set(g.regular, t + 20); } gigs.delete(id); }
      }
      if (!hq) return;
      inboxZero(t);
      slow = t >= nextSlow; // invites / audience / coffee: 4 Hz is plenty (and keeps the per-frame cost flat)
      if (slow) nextSlow = t + 0.25;
      updateRally(t);
      if (slow) { rallyFloor(t); updateWatchers(t); if (!night) updateCoffee(t); updateRegulars(t); updateCameo(t); passFives(t); }
      if (t >= nextAmbientHuddle) {
        if (nextAmbientHuddle && !night) huddle(t, 'ambient'); // ([BRN fix m3-r2] not after dark: the hearth gathering)
        nextAmbientHuddle = t + S.huddleAmbientS[0] + rnd(`ha|${Math.floor(t)}`) * (S.huddleAmbientS[1] - S.huddleAmbientS[0]);
      }
    },
    /**
     * Something happened to actor `id` (actors.ts broadcast / brain emit): `finished` → congrats visit + maybe a Board
     * huddle; `pitArrive` → the welcome wave around the Pit.
     */
    /** [BRN fix m3-r3] bus 'inbox.zero' ran the office-wide cheer (actors.ts): the blocked-count clap ripple stays quiet */
    zeroed(t: number) { cool.set('zero', t + 20); },
    signal(kind: string, id: string, t: number) {
      now = t;
      const a = byId.get(id);
      if (!a || !hq) return;
      if (kind === 'finished') {
        // only a real finish (the entity is done): a slide-exit `victory` beat also broadcasts 'finished' to neighbours
        if ((a.status !== 'done' && a.bstatus !== 'done') || !coolOk(`fin|${id}`, 8)) return;
        congrats(a, t);
        huddle(t, 'finished', S.huddleFinishedMinIdleMs, a); // [BRN M3.5] on every finish (was a 70 % chance)
      } else if (kind === 'pitArrive') pitWave(a, t);
      else if (kind === 'highFive') counts.highFives++; // [BRN M3.5] the Pit-arrival high-five (brain.ts done())
      else if (kind === 'ship' || kind === 'commit') cheer(a, t, kind);
    },
    gigFor: (id: string) => gigs.get(id) ?? null,
    /** [BRN fix m2-r2] is this showcase room (zone id) empty right now (as of the last regulars pass, 4 Hz)? */
    // ([BRN fix m2-fix1] a yes books the room for S.roomBookS: the next asker in the same moment goes elsewhere — four
    // done loungers used to leave for the one empty Café at once)
    roomEmpty(zone: string) {
      if (!emptySince.has(zone) || (booked.get(zone) ?? -Infinity) > now) return false;
      booked.set(zone, now + S.roomBookS);
      return true;
    },
    /** [BRN fix m2-fix1] may one more done lounger leave the Pit (more than T.pitKeep lounging there, 4 Hz)? A yes
     * counts it gone at once (two loungers asking in one frame cannot both leave) */
    pitSpare: () => (pitLoungeN > pitKeep() ? (pitLoungeN--, pitBoundN--, true) : false), // (a yes takes the spare seat)
    /** [BRN fix m3-r2] the local hour (actors.ts, ctx.hour): after dark the Pit hearth gathers the free agents */
    setHour(h: number | null | undefined) {
      const n = isNight(h);
      if (n === night || !hq) return;
      night = n;
      rooms = night ? roomsNight : roomsDay;
    },
    isNight: () => night,
    /** [BRN fix m2-fix1] the zone the player's camera is in (cameos); null = nobody looking */
    setView(zone: string | null, pos: P2 | null = null) { viewPos = pos; if (zone !== viewZone) { viewZone = zone; viewEmptySince = now; } },
    bootCast,
    /** a freshly done agent waits at its desk (≤ 4 s) while a pod-mate is on the way for the high-five */
    holdFor(id: string) {
      for (const g of gigs.values()) if (g.kind === 'congrats' && g.target === id && !g.done) return true;
      return false;
    },
    /** the swing phase (0..1) of a rallying player, else null */
    syncFor: (id: string) => sync.get(id) ?? null,
    rallyFor: (id: string) => (rally && (rally.a === id || rally.b === id) ? ball : null),
    ball,
    /** due reactions → fn(id, reaction) */
    pullPokes(t: number, fn: (id: string, reaction: string) => void) {
      for (let i = 0; i < pokes.length;) {
        if (pokes[i].at <= t) { const p = pokes[i]; pokes.splice(i, 1); fn(p.id, p.r); } else i++;
      }
    },
    forget(id: string) { gigs.delete(id); sync.delete(id); restUntil.delete(id); },
    rekey(oldId: string, newId: string) { const g = gigs.get(oldId); if (g) { gigs.delete(oldId); gigs.set(newId, g); } },
    /**
     * Debug / review shots: start a scene now with any free idle agents (ignores chances, cooldowns and the idle
     * minimum). 'rally' casts two players at the table, 'huddle' gathers at the Board, 'watch' adds a spectator.
     * Returns the ids cast.
     */
    stage(kind: string): string[] {
      const free = () => [...byId.values()].filter((l) => (l.free && !gigs.has(l.id)) || (!gigs.has(l.id) && loungingDone(l)));
      if (kind === 'rally' && pp.length === 2) {
        const f = free().sort((x, y) => d2(x.pos, pp[0].pos) - d2(y.pos, pp[0].pos)).slice(0, 2);
        f.forEach((l, i) => assign(l.id, { kind: 'claim', tag: 'pingpong', near: pp[i].pos, x: pp[i].pos.x, z: pp[i].pos.z, yaw: pp[i].yaw, level: 0, until: now + 90, speed: 2.2 }));
        return f.map((l) => l.id);
      }
      if (kind === 'huddle') { lastHuddle = -Infinity; return huddleNow(0) ? [...gigs].filter(([, g]) => g.kind === 'huddle').map(([id]) => id) : []; }
      if (kind === 'watch') { cool.delete('watch'); const n = gigs.size; forceWatch = true; updateWatchers(now); forceWatch = false; return gigs.size > n ? ['ok'] : []; }
      return [];
    },
    counts: (): SocialCounts => ({ ...counts, gigs: gigs.size, rally: rally ? { a: rally.a, b: rally.b, point: rally.point, n: rally.n } : null }),
    debug: () => ({ rooms: [...rooms, ...tour].map((r) => `${r.zone}@${r.near.x.toFixed(1)},${r.near.z.toFixed(1)}`), gigs: [...gigs].map(([id, g]) => ({ id, kind: g.kind, until: +(g.until - now).toFixed(1) })), watchSpots: watchSpots.length, rim: rim.length,
      rallyFloor: { cand: rallyCand, want: rallyWant, at: rallyAt, coolUntil: rallyCoolUntil, now } }),
  };

  /**
   * A free pod-mate close to the finished agent's desk trots over; both high-five when it gets there. The visitor and
   * the spot beside the chair (aisle side, either hand) are picked by walking distance (pods put a desk row between
   * two desks that are close as the crow flies), ≤ S.congratsPathM.
   */
  function congrats(a: Lite, t: number) {
    const home = director?.slotFor?.(a.id);
    if (!home || home.pose !== 'sit' || rnd(`cg|${a.id}|${Math.floor(t)}`) >= S.congratsChance) return;
    const lv = home.level ?? 0;
    const fx = -Math.sin(home.yaw), fz = -Math.cos(home.yaw);
    const spots: { x: number; z: number; level: number }[] = [];
    for (const side of [1, -1]) for (const back of [0.7, 0.95]) {
      const x = home.pos.x - fx * back + fz * side * 0.5, z = home.pos.z - fz * back - fx * side * 0.5;
      if (walk(x, z, lv)) spots.push({ x, z, level: lv });
    }
    let best: { x: number; z: number; level: number } | null = null, who: Lite | null = null, bd: number = S.congratsPathM;
    for (const c of freeNear(home.pos, S.congratsR, 0, lv, a.id).slice(0, 3)) {
      const from = { x: c.pos.x, z: c.pos.z, level: c.level ?? 0 };
      for (const s of spots) {
        const d = director?.pathLen ? director.pathLen(from, s, c.id) : Math.sqrt(d2(from, s));
        if (Number.isFinite(d) && d < bd) { bd = d; best = s; who = c; }
      }
    }
    if (!best || !who) return;
    assign(who.id, { kind: 'congrats', target: a.id, x: best.x, z: best.z, yaw: faceTo(best, home.pos), level: lv,
      look: a.pos, until: t + S.congratsS, speed: S.congratsSpeed, gait: 'skip', done: false });
  }
  /** congrats gig per frame: on arrival, the high-five (or a wave if the done agent already left). Returns end? */
  function congratsStep(g: Gig, l: Lite, t: number): boolean {
    if (g.done) return false;
    if (l.moving || !l.settledAt || !l.settledAt.startsWith('pt:congrats')) return false;
    const tgt = g.target === undefined ? undefined : byId.get(g.target);
    g.done = true;
    if (tgt && !tgt.moving && d2(tgt.pos, l.pos) < 1.6 * 1.6) {
      poke(l.id, 'highFive', 0); poke(tgt.id, 'highFive', 0.05);
      counts.highFives++;
    } else poke(l.id, 'wave', 0);
    g.until = Math.min(g.until, t + 2.4);
    return false;
  }
  /**
   * Inbox zero (reviewer idea "celebrate inbox zero in the world too"): the last blocked agent was answered → the idle
   * and done agents around the Help Desk / atrium applaud (a staggered ripple of claps and hops). True by
   * construction: it fires only on the frame the office's blocked count drops to 0.
   */
  function inboxZero(t: number) {
    let n = 0;
    for (const l of byId.values()) if (l.bstatus === 'blocked') n++;
    const was = blockedPrev;
    blockedPrev = n;
    if (!(was > 0 && n === 0) || !queueHead || !coolOk('zero', 20)) return;
    let k = 0;
    const cand: [number, string][] = [];
    for (const l of byId.values()) {
      if ((l.bstatus !== 'idle' && l.bstatus !== 'done') || l.moving || /nap|Nap|sleep/.test(l.phase ?? '')) continue;
      const dd = Math.min(d2(l.pos, queueHead), pit ? d2(l.pos, pit) : Infinity);
      if (dd < 11 * 11) cand.push([dd, l.id]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    for (const [, id] of cand.slice(0, 8)) poke(id, k % 3 === 2 ? 'hop' : 'clap', 0.3 + 0.18 * k++);
    if (k) counts.inboxZero = (counts.inboxZero ?? 0) + 1;
  }

  /**
   * [BRN M3.5] Rally floor (ideation GD #2): whenever ≥ 2 castable agents (free idle ≥ rallyMinIdleMs, an idle regular, or
   * a done Pit lounger) are within rallyR of the table, a rally is cast within rallyDelayS (≤ 90 s: the delay is drawn
   * once per "wanting" stretch, rallyCooldownS after the previous rally). Idle first, then done, then a regular (its
   * stint ends early); the pair is matched to the two ends by distance. A player already standing at the table (its own
   * chill pick) is left to the lone-player invite.
   */
  function rallyFloor(t: number) {
    if (pp.length !== 2 || !table) return;
    if (rally) { rallyCoolUntil = t + S.rallyCooldownS; rallyWant = null; rallyEndT = t; rallied = true; return; }
    for (const g of gigs.values()) if (g.tag === 'pingpong') { rallyWant = null; return; } // on their way
    if (held(pp[0]) || held(pp[1]) || t < rallyCoolUntil) return;
    if (night) { rallyWant = null; return; } // [BRN fix m3-r2] after dark the free agents gather at the hearth instead
    // ([BRN fix m2-fix1] the Pit keeps its two loungers; after S.rallyDroughtS without a rally, the table — at the Pit's
    // rim, in the Pit's view — may take it down to one for a game)
    // (one lounger at most; with no game yet S.rallyDroughtS in, both players may come from the Pit — the rally floor;
    // never right at boot: the review poses are shot then, and the Pit's loungers are the atrium's picture)
    const dry = t - rallyEndT;
    const cand = castNear(table.pos, S.rallyR, S.rallyMinIdleMs, { steal: true, outing: true, preferDone: true,
      pitFloor: dry <= S.rallyDroughtS ? pitKeep() : !rallied ? 0 : Math.max(1, Math.min(pitKeep(), pitBoundN - 1)) });
    rallyCand = cand.length;
    // (the wish outlives a short dip below two — somebody walked past the edge of the radius — for rallyWantHoldS)
    if (cand.length < 2) { if (rallyWant !== null && t - rallyLast2 > S.rallyWantHoldS) rallyWant = null; return; }
    rallyLast2 = t;
    if (rallyWant === null) { rallyWant = t; rallyAt = t + S.rallyDelayS[0] + rnd(`rw|${Math.floor(t)}`) * (S.rallyDelayS[1] - S.rallyDelayS[0]); }
    if (t < rallyAt) return;
    rallyWant = null;
    const [p, q] = cand;
    const swap = Math.sqrt(d2(p.pos, pp[1].pos)) + Math.sqrt(d2(q.pos, pp[0].pos)) < Math.sqrt(d2(p.pos, pp[0].pos)) + Math.sqrt(d2(q.pos, pp[1].pos));
    const len = S.rallyGigS[0] + rnd(`rf|${p.id}|${Math.floor(t)}`) * (S.rallyGigS[1] - S.rallyGigS[0]);
    [p, q].forEach((l, i) => {
      const s = pp[swap ? 1 - i : i], old = gigs.get(l.id);
      if (old?.regular) restUntil.set(l.id, t + S.regularRestS);
      gigs.delete(l.id);
      assign(l.id, { kind: 'claim', tag: 'pingpong', near: s.pos, x: s.pos.x, z: s.pos.z, yaw: s.yaw, level: 0, until: t + len,
        speed: S.rallyWalkSpeed, gait: 'skip', mode: l.bstatus === 'done' ? 'done' : 'idle' });
    });
    poke(p.id, 'wave', 0.1); // "game?" — "game!"
    poke(q.id, 'hop', 0.4);
    counts.invites++;
  }

  /**
   * [BRN M3.5] High-fives in passing: a done agent passing an awake idle / done colleague (at least one of them walking,
   * within passFiveR) — both slap hands on the way. Each agent at most once per passCooldownS.
   */
  function passFives(t: number) {
    passL.length = 0;
    for (const l of byId.values()) if ((l.bstatus === 'done' || l.bstatus === 'idle') && !/nap|Nap|sleep|slide|Slide/.test(l.phase ?? '') && !l.riding) passL.push(l);
    const R2 = S.passFiveR * S.passFiveR;
    for (let i = 0; i < passL.length; i++) for (let j = i + 1; j < passL.length; j++) {
      const a = passL[i], b = passL[j];
      if ((!a.moving && !b.moving) || (a.bstatus !== 'done' && b.bstatus !== 'done') || (a.level ?? 0) !== (b.level ?? 0) || d2(a.pos, b.pos) > R2) continue;
      if ((cool.get(`pf|${a.id}`) ?? -Infinity) > t || (cool.get(`pf|${b.id}`) ?? -Infinity) > t) continue;
      cool.set(`pf|${a.id}`, t + S.passCooldownS); cool.set(`pf|${b.id}`, t + S.passCooldownS);
      poke(a.id, 'highFive', 0); poke(b.id, 'highFive', 0.05);
      counts.highFives++; counts.passFives++;
    }
  }

  /**
   * [BRN M3.5] Cheer the ship (§11.5 BRN idea): a parcel drops into the OUTBOX chute ('ship', the sign-off run) or an
   * agent commits ('commit') → the awake idle / done agents within cheerR look over (actors.ts broadcast) and up to
   * cheerMax of them clap / hop in a little ripple.
   */
  function cheer(a: Lite, t: number, kind: string) {
    if (!coolOk(`ch|${kind}|${a.id}`, 6)) return;
    const cand: [number, string][] = [];
    for (const l of byId.values()) {
      if (l === a || (l.bstatus !== 'idle' && l.bstatus !== 'done') || l.moving || /nap|Nap|sleep/.test(l.phase ?? '') || (l.level ?? 0) !== (a.level ?? 0)) continue;
      const dd = d2(l.pos, a.pos);
      if (dd <= S.cheerR * S.cheerR) cand.push([dd, l.id]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    let k = 0;
    for (const [, id] of cand.slice(0, S.cheerMax)) poke(id, k === 0 ? 'clap' : k % 2 ? 'hop' : 'clap', 0.25 + 0.2 * k++);
    if (kind === 'ship') poke(a.id, 'hop', 0.1);
    if (k || kind === 'ship') counts.cheers++;
  }

  /** The done agents already in the Pit clap in turn around the ring, starting next to the newcomer. */
  function pitWave(a: Lite, t: number) {
    if (!pit || !coolOk(`pw|${a.id}`, 20) || !coolOk('pw', 6)) return; // (a done crowd: one wave at a time)
    const a0 = Math.atan2(a.pos.x - pit.x, a.pos.z - pit.z);
    const ring: [number, string][] = [];
    for (const l of byId.values()) {
      if (l === a || l.bstatus !== 'done' || l.moving || !l.settledAt || d2(l.pos, pit) > 3.3 * 3.3) continue;
      if (/Nap/.test(l.phase ?? '')) continue; // sleepers sleep through it
      let da = Math.atan2(l.pos.x - pit.x, l.pos.z - pit.z) - a0;
      da = ((da % TAU) + TAU) % TAU;
      ring.push([da, l.id]);
    }
    if (!ring.length) return;
    ring.sort((x, y) => x[0] - y[0]);
    ring.length = Math.min(ring.length, 12);
    ring.forEach(([, id], i) => poke(id, i % 2 ? 'hop' : 'clap', 0.35 + i * S.waveStaggerS));
    counts.pitWaves++;
  }
}
