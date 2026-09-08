import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path of this package's root -- the directory holding `package.json`
 * and the checked-in `assets/` payload (embed bundles, scaffold templates).
 *
 * Resolved one level above this module's own directory, which holds in both
 * places the code runs from: `src/` when vitest executes the TypeScript
 * sources, and `dist/` once tsup has bundled them. Both sit directly under the
 * package root, so `..` lands on it either way. The `assets/` directory is
 * shipped as-is next to `dist/` (see `files` in package.json), never copied
 * into the build output.
 */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
