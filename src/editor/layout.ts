import type { Catalog, ObjectRole } from '../library/types.js';
import { selectObject } from '../library/index.js';
import { canvasSize, compositionScale, validateScene, type Scene, type SceneObject } from './model.js';

export const MAX_LAYOUT_OBJECTS = 6;
const MARGIN = 0.065;
const MAX_OVERLAP = 0.28;
const normalize = (value: string) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/[^\p{L}\p{N}-]+/gu, ' ').trim();
const ALIASES: Record<string, string[]> = {
  'flower-vase': ['ваза с цветами', 'ваза', 'цветы', 'букет'],
  book: ['книга', 'книги'], wallet: ['кошелек', 'кошельки'], lamp: ['лампа', 'лампы'],
  coin: ['монета', 'монеты'], headphones: ['наушники'], puzzle: ['пазлы', 'пазл'],
  folder: ['папка', 'папки'], pen: ['ручка', 'ручки'], phone: ['телефон', 'телефоны', 'смартфон'],
};

/** Explicit names only, never guesses a missing object from a metaphor. Duplicates are retained. */
export function parseObjectNames(catalog: Catalog, text: string): { objectIds: string[]; unknown: string[] } {
  const aliases = catalog.objects.flatMap(object => [object.name, object.id, ...(ALIASES[object.id] ?? [])]
    .map(name => ({ objectId: object.id, words: normalize(name).split(' ') })))
    .sort((a, b) => b.words.length - a.words.length);
  const words = normalize(text).split(' ').filter(Boolean);
  const objectIds: string[] = [];
  const unknown: string[] = [];
  for (let index = 0; index < words.length;) {
    if (words[index] === 'и') { index++; continue; }
    const match = aliases.find(alias => alias.words.every((word, offset) => word === words[index + offset]));
    if (match) { objectIds.push(match.objectId); index += match.words.length; }
    else { unknown.push(words[index]!); index++; }
  }
  return { objectIds, unknown };
}

/** Stable identity across removing or reordering other named objects. */
export function namedObjectKeys(objectIds: string[]): { objectId: string; instanceId: string }[] {
  const counts = new Map<string, number>();
  return objectIds.map(objectId => {
    const occurrence = counts.get(objectId) ?? 0;
    counts.set(objectId, occurrence + 1);
    return { objectId, instanceId: `named-${objectId}-${occurrence}` };
  });
}

/** Disambiguate duplicate labels without losing the selected library ID. */
export function objectNameToken(catalog: Catalog, objectId: string): string {
  const object = catalog.objects.find(item => item.id === objectId)!;
  return catalog.objects.filter(item => normalize(item.name) === normalize(object.name)).length > 1 ? object.id : object.name;
}

export interface LayoutMetrics { maxOverlap: number; occupancy: number; insideCanvas: boolean }
export interface LayoutVariant { id: string; name: string; description: string; scene: Scene; metrics: LayoutMetrics; addedObjectIds: string[] }
interface Box { x: number; y: number; width: number; height: number }
interface NativeObject { object: SceneObject; width: number; height: number; x: number; y: number }
type Family = 'diagonal' | 'balanced' | 'cascade';
const DETAILS: Record<Family, { name: string; description: string }> = {
  diagonal: { name: 'Диагональ', description: 'Движение от одного предмета к другому' },
  balanced: { name: 'Баланс', description: 'Спокойное расположение с равными отступами' },
  cascade: { name: 'Каскад', description: 'Несколько уровней и лёгкий поворот' },
};

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
}

function rotatedDimensions(width: number, height: number, rotation: number) {
  const angle = rotation * Math.PI / 180;
  return { width: Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height, height: Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height };
}
function union(objects: Box[]) {
  const left = Math.min(...objects.map(object => object.x - object.width / 2));
  const right = Math.max(...objects.map(object => object.x + object.width / 2));
  const top = Math.min(...objects.map(object => object.y - object.height / 2));
  const bottom = Math.max(...objects.map(object => object.y + object.height / 2));
  return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top };
}
function intersection(a: Box, b: Box) {
  return Math.max(0, Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2))
    * Math.max(0, Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2));
}

export function measureLayout(catalog: Catalog, scene: Scene): LayoutMetrics {
  if (!scene.objects.length) return { maxOverlap: 0, occupancy: 0, insideCanvas: true };
  const { width, height } = canvasSize(catalog, scene);
  const scale = compositionScale(catalog, scene);
  const boxes = scene.objects.map(object => {
    const asset = selectObject(catalog, object.objectId, scene.size, object.role);
    const dimensions = rotatedDimensions(asset.width * scale, asset.height * scale, object.rotation);
    return { x: object.x * width, y: object.y * height, ...dimensions };
  });
  let maxOverlap = 0;
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const first = boxes[a]!, second = boxes[b]!;
    maxOverlap = Math.max(maxOverlap, intersection(first, second) / Math.min(first.width * first.height, second.width * second.height));
  }
  return {
    maxOverlap,
    occupancy: boxes.reduce((sum, box) => sum + box.width * box.height, 0) / (width * height),
    insideCanvas: boxes.every(box => box.x - box.width / 2 >= width * MARGIN - 0.01 && box.x + box.width / 2 <= width * (1 - MARGIN) + 0.01 && box.y - box.height / 2 >= height * MARGIN - 0.01 && box.y + box.height / 2 <= height * (1 - MARGIN) + 0.01),
  };
}

/** All ordered partitions with at most three objects per row. */
function rowsFor(count: number): number[][] {
  if (!count) return [[]];
  return [1, 2, 3].filter(size => size <= count).flatMap(size => rowsFor(count - size).map(rest => [size, ...rest]));
}

function shelf(objects: NativeObject[], rows: number[], family: Family, rng: () => number): NativeObject[] {
  const placed: NativeObject[] = [];
  let index = 0, y = 0;
  for (const [rowIndex, count] of rows.entries()) {
    const row = objects.slice(index, index + count).map(item => ({ ...item }));
    index += count;
    const rowHeight = Math.max(...row.map(item => item.height));
    let x = 0;
    for (const [column, item] of row.entries()) {
      item.x = x + item.width / 2;
      item.y = y + rowHeight / 2;
      if (family === 'diagonal') item.y += (column - (count - 1) / 2) * rowHeight * 0.14;
      if (family === 'cascade') item.y += (rng() - 0.5) * rowHeight * 0.12;
      // Deliberate, limited overlap joins objects visually without covering them.
      const next = row[column + 1];
      x += item.width - (next ? Math.min(item.width, next.width) * (family === 'balanced' ? 0.015 : 0.09) : 0);
    }
    const rowBounds = union(row);
    for (const item of row) {
      item.x -= rowBounds.x;
      if (family === 'cascade') item.x += (rowIndex % 2 ? 1 : -1) * rowHeight * 0.12;
      placed.push(item);
    }
    y += rowHeight * (family === 'balanced' ? 1.04 : 0.97);
  }
  return placed;
}

function diagonal(objects: NativeObject[], direction: number): NativeObject[] {
  let x = 0, y = 0;
  return objects.map((item, index) => {
    const previous = objects[index - 1];
    if (previous) {
      x += direction * ((previous.width + item.width) / 2 - Math.min(previous.width, item.width) * 0.32);
      y += (previous.height + item.height) / 2 - Math.min(previous.height, item.height) * 0.36;
    }
    return { ...item, x, y };
  });
}

function fit(catalog: Catalog, base: Scene, native: NativeObject[]): Scene | null {
  const bounds = union(native);
  const { width, height } = canvasSize(catalog, base);
  const frameWidth = catalog.sizes[base.size].referenceFrame.width;
  const fittingScale = Math.min(width * (1 - 2 * MARGIN) / bounds.width, height * (1 - 2 * MARGIN) / bounds.height);
  const requestedScale = fittingScale * frameWidth / Math.min(width, height);
  if (requestedScale < 0.15) return null;
  const commonScale = Math.min(1.5, requestedScale);
  const actualScale = commonScale * Math.min(width, height) / frameWidth;
  const positions = new Map(native.map(item => [item.object.instanceId, {
    ...item.object,
    x: 0.5 + (item.x - bounds.x) * actualScale / width,
    y: 0.5 + (item.y - bounds.y) * actualScale / height,
  }]));
  // Keep source order within each role; monochrome objects always sit behind main ones.
  return { ...base, compositionScale: commonScale, objects: [
    ...base.objects.filter(item => item.role === 'secondary'), ...base.objects.filter(item => item.role === 'main'),
  ].map(item => positions.get(item.instanceId)!) };
}

function supportingObject(catalog: Catalog, scene: Scene, seed: number): SceneObject | null {
  const present = new Set(scene.objects.map(item => item.objectId));
  const related: Record<string, string[]> = {
    book: ['pen', 'lamp', 'folder'], phone: ['puzzle', 'headphones', 'coin'], wallet: ['coin', 'phone'],
    coin: ['wallet', 'phone'], headphones: ['phone', 'flower-vase'], puzzle: ['phone', 'pen'],
    folder: ['pen', 'book'], pen: ['folder', 'book'], lamp: ['book', 'pen'], 'flower-vase': ['book', 'headphones'],
  };
  const candidates = [...new Set(scene.objects.flatMap(item => related[item.objectId] ?? []))]
    .filter(id => !present.has(id) && catalog.objects.some(item => item.id === id));
  if (!candidates.length) return null;
  const objectId = candidates[Math.abs(seed) % candidates.length]!;
  let instanceId = `auto-support-${seed >>> 0}-${objectId}`;
  while (scene.objects.some(object => object.instanceId === instanceId)) instanceId += '-x';
  return { instanceId, objectId, role: 'secondary', x: 0.5, y: 0.5, rotation: 0 };
}

export function generateLayouts(catalog: Catalog, base: Scene, options: { seed?: number; includeBackgroundObjects?: boolean } = {}): LayoutVariant[] {
  validateScene(base, catalog);
  if (!base.objects.length) throw new Error('Выберите хотя бы один предмет для композиции');
  if (base.objects.length > MAX_LAYOUT_OBJECTS) throw new Error(`Для автосборки выберите не более ${MAX_LAYOUT_OBJECTS} предметов`);
  if (!base.objects.some(object => object.role === 'main')) throw new Error('Для автосборки нужен хотя бы один главный предмет');
  const seed = options.seed ?? 0;
  if (!Number.isSafeInteger(seed)) throw new Error('Неверный номер варианта');
  let source = { ...base, objects: base.objects.map(object => ({ ...object })) };
  const support = options.includeBackgroundObjects && source.objects.length < MAX_LAYOUT_OBJECTS ? supportingObject(catalog, source, seed) : null;
  if (support) source = { ...source, objects: [support, ...source.objects] };
  const layoutOrder = [...source.objects].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'main' ? -1 : 1;
    const aa = selectObject(catalog, a.objectId, base.size, a.role), bb = selectObject(catalog, b.objectId, base.size, b.role);
    return bb.width * bb.height - aa.width * aa.height;
  });
  const variants: LayoutVariant[] = [];
  for (const [familyIndex, family] of (['diagonal', 'balanced', 'cascade'] as const).entries()) {
    const rng = random(seed * 997 + familyIndex * 311 + 13);
    const candidates: { scene: Scene; metrics: LayoutMetrics; score: number }[] = [];
    for (let permutation = 0; permutation < 3; permutation++) {
      const order = [...layoutOrder];
      if (permutation === 1) order.reverse();
      if (permutation === 2 && order.length > 2) order.push(order.shift()!);
      const native = order.map((object, index) => {
        const rotation = family === 'balanced' ? 0 : Math.round((family === 'diagonal' ? (index % 2 ? 1 : -1) * 5 : (index % 2 ? -1 : 1) * 10) + (rng() - 0.5) * 6);
        const asset = selectObject(catalog, object.objectId, source.size, object.role);
        return { object: { ...object, rotation }, ...rotatedDimensions(asset.width, asset.height, rotation), x: 0, y: 0 };
      });
      const placements = family === 'diagonal' && order.length >= 2 && order.length <= 3
        ? [diagonal(native, seed % 2 ? -1 : 1)]
        : rowsFor(order.length).map(rows => shelf(native, rows, family, rng));
      for (const placed of placements) {
        const scene = fit(catalog, source, placed);
        if (!scene) continue;
        const metrics = measureLayout(catalog, scene);
        if (!metrics.insideCanvas || metrics.maxOverlap > MAX_OVERLAP) continue;
        const positionDifference = variants.length ? Math.min(...variants.map(previous => scene.objects.reduce((sum, object) => {
          const other = previous.scene.objects.find(item => item.instanceId === object.instanceId)!;
          return sum + Math.hypot(object.x - other.x, object.y - other.y);
        }, 0) / scene.objects.length)) : 0;
        // Prefer a useful visual footprint, with distinct positions in later alternatives.
        const score = metrics.occupancy - metrics.maxOverlap * 0.4 + Math.min(0.25, positionDifference) * 0.6 + rng() * 0.018;
        candidates.push({ scene, metrics, score });
      }
    }
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best) throw new Error('Предметы не помещаются с сохранением пропорций. Уменьшите их количество.');
    validateScene(best.scene, catalog);
    variants.push({ id: `layout-${seed >>> 0}-${family}`, ...DETAILS[family], scene: best.scene, metrics: best.metrics, addedObjectIds: support ? [support.objectId] : [] });
  }
  return variants;
}

export function objectsFromNames(catalog: Catalog, text: string, roles: Record<string, ObjectRole> = {}): SceneObject[] {
  const parsed = parseObjectNames(catalog, text);
  if (parsed.unknown.length) throw new Error('Не найдены в библиотеке: ' + [...new Set(parsed.unknown)].join(', '));
  return parsed.objectIds.map((objectId, index) => ({ instanceId: `auto-choice-${index}-${objectId}`, objectId, role: roles[`auto-choice-${index}-${objectId}`] ?? 'main', x: 0.5, y: 0.5, rotation: 0 }));
}
