import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectSvg } from '../scripts/svg.mjs';
import { selectObject, selectBackground, searchObjects, allowedColors, paintSubstitutions, validatePalette, sceneTransform, getPalette } from '../.build/library/index.js';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/library/catalog.json', root), 'utf8'));

test('all 46 exported assets match original SVG bytes and checksums', async () => {
  const assets = [
    ...catalog.objects.flatMap(object => Object.values(object.variants).flatMap(Object.values)),
    ...catalog.backgrounds.flatMap(background => Object.values(background.variants)),
  ];
  assert.equal(catalog.objects.length, 10);
  assert.equal(assets.length, 46);
  for (const asset of assets) {
    const source = await readFile(new URL(asset.source, root));
    const copied = await readFile(new URL('public' + asset.url, root));
    assert.deepEqual(copied, source, asset.source);
    assert.equal(createHash('sha256').update(copied).digest('hex'), asset.sha256);
  }
});

test('size and role selection use explicit files, including known phone discrepancy', () => {
  assert.equal(selectObject(catalog, 'phone', 'S', 'main').pathCount, 96);
  assert.equal(selectObject(catalog, 'phone', 'L', 'main').pathCount, 155);
  assert.equal(selectObject(catalog, 'phone', 'S', 'secondary').pathCount, 155);
  assert.equal(selectBackground(catalog, 'aqua', 'S').width, 500);
  assert.equal(selectBackground(catalog, 'aqua', 'L').width, 1000);
  assert.throws(() => selectObject(catalog, 'unknown', 'S', 'main'), /not found/);
});

test('literal search handles Russian case, ё/е and multiple tags', () => {
  assert.deepEqual(searchObjects(catalog, 'КОШЕЛЁК').map(o => o.id), ['wallet']);
  assert.deepEqual(searchObjects(catalog, 'кошелек деньги').map(o => o.id), ['wallet']);
  assert.equal(searchObjects(catalog, '').length, 10);
  assert.equal(searchObjects(catalog, 'несуществующий предмет').length, 0);
});

test('object-only accents are unavailable for background and source paints map by role', () => {
  for (const palette of catalog.palettes) {
    assert.deepEqual(allowedColors(catalog, palette, 'background').map(x => x.role), ['background.base', 'background.medium', 'background.strong']);
    assert.equal(allowedColors(catalog, palette, 'object').length, 6);
    const main = selectObject(catalog, 'phone', 'L', 'main');
    const paints = paintSubstitutions(catalog, main, palette, 'object');
    assert.equal(paints['#D7CDF5'], palette.colors['background.base']);
    assert.equal(paints['#181817'], '#181817');
    assert.throws(() => paintSubstitutions(catalog, main, palette, 'background'), /forbidden/);
  }
});

test('new palettes require complete roles and preserve fixed structural colors', () => {
  const custom = structuredClone(getPalette(catalog, 'violet'));
  custom.id = 'custom'; custom.name = 'Пользовательская'; custom.colors['object.primary'] = '#123456';
  validatePalette(catalog, custom);
  assert.equal(allowedColors(catalog, custom, 'object').find(x => x.role === 'object.primary').color, '#123456');
  const incomplete = structuredClone(custom); delete incomplete.colors['object.soft'];
  assert.throws(() => validatePalette(catalog, incomplete), /все роли цветов/);
  custom.colors['neutral.ink'] = '#333333';
  assert.throws(() => validatePalette(catalog, custom), /зафиксирован/);
});

test('scene scaling is uniform and never normalizes individual object sizes', () => {
  assert.deepEqual(sceneTransform(catalog, 'L', 1200, 630), { scale: 0.63, x: 285, y: 0 });
  assert.deepEqual(sceneTransform(catalog, 'S', 1000, 1000), { scale: 2, x: 0, y: 0 });
  assert.throws(() => sceneTransform(catalog, 'S', 0, 1000), /Invalid/);
});

test('SVG validation catches invalid XML, raster content, unsafe attributes and broken references', () => {
  const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">${body}</svg>`;
  for (const body of [
    '<image href="data:image/png;base64,AA=="/>', '<script/>', '<path onclick="alert(1)"/>',
    '<path fill="url(#missing)"/>', '<g id="x"/><g id="x"/>', '<path fill="url(https://example.com/a)"/>',
    '<path style="fill:red"/>', '<g></path>',
  ]) assert.throws(() => inspectSvg(svg(body)));
  const valid = inspectSvg(svg('<defs><clipPath id="crop"><rect width="10" height="10"/></clipPath></defs><g clip-path="url(#crop)"><path fill="white" d="M0 0Z"/></g>'));
  assert.deepEqual(valid.colors, ['#FFFFFF']);
  assert.deepEqual(valid.definitionIds, ['crop']);
});
