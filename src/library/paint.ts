/** Canonical paint key; alpha remains attached to the source color. */
export function normalizePaintColor(input: string): string | null {
  const named: Record<string, string> = { black: '#000000', white: '#FFFFFF', red: '#FF0000', lime: '#00FF00', blue: '#0000FF', yellow: '#FFFF00', cyan: '#00FFFF', aqua: '#00FFFF', magenta: '#FF00FF', fuchsia: '#FF00FF', silver: '#C0C0C0', gray: '#808080', grey: '#808080', maroon: '#800000', olive: '#808000', green: '#008000', purple: '#800080', teal: '#008080', navy: '#000080', orange: '#FFA500', rebeccapurple: '#663399', transparent: '#00000000' };
  const value = input.trim().toLowerCase();
  if (named[value]) return named[value]!;
  if (/^#[0-9a-f]{3,4}$/i.test(value)) return normalizePaintColor('#' + value.slice(1).split('').map(char => char + char).join(''));
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value.toUpperCase().endsWith('FF') && value.length === 9 ? value.slice(0, 7).toUpperCase() : value.toUpperCase();
  const match = value.match(/^rgba?\(([^()]+)\)$/);
  if (!match) return null;
  const parts = match[1]!.trim().split(/\s*[,/]\s*|\s+/);
  if (parts.length !== 3 && parts.length !== 4) return null;
  if (parts.some(part => !/^[+-]?(?:\d*\.)?\d+%?$/.test(part))) return null;
  const channel = (part: string, alpha = false) => Math.round(Math.max(0, Math.min(1, parseFloat(part) / (part.endsWith('%') ? 100 : alpha ? 1 : 255))) * 255).toString(16).padStart(2, '0').toUpperCase();
  const alpha = parts[3] ? channel(parts[3], true) : 'FF';
  return '#' + parts.slice(0, 3).map(part => channel(part)).join('') + (alpha === 'FF' ? '' : alpha);
}

export const PAINT_ATTRIBUTES = ['fill', 'stroke', 'stop-color', 'color', 'flood-color'];
