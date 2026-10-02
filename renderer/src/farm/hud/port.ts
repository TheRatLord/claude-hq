/**
 * What the HUD receives from main. The HUD never imports net/: terminal bytes, term.state and connection changes
 * arrive through this port, which main implements over the store.
 */
import type { Entity, GoneMsg, TermAckMsg, TermStateMsg, ToastLevel } from '../../../../shared/protocol.ts';
import type { TermNet } from '../../ui/terminal/view.ts';
import type { Settings } from '../../core/settings.ts';
import type { Platform } from '../../ui/platform.ts';
import type { PrefsStore } from '../prefs.ts';

export interface HudNet extends TermNet {
  /** connection open and the world received */
  ready(): boolean;
  herdrConnected(): boolean;
  /** the raw entity for a pane (terminal drawer needs layoutRect / prompt hash); null if gone */
  entity(id: string): Entity | null;
  onTermState(fn: (m: TermStateMsg) => void): () => void;
  onTermAck(fn: (m: TermAckMsg) => void): () => void;
  onGone(fn: (m: GoneMsg) => void): () => void;
  onToast(fn: (level: ToastLevel, text: string) => void): () => void;
  /** entity changes (drawer header refresh) */
  onEntity(fn: (e: Entity) => void): () => void;
  onConn(fn: () => void): () => void;
  /** demo only: reset the scenario (dev panel) */
  demoScenario?(name: string, seed?: number): Promise<{ ok: boolean; error?: string }>;
}

export interface HudDeps {
  root: HTMLElement;
  net: HudNet;
  settings: Settings;
  platform: Platform;
  /** the browser-local prefs store (main.ts shares it with the controller and engine); the HUD makes its own if absent */
  prefs?: PrefsStore;
}
