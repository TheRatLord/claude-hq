// @pure
/**
 * Model prices for the spend estimate (Entity.usage.cost). USD per million tokens, Anthropic first-party API list prices
 * (2026-09). Cache writes are priced at the 5-minute TTL rate (1.25 × input); Claude Code's 1-hour cache writes cost
 * more (2 ×), and long-context premiums are not modelled, so the figure is an estimate, never a bill.
 *
 * Matched by model id (most specific first). Unknown ids (codex / gpt / custom) have no price: cost stays null and
 * only tokens are shown.
 */

export interface Price { input: number; output: number; cacheWrite: number; cacheRead: number }
/** One assistant message's usage block, as transcripts report it. */
export interface TokenUse { input: number; cacheWrite: number; cacheRead: number; output: number }

const p = (input: number, output: number, cacheRead = input * 0.1): Price => Object.freeze({ input, output, cacheWrite: input * 1.25, cacheRead });

/** [pattern, price]; the first match wins. */
export const PRICES: readonly (readonly [RegExp, Price])[] = Object.freeze([
  [/fable|mythos/i, p(10, 50, 0.25)],
  [/opus-5-5/i, p(4, 20, 0.2)],
  [/opus-(?:5|4-[5-9])\b/i, p(5, 25)],
  [/opus-4(?:-[01])?\b|opus-4-\d{8}|3-opus/i, p(15, 75)],
  [/sonnet-5(?:-5)?\b/i, p(2, 10, 0.2)],
  [/sonnet/i, p(3, 15)],
  [/haiku-4-5|haiku-[5-9]/i, p(1, 5)],
  [/3-5-haiku|haiku-3-5/i, p(0.8, 4)],
  [/haiku/i, p(0.25, 1.25)],
] as const);

/** The price row for a model id, null when unknown. */
export function priceOf(model: string | null | undefined): Price | null {
  const m = String(model ?? '');
  if (!m || m === '<synthetic>') return null;
  for (const [re, price] of PRICES) if (re.test(m)) return price;
  return null;
}

/** USD for one message's usage on `model`; null when the model has no known price. */
export function costOf(model: string | null | undefined, u: TokenUse): number | null {
  const pr = priceOf(model);
  if (!pr) return null;
  return (u.input * pr.input + u.cacheWrite * pr.cacheWrite + u.cacheRead * pr.cacheRead + u.output * pr.output) / 1e6;
}

/** Every token of a usage block (what "tokens today" sums). */
export const tokensOf = (u: TokenUse): number => u.input + u.cacheWrite + u.cacheRead + u.output;

/** 'YYYY-MM-DD' of `ms` in the process's local time zone (the day spend belongs to). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ms epoch of the local midnight that starts `ms`'s day. */
export function dayStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
