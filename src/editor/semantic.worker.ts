import { pipeline, env } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { SEMANTIC_MODEL, SEMANTIC_REVISION, chooseSuggestion, type SemanticDocument } from './semantic.js';

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (value: unknown) => void };
env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
const createExtractor = pipeline as unknown as (task: 'feature-extraction', model: string, options: Record<string, unknown>) => Promise<FeatureExtractionPipeline>;
let extractor: Promise<FeatureExtractionPipeline> | undefined;
let indexKey = '';
let embeddings: number[][] = [];
let busy = false;
scope.onmessage = async (event: MessageEvent<{ prompt: string; documents: SemanticDocument[]; allowed: string[]; excluded: string[] }>) => {
  if (busy) return;
  busy = true;
  try {
    const { prompt, documents, allowed, excluded } = event.data;
    if (prompt.length > 300 || documents.length > 40) throw new Error('Слишком большой запрос');
    extractor ??= createExtractor('feature-extraction', SEMANTIC_MODEL, { revision: SEMANTIC_REVISION, dtype: 'q8', device: 'wasm', progress_callback: (progress: { status: string; file?: string; progress?: number }) => {
      if (progress.status === 'progress') scope.postMessage({ type: 'progress', text: progress.file?.endsWith('.onnx') ? `Загрузка модели: ${Math.round(progress.progress ?? 0)}%` : 'Подготавливаем языковые данные…' });
    } });
    const model = await extractor;
    const key = JSON.stringify(documents);
    if (indexKey !== key) {
      scope.postMessage({ type: 'progress', text: 'Сопоставляем описания предметов…' });
      embeddings = (await model(documents.map(item => item.text), { pooling: 'mean', normalize: true })).tolist() as number[][];
      indexKey = key;
    }
    const query = (await model(prompt, { pooling: 'mean', normalize: true })).tolist()[0] as number[];
    const scores = documents.map((document, index) => ({ id: document.id, score: query.reduce((sum, value, i) => sum + value * embeddings[index]![i]!, 0) }));
    scope.postMessage({ type: 'result', suggestion: chooseSuggestion(scores, allowed, excluded) });
  } catch (error) {
    extractor = undefined;
    scope.postMessage({ type: 'error', text: error instanceof Error ? error.message : 'Модель недоступна' });
  } finally { busy = false; }
};
