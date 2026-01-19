/**
 * Minimal ESLint configuration for backend
 */
module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // Relax rules for existing codebase
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
  ignorePatterns: [
    'node_modules/',
    'coverage/',
    'logs/',
  ],
  overrides: [
    {
      // k6 load test files
      files: ['load-tests/**/*.js'],
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
      },
    },
  ],
};
