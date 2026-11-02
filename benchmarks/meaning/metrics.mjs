export function grade(testCase, prediction) {
  const selected = [...new Set(prediction)];
  const hits = selected.filter(id => testCase.allowed.includes(id)).length;
  const covered = testCase.requiredGroups.filter(group => group.some(id => selected.includes(id))).length;
  const precision = selected.length ? hits / selected.length : testCase.expectAbstain ? 1 : 0;
  const recall = testCase.requiredGroups.length ? covered / testCase.requiredGroups.length : selected.length ? 0 : 1;
  const forbidden = selected.filter(id => testCase.forbidden.includes(id));
  const extras = selected.filter(id => !testCase.allowed.includes(id));
  return { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    success: testCase.expectAbstain ? !selected.length : covered === testCase.requiredGroups.length && !extras.length,
    covered, required: testCase.requiredGroups.length, forbidden, extras };
}
export function summarize(rows, method) {
  const grades = rows.map(row => row[method].grade);
  const positives = rows.filter(row => !row.case.expectAbstain);
  const unknown = rows.filter(row => row.case.expectAbstain);
  const prohibited = rows.filter(row => row.case.forbidden.length);
  const sum = (values) => values.reduce((a,b)=>a+b,0);
  const successes = grades.filter(value=>value.success).length;
  const requiredCount = sum(grades.map(value=>value.required));
  const predictedCount = sum(rows.map(row=>row[method].selected.length));
  const extraCount = sum(grades.map(value=>value.extras.length));
  return { count: rows.length, successes, successRate: successes/rows.length,
    meanF1: sum(grades.map(value=>value.f1))/grades.length,
    groupRecall: requiredCount ? sum(grades.map(value=>value.covered))/requiredCount : null,
    selectionPrecision: predictedCount ? (predictedCount-extraCount)/predictedCount : null,
    extraObjects: extraCount,
    falseAbstentions: positives.filter(row=>!row[method].selected.length).length,
    correctAbstentions: unknown.filter(row=>!row[method].selected.length).length, abstentionCases:unknown.length,
    forbiddenCases:prohibited.length, forbiddenViolations:prohibited.filter(row=>row[method].grade.forbidden.length).length };
}
export function choose(scored, config, excluded = []) {
  const allowed = scored.filter(item => !excluded.includes(item.id));
  const top = allowed[0]?.score ?? -Infinity;
  return allowed.filter(item=>item.score >= config.threshold && item.score >= top-config.gap).slice(0,config.maxItems).map(item=>item.id);
}
export function tune(rows, excludedByCase) {
  let best;
  for (let t=20;t<=70;t+=2) for (let g=0;g<=30;g+=3) for (const maxItems of [1,2,3]) {
    const config={threshold:t/100,gap:g/100,maxItems};
    const grades=rows.map(row=>grade(row.case,choose(row.scored,config,excludedByCase?row.rules.excluded:[])));
    const meanF1=grades.reduce((n,v)=>n+v.f1,0)/grades.length;
    const violations=grades.filter(v=>v.forbidden.length).length;
    const objective=meanF1-0.1*violations/grades.length;
    const successes=grades.filter(v=>v.success).length;
    if (!best || objective>best.objective+1e-10 || (Math.abs(objective-best.objective)<1e-10 && successes>best.successes)) best={config,objective,meanF1,violations,successes};
  }
  return best;
}
