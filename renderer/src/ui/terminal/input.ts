// @pure
/**
 * Terminal input pipeline for one viewer.
 * - Interactive (xterm onData from typing, ≤ 4 KB): binary `term.input`, no rid, fire-and-forget; ≤ 64 KB un-acked
 *   (credit window, `term.ack {upTo}` = cumulative bytes the hub wrote for this viewer); beyond that it queues locally.
 * - Paste (xterm.paste or a single onData > 4 KB): JSON `term.input {id, text, paste:true, rid}` in UTF-8-safe chunks
 *   of ≤ 16 KB, the next only after the previous reply (hub awaits stdin drain). Interactive data typed during a
 *   paste queues behind it (order kept).
 * - Hold: while promoting (auto-flush when control is live) or while the terminal is not writable (the outbox:
 *   ≤ 4 KB, flushed or discarded by the consumer).
 */

import type { ClientMsgOf } from '../../../../shared/protocol.ts';

const te = new TextEncoder();

/**
 * Split text into chunks of ≤ maxBytes UTF-8 bytes without splitting a code point.
 */
export function chunkUtf8(text: string, maxBytes = 16 * 1024): string[] {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0; // a `for..of` step always has a code point
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > maxBytes) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  if (cur) out.push(cur);
  return out;
}

export const OUTBOX_MAX = 4 * 1024;
export const PASTE_HARD_CAP = 1024 * 1024;

export interface PipeDeps {
  id: string;
  /** interactive frame; false = not connected */
  sendBinary: (bytes: Uint8Array) => boolean;
  call: (msg: ClientMsgOf<'term.input'>) => Promise<{ ok: boolean; error?: string }>;
  /** credit window bytes (64 KB) */
  window?: number;
  /** (4 KB) */
  interactiveMax?: number;
  /** paste chunk bytes (16 KB) */
  chunk?: number;
  onPaste?: (info: { sent: number; total: number; done: boolean; error?: string }) => void;
  /** held/queued size changed (outbox chip) */
  onChange?: () => void;
}

/** A unit of pending input: one paste, or a run of interactive keystrokes. */
interface Pending { paste: boolean; data: string }

export function createInputPipe(d: PipeDeps) {
  const windowBytes = d.window ?? 64 * 1024;
  const interactiveMax = d.interactiveMax ?? 4 * 1024;
  const chunkMax = d.chunk ?? 16 * 1024;
  let id = d.id;
  let sent = 0; // interactive bytes sent to this viewer since the last reset
  let pasted = 0; // paste bytes the hub confirmed (they show up in upTo too, but never use the credit window)
  let upTo = 0; // bytes the hub reports written (both paths)
  let ackI = 0; // interactive bytes known written (monotonic)
  const inFlight = () => sent - Math.max(ackI, upTo - pasted);
  let queue: Pending[] = []; // waiting for credit / behind a paste (auto-sent)
  let held: Pending[] = []; // outbox / promotion hold (not sent until release)
  let mode: 'send' | 'hold' = 'send';
  let pasting = false;
  let epoch = 0;

  const size = (list: Pending[]) => list.reduce((n, x) => n + x.data.length, 0);
  const changed = () => d.onChange?.();

  function pump() {
    while (queue.length && !pasting && mode === 'send') {
      const item = queue[0];
      if (item.paste) {
        queue.shift();
        void runPaste(item.data);
        return;
      }
      const bytes = te.encode(item.data);
      if (inFlight() + bytes.length > windowBytes && inFlight() > 0) return; // wait for term.ack
      if (!d.sendBinary(bytes)) return; // disconnected: keep queued
      queue.shift();
      sent += bytes.length;
    }
    changed();
  }

  async function runPaste(text: string) {
    pasting = true;
    const my = epoch;
    const chunks = chunkUtf8(text, chunkMax);
    const total = text.length;
    let done = 0;
    for (let i = 0; i < chunks.length; i++) {
      const r = await d.call({ t: 'term.input', id, text: chunks[i], paste: true });
      if (my !== epoch) return; // reset meanwhile
      if (!r.ok) {
        // keep the rest in the outbox; the user decides (never dropped silently)
        const rest = chunks.slice(i).join('');
        held.unshift({ paste: true, data: rest });
        mode = 'hold';
        pasting = false;
        d.onPaste?.({ sent: done, total, done: true, error: r.error });
        changed();
        return;
      }
      pasted += te.encode(chunks[i]).length;
      done += chunks[i].length;
      d.onPaste?.({ sent: done, total, done: i === chunks.length - 1 });
    }
    pasting = false;
    pump();
  }

  return {
    /** xterm onData. */
    write(data: string, { paste = false }: { paste?: boolean } = {}): 'sent' | 'queued' | 'held' | 'overflow' {
      if (!data) return 'sent';
      const isPaste = paste || data.length > interactiveMax;
      if (mode === 'hold') {
        if (!isPaste && size(held) + data.length > OUTBOX_MAX) return 'overflow';
        const last = held[held.length - 1];
        if (last && !last.paste && !isPaste) last.data += data;
        else held.push({ paste: isPaste, data });
        changed();
        return 'held';
      }
      const last = queue[queue.length - 1];
      if (last && !last.paste && !isPaste) last.data += data;
      else queue.push({ paste: isPaste, data });
      pump();
      return queue.length || pasting ? 'queued' : 'sent';
    },
    /** term.ack */
    ack(n: number) {
      upTo = n;
      ackI = Math.max(ackI, upTo - pasted);
      pump();
    },
    /** Stop sending; new input is held (outbox / promotion). */
    hold() { mode = 'hold'; changed(); },
    /** Send held input (after promotion, or the outbox "Send"). */
    release() {
      mode = 'send';
      queue = [...held, ...queue];
      held = [];
      pump();
    },
    /** Outbox "Discard". */
    discard() { held = []; changed(); },
    /** New viewer (term.open / re-open): the hub's counters restart. Queued (unsent) input is kept. */
    reset(newId: string = id) {
      id = newId;
      sent = 0;
      pasted = 0;
      upTo = 0;
      ackI = 0;
      epoch++;
      pasting = false;
      pump();
    },
    get held() { return size(held); },
    get queued() { return size(queue); },
    get inFlight() { return inFlight(); },
    get holding() { return mode === 'hold'; },
    get pasting() { return pasting; },
    get id() { return id; },
  };
}
