import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectObjectsByTheme, validateMeaningResult, objectsFromMeaning } from '../.build/editor/meaning.js';
import { matchMeaningPhrases } from '../.build/editor/phrases.js';
import { createBlankScene, validateScene } from '../.build/editor/model.js';
import { generateLayouts } from '../.build/editor/layout.js';

const catalog = JSON.parse(await readFile(new URL('../public/library/catalog.json', import.meta.url), 'utf8'));
const ids = phrase => selectObjectsByTheme(catalog, phrase).items.map(item => item.objectId);

test('paraphrases recognize verb forms, bounded modifiers and idioms without dependencies', () => {
  for (const [phrase, expected] of [
    ['Получать знания', ['book']], ['Получение новых полезных знаний', ['book']],
    ['Осваиваем новое', ['book']], ['Повысить квалификацию', ['book']],
    ['Грызть гранит науки', ['book']], ['Учиться на ошибках', ['book']],
    ['Откладывать на будущее', ['wallet']], ['Управление средствами', ['wallet']],
    ['Сводить концы с концами', ['wallet']], ['Держать расходы под контролем', ['wallet']],
    ['Получить награду', ['coin']], ['Получаем отдачу', ['coin']],
    ['Труд окупается', ['coin']], ['На вес золота', ['coin']],
    ['Зафиксировать мысли', ['pen']], ['Изложение своих мыслей', ['pen']],
    ['Сформулировать мысль', ['pen']], ['Составить план', ['pen']],
    ['Привести дела в порядок', ['folder']], ['Раскладываем по местам', ['folder']],
    ['Выразить признательность', ['flower-vase']], ['Поднять настроение', ['flower-vase']],
    ['Оставайтесь на связи', ['phone']], ['Наладить контакт', ['phone']],
    ['Действовать сообща', ['puzzle']], ['Плечом к плечу', ['puzzle']],
    ['Посмотреть иначе', ['lamp']], ['Взглянуть по-новому', ['lamp']],
    ['Докопаться до сути', ['book']], ['Проверить гипотезу', ['book']],
    ['Перелистать прошлое', ['book']], ['Сохранить воспоминания', ['book']],
  ]) {
    const result = selectObjectsByTheme(catalog, phrase);
    validateMeaningResult(result, catalog);
    assert.deepEqual(new Set(result.items.map(item => item.objectId)), new Set(expected), phrase);
    assert.equal(result.status, 'matched', phrase);
  }
});

test('specific combinations suppress misleading generic meanings only within their span', () => {
  for (const [phrase, expected] of [
    ['Собрать мысли', ['pen']], ['Собираем свои мысли', ['pen']],
    ['Работа над собой', ['book']], ['Работаем сообща', ['puzzle']],
    ['Открыть вклад', ['wallet']], ['Открываем вклад', ['wallet']],
    ['Руководство командой', ['puzzle']], ['Окружить вниманием', ['flower-vase']],
    ['Перезагрузить телефон', ['phone']],
    ['Собрать мысли и увеличить доход', ['pen', 'coin']],
    ['Работа над собой и оплата обучения', ['book', 'wallet']],
    ['Найти общий язык', ['phone', 'puzzle']],
  ]) assert.deepEqual(new Set(ids(phrase)), new Set(expected), phrase);
  const result = selectObjectsByTheme(catalog, 'Собираем свои мысли');
  assert.ok(!result.concepts.some(item => item.id === 'solution'));
  assert.deepEqual(result.concepts.find(item => item.id === 'writing').evidence, ['собираем', 'свои', 'мысли']);
});

test('combinations retain exclusions and cannot bridge punctuation, conjunctions or negation scopes', () => {
  assert.deepEqual(ids('Получить знания без телефона'), ['book']);
  assert.deepEqual(ids('Наладить контакт без телефона'), ['headphones', 'puzzle']);
  assert.deepEqual(ids('Открыть вклад без денег'), []);
  assert.deepEqual(ids('Без получения знаний, но получить награду'), ['coin']);
  assert.deepEqual(ids('Получить; награду'), []);
  assert.deepEqual(ids('Получить и передать награду'), []);
  assert.deepEqual(ids('Получить неизвестную награду'), []);
  assert.deepEqual(ids('Получить. Не используй знания'), []);
  assert.deepEqual(ids('Без получить, но без награды'), []);
  assert.deepEqual(ids('Пролить. Свет'), []);
});

test('phrase matching is bounded, deterministic, nonmutating and does not remove literal custom objects', () => {
  const words = ['собираем', 'свои', 'мысли', '|', 'получаем', 'награду'];
  const copy = [...words], found = matchMeaningPhrases(words);
  assert.deepEqual(words, copy);
  assert.deepEqual(found, matchMeaningPhrases(words));
  assert.ok(found.evidence.has('writing')); assert.ok(found.evidence.has('value'));
  assert.equal(found.claimed.has(3), false);
  const custom = { ...catalog.objects[0], id: 'custom-plan', custom: true, name: 'Схема', tags: [], meanings: ['составить план'] };
  const lib = { ...catalog, objects: [...catalog.objects, custom] };
  const result = selectObjectsByTheme(lib, 'Составляем план');
  assert.ok(result.items.some(item => item.objectId === custom.id), 'custom meanings share the same phrase interpretation');
  const limited = selectObjectsByTheme({ ...catalog, objects: [] }, 'Работа над собой');
  assert.equal(limited.status, 'unmatched');
});

test('paraphrased multi-intent selections preserve provenance through layout and JSON', () => {
  const result = selectObjectsByTheme(catalog, 'Получить знания и награду');
  // "Получить знания" claims only its span; the unqualified noun need not imply reward.
  assert.ok(result.items.some(item => item.objectId === 'book'));
  const combined = selectObjectsByTheme(catalog, 'Повысить квалификацию и получить награду');
  assert.deepEqual(new Set(combined.items.map(item => item.objectId)), new Set(['book', 'coin']));
  const base = { ...createBlankScene(), interpretation: combined, objects: objectsFromMeaning(catalog, combined) };
  for (const variant of generateLayouts(catalog, base)) {
    const restored = JSON.parse(JSON.stringify(variant.scene)); validateScene(restored, catalog);
    assert.deepEqual(restored.interpretation, combined);
    assert.ok(variant.metrics.insideCanvas);
  }
});
