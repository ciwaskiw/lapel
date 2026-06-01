import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { sourceType: 'module' } },
    rules: {},
  },
  {
    // SDK and agent import ban applies ONLY to the deterministic core (Spec §4 module list).
    files: [
      'src/config.ts',
      'src/db/**/*.ts',
      'src/profile/schema.ts',
      'src/profile/store.ts',
      'src/profile/pdf.ts',
      'src/sources/**/*.ts',
      'src/ingest/**/*.ts',
      'src/ui/**/*.ts',
      'src/scoring/rubric.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@anthropic-ai/sdk',
              message:
                'Deterministic core must not import the Anthropic SDK; go through src/agent (Spec Principle 1).',
            },
            {
              name: '@anthropic-ai/claude-agent-sdk',
              message:
                'Deterministic core must not import the Agent SDK; go through src/agent (Spec Principle 1).',
            },
          ],
          patterns: [
            {
              group: ['**/agent', '**/agent/**'],
              message: 'Deterministic core must not import agent/LLM code (Spec Principle 1).',
            },
          ],
        },
      ],
    },
  },
  prettier,
];
