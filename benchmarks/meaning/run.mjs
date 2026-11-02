import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { pipeline, env } from '@huggingface/transformers';
import { selectObjectsByTheme } from '../../.build/editor/meaning.js';
import { grade, summarize, choose, tune } from './metrics.mjs';

const dir = new URL('./',import.meta.url), root = new URL('../../',dir);
const hash = value=>createHash('sha256').update(value).digest('hex');
const read = path=>readFile(new URL(path,dir),'utf8');
const caseText=await read('cases.json'), objectText=await read('objects.json');
const cases=JSON.parse(caseText).cases, objects=JSON.parse(objectText);
const catalog=JSON.parse(await readFile(new URL('public/library/catalog.json',root),'utf8'));
const ids=new Set(objects.map(object=>object.id));
if (cases.length<50 || cases.length>100 || new Set(cases.map(c=>c.id)).size!==cases.length) throw new Error('Invalid benchmark case count or IDs');
for (const c of cases) {
  const allowed=new Set(c.allowed);
  if (![c.allowed,...c.requiredGroups,c.forbidden].flat().every(id=>ids.has(id)) || c.requiredGroups.some(group=>!group.length || group.some(id=>!allowed.has(id))) || c.forbidden.some(id=>allowed.has(id)) || c.expectAbstain!==!c.requiredGroups.length || !['test','calibration'].includes(c.split)) throw new Error('Invalid annotation: '+c.id);
}
const custom=objects.find(object=>object.custom);
const customDefinition={...catalog.objects[0],...custom};
const expanded={...catalog,objects:[...catalog.objects,customDefinition]};
const names=Object.fromEntries(objects.map(object=>[object.id,object.name]));
const metadata={
  createdAt:new Date().toISOString(),model:'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  revision:'2c4055b12046f11709e9df2c122e59ffbdc2f900', dtype:'q8',device:'cpu',pooling:'mean',normalize:true,
  runtime:'@huggingface/transformers@3.8.1',node:process.version,platform:os.platform(),cpu:os.cpus()[0]?.model,
  datasetSha256:hash(caseText),objectsSha256:hash(objectText),rulesSha256:hash(await readFile(new URL('src/editor/meaning.ts',root))),
  settings:'includeBackgroundObjects=false; no geometry or SVG inference; cosine of text embeddings',
  annotation:'Authored by the coding agent before inference, not reviewed by the user. Development comparison, not independent validation.',
};
console.log(`Inputs frozen: ${cases.length} cases, hash ${metadata.datasetSha256}`);
env.cacheDir=fileURLToPath(new URL('.cache/',dir));
metadata.loadWasCached=await stat(new URL('.cache/'+metadata.model+'/onnx/model_quantized.onnx',dir)).then(()=>true,()=>false);
const loadStart=performance.now();
const extractor=await pipeline('feature-extraction',metadata.model,{revision:metadata.revision,dtype:metadata.dtype,device:metadata.device});
metadata.modelLoadMs=performance.now()-loadStart;
const documents=objects.map(object=>`${object.name}. ${object.tags.join(', ')}. ${object.meanings.join(', ')}.`);
const indexStart=performance.now();
const objectEmbeddings=(await extractor(documents,{pooling:'mean',normalize:true})).tolist();
metadata.objectIndexMs=performance.now()-indexStart;
const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const rows=[];
for (let i=0;i<cases.length;i++) {
  const c=cases[i];
  const started=performance.now();
  const result=selectObjectsByTheme(c.library==='with-ladder'?expanded:catalog,c.prompt,{includeBackgroundObjects:false});
  const rulesMs=performance.now()-started;
  const modelStarted=performance.now();
  const embedding=(await extractor(c.prompt,{pooling:'mean',normalize:true})).tolist()[0];
  const modelMs=performance.now()-modelStarted;
  const scored=objects.map((object,index)=>({id:object.id,score:dot(embedding,objectEmbeddings[index])})).filter(item=>c.library==='with-ladder'||item.id!==custom.id).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const selected=result.items.map(item=>item.objectId);
  rows.push({case:c,scored,rules:{selected,excluded:result.excludedObjectIds,status:result.status,grade:grade(c,selected),ms:rulesMs},modelMs});
  if ((i+1)%10===0) console.log(`Embedded ${i+1}/${cases.length}`);
}
await extractor.dispose();
const calibration=rows.filter(row=>row.case.split==='calibration');
const rawTuning=tune(calibration,false), filteredTuning=tune(calibration,true);
metadata.calibration={objective:'mean per-case F1 - 0.1 * forbidden-violation fraction; ties by success count; calibration split only',raw:rawTuning,withRuleExclusions:filteredTuning};
for (const row of rows) {
  const raw=choose(row.scored,rawTuning.config);
  const filtered=choose(row.scored,filteredTuning.config,row.rules.excluded);
  row.model={selected:raw,grade:grade(row.case,raw)};
  row.modelWithRuleExclusions={selected:filtered,grade:grade(row.case,filtered)};
}
const methods=['rules','model','modelWithRuleExclusions'];
const summaries={};
for (const split of ['calibration','test']) {
  const subset=rows.filter(row=>row.case.split===split);
  summaries[split]=Object.fromEntries(methods.map(method=>[method,summarize(subset,method)]));
}
const categoryMetrics=Object.fromEntries([...new Set(cases.map(c=>c.category))].map(category=>[category,Object.fromEntries(methods.map(method=>[method,summarize(rows.filter(row=>row.case.split==='test'&&row.case.category===category),method)]))]));
const latency=values=>{const s=[...values].sort((a,b)=>a-b);return {medianMs:s[Math.floor(s.length/2)],p95Ms:s[Math.min(s.length-1,Math.floor(s.length*.95))]};};
metadata.latency={rules:latency(rows.map(row=>row.rules.ms)),model:latency(rows.map(row=>row.modelMs)),note:'Sequential one-shot CPU measurements, not browser latency. Model load/index excluded; first inference may include warmup.'};
const files=async path=>{let output=[];for(const e of await readdir(path,{withFileTypes:true})){const full=new URL(e.name+(e.isDirectory()?'/':''),path);if(e.isDirectory())output.push(...await files(full));else output.push({path:fileURLToPath(full).split('.cache')[1],bytes:(await stat(full)).size});}return output;};
metadata.cachedFiles=await files(new URL('.cache/',dir));
metadata.cachedBytes=metadata.cachedFiles.reduce((sum,f)=>sum+f.bytes,0);
const result={metadata,summaries,categoryMetrics,rows};
await mkdir(new URL('results/',dir),{recursive:true});
await writeFile(new URL('results/comparison.json',dir),JSON.stringify(result,null,2)+'\n');
const pct=value=>value===null?'—':`${(100*value).toFixed(1)}%`;
const label={rules:'Текущие правила',model:'MiniLM',modelWithRuleExclusions:'MiniLM + исключения правил'};
const heading={literal:'Названия',known_theme:'Известные темы',paraphrase:'Перефразировки',metaphor:'Метафоры',multi_intent:'Несколько смыслов',negation:'Отрицания',ambiguous:'Неоднозначность',unknown:'Незнакомые темы',custom_library:'Свой SVG'};
const renderItems=items=>items.map(id=>names[id]).join(', ')||'отказ от подбора';
const expected=c=>c.expectAbstain?'Уточнить / отказаться':c.requiredGroups.map(group=>group.map(id=>names[id]).join(' / ')).join(' + ');
const lines=[
'# Сравнение смыслового подбора: правила и готовая модель','',
`90 фраз: 27 для калибровки, 63 для итогового сравнения. Дата запуска: ${metadata.createdAt}.`,
'', '**Статус:** рабочий набор с авторской разметкой до запуска. Не является независимой или пользовательской оценкой качества. Метафоры допускают несколько прочтений; ожидаемые группы и разрешённые дополнения открыты для ревью в cases.json.','',
'## Методика','',
'- Приложение не изменено: вызывается исходный selectObjectsByTheme, фоновые дополнения выключены.',
'- Модель сравнивает фразу с одним текстом на предмет: название, теги и описанные смыслы. Это поиск по текстовой близости, без обучения и без анализа картинки.',
'- Базовая библиотека: 10 предметов. В категории своего SVG добавлена лестница с теми же тегами и смыслами, что в демонстрационном проекте.',
'- Описания базовых предметов дополнены общими смыслами из существующей предметной области. Правила сохраняют свои ручные веса и словарь; это сравнение двух доступных способов подбора, а не изолированный эксперимент над одним фактором.',
'- Порог сходства, максимальный отрыв от первого кандидата и лимит 1–3 предмета подбираются только на 27 калибровочных фразах. Критерий: средний F1 минус 0.1 доли нарушений явных запретов. На итоговых 63 фразах настройки не меняются.',
'- Дополнительный вариант модели использует только excludedObjectIds исходных правил; это отдельный гибридный эксперимент, а не результат чистой модели.',
'- Разметка, описания и контрольные суммы зафиксированы до первого inference. Разделение ручное и стратифицированное: первые три случая каждой категории — калибровка. Встречаются близкие темы и формулировки; это ограничивает независимость теста.',
'', 'Успешная фраза: покрыта каждая обязательная группа (допустимо любое из её альтернативных изображений), нет лишних предметов. Для неоднозначных/недоступных тем успех означает пустой подбор. Полнота — доля покрытых обязательных групп; точность — доля выбранных предметов из разрешённых. Косинусное сходство не является вероятностью правильного понимания.',
'', '## Итоговая проверка — 63 фразы','',
'| Способ | Успешные фразы | Полнота групп | Точность предметов | Лишних предметов | Верные отказы | Нарушения запретов |',
'|---|---:|---:|---:|---:|---:|---:|',
...methods.map(method=>{const m=summaries.test[method];return `| ${label[method]} | ${m.successes}/${m.count} (${pct(m.successRate)}) | ${pct(m.groupRecall)} | ${pct(m.selectionPrecision)} | ${m.extraObjects} | ${m.correctAbstentions}/${m.abstentionCases} | ${m.forbiddenViolations}/${m.forbiddenCases} |`;}),
'', '## По категориям: успешные фразы из 7','', '| Категория | Правила | MiniLM | MiniLM + исключения |','|---|---:|---:|---:|',
...Object.entries(categoryMetrics).map(([category,m])=>`| ${heading[category]} | ${m.rules.successes}/7 | ${m.model.successes}/7 | ${m.modelWithRuleExclusions.successes}/7 |`),
'', '## Вывод и следующий шаг','',
`На этом наборе полная замена правил на MiniLM снижает долю успешных фраз с ${pct(summaries.test.rules.successRate)} до ${pct(summaries.test.model.successRate)}. Применение исключений правил улучшает модель до ${pct(summaries.test.modelWithRuleExclusions.successRate)}, но не устраняет лишние предметы и ошибки на неоднозначных запросах.`,
'',
`Модель успешно обрабатывает ${rows.filter(row=>row.case.split==='test'&&!row.rules.grade.success&&row.model.grade.success).length} фраз, где правила не справились. Например: «Освоить новую профессию» → книга, «Зафиксировать мысли на бумаге» → ручка, «Подняться на новую ступень» → лестница. При этом полная метафорическая композиция остаётся трудной для обоих способов.`,
'',
'Рекомендация: сохранить правила основным механизмом. Как следующий отдельный эксперимент проверить модель для предложений при отсутствии связи в словаре, с обязательной обработкой отрицаний и подтверждением пользователем. Этот вариант fallback в текущем отчёте не измерен; его улучшение нельзя считать доказанным. Также стоит проверить короткие отдельные описания/прототипы вместо одной длинной карточки. Не переносить проценты на другие модели, библиотеки и реальные пользовательские запросы.',
'',
'Оценивался состав предметов, а не качество объяснений, фоновые роли, компоновка, SVG-геометрия или визуальное качество результата. Тест не является причиной добавлять платный API или менять приложение. Для решения о внедрении нужны проверка разметки пользователем и новый независимый набор.',
'', '## Настройки и время','',
`- Модель: [${metadata.model}](https://huggingface.co/${metadata.model}), revision ${metadata.revision}, ONNX q8, CPU, mean pooling и L2-нормализация.`,
`- Runtime: ${metadata.runtime}; Node ${metadata.node}; ${metadata.cpu}.`,
`- Параметры MiniLM: ${JSON.stringify(rawTuning.config)}. Гибрид: ${JSON.stringify(filteredTuning.config)}.`,
`- Время загрузки ${metadata.loadWasCached?'из предварительно прогретого локального кеша':'при первом запуске'}: ${(metadata.modelLoadMs/1000).toFixed(2)} с; индексирование 11 карточек: ${(metadata.objectIndexMs/1000).toFixed(2)} с.`,
`- Медиана запроса: правила ${metadata.latency.rules.medianMs.toFixed(2)} мс, модель ${metadata.latency.model.medianMs.toFixed(2)} мс; p95 модели ${metadata.latency.model.p95Ms.toFixed(2)} мс. Это локальный Node CPU, не браузер.`,
`- Файлы модели в кеше: ${(metadata.cachedBytes/1024/1024).toFixed(1)} МиБ. Первый запуск требует скачивания; веса не включены в Git.`,
`- SHA256 набора: ${metadata.datasetSha256}; карточек: ${metadata.objectsSha256}; исходных правил: ${metadata.rulesSha256}.`,
'', '## Все фразы итоговой проверки','', '| ID | Фраза | Обязательная основа | Правила | MiniLM | MiniLM + исключения |','|---|---|---|---|---|---|',
...rows.filter(row=>row.case.split==='test').map(row=>`| ${row.case.id} | ${row.case.prompt} | ${expected(row.case)} | ${row.rules.grade.success?'✓':'✗'} ${renderItems(row.rules.selected)} | ${row.model.grade.success?'✓':'✗'} ${renderItems(row.model.selected)} | ${row.modelWithRuleExclusions.grade.success?'✓':'✗'} ${renderItems(row.modelWithRuleExclusions.selected)} |`),
'', 'Полные результаты всех 90 фраз, калибровка, рейтинги кандидатов, оценки и времена: [comparison.json](results/comparison.json). Инструкция запуска: [README.md](README.md).','',
'Источники модели и метода: [исходная модель](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), [ONNX-версия](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2), [semantic textual similarity](https://sbert.net/docs/sentence_transformer/usage/semantic_textual_similarity.html).','',
];
await writeFile(new URL('REPORT.md',dir),lines.join('\n'));
console.log(JSON.stringify(summaries.test,null,2));
console.log('Written REPORT.md and results/comparison.json');
