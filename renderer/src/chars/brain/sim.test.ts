// The M1.5 behaviour gate (DESIGN §11 M1.5, §6.4.2, §6.5) as a unit test: the headless sim (`walktimes --sim`) over
// several seeds, so the gate cannot pass on the default seed by luck. Deterministic (FakeClock + seeded demo); about
// 1 s per 10-minute run. Owner: BRN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSim, SIM_ACCEPT } from './sim.ts';
import { layout } from '../../world/layout/hq.ts';
import { createNav } from '../../world/nav/index.ts';
import { must } from './testkit.ts';
import type { Actors, ActorMetrics } from '../actors.ts';
import type { Director } from './director.ts';
import type { Rect } from '../../world/layout/schema.ts';

const nav = createNav(layout);
const MIN = 10;

for (const seed of [1, 2, 3]) {
  test(`M1.5 gate: --sim mixed, 10 min, seed ${seed}`, async () => {
    const { metrics: m, misses } = await runSim({ layout, nav, scenario: 'mixed', minutes: MIN, seed });
    const A = SIM_ACCEPT.mixed;
    const tag = `seed ${seed}: ${JSON.stringify({ wwp: m.walkWhileWorkingPct, call: m.workCallS, slide: m.slideRides, stairs: m.stairClimbs, zones: m.zoneVisits })}`;
    // every §11 M1.5 metric, asserted one by one (not only through `misses`, so a dropped check still fails here)
    assert.ok(m.walkWhileWorkingPct <= A.walkWhileWorkingPct, `walkWhileWorkingPct ${tag}`);
    assert.ok(m.workCallS.p90 <= A.workCallP90, `workCallS.p90 ${tag}`);
    assert.ok(m.workCallPct <= A.workCallPct, `workCallPct ${tag}`);
    assert.ok(m.workCallS.n >= 3, `work calls happen at all ${tag}`);
    assert.ok(m.slideRides >= A.slideRides, `slideRides ${tag}`);
    assert.ok(m.stairClimbs >= A.stairClimbs, `stairClimbs ${tag}`);
    for (const z of ['MAIL', 'ARC']) assert.ok((m.zoneVisits[z] ?? 0) >= Math.floor(MIN / 3) * A.mailArcPer3Min, `${z} visits ${tag}`);
    // [BRN fix r2] gameplay review r2: the far ground floor gets used too (outings: long idle, hobby, done in the Pit)
    for (const z of ['CAF', 'NAP']) assert.ok((m.zoneVisits[z] ?? 0) >= A.outingZoneVisits, `${z} visits ${tag}`);
    assert.ok(['W1', 'W2', 'W3'].some((z) => (m.zoneVisits[z] ?? 0) >= A.outingZoneVisits), `a W amenity bay visited ${tag}`);
    assert.deepEqual(misses, []);
  });
}

test('M1.5 gate: --sim trio ≥ 1 slide ride / 10 min (seeds 1–3)', async () => {
  for (const seed of [1, 2, 3]) {
    const { metrics: m, misses } = await runSim({ layout, nav, scenario: 'trio', minutes: MIN, seed });
    assert.ok(m.slideRides >= SIM_ACCEPT.trio.slideRides, `seed ${seed} slideRides ${m.slideRides}`);
    assert.ok(m.workCallS.p90 <= SIM_ACCEPT.mixed.workCallP90, `seed ${seed} work call p90 ${m.workCallS.p90}`);
    assert.deepEqual(misses, []);
  }
});

test('churn soak: per-actor bookkeeping tracks the live actors, not the history (§9.1)', async () => {
  const acc: { peak: number; last: ReturnType<Actors['sizes']> | null; live: number } = { peak: 0, last: null, live: 0 };
  const seen = new Set<string>();
  await runSim({ layout, nav, scenario: 'churn', minutes: 6, seed: 1, onFrame: ({ actors }) => {
    const sz = acc.last = actors.sizes(); acc.live = actors.count();
    for (const a of actors.list()) seen.add(a.id);
    acc.peak = Math.max(acc.peak, sz.zoneOf + sz.inCall);
  } });
  const { peak, last, live } = acc;
  assert.ok(last);
  assert.ok(last.zoneOf <= last.actors && last.inCall <= last.actors, JSON.stringify(last));
  assert.ok(last.arrivedAt <= last.actors + 4 && last.events <= 128, JSON.stringify(last));
  assert.ok(peak <= 2 * 40, `peak ${peak}`);
  assert.ok(live <= last.actors);
  assert.ok(seen.size > 4 * last.actors, `the scenario churned (${seen.size} ids over the run)`);
});

// Anim review (M1 carryover, M1.5 r1): walkers passed through the camera — tinker walked into a hero camera 1.5 m
// from its desk, parcel carriers brushed the lens. A stand-in player re-poses next to a random actor every 12 s (a
// hero camera); no walker may come closer than 0.85 m (body 0.36 + ~0.5 m in front of the lens).
test('walkers keep clear of a player standing next to them (hero cameras, mixed, seeds 1–2)', async () => {
  for (const seed of [1, 2]) {
    const player = { pos: { x: 0, y: 0, z: 12.5 }, level: 0 };
    let k = 0, r = seed * 9301, min = Infinity, who = '';
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    await runSim({ layout, nav, scenario: 'mixed', minutes: 6, seed, player, onFrame: ({ t, actors, director }) => {
      const L = actors.list();
      if (t >= k * 12 + 1 && L.length) {
        k++;
        const a = L[Math.floor(rnd() * L.length)];
        for (let i = 0; i < 24; i++) {
          const ang = rnd() * Math.PI * 2, d = 1.2 + rnd() * 0.8, x = a.pos.x + Math.cos(ang) * d, z = a.pos.z + Math.sin(ang) * d;
          if (director.walkable(x, z, a.level) && L.every((b) => Math.hypot(b.pos.x - x, b.pos.z - z) > 0.95)) {
            player.pos.x = x; player.pos.z = z; player.pos.y = layout.floorY(x, z, a.level); player.level = a.level;
            break;
          }
        }
      }
      for (const a of L) {
        if (!a.moving || (a.level ?? 0) !== player.level) continue;
        const d = Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z);
        if (d < min) { min = d; who = `${a.id} ${a.intent?.phase} t=${t.toFixed(1)}`; }
      }
    } });
    assert.ok(min >= 0.85, `seed ${seed}: a walker came ${min.toFixed(2)} m from the player (${who})`);
  }
});

// [BRN fix m175-r2] Play review r2: walkers passed straight through agents seated on the mezzanine hot-desk row (0.09 m)
// and through one another on the Pit floor (0.19–0.29 m). Other agents are soft obstacles now (side-step, squeeze,
// separation, a queue / slide one-at-a-time beat). crowd40 over 6 min: nobody walks through a hot-desk sitter, and
// pairs closer than 0.3 m (a body clip; bodies are 0.72 × 0.46 m) are rare blips, not a steady stream (the unfixed
// motor: ~1500 pair-frames per 10 min, ~250 at the hot desks).
test('crowd40: walkers keep off seated agents and each other (hot desks, the Pit)', async () => {
  const r = { hot: Infinity, clip: 0, pitClip: 0, frames: 0 };
  await runSim({ layout, nav, scenario: 'crowd40', n: 40, minutes: 6, seed: 1, onFrame: ({ actors }) => {
    const L = actors.list();
    r.frames++;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      if (a.level !== b.level || a.ride || b.ride || a.mode !== 'live' || b.mode !== 'live' || (!a.moving && !b.moving)) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 0.6) continue; // bunk beds
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      if (d > 0.6) continue;
      if ([a, b].some((x) => !x.moving && x.settledAt?.startsWith('slot:hotdesk'))) r.hot = Math.min(r.hot, d);
      if (d < 0.3) { r.clip++; if (a.level === 0 && Math.hypot(a.pos.x, a.pos.z) < 3.3) r.pitClip++; }
    }
  } });
  const tag = JSON.stringify(r);
  assert.ok(r.hot >= 0.25, `a walker passed through a hot-desk sitter ${tag}`);
  assert.ok(r.clip <= 120, `body clips ${tag}`);
  assert.ok(r.pitClip <= 60, `Pit body clips ${tag}`);
});

// [BRN fix m2-r1] §5.3 nav budget at crowd40 with the player in the Pit overview spot: never more than 2 fresh grid
// searches in a frame (forced slide / stairs routes are budgeted too), and the director's stats say so
test('§5.3 nav budget: crowd40, 1 min, player at pitOverview → ≤ 2 searches every frame, stats exposed', async () => {
  const nav2 = createNav(layout);
  let max = 0, frames = 0;
  const got: { stats: ReturnType<NonNullable<Director['navStats']>> | null } = { stats: null };
  await runSim({ layout, nav: nav2, scenario: 'crowd40', n: 40, minutes: 1, seed: 1, player: { pos: { x: 4.5, y: 0, z: 4.5 }, level: 0 },
    onFrame: ({ director }) => { frames++; max = Math.max(max, nav2.budgetStats().searches); if (frames % 300 === 0) got.stats = director.navStats?.() ?? null; } });
  const { stats } = got;
  assert.ok(max <= 2, `max searches in a frame ${max}`);
  assert.ok(stats && stats.maxSearchesPerFrame <= 2 && stats.searchesPerFrame < 0.5, JSON.stringify(stats));
  assert.ok(stats.bySource && 'brain' in stats.bySource && 'around' in stats.bySource && typeof stats.queue === 'number' && typeof stats.hitRate === 'number');
});

// [BRN fix m2-r1] §6.5 walk budget: trio over its first 100 s stays ≤ 20 % walking while working (gameplay review m2:
// 30.8 %), and avgTravelS is a mean walk-leg duration, not a sum
test('trio first 100 s: walkWhileWorkingPct ≤ 20, avgTravelS a sane mean (seeds 1–5)', async () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { metrics: m } = await runSim({ layout, nav, scenario: 'trio', minutes: 100 / 60, seed });
    assert.ok(m.walkWhileWorkingPct <= 20, `seed ${seed} wwp ${m.walkWhileWorkingPct.toFixed(1)}`);
    assert.ok(m.avgTravelS > 1 && m.avgTravelS < 40, `seed ${seed} avgTravelS ${m.avgTravelS}`);
  }
});

// [BRN fix m2-r1] storefronts and the café get visitors in mixed (gameplay review m2: 0 visits to STR / CAF in 200 s)
test('mixed 200 s: the street, the café and the library get visitors (seeds 1–3)', async () => {
  for (const seed of [1, 2, 3]) {
    const { metrics: m } = await runSim({ layout, nav, scenario: 'mixed', minutes: 200 / 60, seed });
    for (const z of ['STR', 'CAF', 'LIB']) assert.ok((m.zoneVisits[z] ?? 0) >= 1, `seed ${seed} ${z} ${JSON.stringify(m.zoneVisits)}`);
    assert.ok(m.walkWhileWorkingPct <= 20, `seed ${seed} wwp ${m.walkWhileWorkingPct.toFixed(1)}`);
  }
});

// [BRN fix m2-r2] gameplay review m2-r2: the destination rooms were empty whenever you visited them (live renderer,
// mixed: Café 16 %, Library 8 %). Target: with ≥ 3 non-working agents, somebody is settled in the Café ≥ 50 % and in the
// Library ≥ 30 % of the time (sampled every 2 s after the first 30 s; shells count as agents, as in the review).
test('showcase dwell floor: Café ≥ 50 %, Library ≥ 30 % occupied while ≥ 3 agents are not working (mixed, seeds 1–3)', async () => {
  for (const seed of [1, 2, 3]) {
    let n = 0, caf = 0, lib = 0, next = 30;
    await runSim({ layout, nav, scenario: 'mixed', minutes: MIN, seed, onFrame: ({ t, actors }) => {
      if (t < next) return;
      next += 2;
      const L = actors.list();
      if (L.filter((a) => a.entity?.status && a.entity.status !== 'working').length < 3) return;
      n++;
      const inZ = (z: string) => L.some((a) => !a.moving && a.settledAt && (a.level ?? 0) === 0 && layout.zoneAt(a.pos.x, a.pos.z, 0) === z);
      if (inZ('CAF')) caf++;
      if (inZ('LIB')) lib++;
    } });
    assert.ok(n > 100, `seed ${seed}: enough samples (${n})`);
    assert.ok(caf / n >= 0.5, `seed ${seed}: Café occupied ${(100 * caf / n).toFixed(0)} % of ${n} samples`);
    assert.ok(lib / n >= 0.3, `seed ${seed}: Library occupied ${(100 * lib / n).toFixed(0)} % of ${n} samples`);
  }
});

// [BRN fix m2-r3] gameplay review m2-r3: in `longIdle` 4 of 6 agents kept one slot and one activity for 140 s+ (and the
// two Shellys dozed at their benches for good). P3 'nothing static for 60 s' in behaviour: no idle agent / prompt
// Shelly keeps the same (slot, activity) settled for more than 60 s; the showcase rooms are *settled* in (not walked to).
for (const scenario of ['longIdle', 'mixed']) {
  test(`P3: ${scenario}, 10 min, seeds 1–3: nothing static for 60 s; the Café and the Library are sat in`, async () => {
    for (const seed of [1, 2, 3]) {
      const { metrics: m } = await runSim({ layout, nav, scenario, minutes: MIN, seed });
      const tag = `seed ${seed}: ${JSON.stringify({ p3: m.p3, occ: m.occupancyPct })}`;
      assert.ok(m.p3.maxStillS <= 60, `maxStillS ${tag}`);
      assert.equal(m.p3.over60, 0, tag);
      assert.ok((m.occupancyPct.CAF ?? 0) >= 45, `CAF settled ${tag}`);
      assert.ok((m.occupancyPct.LIB ?? 0) >= 35, `LIB settled ${tag}`);
    }
  });
}

// [BRN M3.5] social rate floors (ideation GD #2; today metrics().social was all 0 after 60 s of mixed): over 4 minutes of
// `mixed` the office rallies at the ping-pong table, huddles under the Big Board and high-fives at least once each
test('M3.5 social floors: mixed, 4 min, seeds 1–3 → ≥ 1 rally, ≥ 1 huddle, ≥ 1 high-five', async () => {
  for (const seed of [1, 2, 3]) {
    const { metrics: m } = await runSim({ layout, nav, scenario: 'mixed', minutes: 4, seed });
    const s = m.social, tag = `seed ${seed}: ${JSON.stringify(s)}`;
    assert.ok(s.rallies >= 1 && s.rallyHits >= 5, `rallies ${tag}`);
    assert.ok(s.huddles >= 1, `huddles ${tag}`);
    assert.ok(s.highFives >= 1, `highFives ${tag}`);
  }
});

// [BRN M3.5] §6.4.3: churn's post-boot arrivals come in hiring crates (none at boot), closed panes leave by the door
test('M3.5 churn: arrivals in crates (never the panes there at boot), departures through the front door', async () => {
  const got: { boot: Set<string> | null } = { boot: null };
  const crated = new Set<string>();
  const { metrics: m } = await runSim({ layout, nav, scenario: 'churn', minutes: 4, seed: 1, onFrame: ({ actors }) => {
    got.boot ??= new Set(actors.list().map((a) => a.id));
    for (const c of actors.crates()) crated.add(c.id);
  } });
  const { boot } = got;
  assert.ok(boot && boot.size >= 4);
  for (const id of boot) assert.ok(!crated.has(id), `boot pane ${id} came in a crate (parade)`);
  assert.ok(m.verbs.crates >= 1 && crated.size === m.verbs.crates, JSON.stringify(m.verbs));
  assert.ok(m.verbs.departures >= 1, JSON.stringify(m.verbs));
});

// [BRN fix m2-fix1] art + fun review m2 (the amenity poses a ghost town; the Pit sofas empty with 2–3 done; done agents
// spent 13–18 % of their done time in the Pit; cold start put everyone at the desks). Measured per second over 10 min
// of `mixed` (seeds 1–3, no player): before the fix Pit ≥ 2 loungers 0–1 % and done-in-Pit 13–18 %.
test('dwell bias: cold start fills the Pit (2) and the Café (1); done agents rest in the Pit ≥ 55 %; Pit ≥ 2 loungers ≥ 30 %', async () => {
  for (const seed of [1, 2, 3]) {
    let s0 = -1, secs = 0, pit2 = 0, doneS = 0, donePit = 0;
    const got: { first: { pit: number; caf: number } | null } = { first: null };
    await runSim({ layout, nav, scenario: 'mixed', minutes: MIN, seed, onFrame: ({ t, actors }) => {
      const s = Math.floor(t);
      if (s === s0) return;
      s0 = s;
      let pit = 0, caf = 0;
      for (const a of actors.list()) {
        const z = layout.zoneAt(a.pos.x, a.pos.z, a.level ?? 0), settled = !a.moving && !!a.settledAt && (a.level ?? 0) === 0;
        if (settled && z === 'PIT') pit++;
        if (settled && z === 'CAF') caf++;
        if (a.brain.state.status === 'done') { doneS++; if ((a.level ?? 0) === 0 && Math.hypot(a.pos.x, a.pos.z) < 5.6) donePit++; }
      }
      if (s === 2) got.first = { pit, caf };
      secs++; if (pit >= 2) pit2++;
    } });
    const { first } = got;
    const tag = `seed ${seed}: first ${JSON.stringify(first)} pit2 ${(100 * pit2 / secs).toFixed(0)} % donePit ${(100 * donePit / doneS).toFixed(0)} %`;
    assert.ok(first && first.pit >= 2 && first.caf >= 1, `cold start ${tag}`);
    assert.ok(donePit / doneS >= 0.55, tag);
    assert.ok(pit2 / secs >= 0.3, tag);
  }
});

// [BRN fix m2-fix1] cameos: with the player standing in a room, somebody comes by within ~20 s whenever anyone is free
test('cameos: the room the player stands in gets a visitor (mixed, seed 1: ≥ 3 of Café, Library, Lab, Mailroom within 30 s)', async () => {
  const where: Record<string, { x: number; z: number }> = { CAF: { x: 18, z: 12 }, LIB: { x: 5, z: -12.5 }, LAB: { x: -9, z: 12 } };
  const mail = must(layout.zones.find((z) => z.id === 'MAIL'));
  where.MAIL = { x: (mail.rect[0] + mail.rect[2]) / 2, z: (mail.rect[1] + mail.rect[3]) / 2 };
  const order = Object.keys(where), hold = 40, firstSeen: Record<string, number> = {};
  for (const zn of order) assert.equal(layout.zoneAt(where[zn].x, where[zn].z, 0), zn);
  const player = { pos: { x: 0, y: 0, z: 0 }, level: 0 };
  let s0 = -1;
  await runSim({ layout, nav, scenario: 'mixed', minutes: (60 + order.length * hold) / 60, seed: 1, player, onFrame: ({ t, actors }) => {
    const s = Math.floor(t);
    if (s === s0 || s < 60) return;
    s0 = s;
    const k = Math.floor((s - 60) / hold), zn = order[k];
    if (!zn) return;
    Object.assign(player.pos, where[zn]);
    const here = actors.list().some((a) => !a.moving && a.settledAt && (a.level ?? 0) === 0 && layout.zoneAt(a.pos.x, a.pos.z, 0) === zn);
    if (here && firstSeen[zn] === undefined) firstSeen[zn] = s - 60 - k * hold;
  } });
  // (only idle / done agents may come — honest — so a room can stay empty while everybody works)
  assert.ok(order.filter((zn) => (firstSeen[zn] ?? Infinity) <= 30).length >= 3, JSON.stringify(firstSeen));
});

// [BRN fix m3-r2] Art review m3-r2: the keep-clear views did not keep agents out of the canonical frames (gale + pennant
// filled pitOverview's corner at 8h, lumen was cut off at its right edge at 22h and a giant blob at the mezz frame's
// left edge). The first 3 m of every authored view's frustum (16:9 at the default 60° vertical FOV: ±45.8°) holds no
// actor centre: nobody settles there (the directors' no-stand cone), and walkers keep out of the nav grid's cone
// (VIEW_CONE.pathR: shallower where the full 3 m would close a route — pitOverview stands at the stairs landing, the
// street / eBayGlass / mezz lenses look along their lanes). The serve view's subject, the queue lane, is exempt (§9.2).
test('keep-clear views: no actor centre within 3 m of a view origin inside its FOV (mixed + crowd40, day + night)', async () => {
  const { inViewCone, VIEW_CONE } = await import('../../world/nav/grid.ts');
  // (r less 1 cm: the engine pose frames shell benches 0–1 at 2.997 m by design, layout.test 'hq engine pose')
  const FOV = { r: 2.99, half: Math.atan(Math.tan(Math.PI / 6) * 16 / 9), disc: 0, body: 0 };
  const views = layout.keepClearViews;
  const lane = must(layout.levels[0].queueLane);
  const isRect = (q: Rect | readonly Rect[]): q is Rect => typeof q[0] === 'number';
  const laneRects: readonly Rect[] = isRect(lane) ? [lane] : lane;
  const inLane = (p: { x: number; z: number }) => laneRects.some(([x0, z0, x1, z1]) => p.x >= x0 - 0.3 && p.x <= x1 + 0.3 && p.z >= z0 - 0.3 && p.z <= z1 + 0.3);
  const bad: string[] = [];
  let frames = 0;
  const runs: [string, number, number, number][] = [['mixed', 12, 1, 13], ['mixed', 12, 2, 22], ['crowd40', 40, 1, 22]];
  for (const [scenario, n, seed, hour] of runs) {
    await runSim({ layout, nav: createNav(layout), scenario, n, minutes: 4, seed, hour, onFrame: ({ t, actors }) => {
      if (t < 3) return; // (cold placement settles in the first seconds)
      frames++;
      for (const a of actors.list()) {
        if (a.mode !== 'live' || a.ride) continue;
        const tag = a.intent?.slot?.tag ?? '';
        for (const v of views) {
          if ((v.level ?? 0) !== (a.level ?? 0)) continue;
          if (v.id === 'serve' && (/^queue/.test(tag) || inLane(a.pos))) continue; // the serve view's subject
          const walking = a.moving;
          // (a walker: the nav cone's depth, less 0.15 m of string-pulled corner / side-step slack)
          const r = walking ? Math.min(FOV.r, (VIEW_CONE.pathR[v.id] ?? VIEW_CONE.r) - 0.15) : FOV.r;
          if (!(r > 0)) continue; // (no nav cone for this view: its lens stands in a lane)
          if (!inViewCone(v, a.pos.x, a.pos.z, r, FOV)) continue;
          if (bad.length < 12) bad.push(`${scenario}/${seed}@${hour}h t=${t.toFixed(1)} ${a.id} ${walking ? 'walking' : `at ${a.settledAt ?? '?'}`} (${a.intent?.phase}) in ${v.id} ${Math.hypot(a.pos.x - v.x, a.pos.z - v.z).toFixed(2)} m`);
        }
      }
    } });
  }
  assert.ok(frames > 1000);
  assert.deepEqual(bad, []);
});

// [BRN fix m3-r2] Art review m3-r2: at 22h the Pit held 0–1 Clawds (an empty campfire circle) and the Library, Lab, mezz
// and Café were all empty; fun review m3-r2: the Pit's sitters had their backs to pitOverview in every hour. After dark
// the free agents gather at the hearth (≥ 3 in the Pit whenever ≥ 3 are free, most of the time), a Café or Library sitter
// stays while anyone beyond those three is free, and the Pit's loungers take the far arc (x + z < 0: facing pitOverview and the spawn).
test('night hearth: 22h mixed, seeds 1–3 → Pit ≥ 3 while ≥ 3 free, then a Café / Library sitter, loungers on the far arc', async () => {
  const pct: { seed: number; pit3: number; room: number; far: number; n: number }[] = [];
  for (const seed of [1, 2, 3]) {
    let n = 0, pit3 = 0, n1 = 0, room = 0, pitN = 0, far = 0, next = 20;
    await runSim({ layout, nav, scenario: 'mixed', minutes: 6, seed, hour: 22, onFrame: ({ t, actors }) => {
      if (t < next) return;
      next += 2;
      const L = actors.list();
      // free: an idle agent the office may cast (not on a parcel run / call / ride), or a done agent at its Pit stay
      const free = L.filter((a) => a.entity?.kind !== 'shell' && ((a.brain.state.status === 'idle' && a.brain.state.castable)
        || (a.brain.state.status === 'done' && /^pit/.test(a.intent?.phase ?? '')))).length;
      const inZ = (z: string) => L.filter((a) => !a.moving && a.settledAt && (a.level ?? 0) === 0 && layout.zoneAt(a.pos.x, a.pos.z, 0) === z);
      const p = inZ('PIT');
      for (const a of p) { pitN++; if (a.pos.x + a.pos.z < 0) far++; }
      if (free >= 3) { n++; if (p.length >= 3) pit3++; }
      if (free >= 4) { n1++; if (inZ('CAF').length || inZ('LIB').length) room++; } // (the hearth's three come first)
    } });
    pct.push({ seed, pit3: pit3 / n, room: room / n1, far: far / pitN, n });
  }
  const tag = JSON.stringify(pct.map((q) => ({ ...q, pit3: +q.pit3.toFixed(2), room: +q.room.toFixed(2), far: +q.far.toFixed(2) })));
  for (const q of pct) {
    assert.ok(q.n >= 40, `samples ${tag}`);
    assert.ok(q.pit3 >= 0.45, `Pit ≥ 3 while ≥ 3 free ${tag}`); // (daytime: 0–8 %)
    assert.ok(q.room >= 0.45, `a Café / Library sitter while anyone beyond the hearth's three is free ${tag}`);
    assert.ok(q.far >= 0.85, `Pit loungers on the far arc ${tag}`);
  }
  assert.ok(pct.reduce((a, q) => a + q.pit3, 0) / pct.length >= 0.55, `mean Pit ≥ 3 ${tag}`);
});

// [BRN fix m3-r2] (fun review m3-r2: over 3 minutes at pitOverview the Pit never showed a face) with the player at the
// hero pose, the Pit's loungers look round and wave now and then (≈ 1.2 s every ~20 s each)
test('Pit look-back-and-wave: player at pitOverview, mixed 3 min → loungers glance round and wave', async () => {
  const v = must(layout.keepClearViews.find((q) => q.id === 'pitOverview'));
  let n = 0;
  await runSim({ layout, nav: createNav(layout), scenario: 'mixed', minutes: 3, seed: 1, hour: 22, player: { pos: { x: v.x, y: 0, z: v.z }, level: 0 },
    onFrame: ({ actors }) => { let k = 0; for (const a of actors.list()) k += a.brain?.state?.lookBacks ?? 0; n = Math.max(n, k); } });
  assert.ok(n >= 6, `look-backs ${n}`);
});

// [BRN fix m3-r3] Fun review m3-r3: a claude passed a seated camera in the Pit at 0.8 m (d-g-8), moss crossed
// pitOverview's lower right at 2 m; playtest m3-r3: ledger + claude·2 stood jammed 8–20 s in the library doorway.
// The player's personal space (TUNING.personalR 1.5 m) is a soft path cost: a stand-in player re-poses next to a random
// actor every 12 s (hero cameras, seated or standing); walkers PASSING them (not heading for a spot beside them, not
// starting inside their space) keep ≥ 1.2 m; and no walker stands stalled on its way more than ≈ 3 s (the watchdog's
// cap; a polite "after you!" wait for a player who plugs a stair / door is the only exception, and is counted apart).
test('personal space + stall cap: passers keep ≥ 1.2 m from the player; no walker stalls > 3.5 s (mixed 1–3, crowd40 1)', async () => {
  const out: { scenario: string; seed: number; min: number; who: string; stallMaxS: number; stallWho: string; polite: number; breaks: number }[] = [];
  const runs: [string, number, number][] = [['mixed', 12, 1], ['mixed', 12, 2], ['mixed', 12, 3], ['crowd40', 40, 1]];
  for (const [scenario, n, seed] of runs) {
    const player = { pos: { x: 0, y: 0, z: 12.5 }, level: 0 };
    let k = 0, r = seed * 9301, min = Infinity, who = '', poseT = 0;
    const got: { stalls: ActorMetrics['stalls'] | null } = { stalls: null };
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const inside = new Set<string>(), walking = new Map<string, boolean>();
    await runSim({ layout, nav: createNav(layout), scenario, n, minutes: 5, seed, player, onFrame: ({ t, actors, director }) => {
      const L = actors.list();
      if (t >= k * 12 + 1 && L.length) {
        k++;
        const a = L[Math.floor(rnd() * L.length)];
        for (let i = 0; i < 24; i++) {
          const ang = rnd() * Math.PI * 2, d = 1.2 + rnd() * 0.8, x = a.pos.x + Math.cos(ang) * d, z = a.pos.z + Math.sin(ang) * d;
          if (director.walkable(x, z, a.level) && L.every((b) => Math.hypot(b.pos.x - x, b.pos.z - z) > 0.95)) {
            player.pos.x = x; player.pos.z = z; player.pos.y = layout.floorY(x, z, a.level); player.level = a.level;
            poseT = t;
            inside.clear();
            for (const b of L) if (Math.hypot(b.pos.x - x, b.pos.z - z) < 1.6) inside.add(b.id); // (the player stepped next to them)
            break;
          }
        }
      }
      for (const a of L) {
        const d = Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z);
        const w = a.mode === 'live' && !a.arrived;
        if (w && !walking.get(a.id) && d < 1.6) inside.add(a.id); // a walk that starts inside their space may walk away
        walking.set(a.id, w);
        if (!a.moving || (a.level ?? 0) !== player.level || t - poseT < 1 || inside.has(a.id)) continue;
        const s = a.intent?.slot, e = a.path[a.path.length - 1];
        if ((s && Math.hypot(s.pos.x - player.pos.x, s.pos.z - player.pos.z) < 1.6) || (e && Math.hypot(e.x - player.pos.x, e.z - player.pos.z) < 1.6)) continue;
        if (d < min) { min = d; who = `${a.id} ${a.intent?.phase} t=${t.toFixed(1)}`; }
      }
      got.stalls = actors.metrics().stalls;
    } });
    const { stalls } = got;
    assert.ok(stalls);
    out.push({ scenario, seed, min: +min.toFixed(2), who, stallMaxS: +stalls.maxS.toFixed(1), stallWho: stalls.maxWho, polite: +stalls.politeS.toFixed(1), breaks: stalls.breaks });
  }
  for (const o of out) {
    assert.ok(o.min >= 1.2, `passer too close: ${JSON.stringify(o)}`);
    assert.ok(o.stallMaxS <= 3.5, `stalled walker: ${JSON.stringify(o)}`);
  }
});

// [BRN fix m3-r3] Art review m3-r3 (h22-2: a Clawd 1.5 m in front of eBayGlass; fun lap-6: moss 2 m into pitOverview's
// lower right): with the player AT the hero pose, no walker enters the first 2.85 m of the frame (16:9, ±45.8°, widened
// by a half body near the lens) — the E-bay corridor's walkers keep to the glazing side (≈ 3 m, the soft cone).
test('hero poses with the player there: pitOverview / eBayGlass / spawn / cafe frames hold no walker nearer than 2.85 m', async () => {
  const half = Math.atan(Math.tan(Math.PI / 6) * 16 / 9);
  const bad: string[] = [];
  const poses: [string, number][] = [['pitOverview', 1], ['pitOverview', 2], ['eBayGlass', 1], ['eBayGlass', 2], ['spawn', 1], ['cafe', 1]];
  for (const [vid, seed] of poses) {
    const v = must(layout.keepClearViews.find((q) => q.id === vid));
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const player = { pos: { x: v.x, y: layout.floorY(v.x, v.z, v.level ?? 0), z: v.z }, level: v.level ?? 0 };
    await runSim({ layout, nav: createNav(layout), scenario: 'mixed', minutes: 3, seed, hour: vid === 'eBayGlass' ? 22 : 13, player, onFrame: ({ t, actors }) => {
      if (t < 3) return;
      for (const a of actors.list()) {
        if (!a.moving || (a.level ?? 0) !== player.level) continue;
        const dx = a.pos.x - v.x, dz = a.pos.z - v.z, d = Math.hypot(dx, dz);
        if (d >= 2.85) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / Math.max(d, 1e-6))));
        // (eBayGlass: the E-bay corridor's pinch by the glazing pier, 0–30° right of the axis, is 2.5–2.8 m off the lens at its
        // far side — geometry; the walkers take that far side)
        if (vid === 'eBayGlass' && ang < 0.55 && d >= 2.45) continue;
        if (ang < half + Math.asin(Math.min(1, 0.3 / Math.max(d, 0.3))) && bad.length < 8) bad.push(`${vid}/${seed} t=${t.toFixed(1)} ${a.id} ${a.intent?.phase} ${d.toFixed(2)} m ${(ang * 57.3).toFixed(0)}°`);
      }
    } });
  }
  assert.deepEqual(bad, []);
});

// [BRN fix m3-r3] Fun review m3-r3 (t-typed / t-p-5): Talk (T) on a wandering idle agent — it kept walking away, back
// turned, while the player typed and after the send. bus 'talk.open' (actors.talk) → it stops (walks up when > 3 m),
// faces the player from 1.6–3 m with a '…' bubble until the bar closes; the send → 'on it!' + a nod, then the call.
for (const seed of [1, 2, 3]) test(`Talk (seed ${seed}): a wandering idle agent stops, faces the player from 1.6–3 m and listens; the send nods, then the call`, async () => {
  const player = { pos: { x: 0, y: 0, z: 12.5 }, level: 0 };
  let who: string | null = null, openT = -1, sendT = -1;
  const got: { res: { d: number; dy: number; moving: boolean; phase: string | undefined; look: boolean } | null } = { res: null };
  const bubbles: (string | null)[] = [];
  const samples: { dt: number; phase: string | undefined; bubble: string | null }[] = [];
  await runSim({ layout, nav: createNav(layout), scenario: 'mixed', minutes: 1.2, seed, player, onFrame: ({ t, actors, director }) => {
    if (!who && t > 20) {
      const a = actors.list().find((b) => b.moving && b.brain.state.status === 'idle' && (b.level ?? 0) === 0 && b.entity.kind !== 'shell');
      if (!a) return;
      // the player 4 m behind it, on its level (so it has to come back, turn round and face them)
      for (const r of [4, 3.5, 4.5, 5]) for (let k = 0; k < 16 && !who; k++) {
        const ang = (k / 16) * Math.PI * 2, x = a.pos.x + Math.sin(ang) * r, z = a.pos.z + Math.cos(ang) * r;
        if (!director.walkable(x, z, 0)) continue;
        player.pos.x = x; player.pos.z = z; player.pos.y = layout.floorY(x, z, 0);
        who = a.id; openT = t;
        assert.ok(actors.talk(who, true));
      }
      return;
    }
    if (!who) return;
    const a = must(actors.get(who));
    if (t - openT > 0.2 && t - openT < 7) bubbles.push(a.intent?.bubble?.title ?? null);
    if (t - openT >= 7 && sendT < 0) {
      const d = Math.hypot(a.pos.x - player.pos.x, a.pos.z - player.pos.z);
      const toP = Math.atan2(-(player.pos.x - a.pos.x), -(player.pos.z - a.pos.z));
      const dy = Math.abs(Math.atan2(Math.sin(a.yaw - toP), Math.cos(a.yaw - toP)));
      got.res = { d, dy, moving: a.moving, phase: a.intent?.phase, look: !!a.intent?.look };
      actors.prompted(who); actors.talk(who, false, true); sendT = t;
    }
    if (sendT > 0 && t - sendT < 3) samples.push({ dt: t - sendT, phase: a.intent?.phase, bubble: a.intent?.bubble?.title ?? null });
  } });
  assert.ok(who, 'found a wandering idle agent');
  const { res } = got;
  assert.ok(res);
  assert.equal(res.moving, false, 'stopped');
  assert.equal(res.phase, 'listen');
  assert.ok(res.d >= 1.55 && res.d <= 3.1, `faces the player from 1.6–3 m (${res.d.toFixed(2)})`);
  assert.ok(res.dy < 0.35, `turned to the player (${res.dy.toFixed(2)} rad off)`);
  assert.ok(res.look, 'looking at the player');
  assert.ok(bubbles.filter((b) => b === '…').length > bubbles.length * 0.8, 'the listening bubble');
  assert.ok(samples.some((s) => s.dt < 0.5 && s.bubble === 'on it!'), 'the send: "on it!" with the nod');
  assert.ok(samples.some((s) => s.dt > 1 && s.phase !== 'listen'), 'then it goes (the plane / the call)');
});

// [BRN fix m3-r3] Fun review m3-r3 (z-4): the inbox-zero confetti landed on nobody. bus 'inbox.zero' (actors.inboxZero)
// → every free agent within 15 m of the player / the Pit cheers (staggered ≤ 0.3 s, holding its place), working ones go on
// working; the answered agent gets the victory skip.
test('inbox zero: every free agent near the player / the Pit cheers within 0.3 s (the Pit loungers included)', async () => {
  const v = must(layout.keepClearViews.find((q) => q.id === 'pitOverview'));
  const player = { pos: { x: v.x, y: 0, z: v.z }, level: 0 };
  let fired = -1, n = 0, working = 0, pitFree = 0;
  const cheering = new Set<string>(), free = new Set<string>();
  await runSim({ layout, nav: createNav(layout), scenario: 'mixed', minutes: 1, seed: 1, player, onFrame: ({ t, actors, director }) => {
    if (fired < 0 && t > 30) {
      fired = t;
      for (const a of actors.list()) {
        const st = a.brain.state.status, near = Math.hypot(a.pos.x - v.x, a.pos.z - v.z) <= 15 || Math.hypot(a.pos.x - director.center.x, a.pos.z - director.center.z) <= 15;
        if ((st === 'idle' || st === 'done' || st === 'shell') && near) { free.add(a.id); if (/^pit|lounge|Pit/.test(a.intent?.phase ?? '') || /sofa|beanbag|pitStep/.test(a.settledAt ?? '')) pitFree++; }
      }
      n = actors.inboxZero();
      return;
    }
    if (fired > 0 && t - fired <= 0.5) for (const a of actors.list()) if (a.intent?.phase === 'cheer') cheering.add(a.id);
    if (fired > 0 && t - fired > 0.35 && t - fired < 1.5) for (const a of actors.list()) if (a.brain.state.status === 'working' && a.intent?.phase === 'cheer') working++;
  } });
  assert.ok(free.size >= 3, `free agents near: ${free.size}`);
  assert.ok(n >= free.size, `cheered ${n} of ${free.size}`);
  for (const id of free) assert.ok(cheering.has(id), `${id} cheers`);
  assert.equal(working, 0, 'workers keep working');
  assert.ok(pitFree >= 1, 'the Pit loungers are in it');
});
