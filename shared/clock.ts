// @pure
/**
 * One wait-clock formatter for every surface that shows how long an agent has been waiting (alert bubble, Blocked
 * Inbox card + mini card, roster row / inbox card, recap): `m:ss` under an hour, then `h:mm:ss`.
 * `approx` (entity.statusSinceApprox: the status predates this server's first sight of the pane) prefixes an honest
 * `≥ ` everywhere, so no surface claims an exact age it cannot know.
 */

/**
 * `ms` = elapsed; `approx` = statusSinceApprox → `≥ ` prefix.
 * @returns e.g. `0:07`, `59:59`, `1:00:00`, `≥ 4:23:45`
 */
export function waitClock(ms: number, approx = false): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${approx ? '≥ ' : ''}${h ? `${h}:${p2(m)}:${p2(r)}` : `${m}:${p2(r)}`}`;
}
