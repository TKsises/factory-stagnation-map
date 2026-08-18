import { describe, expect, it } from 'vitest'
import { computeGaps } from './gaps'
import { buildLots } from './lots'
import { smallMapping, smallTable } from './lots.test'
import { DEFAULT_CALENDAR } from './types'

const CAL = DEFAULT_CALENDAR // 月〜金 8:30-17:30

const { lots } = buildLots(smallTable(), smallMapping())
const { gaps, stats } = computeGaps(lots, CAL)

const of = (lotId: string, from: string) =>
  gaps.find(g => g.lotId === lotId && g.fromProcess === from)

// ────────────────────────────────────────────────────────
// 期待値は先に手で計算してある（2026-05-11 月 〜 05-14 木）
//
// LOT-A（すべて実績あり）
//   P010→P020 : 月09:30 → 火10:00  暦24.5h  稼働 月8h + 火1.5h = 9.5h
//   P020→P030 : 火11:00 → 水09:00  暦22.0h  稼働 火6.5h + 水0.5h = 7.0h
//   P030→P040 : 水10:00 → 水14:00  暦 4.0h  稼働 4.0h
//
// LOT-B（2工程目の開始が空。標準時間60分を引いて近似 → 火11:00）
//   P010→P020 : 月09:30 → 火11:00(近似)  暦25.5h  稼働 月8h + 火2.5h = 10.5h  basis=derived
//   P020→P030 : 火12:00 → 水09:00        暦21.0h  稼働 火5.5h + 水0.5h = 6.0h
//   P030→P040 : 4工程目に開始も終了も無い → 除外（0にしない）
//
// LOT-C（1〜2工程目が日付だけ、4工程目が重なり）
//   P010→P020 : 月00:00 → 水00:00  暦48.0h  稼働 月9h + 火9h = 18.0h  basis=date-only
//   P020→P030 : 水00:00 → 木09:00  暦33.0h  稼働 水9h + 木0.5h = 9.5h  basis=date-only
//   P030→P040 : 木10:00 → 木08:00  ＝重なり → 0h / 0h、件数だけ数える
// ────────────────────────────────────────────────────────

describe('computeGaps ― 全体の内訳', () => {
  it('工程間は 3ロット × 3 = 9 か所', () => {
    expect(stats.pairsTotal).toBe(9)
    expect(stats.lotsTotal).toBe(3)
    expect(stats.lotsUsed).toBe(3)
    expect(stats.lotsNoPair).toBe(0)
  })

  it('どうやって出した数字かの内訳が合う', () => {
    expect(stats.basisCounts).toEqual({
      actual: 5,
      derived: 1,
      'date-only': 2,
      excluded: 1,
    })
  })

  it('除外した1件は滞留の一覧に入れない（0として混ぜない）', () => {
    expect(gaps).toHaveLength(8)
    expect(gaps.every(g => g.basis !== 'excluded')).toBe(true)
  })

  it('工程の重なりを1件数える', () => {
    expect(stats.overlaps).toBe(1)
  })
})

describe('LOT-A ― すべて実績がある', () => {
  it('P010→P020 は 暦24.5h / 稼働9.5h', () => {
    const g = of('LOT-A', 'P010')!
    expect(g.basis).toBe('actual')
    expect(g.calendarHours).toBe(24.5)
    expect(g.workingHours).toBe(9.5)
  })

  it('P020→P030 は 暦22h / 稼働7h', () => {
    const g = of('LOT-A', 'P020')!
    expect(g.calendarHours).toBe(22)
    expect(g.workingHours).toBe(7)
  })

  it('同じ日の中の滞留も数える', () => {
    const g = of('LOT-A', 'P030')!
    expect(g.calendarHours).toBe(4)
    expect(g.workingHours).toBe(4)
  })
})

describe('LOT-B ― 開始が空の工程を標準時間で近似する', () => {
  it('近似したことを basis に残す', () => {
    const g = of('LOT-B', 'P010')!
    expect(g.basis).toBe('derived')
  })

  it('終了60分前を開始とみなす（火11:00）', () => {
    const g = of('LOT-B', 'P010')!
    expect(g.end.getHours()).toBe(11)
    expect(g.end.getDate()).toBe(12)
    expect(g.calendarHours).toBe(25.5)
    expect(g.workingHours).toBe(10.5)
  })

  it('近似の次の工程間は、実績がそろっているので actual に戻る', () => {
    const g = of('LOT-B', 'P020')!
    expect(g.basis).toBe('actual')
    expect(g.calendarHours).toBe(21)
    expect(g.workingHours).toBe(6)
  })

  it('開始も終了も無い工程との間は除外する', () => {
    expect(of('LOT-B', 'P030')).toBeUndefined()
  })
})

describe('LOT-C ― 日付だけ／工程の重なり', () => {
  it('日付だけなら date-only として印を付ける', () => {
    expect(of('LOT-C', 'P010')!.basis).toBe('date-only')
    expect(of('LOT-C', 'P020')!.basis).toBe('date-only')
  })

  it('日をまたぐ分は数える', () => {
    const g = of('LOT-C', 'P010')!
    expect(g.calendarHours).toBe(48)
    expect(g.workingHours).toBe(18)
  })

  it('日付だけと時刻ありが混ざっても計算する', () => {
    const g = of('LOT-C', 'P020')!
    expect(g.calendarHours).toBe(33)
    expect(g.workingHours).toBe(9.5)
  })

  it('工程が重なっていたら 0 にする（負の値を出さない）', () => {
    const g = of('LOT-C', 'P030')!
    expect(g.calendarHours).toBe(0)
    expect(g.workingHours).toBe(0)
  })
})

describe('computeGaps ― 日付だけで同じ日なら 0', () => {
  it('同日内の滞留は測りようがないので 0 とする', () => {
    const sameDayLots = [
      {
        id: 'L1',
        itemCode: null,
        quantity: null,
        unitFromCsv: null,
        steps: [
          {
            lotId: 'L1',
            processCode: 'P010',
            processName: 'A',
            order: 1,
            actualStart: new Date(2026, 4, 11),
            actualEnd: new Date(2026, 4, 11),
            dateOnly: true,
            standardMinutes: null,
            totalStandardMinutes: null,
            workCenter: null,
            equipment: null,
          },
          {
            lotId: 'L1',
            processCode: 'P020',
            processName: 'B',
            order: 2,
            actualStart: new Date(2026, 4, 11),
            actualEnd: new Date(2026, 4, 11),
            dateOnly: true,
            standardMinutes: null,
            totalStandardMinutes: null,
            workCenter: null,
            equipment: null,
          },
        ],
      },
    ]
    const { gaps: g } = computeGaps(sameDayLots, CAL)
    expect(g[0].calendarHours).toBe(0)
    expect(g[0].basis).toBe('date-only')
  })
})

describe('computeGaps ― 責務は時間だけ', () => {
  it('滞留に金額を持たせない（金額の計算元は money.ts の1箇所だけにする）', () => {
    expect(gaps.every(g => !('amountJPY' in g))).toBe(true)
  })
})
