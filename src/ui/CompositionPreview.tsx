import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import type { Catalog } from '../library/types.js';
import { canvasSize, type Scene } from '../editor/model.js';
import { exportSvg, type AssetTexts } from '../editor/svg.js';

export function CompositionPreview({ catalog, texts, scene, onClose }: { catalog: Catalog; texts: AssetTexts; scene: Scene; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const { width, height } = canvasSize(catalog, scene);
  const markup = useMemo(() => {
    const doc = new DOMParser().parseFromString(exportSvg(catalog, texts, scene, 'fullscreen-'), 'image/svg+xml');
    doc.documentElement.setAttribute('width', '100%');
    doc.documentElement.setAttribute('height', '100%');
    doc.documentElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return new XMLSerializer().serializeToString(doc.documentElement);
  }, [catalog, texts, scene]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <section className="composition-preview" role="dialog" aria-modal="true" aria-labelledby="composition-preview-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus(); }
  }}>
    <header><div><h2 id="composition-preview-title">{scene.name || 'Новая иллюстрация'}</h2><p>{width} × {height} · {scene.size} · Просмотр композиции</p></div><button ref={closeButton} className="button secondary" onClick={onClose} aria-label="Закрыть полноэкранный просмотр"><X size={18} /><span>Закрыть · Esc</span></button></header>
    <div className="composition-preview-stage"><div className="composition-preview-artwork" role="img" aria-label="Композиция на весь экран" dangerouslySetInnerHTML={{ __html: markup }} /></div>
  </section>;
}
