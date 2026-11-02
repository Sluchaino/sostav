import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { selectObjectsByTheme, objectsFromMeaning, validateMeaningResult, THEME_EXAMPLES } from '../.build/editor/meaning.js';
import { createBlankScene, validateScene } from '../.build/editor/model.js';
import { generateLayouts } from '../.build/editor/layout.js';
import { exportSvg } from '../.build/editor/svg.js';
import { inspectSvg } from '../scripts/svg.mjs';

globalThis.DOMParser = DOMParser; globalThis.XMLSerializer = XMLSerializer;
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/library/catalog.json', root), 'utf8'));
const ids = result => result.items.map(item => item.objectId);

test('headlines select existing objects with grounded explanations, not new graphics', () => {
  for (const [prompt, expected] of [
    ['Обучение онлайн', ['book', 'phone']],
    ['Онлайн-обучение', ['book', 'phone']],
    ['Безопасные покупки', ['coin', 'wallet']],
    ['Порядок в делах', ['folder', 'pen']],
    ['Музыкальная пауза', ['headphones']],
    ['Забота о себе', ['flower-vase']],
    ['Фокус на работе', ['headphones']],
  ]) {
    const result = selectObjectsByTheme(catalog, prompt);
    validateMeaningResult(result, catalog);
    for (const id of expected) assert.ok(ids(result).includes(id), prompt + ': ' + ids(result));
    assert.ok(result.items.every(item => item.reason && catalog.objects.some(object => object.id === item.objectId)));
    assert.equal(result.provider, 'local');
    assert.notEqual(result.status, 'unmatched');
  }
});

test('metaphors work without mentioning literal object names', () => {
  for (const [prompt, primary] of [['Финансовая подушка', 'wallet'], ['Собрать решение по частям', 'puzzle'], ['Полёт мысли', 'lamp'], ['Все по полочкам', 'folder']]) {
    const result = selectObjectsByTheme(catalog, prompt);
    assert.ok(ids(result).includes(primary), prompt);
    assert.equal(result.status, 'matched');
    assert.ok(result.concepts.length > 0);
  }
});

test('paid education preserves payment and learning, including a third online meaning', () => {
  for (const prompt of ['Платное обучение', 'Платное образование', 'Стоимость обучения', 'Обучение с оплатой']) {
    const result = selectObjectsByTheme(catalog, prompt);
    assert.ok(ids(result).includes('book'), prompt);
    assert.ok(ids(result).includes('wallet') || ids(result).includes('coin'), prompt);
    assert.equal(result.status, 'matched', prompt);
    assert.ok(result.items.every(item => item.role === 'main'));
  }
  const online = selectObjectsByTheme(catalog, 'Платное онлайн-обучение');
  assert.deepEqual(new Set(ids(online)), new Set(['book', 'wallet', 'phone']));
  for (const prompt of ['Бесплатное обучение', 'Платформа для обучения']) {
    const result = selectObjectsByTheme(catalog, prompt);
    assert.ok(ids(result).includes('book'));
    assert.ok(!ids(result).includes('wallet') && !ids(result).includes('coin'), prompt);
  }
});

test('negated objects and concepts are excluded, without confusing безопасность with без', () => {
  const safe = selectObjectsByTheme(catalog, 'Безопасные покупки без телефона', { includeBackgroundObjects: true });
  assert.ok(!ids(safe).includes('phone')); assert.ok(safe.excludedObjectIds.includes('phone'));
  assert.ok(ids(safe).includes('coin'));
  const book = selectObjectsByTheme(catalog, 'Не используй книгу, обучение онлайн');
  assert.ok(!ids(book).includes('book')); assert.ok(ids(book).includes('phone'));
  const rest = selectObjectsByTheme(catalog, 'Отдых без музыки', { includeBackgroundObjects: true });
  assert.ok(!ids(rest).includes('headphones'));
  const sentence = selectObjectsByTheme(catalog, 'Без книги, онлайн');
  assert.ok(ids(sentence).includes('phone')); assert.ok(!ids(sentence).includes('book'));
  const contrast = selectObjectsByTheme(catalog, 'Без телефона, но с книгой');
  assert.ok(ids(contrast).includes('book')); assert.ok(!ids(contrast).includes('phone'));
  const colon = selectObjectsByTheme(catalog, 'Не используй книгу: обучение онлайн');
  assert.ok(ids(colon).includes('phone')); assert.ok(!ids(colon).includes('book'));
});

test('unknown and only partially represented themes are disclosed rather than silently substituted', () => {
  const unknown = selectObjectsByTheme(catalog, 'Космическая ракета');
  assert.equal(unknown.status, 'unmatched'); assert.deepEqual(unknown.items, []);
  assert.ok(unknown.limitations.some(note => note.includes('ракета')));
  assert.throws(() => objectsFromMeaning(catalog, unknown), /Уточните тему/);
  const partial = selectObjectsByTheme(catalog, 'Ракета в онлайн-обучении');
  assert.equal(partial.status, 'partial'); assert.ok(ids(partial).includes('phone') || ids(partial).includes('book'));
  assert.ok(partial.limitations.length > 0);
});

test('supporting roles are optional and an explicit request without background takes precedence', () => {
  const simple = selectObjectsByTheme(catalog, 'Обучение онлайн');
  assert.ok(simple.items.every(item => item.role === 'main'));
  const supported = selectObjectsByTheme(catalog, 'Обучение онлайн', { includeBackgroundObjects: true });
  assert.ok(supported.items.some(item => item.role === 'secondary'));
  const noBackground = selectObjectsByTheme(catalog, 'Обучение онлайн без фоновых предметов', { includeBackgroundObjects: true });
  assert.ok(noBackground.items.every(item => item.role === 'main'));
  assert.ok(noBackground.limitations.some(note => note.includes('исключены')));
});

test('direct mentions are retained and all selections respect the supplied catalog', () => {
  const direct = selectObjectsByTheme(catalog, 'Книга и телефон');
  assert.deepEqual(new Set(ids(direct)), new Set(['book', 'phone']));
  const limited = { ...catalog, objects: catalog.objects.filter(object => object.id === 'book') };
  const result = selectObjectsByTheme(limited, 'Обучение онлайн');
  assert.deepEqual(ids(result), ['book']);
  const tooMany = selectObjectsByTheme(catalog, 'Книга телефон ручка папка лампа монета наушники');
  assert.equal(tooMany.status, 'unmatched'); assert.equal(tooMany.items.length, 0);
});

test('results are deterministic, validate provenance and reject forged or contradictory selections', () => {
  const result = selectObjectsByTheme(catalog, 'Обучение онлайн');
  assert.deepEqual(selectObjectsByTheme(catalog, 'Обучение онлайн'), result);
  for (const mutate of [
    value => { value.items[0].objectId = 'rocket'; },
    value => { value.items.push(structuredClone(value.items[0])); },
    value => { value.excludedObjectIds = [value.items[0].objectId]; },
    value => { value.provider = 'unverified-ai'; },
    value => { value.items[0].reason = ''; },
    value => { value.items.forEach(item => { item.role = 'secondary'; }); },
    value => { value.status = 'unmatched'; },
  ]) { const invalid = structuredClone(result); mutate(invalid); assert.throws(() => validateMeaningResult(invalid, catalog)); }
  const invalid = structuredClone(result); invalid.items[0].objectId = 'rocket';
  assert.throws(() => validateScene({ ...createBlankScene(), interpretation: invalid }, catalog));
});

test('headlines run end to end through layout, project persistence and vector export in both sizes and all formats', async () => {
  const assets = [...catalog.objects.flatMap(item => Object.values(item.variants).flatMap(Object.values)), ...catalog.backgrounds.flatMap(item => Object.values(item.variants))];
  const texts = new Map(await Promise.all(assets.map(async asset => [asset.url, await readFile(new URL('public' + asset.url, root), 'utf8')])));
  for (const size of ['S', 'L']) for (const format of catalog.formats) for (const prompt of THEME_EXAMPLES) {
    const interpretation = selectObjectsByTheme(catalog, prompt, { includeBackgroundObjects: true });
    const source = { ...createBlankScene(), name: prompt, size, formatId: format.id, objects: objectsFromMeaning(catalog, interpretation), interpretation };
    const variant = generateLayouts(catalog, source)[0];
    validateScene(variant.scene, catalog);
    const restored = JSON.parse(JSON.stringify(variant.scene)); validateScene(restored, catalog);
    assert.deepEqual(restored.interpretation, interpretation);
    const svg = exportSvg(catalog, texts, restored);
    const summary = inspectSvg(svg); assert.equal(summary.width, format.width); assert.equal(summary.height, format.height);
    assert.ok(!svg.includes('<image'));
    assert.equal(new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('title')[0].textContent, prompt);
  }
});

test('invalid headline lengths are rejected and role overrides remain explicit', () => {
  for (const prompt of ['', ' ', 'а', 'а'.repeat(301), null]) assert.throws(() => selectObjectsByTheme(catalog, prompt));
  const result = selectObjectsByTheme(catalog, 'Обучение онлайн');
  const objects = objectsFromMeaning(catalog, result, { 'theme-phone': 'secondary' });
  assert.equal(objects.find(object => object.objectId === 'phone').role, 'secondary');
  assert.ok(objects.some(object => object.role === 'main'));
});
