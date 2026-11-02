import { useEffect, useRef, useState } from 'react';
import type { CustomObject } from '../library/custom.js';

export function CustomObjectDialog({ object, onSave, onClose }: { object: CustomObject; onSave: (value: CustomObject) => void; onClose: () => void }) {
  const [name, setName] = useState(object.name);
  const [tags, setTags] = useState(object.tags.join(', '));
  const [meanings, setMeanings] = useState(object.meanings.join(', '));
  const [error, setError] = useState('');
  const dialog = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector('input')?.focus();
    return () => previous?.focus();
  }, []);
  const list = (value: string) => [...new Set(value.split(/[,;\n]/).map(word => word.trim()).filter(Boolean))];
  return <div className="modal-backdrop" onClick={onClose}><form ref={dialog} className="custom-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-title" onClick={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('input,textarea,button'));
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  }} onSubmit={event => {
    event.preventDefault();
    const next = { ...object, name: name.trim(), tags: list(tags), meanings: list(meanings) };
    if (!next.name || [next.tags, next.meanings].some(items => items.length > 30 || items.some(item => item.length > 120))) { setError('Укажите название. До 30 тегов и смыслов, каждый до 120 символов.'); return; }
    onSave(next);
  }}>
    <h2 id="custom-title">Смыслы вашего SVG</h2>
    <p>Опишите, что изображено и какие идеи передаёт предмет. По этим словам мы подберём его к фразе.</p>
    <label>Название<input aria-label="Название своего SVG" value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></label>
    <label>Теги — что изображено<textarea aria-label="Теги своего SVG" value={tags} maxLength={3600} rows={2} placeholder="лестница, ступени, движение вверх" onChange={event => setTags(event.target.value)} /></label>
    <label>Смыслы и метафоры<textarea aria-label="Смыслы своего SVG" value={meanings} maxLength={3600} rows={3} placeholder="рост, развитие, карьера, путь к успеху" onChange={event => setMeanings(event.target.value)} /></label>
    <p>Разделяйте записи запятыми или новой строкой. Целая фраза считается одним сочетанием. Без описания предмет находится только по названию.</p>
    <p>Исходные цвета сохраняются. Один SVG используется в S/L и обеих ролях. Текст лучше заранее перевести в контуры.</p>
    {error && <p role="alert">{error}</p>}
    <div className="custom-dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Закрыть</button><button className="button primary" type="submit">Сохранить смыслы</button></div>
  </form></div>;
}
