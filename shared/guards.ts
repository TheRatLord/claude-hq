// @pure
/**
 * Narrowing helpers for the places where data enters typed code as `unknown`: JSON.parse, WebSocket frames, herdr socket
 * replies, `catch (e)`, DOM event payloads. Use these instead of `as` casts or `any`. Pure (no node built-ins, no DOM).
 */

/** A non-null, non-array object: safe to read fields from as `unknown`. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `catch (e)` → a message string (Error.message, or String(e) for anything thrown that is not an Error). */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `catch (e)` → the `.code` of a node-style error (`ENOENT`, `ECONNREFUSED`, herdr `{code}` errors), else undefined. */
export function errCode(e: unknown): string | undefined {
  return isRecord(e) && typeof e.code === 'string' ? e.code : undefined;
}
