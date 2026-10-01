/**
 * Attention while you are elsewhere: the tab icon (a little Clawd with a gold count badge for asks, a blue dot for
 * unreviewed finishes; drawn on a canvas, no asset) and opt-in desktop notifications (Settings → Alerts, pref
 * `notify`) when a farmer gets blocked or finishes while the window is hidden or unfocused. Bursts within ~0.6 s merge
 * into one notification (copy: `notifyCopy` in format.ts), at most one per farmer per 15 s; clicking one focuses the
 * window and opens that farmer's terminal (several asks: the mailbox's Needs you tab).
 * The tab title badge lives in status.ts. Everything here runs off the HUD's 4 Hz timer and valley events, never rAF.
 */
import type { ValleyEvent, ValleyState } from '../model/types.ts';
import { notifyCopy, shortName, type Ping } from './format.ts';
import type { HudCtx } from './ctx.ts';

const MERGE_MS = 600;
const PER_FARMER_MS = 15_000;

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';
export function notifyPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}
/** ask the browser (only from a user gesture); resolves true when notifications may be shown */
export async function requestNotify(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

export interface Notifier {
  /** valley events (blocked / finished) */
  event(e: ValleyEvent): void;
  /** 4 Hz: keep the tab icon's badge in step */
  tick(s: ValleyState): void;
  /** dev / tests: what the last notification said, and the icon badge */
  debug(): { last: { title: string; body: string } | null; badge: string };
}

export function createNotifier(ctx: HudCtx): Notifier {
  let pending: Ping[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const lastAt = new Map<string, number>();
  let last: { title: string; body: string } | null = null;
  const away = () => document.hidden || !document.hasFocus();

  function flush(): void {
    timer = null;
    const s = ctx.state();
    // drop pings that went stale meanwhile (answered in another window, already reviewed)
    const pings = pending.filter((p) => { const f = s?.farmers.get(p.id); return f && (p.kind === 'blocked' ? f.needsYou : true); });
    pending = [];
    const copy = notifyCopy(pings);
    if (!copy || !ctx.prefs.notify || notifyPermission() !== 'granted' || !away()) return;
    last = copy;
    try {
      const n = new Notification(copy.title, { body: copy.body, tag: 'claude-valley', silent: false });
      const asks = pings.filter((p) => p.kind === 'blocked');
      n.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        n.close();
        if (asks.length > 1) ctx.panels.open('mailbox', 'needs');
        else ctx.openTerminal((asks[0] ?? pings[0]).id);
      };
    } catch { /* notifications unavailable (insecure context, Electron without permission) */ }
  }

  function event(e: ValleyEvent): void {
    if (e.kind !== 'blocked' && e.kind !== 'finished') return;
    if (!ctx.prefs.notify || !away()) return;
    const f = ctx.farmer(e.id);
    if (!f) return;
    const now = Date.now();
    const key = `${e.kind}|${e.id}`;
    if (now - (lastAt.get(key) ?? -Infinity) < PER_FARMER_MS) return;
    lastAt.set(key, now);
    pending.push({
      kind: e.kind, id: e.id, name: shortName(f),
      text: e.kind === 'blocked' ? f.question ?? '' : f.title ?? f.said ?? '',
    });
    timer ??= setTimeout(flush, MERGE_MS);
  }

  // ---- tab icon ----
  let badge = '-';
  let link: HTMLLinkElement | null = null;
  function tick(s: ValleyState): void {
    let need = 0, done = 0;
    for (const f of s.farmers.values()) { if (f.needsYou) need++; else if (f.unseenDone) done++; }
    const b = need ? `n${Math.min(need, 9)}${need > 9 ? '+' : ''}` : done ? 'd' : '';
    if (b === badge) return;
    badge = b;
    try {
      link ??= document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
      link.href = drawIcon(need, done > 0);
      link.dataset.badge = b;
    } catch { /* no canvas (tests) */ }
  }

  return { event, tick, debug: () => ({ last, badge }) };
}

/** 64 px tab icon: Clawd's block face, plus a gold count badge (asks) or a blue dot (finished, unreviewed). */
function drawIcon(need: number, done: boolean): string {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return '';
  // Clawd: orange block body, arm nubs, two eye notches, stubby legs
  g.fillStyle = '#d97757';
  g.fillRect(10, 14, 44, 30); g.fillRect(2, 24, 8, 10); g.fillRect(54, 24, 8, 10);
  for (const x of [14, 24, 36, 46]) g.fillRect(x, 44, 5, 10);
  g.fillStyle = '#2a1a10';
  g.fillRect(20, 22, 5, 8); g.fillRect(39, 22, 5, 8);
  if (need || done) {
    const r = need ? 17 : 12;
    g.beginPath(); g.arc(64 - r, r, r, 0, Math.PI * 2);
    g.fillStyle = need ? '#f0a72c' : '#3f95d8'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#fff6e0'; g.stroke();
    if (need) {
      g.fillStyle = '#3a2400'; g.font = `800 ${need > 9 ? 18 : 24}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(need > 9 ? '9+' : String(need), 64 - r, r + 1);
    }
  }
  return c.toDataURL('image/png');
}
