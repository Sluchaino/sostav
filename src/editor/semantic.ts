import type { Catalog } from '../library/types.js';

export const SEMANTIC_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const SEMANTIC_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
export const SUGGESTION_THRESHOLD = 0.425;
export const SUGGESTION_MARGIN = 0.05;
export interface SemanticDocument { id: string; text: string }
export interface SemanticSuggestion { objectId: string; score: number; margin: number }
const BASE_MEANINGS: Record<string, string[]> = {
  "flower-vase": [
    "забота и уют",
    "подарок",
    "красота"
  ],
  "book": [
    "обучение и знания",
    "личное развитие",
    "освоение нового"
  ],
  "wallet": [
    "личные финансы и оплата",
    "накопление средств"
  ],
  "lamp": [
    "идеи и вдохновение",
    "озарение",
    "концентрация"
  ],
  "coin": [
    "деньги и сбережения",
    "ценность и защита накоплений"
  ],
  "headphones": [
    "музыка и прослушивание",
    "отдых",
    "личное пространство и концентрация"
  ],
  "puzzle": [
    "решение из частей",
    "совместная работа",
    "взаимопонимание"
  ],
  "folder": [
    "порядок и организация документов",
    "рабочие материалы"
  ],
  "pen": [
    "записи и выражение мыслей",
    "работа с текстами"
  ],
  "phone": [
    "общение на расстоянии",
    "цифровые сервисы",
    "онлайн-доступ"
  ]
};

export function semanticDocuments(catalog: Catalog): SemanticDocument[] {
  return catalog.objects.map(object => {
    const meanings = object.custom ? object.meanings ?? [] : BASE_MEANINGS[object.id] ?? [];
    const tags = object.custom ? object.tags.filter(tag => !meanings.includes(tag)) : object.tags;
    return { id: object.id, text: `${object.name}. ${tags.join(', ')}. ${meanings.join(', ')}.` };
  });
}

/** Index the complete available library before applying exclusions or the UI library filter. */
export function chooseSuggestion(scores: { id: string; score: number }[], allowed: string[], excluded: string[]): SemanticSuggestion | null {
  const ranks = scores.filter(item => allowed.includes(item.id) && !excluded.includes(item.id) && Number.isFinite(item.score))
    .sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
  const first = ranks[0];
  if (!first) return null;
  const margin = first.score - (ranks[1]?.score ?? -1);
  return first.score >= SUGGESTION_THRESHOLD && margin >= SUGGESTION_MARGIN ? { objectId: first.id, score: first.score, margin } : null;
}
