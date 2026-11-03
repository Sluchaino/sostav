import test from 'node:test';
import assert from 'node:assert/strict';
import { editorShortcut } from '../.build/editor/shortcuts.js';

const key = (code, key, extra = {}) => ({ code, key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, defaultPrevented: false, ...extra });

test('editor letter shortcuts work in Latin and Russian layouts with Ctrl and Command', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    for (const [code, symbols, action] of [['KeyZ', ['z', 'я'], 'undo'], ['KeyY', ['y', 'н'], 'redo'], ['KeyD', ['d', 'в'], 'duplicate'], ['KeyS', ['s', 'ы'], 'save']]) {
      for (const symbol of symbols) assert.equal(editorShortcut(key(code, symbol, { [modifier]: true })), action);
    }
    assert.equal(editorShortcut(key('KeyZ', 'Я', { [modifier]: true, shiftKey: true })), 'redo');
  }
});

test('text editing and unrelated browser shortcuts keep their native behavior', () => {
  for (const code of ['KeyZ', 'KeyY', 'KeyD']) assert.equal(editorShortcut(key(code, 'я', { ctrlKey: true }), true), null);
  for (const symbol of ['Backspace', 'Delete', 'ArrowLeft', 'Escape']) assert.equal(editorShortcut(key(symbol, symbol), true), null);
  assert.equal(editorShortcut(key('KeyS', 'ы', { ctrlKey: true }), true), 'save');
  for (const extra of [{ altKey: true }, { isComposing: true }, { defaultPrevented: true }]) assert.equal(editorShortcut(key('KeyZ', 'я', { ctrlKey: true, ...extra })), null);
  assert.equal(editorShortcut(key('KeyD', 'D', { ctrlKey: true, shiftKey: true })), null);
  assert.equal(editorShortcut(key('ArrowLeft', 'ArrowLeft', { ctrlKey: true })), null);
});

test('movement, deletion and deselection shortcuts are recognized without letter modifiers', () => {
  for (const [symbol, action] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up'], ['ArrowDown', 'down'], ['Delete', 'delete'], ['Backspace', 'delete'], ['Escape', 'escape']]) {
    assert.equal(editorShortcut(key(symbol, symbol)), action);
    assert.equal(editorShortcut(key(symbol, symbol, { shiftKey: true })), action);
  }
});
