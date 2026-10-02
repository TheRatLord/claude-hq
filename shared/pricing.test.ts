import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, dayStart, localDay, priceOf, tokensOf } from './pricing.ts';

test('pricing: model ids map to their price rows', () => {
  assert.equal(priceOf('claude-opus-5-5')?.input, 4);
  assert.equal(priceOf('claude-opus-5-5')?.cacheRead, 0.2);
  assert.equal(priceOf('claude-opus-5')?.output, 25);
  assert.equal(priceOf('claude-opus-4-6')?.input, 5);
  assert.equal(priceOf('claude-opus-4-1-20250805')?.input, 15);
  assert.equal(priceOf('claude-sonnet-5-5')?.input, 2);
  assert.equal(priceOf('claude-sonnet-5')?.output, 10);
  assert.equal(priceOf('claude-sonnet-4-6')?.input, 3);
  assert.equal(priceOf('claude-sonnet-4-5-20250929')?.output, 15);
  assert.equal(priceOf('claude-haiku-4-5')?.input, 1);
  assert.equal(priceOf('claude-3-5-haiku-20241022')?.input, 0.8);
  assert.equal(priceOf('claude-fable-5-1')?.input, 10);
  assert.equal(priceOf('claude-opus-5-5[1m]')?.input, 4);
  assert.equal(priceOf('gpt-5-codex'), null);
  assert.equal(priceOf('<synthetic>'), null);
  assert.equal(priceOf(null), null);
});

test('pricing: cost of a usage block (cache writes at 1.25 × input)', () => {
  const u = { input: 1000, cacheWrite: 10_000, cacheRead: 100_000, output: 2000 };
  // opus 5.5: 1000×4 + 10000×5 + 100000×0.2 + 2000×20 = 4000 + 50000 + 20000 + 40000 = 114000 → $0.114
  assert.ok(Math.abs((costOf('claude-opus-5-5', u) ?? 0) - 0.114) < 1e-9);
  assert.equal(costOf('gpt-5-codex', u), null);
  assert.equal(tokensOf(u), 113_000);
});

test('pricing: local day keys and midnight', () => {
  const t = new Date(2026, 9, 2, 13, 45).getTime();
  assert.equal(localDay(t), '2026-10-02');
  assert.equal(dayStart(t), new Date(2026, 9, 2).getTime());
  assert.equal(localDay(dayStart(t) - 1), '2026-10-01');
});
