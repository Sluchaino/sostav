import type { Catalog, ColorRole, LibraryObject, SvgAsset } from './types.js';
import { normalizePaintColor, PAINT_ATTRIBUTES } from './paint.js';

export interface CustomObject {
  id: string;
  name: string;
  tags: string[];
  meanings: string[];
  svg: string;
  paintRoles?: Record<string, ColorRole>;
}
export const MAX_SVG_BYTES = 1_000_000;
export const MAX_CUSTOM_OBJECTS = 30;
const NS = 'http://www.w3.org/2000/svg';
const elements = new Set('svg g defs path rect circle ellipse line polyline polygon linearGradient radialGradient stop clipPath mask pattern use title desc text tspan textPath filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feComponentTransfer feFuncR feFuncG feFuncB feFuncA feDropShadow'.split(' '));
const attributes = new Set('id xmlns xmlns:xlink version width height viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask filter gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits href xlink:href color display visibility vector-effect paint-order font-family font-size font-weight font-style text-anchor dominant-baseline dx dy rotate textLength lengthAdjust startOffset method spacing filterUnits primitiveUnits in in2 result stdDeviation mode type values operator k1 k2 k3 k4 flood-color flood-opacity slope intercept amplitude exponent tableValues'.split(' '));
const styleAttributes = new Set('fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity clip-path clip-rule mask filter stop-color stop-opacity color display visibility font-family font-size font-weight font-style text-anchor dominant-baseline vector-effect paint-order'.split(' '));

/** Accept only self-contained, static SVG. Never insert arbitrary uploaded XML into HTML. */
export function readCustomSvg(text: string): { svg: string; width: number; height: number; viewBox: [number, number, number, number]; colors: string[]; unsupportedPaints: string[] } {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SVG_BYTES) throw new Error('SVG должен быть не больше 1 МБ');
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)) throw new Error('SVG с DTD или внешними стилями не поддерживается');
  text = text.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/i, '');
  if (text.includes('<?')) throw new Error('Инструкции обработки XML не поддерживаются');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== NS || doc.getElementsByTagName('parsererror').length) throw new Error('Не удалось прочитать SVG');
  const nodes = [root, ...Array.from(root.getElementsByTagName('*'))];
  if (nodes.length > 12000) throw new Error('SVG слишком сложный: больше 12 000 элементов');
  for (const node of nodes) {
    if (node.namespaceURI !== NS || !elements.has(node.localName)) throw new Error(`Элемент ${node.localName} не поддерживается. Экспортируйте статический вектор без изображений, скриптов и таблиц стилей.`);
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 4) node.replaceChild(doc.createTextNode(child.nodeValue ?? ''), child);
      else if (child.nodeType === 8) node.removeChild(child);
    }
    if (node.hasAttribute('style')) {
      for (const declaration of node.getAttribute('style')!.split(';').filter(value => value.trim())) {
        const colon = declaration.indexOf(':');
        const name = declaration.slice(0, colon).trim();
        const value = declaration.slice(colon + 1).trim();
        if (colon < 1 || !styleAttributes.has(name)) throw new Error('Неподдерживаемый стиль SVG: ' + name);
        node.setAttribute(name, value);
      }
      node.removeAttribute('style');
    }
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) throw new Error('Обработчики событий в SVG запрещены');
      if (!attributes.has(attr.name)) { node.removeAttribute(attr.name); continue; }
      const value = attr.value.trim();
      if (attr.localName === 'href' && !/^#[a-zA-Z0-9_.:-]+$/.test(value)) throw new Error('SVG должен быть автономным: внешние ссылки запрещены');
      if (attr.name !== 'xmlns' && attr.name !== 'xmlns:xlink' && (/[<>\\]|javascript\s*:|@import|expression\s*\(/i.test(value) || (/url\s*\(/i.test(value) && !/^url\(\s*['"]?#[a-zA-Z0-9_.:-]+['"]?\s*\)$/i.test(value)))) throw new Error('Неподдерживаемая ссылка или значение в SVG');
      if (attr.localName === 'href') node.setAttribute(attr.name, value);
      const reference = value.match(/^url\(\s*['"]?#([a-zA-Z0-9_.:-]+)['"]?\s*\)$/i);
      if (reference) node.setAttribute(attr.name, `url(#${reference[1]})`);
    }
  }
  const dimensions = (value: string | null) => value && /^\d*\.?\d+(px)?$/.test(value.trim()) ? parseFloat(value) : NaN;
  const box = root.getAttribute('viewBox');
  const viewBox = (box ? box.trim().split(/[\s,]+/).map(Number) : [0, 0, dimensions(root.getAttribute('width')), dimensions(root.getAttribute('height'))]) as [number, number, number, number];
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0 || viewBox.some(value => Math.abs(value) > 1e7)) throw new Error('Нужен корректный viewBox или размеры width/height в px');
  // Normalize the viewport only. Paths and the original coordinate system stay intact.
  const scale = 400 / Math.max(viewBox[2], viewBox[3]);
  const width = viewBox[2] * scale, height = viewBox[3] * scale;
  root.setAttribute('viewBox', viewBox.join(' '));
  root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // Make SVG default paints explicit so they can also be assigned palette roles.
  const inheritsDefault = (node: Element, name: string) => {
    let current: Element | null = node;
    while (current) {
      if (current.hasAttribute(name) && current.getAttribute(name) !== 'inherit') return false;
      current = current.parentNode?.nodeType === 1 ? current.parentNode as Element : null;
    }
    return true;
  };
  const filledShapes = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'text', 'tspan', 'use']);
  if (nodes.some(node => filledShapes.has(node.localName) && inheritsDefault(node, 'fill'))) root.setAttribute('fill', '#000000');
  const colors = new Set<string>(), unsupportedPaints = new Set<string>();
  const usesCurrentColor = nodes.some(node => PAINT_ATTRIBUTES.some(name => node.getAttribute(name)?.toLowerCase() === 'currentcolor'));
  if (usesCurrentColor && nodes.some(node => inheritsDefault(node, 'color'))) root.setAttribute('color', '#000000');
  for (const node of nodes) {
    if (node.localName === 'stop' && !node.hasAttribute('stop-color')) node.setAttribute('stop-color', '#000000');
    for (const name of PAINT_ATTRIBUTES) {
      if (name === 'color' && !usesCurrentColor) continue;
      const value = node.getAttribute(name);
      if (!value || /^(none|inherit|currentcolor|url\()/i.test(value)) continue;
      const color = normalizePaintColor(value);
      if (color) colors.add(color); else unsupportedPaints.add(value);
    }
  }
  return { svg: new XMLSerializer().serializeToString(root), width, height, viewBox, colors: [...colors], unsupportedPaints: [...unsupportedPaints] };
}

export function validateCustomObjects(value: unknown, catalog: Catalog): asserts value is CustomObject[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_OBJECTS) throw new Error('Допускается не более 30 своих SVG');
  const ids = new Set(catalog.objects.filter(item => !item.custom).map(item => item.id));
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^custom-[a-zA-Z0-9_-]{1,70}$/.test(item.id) || ids.has(item.id)) throw new Error('Неверный или повторяющийся ID своего SVG');
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new Error('Название SVG: от 1 до 80 символов');
    for (const field of [item.tags, item.meanings]) if (!Array.isArray(field) || field.length > 30 || field.some((word: unknown) => typeof word !== 'string' || !word.trim() || word.length > 120)) throw new Error('Не более 30 тегов и смыслов, каждый до 120 символов');
    const { colors } = readCustomSvg(item.svg);
    if (item.paintRoles !== undefined) {
      if (!item.paintRoles || typeof item.paintRoles !== 'object' || Array.isArray(item.paintRoles)) throw new Error('Неверное назначение цветов SVG');
      for (const [color, role] of Object.entries(item.paintRoles)) {
        if (!colors.includes(color) || typeof role !== 'string' || !Object.hasOwn(catalog.colorRoles, role) || !catalog.colorRoles[role as ColorRole].targets.includes('object')) throw new Error('Неизвестный цвет или роль в настройках SVG');
      }
    }
    total += new TextEncoder().encode(item.svg).length;
  }
  if (total > 8_000_000) throw new Error('Общий размер своих SVG — не больше 8 МБ');
}

export function customLibrary(catalog: Catalog, items: CustomObject[] = []): Catalog {
  const objects: LibraryObject[] = items.map(item => {
    const { width, height, viewBox, colors } = readCustomSvg(item.svg);
    const asset: SvgAsset = { url: item.id, source: item.name, sha256: '', bytes: item.svg.length, width, height, viewBox, pathCount: 0, elementCount: 0, colors, definitionIds: [], tags: {}, paintRoles: item.paintRoles ?? {} };
    return { id: item.id, name: item.name, tags: [...item.tags, ...item.meanings], meanings: item.meanings, custom: true, detailStatus: 'no-proven-simplified-pair', note: 'Свой SVG: цвета по назначениям палитры, один вариант для S/L и обеих ролей.', variants: { S: { main: asset, secondary: asset }, L: { main: asset, secondary: asset } } };
  });
  return { ...catalog, objects: [...catalog.objects.filter(item => !item.custom), ...objects] };
}

export function customTexts(texts: ReadonlyMap<string, string>, items: CustomObject[] = []): ReadonlyMap<string, string> {
  return new Map([...texts, ...items.map(item => [item.id, readCustomSvg(item.svg).svg] as const)]);
}
