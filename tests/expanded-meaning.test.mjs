import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectObjectsByTheme, objectsFromMeaning } from '../.build/editor/meaning.js';
import { searchObjects } from '../.build/library/index.js';
import { createBlankScene, validateScene } from '../.build/editor/model.js';
import { generateLayouts } from '../.build/editor/layout.js';

const catalog = JSON.parse(await readFile(new URL('../public/library/catalog.json', import.meta.url), 'utf8'));
const selected = phrase => selectObjectsByTheme(catalog, phrase).items.map(item => item.objectId);

test('built-in metaphors cover experience, research, listening, care and combined meanings', () => {
  for (const [phrase, expected] of [
    ['Накопленный опыт', ['book']],
    ['Практическое руководство', ['book']],
    ['Память поколений', ['book']],
    ['Воспоминания о прошлом', ['book']],
    ['Инструкция по управлению бюджетом', ['book', 'wallet']],
    ['Исследовать новую идею', ['book', 'lamp']],
    ['Собрать накопленный опыт', ['book', 'puzzle']],
    ['Услышать клиента', ['headphones', 'phone']],
    ['Знания приносят доход', ['book', 'coin']],
    ['Забота о себе', ['flower-vase', 'headphones']],
    ['Ценный вклад в общее дело', ['coin', 'puzzle']],
    ['Благодарность за помощь', ['flower-vase']],
    ['Гармония в отношениях', ['flower-vase']],
    ['Пролить свет на сложный вопрос', ['lamp']],
    ['Систематизация архива', ['folder']],
    ['Подписать договор', ['pen']],
  ]) assert.deepEqual(new Set(selected(phrase)), new Set(expected), phrase);
});

test('coin expresses value and reward while wallet expresses a personal budget', () => {
  for (const phrase of ['Доход', 'Цена', 'Вознаграждение', 'Заработок', 'Обмен', 'Ценный вклад']) {
    assert.deepEqual(selected(phrase), ['coin'], phrase);
  }
  for (const phrase of ['Бюджет', 'Накопления', 'Финансовая самостоятельность', 'Финансовой независимости']) {
    assert.deepEqual(selected(phrase), ['wallet'], phrase);
  }
});

test('expanded senses avoid hardware memory and honor negation and phrase boundaries', () => {
  assert.deepEqual(selected('Память телефона'), ['phone']);
  assert.deepEqual(selected('Оперативная память компьютера'), []);
  assert.deepEqual(selected('Памятник'), []);
  assert.deepEqual(selected('Сценарий'), []);
  assert.deepEqual(selected('Вкладка браузера'), []);
  assert.deepEqual(selected('Опыт без дохода'), ['book']);
  assert.deepEqual(selected('Доход без знаний'), ['coin']);
  const noLight = selectObjectsByTheme(catalog, 'Исследовать идею без лампы', { includeBackgroundObjects: true });
  assert.ok(!noLight.items.some(item => item.objectId === 'lamp'));
  assert.ok(noLight.items.some(item => item.objectId === 'book'));
  assert.deepEqual(selected('Пролить. Свет'), [], 'an idiom must not cross sentence boundaries');
});

test('new meanings are searchable and available to restricted catalogs without inventing objects', () => {
  for (const [query, id] of [['исследование', 'book'], ['вознаграждение', 'coin'], ['благодарность', 'flower-vase'], ['авторство', 'pen'], ['умение слушать', 'headphones']]) {
    assert.ok(searchObjects(catalog, query).some(item => item.id === id), query);
  }
  const limited = { ...catalog, objects: catalog.objects.filter(item => item.id === 'book') };
  const result = selectObjectsByTheme(limited, 'Исследовать новую идею');
  assert.deepEqual(result.items.map(item => item.objectId), ['book']);
  assert.equal(result.status, 'partial');
});

test('expanded interpretation assembles portable projects for both sizes and all formats', () => {
  const result = selectObjectsByTheme(catalog, 'Инструкция по управлению бюджетом');
  for (const size of ['S', 'L']) for (const formatId of ['square', 'landscape', 'portrait']) {
    const base = { ...createBlankScene(), size, formatId, interpretation: result, objects: objectsFromMeaning(catalog, result) };
    const variants = generateLayouts(catalog, base);
    assert.equal(variants.length, 3);
    for (const variant of variants) {
      validateScene(JSON.parse(JSON.stringify(variant.scene)), catalog);
      assert.deepEqual(new Set(variant.scene.objects.map(item => item.objectId)), new Set(['book', 'wallet']));
      assert.ok(variant.metrics.insideCanvas);
    }
  }
});
