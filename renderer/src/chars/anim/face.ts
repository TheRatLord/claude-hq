// @pure
/**
 * Face state (ART §5.3): base expression + transient (reaction) + blink + look. Expression → target values for the
 * continuous face channels (sprung, so surprised eyes pop with overshoot) and discrete eye/mouth shapes (swapped under
 * a blink so the change never pops). Owner: CHR.
 */
export interface Expression { eye: string; mouth: string | null; eyeS: number; eyeSY: number; lid: number; browA: number; browOn: number; blush: number }
export type ExpressionId = 'neutral' | 'focused' | 'happy' | 'worried' | 'surprised' | 'sleepy' | 'dizzy' | 'determined' | 'love' | 'celebrate';

export const EXPRESSIONS: Readonly<Record<ExpressionId, Expression>> = Object.freeze({
  neutral: { eye: 'slot', mouth: null, eyeS: 1, eyeSY: 1, lid: 0, browA: 0, browOn: 0, blush: 0 },
  focused: { eye: 'slot', mouth: null, eyeS: 1, eyeSY: 0.9, lid: 0.22, browA: 0, browOn: 0, blush: 0 },
  happy: { eye: 'arc', mouth: 'smile', eyeS: 1, eyeSY: 1, lid: 0, browA: 0, browOn: 0, blush: 1 },
  worried: { eye: 'slot', mouth: 'wobble', eyeS: 0.94, eyeSY: 1, lid: 0.08, browA: 0.5, browOn: 1, blush: 0 },
  surprised: { eye: 'slot', mouth: 'o', eyeS: 1.3, eyeSY: 1.05, lid: 0, browA: 0.15, browOn: 1, blush: 0 },
  sleepy: { eye: 'closed', mouth: 'snore', eyeS: 1, eyeSY: 1, lid: 0, browA: 0, browOn: 0, blush: 0 },
  dizzy: { eye: 'swirl', mouth: 'wobble', eyeS: 1, eyeSY: 1, lid: 0, browA: 0, browOn: 0, blush: 0 },
  determined: { eye: 'slot', mouth: null, eyeS: 1, eyeSY: 0.92, lid: 0.3, browA: -0.55, browOn: 1, blush: 0 },
  love: { eye: 'heart', mouth: 'grin', eyeS: 1.12, eyeSY: 1, lid: 0, browA: 0, browOn: 0, blush: 1 },
  celebrate: { eye: 'star', mouth: 'grin', eyeS: 1.15, eyeSY: 1, lid: 0, browA: 0.2, browOn: 0, blush: 1 },
});
/** Expression by id; unknown ids (free text from poses / the brain) fall back to neutral. */
export const expressionOf = (id: string): Expression => (EXPRESSIONS as Record<string, Expression | undefined>)[id] ?? EXPRESSIONS.neutral;
export const hasExpression = (id: string): boolean => id in EXPRESSIONS;
/** The 9 ART §5.3 expressions (love/celebrate share a row). */
export const EXPRESSION_IDS = Object.freeze(['neutral', 'focused', 'happy', 'worried', 'surprised', 'sleepy', 'dizzy', 'determined', 'love']);

/** Eye shape a kind uses for the generic 'slot' eye (codex: round paper eyes; gemini/other LLMs: diamonds). */
export function kindEye(kind: string, shape: string): string {
  if (shape !== 'slot') return shape;
  if (kind === 'codex') return 'round';
  if (kind === 'gemini') return 'diamond';
  return 'slot';
}

/** Blink envelope (0 open → 1 closed) at time u since blink start: 120 ms close, 60 ms hold, 100 ms open. */
export function blinkAt(u: number): number {
  if (u < 0) return 0;
  if (u < 0.12) return u / 0.12;
  if (u < 0.18) return 1;
  if (u < 0.28) return 1 - (u - 0.18) / 0.1;
  return 0;
}
export const BLINK_DUR = 0.28;
