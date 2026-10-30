const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        require: 'readonly',
        console: 'readonly',
        URLSearchParams: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly'
      },
    },
    rules: {
      indent: ['error', 2],
      quotes: ['error', 'single'],
      semi: ['error', 'always'],
      'object-curly-spacing': ['warn', 'always'],
      'no-unused-vars': 'warn',
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'cjs-import', next: '*' },
        { blankLine: 'any', prev: 'cjs-import', next: 'cjs-import' }
      ],
    },
  },
];
