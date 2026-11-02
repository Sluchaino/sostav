import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Layers3, Plus, RefreshCw, Shapes, Sparkles, X } from 'lucide-react';
import type { Catalog, ObjectRole } from '../library/types.js';
import { generateLayouts, MAX_LAYOUT_OBJECTS, objectsFromNames, parseObjectNames, type LayoutVariant } from '../editor/layout.js';
import { exportSvg, type AssetTexts } from '../editor/svg.js';
import type { Scene } from '../editor/model.js';

function VariantPreview({ catalog, texts, variant }: { catalog: Catalog; texts: AssetTexts; variant: LayoutVariant }) {
  const markup = useMemo(() => {
    const svg = exportSvg(catalog, texts, variant.scene, `preview-${variant.id}-`);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    doc.documentElement.setAttribute('width', '100%');
    doc.documentElement.setAttribute('height', '100%');
    return new XMLSerializer().serializeToString(doc.documentElement);
  }, [catalog, texts, variant]);
  return <span className="variant-artwork" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}

export function AutoComposeDialog({ catalog, texts, scene, onApply, onClose }: { catalog: Catalog; texts: AssetTexts; scene: Scene; onApply: (scene: Scene) => void; onClose: () => void }) {
  const [source, setSource] = useState<'canvas' | 'names'>(scene.objects.length ? 'canvas' : 'names');
  const [names, setNames] = useState(scene.objects.map(object => catalog.objects.find(item => item.id === object.objectId)!.name).join(', '));
  const [roles, setRoles] = useState<Record<string, ObjectRole>>(() => Object.fromEntries(scene.objects.flatMap((object, index) => [[object.instanceId, object.role], [`auto-choice-${index}-${object.objectId}`, object.role]])));
  const [support, setSupport] = useState(false);
  const [variants, setVariants] = useState<LayoutVariant[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [seed, setSeed] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const parsed = useMemo(() => parseObjectNames(catalog, names), [catalog, names]);
  const objects = useMemo(() => source === 'canvas'
    ? scene.objects.map(object => ({ ...object, role: roles[object.instanceId] ?? object.role }))
    : parsed.objectIds.map((objectId, index) => ({ instanceId: `auto-choice-${index}-${objectId}`, objectId, role: roles[`auto-choice-${index}-${objectId}`] ?? 'main', x: 0.5, y: 0.5, rotation: 0 })), [source, scene.objects, roles, parsed]);
  const activeVariant = variants[selected];
  const mainCount = objects.filter(object => object.role === 'main').length;

  useEffect(() => { if (objects.length >= MAX_LAYOUT_OBJECTS) setSupport(false); }, [objects.length]);

  useEffect(() => {
    dialog.current?.focus();
    const previous = previousFocus.current;
    return () => { previous?.focus(); };
  }, []);

  function invalidate() { setDirty(true); setError(''); }
  function chooseObject(id: string) {
    const selected = parsed.objectIds.includes(id);
    const ids = selected ? parsed.objectIds.filter(objectId => objectId !== id) : [...parsed.objectIds, id];
    setNames([...ids.map(objectId => catalog.objects.find(item => item.id === objectId)!.name), ...parsed.unknown].join(', '));
    invalidate();
  }
  function generate() {
    try {
      const selectedObjects = source === 'names' ? objectsFromNames(catalog, names, roles) : objects;
      const base: Scene = { ...scene, name: scene.name.trim() || 'Новая иллюстрация', objects: selectedObjects };
      const result = generateLayouts(catalog, base, { seed, includeBackgroundObjects: support });
      setVariants(result); setSelected(0); setError(''); setDirty(false); setSeed(seed + 1);
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось собрать композицию'); setDirty(true); }
  }

  return <div className="modal-backdrop auto-backdrop" onClick={onClose}>
    <section className="auto-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="auto-dialog-title" onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,select,input,[tabindex="0"]')).filter(element => element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="auto-header"><div><span className="eyebrow">АВТОКОМПОЗИЦИЯ</span><h2 id="auto-dialog-title">Выберите предметы. Мы найдём им место<span>.</span></h2><p>Три расположения из ваших исходных векторов.</p></div><button className="icon-button" aria-label="Закрыть автосборку" onClick={onClose}><X size={20} /></button></header>
      <div className="auto-body">
        <div className="auto-inputs">
          <div className="auto-source" aria-label="Источник предметов"><button aria-pressed={source === 'canvas'} className={source === 'canvas' ? 'active' : ''} onClick={() => { setSource('canvas'); invalidate(); }}><Layers3 size={14} />На холсте</button><button aria-pressed={source === 'names'} className={source === 'names' ? 'active' : ''} onClick={() => { setSource('names'); invalidate(); }}><Shapes size={14} />По названиям</button></div>
          {source === 'names' && <><label className="auto-input-label" htmlFor="auto-names">Какие предметы нужны?</label><textarea id="auto-names" aria-label="Названия предметов для автосборки" placeholder="Например: книга, телефон, ручка" value={names} onChange={event => { setNames(event.target.value); invalidate(); }} rows={3} maxLength={500} /><div className="auto-object-chips">{catalog.objects.map(object => <button key={object.id} aria-pressed={parsed.objectIds.includes(object.id)} className={parsed.objectIds.includes(object.id) ? 'active' : ''} onClick={() => chooseObject(object.id)}>{parsed.objectIds.includes(object.id) ? <Check size={11} /> : <Plus size={11} />}{object.name}</button>)}</div></>}
          <div className="auto-selection-heading"><h3>Предметы композиции</h3><span className={objects.length > MAX_LAYOUT_OBJECTS ? 'over-limit' : ''}>{objects.length} / {MAX_LAYOUT_OBJECTS}</span></div>
          <div className="auto-selected-list">{objects.map(object => <label key={object.instanceId} className="auto-selected-object"><span className={`role-dot ${object.role}`} /><span>{catalog.objects.find(item => item.id === object.objectId)!.name}</span><select aria-label={`Роль: ${catalog.objects.find(item => item.id === object.objectId)!.name}`} value={object.role} onChange={event => { setRoles({ ...roles, [object.instanceId]: event.target.value as ObjectRole }); invalidate(); }}><option value="main">Главный</option><option value="secondary">Фоновый</option></select></label>)}{!objects.length && <p className="auto-empty-selection">{source === 'canvas' ? 'Холст пуст. Выберите предметы по названиям.' : 'Введите названия или нажмите на предметы выше.'}</p>}</div>
          <label className="auto-support"><input type="checkbox" checked={support} disabled={objects.length >= MAX_LAYOUT_OBJECTS} onChange={event => { setSupport(event.target.checked); invalidate(); }} /><span>Добавить фоновый предмет<small>Подберём дополнение из библиотеки</small></span></label>
          <p className="auto-rules">От одного до шести предметов, хотя бы один главный. Пропорции сохраняются, фоновые располагаются позади главных.</p>
          {source === 'names' && parsed.unknown.length > 0 && !error && <p className="auto-error" role="status">Нет в библиотеке: {[...new Set(parsed.unknown)].join(', ')}</p>}
          {error && <p className="auto-error" role="alert">{error}</p>}
          <button className="button primary generate-button" onClick={generate}><RefreshCw size={16} />{variants.length && !dirty ? 'Ещё варианты' : 'Получить варианты'}</button>
        </div>
        <div className="auto-results">
          <div className="auto-results-heading"><span>РАСПОЛОЖЕНИЯ</span><span>{scene.size} · {catalog.formats.find(format => format.id === scene.formatId)!.width} × {catalog.formats.find(format => format.id === scene.formatId)!.height}</span></div>
          {!variants.length ? <div className="auto-placeholder"><span><Sparkles size={32} /></span><h3>У одной идеи — несколько форм</h3><p>Выберите предметы слева и получите<br />три варианта композиции.</p><div><i /><i /><i /></div></div> : <>
            <div className={`variant-grid ${dirty ? 'stale' : ''}`}>{variants.map((variant, index) => <button className={`variant-card ${selected === index ? 'active' : ''}`} key={variant.id} aria-pressed={selected === index} aria-label={`Вариант: ${variant.name}`} onClick={() => setSelected(index)}><span className="variant-image"><VariantPreview catalog={catalog} texts={texts} variant={variant} /><span className="variant-number">0{index + 1}</span>{selected === index && <span className="variant-check"><Check size={13} /></span>}</span><strong>{variant.name}</strong><small>{variant.description}</small></button>)}</div>
            <div className="auto-result-note">{dirty ? 'Настройки изменились. Получите новые варианты перед применением.' : activeVariant?.addedObjectIds.length ? `Добавлен фоновый предмет: ${activeVariant.addedObjectIds.map(id => catalog.objects.find(item => item.id === id)!.name).join(', ')}.` : `${mainCount} главных · ${objects.length - mainCount} фоновых. Все предметы помещаются в холст.`}</div>
            <p className="auto-after-note">После выбора вы сможете переместить предметы, изменить цвета и скачать SVG.</p>
          </>}
          <div className="auto-result-footer"><span>Изменения применятся одним действием.<br />Их можно отменить через Ctrl+Z.</span><button className="button primary" disabled={!activeVariant || dirty} onClick={() => { if (activeVariant && !dirty) onApply(activeVariant.scene); }}>Открыть в редакторе<ArrowRight size={15} /></button></div>
        </div>
      </div>
    </section>
  </div>;
}
