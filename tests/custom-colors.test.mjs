import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { normalizePaintColor } from '../.build/library/paint.js';
import { readCustomSvg, customLibrary, customTexts } from '../.build/library/custom.js';
import { createBlankScene, validateScene } from '../.build/editor/model.js';
import { exportSvg } from '../.build/editor/svg.js';
globalThis.DOMParser = DOMParser; globalThis.XMLSerializer = XMLSerializer;
const catalog = JSON.parse(await readFile(new URL('../public/library/catalog.json', import.meta.url), 'utf8'));
const xml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop stop-color="rgb(255, 0, 0)" stop-opacity="0.4"/><stop offset="1" stop-color="#0f08"/></linearGradient></defs><path d="M1 2L30 40Z" fill="url(#g)" stroke="rgba(0, 0, 255, 0.5)" stroke-opacity="0.7"/><rect width="5" height="6" fill="white"/></svg>';
const object = { id: 'custom-colors', name: 'Цвета', tags: [], meanings: [], svg: xml, paintRoles: { '#FF0000': 'object.primary', '#00FF0088': 'object.secondary', '#0000FF80': 'object.soft' } };

test('paint keys unify HEX, RGB, percentages, common names and alpha', () => {
  for (const value of ['#fff', '#FFFf', '#ffffff', '#FFFFFFFF', 'white', 'rgb(255, 255, 255)', 'rgb(100% 100% 100%)']) assert.equal(normalizePaintColor(value), '#FFFFFF');
  for (const value of ['rgba(255,0,0,.5)', 'rgb(255 0 0 / 50%)', '#ff000080']) assert.equal(normalizePaintColor(value), '#FF000080');
  assert.equal(normalizePaintColor('#f008'), '#FF000088');
  for (const value of ['none', 'currentColor', 'url(#g)', 'rgb(no)', 'var(--x)']) assert.equal(normalizePaintColor(value), null);
});

test('color discovery includes gradients, inline styles, inherited/default paints and currentColor', () => {
  assert.deepEqual(readCustomSvg(xml).colors.sort(), ['#FF0000', '#00FF0088', '#0000FF80', '#FFFFFF'].sort());
  const value = readCustomSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L2 3Z"/><circle r="1" style="stroke:currentColor;fill:#abc"/></svg>');
  assert.ok(value.colors.includes('#000000')); assert.ok(value.colors.includes('#AABBCC'));
});

test('custom color assignments round-trip, recolor across palettes, preserve alpha, geometry and unassigned colors', () => {
  const scene = { ...createBlankScene(), backgroundVisible: false, customObjects: [object], objects: [{ instanceId: 'colors', objectId: object.id, role: 'main', x: .5, y: .5, rotation: 0 }] };
  const restored = JSON.parse(JSON.stringify(scene)); validateScene(restored, catalog);
  const merged = customLibrary(catalog, restored.customObjects), texts = customTexts(new Map(), restored.customObjects);
  for (const palette of catalog.palettes) {
    const svg = exportSvg(merged, texts, { ...restored, paletteId: palette.id });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(doc.getElementsByTagName('path')[0].getAttribute('d'), 'M1 2L30 40Z');
    assert.equal(doc.getElementsByTagName('path')[0].getAttribute('stroke'), palette.colors['object.soft'] + '80');
    assert.equal(doc.getElementsByTagName('path')[0].getAttribute('stroke-opacity'), '0.7');
    assert.equal(doc.getElementsByTagName('stop')[0].getAttribute('stop-color'), palette.colors['object.primary']);
    assert.equal(doc.getElementsByTagName('stop')[0].getAttribute('stop-opacity'), '0.4');
    assert.equal(doc.getElementsByTagName('stop')[1].getAttribute('stop-color'), palette.colors['object.secondary'] + '88');
    assert.equal(doc.getElementsByTagName('rect')[0].getAttribute('fill'), 'white');
    assert.ok(svg.includes('url(#instance-colors-g)'));
  }
});

test('old custom objects keep original colors and forged assignments are rejected', () => {
  const { paintRoles, ...old } = object;
  validateScene({ ...createBlankScene(), customObjects: [old] }, catalog);
  for (const roles of [{ '#FF0000': 'not-a-role' }, { '#123456': 'object.primary' }, [], null]) assert.throws(() => validateScene({ ...createBlankScene(), customObjects: [{ ...object, paintRoles: roles }] }, catalog));
});
