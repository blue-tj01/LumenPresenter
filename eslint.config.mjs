// Lint rules: ESLint's recommended set, which catches mistakes (undefined names, unreachable code, duplicate keys)
// rather than style. Run with: npm run lint
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/**', 'dist/**', 'node_modules/**', 'companion-module/**', 'data/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // The server, the desktop app and the tests: CommonJS under Node.
  {
    files: ['server.js', 'server/**/*.js', 'electron/**/*.js', 'scripts/**/*.js', 'tests/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  // The pages: the console's ES modules, and the scripts the pages load as they are.
  {
    files: ['console/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser, Lumen: 'readonly', PP: 'readonly' } },
  },
  {
    files: ['render.js', 'sync.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  // Browser code run in tests by Playwright.
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, Lumen: 'readonly', PP: 'readonly' } },
  },
];
