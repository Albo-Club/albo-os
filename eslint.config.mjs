import { defineConfig, globalIgnores } from 'eslint/config'
import { tanstackConfig } from '@tanstack/eslint-config'
import convexPlugin from '@convex-dev/eslint-plugin'

export default defineConfig([
  ...tanstackConfig,
  ...convexPlugin.configs.recommended,
  globalIgnores([
    'convex/_generated',
    '.output',
    '.nitro',
    'prettier.config.js',
  ]),
  {
    // shadcn/ui generated files — never hand-edited (see CLAUDE.md), so
    // style-level rules that would require manual edits are relaxed here.
    files: ['src/components/ui/**'],
    rules: {
      'no-shadow': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
])
