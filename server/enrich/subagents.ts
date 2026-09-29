/**
 * Subagents enricher (DESIGN §4.5, research/herdr-api §6): every 2 s, `readdir` + `stat` on
 * `<projects>/<slug(cwd)>/<session>/subagents/` → `agent-*.jsonl` (+ `.meta.json` {agentType, description}) and
 * `workflows/<wf>/agent-*.jsonl` (labels from `journal.jsonl` `started` lines). `active` = mtime < 30 s; ≤ 8 reported
 * (active first, then newest). Emits `subagent-spawned` for files that appear after the first scan and
 * `subagent-done` when an active subagent goes quiet. Claude panes only. Owner: BE2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Enricher } from '../interfaces.ts';
import type { BaseEntity, Clock, Logger, TimerHandle } from '../interfaces.ts';
import type { EventKind, Subagent } from '../../shared/protocol.ts';
import { isRecord, errMessage } from '../../shared/guards.ts';
import { projectSlug, defaultProjectsDir } from './transcripts.ts';

const POLL_MS = 2000;
const ACTIVE_MS = 30_000;
const MAX_REPORTED = 8;
const GLOB_EVERY_MS = 10_000;
const clip = (s: unknown, n: number): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Parse a workflow journal → Map(agentId → label). Reads at most the last 64 KB. */
async function journalLabels(file: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let fh: fs.promises.FileHandle | undefined;
  try {
    fh = await fs.promises.open(file, 'r');
    const { size } = await fh.stat();
    const start = Math.max(0, size - 65536);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    for (const l of buf.toString('utf8').split('\n')) {
      if (!l.includes('started')) continue;
      try {
        const o: unknown = JSON.parse(l);
        const rec = isRecord(o) ? o : {};
        const data = isRecord(rec.data) ? rec.data : {};
        const id = rec.agentId ?? data.agentId;
        const label = rec.label ?? data.label;
        if (id && label) out.set(String(id), String(label));
      } catch {}
    }
  } catch {
  } finally {
    await fh?.close().catch(() => {});
  }
  return out;
}

/** One `agent-*.jsonl` found by scanSubagents. */
export interface SubagentFile { id: string; type: string; label: string; mtime: number }

/**
 * Scan one session's subagents dir (`dir` = `<projdir>/<session>/subagents`). null if the dir is missing.
 */
export async function scanSubagents(dir: string): Promise<SubagentFile[] | null> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return null;
  }
  const out: SubagentFile[] = [];
  const addAgent = async (d: string, name: string, fallbackType: string, labels: Map<string, string> | null) => {
    const m = /^agent-(.+)\.jsonl$/.exec(name);
    if (!m) return;
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(path.join(d, name));
    } catch {
      return;
    }
    const meta = await readJson(path.join(d, `agent-${m[1]}.meta.json`));
    const metaRec = isRecord(meta) ? meta : {};
    out.push({
      id: m[1],
      type: clip(metaRec.agentType ?? fallbackType, 40),
      label: clip(metaRec.description ?? labels?.get(m[1]) ?? '', 60),
      mtime: st.mtimeMs,
    });
  };
  for (const n of names) await addAgent(dir, n, 'general-purpose', null);
  if (names.includes('workflows')) {
    let wfs: string[] = [];
    try {
      wfs = await fs.promises.readdir(path.join(dir, 'workflows'));
    } catch {}
    for (const wf of wfs) {
      const wd = path.join(dir, 'workflows', wf);
      let files: string[];
      try {
        files = await fs.promises.readdir(wd);
      } catch {
        continue;
      }
      const labels = files.includes('journal.jsonl') ? await journalLabels(path.join(wd, 'journal.jsonl')) : null;
      for (const n of files) await addAgent(wd, n, 'workflow', labels);
    }
  }
  return out;
}

/** Per-pane record. */
interface Rec {
  id: string;
  sid: string;
  cwd: string | undefined;
  dir: string | null;
  lastGlob: number;
  /** null until the first scan finished: files seen then are not "spawns" */
  known: Set<string> | null;
  active: Set<string>;
  sent: string;
  busy: boolean;
  poll: TimerHandle | null;
}

export interface SubagentsOpts { clock: Clock; log?: Pick<Logger, 'debug'>; projectsDir?: string; pollMs?: number }

export class SubagentsEnricher extends Enricher {
  clock: Clock;
  log: Pick<Logger, 'debug'>;
  projectsDir: string;
  pollMs: number;
  recs: Map<string, Rec>;
  constructor({ clock, log, projectsDir = defaultProjectsDir(), pollMs = POLL_MS }: SubagentsOpts) {
    super('subagents');
    this.clock = clock;
    this.log = log ?? { debug() {} };
    this.projectsDir = projectsDir;
    this.pollMs = pollMs;
    this.recs = new Map();
  }

  override attach(id: string, base: BaseEntity): void {
    this._sync(id, base);
  }
  override update(id: string, base: BaseEntity): void {
    this._sync(id, base);
  }
  override detach(id: string): void {
    const r = this.recs.get(id);
    if (r) this.clock.clearInterval(r.poll ?? undefined);
    this.recs.delete(id);
  }
  override async close(): Promise<void> {
    for (const id of [...this.recs.keys()]) this.detach(id);
  }
  metrics(): { panes: number; polls: number } {
    return { panes: this.recs.size, polls: [...this.recs.values()].filter((r) => r.poll).length };
  }

  _sync(id: string, base: BaseEntity): void {
    const sid = base.kind === 'claude' ? base.identity?.agentSession ?? null : null;
    let r = this.recs.get(id);
    if (r && (r.sid !== sid || r.cwd !== base.cwd)) {
      const hadAny = r.sent !== '[]';
      this.detach(id);
      r = undefined;
      if (hadAny || !sid) this.onPatch(id, { subagents: [] });
    }
    if (!sid) return;
    if (!r) {
      const rec: Rec = { id, sid, cwd: base.cwd, dir: null, lastGlob: -Infinity, known: null, active: new Set(), sent: '[]', busy: false, poll: null };
      this.recs.set(id, rec);
      rec.poll = this.clock.setInterval(() => void this._scan(rec), this.pollMs);
      void this._scan(rec);
    }
  }

  _locate(r: Rec): string | null {
    const direct = path.join(this.projectsDir, projectSlug(r.cwd), r.sid, 'subagents');
    if (fs.existsSync(direct)) return direct;
    const now = this.clock.now();
    if (now - r.lastGlob < GLOB_EVERY_MS) return null;
    r.lastGlob = now;
    try {
      for (const d of fs.readdirSync(this.projectsDir)) {
        const p = path.join(this.projectsDir, d, r.sid, 'subagents');
        if (fs.existsSync(p)) return p;
      }
    } catch {}
    return null;
  }

  async _scan(r: Rec): Promise<void> {
    if (r.busy || this.recs.get(r.id) !== r) return;
    r.busy = true;
    try {
      r.dir ??= this._locate(r);
      const list = r.dir ? await scanSubagents(r.dir) : null;
      if (this.recs.get(r.id) !== r) return;
      if (!list) {
        if (r.dir) r.dir = null;
        if (r.known === null) r.known = new Set(); // "first scan" done: later files are spawns
        return;
      }
      const now = this.clock.now();
      const first = r.known === null;
      r.known ??= new Set();
      const nowActive = new Set<string>();
      for (const a of list) {
        const active = now - a.mtime < ACTIVE_MS;
        if (active) nowActive.add(a.id);
        if (!r.known.has(a.id)) {
          r.known.add(a.id);
          if (!first) this._emit(r, 'subagent-spawned', { id: a.id, type: a.type, label: a.label });
        }
      }
      for (const aid of r.active) {
        if (!nowActive.has(aid)) {
          const a = list.find((x) => x.id === aid);
          this._emit(r, 'subagent-done', { id: aid, type: a?.type ?? null, label: a?.label ?? '' });
        }
      }
      r.active = nowActive;
      const top: Subagent[] = list
        .map((a) => ({ id: `${r.id}:${a.id}`, type: a.type, label: a.label, active: nowActive.has(a.id), mtime: a.mtime }))
        .sort((a, b) => Number(b.active) - Number(a.active) || b.mtime - a.mtime)
        .slice(0, MAX_REPORTED)
        .map(({ mtime, ...s }) => s); // eslint-disable-line no-unused-vars
      const j = JSON.stringify(top);
      if (j !== r.sent) {
        r.sent = j;
        this.onPatch(r.id, { subagents: top });
      }
    } catch (e) {
      this.log.debug(`subagents ${r.id}: ${errMessage(e)}`);
    } finally {
      r.busy = false;
    }
  }

  _emit(r: Rec, kind: EventKind, detail: unknown): void {
    try {
      this.emitEvent(r.id, kind, detail);
    } catch (e) {
      this.log.debug(`subagents emit: ${errMessage(e)}`);
    }
  }
}
