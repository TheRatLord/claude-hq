/**
 * Fern's Field Notebook (model/guide.ts is the pure notebook, farm/guidebook.ts wires it; docs/valley/guide.md): an open
 * ranger's notebook in a panel (O, rebindable; the pause menu). The left page is the index, one ribbon per chapter;
 * every activity is an entry with a pencil sketch. A found page (right) has the sketch washed with colour, the how-to
 * with the bound keys, when it can be done and your progress; a page you haven't found is an empty page with Fern's
 * cryptic hint (secrets stay secret).
 *
 * Sketches reuse the stamp book's motif drawings (hud/stamps.ts `drawMotif`), drawn in graphite twice with a seeded
 * wobble over a watercolour wash, cached as data URLs. The panel also toasts a newly found page ("a new page in your
 * notebook") and lets the notebook know about the HUD-only signals (the Gazette opened, the notebook itself).
 */
import './guide.css';
import type { HudCtx, Panel } from './ctx.ts';
import { framePanel, h } from './ctx.ts';
import { ICONS, icon } from './icons.ts';
import { drawMotif } from './stamps.ts';
import { keyLabel, ACTIONS } from '../model/prefs.ts';
import { CHAPTERS, CHAPTER_NAME, fillKeys, type Chapter, type GuideService, type PageView } from '../model/guide.ts';
import type { Motif } from '../model/stamps.ts';

const svcOf = (ctx: HudCtx): GuideService | null => { try { return ctx.b?.guide?.() ?? null; } catch { return null; } };

/** the bound keys' labels by action ({ use: 'E', notebook: 'O', … }) */
export function keyLabels(ctx: HudCtx): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ACTIONS) out[a] = keyLabel(ctx.prefs.keys[a]);
  return out;
}

/** each chapter's watercolour */
const WASH: Readonly<Record<Chapter, string>> = Object.freeze({
  pastimes: '#7fb4e2', seasons: '#f0ad5c', village: '#e8919f', explore: '#8fca7a', home: '#b997e0',
});

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
function rng(seed: number): () => number {
  let a = seed || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const cache = new Map<string, string>();
/** A pencil sketch with a watercolour wash (found), or a pencilled "?" (not yet): a cached PNG data URL. */
export function sketchImage(id: string, motif: Motif, chapter: Chapter, found: boolean, px = 120): string {
  const key = `${id}|${found}|${px}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = px * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return '';
  const r = rng(hash(id));
  g.translate(S / 2, S / 2);
  g.lineJoin = g.lineCap = 'round';
  if (found) {
    // a watercolour wash: soft overlapping blobs, a darker tide line at the edge
    const wash = WASH[chapter];
    g.save();
    for (let i = 0; i < 5; i++) {
      const x = (r() - 0.5) * S * 0.24, y = (r() - 0.5) * S * 0.2, rad = S * (0.26 + r() * 0.12);
      const grd = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
      grd.addColorStop(0, `${wash}55`); grd.addColorStop(0.82, `${wash}40`); grd.addColorStop(1, `${wash}00`);
      g.fillStyle = grd;
      g.beginPath();
      for (let k = 0; k <= 24; k++) {
        const a = (k / 24) * Math.PI * 2, rr = rad * (0.86 + r() * 0.16);
        g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.86);
      }
      g.fill();
    }
    g.restore();
    // graphite: the drawing twice with a little wobble, then a few hatching strokes underneath
    const R = S * 0.3;
    for (const [dx, dy, a, w] of [[0, 0, 0.9, 0.075], [(r() - 0.5) * 0.05, (r() - 0.5) * 0.05, 0.38, 0.045]] as const) {
      g.save(); g.translate(dx * R, dy * R); g.rotate((r() - 0.5) * 0.06); g.scale(R, R);
      g.strokeStyle = `rgba(58, 46, 36, ${a})`; g.fillStyle = `rgba(58, 46, 36, ${a * 0.78})`; g.lineWidth = w;
      drawMotif(g, motif);
      g.restore();
    }
    g.strokeStyle = 'rgba(58, 46, 36, .32)'; g.lineWidth = S * 0.006;
    for (let i = 0; i < 7; i++) { const x = -R * 0.9 + i * R * 0.28; g.beginPath(); g.moveTo(x, R * 1.18); g.lineTo(x + R * 0.18, R * 1.02); g.stroke(); }
  } else {
    // an empty page: a pencilled question mark and a smudge
    g.fillStyle = 'rgba(120, 100, 80, .1)';
    g.beginPath(); g.ellipse(0, S * 0.03, S * 0.3, S * 0.24, (r() - 0.5) * 0.4, 0, Math.PI * 2); g.fill();
    g.font = `italic 700 ${Math.round(S * 0.42)}px Georgia, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(70, 56, 44, .42)';
    g.fillText('?', 0, S * 0.04);
    g.fillStyle = 'rgba(70, 56, 44, .16)';
    g.fillText('?', S * 0.012, S * 0.03);
  }
  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** text with `{use}`-style placeholders → nodes, the keys as key caps */
function withKeys(text: string, keys: Readonly<Record<string, string>>): Node[] {
  const out: Node[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (m.index! > at) out.push(document.createTextNode(text.slice(at, m.index)));
    out.push(keys[m[1]] ? h('kbd.vh-k', { text: keys[m[1]] }) : document.createTextNode(m[0]));
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

export interface GuidePanel extends Panel {
  /** the panel manager changed what is open (the Gazette opening is a notebook signal) */
  panelChanged(id: string | null): void;
}

export function createGuidePanel(ctx: HudCtx): GuidePanel {
  const { el, body, closeBtn } = framePanel('guide', 'Fern\'s field notebook', ICONS.notebook);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const tabs = h('div.gd-tabs', { role: 'tablist', 'aria-label': 'Chapters' });
  const count = h('div.gd-count', { 'data-testid': 'guide-count' });
  const list = h('ol.gd-list', { 'data-testid': 'guide-list' });
  const left = h('div.gd-page.gd-left', null, h('div.gd-title', null, h('span', { text: 'Field notes' }), count), tabs, list,
    h('div.gd-foot', { text: '↑ ↓ pages · ← → chapters' }));
  const right = h('div.gd-page.gd-right', { 'data-testid': 'guide-page', 'aria-live': 'polite' });
  body.append(h('div.gd-book', null, left, h('div.gd-spine', { 'aria-hidden': 'true' }), right));

  let chapter: Chapter = 'pastimes';
  let sel = '';
  let sig = '';

  const pagesOf = (v: PageView[], c: Chapter) => v.filter((p) => p.def.chapter === c);

  function entry(p: PageView): HTMLElement {
    const label = p.found ? p.def.title : p.def.secret ? '? ? ?' : p.def.hint.split(/[.…!?]/)[0].trim() + '…';
    const b = h(`button.gd-entry${p.found ? '.got' : ''}${p.def.id === sel ? '.sel' : ''}`, { type: 'button', 'data-page': p.def.id, title: p.found ? p.def.title : 'Not found yet' },
      h('img.gd-thumb', { alt: '', src: sketchImage(p.def.id, p.def.motif, p.def.chapter, p.found, 44) }),
      h('span.nm', { text: label }),
      p.fresh ? h('span.gd-new', { text: 'new!' }) : p.now && !p.found && !p.def.secret ? h('span.gd-now', { text: 'now' }) : p.found ? h('span.gd-tick', { text: '✓' }) : null);
    b.addEventListener('click', () => { sel = p.def.id; ctx.sfx('page'); render(true); });
    return b;
  }

  function detail(p: PageView): HTMLElement[] {
    const keys = keyLabels(ctx);
    const img = h('img.gd-sketch', { alt: p.found ? `A sketch: ${p.def.title}` : 'An empty page', src: sketchImage(p.def.id, p.def.motif, p.def.chapter, p.found) });
    if (!p.found) {
      return [
        h('div.gd-art', null, img),
        h('h3.gd-h', { text: p.def.secret ? 'A page left blank' : 'Not found yet' }),
        h('blockquote.gd-hint', { 'data-testid': 'guide-hint' }, h('span', { text: `“${fillKeys(p.def.hint, keys)}”` }), h('cite', { text: '— Fern' })),
        ...(p.def.when && !p.def.secret ? [h('p.gd-when', null, h('b', { text: 'When: ' }), p.def.when.label, p.now ? h('span.gd-stampnow', { text: 'now!' }) : null)] : []),
      ];
    }
    return [
      h('div.gd-art', null, h('span.gd-tape'), img),
      h('h3.gd-h', null, p.def.title, p.fresh ? h('span.gd-new', { text: 'new page' }) : null),
      h('p.gd-how', { 'data-testid': 'guide-how' }, ...withKeys(p.def.how, keys)),
      ...(p.def.when ? [h('p.gd-when', null, h('b', { text: 'When: ' }), p.def.when.label, p.now ? h('span.gd-stampnow', { text: 'now!' }) : null)] : []),
      ...(p.notes.length ? [h('ul.gd-notes', { 'data-testid': 'guide-notes' }, ...p.notes.map((n) => h('li', { text: n })))] : []),
    ];
  }

  function render(force = false): void {
    const g = svcOf(ctx);
    if (!g) { right.replaceChildren(h('div.vh-empty', { text: 'Fern has the notebook with her today.' })); return; }
    const v = g.view();
    const ch = pagesOf(v.pages, chapter);
    if (!ch.some((p) => p.def.id === sel)) sel = (ch.find((p) => p.fresh) ?? ch.find((p) => p.found) ?? ch[0])?.def.id ?? '';
    const cur = v.pages.find((p) => p.def.id === sel) ?? null;
    const s = `${chapter}|${sel}|${g.version}|${v.pages.map((p) => `${+p.found}${+p.fresh}${+p.now}${p.notes.join('/')}`).join(',')}|${JSON.stringify(ctx.prefs.keys)}`;
    if (!force && s === sig) return;
    sig = s;
    count.textContent = `${v.found} of ${v.total} pages`;
    tabs.replaceChildren(...CHAPTERS.map((c) => {
      const bc = v.byChapter[c];
      const fresh = pagesOf(v.pages, c).some((p) => p.fresh);
      const b = h(`button.gd-tab${fresh ? '.fresh' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(c === chapter), 'data-ch': c, style: { '--wash': WASH[c] } },
        h('span', { text: CHAPTER_NAME[c] }), h('small', { text: `${bc.found}/${bc.total}` }));
      b.addEventListener('click', () => { chapter = c; sel = ''; ctx.sfx('page'); render(true); });
      return b;
    }));
    list.replaceChildren(...ch.map(entry));
    // the page's foot: the chapter so far, one pencilled box per page
    const chs = pagesOf(v.pages, chapter);
    const tally = h('div.gd-tally', { 'aria-label': `${CHAPTER_NAME[chapter]}: ${v.byChapter[chapter].found} of ${v.byChapter[chapter].total} pages filled` },
      h('span.l', { text: `${CHAPTER_NAME[chapter]}: ${v.byChapter[chapter].found} of ${v.byChapter[chapter].total} pages filled` }),
      h('span.boxes', null, ...chs.map((p) => h(`span.box${p.found ? '.on' : ''}${p.def.id === sel ? '.cur' : ''}`))));
    right.replaceChildren(h('div.gd-content', null, ...(cur ? detail(cur) : [])), tally);
    right.dataset.page = cur?.def.id ?? '';
    // looking at a freshly found page tells the notebook (the "new" marks clear next time round)
    if (cur?.fresh) setTimeout(() => g.read(cur.def.id), 1200);
  }

  const step = (d: number) => {
    const g = svcOf(ctx);
    if (!g) return;
    const ch = pagesOf(g.view().pages, chapter);
    const i = ch.findIndex((p) => p.def.id === sel);
    const next = ch[(i + d + ch.length) % ch.length];
    if (next) { sel = next.def.id; ctx.sfx('ui-click'); render(true); (list.querySelector(`[data-page="${sel}"]`) as HTMLElement | null)?.focus(); }
  };
  const turn = (d: number) => {
    const i = CHAPTERS.indexOf(chapter);
    chapter = CHAPTERS[(i + d + CHAPTERS.length) % CHAPTERS.length];
    sel = '';
    ctx.sfx('page');
    render(true);
  };

  return {
    id: 'guide', el,
    onOpen(arg) {
      const g = svcOf(ctx);
      g?.see('notebook');
      // open on a page ('rowboat') or a chapter, else the chapter with something new, else where you left off
      const want = typeof arg === 'string' ? arg : null;
      const v = g?.view();
      const page = want ? v?.pages.find((p) => p.def.id === want) : v?.pages.find((p) => p.fresh);
      if (want && (CHAPTERS as readonly string[]).includes(want)) { chapter = want as Chapter; sel = ''; }
      else if (page) { chapter = page.def.chapter; sel = page.def.id; }
      ctx.sfx('page');
      render(true);
    },
    refresh() { render(); },
    key(e) {
      if (e.key === 'ArrowDown') { step(1); return true; }
      if (e.key === 'ArrowUp') { step(-1); return true; }
      if (e.key === 'ArrowRight') { turn(1); return true; }
      if (e.key === 'ArrowLeft') { turn(-1); return true; }
      if (e.code === ctx.prefs.keys.notebook && !e.ctrlKey && !e.altKey && !e.metaKey) { ctx.panels.close(); return true; }
      return false;
    },
    panelChanged(id) {
      if (id === 'gazette') svcOf(ctx)?.see('gazette');
    },
  };
}

/** a newly found page: a toast ("a new page in Fern's notebook") */
export function watchGuide(ctx: HudCtx, g: GuideService): void {
  g.onChange((c) => {
    if (c.kind !== 'found') return;
    for (const p of c.pages) {
      ctx.toast({
        text: `A new page in Fern's notebook: ${p.title}`, sub: `${keyLabel(ctx.prefs.keys.notebook)} to read it`,
        icon: `<img class="vh-stamp-ico" alt="" src="${sketchImage(p.id, p.motif, p.chapter, true, 44)}">`, level: 'good', key: `guide|${p.id}`, group: 'guide',
      });
    }
  });
}
