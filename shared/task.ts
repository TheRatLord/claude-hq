// @pure
/**
 * taskLabel(entity): the one short "what is it working on" string shown by the roster, status card, desk
 * placard, ticket, pennant and storefront line (DESIGN §3.1, §6.7). 3–6 words, ≤ 28 chars.
 * Source order (LEAD D2): agents: title → baseTitle → first clause of lastPrompt (stopwords trimmed) → null;
 *   shells: argv basename + first arg → baseTitle → null. Prompt-style titles (`user@host: ~/dir`, bare paths) are junk.
 * Owner: LEAD. Pure.
 */

import type { Entity, ProcessInfo } from './protocol.ts';

export const TASK_MAX_CHARS = 28;
export const TASK_MAX_WORDS = 6;

/** Titles that carry no task information (terminal titles set by the tools themselves). */
const GENERIC_TITLES = new Set([
  'claude', 'claude code', 'codex', 'gemini', 'gemini cli', 'agent', 'shell', 'terminal',
  'bash', 'zsh', 'fish', 'sh', 'herdr', 'new session', 'untitled', 'loading',
]);

/** Leading filler removed from prompts (longest first). */
const LEADING_FILLER = [
  'i would like you to', "i'd like you to", 'i want you to', 'i need you to', 'can you please', 'could you please',
  'would you please', 'can you', 'could you', 'would you', 'will you', 'please', "let's", 'lets', 'let us',
  'go ahead and', 'help me', 'now', 'ok', 'okay', 'so', 'hey', 'hi', 'hello', 'also', 'and', 'then', 'just', 'quickly',
  'claude', 'yo', 'alright', 'right',
];

/** Words never left dangling at the end of a label. */
const TRAILING_STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'into', 'onto',
  'is', 'are', 'be', 'that', 'this', 'which', 'so', 'as', 'if', 'then', 'my', 'our', 'your', 'its', 'it', 'we', 'i',
  'all', 'some', 'any', 'can', 'will', 'should', 'please', 'also', 'just',
]);

/** Shell names: an interactive shell at its prompt carries no task. */
const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'nu', 'elvish', 'tcsh', 'ksh', 'login', '-bash', '-zsh']);

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Strip spinner glyphs, emoji, bullets and quotes from the ends. */
function stripDecor(s: string): string {
  return s
    .replace(/^[^\p{L}\p{N}/.~_(\[]+/u, '')
    .replace(/[\s"'`*_:;,\-–—.]+$/u, '')
    .trim();
}

/**
 * Fit to ≤ maxWords words and ≤ maxChars chars at a word boundary; drop dangling stopwords.
 * A single over-long word is cut with an ellipsis.
 */
export function fitLabel(text: string, maxChars = TASK_MAX_CHARS, maxWords = TASK_MAX_WORDS): string {
  let words = collapse(text).split(' ').filter(Boolean).slice(0, maxWords);
  while (words.length > 1 && words.join(' ').length > maxChars) words.pop();
  while (words.length > 1 && TRAILING_STOP.has(words[words.length - 1].toLowerCase().replace(/[^\p{L}']/gu, ''))) words.pop();
  let out = words.join(' ').replace(/[,;:\-–—]+$/u, '');
  if (out.length > maxChars) out = out.slice(0, maxChars - 1) + '…';
  return out;
}

const upperFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function labelFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const t = stripDecor(collapse(String(title)));
  if (!t || GENERIC_TITLES.has(t.toLowerCase())) return null;
  if (/^[\w.-]+@[\w.-]+(?::|\s|$)/.test(t) || /^[~/][^\s]*$/.test(t)) return null; // shell prompt / cwd titles
  // "Claude Code — Fix login" style prefixes
  const m = t.match(/^(?:claude(?: code)?|codex|gemini)\s*[-–—:|]\s*(.+)$/i);
  const body = m ? m[1] : t;
  if (GENERIC_TITLES.has(body.toLowerCase())) return null;
  const out = fitLabel(body);
  return out || null;
}

export function labelFromPrompt(prompt: string | null | undefined): string | null {
  if (!prompt) return null;
  let p = String(prompt).trim();
  if (!p || p.startsWith('/')) return null; // slash commands (/clear, /compact) are not tasks
  p = p.split(/\n/)[0];
  p = p.replace(/```[\s\S]*$/, '').replace(/https?:\/\/([^/\s]+)\S*/g, '$1').replace(/`/g, '');
  // first clause
  p = p.split(/(?<=\S)[.!?;](?:\s|$)|:\s|\s[-–—]\s|,\s*(?:and |then |but |so )|\s+(?:and then|then|so that|because)\s+/i)[0];
  p = stripDecor(collapse(p));
  // trim leading filler repeatedly ("ok so can you please …")
  let changed = true;
  while (changed && p) {
    changed = false;
    const lower = p.toLowerCase();
    for (const f of LEADING_FILLER) {
      if (lower === f || lower.startsWith(f + ' ') || lower.startsWith(f + ',')) {
        p = stripDecor(p.slice(f.length));
        changed = true;
        break;
      }
    }
  }
  if (!p) return null;
  const out = fitLabel(upperFirst(p));
  return out || null;
}

const basename = (s: unknown): string => String(s).replace(/\/+$/, '').split('/').pop() ?? '';

/**
 * Shells: argv basename + first non-flag argument (basenamed if it is a path).
 */
export function labelFromProcess(proc: Partial<ProcessInfo> | null | undefined): string | null {
  if (!proc) return null;
  if (proc.activity === 'prompt') return null;
  const argv = collapse(String(proc.argv ?? proc.name ?? ''));
  if (!argv) return null;
  const parts = argv.split(' ');
  let i = 0;
  // skip env assignments and sudo/env wrappers
  while (i < parts.length - 1 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i]) || parts[i] === 'sudo' || parts[i] === 'env')) i++;
  const cmd = basename(parts[i]);
  if (!cmd || SHELLS.has(cmd)) return null;
  const arg = parts.slice(i + 1).find((a) => !a.startsWith('-'));
  const out = fitLabel(arg ? `${cmd} ${arg.includes('/') ? basename(arg) || arg : arg}` : cmd);
  return out || null;
}

/** null → the placard shows the project instead */
export function taskLabel(entity: Partial<Entity> | null | undefined): string | null {
  if (!entity) return null;
  if (entity.kind === 'shell') {
    return labelFromTitle(entity.title) ?? labelFromProcess(entity.process) ?? labelFromTitle(entity.baseTitle);
  }
  return (
    labelFromTitle(entity.title) ??
    labelFromTitle(entity.baseTitle) ??
    labelFromPrompt(entity.lastPrompt) ??
    (entity.kind ? null : labelFromProcess(entity.process))
  );
}
