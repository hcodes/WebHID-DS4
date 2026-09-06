import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist/**', 'dist-pages/**', '.parcel-cache/**', 'coverage/**']),
  {
    files: ['**/*.{js,mjs,ts,vue}'],
    extends: [js.configs.recommended]
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended]
  },
  vue.configs['flat/essential'],
  {
    files: ['src/**/*.ts', 'demo/**/*.{js,vue}'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['*.mjs', 'test/**/*.ts'],
    languageOptions: { globals: globals.node }
  }
])
