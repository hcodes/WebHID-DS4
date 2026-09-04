import { defineConfig } from 'rolldown'

export default defineConfig({
  input: './src/index.ts',
  output: { file: 'dist/webhid-ds4.js', format: 'esm' }
})
