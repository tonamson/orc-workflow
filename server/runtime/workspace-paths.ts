import { opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_DIRECTORY_ENTRIES = 200;
const MAX_DIRECTORY_SCAN = 20_000;

export type WorkspaceDirectoryListing = {
  roots: string[];
  path: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
  truncated: boolean;
};

export function workspaceRoots(): string[] {
  const configured = process.env.ORC_WORKSPACE_ROOTS?.split(path.delimiter).filter(Boolean);
  return configured?.length ? configured : [process.cwd()];
}

export function isInsideWorkspaceRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function canonicalWorkspace(candidate: unknown): Promise<string> {
  if (typeof candidate !== 'string' || candidate.length > 2048 || !path.isAbsolute(candidate)) throw new Error('invalid_workspace_path');
  let canonical: string;
  try {
    canonical = await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' || (error as NodeJS.ErrnoException)?.code === 'ENOTDIR') {
      throw new Error('workspace_directory_not_found');
    }
    throw error;
  }
  if (!(await stat(canonical)).isDirectory()) throw new Error('workspace_not_directory');
  const roots = await Promise.all(workspaceRoots().map(root => realpath(root).catch(() => path.resolve(root))));
  if (!roots.some(root => isInsideWorkspaceRoot(root, canonical))) throw new Error('workspace_path_outside_allowed_roots');
  return canonical;
}

async function canonicalRoots(): Promise<string[]> {
  const roots = await Promise.all(workspaceRoots().map(async root => {
    try {
      const canonical = await realpath(root);
      return (await stat(canonical)).isDirectory() ? canonical : null;
    } catch {
      return null;
    }
  }));
  return [...new Set(roots.filter((root): root is string => root !== null))].sort((a, b) => a.localeCompare(b));
}

export async function listWorkspaceDirectories(candidate?: unknown): Promise<WorkspaceDirectoryListing> {
  const roots = await canonicalRoots();
  if (roots.length === 0) throw new Error('workspace_roots_unavailable');
  const currentPath = await canonicalWorkspace(candidate === undefined ? roots[0] : candidate);
  const parent = path.dirname(currentPath);
  const parentPath = parent !== currentPath && roots.some(root => isInsideWorkspaceRoot(root, parent)) ? parent : null;

  const directory = await opendir(currentPath);
  const directories: Array<{ name: string; path: string }> = [];
  let scanned = 0;
  let truncated = false;
  for await (const entry of directory) {
    scanned += 1;
    if (scanned > MAX_DIRECTORY_SCAN) {
      truncated = true;
      break;
    }
    if (!entry.name.startsWith('.') && entry.isDirectory()) {
      directories.push({ name: entry.name, path: path.join(currentPath, entry.name) });
    }
  }
  directories.sort((a, b) => a.name.localeCompare(b.name));
  if (directories.length > MAX_DIRECTORY_ENTRIES) truncated = true;

  return {
    roots,
    path: currentPath,
    parentPath,
    directories: directories.slice(0, MAX_DIRECTORY_ENTRIES),
    truncated,
  };
}
