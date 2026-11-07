import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      curly: ['error', 'all'],
      'object-curly-newline': [
        'error',
        {
          ObjectExpression: {
            minProperties: 2,
            consistent: true,
          },
        },
      ],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: { globals: { process: 'readonly' } },
  },
);
