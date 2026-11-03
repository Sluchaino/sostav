import { useId, useState } from 'react';
import { MAX_CANVAS_DIMENSION, validateCanvasSize } from '../editor/model.js';

export function CanvasSizeForm({ width, height, onApply, onClose }: {
  width: number; height: number;
  onApply: (dimensions: { width: number; height: number }) => void;
  onClose: () => void;
}) {
  const [draftWidth, setWidth] = useState(String(width));
  const [draftHeight, setHeight] = useState(String(height));
  const [error, setError] = useState('');
  const hintId = useId();
  const errorId = useId();
  return <form className="canvas-size-form" aria-label="Свой размер холста" noValidate onSubmit={event => {
    event.preventDefault();
    const dimensions = { width: Number(draftWidth), height: Number(draftHeight) };
    try { validateCanvasSize(dimensions); }
    catch (error) { setError(error instanceof Error ? error.message : 'Неверный размер'); return; }
    onApply(dimensions);
  }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div className="canvas-size-fields">
      <label>Ширина, px<input autoFocus type="number" inputMode="numeric" min="1" max={MAX_CANVAS_DIMENSION} step="1" aria-label="Ширина холста" aria-describedby={error ? `${hintId} ${errorId}` : hintId} aria-invalid={!!error} value={draftWidth} onChange={event => { setWidth(event.target.value); setError(''); }} /></label>
      <span aria-hidden="true">×</span>
      <label>Высота, px<input type="number" inputMode="numeric" min="1" max={MAX_CANVAS_DIMENSION} step="1" aria-label="Высота холста" aria-describedby={error ? `${hintId} ${errorId}` : hintId} aria-invalid={!!error} value={draftHeight} onChange={event => { setHeight(event.target.value); setError(''); }} /></label>
      <button className="button primary" type="submit">Применить размер</button>
      <button className="button quiet" type="button" onClick={onClose}>Отмена</button>
    </div>
    <p id={hintId}>От 1 до {MAX_CANVAS_DIMENSION} px. Детализация S/L выбирается отдельно.</p>
    {error && <p className="canvas-size-error" id={errorId} role="alert">{error}</p>}
  </form>;
}
