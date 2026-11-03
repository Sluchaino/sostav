import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { canvasSize, createExample, readScene, validateScene, reduceHistory, MAX_CANVAS_DIMENSION } from '../.build/editor/model.js';
import { exportSvg } from '../.build/editor/svg.js';
import { generateLayouts } from '../.build/editor/layout.js';
import { inspectComposition } from '../.build/editor/preflight.js';
import { customLibrary, customTexts } from '../.build/library/custom.js';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/library/catalog.json', root), 'utf8'));
const assets = [...catalog.objects.flatMap(item => Object.values(item.variants).flatMap(Object.values)), ...catalog.backgrounds.flatMap(item => Object.values(item.variants))];
const texts = new Map(await Promise.all(assets.map(async asset => [asset.url, await readFile(new URL('public' + asset.url, root), 'utf8')])));
const parse = svg => new DOMParser().parseFromString(svg, 'image/svg+xml');
const paths = doc => Array.from(doc.getElementsByTagName('path')).map(path => path.getAttribute('d'));
const custom = (width, height) => ({ ...createExample('learning'), formatId: 'custom', customCanvas: { width, height } });

test('custom dimensions accept bounded integers and reject malformed project imports', () => {
  for (const [width, height] of [[1, 1], [1920, 1080], [MAX_CANVAS_DIMENSION, MAX_CANVAS_DIMENSION]]) {
    const scene = custom(width, height);
    validateScene(scene, catalog);
    assert.deepEqual(canvasSize(catalog, scene), { width, height });
  }
  for (const dimensions of [undefined, null, [], {}, { width: 800 }, { width: '800', height: 600 }, { width: 0, height: 600 }, { width: -1, height: 600 }, { width: 10.5, height: 600 }, { width: NaN, height: 600 }, { width: Infinity, height: 600 }, { width: 800, height: MAX_CANVAS_DIMENSION + 1 }]) {
    assert.throws(() => validateScene({ ...custom(800, 600), customCanvas: dimensions }, catalog), /ширину|целыми/);
  }
  assert.throws(() => validateScene({ ...custom(800, 600), formatId: 'unknown' }, catalog), /формат/);
  assert.deepEqual(canvasSize(catalog, createExample('learning')), { width: 1000, height: 1000 });
});

test('custom canvas survives project round-trip and undo/redo without changing object positions or detail', () => {
  const before = createExample('learning');
  const after = { ...before, formatId: 'custom', customCanvas: { width: 1440, height: 900 } };
  const loaded = readScene(JSON.parse(JSON.stringify(after)), catalog);
  assert.deepEqual(loaded, after);
  assert.deepEqual(loaded.objects, before.objects);
  assert.equal(loaded.size, before.size);
  let history = reduceHistory({ past: [], present: before, future: [] }, { type: 'commit', value: loaded });
  history = reduceHistory(history, { type: 'undo' });
  assert.deepEqual(canvasSize(catalog, history.present), { width: 1000, height: 1000 });
  history = reduceHistory(history, { type: 'redo' });
  assert.deepEqual(canvasSize(catalog, history.present), { width: 1440, height: 900 });
});

test('export uses custom dimensions and preserves paths, proportional transforms and background coverage', () => {
  for (const size of ['S', 'L']) {
    const scene = { ...custom(1920, 1080), size };
    const original = parse(exportSvg(catalog, texts, { ...scene, formatId: 'square' }));
    const doc = parse(exportSvg(catalog, texts, scene));
    assert.equal(doc.documentElement.getAttribute('width'), '1920');
    assert.equal(doc.documentElement.getAttribute('height'), '1080');
    assert.equal(doc.documentElement.getAttribute('viewBox'), '0 0 1920 1080');
    assert.deepEqual(paths(doc), paths(original));
    assert.equal(doc.getElementsByTagName('image').length, 0);
    const bg = doc.getElementsByTagName('svg')[1];
    assert.equal(bg.getAttribute('width'), '1920');
    assert.equal(bg.getAttribute('height'), '1080');
    assert.equal(bg.getAttribute('preserveAspectRatio'), 'xMidYMid slice');
    const groups = Array.from(doc.getElementsByTagName('g')).filter(group => group.hasAttribute('data-object-id'));
    assert.equal(groups.length, scene.objects.length);
    for (const [index, group] of groups.entries()) {
      const object = scene.objects[index];
      assert.ok(group.getAttribute('transform').startsWith(`translate(${object.x * 1920} ${object.y * 1080})`));
      assert.match(group.getAttribute('transform'), /scale\([\d.]+\)$/);
    }
  }
});

test('automatic layouts and preflight use custom aspect ratios and actual canvas edges', () => {
  for (const [width, height] of [[1600, 900], [900, 1600], [1080, 1080], [2400, 600]]) {
    const variants = generateLayouts(catalog, custom(width, height));
    assert.equal(variants.length, 3);
    for (const variant of variants) {
      assert.deepEqual(canvasSize(catalog, variant.scene), { width, height });
      assert.equal(variant.metrics.insideCanvas, true);
      assert.equal(inspectComposition(catalog, variant.scene).filter(issue => issue.code === 'outside').length, 0);
    }
  }
  const scene = custom(1600, 900);
  scene.objects = [{ ...scene.objects[0], x: 1.1 }];
  assert.equal(inspectComposition(catalog, scene).filter(issue => issue.code === 'outside').length, 1);
});

test('custom SVG keeps both role maps when saved and exported on a custom canvas', async () => {
  const scene = JSON.parse(await readFile(new URL('examples/end-to-end/custom-roles.sostav.json', root), 'utf8'));
  scene.formatId = 'custom';
  scene.customCanvas = { width: 1500, height: 750 };
  const loaded = readScene(JSON.parse(JSON.stringify(scene)), catalog);
  assert.deepEqual(loaded.customObjects, scene.customObjects);
  const svg = exportSvg(customLibrary(catalog, loaded.customObjects), customTexts(texts, loaded.customObjects), loaded);
  const doc = parse(svg);
  assert.equal(doc.documentElement.getAttribute('viewBox'), '0 0 1500 750');
  assert.equal(doc.getElementsByTagName('image').length, 0);
  for (const role of ['main', 'secondary']) assert.ok(svg.includes(`data-role="${role}"`));
});
