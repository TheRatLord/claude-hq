// @pure
/**
 * Kit lint allow-list (kit.lint.test.ts): files NOT yet migrated to the UI kit, with the banned-pattern rules they
 * still break (rule ids: kit/lint.ts). MIGRATORS: when your surface is clean for a rule, delete that rule (or your
 * whole line). The test fails on a stale entry (a waived rule the file no longer breaks), so this list only shrinks.
 * Never add a line for a new file or for kit/**. Run `node renderer/src/ui/kit/lint.ts <file>` to see what's left.
 * Owner: UI (kit); each line belongs to that surface's migrator.
 */
import type { Rule } from './lint.ts';

export const ALLOW: Readonly<Record<string, readonly Rule[]>> = Object.freeze({
  // empty: every surface is migrated (integration pass). Keep it that way; fix the file, never add a line.
});
