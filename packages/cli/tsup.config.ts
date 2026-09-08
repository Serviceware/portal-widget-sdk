import { defineConfig } from 'tsup';

export default defineConfig({
    entry: { index: 'src/index.ts', bin: 'src/bin.ts' },
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    dts: { entry: { index: 'src/index.ts' } },
    clean: true,
    splitting: true
});
