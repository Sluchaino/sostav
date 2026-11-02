import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectSvg, normalizeColor } from './svg.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const json = async name => JSON.parse(await readFile(path.join(ROOT, name), 'utf8'));
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const sourceMap = await json('library/source-map.json');
const palettes = await json('library/palettes.json');
const output = new Map();
const sourceHashes = {};
const seenIds = new Set();
const assets = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
function safeSource(relative) {
  const full = path.resolve(ROOT, relative);
  const libraryRoot = path.resolve(ROOT, 'Библиотека компонентов') + path.sep;
  assert(full.startsWith(libraryRoot), 'Source outside original library: ' + relative);
  return full;
}
async function source(relative) {
  const bytes = await readFile(safeSource(relative));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  sourceHashes[relative] = sha256;
  return { bytes, sha256, svg: inspectSvg(bytes.toString('utf8')) };
}
function paintRoles(svg, scheme, target) {
  return Object.fromEntries(svg.colors.map(color => {
    const matches = Object.entries(scheme.colors).filter(([, value]) => normalizeColor(value) === color);
    assert(matches.length === 1, 'Unknown or ambiguous source paint: ' + color);
    const role = matches[0][0];
    assert(palettes.roles[role]?.targets.includes(target), `Paint role ${role} not permitted in ${target}`);
    return [color, role];
  }));
}
async function asset(relative, outputPath, scheme, target) {
  const { bytes, sha256, svg } = await source(relative);
  assert(!output.has(outputPath), 'Duplicate asset path: ' + outputPath);
  output.set(outputPath, bytes);
  const entry = { url: '/' + outputPath.replace(/^public\//, ''), source: relative, sha256, bytes: bytes.length, ...svg, paintRoles: paintRoles(svg, scheme, target) };
  assets.push(entry);
  return entry;
}

const paletteIds = new Set();
const base = palettes.schemes.find(s => s.id === palettes.basePaletteId);
assert(base, 'Base palette not found');
for (const scheme of palettes.schemes) {
  assert(/^[a-z][a-z0-9-]*$/.test(scheme.id) && !paletteIds.has(scheme.id), 'Invalid/duplicate palette id');
  paletteIds.add(scheme.id);
  assert(Object.keys(scheme.colors).length === Object.keys(palettes.roles).length, 'Incomplete palette: ' + scheme.id);
  for (const role of Object.keys(palettes.roles)) {
    assert(/^#[0-9A-F]{6}$/.test(scheme.colors[role] ?? ''), 'Invalid palette role: ' + role);
    assert(palettes.roles[role].editable || scheme.colors[role] === base.colors[role], 'Fixed palette role changed: ' + role);
  }
  for (const size of scheme.sourceSwatches ? ['S', 'L'] : []) {
    const relative = `Библиотека компонентов/Размер ${size}/Фон/${scheme.sourceSwatches[size]}`;
    const swatch = await source(relative);
    assert([...new Set(Object.values(scheme.colors))].every(color => swatch.svg.colors.includes(color)), 'Swatch does not match palette: ' + relative);
  }
}
const objects = [];
for (const item of sourceMap.objects) {
  assert(/^[a-z][a-z0-9-]*$/.test(item.id) && !seenIds.has(item.id), 'Invalid/duplicate object id: ' + item.id);
  seenIds.add(item.id);
  assert(item.tags.length > 0, 'Missing semantic tags: ' + item.id);
  const variants = {};
  for (const size of ['S', 'L']) {
    variants[size] = {};
    for (const role of ['main', 'secondary']) {
      variants[size][role] = await asset(item.variants[size][role], `public/library/objects/${item.id}/${size}/${role}.svg`, base, 'object');
    }
    const main = variants[size].main;
    const secondary = variants[size].secondary;
    assert(JSON.stringify(main.viewBox) === JSON.stringify(secondary.viewBox), `Role variants have incompatible frames: ${item.id}/${size}`);
    assert(main.width === secondary.width && main.height === secondary.height, `Role variants have incompatible sizes: ${item.id}/${size}`);
  }
  objects.push({ id: item.id, name: item.name, tags: item.tags, detailStatus: item.detailStatus, note: item.note, variants });
}
const backgrounds = [];
for (const scheme of palettes.schemes) {
  const variants = {};
  for (const size of ['S', 'L']) {
    // Additional schemes need only role colors. Reuse base geometry unchanged;
    // the editor will apply paintRoles, rather than generating a new object.
    const sourceScheme = scheme.sourceBackground ? scheme : base;
    const relative = `Библиотека компонентов/Размер ${size}/Фон/${sourceScheme.sourceBackground}`;
    variants[size] = await asset(relative, `public/library/backgrounds/${scheme.id}/${size}.svg`, sourceScheme, 'background');
    const frame = sourceMap.sizes[size].referenceFrame;
    assert(variants[size].width === frame.width && variants[size].height === frame.height, 'Unexpected background frame: ' + relative);
  }
  backgrounds.push({ id: scheme.id, name: scheme.name, paletteId: scheme.id, variants });
}
const warnings = [
  { code: 'SIZE_MAPPING_ASSUMED', message: 'Логические предметы S берутся из исходной L, L — из исходной S. Фоны сохраняют исходные S/L. Соответствие рабочее, не подтверждённое автором.', objects: objects.map(o => o.id) },
  { code: 'SECONDARY_NOT_SIMPLIFIED', message: 'Фоновые версии в обеих размерных группах сохраняют подробную геометрию. При смене роли использовать исходный файл целиком.', objects: objects.map(o => o.id) },
  { code: 'NO_DISTINCT_DETAIL_PAIR', message: 'У части предметов не подтверждена отдельная упрощённая геометрия.', objects: objects.filter(o => o.detailStatus === 'no-proven-simplified-pair').map(o => o.id) },
  { code: 'COLOR_ROLES_INFERRED', message: 'Редактируемые роли назначены по двум колонкам образцов и использованию в фонах. Чёрный и белый сохранены как фиксированные нейтральные цвета; правила требуют визуального согласования.' },
];
const catalog = {
  schemaVersion: 1,
  basePaletteId: palettes.basePaletteId,
  sizeMappingStatus: sourceMap.sizeMappingStatus,
  sizes: sourceMap.sizes,
  formats: [{ id: 'square', width: 1000, height: 1000 }, { id: 'landscape', width: 1200, height: 630 }, { id: 'portrait', width: 800, height: 1200 }],
  geometryPolicy: { preservePaths: true, preserveRelativeSizes: true, independentObjectScaling: false, coordinateSpace: 'source-viewBox', sceneScaling: 'uniform', allowRotation: true },
  colorRoles: palettes.roles,
  palettes: palettes.schemes.map(({ id, name, colors }) => ({ id, name, colors })),
  objects, backgrounds, warnings,
};
output.set('public/library/catalog.json', serialize(catalog));
output.set('library/source-integrity.json', serialize({ algorithm: 'sha256', files: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b, 'en'))) }));
output.set('library/validation-report.json', serialize({ valid: true, objectCount: objects.length, objectVariantCount: objects.length * 4, backgroundCount: backgrounds.length, backgroundVariantCount: backgrounds.length * 2, paletteCount: palettes.schemes.length, sourceFileCount: Object.keys(sourceHashes).length, exportedAssetCount: assets.length, warnings }));

// Validate everything before writing any generated file. SVG bytes are copied exactly.
let mismatches = 0;
for (const [relative, value] of output) {
  const expected = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const full = path.join(ROOT, relative);
  if (check) {
    const actual = await readFile(full).catch(() => null);
    if (!actual?.equals(expected)) { console.error('Outdated or missing: ' + relative); mismatches++; }
  } else {
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, expected);
  }
}
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const result = [];
  for (const entry of entries) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(name)); else result.push(path.relative(ROOT, name).split(path.sep).join('/'));
  }
  return result;
}
for (const name of await walk(path.join(ROOT, 'public/library'))) {
  if (!output.has(name)) { console.error('Unexpected generated asset (remove or add to source map): ' + name); mismatches++; }
}
assert(mismatches === 0, `${mismatches} generated file(s) differ; review sources and run npm run library:build`);
console.log(`${check ? 'Verified' : 'Built'}: ${objects.length} objects, ${assets.length} SVG assets, ${palettes.schemes.length} palettes. ${warnings.length} documented warnings.`);
