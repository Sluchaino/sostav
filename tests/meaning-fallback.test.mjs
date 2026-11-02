import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fallback, usefulSuggestion, tuneFallback, attachFallback, summarizeFallback } from '../benchmarks/meaning/fallback-metrics.mjs';
import { grade } from '../benchmarks/meaning/metrics.mjs';

const reference = { split: 'calibration', requiredGroups: [['book']], allowed: ['book', 'pen'], forbidden: ['phone'], expectAbstain: false };
const row = { case: reference, rules: { selected: [], excluded: [] }, scored: [{ id: 'book', score: .7 }, { id: 'pen', score: .68 }] };

test('fallback preserves nonempty rule answers, including partial and potentially incorrect ones', () => {
  const input = { ...row, rules: { selected: ['phone'], excluded: [], status: 'partial' } };
  const result = fallback(input, { threshold: 0, margin: 0 });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.selected, ['phone']);
  assert.deepEqual(result.suggestion, []);
  result.selected.push('book');
  assert.deepEqual(input.rules.selected, ['phone']);
});

test('suggestions require both confidence and separation, and use runtime exclusions only', () => {
  assert.deepEqual(fallback(row, { threshold: .6, margin: .05 }).suggestion, []);
  assert.deepEqual(fallback(row, { threshold: .75, margin: 0 }).suggestion, []);
  assert.deepEqual(fallback(row, { threshold: .6, margin: .01 }).suggestion, ['book']);
  const excluded = { ...row, rules: { selected: [], excluded: ['book'] } };
  assert.deepEqual(fallback(excluded, { threshold: .6, margin: .01 }).suggestion, ['pen']);
  const forbiddenButUndetected = { ...row, scored: [{ id: 'phone', score: .9 }] };
  assert.deepEqual(fallback(forbiddenButUndetected, { threshold: .6, margin: 0 }).suggestion, ['phone'], 'gold forbidden labels must never leak into selection');
  assert.deepEqual(fallback({ ...row, scored: [] }, { threshold: .6, margin: 0 }).suggestion, []);
});

test('usefulness requires a primary meaning, not just an optional support', () => {
  assert.equal(usefulSuggestion(reference, ['book']), true);
  assert.equal(usefulSuggestion(reference, ['pen']), false);
  assert.equal(usefulSuggestion(reference, ['phone']), false);
  assert.equal(usefulSuggestion({ ...reference, expectAbstain: true }, ['book']), false);
});

test('tuning rejects test rows and may choose to offer nothing rather than force bad suggestions', () => {
  const search = { thresholds: [.2, 1.01], margins: [0, .1] };
  assert.throws(() => tuneFallback([{ ...row, case: { ...reference, split: 'test' } }], search));
  const unknown = { ...row, case: { ...reference, requiredGroups: [], allowed: [], expectAbstain: true } };
  const fit = tuneFallback([unknown], search);
  assert.equal(fit.nonUseful, 0);
  assert.equal(fit.useful, 0);
  assert.deepEqual(fallback(unknown, fit.config).suggestion, []);
});

test('fallback report matches frozen new phrases, calibration and independently recomputed results', async () => {
  const base = new URL('../benchmarks/meaning/', import.meta.url);
  const result = JSON.parse(await readFile(new URL('results/fallback.json', base), 'utf8'));
  const previous = JSON.parse(await readFile(new URL('results/comparison.json', base), 'utf8'));
  const casesText = await readFile(new URL('fallback-cases.json', base), 'utf8');
  const protocolText = await readFile(new URL('fallback-protocol.json', base), 'utf8');
  assert.equal(result.metadata.datasetSha256, createHash('sha256').update(casesText).digest('hex'));
  assert.equal(result.metadata.protocolSha256, createHash('sha256').update(protocolText).digest('hex'));
  assert.equal(result.rows.length, 60);
  assert.equal(result.rows.filter(r => r.case.split === 'test').length, 42);
  assert.ok(!result.rows.some(r => previous.rows.some(old => old.case.prompt === r.case.prompt)));
  assert.deepEqual(tuneFallback(result.rows.filter(r => r.case.split === 'calibration'), result.protocol.conservativeSearch), result.metadata.calibration);
  for (const method of ['simple', 'conservative']) {
    const config = method === 'simple' ? result.metadata.simpleConfig : result.metadata.calibration.config;
    const recalculated = attachFallback(result.rows, method, config);
    for (let i = 0; i < recalculated.length; i++) {
      assert.deepEqual(recalculated[i][method], result.rows[i][method]);
      assert.deepEqual(result.rows[i].rules.grade, grade(result.rows[i].case, result.rows[i].rules.selected));
      if (result.rows[i].rules.selected.length) assert.equal(result.rows[i].modelMs, null, 'nonempty rule answers must skip model inference');
    }
    assert.deepEqual(summarizeFallback(recalculated.filter(r => r.case.split === 'test'), method), result.summary.test[method]);
  }
});
