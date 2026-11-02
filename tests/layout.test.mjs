import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { generateLayouts, measureLayout, objectsFromNames, parseObjectNames } from '../.build/editor/layout.js';
import { createBlankScene, createExample, validateScene, compositionScale, reduceHistory } from '../.build/editor/model.js';
import { exportSvg } from '../.build/editor/svg.js';
import { inspectSvg } from '../scripts/svg.mjs';

globalThis.DOMParser = DOMParser; globalThis.XMLSerializer = XMLSerializer;
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/library/catalog.json', root), 'utf8'));
const assets = [...catalog.objects.flatMap(item => Object.values(item.variants).flatMap(Object.values)), ...catalog.backgrounds.flatMap(item => Object.values(item.variants))];
const texts = new Map(await Promise.all(assets.map(async asset => [asset.url, await readFile(new URL('public' + asset.url, root), 'utf8')])));
const sceneOf = names => ({ ...createBlankScene(), objects: objectsFromNames(catalog, names) });

test('names accept Russian aliases, complete phrases, separators and duplicate objects', () => {
  assert.deepEqual(parseObjectNames(catalog, 'КНИГА + кошелёк; ваза с цветами и смартфон\nкнига'), { objectIds: ['book', 'wallet', 'flower-vase', 'phone', 'book'], unknown: [] });
  assert.deepEqual(parseObjectNames(catalog, 'книга, ракета'), { objectIds: ['book'], unknown: ['ракета'] });
  assert.throws(() => objectsFromNames(catalog, 'книга, ракета'), /ракета/);
  const duplicates = objectsFromNames(catalog, 'книга, книга');
  assert.equal(duplicates.length, 2); assert.notEqual(duplicates[0].instanceId, duplicates[1].instanceId);
  assert.deepEqual(parseObjectNames(catalog, 'книгап'), { objectIds: [], unknown: ['книгап'] });
});

test('three distinct layouts are deterministic, preserve scene settings and do not mutate the input', () => {
  const base = createExample('learning'); const before = structuredClone(base);
  const variants = generateLayouts(catalog, base, { seed: 7 });
  assert.equal(variants.length, 3);
  assert.deepEqual(variants, generateLayouts(catalog, base, { seed: 7 }));
  assert.equal(new Set(variants.map(variant => JSON.stringify(variant.scene.objects))).size, 3);
  assert.notDeepEqual(variants, generateLayouts(catalog, base, { seed: 8 }));
  for (const { scene } of variants) {
    validateScene(scene, catalog);
    assert.equal(scene.name, base.name); assert.equal(scene.paletteId, base.paletteId);
    assert.equal(scene.size, base.size); assert.equal(scene.formatId, base.formatId);
    assert.deepEqual(scene.objects.map(object => object.instanceId).sort(), base.objects.map(object => object.instanceId).sort());
  }
  assert.deepEqual(base, before);
});

test('all sizes, formats and 1–6 heterogeneous or duplicate items fit without excessive occlusion', () => {
  const sequences = [
    ['book', 'phone', 'coin', 'flower-vase', 'headphones', 'pen'],
    ['book', 'book', 'book', 'book', 'book', 'book'],
    ['flower-vase', 'flower-vase', 'lamp', 'folder', 'puzzle', 'wallet'],
  ];
  for (const size of ['S', 'L']) for (const format of catalog.formats) for (const sequence of sequences) for (let count = 1; count <= 6; count++) {
    const base = { ...createBlankScene(), size, formatId: format.id, objects: sequence.slice(0, count).map((objectId, index) => ({ instanceId: 'item-' + index, objectId, role: index > 2 ? 'secondary' : 'main', x: 0, y: 0, rotation: 0 })) };
    for (const variant of generateLayouts(catalog, base, { seed: count * 17 })) {
      validateScene(variant.scene, catalog);
      const metrics = measureLayout(catalog, variant.scene);
      assert.equal(metrics.insideCanvas, true, `${size}/${format.id}/${sequence}/${count}`);
      assert.ok(metrics.maxOverlap <= 0.28);
      assert.equal(variant.scene.objects.length, count);
      assert.ok(compositionScale(catalog, variant.scene) > 0);
      assert.deepEqual(variant.scene.objects.map(object => object.objectId).sort(), base.objects.map(object => object.objectId).sort());
    }
  }
});

test('single objects also yield three variants, including very small and very wide originals', () => {
  for (const object of catalog.objects) {
    const variants = generateLayouts(catalog, sceneOf(object.name));
    assert.equal(new Set(variants.map(variant => JSON.stringify(variant.scene.objects))).size, 3, object.id);
    assert.ok(variants.every(variant => variant.metrics.insideCanvas));
  }
});

test('support is opt-in, always existing, monochrome, behind main objects and within the six-item limit', () => {
  const base = sceneOf('книга, телефон');
  assert.equal(generateLayouts(catalog, base)[0].scene.objects.length, 2);
  const supported = generateLayouts(catalog, base, { includeBackgroundObjects: true });
  for (const variant of supported) {
    assert.equal(variant.scene.objects.length, 3);
    const added = variant.scene.objects.find(object => !base.objects.some(original => original.instanceId === object.instanceId));
    assert.equal(added.role, 'secondary');
    assert.ok(catalog.objects.some(object => object.id === added.objectId));
    assert.equal(variant.scene.objects[0].instanceId, added.instanceId);
    assert.deepEqual(variant.addedObjectIds, [added.objectId]);
  }
  const six = sceneOf('книга, телефон, ручка, лампа, папка, монета');
  assert.equal(generateLayouts(catalog, six, { includeBackgroundObjects: true })[0].scene.objects.length, 6);
});

test('invalid requests reject explicitly without truncating items or silently promoting monochrome objects', () => {
  assert.throws(() => generateLayouts(catalog, createBlankScene()), /хотя бы один предмет/);
  assert.throws(() => generateLayouts(catalog, sceneOf('книга, телефон, ручка, лампа, папка, монета, наушники')), /не более 6/);
  const secondary = sceneOf('телефон'); secondary.objects[0].role = 'secondary';
  assert.throws(() => generateLayouts(catalog, secondary), /главный/);
  assert.throws(() => generateLayouts(catalog, sceneOf('телефон'), { seed: NaN }), /номер/);
});

test('generated scenes remain editable, export original paths and have independent preview definition IDs', () => {
  const variants = generateLayouts(catalog, { ...sceneOf('книга, телефон, ваза'), paletteId: 'peach' });
  const allIds = [];
  for (const [index, variant] of variants.entries()) {
    const svg = exportSvg(catalog, texts, variant.scene, `test-${index}-`);
    inspectSvg(svg);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    for (const node of [doc.documentElement, ...Array.from(doc.getElementsByTagName('*'))]) if (node.hasAttribute('id')) allIds.push(node.getAttribute('id'));
    const groups = Array.from(doc.getElementsByTagName('g')).filter(node => node.hasAttribute('data-object-id'));
    assert.equal(groups.length, variant.scene.objects.length);
    for (const group of groups) {
      const object = variant.scene.objects.find(item => item.objectId === group.getAttribute('data-object-id'));
      const asset = catalog.objects.find(item => item.id === object.objectId).variants[variant.scene.size][object.role];
      const original = new DOMParser().parseFromString(texts.get(asset.url), 'image/svg+xml');
      assert.deepEqual(Array.from(group.getElementsByTagName('path')).map(path => path.getAttribute('d')), Array.from(original.getElementsByTagName('path')).map(path => path.getAttribute('d')));
    }
    const restored = JSON.parse(JSON.stringify(variant.scene)); validateScene(restored, catalog);
  }
  // documentElement is enumerated twice by xmldom's Document collection above only if it has an ID (it doesn't).
  assert.equal(allIds.length, new Set(allIds).size);
});

test('applying an automatic layout can be undone as a single complete scene edit', () => {
  const base = createExample('learning');
  const variant = generateLayouts(catalog, base)[0];
  const edited = reduceHistory({ past: [], present: base, future: [] }, { type: 'commit', value: variant.scene });
  assert.equal(edited.past.length, 1);
  assert.deepEqual(reduceHistory(edited, { type: 'undo' }).present, base);
});
