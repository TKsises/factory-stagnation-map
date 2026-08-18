import { describe, expect, it } from 'vitest'
import { buildRawTable } from './csv'
import { computeGaps } from './gaps'
import { buildLots } from './lots'
import { smallMapping, smallTable } from './lots.test'
import { guessMapping } from './mapping'
import { buildFlow, computeMetrics, formatDays, formatRate } from './metrics'
import type { Gap } from './types'
import { DEFAULT_CALENDAR } from './types'

const { lots } = buildLots(smallTable(), smallMapping())
const gapResult = computeGaps(lots, DEFAULT_CALENDAR)
const m = computeMetrics(lots, gapResult)

const pair = (key: string) => m.pairs.find(p => p.key === key)!

describe('buildFlow ― 工程を流れの順に並べる', () => {
  it('工程順どおりに並ぶ', () => {
    expect(m.flow.map(n => n.code)).toEqual(['P010', 'P020', 'P030', 'P040'])
    expect(m.flow.map(n => n.name)).toEqual(['鋳造', '加工', '塗装', '検査'])
  })

  it('ロットによって工程が飛んでも中央値で安定して並ぶ', () => {
    const partial = [
      { ...lots[0], id: 'X', steps: [lots[0].steps[0], lots[0].steps[3]] }, // P010, P040
      lots[1],
    ]
    expect(buildFlow(partial).map(n => n.code)).toEqual(['P010', 'P020', 'P030', 'P040'])
  })
})

describe('工程間ごとの集計（どこを直せば一番効くか）', () => {
  it('滞留の大きい順に並ぶ', () => {
    expect(m.pairs.map(p => p.key)).toEqual(['P010→P020', 'P020→P030', 'P030→P040'])
  })

  it('P010→P020 は 3件・平均1.361日・中央値1.063日', () => {
    const p = pair('P010→P020')
    expect(p.count).toBe(3)
    expect(p.calendarDaysMean).toBeCloseTo(1.3611, 4) // (24.5+25.5+48)/24/3
    expect(p.calendarDaysMedian).toBeCloseTo(1.0625, 4)
    expect(p.calendarDaysMax).toBeCloseTo(2, 4)
  })

  it('P020→P030 は 3件・平均1.056日', () => {
    expect(pair('P020→P030').calendarDaysMean).toBeCloseTo(1.0556, 4) // (22+21+33)/24/3
  })

  it('除外された工程間は件数に入らない（P030→P040 は LOT-B が抜けて2件）', () => {
    expect(pair('P030→P040').count).toBe(2)
  })

  it('工程名を持つ', () => {
    const p = pair('P010→P020')
    expect(p.fromName).toBe('鋳造')
    expect(p.toName).toBe('加工')
  })

  it('深刻度は3段階に収まる', () => {
    const levels = new Set(m.pairs.map(p => p.severity))
    expect([...levels].every(v => v === 1 || v === 2 || v === 3)).toBe(true)
    expect(pair('P010→P020').severity).toBe(3) // 一番ひどい
    expect(pair('P030→P040').severity).toBe(1)
  })

  it('原価が未設定なので金額は null（0円にしない）', () => {
    expect(m.pairs.every(p => p.amountJPY === null)).toBe(true)
  })
})

describe('サマリー', () => {
  // ★母数は「全ての工程間を計算できたロット」だけ。
  //   LOT-B は P030→P040 が除外されているので、リードタイム・滞留率の母数に入らない。
  //   入れてしまうと、分子（滞留）だけ欠けて分母は満額残り、滞留率が実際より小さく出る。
  it('工程間に欠損があるロットを母数から外す', () => {
    expect(m.summary.rateLots).toBe(2) // LOT-A と LOT-C
    expect(m.summary.rateExcludedLots).toBe(1) // LOT-B
  })

  it('総リードタイムは平均と中央値の両方を出す', () => {
    // A=54.5h, C=83h（B は母数外）
    expect(m.summary.leadTimeMeanDays).toBeCloseTo(2.8646, 4)
    expect(m.summary.leadTimeMedianDays).toBeCloseTo(2.8646, 4)
  })

  it('滞留時間も平均と中央値の両方を出す', () => {
    // A=50.5h, C=81h
    expect(m.summary.stagnationMeanDays).toBeCloseTo(2.7396, 4)
    expect(m.summary.stagnationMedianDays).toBeCloseTo(2.7396, 4)
  })

  it('参考の標準時間は別枠で出す（4工程 × 60分 = 4時間）', () => {
    expect(m.summary.standardTimeMeanDays).toBeCloseTo(4 / 24, 6)
    expect(m.summary.standardTimeLots).toBe(2)
  })

  // ★ここが「数字の説得力」の要。
  //   総リードタイム＝加工など＋滞留 が合わないと、生産技術の人に一目で見抜かれる。
  it('★総リードタイム ＝ 加工など（実績）＋ 滞留 が必ず成り立つ', () => {
    const lead = m.summary.leadTimeMeanDays!
    const work = m.summary.processingActualMeanDays!
    const stag = m.summary.stagnationMeanDays!
    expect(work + stag).toBeCloseTo(lead, 10)
  })

  it('加工など（実績）は 標準時間 とは別の数字（母数も出し方も違う）', () => {
    // A=54.5h-50.5h=4h, C=83h-81h=2h → 平均3h
    expect(m.summary.processingActualMeanDays).toBeCloseTo(3 / 24, 6)
  })

  it('滞留率は 滞留合計 ÷ リードタイム合計（母数は欠損の無いロットだけ）', () => {
    expect(m.summary.stagnationRate).toBeCloseTo(131.5 / 137.5, 6)
  })

  it('既定では予定ベースの印は立たない', () => {
    expect(m.summary.plannedAsActual).toBe(false)
  })

  it('対象期間を実績の最初と最後から出す', () => {
    expect(m.summary.periodFrom?.getDate()).toBe(11)
    expect(m.summary.periodTo?.getDate()).toBe(14)
    expect(m.summary.periodDays).toBeCloseTo(3.4583, 4)
  })
})

describe('データ品質（隠さずに出す）', () => {
  it('内訳の件数が滞留計算の結果と一致する', () => {
    expect(m.quality.basisCounts).toEqual({ actual: 5, derived: 1, 'date-only': 2, excluded: 1 })
    expect(m.quality.pairsTotal).toBe(9)
    expect(m.quality.overlaps).toBe(1)
  })

  it('割合が合計100%になる', () => {
    const sum = Object.values(m.quality.basisPercents).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(100, 6)
  })

  it('一文の件数が、実際に率を割った件数と一致する', () => {
    // 「3件から算出」と書きながら2件で割っている、という食い違いを起こさない
    expect(m.quality.sentence).toContain('3 件のロットのうち 2 件から算出')
    expect(m.quality.sentence).toContain('1 件は工程間に欠損があるため除いています')
  })
})

describe('書式（画面とPNGで同じ見え方にする）', () => {
  it('日数は小数1桁', () => {
    expect(formatDays(1.3611)).toBe('1.4 日')
    expect(formatDays(null)).toBe('—')
  })

  it('割合は小数1桁のパーセント', () => {
    expect(formatRate(0.951872)).toBe('95.2%')
    expect(formatRate(null)).toBe('—')
  })
})

// ────────────────────────────────────────────────────────
// 以下はレビューで見つかった不具合の回帰テスト。
// 直したものが戻ったら、ここが落ちる。
// ────────────────────────────────────────────────────────

const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer
function fromCsv(csv: string) {
  const t = buildRawTable('x.csv', utf8(csv))
  const mp = guessMapping(t.headers)
  const { lots: ls } = buildLots(t, mp)
  return computeMetrics(ls, computeGaps(ls, DEFAULT_CALENDAR))
}

describe('回帰: 除外されたロットが滞留率を薄めない', () => {
  const base = `製造指示番号,工程順,工程コード,作業開始日時,作業終了日時
L1,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,2026/05/15 09:00:00,2026/05/15 10:00:00
`
  // L2 は2工程目に開始が無く標準時間も無いので、唯一の工程間が除外される。
  // それでも firstStart / lastEnd は取れるため、放っておくと分母だけ増える。
  const withExcluded =
    base +
    `L2,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
L2,2,P020,,2026/05/20 10:00:00
`

  it('除外ロットを足しても滞留率が変わらない', () => {
    const a = fromCsv(base)
    const b = fromCsv(withExcluded)
    expect(b.summary.stagnationRate).toBeCloseTo(a.summary.stagnationRate!, 10)
  })

  it('除外した件数を隠さず持つ', () => {
    const b = fromCsv(withExcluded)
    expect(b.summary.rateLots).toBe(1)
    expect(b.summary.rateExcludedLots).toBe(1)
  })

  it('工程が1つだけのロットも母数に入れない', () => {
    const withSingle =
      base + `S1,1,P010,2026/05/11 09:00:00,2026/05/18 10:00:00
`
    const a = fromCsv(base)
    const s = fromCsv(withSingle)
    expect(s.summary.stagnationRate).toBeCloseTo(a.summary.stagnationRate!, 10)
    expect(s.summary.rateExcludedLots).toBe(1)
  })
})

describe('回帰: 標準時間の欠損を0分として合算しない', () => {
  const csv = `製造指示番号,工程順,工程コード,標準時間,作業開始日時,作業終了日時
L1,1,P010,60,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,,2026/05/12 09:00:00,2026/05/12 10:00:00
L1,3,P030,,2026/05/13 09:00:00,2026/05/13 10:00:00
L1,4,P040,60,2026/05/14 09:00:00,2026/05/14 10:00:00
`

  it('1工程でも標準時間が欠けていたら正味加工時間を出さない', () => {
    const r = fromCsv(csv)
    expect(r.summary.standardTimeMeanDays).toBeNull()
    expect(r.summary.standardTimeLots).toBe(0)
  })

  it('全工程に標準時間があれば出す', () => {
    const full = csv.replace(/P020,,/, 'P020,60,').replace(/P030,,/, 'P030,60,')
    const r = fromCsv(full)
    expect(r.summary.standardTimeMeanDays).toBeCloseTo(4 / 24, 6)
    expect(r.summary.standardTimeLots).toBe(1)
  })

  it('合計標準時間があればそちらを優先する（段取り時間を落とさない）', () => {
    const withTotal = `製造指示番号,工程順,工程コード,標準時間,合計標準時間,作業開始日時,作業終了日時
L1,1,P010,60,70,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,60,70,2026/05/12 09:00:00,2026/05/12 10:00:00
`
    const r = fromCsv(withTotal)
    expect(r.summary.standardTimeMeanDays).toBeCloseTo(140 / 60 / 24, 6) // 70分 × 2工程
  })
})

describe('回帰: 工程を飛ばした流れを捨てない', () => {
  const csv = `製造指示番号,工程順,工程コード,作業開始日時,作業終了日時
L1,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
L1,2,P020,2026/05/11 11:00:00,2026/05/11 12:00:00
L1,3,P030,2026/05/11 13:00:00,2026/05/11 14:00:00
L2,1,P010,2026/05/11 09:00:00,2026/05/11 10:00:00
L2,3,P030,2026/06/20 13:00:00,2026/06/20 14:00:00
`
  const r = fromCsv(csv)

  it('隣り合わない工程間も pairs に出る', () => {
    expect(r.pairs.map(p => p.key)).toContain('P010→P030')
  })

  it('最悪の工程間が隣り合わないこともある（図で描き分ける必要がある）', () => {
    const flowCodes = r.flow.map(n => n.code)
    const adjacent = flowCodes.slice(0, -1).map((c, i) => `${c}→${flowCodes[i + 1]}`)
    expect(adjacent).not.toContain(r.pairs[0].key)
  })

  it('山の高さの基準を Metrics が1箇所で持つ', () => {
    expect(r.worstCalendarDaysMean).toBeCloseTo(r.pairs[0].calendarDaysMean, 10)
  })
})

describe('回帰: 1つの工程間に大量のロットがあっても落ちない', () => {
  it('20万件でも calendarDaysMax を出せる（スプレッドでスタックを溢れさせない）', () => {
    const many: Gap[] = Array.from({ length: 200000 }, (_, i) => ({
      lotId: `L${i}`,
      fromProcess: 'P010',
      toProcess: 'P020',
      start: new Date(2026, 4, 11, 9),
      end: new Date(2026, 4, 11, 10),
      calendarHours: (i % 50) + 1,
      workingHours: 1,
      basis: 'actual' as const,
      amountJPY: null,
    }))
    const r = computeMetrics([], {
      gaps: many,
      completeLotIds: new Set<string>(),
      stats: {
        lotsTotal: 0,
        lotsUsed: 0,
        lotsNoPair: 0,
        pairsTotal: many.length,
        basisCounts: { actual: many.length, derived: 0, 'date-only': 0, excluded: 0 },
        overlaps: 0,
      },
    })
    expect(r.pairs[0].calendarDaysMax).toBeCloseTo(50 / 24, 6)
  })
})

describe('敵対的なデータ', () => {
  it('ロットが1つも無くても落ちない', () => {
    const empty = computeMetrics([], {
      gaps: [],
      completeLotIds: new Set<string>(),
      stats: {
        lotsTotal: 0,
        lotsUsed: 0,
        lotsNoPair: 0,
        pairsTotal: 0,
        basisCounts: { actual: 0, derived: 0, 'date-only': 0, excluded: 0 },
        overlaps: 0,
      },
    })
    expect(empty.flow).toEqual([])
    expect(empty.pairs).toEqual([])
    expect(empty.summary.leadTimeMeanDays).toBeNull()
    expect(empty.summary.stagnationRate).toBeNull()
    // 0件のときに 0% を並べても嘘にはならないが、割合の分母0で NaN を出さないこと
    expect(Number.isNaN(empty.quality.basisPercents.actual)).toBe(false)
  })
})
