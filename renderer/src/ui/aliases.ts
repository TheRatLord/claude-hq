// @pure (storage injected)
/**
 * HQ-local renames (M3.5, Shift+N): an alias per agent, keyed by its stable identity (terminalId → agentSession →
 * place, shared/identity.ts), so it survives rekeys and reloads and never touches herdr. `aliasOf(e)` is consulted by
 * the one naming function every surface uses (world/stats/format.ts boardNames → names.ts labels, FX nameplates, the
 * Big Board, deep links), so a rename shows the same everywhere; namesakes still get their ' · 2'.
 * Owner: UI.
 */
import { identityMatch } from '../../../shared/identity.ts';
import { isRecord } from '../../../shared/guards.ts';
import type { Identity } from '../../../shared/protocol.ts';
import type { StorageIo } from './rekey.ts';

export interface AliasEntry { identity: Identity; alias: string }

export const ALIAS_MAX = 32;
let list: AliasEntry[] = [];
let version = 0;
let io: StorageIo<AliasEntry[]> | null = null;
// Persisted rows are validated field by field; `identity` is only checked for presence (the matcher tolerates junk).
const isSaved = (a: unknown): a is { identity: Identity; alias: string } => isRecord(a) && !!a.identity && typeof a.alias === 'string';

/** Bind persistence (per session) and load it. */
export function bindAliases(store: StorageIo<AliasEntry[]> | null) {
  io = store;
  try { const v: unknown = io?.load?.(); list = Array.isArray(v) ? v.filter(isSaved).map((a) => ({ identity: a.identity, alias: a.alias.slice(0, ALIAS_MAX) })) : []; } catch { list = []; }
  version++;
}
export function aliasOf(e: { identity?: Identity } | null | undefined): string | null {
  if (!e?.identity || !list.length) return null;
  for (const a of list) if (identityMatch(a.identity, e)) return a.alias;
  return null;
}
/** Set (or clear with ''/null) an entity's alias. Returns whether anything changed. */
export function setAlias(e: { identity?: Identity } | null | undefined, alias: string | null | undefined): boolean {
  if (!e?.identity) return false;
  const t = String(alias ?? '').replace(/\s+/g, ' ').trim().slice(0, ALIAS_MAX);
  const i = list.findIndex((a) => identityMatch(a.identity, e));
  if (!t) { if (i < 0) return false; list.splice(i, 1); }
  else if (i >= 0) { if (list[i].alias === t) return false; list[i] = { identity: e.identity, alias: t }; }
  else list.push({ identity: e.identity, alias: t });
  version++;
  try { io?.save?.(list); } catch { /* storage off */ }
  return true;
}
/** Bumps on every change (names caches key on it). */
export const aliasVersion = () => version;
