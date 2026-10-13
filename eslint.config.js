import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'research/**',
      'content/**',
      'docs/**',
      'scripts/**',
      'benchmarks/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The engine runs in the browser and in Node: no Node built-ins and no host globals outside
    // cli/ and tests. XML goes through @xmldom/xmldom (imported in io/musicxml/dom.ts), which is
    // why DOMParser and XMLSerializer are restricted as globals but not as imports.
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'child_process'],
              message: 'Engine code must run in the browser; Node APIs belong in cli/.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['process', 'window', 'document', 'DOMParser', 'XMLSerializer'].map((name) => ({
          name,
          message: 'Engine code must not depend on a host global; see io/musicxml/dom.ts for XML.',
        })),
      ],
    },
  },
);
