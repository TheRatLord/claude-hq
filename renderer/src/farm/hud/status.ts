/**
 * Top-left status sign (clock, season + date, weather, link state, farmer counts), the friendly offline banner,
 * and the document-title badge. Driven from the HUD's slow timer so the title updates in hidden tabs.
 */
import { SEASON_ICON, WEATHER_ICON, ICONS, icon } from './icons.ts';
import { clock, LINK_LABEL, SEASON_LABEL, WEATHER_LABEL } from './format.ts';
import { h, type HudCtx } from './ctx.ts';
import { rankChip } from './almanac.ts';

export interface StatusCorner { el: HTMLElement; banner: HTMLElement; refresh(): void }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function createStatus(ctx: HudCtx): StatusCorner {
  const wx = h('div.wx');
  const time = h('div.time', { 'data-testid': 'clock' });
  const seasonIco = h('span.vh-ico');
  const date = h('span');
  const link = h('span.vh-link', { 'data-testid': 'link-state' });
  const counts = h('div.vh-counts');
  const rank = rankChip(ctx);
  const face = h('div.vh-paper.face', null, wx, h('div', null, time, h('div.date', null, seasonIco, date), h('div.meta', null, link, counts), rank.el));
  const el = h('div.vh-status.vh-wood', { role: 'status', 'aria-label': 'Clock and connection' }, face);
  el.addEventListener('click', () => ctx.panels.open('noticeboard'));
  el.title = 'Open the noticeboard';
  el.style.cursor = 'pointer';

  const bannerText = h('div');
  const banner = h('div.vh-banner', { role: 'alert', 'data-testid': 'offline-banner' }, icon(ICONS.bell), bannerText);

  let sigWx = '', sigSeason = '', lastTitle = '';
  function refresh(): void {
    const s = ctx.state();
    const now = new Date();
    if (!s) {
      time.textContent = clock(now.getHours() + now.getMinutes() / 60);
      link.className = 'vh-link connecting'; link.textContent = LINK_LABEL.connecting;
      return;
    }
    const sky = s.sky;
    time.textContent = clock(sky.hour);
    rank.refresh(s.almanac);
    const night = sky.daylight < 0.25;
    const wk = sky.weather.kind === 'clear' && night ? 'night' : sky.weather.kind;
    if (wk !== sigWx) { sigWx = wk; wx.innerHTML = WEATHER_ICON[wk]; wx.title = `${WEATHER_LABEL[sky.weather.kind]}${night ? ' night' : ''}`; }
    if (sky.season !== sigSeason) { sigSeason = sky.season; seasonIco.innerHTML = SEASON_ICON[sky.season]; }
    date.textContent = `${SEASON_LABEL[sky.season]} · ${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
    const cls = s.link === 'live' && s.demo ? 'demo' : s.link;
    link.className = `vh-link ${cls}`;
    link.textContent = s.link === 'live' && s.demo ? 'Demo valley' : LINK_LABEL[s.link];
    let need = 0, work = 0, done = 0;
    for (const f of s.farmers.values()) { if (f.needsYou) need++; else if (f.status === 'working') work++; else if (f.unseenDone) done++; }
    const sig = `${need}|${work}|${done}|${s.farmers.size}|${s.link}`;
    if (counts.dataset.sig !== sig) {
      counts.dataset.sig = sig;
      counts.replaceChildren(
      ...(need ? [h('span.need', null, h('b', { text: String(need) }), need === 1 ? ' needs you' : ' need you')] : []),
      ...(work ? [h('span', null, h('b', { text: String(work) }), ' working')] : []),
      ...(done ? [h('span', null, h('b', { text: String(done) }), ' done')] : []),
      ...(!work && !done && !need ? [h('span', { text: s.farmers.size ? 'all quiet' : s.link === 'live' ? 'no farmers yet' : 'waiting for herdr' })] : []),
      );
    }
    // banner
    const off = s.link === 'offline' || s.link === 'herdr-offline';
    banner.classList.toggle('show', off);
    banner.classList.toggle('herdr', s.link === 'herdr-offline');
    if (s.link === 'offline') bannerText.textContent = 'The valley lost its path to HQ. Reconnecting… your farmers keep working meanwhile.';
    else if (s.link === 'herdr-offline') bannerText.textContent = "herdr isn't answering, so the farmers are napping. They'll wake up the moment it's back.";
    // title badge
    const unseen = [...s.farmers.values()].filter((f) => f.unseenDone).length;
    const t = need ? `(${need}) need${need === 1 ? 's' : ''} you · Claude Valley` : unseen ? `✓ ${unseen} done · Claude Valley` : 'Claude Valley';
    const title = `${t}${s.demo ? ' · demo' : ''}`;
    if (title !== lastTitle) { lastTitle = title; document.title = title; }
  }
  refresh();
  return { el, banner, refresh };
}
