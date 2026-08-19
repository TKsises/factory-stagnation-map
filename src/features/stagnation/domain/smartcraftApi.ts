// ============================================================
// Smart Craft API からの取得
//
// ★取得元は「CSVを読む」か「APIを叩く」かの2つだが、
//   後段（列マッピング・滞留計算・金額）は一切変えない。
//   そのために、APIのJSONを「CSVと同じ列名の RawTable」に直してから渡す。
//   こうしておくと、列マッピングもテストも既存のものがそのまま効く。
//
// ★APIキーはブラウザに置かない（§APIキーをクライアント側に置かない）。
//   開発サーバー側の中継（vite の proxy）が Authorization ヘッダーを付ける。
//   ブラウザは /api/smartcraft/... という自分と同じ生成元だけを見る。
//   これで CORS も同時に解決する（このAPIは CORS ヘッダーを返さない）。
//
// ★レート制限は 10 リクエスト/分。1000件ずつ取るので、
//   2万件なら20リクエスト＝約2分かかる。待ち時間を必ず画面に出すこと。
// ============================================================

import type { RawTable } from './types'

/** 中継の入口。vite の proxy がここを実際のAPIに転送する */
export const API_PROXY_BASE = '/api/smartcraft'

/** レート制限（10/分）に収めるための待ち。少し余裕を持たせる */
export const REQUEST_INTERVAL_MS = 6500

export const MAX_PER_PAGE = 1000

/**
 * APIのフィールド名 → CSVエクスポートの列名。
 * ★ここが唯一の対応表。CSVと同じ列名にしておけば、後段は何も変えなくてよい。
 * 表に無いフィールドは、名前をそのままにして列に出す（勝手に捨てない）。
 */
export const FIELD_TO_COLUMN: Record<string, string> = {
  production_order_code: '製造指示番号',
  production_number: '製番',
  sequence_number: '工程順',
  process_order_generated_code: '工程指示番号',
  production_process_name: '工程名',
  production_process_code: '工程コード',
  material_name: '品目名',
  material_code: '品目コード',
  material_group_codes: '品目グループコード',
  work_center_name: '作業区名',
  work_center_code: '作業区コード',
  production_order_quantity: '指示数',
  process_order_standard_time: '標準時間',
  process_order_setup_standard_time: '段取り標準時間',
  // ★実物は process_order_ 接頭辞つき。CSVの列名（合計標準時間）とは形が違う
  process_order_total_standard_time: '合計標準時間',
  process_order_start_at: '開始予定日時',
  process_order_end_at: '終了予定日時',
  // ★実績の時刻。ここを取り違えると意味が壊れる
  process_result_started_at: '作業開始日時',
  process_result_ended_at: '作業終了日時',
  // ★status は process_result_ 接頭辞（process_order_ ではない）
  process_result_status: 'ステータス',
  updated_at: '最終更新日時',
  // 実データで実際に返ってきた項目（検証環境で確認）
  process_result_defect_quantity: '不良数',
  defect_rate: '不良率',
  achievement_rate: '達成率',
  setup_duration: '段取り時間',
  order_total_time: '合計稼働時間',

  // 以下は今の /process_results には出てこないが、
  // 版が変わって増えたときに拾えるよう残しておく（無くても害はない）
  started_at: '作業開始日時',
  ended_at: '作業終了日時',
  material_group_code: '品目グループコード',
  total_standard_time: '合計標準時間',
  process_order_status: 'ステータス',
  equipment_code: '設備コード(実績)',
  user_code: '担当者社員番号(実績)',
  user_full_name: '担当者(実績)',
  quantity: '出来高数',
  process_result_quantity: '出来高数',
  defect_quantity: '不良数',
  note: '備考',
}

export type ApiQuery = {
  /** 作業開始日時の範囲。'YYYY-MM-DD' */
  resultStartedFrom?: string
  resultStartedTo?: string
  perPage?: number
  /** 取りすぎを防ぐ上限（レート制限があるため） */
  maxPages?: number
}

export type FetchProgress = {
  page: number
  fetched: number
  /** レスポンスの paging.total。分かれば「◯件中◯件」と出せる */
  total: number | null
  /** 次のリクエストまでの待ち（ミリ秒）。画面に出す */
  waitingMs: number
}

/** レスポンスの paging.total を取り出す。無ければ null */
export function extractTotal(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const paging = (body as Record<string, unknown>).paging
  if (typeof paging !== 'object' || paging === null) return null
  const total = (paging as Record<string, unknown>).total
  return typeof total === 'number' && Number.isFinite(total) ? total : null
}

/** 値をCSVと同じ「文字列」に直す。後段は文字列前提で作ってある */
function toCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(toCell).join(' ')
  return ''
}

/**
 * ISO8601 の日時を、CSVエクスポートと同じ書式に直す。
 * 後段の日時パーサは 'YYYY/MM/DD HH:MM:SS' も ISO も読めるが、
 * 画面のプレビューでCSVと同じ見え方にするために揃えておく。
 */
/**
 * 壁時計に直すときの基準となる時間帯。
 * ★ブラウザの地方時（`getHours()` など）に頼らない。
 *   CSVエクスポートは日本時間の壁時計を時差なしで書き出すので、
 *   APIも同じ時間帯に揃えないと、同じ工場の同じロットなのに
 *   「CSVで読んだとき」と「APIで取ったとき」で時刻が食い違う。
 *   PCの時計を日本以外に合わせている人がAPIで取ると、稼働時間の判定
 *   （8:30〜17:30）が丸ごと外れて、滞留時間が別物になる。
 */
export const FACTORY_TIME_ZONE = 'Asia/Tokyo'

const WALL_CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: FACTORY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** 実時刻を FACTORY_TIME_ZONE の壁時計にする。CSVと同じ書式で返す */
function toFactoryWallClock(t: Date): string {
  const got: Record<string, string> = {}
  for (const part of WALL_CLOCK.formatToParts(t)) got[part.type] = part.value
  return `${got.year}/${got.month}/${got.day} ${got.hour}:${got.minute}:${got.second}`
}

export function normalizeApiDateTime(value: string): string {
  // 実物は '2019-08-24T14:15:00.000+09:00'（ミリ秒と時差つき）
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?/.exec(
      value
    )
  if (!m) return value

  const [, y, mo, d, h, mi, s, offset] = m

  // ★時差を無視して壁時計をそのまま使うと、+09:00 以外が来たときに最大9時間ずれる。
  //   時差が書いてあるときは、いったん実時刻にしてから工場の時間帯に直す。
  if (offset) {
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${offset === 'Z' ? 'Z' : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`
    const t = new Date(iso)
    if (!Number.isNaN(t.getTime())) return toFactoryWallClock(t)
  }
  return `${y}/${mo}/${d} ${h}:${mi}:${s ?? '00'}`
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

/**
 * APIのレコード配列を RawTable にする。
 * ★列は「実際に返ってきた鍵の和集合」から作る。
 *   こちらが知っている鍵だけを拾うと、増えたフィールドが黙って消える。
 */
export function recordsToRawTable(records: unknown[], fileName: string): RawTable {
  const keys: string[] = []
  const seen = new Set<string>()

  for (const rec of records) {
    if (typeof rec !== 'object' || rec === null) continue
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }

  // 同じ列名に2つの鍵が当たることがある（started_at と process_result_started_at）。
  // 先に出てきた方を採用し、後から来た方は元の鍵名のまま別の列にする。
  const usedColumns = new Set<string>()
  const headers = keys.map(k => {
    const mapped = FIELD_TO_COLUMN[k]
    if (mapped && !usedColumns.has(mapped)) {
      usedColumns.add(mapped)
      return mapped
    }
    return k
  })

  const rows = records.map(rec => {
    const obj = (typeof rec === 'object' && rec !== null ? rec : {}) as Record<string, unknown>
    return keys.map(k => {
      const cell = toCell(obj[k])
      return DATE_LIKE.test(cell) ? normalizeApiDateTime(cell) : cell
    })
  })

  return { fileName, headers, rows, encoding: 'utf8' }
}

/** レスポンスの本体から配列を取り出す。包み方が版で変わっても拾えるようにする */
export function extractRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (typeof body === 'object' && body !== null) {
    const obj = body as Record<string, unknown>
    for (const key of ['data', 'process_results', 'results', 'items', 'records']) {
      const v = obj[key]
      if (Array.isArray(v)) return v
    }
  }
  return []
}

export type FetchDeps = {
  /** 差し替え可能にしてテストできるようにする */
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  onProgress?: (p: FetchProgress) => void
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * 工程実績を全ページ取得して RawTable にする。
 * ★レート制限（10/分）があるので、ページの合間に必ず待つ。
 */
export async function fetchProcessResults(
  query: ApiQuery = {},
  deps: FetchDeps = {}
): Promise<{ table: RawTable; pages: number }> {
  const doFetch = deps.fetchFn ?? fetch
  const sleep = deps.sleep ?? defaultSleep
  const perPage = Math.min(query.perPage ?? MAX_PER_PAGE, MAX_PER_PAGE)
  const maxPages = query.maxPages ?? 30

  const all: unknown[] = []
  let page = 1

  for (; page <= maxPages; page++) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
    if (query.resultStartedFrom) params.set('result_started_at_from', query.resultStartedFrom)
    if (query.resultStartedTo) params.set('result_started_at_to', query.resultStartedTo)

    const res = await doFetch(`${API_PROXY_BASE}/process_results?${params.toString()}`)
    if (!res.ok) {
      const hint =
        res.status === 401
          ? 'APIキーが設定されていないか、権限がありません（.env.local を確認してください）'
          : res.status === 429
            ? 'レート制限に達しました（10リクエスト/分）。しばらく待って再実行してください'
            : `HTTP ${res.status}`
      throw new Error(`工程実績を取得できませんでした：${hint}`)
    }

    const body = await res.json()
    const records = extractRecords(body)
    const total = extractTotal(body)
    all.push(...records)

    deps.onProgress?.({ page, fetched: all.length, total, waitingMs: 0 })

    // 総数が分かるならそれで判断する。分からなければ件数で判断する
    if (total !== null ? all.length >= total : records.length < perPage) break
    if (records.length === 0) break // 総数が嘘でも無限に回らないように

    if (page < maxPages) {
      deps.onProgress?.({ page, fetched: all.length, total, waitingMs: REQUEST_INTERVAL_MS })
      await sleep(REQUEST_INTERVAL_MS)
    }
  }

  return {
    table: recordsToRawTable(all, `Smart Craft API（${all.length.toLocaleString()} 件）`),
    pages: Math.min(page, maxPages),
  }
}
