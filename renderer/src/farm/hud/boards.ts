/**
 * The noticeboard (a corkboard summary of the valley) and the stats panel (the numbers behind the landmark gauges:
 * windmill = CPU, water tower = RAM, silo = disk, chimney = disk IO, pigeons = network, barn thermometer = temp).
 */
import type { Gauges } from '../model/types.ts';
import { ICONS, KIND_ICON, LETTER_ICON, SEASON_ICON, WEATHER_ICON, icon } from './icons.ts';
import { ago, bytesRate, clock, letterTitle, JOB_LABEL, nice, pct, SEASON_LABEL, shortName, STAGE_LABEL, STATUS_RANK, WEATHER_LABEL } from './format.ts';
import { framePanel, h, type HudCtx, type Panel } from './ctx.ts';
import { FESTIVAL_ICON } from './festival.ts';
import { SOON_DAYS, dayText, inDaysText } from '../model/calendar.ts';
import type { RequestView } from '../model/friends.ts';
import { HEART_ICON } from './friends.ts';

export function createNoticeboard(ctx: HudCtx): Panel {
  const { el, body, closeBtn } = framePanel('noticeboard', 'Noticeboard', ICONS.board);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const cork = h('div.vh-cork', { 'data-testid': 'cork' });
  body.append(cork);
  let sig = '';
  const note = (cls: string, onClick: (() => void) | null, ...kids: (Node | string | null)[]) => {
    const n = h(`div.vh-note${cls}${onClick ? '.click' : ''}`, onClick ? { role: 'button', tabindex: '0' } : null, ...kids);
    if (onClick) { n.addEventListener('click', onClick); n.addEventListener('keydown', (e) => { if (e.key === 'Enter') onClick(); }); }
    return n;
  };
  /** a list line you can click or Enter (stopPropagation: the note itself may be clickable too) */
  const go = (fn: () => void, title: string, ...kids: (Node | string | null)[]) => {
    const li = h('li.go', { tabindex: '0', role: 'button', title }, ...kids);
    li.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); fn(); } });
    return li;
  };
  const more = (n: number, what: string) => (n > 0 ? h('div.more', { text: `+${n} more ${what}` }) : null);
  function render(): void {
    const s = ctx.state();
    if (!s) return;
    const farmers = [...s.farmers.values()];
    const need = farmers.filter((f) => f.needsYou);
    const done = farmers.filter((f) => f.unseenDone);
    const working = farmers.filter((f) => f.status === 'working');
    const plots = [...s.plots.values()].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label));
    // villagers' requests for today (model/friends.ts)
    let reqs: RequestView[] = [];
    try { reqs = ctx.b?.friends?.()?.requests() ?? []; } catch { reqs = []; }
    const nsig = JSON.stringify([reqs.map((q) => `${q.req.id}${q.have}${q.ready}${q.done}`), need.map((f) => f.id + f.question), done.map((f) => f.id), working.map((f) => f.id + f.job), plots.map((p) => p.id + p.stage + p.farmers.length), s.letters.slice(0, 5).map((l) => l.id + l.title), Math.floor(s.sky.hour * 4), s.sky.weather.kind, s.gauges ? Math.round(s.gauges.cpu * 20) : 0, s.almanac.points, s.sky.festival?.active?.id, s.sky.festival?.active?.day, s.sky.festival?.next?.inDays]);
    if (nsig === sig) return;
    sig = nsig;
    const notes: HTMLElement[] = [];
    notes.push(note(need.length ? '.ask' : '', need.length ? () => ctx.panels.open('mailbox', 'needs') : null,
      h('h4', null, icon(ICONS.bang), 'Needs you'),
      h('div.big', { text: String(need.length) }),
      need.length ? h('ul', null, ...need.slice(0, 5).map((f) => go(() => ctx.panels.open('card', f.id), `${nice(f.name)}: answer`, h('b', { text: shortName(f) }), `: ${f.question ?? 'waiting'}`))) : h('p', { text: 'Nobody is waiting. Enjoy the sunshine.' }),
      more(need.length - 5, 'waiting')));
    // the festival poster (model/calendar.ts): what's on, or what's coming up soon
    const fa = s.sky.festival?.active, fn = s.sky.festival?.next;
    if (fa) notes.push(note('.fest', null,
      h('h4', null, icon(FESTIVAL_ICON[fa.id]), 'Festival'),
      h('div.big', { text: fa.name }),
      h('p', { text: fa.blurb }),
      h('p.vh-muted', { text: `${dayText(fa)}${fn && fn.inDays <= SOON_DAYS * 2 ? ` · next: ${fn.name} ${inDaysText(fn.inDays)}` : ''}`, style: { fontSize: '12px' } })));
    else if (fn && fn.inDays <= SOON_DAYS) notes.push(note('.fest', null,
      h('h4', null, icon(FESTIVAL_ICON[fn.id]), 'Coming up'),
      h('div.big', { text: fn.name }),
      h('p', { text: fn.blurb }),
      h('p.vh-muted', { text: `${inDaysText(fn.inDays)[0].toUpperCase()}${inDaysText(fn.inDays).slice(1)} · ${fn.start}`, style: { fontSize: '12px' } })));
    if (reqs.length) notes.push(note(reqs.some((q) => q.ready) ? '.req.ask' : '.req', () => ctx.panels.open('friends'),
      h('h4', null, icon(HEART_ICON), 'Requests'),
      h('ul', null, ...reqs.map((q) => h(`li${q.done ? '.vh-muted' : ''}`, null, h('b', { text: q.friend.short }), `: ${q.text.replace(new RegExp(`\\s(for )?${q.friend.short}\\b`), '')}`,
        h('span.vh-muted', { text: ` · ${q.done ? 'done ✓' : q.ready ? 'ready, tell them!' : q.next}`, style: { fontSize: '12px' } })))),
      h('p.vh-muted', { text: 'Talk to them to hear more, and to hand it over. Tap for your friends.', style: { fontSize: '12px' } })));
    const wk = s.sky.weather.kind === 'clear' && s.sky.daylight < 0.25 ? 'night' : s.sky.weather.kind;
    notes.push(note('', () => ctx.panels.open('stats'),
      h('h4', null, icon(WEATHER_ICON[wk]), 'Today in the valley'),
      h('p', null, h('b', { text: clock(s.sky.hour) }), ` · ${SEASON_LABEL[s.sky.season]} · ${WEATHER_LABEL[s.sky.weather.kind]}`),
      h('p', null, icon(SEASON_ICON[s.sky.season]), ` ${working.length} at work · ${farmers.length} farmers · ${plots.filter((p) => p.stage !== 'fallow').length} fields`),
      s.gauges ? h('p', { text: `${s.gauges.host}: CPU ${pct(s.gauges.cpu)} · RAM ${pct(s.gauges.mem)}` }) : null,
      h('p.vh-muted', { text: 'Tap for the numbers behind the landmarks.', style: { fontSize: '12px' } })));
    const al = s.almanac;
    notes.push(note('', () => ctx.panels.open('almanac'),
      h('h4', null, icon(ICONS.rosette), 'Valley Almanac'),
      h('div.big', { text: al.name }),
      h('p', { text: al.nextAt !== null ? `${al.points} / ${al.nextAt} prosperity toward ${al.nextName}` : `${al.points} prosperity` }),
      h('p.vh-muted', { text: al.today.points ? `+${al.today.points} today${al.streak > 1 ? ` · ${al.streak}-day streak` : ''}` : 'Nothing harvested yet today.', style: { fontSize: '12px' } })));
    if (done.length) notes.push(note('', null, h('h4', null, icon(LETTER_ICON.finished), 'Ready for review'),
      h('ul', null, ...done.slice(0, 6).map((f) => go(() => ctx.openTerminal(f.id), `${nice(f.name)}: open the terminal`, h('b', { text: shortName(f) }), f.title ? ` — ${f.title}` : ''))),
      more(done.length - 6, 'to review')));
    if (!plots.length) {
      const away = s.link === 'offline' || s.link === 'herdr-offline' || s.link === 'connecting';
      notes.push(note('', null, h('h4', null, icon(ICONS.sprout), 'No fields yet'),
        h('p', { text: away ? "herdr isn't answering yet. The fields come back as soon as it does." : 'Open a herdr workspace: a field gets tilled, and its agents come out to farm it.' })));
    }
    for (const p of plots.slice(0, 9)) {
      const fs = p.farmers.map((id) => s.farmers.get(id)).filter((f) => !!f);
      notes.push(note('', () => ctx.panels.open('roster'),
        h('h4', null, icon(KIND_ICON[p.kind]), p.label),
        h('p.vh-muted', { text: `${STAGE_LABEL[p.stage]} · ${fs.length} farmer${fs.length === 1 ? '' : 's'}${p.helpers.length ? ` · ${p.helpers.length} scarecrow${p.helpers.length === 1 ? '' : 's'}` : ''}`, style: { fontSize: '12.5px', fontWeight: '700' } }),
        h('ul', null, ...fs.slice(0, 5).map((f) => go(() => ctx.openTerminal(f.id), `${nice(f.name)}: open the terminal`, h(`i.vh-dot.st-${f.status}`, { style: { marginRight: '5px' } }), h('b', { text: shortName(f) }), ` ${f.needsYou ? 'needs you' : JOB_LABEL[f.job].toLowerCase()}`))),
        more(fs.length - 5, 'farmers')));
    }
    if (s.letters.length) notes.push(note('', () => ctx.panels.open('mailbox'),
      h('h4', null, icon(ICONS.mail), 'Latest letters'),
      h('ul', null, ...s.letters.slice(0, 5).map((l) => h('li', null, letterTitle(l), h('span.vh-muted', { text: ` · ${ago(l.at, s.now)}`, style: { fontSize: '12px' } }))))));
    cork.replaceChildren(...notes);
  }
  return { id: 'noticeboard', el, onOpen() { sig = ''; render(); }, refresh: render };
}

// ---------------------------------------------------------------------------------------------

interface Hist { io: number[]; net: number[]; temp: number[]; gpu: number[]; at: number }
const HN = 120;
const push = (a: number[], v: number) => { a.push(v); if (a.length > HN) a.shift(); };

function spark(cv: HTMLCanvasElement, data: readonly number[], max: number, color: string): void {
  const w = cv.clientWidth || 260, hh = cv.clientHeight || 54;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hh);
  g.strokeStyle = 'rgba(122, 82, 49, .18)'; g.lineWidth = 1;
  for (const y of [0.25, 0.5, 0.75]) { g.beginPath(); g.moveTo(0, hh * y); g.lineTo(w, hh * y); g.stroke(); }
  if (data.length < 2) return;
  const n = HN, dx = w / (n - 1), off = n - data.length;
  const Y = (v: number) => hh - 2 - Math.max(0, Math.min(1, v / (max || 1))) * (hh - 6);
  g.beginPath();
  data.forEach((v, i) => { const x = (off + i) * dx; if (i) g.lineTo(x, Y(v)); else g.moveTo(x, Y(v)); });
  g.lineTo(w, hh); g.lineTo(off * dx, hh); g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, hh);
  grad.addColorStop(0, `${color}88`); grad.addColorStop(1, `${color}10`);
  g.fillStyle = grad; g.fill();
  g.beginPath();
  data.forEach((v, i) => { const x = (off + i) * dx; if (i) g.lineTo(x, Y(v)); else g.moveTo(x, Y(v)); });
  g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
}

export function createStats(ctx: HudCtx): Panel & { sample(): void } {
  const { el, body, closeBtn } = framePanel('stats', 'Valley gauges', ICONS.stats);
  closeBtn.addEventListener('click', () => ctx.panels.close());
  const hostEl = h('div.vh-h3');
  const grid = h('div.vh-gauges', { 'data-testid': 'gauges' });
  body.append(hostEl, grid);
  const hist: Hist = { io: [], net: [], temp: [], gpu: [], at: 0 };

  type Card = { el: HTMLElement; val: HTMLElement; sub: HTMLElement; cv: HTMLCanvasElement | null; cores?: HTMLElement };
  const card = (name: string, lore: string, sparkline = true, cores = false): Card => {
    const val = h('span.val'), sub = h('div.sub'), cv = sparkline ? h('canvas') : null;
    const coresEl = cores ? h('div.cores') : undefined;
    const el = h('div.vh-gauge', null, h('div.l1', null, h('div', null, h('div.nm', { text: name }), h('div.lore', { text: lore })), val), sub, cv, coresEl ?? null);
    grid.append(el);
    return { el, val, sub, cv, cores: coresEl };
  };
  const cpu = card('CPU', 'windmill blades', true, true);
  const mem = card('Memory', 'water tower level');
  const swap = card('Swap', 'the overflow barrel', false);
  const disk = card('Disk', 'silo fill', false);
  const io = card('Disk IO', 'chimney smoke');
  const net = card('Network', 'carrier pigeons');
  const gpu = card('GPU', 'greenhouse glow');
  const temp = card('Temperature', 'barn thermometer');

  function sample(): void {
    const g = ctx.state()?.gauges;
    if (!g || g.at === hist.at) return;
    hist.at = g.at;
    push(hist.io, g.ioRead + g.ioWrite);
    push(hist.net, g.netRx + g.netTx);
    push(hist.temp, g.tempC ?? 0);
    push(hist.gpu, g.gpu ?? 0);
  }
  const bar = (v: number) => h(`div.vh-bar${v > 0.9 ? '.hot' : v > 0.7 ? '.warn' : ''}`, null, h('i', { style: { width: pct(v) } }));
  function render(): void {
    const g: Gauges | null | undefined = ctx.state()?.gauges;
    if (!g) { hostEl.replaceChildren('Waiting for the first readings from the farmhouse…'); return; }
    hostEl.replaceChildren(icon(ICONS.gear), `${g.host} · load ${g.load1.toFixed(2)} · ${g.cores.length} cores`);
    cpu.val.textContent = pct(g.cpu); cpu.sub.textContent = `load ${g.load1.toFixed(2)}`;
    spark(cpu.cv!, g.cpuHistory, 1, '#5fae45');
    cpu.cores!.replaceChildren(...g.cores.map((c) => h('i', { style: { height: `${Math.max(4, c * 100)}%` }, title: pct(c) })));
    mem.val.textContent = pct(g.mem); mem.sub.textContent = `${g.memUsedGB.toFixed(1)} of ${g.memTotalGB.toFixed(1)} GB`;
    spark(mem.cv!, g.memHistory, 1, '#3f95d8');
    swap.val.textContent = pct(g.swap); swap.sub.replaceChildren(bar(g.swap));
    disk.val.textContent = pct(g.disk); disk.sub.replaceChildren(`${g.diskUsedGB.toFixed(0)} of ${g.diskTotalGB.toFixed(0)} GB`, bar(g.disk));
    io.val.textContent = bytesRate(g.ioRead + g.ioWrite); io.sub.textContent = `read ${bytesRate(g.ioRead)} · write ${bytesRate(g.ioWrite)}`;
    spark(io.cv!, hist.io, Math.max(1024 * 1024, ...hist.io), '#a0703f');
    net.val.textContent = bytesRate(g.netRx + g.netTx); net.sub.textContent = `↓ ${bytesRate(g.netRx)} · ↑ ${bytesRate(g.netTx)}`;
    spark(net.cv!, hist.net, Math.max(64 * 1024, ...hist.net), '#8e4fbf');
    gpu.val.textContent = g.gpu == null ? '—' : pct(g.gpu); gpu.sub.textContent = g.gpu == null ? 'no GPU sensor found' : 'busy';
    spark(gpu.cv!, g.gpu == null ? [] : hist.gpu, 1, '#e8a53a');
    temp.val.textContent = g.tempC == null ? '—' : `${Math.round(g.tempC)}°C`; temp.sub.textContent = g.tempC == null ? 'no sensor found' : g.tempC > 85 ? 'toasty!' : g.tempC > 70 ? 'warm' : 'comfy';
    spark(temp.cv!, g.tempC == null ? [] : hist.temp, 100, '#d0584a');
  }
  return { id: 'stats', el, onOpen: render, refresh: render, sample };
}
