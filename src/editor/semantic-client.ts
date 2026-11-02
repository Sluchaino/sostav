import type { SemanticDocument, SemanticSuggestion } from './semantic.js';

export class SuggestionClient {
  private worker: Worker | null = null;
  private reject: ((reason: Error) => void) | null = null;
  cancel() {
    this.worker?.terminate(); this.worker = null;
    this.reject?.(new Error('Запрос отменён')); this.reject = null;
  }
  async suggest(input: { prompt: string; documents: SemanticDocument[]; allowed: string[]; excluded: string[] }, onProgress: (text: string) => void): Promise<SemanticSuggestion | null> {
    this.cancel();
    this.worker = new Worker(new URL('./semantic.worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const finish = () => { clearTimeout(timer); this.reject = null; };
      const timer = setTimeout(() => { finish(); worker.terminate(); this.worker = null; reject(new Error('Модель загружается слишком долго. Повторите запрос или выберите предмет вручную.')); }, 180_000);
      // Cancellation also clears the timeout and keeps stale responses out of the dialog.
      this.reject = error => { finish(); reject(error); };
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.type === 'progress') onProgress(message.text);
        else if (message.type === 'result') { finish(); resolve(message.suggestion); }
        else if (message.type === 'error') { finish(); reject(new Error('Не удалось запустить модель. Проверьте интернет и попробуйте ещё раз; ручной выбор доступен.')); }
      };
      worker.onerror = () => { finish(); reject(new Error('Браузер не смог запустить модель. Выберите предмет вручную или повторите запрос.')); };
      worker.postMessage(input);
    });
  }
}
