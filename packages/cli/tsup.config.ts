import { cpSync, rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: { index: 'src/index.ts', bin: 'src/bin.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    dts: { entry: { index: 'src/index.ts' } },
    clean: true,
    splitting: true,
    // The agent skill's only source is <repo>/skills; ship a build-time copy (gitignored) for `skill install`.
    onSuccess: async () => {
        rmSync('skills', { recursive: true, force: true });
        cpSync('../../skills', 'skills', { recursive: true });
    }
});
