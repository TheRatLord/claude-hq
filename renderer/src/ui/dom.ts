/** Minimal DOM construction used by the terminal widget. */
type StripDot<S extends string> = S extends `${infer T}.${string}` ? T : S;
type StripHash<S extends string> = S extends `${infer T}#${string}` ? T : S;
type ElementOf<S extends string> = StripHash<StripDot<S>> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[StripHash<StripDot<S>>] : HTMLElement;

type KidLeaf = Node | string | number | boolean | null | undefined;
export type Kid = KidLeaf | readonly KidLeaf[];
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
  return el as ElementOf<S>;
}
