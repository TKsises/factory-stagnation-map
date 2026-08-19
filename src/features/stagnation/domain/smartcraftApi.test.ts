import { describe, expect, it, vi } from 'vitest'
import { buildLots } from './lots'
import { guessMapping } from './mapping'
import {
  extractRecords,
  extractTotal,
  FACTORY_TIME_ZONE,
  fetchProcessResults,
  normalizeApiDateTime,
  recordsToRawTable,
  REQUEST_INTERVAL_MS,
} from './smartcraftApi'

/**
 * ★api-doc.smartcraft.jp に載っている GET /process_results のレスポンス例そのまま。
 *   自分で考えた形ではなく、公式の例で確かめる。
 *   （最初は total_standard_time / process_order_status / material_group_code と
 *     推測していたが、実物は接頭辞や単複が違っていた）
 */
const OFFICIAL_RESPONSE = {
  process_results: [
    {
      id: 12,
      production_order_code: 'PO000001',
      production_order_tags: ['急ぎ'],
      sequence_number: 3,
      process_order_generated_code: 'PO000001_3',
      process_order_tags: [],
      production_process_name: '表面処理',
      production_process_code: 'P050',
      production_process_tags: [],
      material_name: 'ブラケット',
      material_code: 'MA000003',
      material_tags: [],
      material_group_names: ['機械部品'],
      material_group_codes: ['MG001'],
      material_group_tags: [],
      work_center_name: '表面処理エリア',
      work_center_code: 'WC000031',
      work_center_tags: [],
      production_order_quantity: 300,
      process_order_standard_time: 150,
      process_order_setup_standard_time: 30,
      process_order_total_standard_time: 180,
      process_order_start_at: '2026-05-11T08:30:00.000+09:00',
      process_order_end_at: '2026-05-11T11:30:00.000+09:00',
      process_result_started_at: '2026-05-11T09:00:00.000+09:00',
      process_result_ended_at: '2026-05-11T11:45:00.000+09:00',
      process_result_status: 'done',
      created_at: '2026-05-10T10:00:00.000+09:00',
      updated_at: '2026-05-11T11:45:00.000+09:00',
    },
  ],
  paging: { page: 1, per_page: 100, total: 1 },
}

describe('★公式のレスポンス例で対応表を確かめる', () => {
  const records = extractRecords(OFFICIAL_RESPONSE)
  const table = recordsToRawTable(records, 'api')
  const col = (name: string) => table.headers.indexOf(name)

  it('process_results キーから配列を取り出せる', () => {
    expect(records).toHaveLength(1)
  })

  it('総数を取り出せる', () => {
    expect(extractTotal(OFFICIAL_RESPONSE)).toBe(1)
  })

  it('★実績の時刻がCSVと同じ列名になる', () => {
    expect(col('作業開始日時')).toBeGreaterThanOrEqual(0)
    expect(col('作業終了日時')).toBeGreaterThanOrEqual(0)
    expect(table.rows[0][col('作業開始日時')]).toBe('2026/05/11 09:00:00')
    expect(table.rows[0][col('作業終了日時')]).toBe('2026/05/11 11:45:00')
  })

  it('予定の時刻は予定の列名のまま（実績と混ざらない）', () => {
    expect(table.rows[0][col('開始予定日時')]).toBe('2026/05/11 08:30:00')
  })

  it('接頭辞つきのフィールドも取り違えない', () => {
    expect(table.rows[0][col('合計標準時間')]).toBe('180') // process_order_total_standard_time
    expect(table.rows[0][col('ステータス')]).toBe('done') // process_result_status
  })

  it('複数形のフィールドも拾う', () => {
    expect(table.rows[0][col('品目グループコード')]).toBe('MG001') // material_group_codes は配列
  })

  it('滞留計算に必要な列がすべて揃う', () => {
    for (const name of [
      '製造指示番号',
      '工程順',
      '工程コード',
      '工程名',
      '品目コード',
      '指示数',
      '作業区コード',
      '標準時間',
      '作業開始日時',
      '作業終了日時',
    ]) {
      expect(col(name), `${name} が無い`).toBeGreaterThanOrEqual(0)
    }
  })

  it('列マッピングの自動推測がそのまま効く', () => {
    const m = guessMapping(table.headers)
    expect(m.lotKey).toBe('製造指示番号')
    expect(m.processKey).toBe('工程コード')
    expect(m.actualStart).toBe('作業開始日時')
    expect(m.actualEnd).toBe('作業終了日時')
    expect(m.processOrder).toBe('工程順')
    expect(m.quantity).toBe('指示数')
    expect(m.totalStandardTime).toBe('合計標準時間')
  })

  it('タグの配列も文字列にして落とさない', () => {
    expect(table.rows[0][col('production_order_tags')]).toBe('急ぎ')
  })
})

describe('時差つきの日時', () => {
  it('+09:00 を現地時刻に直す', () => {
    expect(normalizeApiDateTime('2026-05-11T09:00:00.000+09:00')).toBe('2026/05/11 09:00:00')
  })

  it('★UTC で返ってきても9時間ずれない', () => {
    // 2026-05-11T00:00:00Z は JST の 09:00
    expect(normalizeApiDateTime('2026-05-11T00:00:00.000Z')).toBe('2026/05/11 09:00:00')
  })

  it('時差が無ければ壁時計のまま扱う', () => {
    expect(normalizeApiDateTime('2026-05-11 09:00')).toBe('2026/05/11 09:00:00')
  })

  // ★このテスト群は、実行するPCの時計がどこに合っていても同じ結果になること。
  //   以前は getHours() などブラウザの地方時に変換しており、
  //   手元（日本時間）では通るのに CI（UTC）では9時間ずれて落ちていた。
  //   CSVは日本時間の壁時計を時差なしで書き出すので、APIもそこに揃える。
  it('★変換先は実行環境の時間帯ではなく、工場の時間帯に固定されている', () => {
    expect(FACTORY_TIME_ZONE).toBe('Asia/Tokyo')

    // 冬時間・夏時間の両方で、UTC からの差が必ず +9 時間になる
    expect(normalizeApiDateTime('2026-01-15T00:00:00.000Z')).toBe('2026/01/15 09:00:00')
    expect(normalizeApiDateTime('2026-07-15T00:00:00.000Z')).toBe('2026/07/15 09:00:00')

    // 日付をまたぐ側も見る（UTC 15:00 は翌日の 00:00）
    expect(normalizeApiDateTime('2026-07-15T15:00:00.000Z')).toBe('2026/07/16 00:00:00')

    // 実行環境の時間帯とは無関係であることを、地方時と突き合わせて確かめる
    const localHour = new Date('2026-07-15T00:00:00.000Z').getHours()
    const converted = Number(normalizeApiDateTime('2026-07-15T00:00:00.000Z').slice(11, 13))
    if (localHour !== 9) expect(converted).not.toBe(localHour)
  })
})

const RECORD = {
  production_order_code: 'PO-0001',
  production_number: 'PN-0001',
  sequence_number: 1,
  process_order_generated_code: 'PO-0001_1',
  production_process_code: 'P010',
  production_process_name: '鋳造',
  material_code: 'MA1',
  production_order_quantity: 300,
  work_center_code: 'WC001',
  process_order_start_at: '2026-05-11T08:30:00+09:00',
  process_result_started_at: '2026-05-11T09:00:00+09:00',
  process_result_ended_at: '2026-05-11T10:00:00+09:00',
  process_result_quantity: 298,
}

describe('APIのJSONをCSVと同じ形にする', () => {
  const table = recordsToRawTable([RECORD], 'api')

  it('★実績の時刻をCSVと同じ列名にする', () => {
    expect(table.headers).toContain('作業開始日時')
    expect(table.headers).toContain('作業終了日時')
  })

  it('予定の列は予定の名前のまま（実績と混ぜない）', () => {
    expect(table.headers).toContain('開始予定日時')
  })

  it('CSVと同じ列名になるので、列マッピングがそのまま効く', () => {
    const m = guessMapping(table.headers)
    expect(m.lotKey).toBe('製造指示番号')
    expect(m.processKey).toBe('工程コード')
    expect(m.actualStart).toBe('作業開始日時')
    expect(m.actualEnd).toBe('作業終了日時')
    expect(m.processOrder).toBe('工程順')
  })

  it('取り込みから滞留計算まで、CSVと同じ経路で通る', () => {
    const { lots } = buildLots(table, guessMapping(table.headers))
    expect(lots).toHaveLength(1)
    expect(lots[0].id).toBe('PO-0001')
    expect(lots[0].steps[0].actualStart).not.toBeNull()
    expect(lots[0].quantity).toBe(300)
  })

  it('日時をCSVと同じ書式に直す', () => {
    expect(normalizeApiDateTime('2026-05-11T09:00:00+09:00')).toBe('2026/05/11 09:00:00')
    expect(normalizeApiDateTime('2026-05-11 09:00')).toBe('2026/05/11 09:00:00')
  })

  it('日時でない値はそのまま通す', () => {
    expect(normalizeApiDateTime('PO-0001')).toBe('PO-0001')
  })

  it('★知らないフィールドを黙って捨てない', () => {
    const t = recordsToRawTable([{ ...RECORD, 新しい項目: 'x' }], 'api')
    expect(t.headers).toContain('新しい項目')
  })

  it('レコードごとに鍵が違っても列が揃う', () => {
    const t = recordsToRawTable([{ a: 1 }, { b: 2 }], 'api')
    expect(t.headers).toEqual(['a', 'b'])
    expect(t.rows).toEqual([
      ['1', ''],
      ['', '2'],
    ])
  })

  it('同じ列名に2つの鍵が当たったら、後から来た方は元の名前で別の列にする', () => {
    const t = recordsToRawTable(
      [{ process_result_started_at: '2026-05-11T09:00:00', started_at: '2026-05-11T09:30:00' }],
      'api'
    )
    expect(t.headers).toEqual(['作業開始日時', 'started_at'])
  })

  it('null や配列でも落ちない', () => {
    expect(recordsToRawTable([null, 'x', { a: null }], 'api').rows.length).toBe(3)
    expect(recordsToRawTable([], 'api').headers).toEqual([])
  })
})

describe('レスポンスの包み方が変わっても配列を拾う', () => {
  it('配列そのもの', () => {
    expect(extractRecords([RECORD])).toHaveLength(1)
  })

  it('data / process_results / results で包まれている場合', () => {
    expect(extractRecords({ data: [RECORD] })).toHaveLength(1)
    expect(extractRecords({ process_results: [RECORD] })).toHaveLength(1)
    expect(extractRecords({ results: [RECORD] })).toHaveLength(1)
  })

  it('見つからなければ空（例外を投げない）', () => {
    expect(extractRecords({ foo: 1 })).toEqual([])
    expect(extractRecords(null)).toEqual([])
  })
})

// ── 取得（fetch を差し替えて確かめる。実キーは要らない）──

function fakeFetch(pages: unknown[][]) {
  const calls: string[] = []
  const fn = vi.fn(async (url: string) => {
    calls.push(url)
    const page = Number(new URL(url, 'http://x').searchParams.get('page'))
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: pages[page - 1] ?? [] }),
    } as unknown as Response
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

describe('全ページ取得', () => {
  it('件数が per_page 未満になったら止まる', async () => {
    const { fn, calls } = fakeFetch([[RECORD, RECORD], [RECORD]])
    const sleep = vi.fn(async () => {})
    const { table } = await fetchProcessResults({ perPage: 2 }, { fetchFn: fn, sleep })
    expect(table.rows).toHaveLength(3)
    expect(calls).toHaveLength(2)
  })

  it('★ページの合間に必ず待つ（レート制限 10/分）', async () => {
    const { fn } = fakeFetch([[RECORD, RECORD], [RECORD]])
    const waits: number[] = []
    const sleep = vi.fn(async (ms: number) => {
      waits.push(ms)
    })
    await fetchProcessResults({ perPage: 2 }, { fetchFn: fn, sleep })
    expect(waits).toEqual([REQUEST_INTERVAL_MS])
    expect(REQUEST_INTERVAL_MS).toBeGreaterThanOrEqual(6000) // 10/分に収まること
  })

  it('取りすぎないよう上限で止まる', async () => {
    const many = Array.from({ length: 10 }, () => [RECORD, RECORD])
    const { fn, calls } = fakeFetch(many)
    await fetchProcessResults(
      { perPage: 2, maxPages: 3 },
      { fetchFn: fn, sleep: async () => {} }
    )
    expect(calls).toHaveLength(3)
  })

  it('期間の絞り込みをクエリに載せる', async () => {
    const { fn, calls } = fakeFetch([[]])
    await fetchProcessResults(
      { resultStartedFrom: '2026-04-01', resultStartedTo: '2026-06-30' },
      { fetchFn: fn, sleep: async () => {} }
    )
    expect(calls[0]).toContain('result_started_at_from=2026-04-01')
    expect(calls[0]).toContain('result_started_at_to=2026-06-30')
  })

  it('進み具合を知らせる', async () => {
    const { fn } = fakeFetch([[RECORD, RECORD], [RECORD]])
    const seen: number[] = []
    await fetchProcessResults(
      { perPage: 2 },
      { fetchFn: fn, sleep: async () => {}, onProgress: p => seen.push(p.fetched) }
    )
    expect(seen[seen.length - 1]).toBe(3)
  })
})

describe('失敗したときの言い方', () => {
  const failWith = (status: number) =>
    (async () => ({ ok: false, status, json: async () => ({}) })) as unknown as typeof fetch

  it('401 はキーの設定を案内する', async () => {
    await expect(
      fetchProcessResults({}, { fetchFn: failWith(401), sleep: async () => {} })
    ).rejects.toThrow(/APIキー/)
  })

  it('429 はレート制限だと言う', async () => {
    await expect(
      fetchProcessResults({}, { fetchFn: failWith(429), sleep: async () => {} })
    ).rejects.toThrow(/レート制限/)
  })

  it('それ以外は状態コードを出す', async () => {
    await expect(
      fetchProcessResults({}, { fetchFn: failWith(500), sleep: async () => {} })
    ).rejects.toThrow(/HTTP 500/)
  })
})
