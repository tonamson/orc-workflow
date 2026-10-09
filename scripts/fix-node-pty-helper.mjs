import { chmod, access } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';

if (process.platform !== 'win32') {
  const packageRoot = path.join(process.cwd(), 'node_modules', 'node-pty');
  const candidates = [
    path.join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    path.join(packageRoot, 'build', 'Release', 'spawn-helper'),
  ];
  for (const helper of candidates) {
    try {
      await access(helper, constants.F_OK);
      await chmod(helper, 0o755);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') throw error;
    }
  }
}
