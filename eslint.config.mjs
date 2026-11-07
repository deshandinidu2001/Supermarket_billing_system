import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config(
  {
    ignores: [
      '**/dist/**',
      'dist-electron/**',
      'release/**',
      '**/node_modules/**',
      '**/build-check/**',
      '**/.expo/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node, __DEV__: 'readonly' } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/mobile/metro.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
