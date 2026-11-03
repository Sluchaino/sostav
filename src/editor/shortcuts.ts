export type EditorShortcut = 'save' | 'undo' | 'redo' | 'duplicate' | 'escape' | 'delete' | 'left' | 'right' | 'up' | 'down';

/** Physical letter keys keep editor commands available in every keyboard layout. */
export function editorShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing' | 'defaultPrevented'>, editing = false): EditorShortcut | null {
  if (event.defaultPrevented || event.isComposing || event.altKey) return null;
  const mod = event.ctrlKey || event.metaKey;
  const code = event.code || `Key${event.key.toUpperCase()}`;
  if (mod && code === 'KeyS' && !event.shiftKey) return 'save';
  if (editing) return null;
  if (mod) {
    if (code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
    if (code === 'KeyY' && !event.shiftKey) return 'redo';
    if (code === 'KeyD' && !event.shiftKey) return 'duplicate';
    return null;
  }
  const keys: Record<string, EditorShortcut> = { Escape: 'escape', Delete: 'delete', Backspace: 'delete', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  return keys[event.key] ?? null;
}
