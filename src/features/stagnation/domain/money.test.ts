import { describe, expect, it } from 'vitest'
import { buildRawTable } from './csv'
import { computeGaps } from './gaps'
import { buildLots } from './lots'
import { guessMapping } from './mapping'
import { computeMetrics } from './metrics'
import {
  computeLotAmount,
  estimateReleasedJPY,
  formatChangeRate,
  formatJPY,
  formatManYen,
} from './money'
import type { CostEntry, Lot } from './types'
import { DEFAULT_CALENDAR } from './types'

const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

const lotOf = (over: Partial<Lot> = {}): Lot => ({
  id: 'L1',
  itemCode: 'MA1',
  quantity: 100,
  unitFromCsv: null,
  steps: [],
  ...over,
})

const COSTS: Record<string, CostEntry> = {
  MA1: { unitCost: 1200, unit: 'ピース' },
  MA2: { unitCost: 350, unit: 'kg' },
}

describe('computeLotAmount ― ロット金額 = 数量 × 単価', () => {
  it('単価が設定されていれば金額を出す', () => {
    const a = computeLotAmount(lotOf(), COSTS)
    expect(a.amountJPY).toBe(120000)
    expect(a.status).toBe('ok')
    expect(a.unit).toBe('ピース')
  })

  it('★単価が未設定なら金額を出さない（0円にしない）', () => {
    const a = computeLotAmount(lotOf({ itemCode: '未登録' }), COSTS)
    expect(a.amountJPY).toBeNull()
    expect(a.status).toBe('no-cost')
  })

  it('品目コードが読めなければ金額を出さない', () => {
    const a = computeLotAmount(lotOf({ itemCode: null }), COSTS)
    expect(a.amountJPY).toBeNull()
    expect(a.status).toBe('no-item')
  })

  it('数量が読めなければ金額を出さない（0にしない）', () => {
    const a = computeLotAmount(lotOf({ quantity: null }), COSTS)
    expect(a.amountJPY).toBeNull()
    expect(a.status).toBe('no-quantity')
  })

  it('CSVの単位と原価設定の単位が食い違っていたら印を付ける', () => {
    const a = computeLotAmount(lotOf({ unitFromCsv: 'kg' }), COSTS)
    expect(a.unitMismatch).toBe(true)
    expect(a.unit).toBe('ピース') // 原価設定側が正
  })

  it('CSVに単位が無ければ食い違いとしない', () => {
    expect(computeLotAmount(lotOf({ unitFromCsv: null }), COSTS).unitMismatch).toBe(false)
  })
})

// ────────────────────────────────────────────────────────
// 手で計算した例（2026-05-11 月 〜）
//
// L1: MA1 100個 × 1,200円 = 120,000円
//     P010 09:00-10:00 → P020 翌日10:00開始 … 滞留 24時間 = 1.0日
// L2: MA2 200kg × 350円 =  70,000円
//     P010 09:00-10:00 → P020 3日後10:00開始 … 滞留 72時間 = 3.0日
//
// 対象期間 T: 最初の実績 5/11 09:00 〜 最後の実績 5/14 11:00 = 3.0833…日
//
// 凍結額 = (120,000×1.0 + 70,000×3.0) ÷ T = 330,000 ÷ 3.08333… = 107,027.02…円
// D（1日あたり製造原価）= (120,000 + 70,000) ÷ T = 190,000 ÷ 3.08333… = 61,621.62…円
// ────────────────────────────────────────────────────────

const CSV = `製造指示番号,工程順,工程コード,品目コード,指示数,作業開始日時,作業終了日時
L1,1,P010,MA1,100,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,MA1,100,2026/05/12 10:00:00,2026/05/12 11:00:00
L2,1,P010,MA2,200,2026/05/11 09:00:00,2026/05/11 10:00:00
L2,2,P020,MA2,200,2026/05/14 10:00:00,2026/05/14 11:00:00
`

function analyze(costs: Record<string, CostEntry>) {
  const t = buildRawTable('x.csv', utf8(CSV))
  const mp = guessMapping(t.headers)
  const { lots } = buildLots(t, mp)
  return computeMetrics(lots, computeGaps(lots, DEFAULT_CALENDAR), { costs })
}

const T = 74 / 24 // 5/11 09:00 → 5/14 11:00 ＝ 74時間

describe('凍結額（① いまそこに眠っている額）', () => {
  const m = analyze(COSTS)

  it('対象期間が想定どおり', () => {
    expect(m.summary.periodDays).toBeCloseTo(T, 6)
  })

  it('滞留 × 原価 ÷ 期間 で出す', () => {
    expect(m.money.frozenJPY).toBeCloseTo(330000 / T, 4)
  })

  it('1日あたり製造原価を出す', () => {
    expect(m.money.dailyThroughputJPY).toBeCloseTo(190000 / T, 4)
  })

  it('単位が違っても金額に直してから合計している', () => {
    expect(m.money.unitsUsed).toEqual(['kg', 'ピース'])
    expect(m.money.lotsPriced).toBe(2)
  })

  it('工程間ごとの内訳の合計が、全体の凍結額と一致する', () => {
    const sum = m.pairs.reduce((a, p) => a + (p.amountJPY ?? 0), 0)
    expect(sum).toBeCloseTo(m.money.frozenJPY!, 4)
  })
})

describe('★原価が未設定のとき', () => {
  const m = analyze({})

  it('凍結額を出さない（0円にしない）', () => {
    expect(m.money.frozenJPY).toBeNull()
    expect(m.money.dailyThroughputJPY).toBeNull()
  })

  it('工程間ごとの金額も出さない', () => {
    expect(m.pairs.every(p => p.amountJPY === null)).toBe(true)
  })

  it('どの品目の単価が足りないかを挙げる（入力を促すため）', () => {
    expect(m.money.itemsMissingCost).toEqual(['MA1', 'MA2'])
    expect(m.money.lotsNoCost).toBe(2)
    expect(m.money.lotsPriced).toBe(0)
  })
})

describe('一部の品目だけ原価が設定されているとき', () => {
  const m = analyze({ MA1: COSTS.MA1 })

  it('出せる分だけ出し、出せない分は件数で示す', () => {
    expect(m.money.lotsPriced).toBe(1)
    expect(m.money.lotsNoCost).toBe(1)
    expect(m.money.itemsMissingCost).toEqual(['MA2'])
  })

  it('原価未設定のロットを0円として混ぜない', () => {
    // MA1 の分だけ： 120,000 × 1.0 ÷ T
    expect(m.money.frozenJPY).toBeCloseTo(120000 / T, 4)
  })

  it('金額に使えた滞留の件数を出す', () => {
    expect(m.money.gapsPriced).toBe(1)
    expect(m.money.gapsTotal).toBe(2)
  })
})

describe('② 工程間ごとのランキング', () => {
  it('滞留の大きい順に並び、金額が付く', () => {
    const m = analyze(COSTS)
    expect(m.pairs).toHaveLength(1) // この例は工程間が1種類
    expect(m.pairs[0].amountJPY).toBeCloseTo(330000 / T, 4)
  })

  it('工程間が複数あれば、それぞれに金額が付く', () => {
    const csv = `製造指示番号,工程順,工程コード,品目コード,指示数,作業開始日時,作業終了日時
L1,1,P010,MA1,100,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,MA1,100,2026/05/12 10:00:00,2026/05/12 11:00:00
L1,3,P030,MA1,100,2026/05/15 10:00:00,2026/05/15 11:00:00
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots } = buildLots(t, guessMapping(t.headers))
    const m = computeMetrics(lots, computeGaps(lots, DEFAULT_CALENDAR), { costs: COSTS })
    const p1 = m.pairs.find(p => p.key === 'P010→P020')!
    const p2 = m.pairs.find(p => p.key === 'P020→P030')!
    // P010→P020 は24時間、P020→P030 は71時間
    expect(p2.amountJPY!).toBeGreaterThan(p1.amountJPY!)
  })
})

describe('③ 削減試算（最も慎重に扱う数字）', () => {
  it('1日あたり製造原価 × 短縮日数', () => {
    expect(estimateReleasedJPY(61621.62, 1)).toBeCloseTo(61621.62, 2)
    expect(estimateReleasedJPY(61621.62, 2.5)).toBeCloseTo(154054.05, 2)
  })

  it('原価が未設定なら試算しない', () => {
    expect(estimateReleasedJPY(null, 3)).toBeNull()
  })

  it('短縮日数が0以下なら試算しない', () => {
    expect(estimateReleasedJPY(1000, 0)).toBeNull()
    expect(estimateReleasedJPY(1000, -1)).toBeNull()
  })
})

describe('表示の書式', () => {
  it('原価未設定は「原価未設定」と出す（0円と書かない）', () => {
    expect(formatJPY(null)).toBe('原価未設定')
    expect(formatManYen(null)).toBe('原価未設定')
  })

  it('円は3桁区切り', () => {
    expect(formatJPY(1234567)).toBe('1,234,567 円')
  })

  it('万円は桁に応じて丸める', () => {
    expect(formatManYen(12400000)).toBe('1,240 万円')
    expect(formatManYen(1240000)).toBe('124 万円')
    expect(formatManYen(52000)).toBe('5.2 万円')
  })

  it('★元の値が0のときは % を出さない（∞%改善を避ける）', () => {
    expect(formatChangeRate(0, 100)).toBeNull()
    expect(formatChangeRate(null, 100)).toBeNull()
    expect(formatChangeRate(100, 80)).toBe('-20.0%')
  })
})

describe('敵対的なデータ', () => {
  it('ロットが無くても落ちない', () => {
    const t = buildRawTable('x.csv', utf8('製造指示番号,工程コード,作業開始日時,作業終了日時\r\n'))
    const { lots } = buildLots(t, guessMapping(t.headers))
    const m = computeMetrics(lots, computeGaps(lots, DEFAULT_CALENDAR), { costs: COSTS })
    expect(m.money.frozenJPY).toBeNull()
    expect(m.money.itemsMissingCost).toEqual([])
  })

  it('単価が0や負の設定は normalizeConfig で捨てられる前提だが、来ても落ちない', () => {
    const m = analyze({ MA1: { unitCost: 0, unit: 'ピース' }, MA2: COSTS.MA2 })
    // 0円の単価は「未設定」と区別できないが、ここでは 0 として扱われる。
    // 実際には normalizeConfig が 0 以下を捨てるので画面には出てこない。
    expect(Number.isFinite(m.money.frozenJPY ?? 0)).toBe(true)
  })
})
