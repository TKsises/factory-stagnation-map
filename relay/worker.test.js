// 中継サーバー本体のテスト。worker.js をそのまま読み込んで動かす。
import { describe, expect, it } from 'vitest'
import worker from './worker.js'

const PASS = 'ながい-あいことば-1234567890'

/** ブラウザ側と同じ形（UTF-8 → base64）。ヘッダーは1バイト文字しか運べない */
function encoded(pass) {
  return Buffer.from(pass, 'utf8').toString('base64')
}

const req = (pass, init = {}) =>
  new Request('https://relay.example.com/process_results', {
    headers: pass === null ? {} : { 'X-Relay-Passphrase': encoded(pass) },
    ...init,
  })

const FULL = {
  RELAY_PASSPHRASE: PASS,
  SMARTCRAFT_API_KEY: 'TEST-KEY',
  SMARTCRAFT_API_BASE: 'https://upstream.invalid/api/v1',
}

async function body(res) {
  return await res.json()
}

describe('確認する順番', () => {
  // ★回帰: APIキーの有無を先に見ていたため、合言葉が合っていても違っていても
  //   同じ 500 が返り、「合言葉を入れても直らない」と切り分けられなかった。
  it('★APIキーが無くても、合言葉が違えば 403 を返す', async () => {
    const env = { RELAY_PASSPHRASE: PASS } // APIキーは無い
    const res = await worker.fetch(req('ちがう'), env)
    expect(res.status).toBe(403)
    expect((await body(res)).error).toContain('合言葉')
  })

  it('合言葉が合っていて初めて、APIキーが無いことを教える', async () => {
    const env = { RELAY_PASSPHRASE: PASS }
    const res = await worker.fetch(req(PASS), env)
    expect(res.status).toBe(500)
    expect((await body(res)).error).toContain('SMARTCRAFT_API_KEY')
  })

  it('★合言葉を知らない人に設定状況を教えない', async () => {
    const env = { RELAY_PASSPHRASE: PASS }
    const res = await worker.fetch(req(null), env)
    expect((await body(res)).error).not.toContain('SMARTCRAFT_API_KEY')
  })

  it('合言葉そのものが未設定なら、それは言う（誰も入れないため）', async () => {
    const res = await worker.fetch(req(null), { SMARTCRAFT_API_KEY: 'k' })
    expect(res.status).toBe(500)
    expect((await body(res)).error).toContain('RELAY_PASSPHRASE')
  })

  it('★設定漏れの文言に、どこで直すかが書いてある', async () => {
    const res = await worker.fetch(req(null), { SMARTCRAFT_API_KEY: 'k' })
    const msg = (await body(res)).error
    expect(msg).toContain('Secret')
    expect(msg).toContain('Variables and secrets')
  })
})

describe('通す経路', () => {
  it('POST は通さない', async () => {
    const res = await worker.fetch(req(PASS, { method: 'POST' }), FULL)
    expect(res.status).toBe(405)
  })

  it('ASSETS があれば、中継以外の経路はアプリ本体を返す', async () => {
    const env = { ...FULL, ASSETS: { fetch: async () => new Response('アプリ', { status: 200 }) } }
    const res = await worker.fetch(new Request('https://relay.example.com/'), env)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('アプリ')
  })

  it('ASSETS が無ければ（中継だけの Worker）404にする', async () => {
    const res = await worker.fetch(new Request('https://relay.example.com/users'), FULL)
    expect(res.status).toBe(404)
  })
})

describe('日本語の合言葉', () => {
  it('日本語でも照合できる', async () => {
    // 上流には行かせない。403 にならないこと＝照合を通過したことを見る
    const res = await worker.fetch(req(PASS), { RELAY_PASSPHRASE: PASS })
    expect(res.status).not.toBe(403)
  })

  it('1文字違えば通さない', async () => {
    const res = await worker.fetch(req(PASS + 'あ'), { RELAY_PASSPHRASE: PASS })
    expect(res.status).toBe(403)
  })
})

describe('設定が届いていないときの案内', () => {
  it('Worker から見えている設定の「名前」を出す（切り分けのため）', async () => {
    const env = { ASSETS: {}, SMARTCRAFT_API_KEY: 'k' } // 合言葉だけ無い
    const res = await worker.fetch(req(null), env)
    const msg = (await body(res)).error
    expect(msg).toContain('ASSETS')
    expect(msg).toContain('SMARTCRAFT_API_KEY')
  })

  it('★値は絶対に出さない', async () => {
    const env = { SMARTCRAFT_API_KEY: 'sk-ひみつの鍵-abc123', ANOTHER: 'ひみつ2' }
    const res = await worker.fetch(req(null), env)
    const msg = (await body(res)).error
    expect(msg).not.toContain('sk-ひみつの鍵-abc123')
    expect(msg).not.toContain('ひみつ2')
    // 名前は出る
    expect(msg).toContain('SMARTCRAFT_API_KEY')
    expect(msg).toContain('ANOTHER')
  })

  it('1つも届いていなければ、そう言う', async () => {
    const res = await worker.fetch(req(null), {})
    expect((await body(res)).error).toContain('1つも見えていません')
  })

  it('実行時の欄の見分け方と、Build の欄との違いに触れる', async () => {
    const res = await worker.fetch(req(null), {})
    const msg = (await body(res)).error
    // ★Settings には「Variables and secrets」が2つある。
    //   実行時用は いちばん上の（"...other runtime variables" と書いてある）方で、
    //   「Build」の中の同名の欄はビルド中にしか使われない。
    //   ここを取り違えて、正しい値を入れているのに何も届かない状態で詰まった。
    //   見分けがつく手がかりを必ず文言に入れる。
    expect(msg).toContain('runtime variables')
    expect(msg).toContain('Build')
  })

  it('★設定が正しければ、この案内はもう出ない', async () => {
    const env = { RELAY_PASSPHRASE: PASS, SMARTCRAFT_API_KEY: 'k' }
    const res = await worker.fetch(req('ちがう'), env)
    const msg = (await body(res)).error
    expect(msg).toBe('合言葉が違います')
    expect(msg).not.toContain('SMARTCRAFT_API_KEY')
  })
})
