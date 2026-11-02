import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createExample, createBlankScene, validateScene, moveLayer, reduceHistory, compositionScale } from '../.build/editor/model.js';
import { exportSvg, preparedSvg } from '../.build/editor/svg.js';
import { selectObject } from '../.build/library/index.js';
import { inspectSvg } from '../scripts/svg.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/library/catalog.json', root), 'utf8'));
const assets = [...catalog.objects.flatMap(item => Object.values(item.variants).flatMap(Object.values)), ...catalog.backgrounds.flatMap(item => Object.values(item.variants))];
const texts = new Map(await Promise.all(assets.map(async asset => [asset.url, await readFile(new URL('public' + asset.url, root), 'utf8')])));
const parse = text => new DOMParser().parseFromString(text, 'image/svg+xml');
const paths = root => Array.from(root.getElementsByTagName('path')).map(path => path.getAttribute('d'));
const objectGroups = doc => Array.from(doc.getElementsByTagName('g')).filter(group => group.hasAttribute('data-object-id'));

test('all three examples export valid vector scenes with the original geometry intact', () => {
  for (const example of ['learning', 'finance', 'music']) {
    const scene = createExample(example);
    validateScene(scene, catalog);
    const svg = exportSvg(catalog, texts, scene);
    const summary = inspectSvg(svg);
    const format = catalog.formats.find(item => item.id === scene.formatId);
    assert.equal(summary.width, format.width);
    assert.equal(summary.height, format.height);
    assert.ok(!svg.includes('<image'));
    assert.ok(!svg.includes('selection-outline'));
    const doc = parse(svg);
    const groups = objectGroups(doc);
    assert.equal(groups.length, scene.objects.length);
    for (let i = 0; i < groups.length; i++) {
      const instance = scene.objects[i];
      const asset = selectObject(catalog, instance.objectId, scene.size, instance.role);
      assert.deepEqual(paths(groups[i]), paths(parse(texts.get(asset.url))));
      assert.equal(groups[i].getAttribute('data-object-id'), instance.objectId);
    }
  }
});

test('changing size and role substitutes the original file without modifying its paths', () => {
  const scene = { ...createBlankScene(), size: 'S', objects: [{ instanceId: 'phone', objectId: 'phone', role: 'main', x: 0.5, y: 0.5, rotation: 0 }] };
  assert.equal(objectGroups(parse(exportSvg(catalog, texts, scene)))[0].getElementsByTagName('path').length, 96);
  scene.objects[0].role = 'secondary';
  assert.equal(objectGroups(parse(exportSvg(catalog, texts, scene)))[0].getElementsByTagName('path').length, 155);
  scene.size = 'L';
  assert.equal(objectGroups(parse(exportSvg(catalog, texts, scene)))[0].getElementsByTagName('path').length, 155);
});

test('background accents obey roles, transparency removes the background and dimensions follow format', () => {
  const scene = createExample('learning');
  scene.paletteId = 'aqua'; scene.formatId = 'landscape';
  const doc = parse(exportSvg(catalog, texts, scene));
  const background = Array.from(doc.getElementsByTagName('g')).find(g => g.getAttribute('id') === 'background');
  const paints = inspectSvg(new XMLSerializer().serializeToString(background.getElementsByTagName('svg')[0])).colors;
  assert.ok(paints.includes('#BEEBEB'));
  assert.ok(!paints.includes('#FFD4F2'));
  assert.equal(doc.documentElement.getAttribute('width'), '1200');
  assert.equal(doc.documentElement.getAttribute('height'), '630');
  scene.backgroundVisible = false;
  assert.ok(!exportSvg(catalog, texts, scene).includes('id="background"'));
  const scales = objectGroups(doc).map(g => /scale\(([^)]+)\)/.exec(g.getAttribute('transform'))[1]);
  assert.equal(new Set(scales).size, 1);
  assert.equal(Number(scales[0]), compositionScale(catalog, scene));
});

test('duplicated SVG definitions and local references get unique prefixes per instance', () => {
  const asset = selectObject(catalog, 'phone', 'L', 'main');
  const text = '<svg xmlns="http://www.w3.org/2000/svg" width="797" height="462" viewBox="0 0 797 462"><defs><linearGradient id="paint"><stop stop-color="#D7CDF5"/></linearGradient><clipPath id="clip"><rect width="20" height="20"/></clipPath></defs><g clip-path="url(#clip)"><path d="M0 0Z" fill="url(#paint)"/></g></svg>';
  const palette = catalog.palettes.find(p => p.id === 'peach');
  for (const prefix of ['first', 'second']) {
    const result = new XMLSerializer().serializeToString(preparedSvg(catalog, asset, text, palette, 'object', prefix));
    const inspected = inspectSvg(result);
    assert.deepEqual(inspected.definitionIds, [prefix + '-paint', prefix + '-clip']);
    assert.ok(result.includes(`url(#${prefix}-paint)`));
    assert.ok(result.includes(`url(#${prefix}-clip)`));
    assert.ok(result.includes('#FDD7B9'));
  }
});

test('custom palette projects round-trip and recolor both objects and background', () => {
  const scene = createExample('learning');
  const palette = structuredClone(catalog.palettes[0]);
  palette.id = 'custom'; palette.name = 'Новая'; palette.colors['background.base'] = '#123456'; palette.colors['object.primary'] = '#FEDCBA';
  scene.customPalettes = [palette]; scene.paletteId = 'custom';
  const restored = JSON.parse(JSON.stringify(scene)); validateScene(restored, catalog);
  const svg = exportSvg(catalog, texts, restored);
  assert.ok(svg.includes('#123456')); assert.ok(svg.includes('#FEDCBA'));
  assert.ok(!svg.includes('#D7CDF5')); assert.ok(!svg.includes('#F9ECB0'));
});

test('project validation rejects unknown objects, invalid coordinates, duplicate ids and bad palettes', () => {
  const scene = createExample('learning');
  for (const mutate of [
    value => { value.objects[0].objectId = 'missing'; },
    value => { value.objects[0].x = Number.NaN; },
    value => { value.objects[0].x = 11; },
    value => { value.objects.push(structuredClone(value.objects[0])); },
    value => { value.objects[0].instanceId = '"><script>'; },
    value => { value.size = 'XL'; },
    value => { value.compositionScale = 0; },
    value => { value.paletteId = 'missing'; },
    value => { value.customPalettes = [catalog.palettes[0]]; },
  ]) { const bad = structuredClone(scene); mutate(bad); assert.throws(() => validateScene(bad, catalog)); }
});

test('history restores the entire scene, caps undo, and clears redo after a new edit', () => {
  const initial = createExample('learning');
  const changed = { ...initial, paletteId: 'aqua' };
  let history = { past: [], present: initial, future: [] };
  history = reduceHistory(history, { type: 'commit', value: changed });
  history = reduceHistory(history, { type: 'undo' }); assert.deepEqual(history.present, initial);
  history = reduceHistory(history, { type: 'redo' }); assert.deepEqual(history.present, changed);
  history = reduceHistory(history, { type: 'undo' });
  history = reduceHistory(history, { type: 'commit', value: { ...initial, name: 'Другой проект' } }); assert.equal(history.future.length, 0);
  for (let i = 0; i < 80; i++) history = reduceHistory(history, { type: 'commit', value: { ...initial, name: String(i) } });
  assert.equal(history.past.length, 60);
});

test('layer changes affect export order and cannot move beyond the scene stack', () => {
  const scene = createExample('learning');
  const moved = moveLayer(scene, 'example-phone', -1);
  assert.deepEqual(objectGroups(parse(exportSvg(catalog, texts, moved))).map(g => g.getAttribute('data-object-id')), ['phone', 'book']);
  assert.equal(moveLayer(scene, 'example-book', -1), scene);
});
