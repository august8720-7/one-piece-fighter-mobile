import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // AGENTS.md 硬约束 1 / 3：core 层不得依赖 Phaser、浏览器 API、非确定性来源
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['phaser'], patterns: ['@render/*', '@input/*'] }],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'performance',
        'requestAnimationFrame',
        'localStorage',
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'core 只能用 Rng（可种子）' },
        { object: 'Date', property: 'now', message: 'core 不得读取真实时间' },
      ],
    },
  },
);
