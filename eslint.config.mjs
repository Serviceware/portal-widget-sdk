import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/coverage/**',
            // Scaffold templates and prebuilt bundles are shipped payload, not this repo's code.
            'packages/cli/assets/**',
            // Example build outputs (bundles and the bundled dev harness).
            'examples/**/bundles/**',
            'examples/**/dev/*.js',
            // Verbatim Portal snapshots; never edited here.
            'reference/**'
        ]
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.mjs'],
        languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } }
    }
);
