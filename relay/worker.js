/**
 * Smart Craft API の中継サーバー（Cloudflare Worker）
 * ============================================================
 *
 * これは何か
 * ----------
 * 配信サイト（GitHub Pages）のブラウザから Smart Craft API を使うための中継。
 * 中継が要る理由は2つ。
 *
 *   1. Smart Craft API は CORS ヘッダーを返さない。
 *      ブラウザは APIキーの有無に関係なく遮断する（実測で確認済み）。
 *   2. APIキーをブラウザに置けない。
 *      静的ホスティングでは開発者ツールで誰でも読め、Gitの履歴にも永久に残る。
 *      顧客の本番MESの鍵なので、漏れたら事故になる。
 *
 * この中継は、鍵を Worker の環境変数（Secret）に置き、ブラウザには渡さない。
 *
 *
 * ★重要：これを置くと、URLを知った人が生産データを引ける
 * ------------------------------------------------------
 * だから2つの錠をかけている。両方とも必ず設定すること。
 *
 *   ALLOWED_ORIGIN … このサイトからだけ CORS を許す
 *                    （ただし curl はCORSを無視するので、これだけでは足りない）
 *   RELAY_PASSPHRASE … 合言葉。ブラウザが X-Relay-Passphrase で送る
 *                    （これが本当の錠。curl にも効く）
 *
 * 合言葉は Smart Craft のAPIキーとは別物。漏れてもMES側の鍵は無事で、
 * 合言葉だけ変えれば締め出せる。
 *
 *
 * 置き方
 * ------
 * このリポジトリを Cloudflare Workers に繋ぐと、`wrangler.jsonc` の設定で
 * 「アプリ本体（dist/）＋この中継」が1つの Worker として置かれる。
 *
 *   1. https://dash.cloudflare.com → Workers & Pages → このリポジトリを import
 *   2. Settings → Variables and Secrets に2つ入れる（★Secret にすること）
 *        SMARTCRAFT_API_KEY … Smart Craft のAPIキー
 *        RELAY_PASSPHRASE   … 自分で決めた長い合言葉（20文字以上を推奨・日本語可）
 *   3. 付いたURL（https://xxxx.workers.dev）を開けばアプリが動く。
 *      アプリと中継が同じ生成元なので、中継URLの入力も CORS の設定も要らない。
 *
 *   別の場所に置いたアプリ（GitHub Pages など）からも使いたいときだけ、
 *   ALLOWED_ORIGIN にそのURL（例 https://tksises.github.io）を足す。
 *
 * ★中継だけの Worker として置くこともできる（このファイル単体を貼る）。
 *   そのときは ASSETS が無いので、中継する経路以外は404になる。
 *
 *   検証環境を使うときは SMARTCRAFT_API_BASE も入れる
 *     本番: https://api.smartcraft.jp/api/v1 （既定）
 *     検証: https://api.staging.smartcraft.jp/api/v1
 *   ★検証環境で発行した鍵を本番URLに送ると 401 になる（実際に踏んだ）。
 *
 *
 * 通すもの
 * --------
 * GET /process_results だけ。書き込み系は通さない
 * （読み取りしか要らないのに、書ける口を開けておく理由が無い）。
 */

const DEFAULT_API_BASE = 'https://api.smartcraft.jp/api/v1'

/** 通してよい経路。増やすときは「読み取りだけ」を守る */
const ALLOWED_PATHS = ['/process_results']

/**
 * 設定が足りないときの文言。
 * ★「設定されていません」だけだと、どこで何をすればいいのか分からない。
 *   ★Secret ではなく平文の Variable として入れると、次の Git デプロイで
 *   消える（wrangler の設定が正となり、そこに無い平文の変数は削除される）。
 *   Secret は消えない。ここで踏んだので文言に残す。
 */
const MISSING = name =>
  `${name} が Worker に届いていません。Cloudflare → Settings → Variables and Secrets で、` +
  `種類を「Secret」にして ${name} を追加し、保存後に Deploy してください。` +
  `（平文の Variable として入れると、次のデプロイで消えます）`

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN ?? ''
    const url = new URL(request.url)

    // ★中継する経路以外は、アプリ本体（dist/）をそのまま返す。
    //   こうすると「アプリの置き場所」と「中継」が同じ生成元になり、
    //   CORS の設定を間違えようがなくなる。
    //   ASSETS が無いとき（中継だけの Worker）は、そのまま404にする。
    if (!ALLOWED_PATHS.includes(url.pathname)) {
      if (env.ASSETS) return env.ASSETS.fetch(request)
      return json({ error: `${url.pathname} は通しません` }, 404, origin)
    }

    // ブラウザは本番のリクエストの前に OPTIONS を投げる（プリフライト）
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (request.method !== 'GET') {
      return json({ error: 'GET だけを受け付けます' }, 405, origin)
    }

    // ★確認する順番が大事。
    //   以前は API キーの有無を先に見ていたため、合言葉が合っていても
    //   間違っていても同じ 500 が返り、「合言葉を入れても直らない」と
    //   切り分けられなかった。合言葉の照合を先に置く。
    //   ついでに、合言葉を知らない人に設定状況を教えないで済む。

    // 合言葉そのものが未設定だと誰も入れないので、これだけは言うしかない
    if (!env.RELAY_PASSPHRASE) {
      return json({ error: MISSING('RELAY_PASSPHRASE') }, 500, origin)
    }

    // ★ブラウザ側と同じ形（UTF-8 → base64）にしてから比べる。
    //   HTTPヘッダーは1バイト文字しか運べないので、日本語の合言葉を
    //   そのまま載せるとブラウザの fetch が例外で落ちる。
    const sent = request.headers.get('X-Relay-Passphrase') ?? ''
    if (!timingSafeEqual(sent, encodePassphrase(env.RELAY_PASSPHRASE))) {
      return json({ error: '合言葉が違います' }, 403, origin)
    }

    // ここから先は合言葉が合った人だけ。設定漏れを黙って通さない
    if (!env.SMARTCRAFT_API_KEY) {
      return json({ error: MISSING('SMARTCRAFT_API_KEY') }, 500, origin)
    }

    const apiBase = (env.SMARTCRAFT_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
    const target = `${apiBase}${url.pathname}${url.search}`

    const upstream = await fetch(target, {
      headers: {
        // ★鍵はここで初めて付く。ブラウザには一度も渡らない
        Authorization: `Bearer ${env.SMARTCRAFT_API_KEY}`,
        Accept: 'application/json',
      },
    })

    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        // 生産データを中間に残さない
        'Cache-Control': 'no-store',
      },
    })
  },
}

function corsHeaders(origin) {
  return {
    // ★'*' にしない。合言葉が漏れたときに被害が広がる
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Relay-Passphrase, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

/**
 * 合言葉をヘッダーに載せられる形にする（ブラウザ側と同じ手順）。
 * ★base64 は暗号ではない。運べる形にしているだけ。
 */
function encodePassphrase(pass) {
  const bytes = new TextEncoder().encode(pass)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/**
 * 長さと中身を比べる。
 * ★`a === b` は先頭が違うと即座に false を返すので、応答時間から
 *   合言葉を1文字ずつ当てられる。必ず最後まで回す。
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
