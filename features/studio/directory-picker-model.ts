export type ServerDirectoryListing = {
  roots: string[];
  path: string;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
  truncated?: boolean;
};

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/');
}

export function directoryListingUrl(path?: string): string {
  return path ? `/api/runtime/directories?path=${encodeURIComponent(path)}` : '/api/runtime/directories';
}

export function parseDirectoryListing(value: unknown): ServerDirectoryListing {
  if (!value || typeof value !== 'object') throw new Error('directory_listing_invalid');
  const listing = value as Record<string, unknown>;
  if (!isAbsolutePath(listing.path) || !Array.isArray(listing.roots) || !listing.roots.length
    || !listing.roots.every(isAbsolutePath)
    || (listing.parentPath !== null && !isAbsolutePath(listing.parentPath))
    || !Array.isArray(listing.directories)
    || !listing.directories.every(item => item && typeof item === 'object'
      && typeof (item as Record<string, unknown>).name === 'string'
      && isAbsolutePath((item as Record<string, unknown>).path))
    || (listing.truncated !== undefined && typeof listing.truncated !== 'boolean')) {
    throw new Error('directory_listing_invalid');
  }
  return {
    roots: listing.roots as string[],
    path: listing.path,
    parentPath: listing.parentPath as string | null,
    directories: listing.directories as ServerDirectoryListing['directories'],
    ...(listing.truncated === undefined ? {} : { truncated: listing.truncated as boolean }),
  };
}
