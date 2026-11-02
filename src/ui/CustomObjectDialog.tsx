import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { customLibrary, readCustomSvg, type CustomObject } from '../library/custom.js';
import type { Catalog, ColorRole, Palette } from '../library/types.js';
import { preparedSvg } from '../editor/svg.js';

function ColorPreview({ object, catalog, palette, original = false }: { object: CustomObject; catalog: Catalog; palette: Palette; original?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const markup = useMemo(() => {
    const source = original ? { ...object, paintRoles: {} } : object;
    const asset = customLibrary(catalog, [source]).objects.find(item => item.id === source.id)!.variants.L.main;
    const root = preparedSvg(catalog, asset, readCustomSvg(source.svg).svg, palette, 'object', 'colors-' + id);
    root.setAttribute('width', '100%'); root.setAttribute('height', '100%');
    return new XMLSerializer().serializeToString(root);
  }, [object, catalog, palette, original, id]);
  return <div className="custom-color-preview" aria-label={original ? 'Исходный SVG' : 'SVG в выбранной палитре'} dangerouslySetInnerHTML={{ __html: markup }} />;
}

export function CustomObjectDialog({ object, catalog, palettes, paletteId, onSave, onClose }: { object: CustomObject; catalog: Catalog; palettes: Palette[]; paletteId: string; onSave: (value: CustomObject) => void; onClose: () => void }) {
  const [name, setName] = useState(object.name);
  const [tags, setTags] = useState(object.tags.join(', '));
  const [meanings, setMeanings] = useState(object.meanings.join(', '));
  const [error, setError] = useState('');
  const [paintRoles, setPaintRoles] = useState<Record<string, ColorRole>>(object.paintRoles ?? {});
  const [previewPaletteId, setPreviewPaletteId] = useState(paletteId);
  const previewPalette = palettes.find(item => item.id === previewPaletteId) ?? palettes[0]!;
  const parsed = useMemo(() => readCustomSvg(object.svg), [object.svg]);
  const previewObject = useMemo(() => ({ ...object, paintRoles }), [object, paintRoles]);
  const roles = (Object.keys(catalog.colorRoles) as ColorRole[]).filter(role => catalog.colorRoles[role].targets.includes('object'));
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
      const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('input,textarea,select,button'));
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  }} onSubmit={event => {
    event.preventDefault();
    const next = { ...object, name: name.trim(), tags: list(tags), meanings: list(meanings), paintRoles };
    if (!next.name || [next.tags, next.meanings].some(items => items.length > 30 || items.some(item => item.length > 120))) { setError('Укажите название. До 30 тегов и смыслов, каждый до 120 символов.'); return; }
    onSave(next);
  }}>
    <h2 id="custom-title">Смыслы вашего SVG</h2>
    <p>Опишите, что изображено и какие идеи передаёт предмет. По этим словам мы подберём его к фразе.</p>
    <label>Название<input aria-label="Название своего SVG" value={name} maxLength={80} required onChange={event => setName(event.target.value)} /></label>
    <label>Теги — что изображено<textarea aria-label="Теги своего SVG" value={tags} maxLength={3600} rows={2} placeholder="лестница, ступени, движение вверх" onChange={event => setTags(event.target.value)} /></label>
    <label>Смыслы и метафоры<textarea aria-label="Смыслы своего SVG" value={meanings} maxLength={3600} rows={3} placeholder="рост, развитие, карьера, путь к успеху" onChange={event => setMeanings(event.target.value)} /></label>
    <p>Разделяйте записи запятыми или новой строкой. Целая фраза считается одним сочетанием. Без описания предмет находится только по названию.</p>
    <section className="custom-colors" aria-label="Настройка цветов SVG">
      <h3>Цвета</h3><p>Назначьте цветам роли палитры. «Оставить исходный» сохраняет цвет. Прозрачность и контуры не меняются.</p>
      <label>Палитра предпросмотра<select aria-label="Палитра предпросмотра" value={previewPalette.id} onChange={event => setPreviewPaletteId(event.target.value)}>{palettes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="custom-preview-pair"><figure><ColorPreview object={object} catalog={catalog} palette={previewPalette} original /><figcaption>Исходный</figcaption></figure><figure><ColorPreview object={previewObject} catalog={catalog} palette={previewPalette} /><figcaption>С назначенными ролями</figcaption></figure></div>
      <p>Предпросмотр не переключает палитру сцены. После сохранения назначенные роли используют палитру композиции.</p>
      <div className="custom-color-list">{parsed.colors.map(color => <label className="custom-color-row" key={color}><span className="custom-color-source"><i style={{ backgroundColor: color }} /><code>{color}</code></span><select aria-label={`Роль цвета ${color}`} value={paintRoles[color] ?? ''} onChange={event => setPaintRoles(current => { const next = { ...current }; if (event.target.value) next[color] = event.target.value as ColorRole; else delete next[color]; return next; })}><option value="">Оставить исходный</option>{roles.map(role => <option key={role} value={role}>{catalog.colorRoles[role].label}</option>)}</select><i className="custom-color-result" title="Результат" style={{ backgroundColor: paintRoles[color] ? previewPalette.colors[paintRoles[color]!] + (color.length === 9 ? color.slice(7) : '') : color }} /></label>)}</div>
      {!!parsed.unsupportedPaints.length && <p role="status">Эти записи сохраняются без перекраски: {parsed.unsupportedPaints.join(', ')}. Для назначения используйте HEX, rgb/rgba или основные имена цветов.</p>}
      {!parsed.colors.length && <p>Не найдены цвета для назначения.</p>}
      <button className="button secondary" type="button" disabled={!Object.keys(paintRoles).length} onClick={() => setPaintRoles({})}>Сбросить назначения цветов</button>
    </section>
    <p>Один SVG используется в S/L и обеих ролях. Назначение цветов общее для обеих ролей. Текст лучше заранее перевести в контуры.</p>
    {error && <p role="alert">{error}</p>}
    <div className="custom-dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Закрыть</button><button className="button primary" type="submit">Сохранить настройки</button></div>
  </form></div>;
}
