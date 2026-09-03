import { defineConfig, globalIgnores } from 'eslint/config'
import { tanstackConfig } from '@tanstack/eslint-config'
import convexPlugin from '@convex-dev/eslint-plugin'

export default defineConfig([
  ...tanstackConfig,
  ...convexPlugin.configs.recommended,
  // `.agents/skills` holds upstream skill content vendored verbatim, including
  // illustrative .tsx examples that live outside any tsconfig project — linting
  // them only produces parser errors. Kept in sync with `.prettierignore`.
  globalIgnores([
    'convex/_generated',
    // Generated from docs/produit by scripts/gen-product-docs.mjs (gitignored;
    // flat config does not read .gitignore, unlike Prettier).
    'convex/lib/productDocs.generated.ts',
    '.output',
    '.nitro',
    'prettier.config.js',
    '.agents/skills',
    '.claude/skills',
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
