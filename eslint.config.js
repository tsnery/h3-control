const js = require('@eslint/js')
const reactHooks = require('eslint-plugin-react-hooks')
const tseslint = require('typescript-eslint')

module.exports = tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'probe-output/**', '.superpowers/**', 'test-results/**', 'eslint.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports. Default exports are allowed only in *.config.* files.',
        },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['**/*.config.*'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', exports: 'writable' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
