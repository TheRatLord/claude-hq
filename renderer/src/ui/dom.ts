/**
 * Tiny DOM helpers + inline SVG icons (ART §9.1: 1.75 px stroke, round caps, 20 px grid, drawn in code; no icon
 * fonts, no emoji dependence). Owner: UI.
 */
import type { Entity, EntityWorkspace, Status } from '../../../shared/protocol.ts';
import { STATUS, CORE, KIND_BODY, BODY, WORKSPACE, MISC, ENV, PORTRAIT as PT } from '../../../shared/palette.ts';

type StripDot<S extends string> = S extends `${infer T}.${string}` ? T : S;
type StripHash<S extends string> = S extends `${infer T}#${string}` ? T : S;
/** The element type for a `'tag.cls#id'` selector string (HTMLElement when the tag is not a known one). */
type ElementOf<S extends string> = StripHash<StripDot<S>> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[StripHash<StripDot<S>>] : HTMLElement;

type KidLeaf = Node | string | number | boolean | null | undefined;
/** Anything `h` accepts as a child: nodes, text-ish values, one level of array; null / undefined / false are skipped. */
export type Kid = KidLeaf | readonly KidLeaf[];
/** `h` attributes: `text`, `html`, `onclick`-style listeners, `style` object, everything else becomes an attribute. */
export type Attrs = Record<string, unknown>;

const isListener = (v: unknown): v is EventListener => typeof v === 'function';

/** h('div.cls#id', {attr}, ...children) */
export function h<S extends string>(tag: S, attrs?: Attrs | null, ...kids: Kid[]): ElementOf<S> {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m ? m[1] : tag);
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && isListener(v)) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, String(sv)); else Reflect.set(el.style, sk, sv); } }
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  // createElement(string) is typed HTMLElement; the selector's tag decides the concrete subtype (see ElementOf).
  return el as ElementOf<S>;
}

/** Give focus back to an element captured earlier (`document.activeElement`); a no-op for `null` and non-focusable nodes. */
/** Set `disabled` on a kit `button()` (typed as a plain HTMLElement there); a no-op on anything that is not a button. */
export function setDisabled(el: HTMLElement, v: boolean): void {
  if (el instanceof HTMLButtonElement) el.disabled = v;
}

export function refocus(el: Element | null | undefined, opts?: FocusOptions): void {
  if (el instanceof HTMLElement || el instanceof SVGElement) el.focus(opts);
}

/** Set text only when it changed (cheap 10 Hz refresh). */
export function setText(el: Node, t: unknown) {
  const s = t == null ? '' : String(t);
  if (el.textContent !== s) el.textContent = s;
}

/** Toggle a class only when it changed. */
export function cls(el: Element, name: string, on: unknown) {
  if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
}

const svg = (body: string, size = 16) => `<svg viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Icon paths on a 20 px grid. */
export const ICON = {
  term: svg('<rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M6 8l2.5 2L6 12M10.5 12.5h3.5"/>'),
  goto: svg('<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.6"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3"/>'),
  follow: svg('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3" fill="currentColor"/>'),
  check: svg('<path d="M4 10.5l3.5 3.5L16 6"/>'),
  answer: svg('<path d="M8 5L3.5 9.5 8 14"/><path d="M4 9.5h7.5a5 5 0 0 1 5 5V16"/>'),
  pin: svg('<path d="M7 3h6l-1 5 3 3H5l3-3z"/><path d="M10 11v6"/>'),
  search: svg('<circle cx="9" cy="9" r="5.5"/><path d="M13 13l4 4"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
  chevron: svg('<path d="M7 4l6 6-6 6"/>'),
  chevronLeft: svg('<path d="M13 4l-6 6 6 6"/>'),
  plus: svg('<path d="M10 4v12M4 10h12"/>'),
  copy: svg('<rect x="6.5" y="6.5" width="10" height="10" rx="2"/><path d="M13.5 6.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5"/>'),
  release: svg('<path d="M10 3v7"/><path d="M6 6.2a6 6 0 1 0 8 0"/>'),
  focus: svg('<path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13"/><path d="M10 7.5l2.5 2.5-2.5 2.5"/>'),
  eye: svg('<path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.5"/>'),
  keyboard: svg('<rect x="2" y="5" width="16" height="10" rx="2"/><path d="M5 8h.01M8 8h.01M11 8h.01M14 8h.01M6 12h8"/>'),
  expand: svg('<path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6"/>'),
  collapse: svg('<path d="M7 13l-4 4M13 7l4-4M3 13h4v4M17 7h-4V3"/>'),
  compact: svg('<path d="M4 6h12M4 10h12M4 14h12"/>'),
  history: svg('<path d="M3.5 10a6.5 6.5 0 1 0 2-4.7"/><path d="M3 3.5v3h3"/><path d="M10 6.5V10l2.5 1.5"/>'),
  trash: svg('<path d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6"/>'),
  shell: svg('<path d="M4.5 6l4 4-4 4M10 14.5h5.5"/>'),
  bell: svg('<path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 1.5h-13z"/><path d="M8.5 17.5h3"/>'),
  type: svg('<path d="M4 16h12"/><path d="M6 12.5l4-9 4 9M7.5 9.5h5"/>'),
  gear: svg('<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.55 1.55M13.75 13.75l1.55 1.55M4.7 15.3l1.55-1.55M13.75 6.25l1.55-1.55"/>'),
  help: svg('<circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4"/><path d="M10 14.4h.01"/>'),
  sound: svg('<path d="M3.5 8v4h3l4 3.5v-11l-4 3.5z"/><path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9"/>'),
  muted: svg('<path d="M3.5 8v4h3l4 3.5v-11l-4 3.5z"/><path d="M13.5 8l4 4M17.5 8l-4 4"/>'),
};

/** State chip shapes (§8.11): text + shape, never colour alone. */
export const STATE_SHAPE: Readonly<Record<Status | 'shell', string>> = { blocked: '▲', working: '●', done: '✓', idle: '◌', unknown: '?', shell: '>_' };

/** Status colour for a state key (shells use the shell colours). */
export function stateColor(state: Status | 'shell', e: { process?: { activity: string } | null } | null = null): string {
  if (state === 'shell') return e?.process && e.process.activity !== 'prompt' ? STATUS.shellBusy : STATUS.shell;
  return STATUS[state] ?? STATUS.unknown;
}

export function workspaceHex(colorIndex: number | null | undefined): string {
  return WORKSPACE[((colorIndex ?? 0) % WORKSPACE.length + WORKSPACE.length) % WORKSPACE.length].hex;
}

/** Accessory order = CHR's `ACCESSORIES` (chars/rig/accessories.ts): type = workspace colorIndex % 8. */
export const ACCESSORY_NAMES = Object.freeze(['beanie', 'headphones', 'cone', 'propeller', 'bucket', 'scarf', 'bow', 'antenna']);

/**
 * The workspace accessory as SVG on the portrait's 32-unit grid (ART §9.1: "the same accessory mini-icon as in 3D"),
 * worn on a head whose top edge is at y = 11. `i` = accessory index (0–7), `c` = workspace colour, `t` = the paper trim
 * every accessory carries.
 */
export function accessorySvg(i: number, c: string, t: string = MISC.trim): string {
  switch (((i % 8) + 8) % 8) {
    case 0: return `<path d="M7.5 12.2Q7.6 3.2 16 3.2T24.5 12.2Z" fill="${c}"/><rect x="6.8" y="10" width="18.4" height="3.6" rx="1.8" fill="${t}"/><circle cx="16" cy="3.2" r="2.6" fill="${t}"/>`; // beanie
    case 1: return `<path d="M6.5 14Q6.5 3.5 16 3.5T25.5 14" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round"/><rect x="2.6" y="11.5" width="5.4" height="8.5" rx="2.6" fill="${c}"/><rect x="24" y="11.5" width="5.4" height="8.5" rx="2.6" fill="${c}"/><rect x="3.8" y="13.4" width="1.6" height="4.6" rx=".8" fill="${t}"/><rect x="26.6" y="13.4" width="1.6" height="4.6" rx=".8" fill="${t}"/>`; // headphones
    case 2: return `<path d="M10.5 12L16 .8 21.5 12Z" fill="${c}"/><path d="M12.4 8.2h7.2M14 5h4" stroke="${t}" stroke-width="1.5" stroke-linecap="round"/><circle cx="16" cy="1.4" r="1.7" fill="${t}"/>`; // party cone
    case 3: return `<path d="M9 12.2Q9 6 16 6T23 12.2Z" fill="${c}"/><rect x="15.2" y="2.8" width="1.6" height="3.6" fill="${t}"/><ellipse cx="11.6" cy="2.6" rx="4.4" ry="1.5" fill="${c}"/><ellipse cx="20.4" cy="2.6" rx="4.4" ry="1.5" fill="${t}"/><circle cx="16" cy="2.6" r="1.4" fill="${CORE.ink2}"/>`; // propeller cap
    case 4: return `<rect x="9.5" y="3.4" width="13" height="8.4" rx="3.4" fill="${c}"/><rect x="9.5" y="8.2" width="13" height="2" fill="${t}"/><ellipse cx="16" cy="11.8" rx="11.8" ry="2.3" fill="${c}"/>`; // bucket hat
    case 5: return `<rect x="4.4" y="24.2" width="23.2" height="4.4" rx="2.2" fill="${c}"/><rect x="19.4" y="25.6" width="4.4" height="6.4" rx="1.6" fill="${c}"/><path d="M19.8 30h3.6M8 26.4h2.5M13 26.4h2.5" stroke="${t}" stroke-width="1.3" stroke-linecap="round"/>`; // scarf
    case 6: return `<path d="M19.5 7.6L13.6 3.4v8.4ZM19.5 7.6l5.9-4.2v8.4Z" fill="${c}"/><circle cx="19.5" cy="7.6" r="2" fill="${t}"/>`; // bow
    default: return `<path d="M16 11V4.4" stroke="${CORE.ink2}" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="3.4" r="3" fill="${c}"/><circle cx="15" cy="2.4" r="1" fill="${t}"/>`; // antenna
  }
}

/** The entity fields a portrait reads (a full Entity, a roster row's entity, or Ada's synthetic `{kind, status}`). */
export interface PortraitSubject {
  kind?: Entity['kind'];
  status?: Status;
  process?: { activity: string } | null;
  workspace?: Pick<EntityWorkspace, 'colorIndex'> | null;
}

/**
 * A tiny procedural portrait (used until/unless CHR's portraitBatch hands the UI live renders, §5.4): Clawd's rounded
 * clay block with stubby arms and the workspace accessory in the workspace colour (same mapping as the 3D rig), or
 * Shelly's CRT shell with the workspace chest plate. The face reflects state: focused eyes while working, wide
 * startled eyes + an "o" mouth when blocked, happy ^^ + blush when done, sleepy lids when idle. Pure SVG string.
 * `o` overrides the body / accessory (Ada: cream body + headset).
 */
export function portraitSvg(e: PortraitSubject | null | undefined, size = 32, o: { body?: string; acc?: number; accColor?: string } = {}): string {
  const kind = e?.kind || 'claude';
  const ws = workspaceHex(e?.workspace?.colorIndex);
  const st = e?.status;
  const open = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">`;
  if (kind === 'shell') {
    const busy = e?.process && e.process.activity !== 'prompt';
    const ph = busy ? STATUS.shellBusy : STATUS.shell;
    return `${open}<rect x="3" y="4.5" width="26" height="21.5" rx="5.5" fill="${PT.shellCase}"/><rect x="3" y="20" width="26" height="6" rx="3" fill="${PT.shellBase}"/><rect x="6" y="7.5" width="20" height="12.5" rx="3" fill="${PT.shellGlass}"/><path d="M9.4 11.4l3 2.4-3 2.4" stroke="${ph}" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="14" y="15.2" width="${busy ? 8 : 5}" height="1.9" rx=".95" fill="${ph}"/><rect x="11" y="22" width="10" height="3" rx="1.5" fill="${ws}"/><rect x="7" y="26" width="4" height="4" rx="1.4" fill="${PT.shellFeet}"/><rect x="21" y="26" width="4" height="4" rx="1.4" fill="${PT.shellFeet}"/></svg>`;
  }
  const body = o.body ?? BODY[KIND_BODY[kind]] ?? CORE.clay;
  const acc = o.acc ?? (((e?.workspace?.colorIndex ?? 0) % 8) + 8) % 8;
  const ac = o.accColor ?? ws;
  const ink = PT.ink;
  let face: string;
  if (st === 'blocked') face = `<ellipse cx="12.4" cy="17" rx="2.3" ry="3.2" fill="${ink}"/><ellipse cx="19.6" cy="17" rx="2.3" ry="3.2" fill="${ink}"/><circle cx="13.2" cy="15.8" r=".95" fill="${PT.eyeGlint}"/><circle cx="20.4" cy="15.8" r=".95" fill="${PT.eyeGlint}"/><ellipse cx="16" cy="22.6" rx="1.5" ry="1.2" fill="${ink}"/>`;
  else if (st === 'done') face = `<path d="M10.4 18.2q2-2.6 4 0M17.6 18.2q2-2.6 4 0" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/><ellipse cx="9.4" cy="21" rx="1.8" ry="1.1" fill="${PT.blush}" opacity=".75"/><ellipse cx="22.6" cy="21" rx="1.8" ry="1.1" fill="${PT.blush}" opacity=".75"/><path d="M14.4 21.4q1.6 1.4 3.2 0" stroke="${ink}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  else if (st === 'idle') face = `<path d="M10.6 17.6h3.6M17.8 17.6h3.6" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`;
  else if (st === 'working') face = `<rect x="11.2" y="16" width="2.8" height="4.6" rx="1.4" fill="${ink}"/><rect x="18" y="16" width="2.8" height="4.6" rx="1.4" fill="${ink}"/>`;
  else face = `<rect x="11" y="14.8" width="3" height="5.4" rx="1.5" fill="${ink}"/><rect x="18" y="14.8" width="3" height="5.4" rx="1.5" fill="${ink}"/>`;
  // arms: raised "hey!" nub when blocked
  const arms = st === 'blocked'
    ? `<rect x="1.2" y="15" width="4.4" height="6" rx="2.2" fill="${body}"/><rect x="26.4" y="8.5" width="4.4" height="7" rx="2.2" fill="${body}" transform="rotate(18 28.6 12)"/>`
    : `<rect x="1.4" y="16.5" width="4.2" height="6" rx="2.1" fill="${body}"/><rect x="26.4" y="16.5" width="4.2" height="6" rx="2.1" fill="${body}"/>`;
  return `${open}${arms}<rect x="4.6" y="10.6" width="22.8" height="19.4" rx="6.4" fill="${body}"/><path d="M8.4 13.2h15.2" stroke="rgba(255,255,255,.24)" stroke-width="1.8" stroke-linecap="round"/><rect x="4.6" y="25.4" width="22.8" height="4.6" rx="2.3" fill="rgba(0,0,0,.12)"/>${face}${accessorySvg(acc, ac)}</svg>`;
}

/** Ada (the receptionist, onboarding host, GP §3.4): the warm-cream Clawd with the teal headset (= AMB's ada.ts rig). */
export const adaSvg = (size = 56, mood: Status = 'working') => portraitSvg({ kind: 'claude', status: mood }, size, { body: PT.adaBody, acc: 1, accColor: ENV.teal });

/**
 * Team crest for workspace / tab group headers (§11 M3): a small shield in the workspace colour carrying the
 * workspace accessory in paper, so a header reads like the bay's banner.
 */
export function crestSvg(colorIndex: number | null | undefined, size = 18): string {
  const c = workspaceHex(colorIndex);
  const acc = (((colorIndex ?? 0) % 8) + 8) % 8;
  // the accessory drawn in trim on the shield, scaled into its upper half
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><path d="M4 4h24v12.5c0 7-5.4 11.2-12 13.5C9.4 27.7 4 23.5 4 16.5Z" fill="${c}" stroke="rgba(255,255,255,.28)" stroke-width="1.4"/><g transform="translate(6.4 5.2) scale(.6)">${accessorySvg(acc, MISC.trim, 'rgba(0,0,0,.28)')}</g><path d="M10 21.5h12" stroke="rgba(255,255,255,.35)" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}
