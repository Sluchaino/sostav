import { DOMParser } from '@xmldom/xmldom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc']);

export function normalizeColor(value) {
  if (value.toLowerCase() === 'white') return '#FFFFFF';
  if (value.toLowerCase() === 'black') return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return '#' + [...value.slice(1)].map(x => x + x).join('').toUpperCase();
  return value;
}

export function inspectSvg(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD and entities are not supported');
  const errors = [];
  const doc = new DOMParser({ errorHandler: {
    warning: message => errors.push(message),
    error: message => errors.push(message),
    fatalError: message => errors.push(message),
  } }).parseFromString(text, 'image/svg+xml');
  if (errors.length) throw new Error('Invalid XML: ' + errors.join('; '));
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) throw new Error('Expected an SVG root with SVG namespace');
  const viewBox = root.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  const width = Number(root.getAttribute('width'));
  const height = Number(root.getAttribute('height'));
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0 || !(width > 0) || !(height > 0)) throw new Error('Invalid SVG dimensions');
  const ids = new Set();
  const references = [];
  const colors = new Set();
  const tags = {};
  const nodes = [root, ...Array.from(root.getElementsByTagName('*'))];
  for (const node of nodes) {
    if (node.namespaceURI !== SVG_NS || !TAGS.has(node.localName)) throw new Error('Unsupported SVG element: ' + node.tagName);
    tags[node.localName] = (tags[node.localName] ?? 0) + 1;
    const id = node.getAttribute('id');
    if (id) {
      if (ids.has(id)) throw new Error('Duplicate SVG id: ' + id);
      ids.add(id);
    }
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.localName) || ['href', 'style'].includes(attr.localName)) throw new Error('Unsupported SVG attribute: ' + attr.name);
      const urls = [...attr.value.matchAll(/url\(([^)]+)\)/g)];
      for (const match of urls) {
        const ref = match[1].replace(/['"]/g, '').trim();
        if (!ref.startsWith('#')) throw new Error('External SVG resource: ' + ref);
        references.push(ref.slice(1));
      }
      if (['fill', 'stroke', 'stop-color'].includes(attr.localName) && attr.value !== 'none' && !urls.length) {
        const color = normalizeColor(attr.value);
        if (!/^#[0-9A-F]{6}$/.test(color)) throw new Error('Unsupported SVG color: ' + color);
        colors.add(color);
      }
    }
  }
  for (const ref of references) if (!ids.has(ref)) throw new Error('Unresolved SVG reference: ' + ref);
  return { width, height, viewBox, pathCount: tags.path ?? 0, elementCount: nodes.length, colors: [...colors].sort(), definitionIds: [...ids], tags };
}
