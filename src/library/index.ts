import type { Catalog, ColorRole, IllustrationSize, ObjectRole, PaintTarget, Palette, SvgAsset } from './types.js';
export type * from './types.js';

export function selectObject(catalog: Catalog, id: string, size: IllustrationSize, role: ObjectRole): SvgAsset {
  const object = catalog.objects.find(item => item.id === id);
  const asset = object?.variants[size]?.[role];
  if (!asset) throw new Error(`Object variant not found: ${id}/${size}/${role}`);
  return asset;
}

export function selectBackground(catalog: Catalog, paletteId: string, size: IllustrationSize): SvgAsset {
  const asset = catalog.backgrounds.find(item => item.paletteId === paletteId)?.variants[size];
  if (!asset) throw new Error(`Background not found: ${paletteId}/${size}`);
  return asset;
}

const normalizeQuery = (value: string) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();

/** Literal name/tag search. Metaphor interpretation belongs to a later stage. */
export function searchObjects(catalog: Catalog, query: string) {
  const tokens = normalizeQuery(query).split(/\s+/).filter(Boolean);
  return catalog.objects.filter(item => {
    const text = normalizeQuery([item.name, ...item.tags].join(' '));
    return tokens.every(token => text.includes(token));
  });
}

export function getPalette(catalog: Catalog, id: string): Palette {
  const palette = catalog.palettes.find(item => item.id === id);
  if (!palette) throw new Error('Palette not found: ' + id);
  return palette;
}

/** Only editable roles; fixed white/ink are preserved in imported artwork. */
export function allowedColors(catalog: Catalog, palette: Palette, target: PaintTarget) {
  validatePalette(catalog, palette);
  return (Object.keys(catalog.colorRoles) as ColorRole[])
    .filter(role => catalog.colorRoles[role].editable && catalog.colorRoles[role].targets.includes(target))
    .map(role => ({ role, color: palette.colors[role], label: catalog.colorRoles[role].label }));
}

/** Complete role-based palette format for adding schemes, including custom ones. */
export function validatePalette(catalog: Catalog, value: unknown): asserts value is Palette {
  if (!value || typeof value !== 'object') throw new Error('Palette must be an object');
  const item = value as Partial<Palette>;
  if (typeof item.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(item.id)) throw new Error('Invalid palette id');
  if (typeof item.name !== 'string' || !item.name.trim()) throw new Error('Invalid palette name');
  if (!item.colors || typeof item.colors !== 'object' || Array.isArray(item.colors)) throw new Error('Palette colors are required');
  const roles = Object.keys(catalog.colorRoles) as ColorRole[];
  if (Object.keys(item.colors).length !== roles.length) throw new Error('Palette must specify exactly the known color roles');
  const base = getPalette(catalog, catalog.basePaletteId);
  for (const role of roles) {
    const color = item.colors[role];
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid color for role: ' + role);
    if (!catalog.colorRoles[role].editable && color.toUpperCase() !== base.colors[role]) throw new Error('Fixed color role cannot change: ' + role);
  }
}

/** Maps paint values only; applying replacements to SVG attributes belongs to the editor. */
export function paintSubstitutions(catalog: Catalog, asset: SvgAsset, palette: Palette, target: PaintTarget): Record<string, string> {
  validatePalette(catalog, palette);
  return Object.fromEntries(Object.entries(asset.paintRoles).map(([sourceColor, role]) => {
    if (!catalog.colorRoles[role]?.targets.includes(target)) throw new Error(`Color role ${role} is forbidden in ${target}`);
    return [sourceColor, palette.colors[role]];
  }));
}

/** Common scene transform: preserve object proportions in the chosen source coordinate system. */
export function sceneTransform(catalog: Catalog, size: IllustrationSize, width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid scene dimensions');
  const frame = catalog.sizes[size].referenceFrame;
  const scale = Math.min(width / frame.width, height / frame.height);
  return { scale, x: (width - frame.width * scale) / 2, y: (height - frame.height * scale) / 2 };
}
