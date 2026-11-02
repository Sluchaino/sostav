import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { pipeline, env } from '@huggingface/transformers';
import { selectObjectsByTheme } from '../../.build/editor/meaning.js';
import { grade, summarize } from './metrics.mjs';
import { attachFallback, tuneFallback, summarizeFallback } from './fallback-metrics.mjs';

const dir = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, dir), 'utf8');
const hash = content => createHash('sha256').update(content).digest('hex');
const caseText = await read('fallback-cases.json'), protocolText = await read('fallback-protocol.json'), objectText = await read('objects.json');
const cases = JSON.parse(caseText).cases, protocol = JSON.parse(protocolText), objects = JSON.parse(objectText);
const old = JSON.parse(await read('results/comparison.json'));
const rulesText = await readFile(new URL('../../src/editor/meaning.ts', dir), 'utf8');
if (hash(rulesText) !== old.metadata.rulesSha256 || hash(objectText) !== old.metadata.objectsSha256) throw new Error('Rules or object descriptions changed; version this experiment first');
const oldPhrases = new Set(old.rows.map(row => row.case.prompt));
if (cases.length !== 60 || new Set(cases.map(c => c.id)).size !== 60 || new Set(cases.map(c => c.prompt)).size !== 60 || cases.some(c => oldPhrases.has(c.prompt))) throw new Error('Expected 60 new distinct phrases');
if (cases.filter(c => c.split === 'calibration').length !== protocol.calibrationCount || cases.filter(c => c.split === 'test').length !== protocol.testCount) throw new Error('Split differs from frozen protocol');
const catalog = JSON.parse(await readFile(new URL('../../public/library/catalog.json', dir), 'utf8'));
const custom = objects.find(o => o.custom);
const expanded = { ...catalog, objects: [...catalog.objects, { ...catalog.objects[0], ...custom }] };
let rows = cases.map(c => {
  const result = selectObjectsByTheme(c.library === 'with-ladder' ? expanded : catalog, c.prompt, { includeBackgroundObjects: false });
  const selected = result.items.map(item => item.objectId);
  return { case: c, rules: { selected, excluded: result.excludedObjectIds, status: result.status, grade: grade(c, selected) }, scored: [], modelMs: null };
});
const metadata = { createdAt: new Date().toISOString(), model: old.metadata.model, revision: old.metadata.revision, dtype: old.metadata.dtype, runtime: old.metadata.runtime,
  device: 'cpu', pooling: 'mean', normalize: true, datasetSha256: hash(caseText), protocolSha256: hash(protocolText), objectsSha256: hash(objectText), rulesSha256: hash(rulesText),
  interpretation: 'Suggestions require user confirmation; complete-case combined scores assume all offered suggestions are accepted. Not measured product success.',
  annotation: 'New agent-authored references, frozen before inference, not user-reviewed. Prior benchmark test was already inspected.' };
console.log('Frozen dataset:', metadata.datasetSha256);
env.cacheDir = fileURLToPath(new URL('.cache/', dir));
metadata.loadWasCached = await stat(new URL('.cache/' + metadata.model + '/onnx/model_quantized.onnx', dir)).then(() => true, () => false);
const started = performance.now();
const extractor = await pipeline('feature-extraction', metadata.model, { revision: metadata.revision, dtype: metadata.dtype, device: metadata.device });
metadata.modelLoadMs = performance.now() - started;
const documents = objects.map(o => `${o.name}. ${o.tags.join(', ')}. ${o.meanings.join(', ')}.`);
const embeddings = (await extractor(documents, { pooling: 'mean', normalize: true })).tolist();
let inferenceCount = 0;
for (const row of rows) {
  if (row.rules.selected.length) continue;
  const start = performance.now();
  const embedding = (await extractor(row.case.prompt, { pooling: 'mean', normalize: true })).tolist()[0];
  row.modelMs = performance.now() - start;
  row.scored = objects.map((object, i) => ({ id: object.id, score: embedding.reduce((sum, n, j) => sum + n * embeddings[i][j], 0) }))
    .filter(o => row.case.library === 'with-ladder' || o.id !== custom.id).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  inferenceCount++;
}
await extractor.dispose();
metadata.inferenceCount = inferenceCount;
const fit = tuneFallback(rows.filter(row => row.case.split === 'calibration'), protocol.conservativeSearch);
metadata.calibration = fit;
metadata.simpleConfig = { threshold: .20, margin: 0 };
rows = attachFallback(rows, 'simple', metadata.simpleConfig);
rows = attachFallback(rows, 'conservative', fit.config);
const summary = Object.fromEntries(['calibration', 'test'].map(split => {
  const subset = rows.filter(row => row.case.split === split);
  return [split, { rules: summarize(subset, 'rules'), simple: summarizeFallback(subset, 'simple'), conservative: summarizeFallback(subset, 'conservative') }];
}));
// Already viewed old test is explicitly exploratory, never used for fitting.
let replay = attachFallback(old.rows, 'simple', metadata.simpleConfig);
replay = attachFallback(replay, 'conservative', fit.config);
const replayTest = replay.filter(row => row.case.split === 'test');
const exploratoryOldTest = { rules: summarize(replayTest, 'rules'), simple: summarizeFallback(replayTest, 'simple'), conservative: summarizeFallback(replayTest, 'conservative') };
const result = { metadata, protocol, summary, exploratoryOldTest, rows };
await writeFile(new URL('results/fallback.json', dir), JSON.stringify(result, null, 2) + '\n');
const names = Object.fromEntries(objects.map(o => [o.id, o.name]));
const named = selected => selected.map(id => names[id]).join(', ') || '—';
const pct = n => n === null ? '—' : (n * 100).toFixed(1) + '%';
const m = summary.test;
const cell = (row, method) => row[method].eligible ? row[method].suggestion.length ? `${row[method].useful ? '✓' : '✗'} ${named(row[method].suggestion)}` : 'нет подсказки' : 'ответ правил сохранён';
const expected = c => c.expectAbstain ? 'Нужен контекст / отказ' : c.requiredGroups.map(g => g.map(id => names[id]).join(' / ')).join(' + ');
const report = [
'# Модель как подсказка после отказа правил', '',
'## Что проверено', '',
'Новый набор: 60 фраз, 18 calibration / 42 test. Разметка и протокол записаны до запуска. Предыдущие 90 фраз уже просматривались: их повторная оценка приведена только как исследовательская справка. Разметка авторская, ещё не согласована с пользователем; это не внешний независимый тест.', '',
'1. Правила отвечают первыми. Любой непустой результат, включая partial, сохраняется без изменений.',
'2. При пустом результате модель сравнивает фразу с прежними описаниями объектов. Картинки не анализируются, модель не обучается.',
'3. Из рейтинга исключаются только excludedObjectIds исходных правил. Запреты эталона в алгоритм не передаются.',
'4. Предлагается не более одного предмета. Простая версия: сходство ≥ 0.20. Строгая версия дополнительно требует порог сходства и отрыв от второго кандидата; оба порога настраиваются только на 18 calibration-фразах.',
'5. Цель настройки: число полезных основных подсказок минус удвоенное число неполезных. Полезная подсказка должна покрывать хотя бы одну обязательную группу; необязательное дополнение само по себе не считается полезным.', '',
'**Это подсказки для подтверждения пользователем.** Показатель полного успеха ниже — гипотеза «пользователь принял каждую подсказку», а не измерение успешной автоматической сборки или реального поведения людей.', '',
'## Новые 42 проверочные фразы', '',
`Правила сами дали ${m.rules.successes}/${m.rules.count} успешных результатов (${pct(m.rules.successRate)}). Для модели доступны только ${m.conservative.eligible} пустых ответов правил: ${m.conservative.eligiblePositive} с ожидаемым предметом и ${m.conservative.eligibleAbstention} требующих контекста/отказа. Остальные ${m.conservative.unchangedRuleAnswers} ответов алгоритм не трогает.`, '',
'| Показатель | Простая подсказка | Строгая подсказка |', '|---|---:|---:|',
`| Показано подсказок | ${m.simple.offered} | ${m.conservative.offered} |`,
`| Полезных основных подсказок | ${m.simple.useful} | ${m.conservative.useful} |`,
`| Неполезных подсказок | ${m.simple.nonUseful} | ${m.conservative.nonUseful} |`,
`| Доля полезных среди показанных | ${pct(m.simple.offerPrecision)} | ${pct(m.conservative.offerPrecision)} |`,
`| Подсказки там, где нужен контекст/отказ | ${m.simple.falseOffersOnAbstention} | ${m.conservative.falseOffersOnAbstention} |`,
`| Предложен запрещённый предмет | ${m.simple.forbiddenOffers} | ${m.conservative.forbiddenOffers} |`,
`| Пустых положительных запросов без полезной подсказки | ${m.simple.positivesWithoutUsefulOffer} | ${m.conservative.positivesWithoutUsefulOffer} |`,
`| Восстановлено полных ответов при принятии всех подсказок | ${m.simple.recoveredCompleteCases} | ${m.conservative.recoveredCompleteCases} |`,
`| Испорчено корректных отказов при принятии всех подсказок | ${m.simple.regressionsIfAllAccepted} | ${m.conservative.regressionsIfAllAccepted} |`,
`| Гипотетический общий полный успех | ${m.simple.hypotheticalCombined.successes}/42 (${pct(m.simple.hypotheticalCombined.successRate)}) | ${m.conservative.hypotheticalCombined.successes}/42 (${pct(m.conservative.hypotheticalCombined.successRate)}) |`, '',
'## Вывод', '',
`Строгий отбор дал ${m.conservative.useful} полезных подсказок из ${m.conservative.offered} показанных, простой — ${m.simple.useful} из ${m.simple.offered}. Строгий вариант покрыл ${m.conservative.useful} из ${m.conservative.eligiblePositive} положительных запросов, пропущенных правилами. Это компромисс: меньше подсказок, меньше риска предложить нерелевантный предмет.`, '',
'Например, строгий вариант связал «Пролить свет на сложный вопрос» с лампой, «Дать мыслям форму на листе» с ручкой, «От стажёра до руководителя» с лестницей. При этом «Позвонить родителям из другого города» и «Получить диплом новой специальности» остались без подсказки из-за недостаточного сходства.', '',
'Рекомендация: если переносить этот режим в продукт, показывать отдельное необязательное предложение с кнопкой подтверждения. Не добавлять предмет на холст автоматически и не менять найденные правилами композиции. Порог 0.425 и margin 0.05 относятся к этой модели, этому индексу и этому небольшому набору; при изменении описаний или состава библиотеки нужна новая проверка. Отсутствие ошибок среди шести подсказок не доказывает 100% надёжность на новых запросах.', '',
'Следующая проверка перед внедрением — пользовательская оценка разметки и полезности подсказок, особенно на реальной библиотеке с несколькими близкими по смыслу загруженными предметами. В этом эксперименте интерфейс приложения не менялся.', '',
'## Порог и воспроизводимость', '',
`- Строгая версия: ${JSON.stringify(fit.config)}; calibration: ${fit.useful} полезных, ${fit.nonUseful} неполезных, objective ${fit.objective}.`,
`- Модель ${metadata.model}, revision ${metadata.revision}, ONNX q8, CPU. Описания объектов и правила не менялись.`,
`- За прогон inference вызван ${inferenceCount} раз из 60 фраз: только для пустых ответов правил. Время и число вызовов не являются браузерным замером.`,
`- SHA256 новых фраз: ${metadata.datasetSha256}. SHA256 протокола: ${metadata.protocolSha256}.`,
'- Файл протокола: [fallback-protocol.json](fallback-protocol.json); эталон: [fallback-cases.json](fallback-cases.json); полные оценки: [results/fallback.json](results/fallback.json).', '',
'## Каждая фраза нового test-набора', '',
'| ID | Фраза | Ожидание | Правила | Простая подсказка | Строгая подсказка |', '|---|---|---|---|---|---|',
...rows.filter(row => row.case.split === 'test').map(row => `| ${row.case.id} | ${row.case.prompt} | ${expected(row.case)} | ${row.rules.grade.success ? '✓' : '✗'} ${named(row.rules.selected)} | ${cell(row, 'simple')} | ${cell(row, 'conservative')} |`), '',
'## Прежний просмотренный test-набор — только справочно', '',
`На прежних 63 фразах: правила ${exploratoryOldTest.rules.successes}/63, с простой подсказкой (если принимать всё) ${exploratoryOldTest.simple.hypotheticalCombined.successes}/63, со строгой ${exploratoryOldTest.conservative.hypotheticalCombined.successes}/63. Эти цифры не использовались для настройки и не считаются независимым подтверждением.`, '',
'## Ограничения', '',
'- Небольшой набор, агентская разметка, знакомая предметная область и один SVG-пример. Даже новый набор не является внешним слепым исследованием.',
'- Строгий фильтр проверяет сходство и разделимость кандидатов, а не понимание метафоры. Высокий score не гарантирует правильный ответ.',
'- Отрицания ограничены возможностями текущих правил; сложные запреты могут оставаться незамеченными.',
'- Непустые ошибочные и частичные ответы правил не исправляются. Предложение одного предмета не обязано раскрывать многосоставную метафору.',
'- Реальные подтверждения, отказы пользователей, время до результата и качество композиции не измерялись.',
'- Приложение не изменено, эксперимент не включает автоматическое принятие подсказок.', '',
'Повторить: `node benchmarks/meaning/fallback-run.mjs` после установки зависимостей и сборки по [README.md](README.md).', ''
];
await writeFile(new URL('FALLBACK-REPORT.md', dir), report.join('\n'));
console.log(JSON.stringify({ calibration: fit, test: summary.test }, null, 2));
