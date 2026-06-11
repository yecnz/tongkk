import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.claude']),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // 마운트 시 로딩 플래그/초기화를 effect에서 동기 setState하는 의도된 패턴이 코드베이스에 있어 비활성화.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['src/common.tsx', 'src/CourseContext.tsx', 'src/AuthContext.tsx', 'src/ToastContext.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // 빌드/검사 보조 스크립트는 Node 환경에서 돈다(예: scripts/check-inline-hex.mjs).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
