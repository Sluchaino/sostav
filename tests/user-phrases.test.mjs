import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectObjectsByTheme, objectsFromMeaning } from '../.build/editor/meaning.js';
import { createBlankScene, validateScene } from '../.build/editor/model.js';
import { generateLayouts } from '../.build/editor/layout.js';
import { exportSvg } from '../.build/editor/svg.js';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
globalThis.DOMParser = DOMParser; globalThis.XMLSerializer = XMLSerializer;
const catalog = JSON.parse(await readFile(new URL('../public/library/catalog.json', import.meta.url), 'utf8'));
const ids = text => selectObjectsByTheme(catalog, text).items.map(item => item.objectId);

test('user-reported rest, gratitude and fresh-start phrases select meaningful existing objects', () => {
  for (const phrase of ['Отдохнуть от постоянных уведомлений.', 'Отдохнуть от уведомлений', 'Отдохнув от звонков']) {
    assert.ok(ids(phrase).includes('headphones'), phrase);
    assert.ok(!ids(phrase).includes('phone'), phrase);
  }
  for (const phrase of ['Поблагодарить за поддержку.', 'Поблагодарим за помощь', 'Поблагодарила команду']) {
    assert.ok(ids(phrase).includes('flower-vase'), phrase);
  }
  for (const phrase of ['Начать с чистого листа.', 'Начинаем с чистого листа', 'С чистого листа']) {
    assert.deepEqual(ids(phrase), ['pen'], phrase);
  }
  assert.deepEqual(ids('Начать. С чистым листом'), ['pen']); // the final idiom is independently present
  assert.deepEqual(ids('Начать с чистого. Листа'), [], 'do not join an idiom through punctuation');
  assert.ok(!ids('Отдохнуть без наушников').includes('headphones'));
  assert.ok(!ids('Поблагодарить без цветов').includes('flower-vase'));
});

test('new phrases compose and export in explicitly chosen S and L with original detail variants', async () => {
  const result = selectObjectsByTheme(catalog, 'Начать с чистого листа');
  const phone = selectObjectsByTheme(catalog, 'Книга и телефон');
  const assets = catalog.objects.flatMap(item => Object.values(item.variants).flatMap(Object.values));
  const texts = new Map(await Promise.all(assets.map(async asset => [asset.url, await readFile(new URL('../public' + asset.url, import.meta.url), 'utf8')])));
  const counts = {};
  for (const size of ['S', 'L']) {
    const base = { ...createBlankScene(), size, backgroundVisible: false, interpretation: result, objects: objectsFromMeaning(catalog, result) };
    for (const variant of generateLayouts(catalog, base)) {
      assert.equal(variant.scene.size, size); validateScene(JSON.parse(JSON.stringify(variant.scene)), catalog);
    }
    const scene = generateLayouts(catalog, { ...base, interpretation: phone, objects: objectsFromMeaning(catalog, phone) })[0].scene;
    const doc = new DOMParser().parseFromString(exportSvg(catalog, texts, scene), 'image/svg+xml');
    const group = Array.from(doc.getElementsByTagName('g')).find(g => g.getAttribute('data-object-id') === 'phone');
    counts[size] = group.getElementsByTagName('path').length;
  }
  assert.deepEqual(counts, { S: 96, L: 155 });
});
