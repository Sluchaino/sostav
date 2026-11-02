import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createExample, EXAMPLES } from '../.build/editor/model.js';
import { exportSvg } from '../.build/editor/svg.js';
import { inspectSvg } from './svg.mjs';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;
const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('public/library/catalog.json', root), 'utf8'));
const assets = [...catalog.objects.flatMap(item => Object.values(item.variants).flatMap(Object.values)), ...catalog.backgrounds.flatMap(item => Object.values(item.variants))];
const texts = new Map(await Promise.all(assets.map(async asset => [asset.url, await readFile(new URL('public' + asset.url, root), 'utf8')])));
await mkdir(new URL('examples/', root), { recursive: true });
for (const example of EXAMPLES) {
  const scene = createExample(example.id);
  const svg = exportSvg(catalog, texts, scene);
  inspectSvg(svg);
  await writeFile(new URL(`examples/${example.id}.svg`, root), svg);
  await writeFile(new URL(`examples/${example.id}.sostav.json`, root), JSON.stringify(scene, null, 2) + '\n');
}
console.log('Generated 3 SVG compositions and 3 editable project files in examples/.');
