import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createExample, EXAMPLES } from '../.build/editor/model.js';
import { exportSvg } from '../.build/editor/svg.js';
import { inspectSvg } from './svg.mjs';
import { generateLayouts } from '../.build/editor/layout.js';
import { selectObjectsByTheme, objectsFromMeaning } from '../.build/editor/meaning.js';
import { createBlankScene } from '../.build/editor/model.js';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/library/catalog.json', root), 'utf8'));
const assets = [...catalog.objects.flatMap(item => Object.values(item.variants).flatMap(Object.values)), ...catalog.backgrounds.flatMap(item => Object.values(item.variants))];
const texts = new Map(await Promise.all(assets.map(async asset => [asset.url, await readFile(new URL('public' + asset.url, root), 'utf8')])));
await mkdir(new URL('examples/', root), { recursive: true });
await mkdir(new URL('examples/automatic/', root), { recursive: true });
for (const example of EXAMPLES) {
  const scene = createExample(example.id);
  const svg = exportSvg(catalog, texts, scene);
  inspectSvg(svg);
  await writeFile(new URL(`examples/${example.id}.svg`, root), svg);
  await writeFile(new URL(`examples/${example.id}.sostav.json`, root), JSON.stringify(scene, null, 2) + '\n');
  const generated = generateLayouts(catalog, scene, { seed: 2, includeBackgroundObjects: example.id === 'learning' })[1].scene;
  const generatedSvg = exportSvg(catalog, texts, generated);
  inspectSvg(generatedSvg);
  await writeFile(new URL(`examples/automatic/${example.id}.svg`, root), generatedSvg);
  await writeFile(new URL(`examples/automatic/${example.id}.sostav.json`, root), JSON.stringify(generated, null, 2) + '\n');
}
await mkdir(new URL('examples/meaning/', root), { recursive: true });
for (const [id, prompt, formatId, paletteId] of [
  ['savings', 'Финансовая подушка', 'landscape', 'peach'],
  ['solution', 'Собрать решение по частям', 'square', 'violet'],
  ['inspiration', 'Полёт мысли', 'portrait', 'aqua'],
]) {
  const interpretation = selectObjectsByTheme(catalog, prompt, { includeBackgroundObjects: true });
  const base = { ...createBlankScene(), name: prompt, formatId, paletteId, objects: objectsFromMeaning(catalog, interpretation), interpretation };
  const scene = generateLayouts(catalog, base, { seed: 4 })[1].scene;
  const svg = exportSvg(catalog, texts, scene); inspectSvg(svg);
  await writeFile(new URL(`examples/meaning/${id}.svg`, root), svg);
  await writeFile(new URL(`examples/meaning/${id}.sostav.json`, root), JSON.stringify(scene, null, 2) + '\n');
}
console.log('Generated 3 manual, 3 automatic and 3 local-meaning SVG compositions with editable JSON projects in examples/.');
