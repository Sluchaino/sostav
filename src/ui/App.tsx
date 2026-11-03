import { useEffect, useId, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, CheckCheck, ChevronDown, Copy, Download, EyeOff, FilePlus2, FolderOpen, Frame, Grip, Layers3, LayoutGrid, Maximize, Minus, MousePointer2, Plus, Redo2, RotateCcw, Search, Settings2, Shapes, Sparkles, Trash2, Undo2, Upload, X, type LucideIcon } from 'lucide-react';
import { selectObject, searchObjects, validatePalette, type Catalog, type Palette, type SvgAsset } from '../library/index.js';
import { activePalette, canvasSize, compositionScale, createBlankScene, createExample, EXAMPLES, moveLayer, objectTransform, reduceHistory, readScene, type ExampleId, type History, type Scene, type SceneObject } from '../editor/model.js';
import { backgroundMarkup, exportSvg, objectMarkup, preparedSvg, type AssetTexts } from '../editor/svg.js';
import { customLibrary, customTexts, readCustomSvg, validateCustomObjects, MAX_SVG_BYTES, type CustomObject } from '../library/custom.js';
import { CustomObjectDialog } from './CustomObjectDialog.js';
import { CompositionPreview } from './CompositionPreview.js';
import { PreflightDialog } from './PreflightDialog.js';
import { AutoComposeDialog } from './AutoComposeDialog.js';
import { editorShortcut } from '../editor/shortcuts.js';

const STORAGE_KEY = 'sostav-project-v1';
const MAX_FILE_BYTES = 15_000_000;
const formatNames: Record<string, string> = { square: 'Квадрат', landscape: 'Горизонтальный', portrait: 'Вертикальный' };
const newId = () => 'i-' + crypto.randomUUID();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие';
const countLabel = (count: number) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'предмет' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'предмета' : 'предметов'}`;
const persistableScene = (scene: Scene): Scene => ({ ...scene, name: scene.name.trim() || 'Новая иллюстрация' });

function IconButton({ icon: Icon, label, onClick, disabled = false, active = false, className = '' }: { icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; active?: boolean; className?: string }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''} ${className}`} onClick={onClick} disabled={disabled} aria-label={label} title={label}><Icon size={18} strokeWidth={1.7} /></button>;
}

function AssetPreview({ catalog, texts, asset, palette, background = false }: { catalog: Catalog; texts: AssetTexts; asset: SvgAsset; palette: Palette; background?: boolean }) {
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const markup = useMemo(() => {
    const svg = preparedSvg(catalog, asset, texts.get(asset.url)!, palette, background ? 'background' : 'object', `preview-${prefix}`);
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return new XMLSerializer().serializeToString(svg);
  }, [catalog, texts, asset, palette, background, prefix]);
  return <span className="asset-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
const fileName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim().slice(0, 100) || 'Иллюстрация';

export function App() {
  const [loaded, setLoaded] = useState<{ catalog: Catalog; texts: AssetTexts } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      const response = await fetch('/library/catalog.json');
      if (!response.ok) throw new Error('Каталог недоступен. Выполните npm run library:build.');
      const catalog: Catalog = await response.json();
      const assets = [...catalog.objects.flatMap(item => Object.values(item.variants).flatMap(Object.values)), ...catalog.backgrounds.flatMap(item => Object.values(item.variants))];
      const pairs = await Promise.all(assets.map(async asset => {
        const response = await fetch(asset.url);
        if (!response.ok) throw new Error('Не удалось загрузить ' + asset.url);
        return [asset.url, await response.text()] as const;
      }));
      if (active) setLoaded({ catalog, texts: new Map(pairs) });
    }
    load().catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, []);
  if (!loaded) return <div className="loading-screen"><div className="brand-mark"><Shapes /></div><h1>Состав</h1><p>{error || 'Готовим векторную библиотеку…'}</p>{error ? <button className="button primary" onClick={() => location.reload()}>Повторить загрузку</button> : <span className="loading-dot" />}</div>;
  return <Editor catalog={loaded.catalog} texts={loaded.texts} />;
}

function Editor({ catalog: baseCatalog, texts: baseTexts }: { catalog: Catalog; texts: AssetTexts }) {
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const parsed = readScene(JSON.parse(raw), baseCatalog); return { scene: parsed, restored: true, invalid: false }; }
    } catch { return { scene: createExample('learning'), restored: false, invalid: true }; }
    return { scene: createExample('learning'), restored: false, invalid: false };
  });
  const [history, dispatch] = useReducer(reduceHistory<Scene>, { past: [], present: initial.scene, future: [] } as History<Scene>);
  const [draft, setDraft] = useState<Scene | null>(null);
  const scene = draft ?? history.present;
  const catalog = useMemo(() => customLibrary(baseCatalog, scene.customObjects), [baseCatalog, scene.customObjects]);
  const texts = useMemo(() => customTexts(baseTexts, scene.customObjects), [baseTexts, scene.customObjects]);
  const [customSection, setCustomSection] = useState<'meaning' | 'colors'>('meaning');
  const [editingCustom, setEditingCustom] = useState<string | null>(null);
  const [importingSvg, setImportingSvg] = useState(false);
  const svgInput = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initial.scene.objects.at(-1)?.instanceId ?? null);
  const selected = scene.objects.find(item => item.instanceId === selectedId);
  const selectedIndex = scene.objects.findIndex(item => item.instanceId === selectedId);
  const selectedDefinition = catalog.objects.find(item => item.id === selected?.objectId);
  const palette = activePalette(catalog, scene);
  const { width, height } = canvasSize(catalog, scene);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'objects' | 'backgrounds'>('objects');
  const [addRole, setAddRole] = useState<'main' | 'secondary'>('main');
  const [zoom, setZoom] = useState(1);
  const [saved, setSaved] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const [toast, setToast] = useState(initial.invalid ? 'Сохранённый проект не удалось прочитать. Открыт пример.' : initial.restored ? 'Восстановлен последний проект' : 'Начните с примера или добавьте свои предметы');
  const [showExamples, setShowExamples] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const selectedSection = useRef<HTMLElement>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 800 });
  const stageContainer = useRef<HTMLDivElement>(null);
  const stageRef = useRef<SVGSVGElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const paletteInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ before: Scene; latest: Scene; id: string; startX: number; startY: number; object: SceneObject; pointerId: number } | null>(null);
  const markupCache = useRef(new Map<string, string>());
  const visibleObjects = useMemo(() => searchObjects(catalog, query), [catalog, query]);
  const fit = Math.min(Math.max(120, viewport.width - 100) / width, Math.max(120, viewport.height - 100) / height);
  const displayWidth = width * fit * zoom;
  const displayHeight = height * fit * zoom;
  const scale = compositionScale(catalog, scene);
  const bgMarkup = useMemo(() => scene.backgroundVisible ? backgroundMarkup(catalog, texts, scene) : '', [catalog, texts, scene.size, scene.paletteId, scene.customPalettes, scene.backgroundVisible, scene.formatId]);
  const renderedObjects = useMemo(() => scene.objects.map(object => {
    const asset = selectObject(catalog, object.objectId, scene.size, object.role);
    const key = `${asset.url}|${object.instanceId}|${JSON.stringify(asset.paintRoles)}|${JSON.stringify(palette.colors)}`;
    let markup = markupCache.current.get(key);
    if (!markup) {
      if (markupCache.current.size > 1000) markupCache.current.clear();
      markup = objectMarkup(catalog, texts, asset, palette, `canvas-${object.instanceId}`);
      markupCache.current.set(key, markup);
    }
    return { object, asset, markup };
  }), [catalog, texts, scene.objects, scene.size, palette]);

  const latestScene = useRef(history.present);
  latestScene.current = history.present;
  function commit(next: Scene | ((scene: Scene) => Scene)) {
    const value = typeof next === 'function' ? next(latestScene.current) : next;
    latestScene.current = value;
    dispatch({ type: 'commit', value });
  }
  function patch(patch: Partial<Scene>) { commit({ ...history.present, ...patch }); }
  function updateSelected(patch: Partial<SceneObject>) {
    if (!selected) return;
    commit({ ...history.present, objects: history.present.objects.map(item => item.instanceId === selected.instanceId ? { ...item, ...patch } : item) });
  }
  function removeSelected() {
    if (!selected) return;
    commit({ ...history.present, objects: history.present.objects.filter(item => item.instanceId !== selected.instanceId) });
    setSelectedId(null);
  }
  function duplicateSelected() {
    if (!selected || scene.objects.length >= 100) return;
    const copy = { ...selected, instanceId: newId(), x: selected.x + 0.035, y: selected.y + 0.035 };
    const objects = [...history.present.objects]; objects.splice(selectedIndex + 1, 0, copy);
    commit({ ...history.present, objects }); setSelectedId(copy.instanceId);
  }
  function addObject(id: string) {
    if (scene.objects.length >= 100) { setToast('На холсте может быть не более 100 предметов'); return; }
    const offset = (scene.objects.length % 4) * 0.035;
    const object: SceneObject = { instanceId: newId(), objectId: id, role: addRole, x: 0.5 + offset, y: 0.5 + offset, rotation: 0 };
    commit({ ...history.present, objects: [...history.present.objects, object] }); setSelectedId(object.instanceId);
  }
  function loadExample(id: ExampleId) { const next = { ...createExample(id), customObjects: scene.customObjects ?? [] }; commit(next); setSelectedId(next.objects.at(-1)?.instanceId ?? null); setShowExamples(false); setToast('Открыт пример. Изменения можно отменить.'); }
  function saveProject() { download(fileName(scene.name) + '.sostav.json', JSON.stringify(persistableScene(scene), null, 2), 'application/json'); setToast('Проект сохранён. Его можно открыть и продолжить работу.'); }
  function saveSvg() { setShowPreflight(true); }
  function downloadSvg() {
    try { download(fileName(scene.name) + '.svg', exportSvg(catalog, texts, scene), 'image/svg+xml;charset=utf-8'); setShowPreflight(false); setToast('SVG скачан — предметы сохранены отдельными векторными группами'); }
    catch (error) { setToast(errorMessage(error)); }
  }
  async function openFile(file: File | undefined, kind: 'project' | 'palette') {
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Файл слишком большой. Максимум — 15 МБ.');
      const value = readScene(JSON.parse(await file.text()), baseCatalog);
      if (kind === 'project') {
        commit(value); setSelectedId(value.objects.at(-1)?.instanceId ?? null); setToast('Проект открыт');
      } else {
        validatePalette(catalog, value);
        if ([...catalog.palettes, ...scene.customPalettes].some(p => p.id === value.id)) throw new Error('Палитра с таким id уже есть. Задайте уникальный id в JSON.');
        if (scene.customPalettes.length >= 50) throw new Error('Допускается не более 50 пользовательских палитр');
        patch({ customPalettes: [...scene.customPalettes, value], paletteId: value.id }); setToast('Палитра загружена и применена ко всей композиции');
      }
    } catch (error) { setToast(errorMessage(error)); }
  }

  function removeCustom(id: string) {
    commit(current => {
      const { interpretation: _old, selectionReview: _review, ...rest } = current;
      return { ...rest, customObjects: (current.customObjects ?? []).filter(item => item.id !== id), objects: current.objects.filter(item => item.objectId !== id) };
    });
    setToast('SVG удалён из библиотеки и сцены. Действие можно отменить.');
  }
  async function importSvgFiles(files: File[]) {
    if (!files.length) return;
    setImportingSvg(true);
    try {
      if (files.length + (history.present.customObjects?.length ?? 0) > 30) throw new Error('В проекте может быть до 30 своих SVG');
      const additions: CustomObject[] = [];
      for (const file of files) {
        try {
          if (!file.name.toLowerCase().endsWith('.svg')) throw new Error('Нужен файл .svg');
          if (file.size > MAX_SVG_BYTES) throw new Error('Максимум — 1 МБ на SVG');
          const { svg } = readCustomSvg(await file.text());
          additions.push({ id: 'custom-' + crypto.randomUUID(), name: file.name.replace(/\.svg$/i, '').trim().slice(0, 80) || 'Свой предмет', tags: [], meanings: [], svg });
        } catch (error) { throw new Error(file.name + ': ' + errorMessage(error)); }
      }
      // Commit against the latest scene, so navigation during file reads cannot lose edits.
      commit(current => {
        const customObjects = [...(current.customObjects ?? []), ...additions];
        validateCustomObjects(customObjects, baseCatalog);
        return { ...current, customObjects };
      });
      setTab('objects'); setQuery(''); setCustomSection('meaning'); setEditingCustom(additions[0]!.id);
      setToast(`Загружено SVG: ${additions.length}. Заполните смыслы каждой картинки.`);
    } catch (error) { setToast(errorMessage(error)); }
    finally { setImportingSvg(false); }
  }

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ width: rect.width, height: rect.height });
    });
    if (stageContainer.current) observer.observe(stageContainer.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setSaved(false);
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableScene(history.present))); setSaved(true); setStorageError(false); }
      catch { setStorageError(true); }
    }, 450);
    return () => clearTimeout(timer);
  }, [history.present]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (showAuto || editingCustom || showPreflight || showPreview) return;
      const element = event.target as HTMLElement;
      const action = editorShortcut(event, ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable);
      if (!action) return;
      if (action === 'save') { event.preventDefault(); saveProject(); }
      else if (action === 'undo' || action === 'redo') { event.preventDefault(); dispatch({ type: action }); }
      else if (action === 'duplicate') { event.preventDefault(); duplicateSelected(); }
      else if (action === 'escape') { setSelectedId(null); setShowExamples(false); setShowHelp(false); }
      else if (action === 'delete' && selected) { event.preventDefault(); removeSelected(); }
      else if (selected && ['up', 'down', 'left', 'right'].includes(action)) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1;
        const dx = action === 'left' ? -step : action === 'right' ? step : 0;
        const dy = action === 'up' ? -step : action === 'down' ? step : 0;
        updateSelected({ x: Math.max(-10, Math.min(10, selected.x + dx / width)), y: Math.max(-10, Math.min(10, selected.y + dy / height)) });
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  function canvasPoint(event: ReactPointerEvent) {
    const svg = stageRef.current!;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }
  function startDrag(event: ReactPointerEvent<SVGGElement>, object: SceneObject) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const point = canvasPoint(event);
    setSelectedId(object.instanceId);
    drag.current = { before: history.present, latest: history.present, id: object.instanceId, startX: point.x, startY: point.y, object, pointerId: event.pointerId };
    stageRef.current?.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const point = canvasPoint(event);
    const x = Math.max(-10, Math.min(10, current.object.x + (point.x - current.startX) / width));
    const y = Math.max(-10, Math.min(10, current.object.y + (point.y - current.startY) / height));
    current.latest = { ...current.before, objects: current.before.objects.map(object => object.instanceId === current.id ? { ...object, x, y } : object) };
    setDraft(current.latest);
  }
  function finishDrag(cancel = false) {
    const current = drag.current;
    if (!current) return;
    if (!cancel) dispatch({ type: 'commit', value: current.latest });
    drag.current = null; setDraft(null);
  }

  return <div className="app-shell">
    <header className="app-header">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="Состав — конструктор иллюстраций"><span className="brand-mark"><span /><span /></span><span>состав<span className="brand-caption">конструктор иллюстраций</span></span><span className="version-badge">β</span></a>
      <div className="project-heading"><input aria-label="Название проекта" maxLength={120} value={scene.name} onChange={event => patch({ name: event.target.value })} onBlur={() => { if (!scene.name.trim()) patch({ name: 'Новая иллюстрация' }); }} /><span className={`save-status ${storageError ? 'warning' : ''}`}><span />{storageError ? 'Скачайте проект для сохранения' : saved ? 'Сохранено в браузере' : 'Сохраняем…'}</span></div>
      <div className="header-actions"><IconButton icon={FilePlus2} label="Новый проект" onClick={() => { commit({ ...createBlankScene(), customObjects: scene.customObjects ?? [] }); setSelectedId(null); setToast('Создан пустой проект. Предыдущее состояние можно вернуть отменой.'); }} /><IconButton icon={FolderOpen} label="Открыть проект" onClick={() => projectInput.current?.click()} /><button className="button secondary save-project" onClick={saveProject}><Download size={16} />Проект</button><button className="button primary" onClick={saveSvg}><Download size={17} />Скачать SVG</button></div>
    </header>

    <div className="workspace">
      <aside className="library-panel" aria-label="Библиотека компонентов">
        <div className="panel-intro"><span className="eyebrow">ВАША БИБЛИОТЕКА</span><h2>Из деталей — в целое<span className="heading-dot">.</span></h2><p>Выберите предмет и добавьте его на холст.</p></div>
        <div className="library-tabs" role="tablist" aria-label="Раздел библиотеки"><button role="tab" aria-selected={tab === 'objects'} className={tab === 'objects' ? 'active' : ''} onClick={() => setTab('objects')}><Shapes size={16} />Предметы <span>{catalog.objects.length}</span></button><button role="tab" aria-selected={tab === 'backgrounds'} className={tab === 'backgrounds' ? 'active' : ''} onClick={() => setTab('backgrounds')}><Frame size={16} />Фоны</button></div>
        {tab === 'objects' ? <>
          <button className="upload-svg button secondary" aria-label="Загрузить свои SVG" aria-busy={importingSvg} title="Загрузить свои SVG" disabled={importingSvg} onClick={() => svgInput.current?.click()}><Upload size={15} /><span className="upload-svg-full" aria-hidden="true">{importingSvg ? 'Загружаем…' : 'Загрузить свои SVG'}</span><span className="upload-svg-compact" aria-hidden="true">{importingSvg ? 'Загрузка…' : 'Свои SVG'}</span></button>
          <label className="search-field"><Search size={17} /><input aria-label="Поиск предметов" placeholder="Название или смысл…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Очистить поиск" onClick={() => setQuery('')}><X size={14} /></button>}</label>
          <div className="role-switch" aria-label="Роль добавляемых предметов"><button className={addRole === 'main' ? 'active' : ''} onClick={() => setAddRole('main')} aria-pressed={addRole === 'main'}><span className="role-dot main" />Главные</button><button className={addRole === 'secondary' ? 'active' : ''} onClick={() => setAddRole('secondary')} aria-pressed={addRole === 'secondary'}><span className="role-dot secondary" />Фоновые</button></div>
          <div className="object-grid">{visibleObjects.map(object => <div className="library-object" key={object.id}><button className="object-card" key={object.id} onClick={() => addObject(object.id)} aria-label={`Добавить: ${object.name}`}><span className="object-image"><AssetPreview catalog={catalog} texts={texts} asset={object.variants[scene.size][addRole]} palette={palette} /><span className="add-badge"><Plus size={16} /></span></span><span className="object-name">{object.name}</span></button>{object.custom && <div className="custom-card-actions"><button onClick={() => { setCustomSection('meaning'); setEditingCustom(object.id); }} aria-label={`Смыслы: ${object.name}`}>Смыслы и цвета</button><button onClick={() => removeCustom(object.id)} aria-label={`Удалить из библиотеки: ${object.name}`}><Trash2 size={12} /></button></div>}</div>)}{!visibleObjects.length && <div className="empty-search"><Search size={24} /><p>Ничего не найдено</p><span>Попробуйте «книга» или «работа»</span></div>}</div>
        </> : <div className="background-list"><p className="field-hint">Готовые фоны со своей цветовой схемой.</p>{catalog.backgrounds.map(background => <button className={`background-card ${scene.paletteId === background.paletteId && scene.backgroundVisible ? 'active' : ''}`} key={background.id} onClick={() => patch({ paletteId: background.paletteId, backgroundVisible: true })}><AssetPreview catalog={catalog} texts={texts} asset={background.variants[scene.size]} palette={catalog.palettes.find(p => p.id === background.paletteId)!} background /><span>{background.name}</span>{scene.paletteId === background.paletteId && scene.backgroundVisible && <Check size={16} />}</button>)}<button className={`transparent-background ${!scene.backgroundVisible ? 'active' : ''}`} onClick={() => patch({ backgroundVisible: false })}><EyeOff size={17} />Прозрачный фон</button></div>}
        <div className="library-footer"><span className="tiny-icon"><Layers3 size={15} /></span><span>Только исходные векторы<br /><strong>Без генерации новых объектов</strong></span></div>
      </aside>

      <main className="canvas-panel">
        <div className="canvas-toolbar"><div className="toolbar-left"><IconButton icon={Undo2} label="Отменить (Ctrl+Z)" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })} /><IconButton icon={Redo2} label="Повторить (Ctrl+Shift+Z)" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })} /><span className="toolbar-divider" /><label className="format-select"><LayoutGrid size={15} /><select aria-label="Формат холста" value={scene.formatId} onChange={event => patch({ formatId: event.target.value })}>{catalog.formats.map(format => <option key={format.id} value={format.id}>{formatNames[format.id]} · {format.width} × {format.height}</option>)}</select><ChevronDown size={14} /></label></div><div className="toolbar-actions"><button className="button auto-compose-button" aria-label="Собрать композицию" onClick={() => setShowAuto(true)}><Sparkles size={15} /><span>Собрать композицию</span></button><div className="example-menu"><button className={`button quiet ${showExamples ? 'active' : ''}`} aria-expanded={showExamples} onClick={() => setShowExamples(!showExamples)}><Sparkles size={16} />Примеры<ChevronDown size={14} /></button>{showExamples && <><button className="menu-backdrop" aria-label="Закрыть примеры" onClick={() => setShowExamples(false)} /><div className="dropdown">{EXAMPLES.map(example => <button key={example.id} onClick={() => loadExample(example.id)}><span>{example.name}</span><small>{example.description}</small></button>)}</div></>}</div></div></div>
        <div className="canvas-viewport" ref={stageContainer}>
          <div className="canvas-space" style={{ minWidth: Math.max(viewport.width, displayWidth + 100), minHeight: Math.max(viewport.height, displayHeight + 100) }}>
            <div className="artboard-wrap" style={{ width: displayWidth, height: displayHeight }}><div className="artboard-label"><span>{scene.name || 'Новая иллюстрация'}</span><span>{scene.size} / {width} × {height}</span></div>
              <svg ref={stageRef} className="artboard" style={{ width: displayWidth, height: displayHeight }} viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg" aria-label="Холст иллюстрации" onPointerDown={() => setSelectedId(null)} onPointerMove={onPointerMove} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)}>
                {scene.backgroundVisible && <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: bgMarkup }} />}
                {renderedObjects.map(({ object, asset, markup }) => <g key={object.instanceId} data-instance-id={object.instanceId} role="button" aria-label={`На холсте: ${catalog.objects.find(item => item.id === object.objectId)!.name}`} tabIndex={0} className={`scene-object ${selectedId === object.instanceId ? 'selected' : ''}`} transform={objectTransform(catalog, scene, object)} onPointerDown={event => startDrag(event, object)} onKeyDown={event => { if (event.key === 'Enter') setSelectedId(object.instanceId); }}>
                  <rect x={-asset.width / 2} y={-asset.height / 2} width={asset.width} height={asset.height} fill="transparent" />
                  <g pointerEvents="none" dangerouslySetInnerHTML={{ __html: markup }} />
                  {selectedId === object.instanceId && <rect className="selection-outline" x={-asset.width / 2 - 10 / scale} y={-asset.height / 2 - 10 / scale} width={asset.width + 20 / scale} height={asset.height + 20 / scale} rx={3 / scale} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                </g>)}
              </svg>
              {!scene.objects.length && <div className="empty-artboard"><span><Shapes size={30} /></span><h3>Место для вашей идеи</h3><p>Добавьте предметы из библиотеки слева<br />или откройте готовый пример.</p></div>}
            </div>
          </div>
        </div>
        <div className="canvas-status"><span><MousePointer2 size={14} />{selected ? 'Перетаскивайте, чтобы переместить' : `${countLabel(scene.objects.length)} на холсте`}</span><div className="zoom-controls"><IconButton icon={Minus} label="Уменьшить масштаб просмотра" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(1)))} disabled={zoom <= 0.4} /><span>{Math.round(zoom * 100)}%</span><IconButton icon={Plus} label="Увеличить масштаб просмотра" onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(1)))} disabled={zoom >= 2} /><span className="toolbar-divider" /><IconButton icon={Frame} label="Вписать холст в окно" onClick={() => { setZoom(1); stageContainer.current?.scrollTo({ left: 0, top: 0 }); }} /><IconButton icon={Maximize} label="Посмотреть композицию на весь экран" onClick={() => setShowPreview(true)} /></div><button className="help-button" onClick={() => setShowHelp(true)}>Горячие клавиши <span>?</span></button></div>
      </main>

      <aside className="properties-panel" aria-label="Настройки иллюстрации">
        <div className="properties-title"><Settings2 size={17} /><h2>Настройки</h2></div>
        <section className="property-section"><div className="section-title"><h3>Размер иллюстрации</h3><span className="subtle-label">ДЕТАЛИЗАЦИЯ</span></div><div className="size-switch">{(['S', 'L'] as const).map(size => <button key={size} aria-pressed={scene.size === size} className={scene.size === size ? 'active' : ''} onClick={() => patch({ size })}><span>{size}</span><small>{size === 'S' ? 'Компактная' : 'Подробная'}</small>{scene.size === size && <Check size={14} />}</button>)}</div><p className="field-hint">При смене размера подставляем соответствующие исходные SVG.</p></section>
        <section className="property-section"><div className="section-title"><h3>Цветовая схема</h3><span className="count-badge">{catalog.palettes.length + scene.customPalettes.length}</span></div><div className="palette-list">{[...catalog.palettes, ...scene.customPalettes].map(item => <button className={`palette-option ${scene.paletteId === item.id ? 'active' : ''}`} key={item.id} aria-pressed={scene.paletteId === item.id} onClick={() => patch({ paletteId: item.id })}><span className="palette-swatches">{(['background.base', 'background.strong', 'object.primary', 'object.secondary'] as const).map(role => <i key={role} style={{ background: item.colors[role] }} />)}</span><span>{item.name}</span>{scene.paletteId === item.id && <Check size={15} />}</button>)}</div><button className="upload-palette" onClick={() => paletteInput.current?.click()}><Upload size={14} />Загрузить палитру <span>JSON</span></button></section>
        <section className="property-section composition-section"><div className="section-title"><h3>Композиция</h3></div><label className="toggle-row"><span>Показывать фон</span><button className={`toggle ${scene.backgroundVisible ? 'on' : ''}`} role="switch" aria-label="Показывать фон" aria-checked={scene.backgroundVisible} onClick={() => patch({ backgroundVisible: !scene.backgroundVisible })}><span /></button></label><div className="range-heading"><label htmlFor="composition-scale">Общий масштаб</label><span>{Math.round(scene.compositionScale * 100)}%</span></div><input id="composition-scale" aria-label="Общий масштаб композиции" type="range" min="15" max="150" value={Math.round(scene.compositionScale * 100)} onChange={event => patch({ compositionScale: Number(event.target.value) / 100 })} /><p className="field-hint">Соотношение размеров предметов сохраняется.</p></section>
        <section ref={selectedSection} className="property-section selected-section"><div className="section-title"><h3>{selectedDefinition?.name ?? 'Предмет'}</h3>{selected && <span className="selected-label">ВЫБРАН</span>}</div>{selected ? <>
          <div className="role-switch property-role"><button aria-pressed={selected.role === 'main'} className={selected.role === 'main' ? 'active' : ''} onClick={() => updateSelected({ role: 'main' })}><span className="role-dot main" />Главный</button><button aria-pressed={selected.role === 'secondary'} className={selected.role === 'secondary' ? 'active' : ''} onClick={() => updateSelected({ role: 'secondary' })}><span className="role-dot secondary" />Фоновый</button></div>
          <div className="coordinates"><label><span>X</span><input aria-label="Координата X" type="number" min={-width * 10} max={width * 10} value={Math.round(selected.x * width)} onChange={event => { const v = event.target.valueAsNumber; if (Number.isFinite(v)) updateSelected({ x: Math.max(-10, Math.min(10, v / width)) }); }} /></label><label><span>Y</span><input aria-label="Координата Y" type="number" min={-height * 10} max={height * 10} value={Math.round(selected.y * height)} onChange={event => { const v = event.target.valueAsNumber; if (Number.isFinite(v)) updateSelected({ y: Math.max(-10, Math.min(10, v / height)) }); }} /></label></div>
          <div className="rotation-row"><label htmlFor="rotation">Поворот</label><div><input id="rotation" aria-label="Поворот предмета" type="number" min="-180" max="180" value={Math.round(selected.rotation)} onChange={event => { const v = event.target.valueAsNumber; if (Number.isFinite(v)) updateSelected({ rotation: Math.max(-180, Math.min(180, v)) }); }} /><span>°</span><IconButton icon={RotateCcw} label="Сбросить поворот" onClick={() => updateSelected({ rotation: 0 })} /></div></div>
          <div className="object-actions"><IconButton icon={ArrowDown} label="На слой ниже" disabled={selectedIndex === 0} onClick={() => commit(moveLayer(history.present, selected.instanceId, -1))} /><IconButton icon={ArrowUp} label="На слой выше" disabled={selectedIndex === scene.objects.length - 1} onClick={() => commit(moveLayer(history.present, selected.instanceId, 1))} /><span /><IconButton icon={Copy} label="Дублировать предмет (Ctrl+D)" onClick={duplicateSelected} disabled={scene.objects.length >= 100} /><IconButton icon={Trash2} label="Удалить предмет (Delete)" className="danger" onClick={removeSelected} /></div>
        </> : <div className="no-selection"><MousePointer2 size={21} /><p>Выберите предмет на холсте,<br />чтобы изменить его.</p></div>}</section>
        <section className="property-section layers-section"><div className="section-title"><h3><Layers3 size={15} />Слои</h3><span className="count-badge">{scene.objects.length}</span></div><div className="layers-list">{[...scene.objects].reverse().map(object => <button className={`layer-row ${object.instanceId === selectedId ? 'active' : ''}`} key={object.instanceId} onClick={() => setSelectedId(object.instanceId)} aria-pressed={object.instanceId === selectedId}><Grip size={13} /><span className={`role-dot ${object.role}`} /><span>{catalog.objects.find(item => item.id === object.objectId)!.name}</span><small>{object.role === 'main' ? 'главный' : 'фоновый'}</small></button>)}{!scene.objects.length && <p className="field-hint">Здесь появятся добавленные предметы.</p>}</div></section>
      </aside>
    </div>
    <input ref={svgInput} type="file" accept=".svg,image/svg+xml" multiple hidden aria-label="Свои SVG" onChange={event => { void importSvgFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    {editingCustom && scene.customObjects?.find(item => item.id === editingCustom) && <CustomObjectDialog key={editingCustom} object={scene.customObjects.find(item => item.id === editingCustom)!} catalog={catalog} palettes={[...catalog.palettes, ...scene.customPalettes]} paletteId={scene.paletteId} initialSection={customSection} initialRole={selected?.objectId === editingCustom ? selected.role : 'main'} onClose={() => setEditingCustom(null)} onSave={value => { commit(current => { const { interpretation: _old, selectionReview: _review, ...rest } = current; return { ...rest, customObjects: (current.customObjects ?? []).map(item => item.id === value.id ? value : item) }; }); setEditingCustom(null); setToast('Настройки SVG сохранены. Цвета применены на холсте.'); }} />}
    <input ref={projectInput} type="file" accept=".json,.sostav.json,application/json" hidden aria-label="Файл проекта" onChange={event => { void openFile(event.target.files?.[0], 'project'); event.target.value = ''; }} />
    {showPreview && <CompositionPreview catalog={catalog} texts={texts} scene={scene} onClose={() => setShowPreview(false)} />}
    {showPreflight && <PreflightDialog catalog={catalog} scene={scene} onClose={() => setShowPreflight(false)} onExport={downloadSvg} onSelect={id => { setShowPreflight(false); setSelectedId(id); setZoom(1); setToast('Предмет выбран. Исправьте координаты, поворот или общий масштаб и повторите проверку.'); requestAnimationFrame(() => { selectedSection.current?.scrollIntoView({ block: 'nearest' }); selectedSection.current?.querySelector<HTMLInputElement>('input')?.focus(); }); }} onColors={id => { setShowPreflight(false); setCustomSection('colors'); setEditingCustom(id); }} />}
    {showAuto && <AutoComposeDialog catalog={catalog} texts={texts} scene={scene} onClose={() => setShowAuto(false)} onApply={next => { commit(next); setSelectedId([...next.objects].reverse().find(object => object.role === 'main')?.instanceId ?? null); setShowAuto(false); setToast('Композиция собрана. Её можно редактировать и скачать в SVG.'); }} />}
    <input ref={paletteInput} type="file" accept=".json,application/json" hidden aria-label="Файл палитры" onChange={event => { void openFile(event.target.files?.[0], 'palette'); event.target.value = ''; }} />
    {toast && <div className="toast" role="status"><CheckCheck size={17} /><span>{toast}</span><button aria-label="Закрыть уведомление" onClick={() => setToast('')}><X size={14} /></button></div>}
    {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><section className="help-dialog" role="dialog" aria-modal="true" aria-label="Горячие клавиши" onClick={event => event.stopPropagation()}><div className="section-title"><h2>Быстрее с клавиатурой</h2><IconButton icon={X} label="Закрыть подсказки" onClick={() => setShowHelp(false)} /></div><Shortcut keys="Ctrl / ⌘ + Z">Отменить</Shortcut><Shortcut keys="Ctrl / ⌘ + Shift + Z">Повторить</Shortcut><Shortcut keys="Ctrl / ⌘ + D">Дублировать предмет</Shortcut><Shortcut keys="Ctrl / ⌘ + S">Скачать проект</Shortcut><Shortcut keys="← ↑ ↓ →">Переместить на 1 пиксель</Shortcut><Shortcut keys="Shift + стрелки">Переместить на 10 пикселей</Shortcut><Shortcut keys="Delete">Удалить предмет</Shortcut><Shortcut keys="Esc">Снять выделение</Shortcut><p className="field-hint">Проект автоматически сохраняется в этом браузере. Скачайте JSON проекта, чтобы перенести его на другое устройство.</p></section></div>}
  </div>;
}

function Shortcut({ keys, children }: { keys: string; children: ReactNode }) { return <div className="shortcut"><span>{children}</span><kbd>{keys}</kbd></div>; }
