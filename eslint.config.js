import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: { sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint, boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'core', pattern: 'src/(config|db|profile|sources|ingest|ui)/**' },
        { type: 'core', pattern: 'src/config.ts', mode: 'file' },
        { type: 'agent', pattern: 'src/agent/**' },
        { type: 'commands', pattern: 'src/commands/**' },
        { type: 'cli', pattern: 'src/cli.ts', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/element-types': ['error', {
        default: 'allow',
        rules: [
          { from: 'core', disallow: ['agent'], message: 'Deterministic core must not import agent/LLM code (Spec Principle 1).' },
        ],
      }],
    },
  },
  {
    // SDK import ban applies ONLY to the deterministic core (Spec §4 module list).
    files: [
      'src/config.ts', 'src/db/**/*.ts', 'src/profile/schema.ts', 'src/profile/store.ts',
      'src/profile/pdf.ts', 'src/sources/**/*.ts', 'src/ingest/**/*.ts', 'src/ui/**/*.ts',
      'src/scoring/rubric.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@anthropic-ai/sdk', message: 'Deterministic core must not import the Anthropic SDK; go through src/agent (Spec Principle 1).' },
          { name: '@anthropic-ai/claude-agent-sdk', message: 'Deterministic core must not import the Agent SDK; go through src/agent (Spec Principle 1).' },
        ],
      }],
    },
  },
  prettier,
];
