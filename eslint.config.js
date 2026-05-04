const tsParser = require('@typescript-eslint/parser');

const noopRule = {
  create() {
    return {};
  },
};

module.exports = [
  {
    ignores: [
      '_tmp/**',
      '_cmake_test/**',
      'android/ndk/**',
      'android/**/build/**',
      'node_modules/**',
    ],
  },
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      '@typescript-eslint': {
        rules: {
          'no-var-requires': noopRule,
        },
      },
      'react-hooks': {
        rules: {
          'exhaustive-deps': noopRule,
        },
      },
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': {
        rules: {
          'no-var-requires': noopRule,
        },
      },
      'react-hooks': {
        rules: {
          'exhaustive-deps': noopRule,
        },
      },
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
];
