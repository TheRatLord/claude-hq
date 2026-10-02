/**
 * The Valley Gazette's wiring (model/gazette.ts is the pure paper; hud/gazette.ts prints it). main.ts creates the
 * newsroom here, which:
 *  - keeps the Gazette's journal (gifts, delivered requests, new hearts, catches with their size, first finds) from the
 *    friendship and Collections services as they happen, and the Valley Projects finished / unveiled;
 *  - reads the projects board for its teaser ("Wanted: for the observatory, 120 more bits…");
 *  - delivers the weekly edition to the mailbox every Monday morning (or on the first visit of a new week), filing it
 *    in the back-issue archive (no letter when nothing at all happened last week);
 *  - composes the morning edition (the last seven days, today included) on demand for the noticeboard / G.
 *
 * Persisted per browser profile in `claude-valley.gazette.v1`. The demo valley keeps its paper in memory and builds
 * its week from the seeded history (demoAlmanac, demoDay per farmer), never touching the real archive.
 */
import { boardNeed, composeIssue, createGazette, demoInput, gatherFacts, issueLetter } from './model/gazette.ts';
import type { EditionKind, GazetteInput, GazetteService, IssueRec, Issue } from './model/gazette.ts';
import { rollDay } from './model/timeline.ts';
import type { Valley } from './model/valley.ts';
import type { CollectionService } from './model/collection.ts';
import type { FriendsService } from './model/friends.ts';
import type { StampsService } from './model/stamps.ts';
import type { ProjectsService } from './model/projects.ts';
import { localJson } from './storage.ts';

export const GAZETTE_KEY = 'claude-valley.gazette.v1';
/** the letter's sender id (the mailbox shows a "Read the paper" button for it) */
export const GAZETTE_FROM = 'gazette';

/** What the HUD reads (hud/gazette.ts). */
export interface GazettePort {
  /** bumps when an issue is filed or the journal changes */
  readonly version: number;
  /** today's morning edition: the last seven days, composed now */
  today(): Issue;
  /** the back issues, newest first */
  issues(): readonly IssueRec[];
  /** a back issue recomposed from its facts */
  issue(rec: IssueRec): Issue;
}

export interface Newsroom extends GazettePort {
  readonly paper: GazetteService;
  /** deliver this week's edition now if it is due (force: file and post one regardless; dev) */
  deliver(force?: boolean): IssueRec | null;
  /** what an edition would print right now (dev) */
  facts(kind: EditionKind): ReturnType<typeof gatherFacts>;
}

export interface NewsroomDeps {
  valley: Valley;
  collection: CollectionService;
  friends: FriendsService;
  stamps: StampsService;
  /** the Valley Projects board (its journal notes and the "board needs…" teaser) */
  projects?: ProjectsService;
  /** null until the server said hello, then whether this is the demo valley */
  demo: () => boolean | null;
}

export function installNewsroom(d: NewsroomDeps): Newsroom {
  const { valley, collection, friends, stamps } = d;
  const paper = createGazette(localJson(GAZETTE_KEY));
  let demoMode = false;
  const now = () => Date.now();

  // ---- the journal
  friends.onChange((c) => {
    if (c.kind === 'gift') paper.note({ k: 'gift', at: now(), who: c.who, item: c.item, tier: c.tier });
    else if (c.kind === 'delivered') paper.note({ k: 'request', at: now(), who: c.req.who });
    else if (c.kind === 'heart' && c.up && c.hearts >= 2 && c.hearts % 2 === 0) paper.note({ k: 'hearts', at: now(), who: c.who, n: c.hearts });
  });
  collection.onFind((r) => {
    if (r.def.kind === 'fish') paper.note({ k: 'catch', at: now(), item: r.def.id, cm: r.cm ?? 0 });
    if (r.isNew) paper.note({ k: 'find', at: now(), item: r.def.id });
  });
  d.projects?.onChange((c) => {
    if (c.kind === 'complete') paper.note({ k: 'project', at: c.at, id: c.id, ev: 'done' });
    else if (c.kind === 'unveil') paper.note({ k: 'project', at: c.at, id: c.id, ev: 'unveiled' });
  });
  // the board's teaser (friendship read live: a blessing already there isn't "wanted")
  const board = () => { try { return d.projects ? boardNeed(d.projects.view({ friends: friends.data(), coins: 0, basket: {} })) : null; } catch { return null; } };

  // ---- facts
  const input = (kind: EditionKind): GazetteInput => {
    const s = valley.state;
    const tl = s.timeline;
    const today = rollDay({ day: tl.day, farmers: Object.fromEntries(tl.farmers) });
    if (demoMode || s.demo) {
      const farmers = [...s.farmers.values()].map((f) => ({ id: f.id, tag: f.tag, name: f.name }));
      const inp = demoInput(kind, now(), valley.almanacData(), farmers, today);
      // the player's own week (a real catch in the demo) joins the seeded one
      return { ...inp, notes: [...inp.notes, ...paper.data().notes], stamps: { ...inp.stamps, ...stamps.data().earned }, board: board() };
    }
    return { kind, now: now(), almanac: valley.almanacData(), past: tl.past, today, stamps: stamps.data().earned, notes: paper.data().notes, demo: false, board: board() };
  };
  const facts = (kind: EditionKind) => gatherFacts(input(kind));

  // ---- the post
  const post = (rec: IssueRec) => {
    const l = issueLetter(composeIssue(rec.facts));
    valley.post({ id: `gazette:${rec.facts.from}`, at: rec.at, from: GAZETTE_FROM, fromName: 'The Valley Gazette', title: l.title, body: l.body });
  };
  const deliver = (force = false): IssueRec | null => {
    if (!force && !paper.due()) return null;
    const f = facts('weekly');
    const empty = f.points <= 0 && f.active <= 0 && !f.notes.length && !f.catches && !f.stamp && !f.projects.length;
    if (!force && empty) { paper.skip(); return null; }
    const rec = paper.file(f);
    post(rec);
    return rec;
  };
  let started = false;
  const check = () => {
    const demo = d.demo();
    if (demo === null) return;
    if (!started) {
      started = true;
      // the demo valley's paper lives in memory; a real one brings back the last two issues' letters after a reload
      // (the mailbox keeps their read state)
      if (demo) { demoMode = true; let mem: unknown = null; paper.use({ load: () => mem, save: (x) => { mem = x; } }); }
      else for (const rec of paper.data().issues.slice(-2)) post(rec);
    }
    // a demo edition needs its farmers on the field first
    if (demoMode && !valley.state.farmers.size) return;
    try { deliver(); } catch (err) { console.warn('[gazette] delivery failed', err); }
  };
  setInterval(check, 2000);

  let cache: { at: number; v: number; issue: Issue } | null = null;
  return {
    paper,
    get version() { return paper.version; },
    today() {
      // recomposed at most every 30 s (or when the journal changes)
      const t = now();
      if (!cache || t - cache.at > 30_000 || cache.v !== paper.version) cache = { at: t, v: paper.version, issue: composeIssue(facts('daily')) };
      return cache.issue;
    },
    issues: () => [...paper.data().issues].reverse(),
    issue: (rec) => composeIssue(rec.facts),
    deliver,
    facts,
  };
}
