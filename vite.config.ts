/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // テストは「純粋ロジックだけ」を対象にする。
  // 計算式の正しさがこのアプリの商品価値そのものなので、そこにテストを集中させる。
  // 画面に出るものは実ブラウザで確認する（型が通った・テストが緑は動作確認の代わりにならない）。
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
