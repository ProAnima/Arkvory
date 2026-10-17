import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const sourceFiles = ['apps/**/*.ts', 'packages/**/*.ts'];

export default [
  {
    // The declarations report of the extension API is a reviewed snapshot of built output.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/extension-api/api-report.d.ts',
    ],
  },
  { ...js.configs.recommended, files: sourceFiles },
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: sourceFiles })),
  {
    files: sourceFiles,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          'ts-expect-error': true,
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@proanima/arkvory-*/*'], message: 'Use the public workspace entry.' },
          ],
        },
      ],
    },
  },
  {
    files: [
      'packages/domain/**/*.ts',
      'packages/application/**/*.ts',
      'packages/contracts/**/*.ts',
      'packages/extension-api/**/*.ts',
      'packages/sdk/**/*.ts',
      'apps/web/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@proanima/arkvory-*/*'], message: 'Use the public workspace entry.' },
            { group: ['node:*'], message: 'This layer must not depend on Node.js APIs.' },
          ],
        },
      ],
    },
  },
];
