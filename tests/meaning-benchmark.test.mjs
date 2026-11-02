import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { grade, summarize, choose, tune } from '../benchmarks/meaning/metrics.mjs';

const dataText = await readFile(new URL('../benchmarks/meaning/cases.json', import.meta.url), 'utf8');
const cases = JSON.parse(dataText).cases;
const annotated = { requiredGroups: [['book'], ['wallet', 'coin']], allowed: ['book', 'wallet', 'coin', 'pen'], forbidden: ['phone'], expectAbstain: false };

test('benchmark grading accepts alternative readings and optional supports, while requiring every meaning', () => {
  assert.equal(grade(annotated, ['book', 'coin', 'pen']).success, true);
  assert.equal(grade(annotated, ['book', 'wallet']).success, true);
  const incomplete = grade(annotated, ['book', 'pen']);
  assert.equal(incomplete.success, false);
  assert.equal(incomplete.recall, 0.5);
  const excess = grade(annotated, ['book', 'wallet', 'phone']);
  assert.equal(excess.success, false);
  assert.deepEqual(excess.forbidden, ['phone']);
  assert.deepEqual(excess.extras, ['phone']);
});

test('abstention is correct only when the reference requests clarification', () => {
  const unknown = { requiredGroups: [], allowed: [], forbidden: [], expectAbstain: true };
  assert.equal(grade(unknown, []).success, true);
  assert.equal(grade(unknown, []).f1, 1);
  assert.equal(grade(unknown, ['book']).f1, 0);
  assert.equal(grade(annotated, []).f1, 0);
});

test('selection applies absolute confidence, candidate gap, limit and runtime exclusions', () => {
  const candidates = [{ id: 'book', score: .8 }, { id: 'phone', score: .78 }, { id: 'pen', score: .5 }];
  assert.deepEqual(choose(candidates, { threshold: .6, gap: .1, maxItems: 3 }), ['book', 'phone']);
  assert.deepEqual(choose(candidates, { threshold: .6, gap: .1, maxItems: 1 }, ['book']), ['phone']);
  assert.deepEqual(choose(candidates, { threshold: .9, gap: .1, maxItems: 3 }), []);
  const calibration = [{ case: { ...annotated, requiredGroups: [['book']], allowed: ['book'] }, scored: candidates, rules: { excluded: [] } }];
  const fitted = tune(calibration, false);
  assert.equal(grade(calibration[0].case, choose(candidates, fitted.config)).success, true);
});

test('reference split has 90 distinct phrases and nine balanced categories', () => {
  assert.equal(cases.length, 90);
  assert.equal(new Set(cases.map(item => item.prompt)).size, 90);
  for (const category of new Set(cases.map(item => item.category))) {
    assert.equal(cases.filter(item => item.category === category && item.split === 'calibration').length, 3);
    assert.equal(cases.filter(item => item.category === category && item.split === 'test').length, 7);
  }
});

test('published comparison matches frozen references and independently recomputed scores', async () => {
  const result = JSON.parse(await readFile(new URL('../benchmarks/meaning/results/comparison.json', import.meta.url), 'utf8'));
  assert.equal(result.metadata.datasetSha256, createHash('sha256').update(dataText).digest('hex'));
  assert.equal(result.rows.length, 90);
  for (const method of ['rules', 'model', 'modelWithRuleExclusions']) {
    for (const row of result.rows) assert.deepEqual(row[method].grade, grade(row.case, row[method].selected));
    assert.deepEqual(result.summaries.test[method], summarize(result.rows.filter(row => row.case.split === 'test'), method));
  }
});
