// Runtime guard for a parsed text frame from the backend (§3.3): shared by the renderer store and the node-side test
// clients (scripts/hqtest-realuse.ts), so neither needs a double cast to reach `ServerMsg`.
import { S2R } from './protocol.ts';
import type { ServerMsg } from './protocol.ts';
import { isRecord } from './guards.ts';

/** Every `t` the server sends as a text frame (§3.3). */
const SERVER_TYPES: ReadonlySet<string> = new Set(Object.values(S2R));

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const hasId = (v: unknown): boolean => isRecord(v) && isStr(v.id) && v.id !== '';

/**
 * The one place a parsed text frame becomes a `ServerMsg`: the `t` tag selects a variant and the fields the handlers
 * dereference are checked per variant (shallow: container types and ids, not every leaf of an entity/stats payload;
 * same server, same PROTOCOL_VERSION, and `hello.protocol` is verified before anything else is read).
 */
export function isServerMsg(v: unknown): v is ServerMsg {
  if (!isRecord(v) || !isStr(v.t) || !SERVER_TYPES.has(v.t)) return false;
  switch (v.t) {
    case S2R.HELLO: return isNum(v.protocol);
    case S2R.WORLD: return Array.isArray(v.entities) && v.entities.every(hasId) && Array.isArray(v.workspaces);
    case S2R.ENTITY: return hasId(v.entity);
    case S2R.GONE: return isStr(v.id);
    case S2R.WORKSPACES: return Array.isArray(v.workspaces);
    case S2R.EVENT: return isStr(v.id) && isStr(v.kind);
    case S2R.STATS: return isRecord(v.stats);
    case S2R.HERDR: return isBool(v.connected);
    case S2R.SCREEN: return isStr(v.id) && Array.isArray(v.lines) && isNum(v.cols) && isNum(v.rows);
    case S2R.TERM_STATE: return isStr(v.id) && isStr(v.state) && isStr(v.mode);
    case S2R.TERM_ACK: return isStr(v.id) && isNum(v.upTo);
    case S2R.TOAST: return isStr(v.level) && isStr(v.text);
    case S2R.TIMELINE: return Array.isArray(v.items);
    case S2R.REPLY: return v.rid === null || isStr(v.rid) || isNum(v.rid);
    default: return false;
  }
}
