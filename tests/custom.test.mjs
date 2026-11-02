import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { readCustomSvg, customLibrary, customTexts, validateCustomObjects } from '../.build/library/custom.js';
import { createBlankScene, validateScene } from '../.build/editor/model.js';
import { selectObjectsByTheme, objectsFromMeaning } from '../.build/editor/meaning.js';
import { generateLayouts } from '../.build/editor/layout.js';
import { exportSvg } from '../.build/editor/svg.js';
globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const catalog = JSON.parse(await readFile(new URL('../public/library/catalog.json', import.meta.url), 'utf8'));
const original = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 200"><defs><linearGradient id="paint"><stop stop-color="#ff0000"/></linearGradient></defs><path d="M10 20L60 20L60 200Z" style="fill:URL(#paint);stroke:#123456"/></svg>';
const item = { id: 'custom-ladder', name: 'Лестница', tags: ['ступени'], meanings: ['рост', 'карьера', 'путь к успеху'], svg: readCustomSvg(original).svg };
const merged = customLibrary(catalog, [item]);

test('custom SVG keeps paths, paint and source viewBox while fitting its viewport', () => {
  const result = readCustomSvg(original);
  assert.equal(result.width, 200); assert.equal(result.height, 400);
  assert.deepEqual(result.viewBox, [10, 20, 100, 200]);
  assert.ok(result.svg.includes('M10 20L60 20L60 200Z'));
  assert.ok(result.svg.includes('stroke="#123456"'));
  assert.equal(readCustomSvg(result.svg).svg, result.svg);
});

test('unsafe and unsupported SVG is rejected before rendering, including project uploads', () => {
  for (const content of ['<?evil ><script>alert(1)</script>?>', '<script>alert(1)</script>', '<foreignObject/>', '<image href="data:image/png;base64,AA"/>', '<style>path{fill:red}</style>', '<use href="https://example.com/a.svg#x"/>', '<path onclick="alert(1)"/>', '<path fill="url(https://example.com)"/>', '<path style="fill:uRl(javascript:alert(1))"/>', '<animate attributeName="href"/>']) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${content}</svg>`;
    assert.throws(() => readCustomSvg(svg));
    assert.throws(() => validateScene({ ...createBlankScene(), customObjects: [{ ...item, svg }] }, catalog));
  }
  assert.throws(() => readCustomSvg('<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>'));
  assert.throws(() => readCustomSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"/>'));
});

test('custom metadata participates in literal phrases, shared concepts and exclusions', () => {
  assert.ok(selectObjectsByTheme(merged, 'Путь к успеху').items.some(value => value.objectId === item.id));
  assert.ok(selectObjectsByTheme(merged, 'Развитие навыков').items.some(value => value.objectId === item.id));
  assert.ok(selectObjectsByTheme(merged, 'Карьера').items.some(value => value.objectId === item.id));
  const excluded = selectObjectsByTheme(merged, 'Обучение, без лестницы');
  assert.ok(!excluded.items.some(value => value.objectId === item.id));
  assert.ok(excluded.excludedObjectIds.includes(item.id));
  assert.equal(selectObjectsByTheme(merged, 'Успеху').items.length, 0, 'multiword meaning must not match one isolated word');
});

test('only-custom selection generates editable layouts, portable projects and vector exports', () => {
  const only = { ...merged, objects: merged.objects.filter(object => object.custom) };
  const meaning = selectObjectsByTheme(only, 'Развитие');
  assert.deepEqual(meaning.items.map(value => value.objectId), [item.id]);
  assert.equal(meaning.status, 'matched');
  const scene = { ...createBlankScene(), backgroundVisible: false, customObjects: [item], objects: objectsFromMeaning(only, meaning), interpretation: meaning };
  validateScene(scene, catalog);
  const restored = JSON.parse(JSON.stringify(scene));
  validateScene(restored, catalog);
  const variants = generateLayouts(merged, restored, { seed: 1 });
  assert.equal(variants.length, 3);
  for (const variant of variants) {
    assert.ok(variant.metrics.insideCanvas);
    const svg = exportSvg(merged, customTexts(new Map(), restored.customObjects), variant.scene);
    assert.ok(svg.includes('M10 20L60 20L60 200Z'));
    assert.ok(svg.includes('#123456'));
    assert.ok(svg.includes('url(#instance-'));
    assert.ok(!svg.includes('<image'));
  }
});

test('project validation rejects duplicate IDs, oversized metadata and still accepts old projects', () => {
  validateScene(createBlankScene(), catalog);
  assert.throws(() => validateCustomObjects([item, item], catalog));
  assert.throws(() => validateCustomObjects([{ ...item, meanings: ['x'.repeat(121)] }], catalog));
});
