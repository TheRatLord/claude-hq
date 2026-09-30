import './style.css';
import { SCENARIOS } from '../../shared/protocol.ts';
import type { Entity, ReplyMsg, ToastLevel } from '../../shared/protocol.ts';
import { createSettings } from '../src/core/settings.ts';
import { call, connect, onTermData, reconnect, send, sendBytes, store } from '../src/net/store.ts';
import { interactionTrace } from '../src/net/trace.ts';
import { createPlatform } from '../src/ui/platform.ts';
import { createTermView, type TermView } from '../src/ui/terminal/view.ts';
import { terminalKey, type TerminalKeyAction } from '../src/ui/terminal/keys.ts';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing workbench element: ${id}`);
  return found as T;
}
const connection = element('connection');
const herdr = element('herdr');
const notice = element('notice');
const errors = element('errors');
const agentList = element('agents');
const agentCount = element('agent-count');
const emptyAgents = element('empty-agents');
const inspector = element('entity-inspector');
const terminalHost = element('terminal-host');
const terminalEmpty = element('terminal-empty');
const terminalNotices = element('terminal-notices');
const terminalState = element('terminal-state');
const openButton = element<HTMLButtonElement>('open-terminal');
const closeButton = element<HTMLButtonElement>('close-terminal');
const controlButton = element<HTMLButtonElement>('take-control');
const observeButton = element<HTMLButtonElement>('observe');
const scenarioSelect = element<HTMLSelectElement>('scenario');
const seedInput = element<HTMLInputElement>('seed');
const applyScenario = element<HTMLButtonElement>('apply-scenario');
const recordTrace = element<HTMLInputElement>('record-trace');
const settings = createSettings({ send });
const platform = createPlatform(settings);
const params = new URLSearchParams(location.search);
const hintSeed = Number(params.get('seed') ?? 1);
let demoContext = {
  scenario: SCENARIOS.includes(params.get('scenario') ?? '') ? params.get('scenario')! : 'mixed',
  seed: Number.isInteger(hintSeed) && hintSeed >= 0 && hintSeed <= 0xffffffff ? hintSeed : 1,
  population: 12,
};
let selectedId: string | null = null;
let terminal: TermView | null = null;
let worldReady = false;
let reopenAfterWorld = false;
let pendingRekey: string | null = null;
let terminalBusy = false;
let scenarioBusy = false;
let disposed = false;
let traceRenderTimer = 0;
const subscriptions: (() => unknown)[] = [];
const agentRows = new Map<string, { button: HTMLButtonElement; name: HTMLElement; detail: HTMLElement; status: HTMLElement }>();

function showNotice(level: ToastLevel, text: string): void {
  if (disposed) return;
  if (level === 'info') { notice.textContent = text; return; }
  const row = document.createElement('div');
  row.className = 'error-row';
  const message = document.createElement('span');
  message.textContent = text;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => row.remove());
  row.append(message, dismiss);
  errors.append(row);
  while (errors.childElementCount > 5) errors.firstElementChild?.remove();
}

function ready(): boolean { return worldReady && store.conn.state === 'open'; }
function currentEntity(): Entity | null { return terminal ? store.entities.get(terminal.id) ?? null : null; }

function renderConnection(): void {
  connection.textContent = ready() ? 'connected · ready' : store.conn.state === 'open' ? 'open · awaiting world' : store.conn.state;
  connection.classList.toggle('good', ready());
  herdr.textContent = store.herdr.connected ? 'herdr connected' : 'herdr offline';
  herdr.classList.toggle('good', store.herdr.connected);
  herdr.classList.toggle('warning', !store.herdr.connected);
  const demoReady = ready() && store.demo && !scenarioBusy;
  scenarioSelect.disabled = !demoReady;
  seedInput.disabled = !demoReady;
  applyScenario.disabled = !demoReady;
  element('demo-state').textContent = store.demo
    ? 'Demo-backed data and terminal streams. Applying a scenario resets the demo world.'
    : 'This connection is not a demo. Scenario controls are disabled.';
  renderTerminal();
}

function renderTerminal(): void {
  const entity = currentEntity();
  element('terminal-name').textContent = terminal ? `${entity?.name || terminal.id} · ${terminal.id}` : 'No terminal open';
  terminalState.textContent = `${terminal?.state?.state ?? (terminal ? 'connecting' : 'closed')} · ${terminal?.mode ?? 'observe'}`;
  terminalState.classList.toggle('good', terminal?.state?.state === 'live');
  openButton.disabled = !ready() || !selectedId || !store.entities.has(selectedId) || terminalBusy || terminal?.id === selectedId;
  closeButton.disabled = !terminal;
  controlButton.disabled = !ready() || !terminal || terminalBusy || !store.herdr.connected || !entity || terminal.mode === 'control';
  observeButton.disabled = !ready() || !terminal || terminalBusy || terminal.mode !== 'control';
  terminalEmpty.hidden = !!terminal;
  if (terminal) {
    // The reusable viewer supports type-to-promote. This workbench deliberately requires an explicit control action.
    terminal.term.options.disableStdin = !ready() || terminal.mode !== 'control';
    element('terminal-grid').textContent = `${terminal.term.cols} × ${terminal.term.rows} · ${terminal.fontPx}px`;
    element('terminal-hint').textContent = terminal.flash || (terminal.mode === 'control'
      ? 'Control enabled · input reaches this demo pane'
      : 'Observe only · choose Take control before typing');
  } else {
    element('terminal-grid').textContent = '';
    element('terminal-hint').textContent = 'Observe-first · explicit control · reconnect-safe';
  }
}

function renderSelection(): void {
  for (const [id, row] of agentRows) row.button.setAttribute('aria-pressed', String(id === selectedId));
  const entity = selectedId ? store.entities.get(selectedId) : null;
  // Wire content is text only. This sensitive payload has no path into interactionTrace.
  inspector.textContent = entity ? JSON.stringify(entity, null, 2) : 'Select an agent or pane to inspect its current entity.';
  renderTerminal();
}

function updateAgent(entity: Entity): void {
  let row = agentRows.get(entity.id);
  if (!row) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'agent';
    button.dataset.testid = 'agent';
    const name = document.createElement('span');
    name.className = 'agent-name';
    const detail = document.createElement('span');
    detail.className = 'agent-detail';
    const status = document.createElement('span');
    status.className = 'agent-status';
    button.append(name, detail, status);
    const id = entity.id;
    button.addEventListener('click', () => { selectedId = id; renderSelection(); });
    row = { button, name, detail, status };
    agentRows.set(entity.id, row);
    agentList.append(button);
  }
  row.name.textContent = entity.name || entity.id;
  row.detail.textContent = `${entity.workspace.label} / ${entity.tab.label} · ${entity.kind}`;
  row.status.textContent = entity.status;
  row.button.setAttribute('aria-pressed', String(entity.id === selectedId));
}

function renderAgents(): void {
  if (pendingRekey && terminal && ready() && store.entities.has(pendingRekey)) {
    const nextId = pendingRekey;
    pendingRekey = null;
    reopenAfterWorld = false;
    terminal.rekey(nextId);
  }
  for (const [id, row] of agentRows) {
    if (!store.entities.has(id)) { row.button.remove(); agentRows.delete(id); }
  }
  for (const entity of store.entities.values()) updateAgent(entity);
  if (selectedId && selectedId !== pendingRekey && !store.entities.has(selectedId)) selectedId = null;
  agentCount.textContent = String(store.entities.size);
  emptyAgents.hidden = store.entities.size > 0;
  emptyAgents.textContent = worldReady ? 'No panes in this world. Try another demo scenario.' : 'Waiting for world…';
  renderSelection();
}

function closeTerminal(): void {
  const previous = terminal;
  terminal = null;
  terminalBusy = false;
  reopenAfterWorld = false;
  pendingRekey = null;
  previous?.dispose();
  renderTerminal();
}

async function openViewer(view: TermView): Promise<void> {
  terminalBusy = true;
  renderTerminal();
  try {
    const reply = await view.open();
    if (terminal === view && !reply.ok) showNotice('error', `Opening terminal failed: ${reply.error ?? 'unknown error'}`);
  } catch (error) {
    showNotice('error', `Opening terminal failed: ${String(error)}`);
  } finally {
    if (terminal === view) { terminalBusy = false; renderTerminal(); }
  }
}

async function openTerminal(): Promise<void> {
  if (!ready() || !selectedId || !store.entities.has(selectedId)) return;
  closeTerminal();
  const id = selectedId;
  const view = createTermView({
    id,
    net: {
      send: (message) => store.conn.state === 'open' ? send(message) : false,
      call: (message) => ready() ? call(message) : Promise.resolve({ t: 'reply', rid: null, ok: false, error: 'disconnected' }),
      sendBytes, onTermData,
    },
    settings, platform,
    grid: () => currentEntity()?.layoutRect ?? null,
    hooks: {
      entity: currentEntity,
      leave: () => agentRows.get(selectedId ?? '')?.button.focus(),
      toast: showNotice,
      confirm: async (text) => window.confirm(text),
      changed: renderTerminal,
      evict: () => {
        closeTerminal();
        throw new Error('Terminal viewer limit reached. Close a viewer in another tab, then reopen this terminal.');
      },
      typed: renderTerminal,
      keyAction: fontAction,
    },
  });
  terminal = view;
  view.term.options.screenReaderMode = true;
  view.onClose = closeTerminal;
  terminalNotices.append(view.notices);
  terminalEmpty.hidden = true;
  view.attach(terminalHost);
  renderTerminal();
  await openViewer(view);
}

function fontAction(action: Exclude<TerminalKeyAction, 'copy' | 'pasteNative'>): void {
  const current = settings.get('termFontPx');
  const size = action === 'fontReset' ? 14 : Math.max(8, Math.min(32, current + (action === 'fontUp' ? 1 : -1)));
  settings.set({ termFontPx: size });
}

async function changeMode(control: boolean): Promise<void> {
  const view = terminal;
  if (!view || !ready() || terminalBusy) return;
  terminalBusy = true;
  renderTerminal();
  try {
    if (control) await view.promote();
    else { view.discardOutbox(); await view.demote(); }
    if (terminal === view) view.focus();
  } catch (error) { showNotice('error', `Terminal action failed: ${String(error)}`); }
  finally { if (terminal === view) { terminalBusy = false; renderTerminal(); } }
}

// Stop the reusable viewer's auto-promotion at the DOM boundary, including native paste and IME.
terminalHost.addEventListener('keydown', (event) => {
  if (!terminal || (ready() && terminal.mode === 'control')) return;
  const action = terminalKey(event, platform.mac);
  if (event.key === 'Tab' || event.key === 'Escape' || (action && action !== 'pasteNative')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
terminalHost.addEventListener('mousedown', (event) => {
  if (event.button !== 1 || !terminal || (ready() && terminal.mode === 'control')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
for (const type of ['beforeinput', 'paste', 'compositionstart', 'compositionupdate', 'compositionend']) {
  terminalHost.addEventListener(type, (event) => {
    if (!terminal || (ready() && terminal.mode === 'control')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function setDemoContext(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  const config = value as Record<string, unknown>;
  if (typeof config.scenario !== 'string' || !SCENARIOS.includes(config.scenario)
    || typeof config.seed !== 'number' || !Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff
    || typeof config.population !== 'number' || !Number.isInteger(config.population) || config.population < 0) return;
  demoContext = { scenario: config.scenario, seed: config.seed, population: config.population };
  syncDemoContext();
}

function syncDemoContext(): void {
  scenarioSelect.value = demoContext.scenario;
  seedInput.value = String(demoContext.seed);
  element('reproduce').textContent = `npm run dev -- --demo ${demoContext.population} --seed ${demoContext.seed} --scenario ${demoContext.scenario}`;
  interactionTrace.setContext({ scenario: demoContext.scenario, seed: demoContext.seed });
}

function renderTrace(): void {
  const snapshot = interactionTrace.snapshot();
  recordTrace.checked = interactionTrace.enabled;
  element('trace-count').textContent = `${interactionTrace.enabled ? 'Recording' : 'Recording disabled'} · ${snapshot.entries.length} retained · ${snapshot.dropped} dropped`;
  element('trace-inspector').textContent = JSON.stringify(snapshot, null, 2);
  let outcome;
  for (let i = snapshot.entries.length - 1; i >= 0; i--) {
    if (snapshot.entries[i].type === 'call.end') { outcome = snapshot.entries[i]; break; }
  }
  element('trace-outcome').textContent = outcome ? `Latest correlated outcome: ${JSON.stringify(outcome)}` : 'Request outcomes appear here with their safe correlation metadata.';
}

for (const name of SCENARIOS) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name;
  scenarioSelect.append(option);
}
syncDemoContext();
subscriptions.push(interactionTrace.subscribe(() => {
  if (traceRenderTimer || disposed) return;
  traceRenderTimer = window.setTimeout(() => { traceRenderTimer = 0; renderTrace(); }, 100);
}));
renderTrace();
recordTrace.addEventListener('change', () => {
  interactionTrace.setEnabled(recordTrace.checked);
  if (interactionTrace.enabled) {
    interactionTrace.captureHello({ ...store.hello, demoConfig: demoContext });
    interactionTrace.setContext({ scenario: demoContext.scenario, seed: demoContext.seed });
  }
  renderTrace();
});
element('clear-trace').addEventListener('click', () => {
  interactionTrace.clear();
  if (interactionTrace.enabled) {
    interactionTrace.captureHello({ ...store.hello, demoConfig: demoContext });
    interactionTrace.setContext({ scenario: demoContext.scenario, seed: demoContext.seed });
  }
  renderTrace();
});
element('export-trace').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(interactionTrace.snapshot(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'hq-interaction-trace.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
element<HTMLFormElement>('scenario-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!ready() || !store.demo || scenarioBusy) return;
  const seed = seedInput.valueAsNumber;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !SCENARIOS.includes(scenarioSelect.value)) return;
  scenarioBusy = true;
  renderConnection();
  try {
    const reply: ReplyMsg = await call({ t: 'demo.scenario', name: scenarioSelect.value, seed });
    if (reply.ok) {
      setDemoContext(reply.demoConfig);
      showNotice('info', `Applied ${demoContext.scenario} with seed ${demoContext.seed}.`);
    } else showNotice('error', `Scenario change failed: ${reply.error ?? 'unknown error'}`);
  } catch (error) { showNotice('error', `Scenario change failed: ${String(error)}`); }
  finally { scenarioBusy = false; renderConnection(); }
});
openButton.addEventListener('click', () => { void openTerminal(); });
closeButton.addEventListener('click', closeTerminal);
controlButton.addEventListener('click', () => { void changeMode(true); });
observeButton.addEventListener('click', () => { void changeMode(false); });
element('font-down').addEventListener('click', () => fontAction('fontDown'));
element('font-up').addEventListener('click', () => fontAction('fontUp'));
element('font-reset').addEventListener('click', () => fontAction('fontReset'));
element('reconnect').addEventListener('click', () => {
  worldReady = false;
  reopenAfterWorld = !!terminal;
  terminal?.discardOutbox();
  terminal?.applyState({ state: 'reconnecting', mode: 'observe' });
  showNotice('info', 'Reconnecting. Terminal will reopen in observe mode after the world handshake.');
  renderConnection();
  reconnect();
});
subscriptions.push(settings.onChange((changed) => {
  if ('termFontPx' in changed) {
    terminal?.setFont();
    element('font-reset').textContent = `${settings.get('termFontPx')}px`;
    renderTerminal();
  }
}));
subscriptions.push(store.on('hello', (hello) => {
  settings._applyServer(hello.settings);
  setDemoContext(hello.demoConfig);
  worldReady = false;
  reopenAfterWorld = !!terminal;
  renderConnection();
}));
subscriptions.push(store.on('conn', (info) => {
  if (info.state !== 'open') {
    worldReady = false;
    reopenAfterWorld = !!terminal;
    terminal?.discardOutbox();
    terminal?.applyState({ state: 'reconnecting', mode: 'observe' });
    if (info.state === 'closed') showNotice('warn', 'Connection closed. Waiting for the socket to reconnect.');
  }
  renderConnection();
}));
subscriptions.push(store.on('world', () => {
  worldReady = true;
  renderAgents();
  renderConnection();
  showNotice('info', `World ready · ${store.entities.size} panes · ${store.demo ? 'demo backend' : 'connected backend'}`);
  if (terminal && reopenAfterWorld) {
    reopenAfterWorld = false;
    if (store.entities.has(terminal.id)) void openViewer(terminal);
    else terminal.applyState({ state: 'gone', mode: 'observe', detail: 'closed' });
  }
}));
subscriptions.push(store.on('entity', (entity) => {
  if (pendingRekey) { renderAgents(); return; }
  updateAgent(entity);
  agentCount.textContent = String(store.entities.size);
  emptyAgents.hidden = store.entities.size > 0;
  if (selectedId === entity.id) renderSelection();
  else if (terminal?.id === entity.id) renderTerminal();
}));
subscriptions.push(store.on('gone', (gone) => {
  if (gone.reason === 'rekeyed' && gone.newId) {
    if (selectedId === gone.id) selectedId = gone.newId;
    if (terminal?.id === gone.id) {
      pendingRekey = gone.newId;
      terminal.discardOutbox();
      terminal.applyState({ state: 'reconnecting', mode: 'observe' });
    }
  } else if (terminal?.id === gone.id) {
    closeTerminal();
    showNotice('info', 'The terminal pane was removed. Select a current pane to open another terminal.');
  }
  renderAgents();
}));
subscriptions.push(store.on('herdr', renderConnection));
subscriptions.push(store.on('term.state', (state) => {
  if (terminal?.id === state.id) terminal.applyState(state);
}));
subscriptions.push(store.on('term.ack', (ack) => {
  if (terminal?.id === ack.id) terminal.ack(ack.upTo);
}));
subscriptions.push(store.on('toast', ({ level, text }) => showNotice(level, text)));
const resizeObserver = new ResizeObserver(() => { terminal?.relayout(); renderTerminal(); });
resizeObserver.observe(terminalHost);
window.addEventListener('error', (event) => showNotice('error', `Browser error: ${event.message}`));
window.addEventListener('unhandledrejection', (event) => showNotice('error', `Unexpected failure: ${String(event.reason)}`));
window.addEventListener('pagehide', () => {
  disposed = true;
  clearTimeout(traceRenderTimer);
  resizeObserver.disconnect();
  closeTerminal();
  for (const unsubscribe of subscriptions) unsubscribe();
}, { once: true });
renderAgents();
renderConnection();
connect({ token: params.get('t') });
