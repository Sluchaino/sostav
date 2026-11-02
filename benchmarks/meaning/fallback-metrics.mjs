import { grade, summarize } from './metrics.mjs';

export function fallback(row, config) {
  if (row.rules.selected.length) return { source: 'rules', selected: [...row.rules.selected], suggestion: [], eligible: false };
  const candidates = row.scored.filter(item => !row.rules.excluded.includes(item.id));
  const first = candidates[0];
  const margin = first ? first.score - (candidates[1]?.score ?? -1) : null;
  const accepted = first && first.score >= config.threshold && margin >= config.margin;
  const suggestion = accepted ? [first.id] : [];
  return { source: suggestion.length ? 'model-suggestion' : 'abstain', selected: suggestion, suggestion, eligible: true, topScore: first?.score ?? null, margin };
}

export function usefulSuggestion(testCase, selected) {
  return !testCase.expectAbstain && selected.length === 1 && !testCase.forbidden.includes(selected[0]) && testCase.requiredGroups.some(group => group.includes(selected[0]));
}

export function tuneFallback(rows, search) {
  if (!rows.length || rows.some(row => row.case.split !== 'calibration')) throw new Error('Fallback tuning accepts calibration rows only');
  let best;
  for (const threshold of search.thresholds) for (const margin of search.margins) {
    const config = { threshold, margin };
    let useful = 0, nonUseful = 0;
    for (const row of rows) {
      const prediction = fallback(row, config);
      if (prediction.suggestion.length) usefulSuggestion(row.case, prediction.suggestion) ? useful++ : nonUseful++;
    }
    const candidate = { config, useful, nonUseful, objective: useful - 2 * nonUseful };
    if (!best || candidate.objective > best.objective || (candidate.objective === best.objective && (candidate.nonUseful < best.nonUseful || (candidate.nonUseful === best.nonUseful && (candidate.useful > best.useful || (candidate.useful === best.useful && (threshold > best.config.threshold || (threshold === best.config.threshold && margin > best.config.margin)))))))) best = candidate;
  }
  return best;
}

export function attachFallback(rows, method, config) {
  return rows.map(row => { const result = fallback(row, config); return { ...row, [method]: { ...result, useful: result.suggestion.length ? usefulSuggestion(row.case, result.suggestion) : null, grade: grade(row.case, result.selected) } }; });
}

export function summarizeFallback(rows, method) {
  const eligible = rows.filter(row => row[method].eligible);
  const offers = eligible.filter(row => row[method].suggestion.length);
  const useful = offers.filter(row => row[method].useful);
  const unknown = eligible.filter(row => row.case.expectAbstain);
  const needed = eligible.filter(row => !row.case.expectAbstain);
  return { count: rows.length, unchangedRuleAnswers: rows.length - eligible.length, eligible: eligible.length, eligiblePositive: needed.length, eligibleAbstention: unknown.length,
    offered: offers.length, useful: useful.length, nonUseful: offers.length - useful.length, offerPrecision: offers.length ? useful.length / offers.length : null,
    positivesWithoutUsefulOffer: needed.length - useful.length,
    falseOffersOnAbstention: unknown.filter(row => row[method].suggestion.length).length,
    forbiddenOffers: offers.filter(row => row[method].suggestion.some(id => row.case.forbidden.includes(id))).length,
    recoveredCompleteCases: rows.filter(row => !row.rules.grade.success && row[method].grade.success).length,
    regressionsIfAllAccepted: rows.filter(row => row.rules.grade.success && !row[method].grade.success).length,
    hypotheticalCombined: summarize(rows, method) };
}
