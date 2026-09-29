/**
 * Tiny leveled logger to stderr (DESIGN §2.1). Never log terminal bytes. Owner: BE.
 * Level from HQ_LOG (debug|info|warn|error|silent), default info.
 */
import type { Logger } from './interfaces.ts';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
type LogLevel = keyof typeof LEVELS;
type LogFn = (...args: unknown[]) => void;

/** A Logger that can spawn a scoped child. */
export interface ScopedLogger extends Logger {
  child(scope: string): ScopedLogger;
}

export interface LoggerOpts {
  level?: string;
  sink?: (line: string) => void;
}

export function createLogger(scope = 'hq', { level = process.env.HQ_LOG ?? 'info', sink = (l) => void process.stderr.write(l + '\n') }: LoggerOpts = {}): ScopedLogger {
  const min = (LEVELS as Record<string, number>)[level] ?? LEVELS.info;
  const mk = (lvl: LogLevel): LogFn => (...args) => {
    if (LEVELS[lvl] < min) return;
    const text = args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    sink(`[${scope}] ${lvl}: ${text}`);
  };
  return {
    debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error'),
    child: (s) => createLogger(`${scope}:${s}`, { level, sink }),
  };
}

/** A logger that drops everything (tests). */
export const nullLogger: ScopedLogger = { debug() {}, info() {}, warn() {}, error() {}, child: () => nullLogger };
