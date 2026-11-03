import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Layers3, Plus, RefreshCw, Shapes, Sparkles, X } from 'lucide-react';
import type { Catalog, IllustrationSize, ObjectRole } from '../library/types.js';
import { searchObjects } from '../library/index.js';
import { editReview, reviewFromScene, reviewWithSupport, type ReviewedItem, type SelectionReview } from '../editor/selection.js';
import { generateLayouts, namedObjectKeys, objectNameToken, MAX_LAYOUT_OBJECTS, objectsFromNames, parseObjectNames, type LayoutVariant } from '../editor/layout.js';
import { exportSvg, preparedSvg, type AssetTexts } from '../editor/svg.js';
import { activePalette, canvasSize, type Scene } from '../editor/model.js';
import { selectObjectsByTheme, THEME_EXAMPLES, type MeaningResult } from '../editor/meaning.js';

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

function ObjectThumbnail({ catalog, texts, scene, objectId }: { catalog: Catalog; texts: AssetTexts; scene: Scene; objectId: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const markup = useMemo(() => {
    const asset = catalog.objects.find(object => object.id === objectId)!.variants[scene.size].main;
    const root = preparedSvg(catalog, asset, texts.get(asset.url)!, activePalette(catalog, scene), 'object', 'choice-' + id);
    root.setAttribute('width', '100%'); root.setAttribute('height', '100%');
    return new XMLSerializer().serializeToString(root);
  }, [catalog, texts, scene, objectId, id]);
  return <span className="choice-thumbnail" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}

export function AutoComposeDialog({ catalog, texts, scene, onApply, onClose }: { catalog: Catalog; texts: AssetTexts; scene: Scene; onApply: (scene: Scene) => void; onClose: () => void }) {
  const { width, height } = canvasSize(catalog, scene);
  const [initialReview] = useState(() => reviewFromScene(scene));
  const [source, setSource] = useState<'theme' | 'canvas' | 'names'>(scene.objects.length && initialReview === null ? 'canvas' : 'theme');
  const [size, setSize] = useState<IllustrationSize>(scene.size);
  const previewScene = useMemo(() => ({ ...scene, size }), [scene, size]);
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [theme, setTheme] = useState(scene.selectionReview?.prompt ?? scene.interpretation?.prompt ?? (scene.name === 'Новая иллюстрация' ? '' : scene.name));
  const [review, setReview] = useState<ReviewedItem[] | null>(initialReview);
  const [choiceQuery, setChoiceQuery] = useState('');
  const [meaning, setMeaning] = useState<MeaningResult | null>(null);
  const [names, setNames] = useState(scene.objects.map(object => objectNameToken(catalog, object.objectId)).join(', '));
  const [roles, setRoles] = useState<Record<string, ObjectRole>>(() => Object.fromEntries(scene.objects.flatMap((object, index) => [[object.instanceId, object.role], [namedObjectKeys(scene.objects.map(item => item.objectId))[index]!.instanceId, object.role]])));
  const [support, setSupport] = useState(initialReview !== null && scene.objects.some(item => item.role === 'secondary'));
  const [variants, setVariants] = useState<LayoutVariant[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [seed, setSeed] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [showSelection, setShowSelection] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const parsed = useMemo(() => parseObjectNames(catalog, names), [catalog, names]);
  const objects = useMemo(() => source === 'theme'
    ? (review ?? []).map(item => ({ instanceId: `theme-${item.objectId}`, objectId: item.objectId, role: item.role, x: 0.5, y: 0.5, rotation: 0 }))
    : source === 'canvas'
    ? scene.objects.map(object => ({ ...object, role: roles[object.instanceId] ?? object.role }))
    : namedObjectKeys(parsed.objectIds).map(({ objectId, instanceId }) => ({ instanceId, objectId, role: roles[instanceId] ?? 'main', x: 0.5, y: 0.5, rotation: 0 })), [source, scene.objects, roles, parsed, review]);
  const themeCatalog = useMemo(() => onlyCustom ? { ...catalog, objects: catalog.objects.filter(object => object.custom) } : catalog, [catalog, onlyCustom]);
  const excluded = meaning?.excludedObjectIds ?? [];
  const choiceObjects = searchObjects(themeCatalog, choiceQuery).filter(object => !excluded.includes(object.id) && !(review ?? []).some(item => item.objectId === object.id));
  const activeVariant = variants[selected];
  const mainCount = objects.filter(object => object.role === 'main').length;


  useEffect(() => {
    dialog.current?.focus();
    const previous = previousFocus.current;
    return () => { previous?.focus(); };
  }, []);

  useEffect(() => {
    if (variants.length) results.current?.querySelector<HTMLButtonElement>('.variant-card')?.focus();
  }, [variants]);

  function invalidate() { setDirty(true); setError(''); }
  function changeTheme(value: string) {
    setTheme(value); resetSelection();
    setRoles(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !id.startsWith('theme-'))));
    invalidate();
  }
  function chooseObject(id: string) {
    const selected = parsed.objectIds.includes(id);
    const ids = selected ? parsed.objectIds.filter(objectId => objectId !== id) : [...parsed.objectIds, id];
    setNames([...ids.map(objectId => objectNameToken(catalog, objectId)), ...parsed.unknown].join(', '));
    invalidate();
  }
  function resetSelection() {
    setMeaning(null); setReview(null); setVariants([]); invalidate();
  }
  function changeSupport(enabled: boolean) {
    setSupport(enabled);
    if (source !== 'theme' || review === null) { invalidate(); return; }
    try {
      const result = selectObjectsByTheme(themeCatalog, theme, { includeBackgroundObjects: enabled });
      const suggested: ReviewedItem[] = result.items.map(item => ({ objectId: item.objectId, role: item.role, reason: item.reason, origin: 'rules' }));
      setMeaning(result); setReview(reviewWithSupport(review, suggested, enabled)); invalidate();
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось изменить фоновые предметы'); }
  }
  function pickByRules() {
    try {
      resetSelection();
      const result = selectObjectsByTheme(themeCatalog, theme, { includeBackgroundObjects: support });
      setMeaning(result);
      const items: ReviewedItem[] = result.items.map(item => ({ objectId: item.objectId, role: item.role, reason: item.reason, origin: 'rules' }));
      setReview(items); setShowSelection(!items.length);
      if (items.length) generate(items, result);
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось подобрать предметы'); }
  }
  function editItems(action: Parameters<typeof editReview>[1]) {
    try {
      const next = editReview(review ?? [], action, themeCatalog, excluded);
      setReview(next);
      invalidate();
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось изменить подбор'); }
  }
  function generate(nextReview = review, nextMeaning = meaning) {
    if (source === 'theme' && nextReview === null) { pickByRules(); return; }
    try {
      const selectedObjects = source === 'theme' ? (nextReview ?? []).map(item => ({ instanceId: `theme-${item.objectId}`, objectId: item.objectId, role: item.role, x: 0.5, y: 0.5, rotation: 0 })) : source === 'names' ? objectsFromNames(catalog, names, roles) : objects;
      const { interpretation: _prior, selectionReview: _oldReview, ...baseScene } = scene;
      const selectionReview: SelectionReview | undefined = source === 'theme' && nextReview?.length ? { prompt: theme.trim(), items: nextReview } : undefined;
      const unchangedRules = nextMeaning && nextReview && nextReview.length === nextMeaning.items.length && nextReview.every((item, i) => item.origin === 'rules' && item.objectId === nextMeaning.items[i]?.objectId && item.role === nextMeaning.items[i]?.role);
      const base: Scene = { ...baseScene, size, name: source === 'theme' ? theme.trim().slice(0, 120) : scene.name.trim() || 'Новая иллюстрация', objects: selectedObjects, ...(selectionReview ? { selectionReview } : {}), ...(source === 'theme' && unchangedRules && nextMeaning ? { interpretation: nextMeaning } : {}) };
      const result = generateLayouts(catalog, base, { seed, includeBackgroundObjects: source === 'theme' ? false : support });
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
      <header className="auto-header"><div><span className="eyebrow">АВТОКОМПОЗИЦИЯ</span><h2 id="auto-dialog-title">{source === 'theme' ? 'Напишите идею. Получите композицию' : 'Выберите предметы. Мы найдём им место'}<span>.</span></h2><p>Три расположения из ваших исходных векторов.</p></div><button className="icon-button" aria-label="Закрыть автосборку" onClick={onClose}><X size={20} /></button></header>
      <div className="auto-body">
        <div className="auto-inputs">
          <div className="auto-source" aria-label="Источник предметов"><button aria-pressed={source === 'theme'} className={source === 'theme' ? 'active' : ''} onClick={() => { setSource('theme'); invalidate(); }}><Sparkles size={12} />По смыслу</button><button aria-pressed={source === 'canvas'} className={source === 'canvas' ? 'active' : ''} onClick={() => { setSource('canvas'); invalidate(); }}><Layers3 size={12} />На холсте</button><button aria-pressed={source === 'names'} className={source === 'names' ? 'active' : ''} onClick={() => { setSource('names'); invalidate(); }}><Shapes size={12} />По названиям</button></div>
          {source === 'theme' && <><div className="meaning-mode"><span />Подбор из вашей библиотеки</div><label className="auto-input-label" htmlFor="auto-theme">О чём ваша иллюстрация?</label><textarea id="auto-theme" aria-label="Заголовок или метафора" placeholder="Например: обучение онлайн или финансовая подушка" value={theme} onChange={event => changeTheme(event.target.value)} rows={3} maxLength={300} /><div className="theme-examples">{THEME_EXAMPLES.map(example => <button key={example} onClick={() => changeTheme(example)}>{example}</button>)}</div></>}
          {source === 'names' && <><label className="auto-input-label" htmlFor="auto-names">Какие предметы нужны?</label><textarea id="auto-names" aria-label="Названия предметов для автосборки" placeholder="Например: книга, телефон, ручка" value={names} onChange={event => { setNames(event.target.value); invalidate(); }} rows={3} maxLength={500} /><div className="auto-object-chips">{catalog.objects.map(object => <button key={object.id} aria-pressed={parsed.objectIds.includes(object.id)} className={parsed.objectIds.includes(object.id) ? 'active' : ''} onClick={() => chooseObject(object.id)}>{parsed.objectIds.includes(object.id) ? <Check size={11} /> : <Plus size={11} />}{object.name}</button>)}</div></>}
          <fieldset className="auto-size"><legend>Детализация иллюстрации</legend><div>{(['S', 'L'] as const).map(value => <button type="button" key={value} aria-pressed={size === value} aria-label={`Детализация ${value}`} onClick={() => { setSize(value); invalidate(); }}><strong>{value}</strong><span>{value === 'S' ? 'Компактная' : 'Подробная'}</span>{size === value && <Check size={12} />}</button>)}</div></fieldset>
          <div className="auto-options">
            <label className="auto-support"><input type="checkbox" checked={support} disabled={objects.length >= MAX_LAYOUT_OBJECTS && !support} onChange={event => changeSupport(event.target.checked)} /><span>{source === 'theme' ? 'Использовать фоновые предметы' : 'Добавить фоновый предмет'}</span></label>
            {source === 'theme' && catalog.objects.some(object => object.custom) && <label className="auto-support"><input type="checkbox" checked={onlyCustom} onChange={event => { setOnlyCustom(event.target.checked); resetSelection(); }} /><span>Только мои SVG</span></label>}
          </div>
          <button className="button primary generate-button" disabled={source === 'theme' && review !== null && !review.length} onClick={() => generate()}><RefreshCw size={16} />{variants.length && !dirty ? 'Ещё варианты' : 'Построить композицию'}</button>
          <details className={source === 'theme' ? 'composition-selection' : 'composition-selection plain'} hidden={source === 'theme' && review === null} open={source !== 'theme' || showSelection} onToggle={event => { if (source === 'theme') setShowSelection(event.currentTarget.open); }}>
          <summary hidden={source !== 'theme'}>{review?.length ? 'Изменить предметы' : 'Выбрать предметы'}<span>{objects.length} / {MAX_LAYOUT_OBJECTS}</span></summary>
          <div className="auto-selection-heading"><h3>Предметы композиции</h3><span className={objects.length > MAX_LAYOUT_OBJECTS ? 'over-limit' : ''}>{objects.length} / {MAX_LAYOUT_OBJECTS}</span></div>
          <div className="auto-selected-list">{objects.map(object => <div key={object.instanceId} className="meaning-object"><label className="auto-selected-object"><span className={`role-dot ${object.role}`} /><span>{catalog.objects.find(item => item.id === object.objectId)!.name}</span><select aria-label={`Роль: ${catalog.objects.find(item => item.id === object.objectId)!.name}`} value={object.role} onChange={event => { if (source === 'theme') editItems({ type: 'role', objectId: object.objectId, role: event.target.value as ObjectRole }); else setRoles({ ...roles, [object.instanceId]: event.target.value as ObjectRole }); invalidate(); }}><option value="main">Главный</option><option value="secondary">Фоновый</option></select></label>{source === 'theme' && <><p>{review?.find(item => item.objectId === object.objectId)?.reason}</p><div className="review-edit-row"><label>Заменить<select aria-label={`Заменить: ${catalog.objects.find(item => item.id === object.objectId)!.name}`} value={object.objectId} onChange={event => editItems({ type: 'replace', objectId: event.target.value, previousId: object.objectId })}><option value={object.objectId}>{catalog.objects.find(item => item.id === object.objectId)!.name}</option>{themeCatalog.objects.filter(item => !excluded.includes(item.id) && !(review ?? []).some(selected => selected.objectId === item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" aria-label={`Убрать из подбора: ${catalog.objects.find(item => item.id === object.objectId)!.name}`} onClick={() => editItems({ type: 'remove', objectId: object.objectId })}>Убрать</button></div></>}</div>)}{!objects.length && <p className="auto-empty-selection">{source === 'theme' ? review === null ? 'Введите фразу и постройте композицию.' : 'Предметы не выбраны. Уточните фразу или добавьте их вручную.' : source === 'canvas' ? 'Холст пуст. Выберите предметы по названиям.' : 'Введите названия или нажмите на предметы выше.'}</p>}</div>
          {source === 'theme' && review !== null && <>
            <button className="button secondary review-retry" onClick={pickByRules}>Подобрать заново</button>
            <details className="review-library"><summary>Добавить предмет вручную</summary><label>Поиск<input aria-label="Поиск для исправления подбора" placeholder="Название или тег" value={choiceQuery} onChange={event => setChoiceQuery(event.target.value)} /></label><div className="review-choice-grid">{choiceObjects.map(object => <button className="review-choice" key={object.id} disabled={(review?.length ?? 0) >= MAX_LAYOUT_OBJECTS} onClick={() => editItems({ type: 'add', objectId: object.id })}><ObjectThumbnail catalog={catalog} texts={texts} scene={previewScene} objectId={object.id} /><span>{object.name}</span><Plus size={12} /></button>)}</div>{!choiceObjects.length && <p>Доступных предметов не найдено. Проверьте поиск и ограничения фразы.</p>}</details>
          </>}
          </details>
          <p className="auto-rules">От одного до шести предметов, хотя бы один главный. Пропорции сохраняются, фоновые располагаются позади главных.</p>
          {source === 'names' && parsed.unknown.length > 0 && !error && <p className="auto-error" role="status">Нет в библиотеке: {[...new Set(parsed.unknown)].join(', ')}</p>}
          {error && <p className="auto-error" role="alert">{error}</p>}
        </div>
        <div className="auto-results" ref={results}>
          <div className="auto-results-heading"><span>РАСПОЛОЖЕНИЯ</span><span>{size} · {width} × {height}</span></div>
          {source === 'theme' && meaning && <div className={`meaning-summary ${meaning.status}`} role="status"><span>{review?.some(item => item.origin !== 'rules') ? 'Состав исправлен вами' : meaning.status === 'matched' ? 'Найдена смысловая связь' : meaning.status === 'partial' ? 'Частичная смысловая связь' : 'Нужен контекст'}</span><p>{review?.some(item => item.origin !== 'rules') ? 'Варианты собраны из выбранных вами предметов.' : meaning.summary}</p><div>{meaning.concepts.map(concept => <i key={concept.id}>{concept.label}</i>)}</div>{meaning.limitations.map((note, index) => <p className="meaning-limitation" key={index}>{note}</p>)}{meaning.excludedObjectIds.length > 0 && <p className="meaning-limitation">Исключены по вашему запросу: {meaning.excludedObjectIds.map(id => catalog.objects.find(object => object.id === id)!.name).join(', ')}.</p>}</div>}
          {!variants.length ? <div className="auto-placeholder"><span><Sparkles size={32} /></span><h3>{source === 'theme' && review?.length === 0 ? 'Нужны предметы для композиции' : 'У одной идеи — несколько форм'}</h3><p>{source === 'theme' && review?.length === 0 ? 'Уточните фразу или добавьте подходящие предметы вручную.' : source === 'theme' ? 'Напишите метафору и нажмите «Построить композицию».' : 'Выберите предметы и нажмите «Построить композицию».'}</p><div><i /><i /><i /></div></div> : <>
            <div className={`variant-grid ${dirty ? 'stale' : ''}`}>{variants.map((variant, index) => <button className={`variant-card ${selected === index ? 'active' : ''}`} key={variant.id} aria-pressed={selected === index} aria-label={`Вариант: ${variant.name}`} onClick={() => setSelected(index)}><span className="variant-image"><VariantPreview catalog={catalog} texts={texts} variant={variant} /><span className="variant-number">0{index + 1}</span>{selected === index && <span className="variant-check"><Check size={13} /></span>}</span><strong>{variant.name}</strong><small>{variant.description}</small></button>)}</div>
            <div className="auto-result-note">{dirty ? 'Настройки изменились. Получите новые варианты перед применением.' : activeVariant?.addedObjectIds.length ? `Добавлен фоновый предмет: ${activeVariant.addedObjectIds.map(id => catalog.objects.find(item => item.id === id)!.name).join(', ')}.` : `Главных: ${mainCount} · фоновых: ${objects.length - mainCount}. Все предметы помещаются в холст.`}</div>
            <p className="auto-after-note">После выбора вы сможете переместить предметы, изменить цвета и скачать SVG.</p>
          </>}
          <div className="auto-result-footer"><span>Изменения применятся одним действием.<br />Их можно отменить через Ctrl+Z.</span><button className="button primary" disabled={!activeVariant || dirty} onClick={() => { if (activeVariant && !dirty) onApply(activeVariant.scene); }}>Открыть в редакторе<ArrowRight size={15} /></button></div>
        </div>
      </div>
    </section>
  </div>;
}
