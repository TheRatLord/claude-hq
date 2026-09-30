/**
 * Screen mirror: one `@xterm/headless` terminal per live child at the child's grid, fed with every
 * frame; `serialize()` produces the `full` frame for late joiners / resumed tabs / needsFull clients.
 * `lines()` feeds `screen` messages for panes with a live child (world/screens.ts via hub.mirrorOf).
 */
import xtermHeadless from '@xterm/headless';
import serializePkg from '@xterm/addon-serialize';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializePkg;
const te = new TextEncoder();

export class Mirror {
  cols: number;
  rows: number;
  term: InstanceType<typeof Terminal>;
  ser: InstanceType<typeof SerializeAddon>;
  frames: number;
  /** dispose() was requested (writes are ignored) */
  disposed = false;
  /** the deferred dispose has run (the terminal is gone) */
  dead = false;
  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
    this.ser = new SerializeAddon();
    this.term.loadAddon(this.ser);
    this.frames = 0;
  }
  write(bytes: Uint8Array, full: boolean): void {
    if (this.disposed) return;
    if (full) this.term.reset();
    this.term.write(bytes);
    this.frames++;
  }
  resize(cols: number, rows: number): void {
    if (this.disposed || (cols === this.cols && rows === this.rows)) return;
    this.cols = cols;
    this.rows = rows;
    this.term.resize(cols, rows);
  }
  /** Serialized screen as a `full` frame payload. */
  full(): Promise<Uint8Array> {
    // a full() racing dispose() must not serialize a disposed terminal (xterm throws "DisposableStore
    // already disposed"); it resolves an empty clear-screen frame instead.
    const empty = (): Uint8Array => te.encode('\x1b[H\x1b[2J');
    if (this.dead) return Promise.resolve(empty());
    return new Promise<Uint8Array>((resolve) => {
      this.term.write('', () => resolve(this.dead ? empty()
        : te.encode(`\x1b[?2026h\x1b[H\x1b[2J${this.ser.serialize({ scrollback: 0 })}\x1b[?2026l`)));
    });
  }
  /** Visible lines as plain text (for `screen` messages). */
  lines(): string[] {
    if (this.dead) return [];
    const b = this.term.buffer.active, out: string[] = [];
    for (let i = 0; i < this.rows; i++) out.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? '');
    return out;
  }
  /**
   * Visible lines with SGR colour escapes only (fg, bg, bold, inverse) for tinted monitors (`screen.watch {ansi:true}`).
   * Trailing default-coloured blanks are trimmed; a coloured line ends with one reset.
   */
  ansiLines(): string[] {
    if (this.dead) return [];
    const b = this.term.buffer.active, out: string[] = [];
    const cell = b.getNullCell();
    const colour = (isRGB: boolean, isPal: boolean, v: number, base: number) => (isRGB ? `${base};2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}` : isPal ? `${base};5;${v}` : `${base + 1}`);
    for (let i = 0; i < this.rows; i++) {
      const line = b.getLine(b.viewportY + i);
      if (!line) { out.push(''); continue; }
      let s = '', cur = '', end = 0, endLen = 0;
      for (let x = 0; x < this.cols; x++) {
        if (!line.getCell(x, cell) || cell.getWidth() === 0) continue;
        const fg = colour(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor(), 38);
        const bg = colour(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor(), 48);
        const sgr = `${cell.isBold() ? '1;' : ''}${cell.isInverse() ? '7;' : ''}${fg};${bg}`;
        if (sgr !== cur) {
          s += `\x1b[0;${sgr}m`;
          cur = sgr;
        }
        const ch = cell.getChars() || ' ';
        s += ch;
        if (ch !== ' ' || !/(^|;)(39;49)$/.test(sgr) || cell.isInverse()) { end = s.length; endLen = 1; }
      }
      const body = endLen ? s.slice(0, end) : '';
      out.push(body && body.includes('\x1b[') && !/^\x1b\[0;39;49m[^\x1b]*$/.test(body) ? body + '\x1b[0m' : body.replace(/\x1b\[0;39;49m/g, ''));
    }
    return out;
  }
  /** Deferred until queued writes are parsed (disposing mid-parse makes xterm warn about leaked disposables). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.term.write('', () => { this.dead = true; this.term.dispose(); });
  }
}
