import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../app/api/runtime/directories/route';
import { listWorkspaceDirectories } from '../server/runtime/workspace-paths';

const previousRoots = process.env.ORC_WORKSPACE_ROOTS;
const tempRoots: string[] = [];

async function tempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  if (previousRoots === undefined) delete process.env.ORC_WORKSPACE_ROOTS;
  else process.env.ORC_WORKSPACE_ROOTS = previousRoots;
  await Promise.all(tempRoots.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('workspace directory listing', () => {
  it('lists only sorted visible directories and supplies the configured root by default', async () => {
    const root = await tempDir('orc-picker-root-');
    await mkdir(path.join(root, 'zeta'));
    await mkdir(path.join(root, 'alpha'));
    await mkdir(path.join(root, '.hidden-dir'));
    await writeFile(path.join(root, 'file.txt'), 'must not be exposed');
    process.env.ORC_WORKSPACE_ROOTS = root;

    const listing = await listWorkspaceDirectories();

    const canonicalRoot = await realpath(root);
    const canonicalAlpha = await realpath(path.join(root, 'alpha'));
    const canonicalZeta = await realpath(path.join(root, 'zeta'));
    expect(listing.roots).toEqual([canonicalRoot]);
    expect(listing.path).toBe(canonicalRoot);
    expect(listing.parentPath).toBeNull();
    expect(listing.directories).toEqual([
      { name: 'alpha', path: canonicalAlpha },
      { name: 'zeta', path: canonicalZeta },
    ]);
    expect(JSON.stringify(listing)).not.toContain('must not be exposed');
  });

  it('lists a nested directory with its parent path', async () => {
    const root = await tempDir('orc-picker-nested-');
    const nested = path.join(root, 'project');
    await mkdir(path.join(nested, 'src'), { recursive: true });
    process.env.ORC_WORKSPACE_ROOTS = root;

    const listing = await listWorkspaceDirectories(nested);

    const canonicalNested = await realpath(nested);
    const canonicalRoot = await realpath(root);
    expect(listing.path).toBe(canonicalNested);
    expect(listing.parentPath).toBe(canonicalRoot);
    expect(listing.directories).toEqual([{ name: 'src', path: path.join(canonicalNested, 'src') }]);
  });

  it('rejects paths outside the configured roots and symlinks that resolve outside', async () => {
    const root = await tempDir('orc-picker-allowed-');
    const outside = await tempDir('orc-picker-outside-');
    await mkdir(path.join(outside, 'secret'));
    await symlink(outside, path.join(root, 'escape'), 'dir');
    process.env.ORC_WORKSPACE_ROOTS = root;

    await expect(listWorkspaceDirectories(outside)).rejects.toThrow('workspace_path_outside_allowed_roots');
    await expect(listWorkspaceDirectories(path.join(root, 'escape'))).rejects.toThrow('workspace_path_outside_allowed_roots');
    const listing = await listWorkspaceDirectories(root);
    expect(listing.directories).toEqual([]);
  });

  it('bounds results and indicates when more directories are available', async () => {
    const root = await tempDir('orc-picker-bounded-');
    await Promise.all(Array.from({ length: 205 }, (_, index) => mkdir(path.join(root, `dir-${String(index).padStart(3, '0')}`))));
    process.env.ORC_WORKSPACE_ROOTS = root;

    const listing = await listWorkspaceDirectories(root);

    expect(listing.directories).toHaveLength(200);
    expect(listing.truncated).toBe(true);
  });

  it('reports a missing path with a not-found error', async () => {
    const root = await tempDir('orc-picker-missing-');
    process.env.ORC_WORKSPACE_ROOTS = root;
    await expect(listWorkspaceDirectories(path.join(root, 'missing'))).rejects.toThrow('workspace_directory_not_found');
  });

  it('serves a local no-store listing and rejects non-local hosts', async () => {
    const root = await tempDir('orc-picker-route-');
    await mkdir(path.join(root, 'src'));
    process.env.ORC_WORKSPACE_ROOTS = root;

    const response = await GET(new Request('http://localhost/api/runtime/directories', { headers: { host: 'localhost' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ directories: [{ name: 'src' }] });

    const denied = await GET(new Request('http://example.com/api/runtime/directories', { headers: { host: 'example.com' } }));
    expect(denied.status).toBe(403);
  });
});
