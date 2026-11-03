import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { customLibrary, customTexts, customPaintRoles, monochromePaintRoles } from '../.build/library/custom.js';
import { createBlankScene, validateScene } from '../.build/editor/model.js';
import { exportSvg } from '../.build/editor/svg.js';
import { inspectComposition } from '../.build/editor/preflight.js';

globalThis.DOMParser = DOMParser; globalThis.XMLSerializer = XMLSerializer;
const catalog = JSON.parse(await readFile(new URL('../public/library/catalog.json', import.meta.url), 'utf8'));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#00ff0080"/></linearGradient></defs><path d="M1 2L30 40Z" fill="url(#g)" stroke="#0000ff" stroke-opacity="0.7"/></svg>';
const item = { id: 'custom-role-colors', name: 'Разные роли', tags: [], meanings: [], svg, paintRolesByRole: {
  main: { '#FF0000': 'object.primary', '#00FF0080': 'object.secondary', '#0000FF': 'neutral.ink' },
  secondary: { '#FF0000': 'background.strong', '#00FF0080': 'background.base', '#0000FF': 'neutral.ink' },
} };
const makeScene = object => ({ ...createBlankScene(), backgroundVisible: false, customObjects: [object], objects: ['main', 'secondary'].map((role, i) => ({ instanceId: role, objectId: object.id, role, x: .3 + i * .4, y: .5, rotation: 15 })) });

test('one custom SVG exports independent main and background colors in all palettes and sizes', () => {
  const scene = JSON.parse(JSON.stringify(makeScene(item))); validateScene(scene, catalog);
  const lib = customLibrary(catalog, scene.customObjects), texts = customTexts(new Map(), scene.customObjects);
  for (const size of ['S', 'L']) for (const palette of catalog.palettes) {
    const doc = new DOMParser().parseFromString(exportSvg(lib, texts, { ...scene, size, paletteId: palette.id }), 'image/svg+xml');
    const groups = Array.from(doc.getElementsByTagName('g')).filter(g => g.hasAttribute('data-object-id'));
    assert.equal(groups.length, 2);
    for (const [i, role] of ['main', 'secondary'].entries()) {
      const stops = groups[i].getElementsByTagName('stop');
      assert.equal(stops[0].getAttribute('stop-color'), palette.colors[role === 'main' ? 'object.primary' : 'background.strong']);
      assert.equal(stops[1].getAttribute('stop-color'), palette.colors[role === 'main' ? 'object.secondary' : 'background.base'] + '80');
      const path = groups[i].getElementsByTagName('path')[0];
      assert.equal(path.getAttribute('d'), 'M1 2L30 40Z');
      assert.equal(path.getAttribute('stroke-opacity'), '0.7');
      assert.equal(path.getAttribute('stroke'), palette.colors['neutral.ink']);
    }
    const ids = Array.from(doc.getElementsByTagName('*')).filter(n => n.hasAttribute('id')).map(n => n.getAttribute('id'));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(doc.getElementsByTagName('image').length, 0);
  }
});

test('legacy shared assignments remain unchanged and explicit empty maps restore original colors independently', () => {
  const old = { ...item, paintRolesByRole: undefined, paintRoles: item.paintRolesByRole.main };
  validateScene(makeScene(old), catalog);
  const legacy = customLibrary(catalog, [old]).objects.at(-1).variants.L;
  assert.deepEqual(legacy.main.paintRoles, old.paintRoles);
  assert.deepEqual(legacy.secondary.paintRoles, old.paintRoles);
  const mixed = { ...old, paintRolesByRole: { secondary: {} } };
  assert.deepEqual(customPaintRoles(mixed, 'main'), old.paintRoles);
  assert.deepEqual(customPaintRoles(mixed, 'secondary'), {});
  validateScene(makeScene(mixed), catalog);
  const copy = JSON.stringify(item);
  customLibrary(catalog, [item]); assert.equal(JSON.stringify(item), copy);
});

test('role maps reject invalid colors, shapes and colored object accents in explicit background maps', () => {
  for (const maps of [null, [], { unknown: {} }, { main: null }, { secondary: [] }, { main: { '#123456': 'object.primary' } }, { secondary: { '#FF0000': 'object.primary' } }, { main: { '#FF0000': 'fake' } }]) {
    assert.throws(() => validateScene(makeScene({ ...item, paintRolesByRole: maps }), catalog));
  }
});

test('monochrome suggestions keep alpha keys, assign only background or neutral tones and pass validation', () => {
  const colors = ['#000000', '#FFFFFF', '#88888880', '#FF0000'];
  const map = monochromePaintRoles(colors);
  assert.equal(map['#000000'], 'neutral.ink'); assert.equal(map['#FFFFFF'], 'neutral.paper');
  assert.ok(Object.hasOwn(map, '#88888880'));
  assert.ok(Object.values(map).every(role => !role.startsWith('object.')));
  const secondary = monochromePaintRoles(Object.keys(item.paintRolesByRole.main));
  validateScene(makeScene({ ...item, paintRolesByRole: { ...item.paintRolesByRole, secondary } }), catalog);
});

test('preflight checks both used roles of a custom object even if the first role is completely mapped', () => {
  const object = { ...item, paintRolesByRole: { main: item.paintRolesByRole.main, secondary: {} } };
  const scene = makeScene(object), lib = customLibrary(catalog, [object]);
  const issues = inspectComposition(lib, scene).filter(i => i.code === 'original-colors');
  assert.equal(issues.length, 1); assert.equal(issues[0].colors.length, 3);
  const mainOnly = { ...scene, objects: scene.objects.filter(o => o.role === 'main') };
  assert.equal(inspectComposition(lib, mainOnly).filter(i => i.code === 'original-colors').length, 0);
});
