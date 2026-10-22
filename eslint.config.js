// ESLint configuration (npm run lint): the recommended rules for the Node.js server code and for the
// browser script in public/js, which runs without a build step. Every function also stays at a cyclomatic
// complexity of 15 or less (McCabe): at most 15 independent paths, so each one can still be tested
// (docs/TESTING.md, "Basis path testing").
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      complexity: ['error', 15],
    },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
];
