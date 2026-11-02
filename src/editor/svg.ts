import type { Catalog, Palette, PaintTarget, SvgAsset } from '../library/types.js';
import { paintSubstitutions, selectObject } from '../library/index.js';
import { activePalette, canvasSize, objectTransform, type Scene } from './model.js';
import { normalizePaintColor, PAINT_ATTRIBUTES } from '../library/paint.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export type AssetTexts = ReadonlyMap<string, string>;

function normalizePaint(value: string): string {
  if (value.toLowerCase() === 'white') return '#FFFFFF';
  if (value.toLowerCase() === 'black') return '#000000';
  return value.toUpperCase();
}

/** Change paint attributes and instance identifiers only, preserving all paths and definitions. */
export function preparedSvg(catalog: Catalog, asset: SvgAsset, text: string, palette: Palette, target: PaintTarget, prefix: string): Element {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement || doc.documentElement.localName !== 'svg') throw new Error('Не удалось прочитать SVG');
  const root = doc.documentElement;
  const nodes = [root, ...Array.from(root.getElementsByTagName('*'))];
  const idMap = new Map<string, string>();
  for (const node of nodes) if (node.hasAttribute('id')) idMap.set(node.getAttribute('id')!, `${prefix}-${node.getAttribute('id')}`);
  const paints = paintSubstitutions(catalog, asset, palette, target);
  for (const node of nodes) {
    for (const attribute of Array.from(node.attributes)) {
      const value = attribute.value;
      if (attribute.localName === 'id') node.setAttribute(attribute.name, idMap.get(value)!);
      else if (PAINT_ATTRIBUTES.includes(attribute.localName) && paints[normalizePaintColor(value) ?? normalizePaint(value)]) {
        const key = normalizePaintColor(value) ?? normalizePaint(value);
        node.setAttribute(attribute.name, paints[key]! + (key.length === 9 ? key.slice(7) : ''));
      }
      else if (value.includes('url(')) node.setAttribute(attribute.name, value.replace(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g, (match, id: string) => idMap.has(id) ? `url(#${idMap.get(id)})` : match));
      else if (attribute.localName === 'href' && value.startsWith('#') && idMap.has(value.slice(1))) node.setAttribute(attribute.name, '#' + idMap.get(value.slice(1)));
    }
  }
  return root;
}

function assetText(texts: AssetTexts, asset: SvgAsset): string {
  const text = texts.get(asset.url);
  if (!text) throw new Error('SVG ещё не загружен: ' + asset.url);
  return text;
}

export function objectMarkup(catalog: Catalog, texts: AssetTexts, asset: SvgAsset, palette: Palette, prefix: string): string {
  const root = preparedSvg(catalog, asset, assetText(texts, asset), palette, 'object', prefix);
  root.setAttribute('x', String(-asset.width / 2));
  root.setAttribute('y', String(-asset.height / 2));
  root.setAttribute('overflow', 'visible');
  return new XMLSerializer().serializeToString(root);
}

export function backgroundMarkup(catalog: Catalog, texts: AssetTexts, scene: Scene, prefix = 'scene-background'): string {
  const palette = activePalette(catalog, scene);
  const background = catalog.backgrounds.find(item => item.paletteId === scene.paletteId) ?? catalog.backgrounds.find(item => item.paletteId === catalog.basePaletteId);
  if (!background) throw new Error('Фон не найден');
  const asset = background.variants[scene.size];
  const root = preparedSvg(catalog, asset, assetText(texts, asset), palette, 'background', prefix);
  const { width, height } = canvasSize(catalog, scene);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('x', '0'); root.setAttribute('y', '0');
  root.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  return new XMLSerializer().serializeToString(root);
}

/** Same scene transforms and SVG preparation used by the live editor. No UI controls in export. */
export function exportSvg(catalog: Catalog, texts: AssetTexts, scene: Scene, namespace = ''): string {
  const { width, height } = canvasSize(catalog, scene);
  const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`, 'image/svg+xml');
  const root = doc.documentElement;
  root.setAttribute('role', 'img');
  const title = doc.createElementNS(SVG_NS, 'title');
  title.textContent = scene.name;
  root.appendChild(title);
  const desc = doc.createElementNS(SVG_NS, 'desc');
  desc.textContent = 'Состав — композиция из исходных векторных объектов. Каждый предмет сохранён отдельной группой.';
  root.appendChild(desc);
  const append = (parent: Element, markup: string) => {
    const child = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
    parent.appendChild(doc.importNode(child, true));
  };
  if (scene.backgroundVisible) {
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('id', namespace + 'background');
    group.setAttribute('data-name', 'Фон');
    append(group, backgroundMarkup(catalog, texts, scene, namespace + 'scene-background'));
    root.appendChild(group);
  }
  const palette = activePalette(catalog, scene);
  for (const object of scene.objects) {
    const asset = selectObject(catalog, object.objectId, scene.size, object.role);
    const group = doc.createElementNS(SVG_NS, 'g');
    group.setAttribute('id', `${namespace}object-${object.instanceId}`);
    group.setAttribute('data-object-id', object.objectId);
    group.setAttribute('data-role', object.role);
    group.setAttribute('data-name', catalog.objects.find(item => item.id === object.objectId)!.name);
    group.setAttribute('transform', objectTransform(catalog, scene, object));
    append(group, objectMarkup(catalog, texts, asset, palette, `${namespace}instance-${object.instanceId}`));
    root.appendChild(group);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(root);
}
