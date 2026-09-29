/** Test helper: narrow away null/undefined with a clear failure instead of a later TypeError. */
export function need<T>(v: T | null | undefined, what = 'value'): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}
