import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        // pack/unpack specs zip the real ~1.8 MB embed bundles per test.
        testTimeout: 20000
    }
});
