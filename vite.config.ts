/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// ★APIキーは開発サーバー（Node側）だけが持つ。ブラウザには渡さない。
//   静的ホスティングでキーをクライアントに置くと、開発者ツールで誰でも読めるうえ、
//   Git の履歴にも永久に残る。顧客の本番MESのキーなので、漏れたら事故になる。
//
//   Smart Craft API は CORS ヘッダーを返さない（実測で確認済み）ので、
//   ブラウザから直接は呼べない。この中継が CORS も同時に解決する。
// ★本番と検証環境でホストが違う。
//   トークンは発行した環境でしか通らない（検証環境で発行したキーを本番に投げると401）。
//   .env.local の SMARTCRAFT_API_BASE で切り替える。
const DEFAULT_API_BASE = 'https://api.smartcraft.jp/api/v1'
// 検証環境: https://api.staging.smartcraft.jp/api/v1

export default defineConfig(({ mode }) => {
  // 第3引数を '' にすると VITE_ 接頭辞なしの変数も読める。
  // ★ここで読んだ値は Node 側にだけ置く。client には渡さない。
  //
  // ★process.cwd() を使わない。
  //   `node vite.js <プロジェクト>` のように別の場所から起動されると、
  //   cwd が起動元（例 C:\Users\taise）になり、.env.local を見つけられない。
  //   実際にそれで「キーを書いたのに 401」になった。
  //   この設定ファイル自身の場所を基準にする。
  const projectRoot = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, projectRoot, '')
  const apiKey = env.SMARTCRAFT_API_KEY ?? ''
  const apiBase = env.SMARTCRAFT_API_BASE || DEFAULT_API_BASE

  return {
  // GitHub Pages は https://<user>.github.io/<リポジトリ名>/ で配信されるため、
  // 資産の参照先をその下に揃える。ここが '/' のままだと本番で真っ白になる。
  base: process.env.GITHUB_ACTIONS ? '/factory-stagnation-map/' : '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  server: {
    proxy: {
      '/api/smartcraft': {
        target: apiBase,
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/smartcraft/, ''),
        configure: proxy => {
          proxy.on('proxyReq', proxyReq => {
            // キーは .env.local（Gitに入れない）から読む。ブラウザには出さない
            if (apiKey) proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
            // 値は出さず、付いたかどうかだけを開発サーバーのログに出す
            console.log(
              `[中継] ${proxyReq.path} → Authorization ${apiKey ? `付与（キー${apiKey.length}文字）` : '未付与'}`
            )
          })
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log(`[中継] ${req.url} ← HTTP ${proxyRes.statusCode}`)
          })
          proxy.on('error', err => {
            console.log(`[中継] エラー: ${err.message}`)
          })
        },
      },
    },
  },
  // テストは「純粋ロジックだけ」を対象にする。
  // 計算式の正しさがこのアプリの商品価値そのものなので、そこにテストを集中させる。
  // 画面に出るものは実ブラウザで確認する（型が通った・テストが緑は動作確認の代わりにならない）。
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  }
})
