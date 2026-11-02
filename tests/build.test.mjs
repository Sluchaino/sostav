import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

test('isolated build accepts a fourth palette without new SVG and detects stale output', async () => {
  const tempRoot = path.resolve(os.tmpdir());
  const fixture = await mkdtemp(path.join(tempRoot, 'illustration-library-test-'));
  const copy = async relative => {
    const destination = path.join(fixture, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, relative), destination);
  };
  const run = (...args) => execFileSync(process.execPath, ['scripts/build-library.mjs', ...args], { cwd: fixture, encoding: 'utf8', stdio: 'pipe' });
  try {
    for (const name of ['scripts/build-library.mjs', 'scripts/svg.mjs', 'library/source-map.json', 'library/palettes.json']) await copy(name);
    const integrity = JSON.parse(await readFile(path.join(root, 'library/source-integrity.json'), 'utf8'));
    for (const name of Object.keys(integrity.files)) await copy(name);
    await cp(path.join(root, 'node_modules/@xmldom/xmldom'), path.join(fixture, 'node_modules/@xmldom/xmldom'), { recursive: true });
    const configPath = path.join(fixture, 'library/palettes.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const extra = structuredClone(config.schemes[0]);
    extra.id = 'custom'; extra.name = 'Новая схема'; extra.colors['background.base'] = '#ABCDEF';
    delete extra.sourceBackground; delete extra.sourceSwatches;
    config.schemes.push(extra);
    await writeFile(configPath, JSON.stringify(config));
    assert.match(run(), /4 palettes/);
    assert.match(run('--check'), /Verified/);
    const catalog = JSON.parse(await readFile(path.join(fixture, 'public/library/catalog.json'), 'utf8'));
    assert.equal(catalog.palettes.length, 4);
    const customBackground = catalog.backgrounds.find(b => b.id === 'custom');
    assert.equal(customBackground.variants.S.paintRoles['#D7CDF5'], 'background.base');
    assert.equal(customBackground.variants.S.source, 'Библиотека компонентов/Размер S/Фон/Фон.svg');
    await writeFile(path.join(fixture, 'public/library/backgrounds/custom/S.svg'), '<svg/>');
    assert.throws(() => run('--check'), /Outdated or missing/);
    run();
    await writeFile(path.join(fixture, 'public/library/extra.svg'), '<svg/>');
    assert.throws(() => run('--check'), /Unexpected generated asset/);
  } finally {
    // Only remove the exact temporary directory created above, never a computed source path.
    assert.equal(path.dirname(path.resolve(fixture)), tempRoot);
    assert.ok(path.basename(fixture).startsWith('illustration-library-test-'));
    await rm(fixture, { recursive: true, force: true });
  }
});
