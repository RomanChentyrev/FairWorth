const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  crypto: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  alert: 'readonly',
};

export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },
];
