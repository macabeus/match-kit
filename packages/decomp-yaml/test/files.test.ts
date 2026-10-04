// `findDecompYaml` and `loadDecompYaml`: finding and reading a decomp.yaml on disk.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { findDecompYaml, loadDecompYaml } from '../src/files.js';
import { DecompYamlError } from '../src/index.js';

const SCRATCH = mkdtempSync(join(tmpdir(), 'match-kit-decomp-yaml-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** A decomp.yaml that meets the spec, for `platform`. */
const yaml = (platform: string) => `name: Example\nplatform: ${platform}\nversions: []\n`;

let dirs = 0;
/** A fresh directory holding `files`, each path relative to it. */
function project(files: Record<string, string>): string {
  const root = join(SCRATCH, `p${dirs++}`);
  mkdirSync(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('findDecompYaml', () => {
  it('finds a decomp.yaml in a parent directory', () => {
    const root = project({ 'decomp.yaml': yaml('gba'), 'src/battle/.keep': '' });
    expect(findDecompYaml(join(root, 'src', 'battle'))).toBe(join(root, 'decomp.yaml'));
  });

  it('finds decomp.yml when there is no decomp.yaml', () => {
    const root = project({ 'decomp.yml': yaml('gc') });
    expect(findDecompYaml(root)).toBe(join(root, 'decomp.yml'));
  });

  it('prefers decomp.yaml to decomp.yml in the same directory', () => {
    const root = project({ 'decomp.yaml': '', 'decomp.yml': '' });
    expect(findDecompYaml(root)).toBe(join(root, 'decomp.yaml'));
  });

  it('prefers the nearest directory', () => {
    const root = project({ 'decomp.yaml': '', 'sub/decomp.yml': '' });
    expect(findDecompYaml(join(root, 'sub'))).toBe(join(root, 'sub', 'decomp.yml'));
  });

  it('does not take a directory named decomp.yaml', () => {
    const root = project({ 'decomp.yaml/.keep': '', 'decomp.yml': '' });
    expect(findDecompYaml(root)).toBe(join(root, 'decomp.yml'));
  });

  it('returns null when no directory up to the root has one', () => {
    expect(findDecompYaml('/')).toBeNull();
  });
});

describe('loadDecompYaml', () => {
  it('reads the nearest decomp.yaml with its path and directory', () => {
    const root = project({ 'decomp.yaml': yaml('gba'), 'src/.keep': '' });
    expect(loadDecompYaml(undefined, join(root, 'src'))).toEqual({
      path: join(root, 'decomp.yaml'),
      dir: root,
      config: { name: 'Example', platform: 'gba', versions: [] },
    });
  });

  it('reads an explicit path without searching', () => {
    const root = project({ 'decomp.yaml': yaml('gba'), 'configs/other.yaml': yaml('n64') });
    expect(loadDecompYaml(join(root, 'configs', 'other.yaml'), root)).toEqual({
      path: join(root, 'configs', 'other.yaml'),
      dir: join(root, 'configs'),
      config: { name: 'Example', platform: 'n64', versions: [] },
    });
  });

  it('returns null when there is no decomp.yaml', () => {
    expect(loadDecompYaml(undefined, '/')).toBeNull();
  });

  it('throws when an explicit path does not exist', () => {
    const missing = join(project({}), 'nope.yaml');
    expect(() => loadDecompYaml(missing)).toThrow(new DecompYamlError(missing, 'not found'));
  });

  it('throws when an explicit path cannot be read', () => {
    const dir = project({});
    expect(() => loadDecompYaml(dir)).toThrow(/cannot be read: .*EISDIR/);
  });

  it('throws with the file path when the file is not valid', () => {
    const root = project({ 'decomp.yaml': 'name: Example\nplatform: gba\nversions: 3\n' });
    expect(() => loadDecompYaml(undefined, root)).toThrow(
      `${join(root, 'decomp.yaml')}: versions: Invalid input: expected array, received number`,
    );
  });
});
