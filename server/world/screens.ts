/**
 * Monitor text for watched panes. Not an enricher: writes `screen` messages.
 * Owner: BE.
 * - Each client watches ≤ LIMITS.watchMax (8, VALIDATE) ids; the union of all clients is capped at LIMITS.watchUnionMax (16).
 * - ≤ 1 Hz per pane. Source: the live terminal mirror when one exists (no herdr call), else
 *   `pane.read {source:'visible'}`, sending only when the text/revision changed.
 * - `screen.watch {ids, ansi:true}` → that client's lines keep SGR colour escapes (`ansi:true` on the message) so the
 *   renderer can tint the monitor; everyone else gets plain text. One herdr read serves both: when any watcher of a
 *   pane wants ANSI the read is `format:'ansi'` and the plain lines are derived by stripping. Non-SGR escapes (cursor
 *   moves, OSC titles, modes) never go on the wire.
 * - Each client receives screens only for ids it watches; a new watcher gets the cached screen at once.
 */
import { LIMITS, S2R } from '../../shared/protocol.ts';
import type { ScreenMsg, ServerMsg } from '../../shared/protocol.ts';
import type { Clock, HerdrSource, Logger, TimerHandle } from '../interfaces.ts';
import { errCode, errMessage, isRecord } from '../../shared/guards.ts';
import type { WorldModel } from './model.ts';

/** A connected renderer, as far as screens are concerned (WsHub's client object). */
export interface ScreenClient { sendJson(msg: ServerMsg): void }
/** The live terminal mirror of a pane (terminals/mirror.ts). */
export interface ScreenMirror { cols: number; rows: number; lines(): string[]; ansiLines?(): string[] }
/** The part of TerminalHub screens reads. */
export interface MirrorSource { mirrorOf?(id: string): ScreenMirror | null | undefined }

interface WatchSet { ids: string[]; ansi: boolean }
interface ScreenState {
  sig: string;
  plain: ScreenMsg | null;
  ansi: ScreenMsg | null;
  inflight: boolean;
  ansiSrc: boolean;
}

export const SCREEN_MS = 1000;

// eslint-disable-next-line no-control-regex
const ESC_ANY = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[PX^_][^\x1b]*\x1b\\|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex
const CTRL = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]/g;

/** Keep only SGR (`ESC[…m`) sequences; drop every other escape and C0 control. */
export function sgrOnly(line: string): string {
  return line.replace(ESC_ANY, (m) => (/^\x1b\[[0-9;:]*m$/.test(m) ? m : '')).replace(CTRL, '');
}
/** Plain text of an ANSI line. */
export function stripAnsi(line: string): string {
  return line.replace(ESC_ANY, '').replace(CTRL, '');
}

/** herdr text → wire lines (no \r, no trailing padding, no trailing empty line). */
export function toLines(text: string, ansi: boolean): string[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => (ansi ? trimAnsiEnd(sgrOnly(l)) : stripAnsi(l).trimEnd()));
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
/** trimEnd through trailing padding and SGR runs (bg-coloured padding included); close with one reset if coloured. */
function trimAnsiEnd(l: string): string {
  const body = l.replace(/(?:\s|\x1b\[[0-9;:]*m)+$/, '');
  return body && body.includes('\x1b[') ? body + '\x1b[0m' : body;
}

export class Screens {
  source: Pick<HerdrSource, 'request' | 'connected'>;
  hub: MirrorSource;
  model: Pick<WorldModel, 'has' | 'get'>;
  clock: Clock;
  log: Pick<Logger, 'debug'>;
  /** client → watch set */
  watch: Map<ScreenClient, WatchSet>;
  state: Map<string, ScreenState>;
  _timer: TimerHandle | null;
  reads: number;
  sent: number;

  constructor({ source, hub, model, clock, log }: {
    source: Pick<HerdrSource, 'request' | 'connected'>; hub: MirrorSource; model: Pick<WorldModel, 'has' | 'get'>; clock: Clock;
    log?: Pick<Logger, 'debug'>;
  }) {
    this.source = source;
    this.hub = hub;
    this.model = model;
    this.clock = clock;
    this.log = log ?? { debug() {} };
    this.watch = new Map();
    this.state = new Map();
    this._timer = null;
    this.reads = 0;
    this.sent = 0;
  }

  /** Replace a client's watch set. */
  setWatch(client: ScreenClient, ids: string[], ansi = false): void {
    ids = [...new Set(ids)].slice(0, LIMITS.watchMax);
    if (ids.length) this.watch.set(client, { ids, ansi: !!ansi });
    else this.watch.delete(client);
    const u = this.union();
    for (const id of [...this.state.keys()]) if (!u.includes(id)) this.state.delete(id);
    // new watchers get the last known screen immediately
    for (const id of ids) {
      const s = this.state.get(id);
      const m = s && (ansi ? s.ansi : s.plain);
      if (m) client.sendJson(m);
    }
    if (u.length && !this._timer) {
      this._timer = this.clock.setInterval(() => this.tick(), SCREEN_MS);
      this.tick();
    } else if (!u.length && this._timer) {
      this.clock.clearInterval(this._timer);
      this._timer = null;
    }
  }

  dropClient(client: ScreenClient): void {
    if (this.watch.has(client)) this.setWatch(client, []);
  }

  /** Watched ids across clients, first come first served, capped at watchUnionMax. */
  union(): string[] {
    const out: string[] = [];
    for (const { ids } of this.watch.values()) for (const id of ids) if (!out.includes(id) && out.length < LIMITS.watchUnionMax) out.push(id);
    return out;
  }

  /** Does any client watching `id` want ANSI? */
  _wantsAnsi(id: string): boolean {
    for (const w of this.watch.values()) if (w.ansi && w.ids.includes(id)) return true;
    return false;
  }

  _send(id: string, s: ScreenState): void {
    for (const [client, w] of this.watch) {
      if (!w.ids.includes(id)) continue;
      const m = w.ansi ? s.ansi : s.plain;
      if (m) {
        client.sendJson(m);
        this.sent++;
      }
    }
  }

  _publish(id: string, s: ScreenState, plainLines: string[], ansiLines: string[] | null, cols: number, rows: number): void {
    s.plain = { t: S2R.SCREEN, id, lines: plainLines, cols, rows };
    s.ansi = ansiLines ? { t: S2R.SCREEN, id, lines: ansiLines, cols, rows, ansi: true } : s.plain;
    this._send(id, s);
  }

  tick(): void {
    for (const id of this.union()) {
      if (!this.model.has(id)) continue;
      let s = this.state.get(id);
      if (!s) this.state.set(id, (s = { sig: '', plain: null, ansi: null, inflight: false, ansiSrc: false }));
      const wantAnsi = this._wantsAnsi(id);
      const mirror = this.hub.mirrorOf?.(id);
      if (mirror) {
        const lines = mirror.lines().map((l) => l.trimEnd());
        const ansiLines = wantAnsi && typeof mirror.ansiLines === 'function' ? mirror.ansiLines() : null;
        const sig = `m${mirror.cols}x${mirror.rows}:${wantAnsi ? 'a' : ''}:${ansiLines ? ansiLines.join('\n') : lines.join('\n')}`;
        if (sig === s.sig) continue;
        s.sig = sig;
        while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        if (ansiLines) while (ansiLines.length > lines.length) ansiLines.pop();
        this._publish(id, s, lines, ansiLines, mirror.cols, mirror.rows);
        continue;
      }
      if (s.inflight || this.source.connected === false) continue;
      s.inflight = true;
      this.reads++;
      this.source.request('pane.read', { pane_id: id, source: 'visible', format: wantAnsi ? 'ansi' : 'text' }).then((r) => {
        s.inflight = false;
        const read = isRecord(r) && isRecord(r.read) ? r.read : null;
        const text = typeof read?.text === 'string' ? read.text : '';
        const sig = `r${read?.revision ?? ''}:${wantAnsi ? 'a' : ''}:${text}`;
        if (sig === s.sig || this.state.get(id) !== s) return;
        s.sig = sig;
        const plain = toLines(text, false);
        const ansi = wantAnsi ? toLines(text, true) : null;
        const rect = this.model.get(id)?.layoutRect;
        this._publish(id, s, plain, ansi, rect?.cols ?? Math.max(0, ...plain.map((l) => l.length)), rect?.rows ?? plain.length);
      }, (e) => {
        s.inflight = false;
        this.log.debug(`screen ${id}: ${errCode(e) ?? errMessage(e)}`);
      });
    }
  }

  metrics(): { watched: number; clients: number; reads: number; sent: number } {
    return { watched: this.union().length, clients: this.watch.size, reads: this.reads, sent: this.sent };
  }

  close(): void {
    this.clock.clearInterval(this._timer);
    this._timer = null;
    this.watch.clear();
  }
}
