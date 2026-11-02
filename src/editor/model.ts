import type { Catalog, IllustrationSize, ObjectRole, Palette } from '../library/types.js';
import { validatePalette } from '../library/index.js';
import { customLibrary, validateCustomObjects, type CustomObject } from '../library/custom.js';
import { validateMeaningResult, type MeaningResult } from './meaning.js';

export interface SceneObject {
  instanceId: string;
  objectId: string;
  role: ObjectRole;
  /** Positions are fractions of the output canvas, independent of SVG source units. */
  x: number;
  y: number;
  rotation: number;
}

export interface Scene {
  customObjects?: CustomObject[];
  version: 1;
  name: string;
  size: IllustrationSize;
  formatId: string;
  paletteId: string;
  customPalettes: Palette[];
  compositionScale: number;
  backgroundVisible: boolean;
  objects: SceneObject[];
  /** Selection provenance, retained when manually editing the resulting scene. */
  interpretation?: MeaningResult;
}

export type ExampleId = 'learning' | 'finance' | 'music';
export const EXAMPLES: { id: ExampleId; name: string; description: string }[] = [
  { id: 'learning', name: 'Обучение онлайн', description: 'Книга + телефон' },
  { id: 'finance', name: 'Безопасные покупки', description: 'Кошелёк + монета' },
  { id: 'music', name: 'Время для себя', description: 'Наушники + цветы' },
];

export function createBlankScene(): Scene {
  return { version: 1, name: 'Новая иллюстрация', size: 'L', formatId: 'square', paletteId: 'violet', customPalettes: [], compositionScale: 0.58, backgroundVisible: true, objects: [] };
}

export function createExample(id: ExampleId): Scene {
  const scene = createBlankScene();
  if (id === 'learning') return { ...scene, name: 'Обучение онлайн', objects: [
    { instanceId: 'example-book', objectId: 'book', role: 'main', x: 0.44, y: 0.4, rotation: -7 },
    { instanceId: 'example-phone', objectId: 'phone', role: 'main', x: 0.63, y: 0.66, rotation: 6 },
  ] };
  if (id === 'finance') return { ...scene, name: 'Безопасные покупки', formatId: 'landscape', paletteId: 'peach', compositionScale: 0.85, objects: [
    { instanceId: 'example-phone', objectId: 'phone', role: 'secondary', x: 0.64, y: 0.3, rotation: -9 },
    { instanceId: 'example-wallet', objectId: 'wallet', role: 'main', x: 0.4, y: 0.59, rotation: -5 },
    { instanceId: 'example-coin', objectId: 'coin', role: 'main', x: 0.76, y: 0.74, rotation: 6 },
  ] };
  return { ...scene, name: 'Время для себя', formatId: 'portrait', paletteId: 'aqua', objects: [
    { instanceId: 'example-vase', objectId: 'flower-vase', role: 'secondary', x: 0.7, y: 0.35, rotation: 0 },
    { instanceId: 'example-headphones', objectId: 'headphones', role: 'main', x: 0.43, y: 0.59, rotation: -8 },
  ] };
}

export function canvasSize(catalog: Catalog, scene: Scene) {
  const format = catalog.formats.find(item => item.id === scene.formatId);
  if (!format) throw new Error('Неизвестный формат холста');
  return { width: format.width, height: format.height };
}

export function activePalette(catalog: Catalog, scene: Scene): Palette {
  const palette = [...catalog.palettes, ...scene.customPalettes].find(item => item.id === scene.paletteId);
  if (!palette) throw new Error('Цветовая схема не найдена');
  return palette;
}

export function compositionScale(catalog: Catalog, scene: Scene): number {
  const { width, height } = canvasSize(catalog, scene);
  return Math.min(width, height) / catalog.sizes[scene.size].referenceFrame.width * scene.compositionScale;
}

export function objectTransform(catalog: Catalog, scene: Scene, object: SceneObject): string {
  const { width, height } = canvasSize(catalog, scene);
  return `translate(${object.x * width} ${object.y * height}) rotate(${object.rotation}) scale(${compositionScale(catalog, scene)})`;
}

export function moveLayer(scene: Scene, instanceId: string, direction: -1 | 1): Scene {
  const index = scene.objects.findIndex(item => item.instanceId === instanceId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= scene.objects.length) return scene;
  const objects = [...scene.objects];
  [objects[index], objects[next]] = [objects[next]!, objects[index]!];
  return { ...scene, objects };
}

export function validateScene(value: unknown, catalog: Catalog): asserts value is Scene {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Файл должен содержать проект конструктора');
  const scene = value as Partial<Scene>;
  if (scene.customObjects !== undefined) {
    validateCustomObjects(scene.customObjects, catalog);
    catalog = customLibrary(catalog, scene.customObjects);
  }
  if (scene.version !== 1 || typeof scene.name !== 'string' || !scene.name.trim() || scene.name.length > 120) throw new Error('Неверная версия или название проекта');
  if (scene.interpretation !== undefined) validateMeaningResult(scene.interpretation, catalog);
  if (scene.size !== 'S' && scene.size !== 'L') throw new Error('Неизвестный размер иллюстрации');
  if (!catalog.formats.some(item => item.id === scene.formatId)) throw new Error('Неизвестный формат холста');
  if (typeof scene.compositionScale !== 'number' || !Number.isFinite(scene.compositionScale) || scene.compositionScale < 0.15 || scene.compositionScale > 1.5) throw new Error('Недопустимый масштаб композиции');
  if (typeof scene.backgroundVisible !== 'boolean') throw new Error('Неверная настройка фона');
  if (!Array.isArray(scene.customPalettes) || scene.customPalettes.length > 50) throw new Error('Неверный список палитр');
  const paletteIds = new Set(catalog.palettes.map(item => item.id));
  for (const palette of scene.customPalettes) {
    validatePalette(catalog, palette);
    if (paletteIds.has(palette.id)) throw new Error('Повторяющийся идентификатор палитры');
    paletteIds.add(palette.id);
  }
  if (typeof scene.paletteId !== 'string' || !paletteIds.has(scene.paletteId)) throw new Error('Палитра проекта не найдена');
  if (!Array.isArray(scene.objects) || scene.objects.length > 100) throw new Error('Допускается не более 100 объектов');
  const ids = new Set();
  for (const object of scene.objects) {
    if (!object || typeof object !== 'object') throw new Error('Неверный объект сцены');
    if (typeof object.instanceId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(object.instanceId) || ids.has(object.instanceId)) throw new Error('Неверный или повторяющийся ID объекта');
    ids.add(object.instanceId);
    if (!catalog.objects.some(item => item.id === object.objectId)) throw new Error('В проекте есть неизвестный предмет');
    if (object.role !== 'main' && object.role !== 'secondary') throw new Error('Неизвестная роль предмета');
    for (const coordinate of [object.x, object.y, object.rotation]) if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) throw new Error('Неверные координаты предмета');
    if (Math.abs(object.x) > 10 || Math.abs(object.y) > 10 || Math.abs(object.rotation) > 360) throw new Error('Координаты предмета за пределами допустимых значений');
  }
}

export interface History<T> { past: T[]; present: T; future: T[] }
export type HistoryAction<T> = { type: 'commit'; value: T } | { type: 'undo' } | { type: 'redo' };
export function reduceHistory<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  if (action.type === 'commit') {
    if (JSON.stringify(action.value) === JSON.stringify(state.present)) return state;
    return { past: [...state.past, state.present].slice(-60), present: action.value, future: [] };
  }
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] };
  }
  if (!state.future.length) return state;
  return { past: [...state.past, state.present], present: state.future[0]!, future: state.future.slice(1) };
}
