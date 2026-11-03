import type { Catalog, ObjectRole } from '../library/types.js';
import type { Scene } from './model.js';

export interface ReviewedItem { objectId: string; role: ObjectRole; reason: string; origin: 'rules' | 'manual' }
export interface SelectionReview {
  prompt: string;
  items: ReviewedItem[];
}

/** Provenance describes an earlier choice; current canvas objects are authoritative. */
export function reviewFromScene(scene: Scene): ReviewedItem[] | null {
  if (new Set(scene.objects.map(item => item.objectId)).size !== scene.objects.length || scene.objects.length > 6) return null;
  if (!scene.objects.length && !scene.selectionReview && !scene.interpretation) return null;
  return scene.objects.map(object => {
    const previous = scene.selectionReview?.items.find(item => item.objectId === object.objectId)
      ?? scene.interpretation?.items.find(item => item.objectId === object.objectId);
    if (previous?.role === object.role) return { objectId: object.objectId, role: object.role, reason: previous.reason, origin: 'origin' in previous ? previous.origin : 'rules' };
    return { objectId: object.objectId, role: object.role, origin: 'manual', reason: 'Вы изменили состав или роль предмета в редакторе.' };
  });
}

export function reviewWithSupport(items: ReviewedItem[], suggested: ReviewedItem[], enabled: boolean): ReviewedItem[] {
  const next = items.filter(item => enabled || item.origin !== 'rules' || item.role !== 'secondary');
  if (enabled) for (const item of suggested) {
    if (next.length < 6 && item.role === 'secondary' && !next.some(current => current.objectId === item.objectId)) next.push({ ...item });
  }
  return next;
}
export function editReview(items: ReviewedItem[], action: { type: 'add' | 'replace'; objectId: string; previousId?: string } | { type: 'remove'; objectId: string } | { type: 'role'; objectId: string; role: ObjectRole }, catalog: Catalog, excluded: string[] = []): ReviewedItem[] {
  if (action.type === 'remove') return items.filter(item => item.objectId !== action.objectId);
  if (action.type === 'role') return items.map(item => item.objectId === action.objectId && item.role !== action.role ? { ...item, role: action.role, origin: 'manual', reason: 'Вы назначили роль предмета вручную.' } : item);
  if (!catalog.objects.some(item => item.id === action.objectId) || excluded.includes(action.objectId)) throw new Error('Предмет недоступен или исключён по фразе');
  if (items.some(item => item.objectId === action.objectId)) throw new Error('Этот предмет уже выбран');
  const next: ReviewedItem = { objectId: action.objectId, role: 'main', reason: 'Вы выбрали этот предмет вручную.', origin: 'manual' };
  if (action.type === 'add') {
    if (items.length >= 6) throw new Error('Для автокомпозиции можно выбрать до шести предметов');
    return [...items, next];
  }
  if (!items.some(item => item.objectId === action.previousId)) throw new Error('Предмет для замены не найден');
  return items.map(item => item.objectId === action.previousId ? { ...next, role: item.role } : item);
}
export function validateSelectionReview(value: unknown, catalog: Catalog): asserts value is SelectionReview {
  if (!value || typeof value !== 'object') throw new Error('Неверное подтверждение подбора');
  const review = value as SelectionReview;
  if (typeof review.prompt !== 'string' || review.prompt.trim().length < 2 || review.prompt.length > 300 || !Array.isArray(review.items) || !review.items.length || review.items.length > 6) throw new Error('Неверный состав подтверждённого подбора');
  const ids = new Set<string>();
  for (const item of review.items) {
    if (!item || !catalog.objects.some(object => object.id === item.objectId) || ids.has(item.objectId) || !['main','secondary'].includes(item.role) || !['rules','manual'].includes(item.origin) || typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 1000) throw new Error('Неверный предмет подтверждённого подбора');
    ids.add(item.objectId);
  }
}
