import { describe, expect, it } from 'vitest';
import { directoryListingUrl, parseDirectoryListing } from '../features/studio/directory-picker-model';

describe('server directory picker data', () => {
  it('requests the default allowed root and encodes a navigated path', () => {
    expect(directoryListingUrl()).toBe('/api/runtime/directories');
    expect(directoryListingUrl('/srv/repo with space')).toBe('/api/runtime/directories?path=%2Fsrv%2Frepo%20with%20space');
  });

  it('accepts only a well-formed listing and keeps server-provided paths intact', () => {
    expect(parseDirectoryListing({
      roots: ['/srv/work'], path: '/srv/work/project', parentPath: '/srv/work',
      directories: [{ name: 'src', path: '/srv/work/project/src' }], truncated: false,
    })).toEqual({
      roots: ['/srv/work'], path: '/srv/work/project', parentPath: '/srv/work',
      directories: [{ name: 'src', path: '/srv/work/project/src' }], truncated: false,
    });
    expect(() => parseDirectoryListing({ roots: [], path: '../outside', parentPath: null, directories: [] })).toThrow('directory_listing_invalid');
  });
});
