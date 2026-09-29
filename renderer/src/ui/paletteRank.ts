// @pure
/**
 * Command palette ranking (reviewer m2-r2 [ui]): agents and actions are scored together in tiers, so an action whose
 * label starts with the query ('set' → Settings) always beats an agent that only matches somewhere in its task text
 * (flint's 'Coalesce store updates' is a subsequence hit for 'set'). Lower tier = better:
 *   0 exact label · 1 label prefix · 2 every query word prefixes a label word · 3 label substring ·
 *   4 every word a substring of a secondary field · 5 every word a subsequence of the label ·
 *   6 every word a subsequence of a short secondary field · null = no match.
 * Ties: agents by the needs-you / recent comparator, actions in their menu order; an agent before an action.
 * Owner: UI.
 */
import type { Entity } from '../../../shared/protocol.ts';
import { fuzzy, haystack, comparator } from './roster/model.ts';

const wordsOf = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** `q` = lower-cased trimmed query, `labels` = lower-cased primary labels, `secondary` = lower-cased secondary fields. */
export function matchTier(q: string, labels: string[], secondary: string[]): number | null {
  if (!q) return 6;
  const words = q.split(/\s+/).filter(Boolean);
  let best: number | null = null;
  const take = (t: number) => { if (best === null || t < best) best = t; };
  for (const l of labels) {
    if (!l) continue;
    if (l === q) take(0);
    else if (l.startsWith(q)) take(1);
    else {
      const lw = wordsOf(l);
      if (words.every((w) => lw.some((x) => x.startsWith(w)))) take(2);
      else if (l.includes(q) || words.every((w) => l.includes(w))) take(3);
      else if (words.every((w) => fuzzy(w, l))) take(5);
    }
  }
  if (best !== null && best <= 3) return best;
  if (words.every((w) => secondary.some((x) => x.includes(w)))) take(4);
  else if (best === null && words.every((w) => secondary.some((x) => x.length < 60 && fuzzy(w, x)))) take(6);
  return best;
}

/** What ranking needs from an action row. */
export interface RankableAction { label: string; hint?: string; id?: string }
export type PaletteHit<A> = { kind: 'agent'; e: Entity; tier: number } | { kind: 'action'; a: A; tier: number };

export function rankPalette<A extends RankableAction>(rawQ: string | null | undefined, entities: Iterable<Entity>, actions: readonly A[], o: { label?: (e: Entity) => string; maxAgents?: number; maxActions?: number } = {}): PaletteHit<A>[] {
  // '·' spacing doesn't matter: 'claude·2' finds the twin labelled 'claude · 2' (names.ts, m2-r3)
  const q = String(rawQ ?? '').trim().toLowerCase().replace(/\s*·\s*/g, ' · ').replace(/\s+/g, ' ');
  const recent = comparator('recent');
  const ents: Extract<PaletteHit<A>, { kind: 'agent' }>[] = [];
  for (const e of entities) {
    const labels = [String(e.name ?? '').toLowerCase()];
    const bl = o.label?.(e);
    if (bl) labels.push(String(bl).toLowerCase());
    const tier = q ? matchTier(q, labels, haystack(e)) : 6;
    if (tier !== null) ents.push({ kind: 'agent', e, tier });
  }
  ents.sort((a, b) => a.tier - b.tier || recent(a.e, b.e));
  const acts: (Extract<PaletteHit<A>, { kind: 'action' }> & { i: number })[] = [];
  actions.forEach((a, i) => {
    const tier = q ? matchTier(q, [String(a.label).toLowerCase()], [a.hint, a.id].filter(Boolean).map((s) => String(s).toLowerCase())) : 6;
    if (tier !== null) acts.push({ kind: 'action', a, tier, i });
  });
  acts.sort((a, b) => a.tier - b.tier || a.i - b.i);
  const A = ents.slice(0, o.maxAgents ?? 8);
  const B = acts.slice(0, o.maxActions ?? (q ? 8 : 6)).map(({ kind, a, tier }) => ({ kind, a, tier }));
  if (!q) return [...A, ...B];
  // stable merge by tier (agent first on a tie)
  const out: PaletteHit<A>[] = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (j >= B.length || (i < A.length && A[i].tier <= B[j].tier)) out.push(A[i++]);
    else out.push(B[j++]);
  }
  return out;
}

const MODK = '(?:Shift|Alt|Ctrl|Mod)';
const KEY1 = '(?:Tab|Enter|Esc|Space|F\\d{1,2}|[A-Z0-9?+\\-−=`\\[\\]])';
const CHORD = `(?:Leader(?: (?:${MODK}\\+)*${KEY1})?|(?:${MODK}\\+)*${KEY1})`;
const KEY_HINT = new RegExp(`^(${CHORD}(?: / ${CHORD})*)(?:$| · | (?=in ))`);

/**
 * Split an action hint into its key (drawn as keycaps) and the plain aside: 'Shift+B · 3 blocked' →
 * {keys:['Shift+B'], rest:'3 blocked'}; 'Leader U' → {keys:['Leader','U']}; 'H / F1' → {keys:['H','/','F1']};
 * 'Alt+C in roster' → {keys:['Alt+C'], rest:'in roster'}; a hint that doesn't start with a key → {keys:null, rest}.
 */
export function splitKeyHint(hint: string | undefined): { keys: string[] | null; rest: string } {
  const s = String(hint ?? '');
  const m = KEY_HINT.exec(s);
  if (!m) return { keys: null, rest: s };
  const keys: string[] = [];
  m[1].split(' / ').forEach((c, i) => { if (i) keys.push('/'); keys.push(...c.split(' ')); });
  return { keys, rest: s.slice(m[0].length).trim() };
}
