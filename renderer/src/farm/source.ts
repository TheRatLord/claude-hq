/**
 * The one adapter between the network store and the pure valley model, plus the AgentPort the presentation uses
 * to act on real sessions. Nothing under farm/scene or farm/hud imports net/ — they get these two objects.
 */
import { R2S } from '../../../shared/protocol.ts';
import { call, send, store } from '../net/store.ts';
import type { ValleySource } from './model/valley.ts';
import type { AgentPort, LinkState } from './model/types.ts';

export const storeSource: ValleySource = {
  entities: () => store.entities.values(),
  workspaces: () => store.workspaces,
  stats: () => store.stats,
  now: () => store.now(),
  link: (): LinkState => store.conn.state !== 'open' ? (store.conn.state === 'connecting' ? 'connecting' : 'offline') : store.herdr.connected ? 'live' : 'herdr-offline',
  demo: () => store.demo,
};

/** openTerminal is filled in by the HUD (it owns the drawer). */
export function createAgentPort(openTerminal: (id: string) => void): AgentPort {
  return {
    openTerminal,
    async answer(id, key) {
      const e = store.entities.get(id);
      if (!e?.prompt) return { ok: false, error: 'no prompt' };
      const r = await call({ t: R2S.AGENT_ANSWER, id, key, promptHash: e.prompt.hash });
      return { ok: r.ok, error: r.error };
    },
    ack(id) {
      const e = store.entities.get(id);
      if (e) send({ t: R2S.DONE_ACK, id, stateSeq: e.stateSeq });
    },
    async prompt(id, text) {
      const r = await call({ t: R2S.AGENT_PROMPT, id, text });
      return { ok: r.ok, error: r.error };
    },
  };
}
