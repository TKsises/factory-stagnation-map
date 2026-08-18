import { describe, expect, it } from 'vitest'
import { buildRawTable } from './csv'
import { computeGaps } from './gaps'
import { buildLots } from './lots'
import { buildLotRows, EMPTY_FILTER, filterLotRows, sortLotRows } from './lotView'
import { guessMapping } from './mapping'
import { computeMetrics } from './metrics'
import type { CostEntry } from './types'
import { DEFAULT_CALENDAR } from './types'

const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

const COSTS: Record<string, CostEntry> = {
  MA1: { unitCost: 1000, unit: 'ピース' },
  MA2: { unitCost: 500, unit: 'kg' },
}

// L1: 3工程すべて実績あり（滞留 24h ＋ 71h）
// L2: 2工程目の開始が空・標準時間も無い → 工程間が除外される
// L3: 日付だけ
const CSV = `製造指示番号,工程順,工程コード,工程名,品目コード,指示数,作業開始日時,作業終了日時
L1,1,P010,鋳造,MA1,100,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,加工,MA1,100,2026/05/12 10:00:00,2026/05/12 11:00:00
L1,3,P030,塗装,MA1,100,2026/05/15 10:00:00,2026/05/15 11:00:00
L2,1,P010,鋳造,MA2,200,2026/05/11 09:00:00,2026/05/11 10:00:00
L2,2,P020,加工,MA2,200,,
L3,1,P010,鋳造,MA1,50,2026/05/11,2026/05/11
L3,2,P020,加工,MA1,50,2026/05/13,2026/05/13
`

function rows(costs: Record<string, CostEntry> = COSTS) {
  const t = buildRawTable('x.csv', utf8(CSV))
  const { lots } = buildLots(t, guessMapping(t.headers))
  const gapResult = computeGaps(lots, DEFAULT_CALENDAR)
  const m = computeMetrics(lots, gapResult, { costs })
  return buildLotRows(lots, gapResult.gaps, gapResult.completeLotIds, m.amountByLot)
}

const byId = (id: string) => rows().find(r => r.lotId === id)!

describe('buildLotRows ― 基本', () => {
  it('ロットごとに1行できる', () => {
    expect(rows().map(r => r.lotId)).toEqual(['L1', 'L2', 'L3'])
  })

  it('総リードタイムを出す（最初の開始 → 最後の終了）', () => {
    // 5/11 09:00 → 5/15 11:00 ＝ 98時間
    expect(byId('L1').leadHours).toBeCloseTo(98, 6)
  })

  it('滞留を暦と稼働の両方で足し上げる', () => {
    const l1 = byId('L1')
    // 5/11 10:00→5/12 10:00 ＝24h、5/12 11:00→5/15 10:00 ＝71h
    expect(l1.stagnationHours).toBeCloseTo(95, 6)
    // 稼働: 月10:00-17:30=7.5h + 火8:30-10:00=1.5h = 9h ／ 火11:00-17:30=6.5h + 水9h + 木9h + 金8:30-10:00=1.5h = 26h
    expect(l1.workingStagnationHours).toBeCloseTo(35, 6)
  })

  it('金額は money.ts が出したものを引くだけ', () => {
    expect(byId('L1').amountJPY).toBe(100000) // 100 × 1,000
    expect(byId('L1').unit).toBe('ピース')
  })
})

describe('buildLotRows ― 帯の区間', () => {
  const l1 = byId('L1')

  it('加工と滞留が時系列に交互に並ぶ', () => {
    expect(l1.segments.map(s => s.kind)).toEqual([
      'process',
      'gap',
      'process',
      'gap',
      'process',
    ])
  })

  it('区間に時間が入っている', () => {
    expect(l1.segments[0].hours).toBeCloseTo(1, 6) // 鋳造 09:00-10:00
    expect(l1.segments[1].hours).toBeCloseTo(24, 6)
    expect(l1.segments[3].hours).toBeCloseTo(71, 6)
  })

  it('滞留の区間には基準（basis）が入る', () => {
    expect(l1.segments[1].basis).toBe('actual')
    expect(l1.segments[0].basis).toBeUndefined()
  })

  it('区間の合計が総リードタイムと一致する', () => {
    const total = l1.segments.reduce((a, s) => a + s.hours, 0)
    expect(total).toBeCloseTo(l1.leadHours!, 6)
  })
})

describe('buildLotRows ― 欠けているロット', () => {
  it('計算できなかった工程間の数を持つ', () => {
    const l2 = byId('L2')
    expect(l2.excludedPairs).toBe(1)
    expect(l2.complete).toBe(false)
  })

  it('欠損のあるロットの滞留を0として扱わない（そもそも足していない）', () => {
    expect(byId('L2').stagnationHours).toBe(0)
    expect(byId('L2').excludedPairs).toBeGreaterThan(0)
  })

  it('日付だけのロットに印を付ける', () => {
    const l3 = byId('L3')
    expect(l3.hasDateOnly).toBe(true)
    expect(l3.hasApprox).toBe(false)
  })

  it('すべて計算できたロットには印が付かない', () => {
    const l1 = byId('L1')
    expect(l1.complete).toBe(true)
    expect(l1.excludedPairs).toBe(0)
    expect(l1.hasApprox).toBe(false)
    expect(l1.hasDateOnly).toBe(false)
  })
})

describe('buildLotRows ― 工程ごとの明細（ドリルダウン）', () => {
  const l1 = byId('L1')

  it('工程順に並ぶ', () => {
    expect(l1.steps.map(s => s.processCode)).toEqual(['P010', 'P020', 'P030'])
  })

  it('各工程の後ろの滞留を引ける', () => {
    expect(l1.steps[0].gapAfter?.calendarHours).toBeCloseTo(24, 6)
    expect(l1.steps[2].gapAfter).toBeNull() // 最後の工程には無い
  })

  it('計算できなかった工程間に印を付ける', () => {
    const l2 = byId('L2')
    expect(l2.steps[0].gapExcluded).toBe(true)
  })
})

describe('並べ替え', () => {
  it('既定は滞留の長い順', () => {
    const sorted = sortLotRows(rows(), 'stagnation')
    expect(sorted[0].lotId).toBe('L1') // 95時間
  })

  it('リードタイムの長い順', () => {
    const sorted = sortLotRows(rows(), 'leadTime')
    expect(sorted[0].lotId).toBe('L1')
  })

  it('金額の大きい順。金額が出せないロットは後ろに置く（0円として上位に混ぜない）', () => {
    const sorted = sortLotRows(rows({ MA1: COSTS.MA1 }), 'amount')
    expect(sorted[sorted.length - 1].lotId).toBe('L2') // MA2 は単価未設定
    expect(sorted[sorted.length - 1].amountJPY).toBeNull()
  })

  it('ロットID順', () => {
    expect(sortLotRows(rows(), 'lotId').map(r => r.lotId)).toEqual(['L1', 'L2', 'L3'])
  })

  it('元の配列を書き換えない', () => {
    const original = rows()
    const before = original.map(r => r.lotId)
    sortLotRows(original, 'stagnation')
    expect(original.map(r => r.lotId)).toEqual(before)
  })
})

describe('絞り込み', () => {
  it('絞り込み無しなら全件', () => {
    expect(filterLotRows(rows(), EMPTY_FILTER)).toHaveLength(3)
  })

  it('品目で絞る', () => {
    const r = filterLotRows(rows(), { ...EMPTY_FILTER, itemCode: 'MA2' })
    expect(r.map(x => x.lotId)).toEqual(['L2'])
  })

  it('工程で絞る（その工程を通ったロットだけ）', () => {
    const r = filterLotRows(rows(), { ...EMPTY_FILTER, processCode: 'P030' })
    expect(r.map(x => x.lotId)).toEqual(['L1'])
  })

  it('期間で絞る（流れ始めた日で判定）', () => {
    const all = filterLotRows(rows(), { ...EMPTY_FILTER, from: '2026-05-11', to: '2026-05-11' })
    expect(all).toHaveLength(3)
    const none = filterLotRows(rows(), { ...EMPTY_FILTER, from: '2026-05-12', to: '' })
    expect(none).toHaveLength(0)
  })

  it('日付の形式が不正なら制限しない（黙って0件にしない）', () => {
    expect(filterLotRows(rows(), { ...EMPTY_FILTER, from: '5/11' })).toHaveLength(3)
  })

  it('絞り込みを重ねられる', () => {
    const r = filterLotRows(rows(), { ...EMPTY_FILTER, itemCode: 'MA1', processCode: 'P030' })
    expect(r.map(x => x.lotId)).toEqual(['L1'])
  })
})

describe('敵対的なデータ', () => {
  it('ロットが無くても落ちない', () => {
    expect(buildLotRows([], [], new Set(), new Map())).toEqual([])
  })

  it('実績が1つも無いロットでもリードタイムを null にする（0にしない）', () => {
    const csv = `製造指示番号,工程順,工程コード,作業開始日時,作業終了日時
L9,1,P010,,
L9,2,P020,,
`
    const t = buildRawTable('x.csv', utf8(csv))
    const { lots } = buildLots(t, guessMapping(t.headers))
    const gr = computeGaps(lots, DEFAULT_CALENDAR)
    const r = buildLotRows(lots, gr.gaps, gr.completeLotIds, new Map())
    expect(r[0].leadHours).toBeNull()
    expect(r[0].segments).toEqual([])
  })
})
